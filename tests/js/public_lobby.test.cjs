const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const lobbyHtml = fs.readFileSync(path.join(root, 'app', 'static', 'lobby.html'), 'utf8');
const lobbyJs = fs.readFileSync(path.join(root, 'app', 'static', 'js', 'lobby.js'), 'utf8');

function createClassList(initial = []) {
    const values = new Set(initial.map(token => String(token)));
    return {
        reset(tokens = []) {
            values.clear();
            tokens.map(token => String(token)).forEach(token => values.add(token));
        },
        add(...tokens) {
            tokens.forEach(token => values.add(String(token)));
        },
        remove(...tokens) {
            tokens.forEach(token => values.delete(String(token)));
        },
        contains(token) {
            return values.has(String(token));
        },
        toString() {
            return Array.from(values).join(' ');
        },
    };
}

function createElement(tagName = 'div') {
    const listeners = {};
    const classList = createClassList();
    let classNameValue = '';
    const syncClassName = () => {
        classNameValue = classList.toString();
    };
    return {
        tagName: String(tagName).toUpperCase(),
        dataset: {},
        get className() {
            return classNameValue;
        },
        set className(value) {
            const tokens = String(value ?? '').trim() ? String(value).trim().split(/\s+/) : [];
            classList.reset(tokens);
            syncClassName();
        },
        classList: {
            add(...tokens) {
                classList.add(...tokens);
                syncClassName();
            },
            remove(...tokens) {
                classList.remove(...tokens);
                syncClassName();
            },
            contains(token) {
                return classList.contains(token);
            },
            toString() {
                return classList.toString();
            },
        },
        children: [],
        innerHTML: '',
        textContent: '',
        hidden: false,
        setAttribute(name, value) {
            if (name === 'class') {
                this.className = String(value);
                return;
            }
            this[name] = String(value);
        },
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        addEventListener(eventName, handler) {
            listeners[eventName] = handler;
        },
        click() {
            if (listeners.click) listeners.click({ currentTarget: this });
        },
        querySelectorAll() {
            return this.children.slice();
        },
    };
}

function collectText(node) {
    const ownText = String(node?.textContent ?? '');
    const childText = Array.isArray(node?.children)
        ? node.children.map(collectText).join(' ')
        : '';
    return `${ownText} ${childText}`.replace(/\s+/g, ' ').trim();
}

function createContext({ fetchImpl, nowMs = Date.UTC(2026, 2, 27, 12, 0, 0) } = {}) {
    const grid = createElement('section');
    grid.id = 'publicStationGrid';
    const lobbyBrandName = createElement('p');
    lobbyBrandName.id = 'lobbyBrandName';
    const liveCount = createElement('div');
    liveCount.id = 'lobbyLiveCount';
    const degradedCount = createElement('div');
    degradedCount.id = 'lobbyDegradedCount';
    const offlineCount = createElement('div');
    offlineCount.id = 'lobbyOfflineCount';

    const location = {
        pathname: '/',
        search: '',
        hash: '',
        href: 'http://example.test/',
        assigned: null,
        assign(value) {
            this.assigned = String(value);
        },
    };

    const RealDate = Date;
    class MockDate extends RealDate {
        constructor(...args) {
            if (args.length === 0) {
                super(nowMs);
                return;
            }
            super(...args);
        }

        static now() {
            return nowMs;
        }

        static parse(value) {
            return RealDate.parse(value);
        }

        static UTC(...args) {
            return RealDate.UTC(...args);
        }
    }

    const context = {
        console,
        Date: MockDate,
        fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({ stations: [] }) })),
        location,
        URL,
        URLSearchParams,
        document: {
            title: 'Initial Lobby Title',
            addEventListener() {},
            getElementById(id) {
                return {
                    publicStationGrid: grid,
                    lobbyBrandName,
                    lobbyLiveCount: liveCount,
                    lobbyDegradedCount: degradedCount,
                    lobbyOfflineCount: offlineCount,
                }[id] || null;
            },
            createElement,
            querySelectorAll() {
                return [];
            },
            body: {
                appendChild() {},
            },
        },
        navigator: { userAgent: 'node-test' },
        window: null,
        globalThis: null,
        self: null,
        setTimeout() { return 1; },
        clearTimeout() {},
        setInterval() { return 1; },
        clearInterval() {},
    };
    context.window = context;
    context.globalThis = context;
    context.self = context;
    vm.runInNewContext(lobbyJs, context, { filename: path.join(root, 'app', 'static', 'js', 'lobby.js') });
    return { context, grid, lobbyBrandName, liveCount, degradedCount, offlineCount, location };
}

test('public lobby shell contains the station grid and status badge targets', () => {
    assert.match(lobbyHtml, /id="publicStationLobby"/);
    assert.match(lobbyHtml, /id="publicStationGrid"/);
    assert.match(lobbyHtml, /id="lobbyLiveCount"/);
    assert.match(lobbyHtml, /id="lobbyDegradedCount"/);
    assert.match(lobbyHtml, /id="lobbyOfflineCount"/);
    assert.match(lobbyHtml, /src="\/static\/js\/lobby\.js\?v=3"/);
    assert.match(lobbyHtml, /lobby-card--loading/);
    assert.match(lobbyHtml, /lobby-card-nowplaying/);
    assert.match(lobbyHtml, /id="lobbyBrandName"/);
    assert.doesNotMatch(lobbyHtml, /lobby-now-playing/);
    assert.doesNotMatch(lobbyHtml, /lobby-card-placeholder/);
    assert.doesNotMatch(lobbyHtml, /src="\/static\/js\/app\.js\?v=11"/);
});

