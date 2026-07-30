const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appJsPath = path.resolve(__dirname, '..', '..', 'app', 'static', 'js', 'app.js');
const appJsSource = fs.readFileSync(appJsPath, 'utf8');

function createStorage() {
    const values = new Map();
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(String(key), String(value));
        },
        removeItem(key) {
            values.delete(String(key));
        },
    };
}

function createContext() {
    let timerId = 0;
    const noopTimer = () => {
        timerId += 1;
        return timerId;
    };
    const context = {
        console,
        setTimeout: noopTimer,
        clearTimeout() {},
        setInterval: noopTimer,
        clearInterval() {},
        requestAnimationFrame() {
            return 1;
        },
        cancelAnimationFrame() {},
        fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
        location: {
            pathname: '/',
            protocol: 'http:',
            host: 'example.test',
            replace() {},
        },
        localStorage: createStorage(),
        navigator: { userAgent: 'node-test' },
        URL,
        URLSearchParams,
        AbortController,
        document: {
            addEventListener() {},
            getElementById() {
                return null;
            },
            querySelectorAll() {
                return [];
            },
            querySelector() {
                return null;
            },
            createElement() {
                return {
                    className: '',
                    style: {},
                    dataset: {},
                    appendChild() {},
                    addEventListener() {},
                    remove() {},
                    setAttribute() {},
                    innerHTML: '',
                    textContent: '',
                };
            },
            body: {
                appendChild() {},
            },
        },
    };
    context.window = context;
    context.globalThis = context;
    context.self = context;
    vm.runInNewContext(appJsSource, context, { filename: appJsPath });
    return context;
}

test('WS.handleEvent updates playback, queue, and health state', async () => {
    const context = createContext();
    const calls = { queue: 0, health: 0, status: 0 };

    context.applyQueueSnapshot = (payload) => {
        calls.queue += 1;
        context.currentState.queueItems = payload.items || [];
    };
    context.applyHealthSnapshot = (payload) => {
        calls.health += 1;
        context.currentState.health = payload || {};
    };
    context.applyStatusSnapshot = async (payload) => {
        calls.status += 1;
        context.currentState.currentTrack = payload.current_track || null;
    };

    await context.WS.handleEvent({
        type: 'queue.updated',
        station_id: 1,
        payload: { station_id: 1, items: [{ id: 5, title: 'Queue Track' }] },
    });
    await context.WS.handleEvent({
        type: 'health.updated',
        station_id: 1,
        payload: { station_id: 1, engine_running: true },
    });
    await context.WS.handleEvent({
        type: 'runtime.updated',
        station_id: 1,
        payload: { station_id: 1, current_track: { title: 'Live Track' } },
    });

    assert.equal(calls.queue, 1);
    assert.equal(calls.health, 1);
    assert.equal(calls.status, 1);
    assert.equal(context.currentState.queueItems[0].title, 'Queue Track');
    assert.equal(context.currentState.health.engine_running, true);
    assert.equal(context.currentState.currentTrack.title, 'Live Track');
});

test('buildWsUrl uses the current page protocol and host', () => {
    const context = createContext();

    context.location.protocol = 'https:';
    context.location.host = 'radio.example.com';

    assert.equal(
        typeof context.buildWsUrl,
        'function',
        'buildWsUrl helper should be exposed for proxy-safe websocket bootstrap'
    );
    assert.equal(
        context.buildWsUrl('token-123', 7),
        'wss://radio.example.com/ws?token=token-123&station_id=7'
    );

    context.location.protocol = 'http:';
    assert.equal(
        context.buildWsUrl('token-123', 7),
        'ws://radio.example.com/ws?token=token-123&station_id=7'
    );
});

test('WS exposes send helpers for mic control json and binary frames', () => {
    const context = createContext();
    const sent = [];

    context.WebSocket = { OPEN: 1 };
    context.WS.socket = {
        readyState: 1,
        send(payload) {
            sent.push(payload);
        },
    };

    assert.equal(typeof context.WS.send, 'function');

    context.WS.send({ type: 'mic.start', station_id: 1 });
    context.WS.send(new Uint8Array([1, 2, 3, 4]));

    assert.equal(typeof sent[0], 'string');
    assert.equal(JSON.parse(sent[0]).type, 'mic.start');
    assert.deepEqual(Array.from(sent[1]), [1, 2, 3, 4]);
});