test('lobby brand loader applies the configured display brand name to the public shell', async () => {
    const { context, lobbyBrandName } = createContext({
        fetchImpl: async (url) => {
            if (String(url).includes('/api/settings/system')) {
                return {
                    ok: true,
                    json: async () => ({
                        settings: {
                            display_brand_name: 'Night Shift Radio',
                        },
                    }),
                };
            }
            return {
                ok: true,
                json: async () => ({ stations: [] }),
            };
        },
    });

    await context.PublicLobby.loadBrand();

    assert.equal(lobbyBrandName.textContent, 'Night Shift Radio');
    assert.equal(context.document.title, 'Night Shift Radio Broadcast Wall');
});

test('lobby.js fetches public station summaries and renders status cards', async () => {
    const calls = [];
    const { context, grid, liveCount, degradedCount, offlineCount } = createContext({
        fetchImpl: async (url) => {
            calls.push(String(url));
            return {
                ok: true,
                json: async () => ({
                    stations: [
                        {
                            id: 1,
                            name: 'Atlas FM',
                            status: 'live',
                            status_reason: 'Runtime healthy',
                            now_playing: {
                                title: 'Sunrise',
                                artist: 'The Dawn',
                                duration: 221,
                                started_at: '2026-03-27T11:57:47Z',
                            },
                            active_show_name: 'Morning Drive',
                        },
                        {
                            id: 2,
                            name: 'Sahil Radyo',
                            status: 'degraded',
                            status_reason: 'Runtime is running but required outputs are degraded',
                            now_playing: null,
                            active_show_name: null,
                        },
                        {
                            id: 3,
                            name: 'Neon Pulse',
                            status: 'offline',
                            status_reason: 'Runtime and worker are stopped',
                            now_playing: null,
                            active_show_name: null,
                        },
                    ],
                }),
            };
        },
    });

    await context.PublicLobby.loadStations();

    assert.deepEqual(calls, ['/api/public/stations']);
    assert.equal(grid.children.length, 3);

    const [liveCard, degradedCard, offlineCard] = grid.children;
    assert.match(String(liveCard.className), /lobby-card--live/);
    assert.match(String(degradedCard.className), /lobby-card--degraded/);
    assert.match(String(offlineCard.className), /lobby-card--offline/);
    assert.match(collectText(liveCard), /Atlas FM/);
    assert.match(collectText(liveCard), /Morning Drive/);
    assert.match(collectText(liveCard), /Runtime healthy/);
    assert.match(collectText(liveCard), /\(02:13 \/ 03:41\)/);
    assert.match(collectText(degradedCard), /Sahil Radyo/);
    assert.match(collectText(offlineCard), /Neon Pulse/);
    assert.equal(liveCount.textContent, '1 live');
    assert.equal(degradedCount.textContent, '1 degraded');
    assert.equal(offlineCount.textContent, '1 offline');
});

test('lobby.js clears the loading card and shows empty or error state copy', async () => {
    const emptyContext = createContext({
        fetchImpl: async () => ({
            ok: true,
            json: async () => ({ stations: [] }),
        }),
    });

    await emptyContext.context.PublicLobby.loadStations();

    assert.equal(emptyContext.grid.children.length, 1);
    assert.match(collectText(emptyContext.grid.children[0]), /No stations are currently available in the public catalog/);
    assert.match(String(emptyContext.grid.children[0].className), /lobby-card-empty/);
    assert.notEqual(String(emptyContext.grid.children[0]['aria-hidden'] || ''), 'true');

    const errorContext = createContext({
        fetchImpl: async () => ({
            ok: false,
            status: 503,
            json: async () => ({ stations: [] }),
        }),
    });
    errorContext.context.console.error = () => {};

    await errorContext.context.PublicLobby.loadStations();

    assert.equal(errorContext.grid.children.length, 1);
    assert.match(collectText(errorContext.grid.children[0]), /Broadcast data could not be loaded right now/);
    assert.match(String(errorContext.grid.children[0].className), /lobby-card-empty/);
    assert.notEqual(String(errorContext.grid.children[0]['aria-hidden'] || ''), 'true');
});

test('clicking a station builds the correct login URL', () => {
    const { context, grid, location } = createContext({
        fetchImpl: async () => ({
            ok: true,
            json: async () => ({
                stations: [
                    {
                        id: 7,
                        name: 'Morning Wave',
                        status: 'live',
                        status_reason: 'Runtime healthy',
                        now_playing: null,
                        active_show_name: null,
                    },
                ],
            }),
        }),
    });

    return context.PublicLobby.loadStations().then(() => {
        const card = grid.children[0];
        assert.ok(card, 'expected one rendered station card');
        card.click();
        assert.equal(
            location.assigned,
            '/login.html?station_id=7&next=%2Fapp%3Fstation_id%3D7',
        );
    });
});
