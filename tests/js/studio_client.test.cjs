const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appJsPath = path.resolve(__dirname, '..', '..', 'app', 'static', 'js', 'app.js');
const studioJsPath = path.resolve(__dirname, '..', '..', 'app', 'static', 'js', 'studio.js');
const appJsSource = fs.readFileSync(appJsPath, 'utf8');
const studioJsSource = fs.readFileSync(studioJsPath, 'utf8');

function createClassList() {
    const values = new Set();
    return {
        add(...tokens) {
            tokens.forEach(token => values.add(String(token)));
        },
        remove(...tokens) {
            tokens.forEach(token => values.delete(String(token)));
        },
        contains(token) {
            return values.has(String(token));
        },
        toggle(token, force) {
            const normalized = String(token);
            if (typeof force === 'boolean') {
                if (force) values.add(normalized);
                else values.delete(normalized);
                return force;
            }
            if (values.has(normalized)) {
                values.delete(normalized);
                return false;
            }
            values.add(normalized);
            return true;
        },
    };
}

function createElement(initial = {}) {
    const listeners = new Map();
    return {
        id: initial.id || '',
        dataset: { ...(initial.dataset || {}) },
        value: initial.value || '',
        textContent: initial.textContent || '',
        innerHTML: initial.innerHTML || '',
        hidden: !!initial.hidden,
        disabled: !!initial.disabled,
        placeholder: initial.placeholder || '',
        style: { ...(initial.style || {}) },
        classList: createClassList(),
        addEventListener(type, handler) {
            listeners.set(String(type), handler);
        },
        dispatch(type, event = {}) {
            const handler = listeners.get(String(type));
            if (handler) handler({ preventDefault() {}, stopPropagation() {}, ...event });
        },
        focus() {},
        remove() {},
    };
}

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
    const elements = {
        studioStrip: createElement({ id: 'studioStrip' }),
        studioSelectedTitle: createElement({ id: 'studioSelectedTitle' }),
        studioSelectedMeta: createElement({ id: 'studioSelectedMeta' }),
        studioJoinHint: createElement({ id: 'studioJoinHint' }),
        studioChatHistory: createElement({ id: 'studioChatHistory' }),
        studioChatForm: createElement({ id: 'studioChatForm' }),
        studioChatInput: createElement({ id: 'studioChatInput' }),
        studioChatSendBtn: createElement({ id: 'studioChatSendBtn' }),
        studioChatState: createElement({ id: 'studioChatState' }),
        studioPresenceBadge: createElement({ id: 'studioPresenceBadge' }),
    };
    const apiCalls = [];
    const context = {
        console,
        window: null,
        globalThis: null,
        self: null,
        setTimeout(fn) {
            if (typeof fn === 'function') fn();
            return 1;
        },
        clearTimeout() {},
        setInterval() {
            return 1;
        },
        clearInterval() {},
        requestAnimationFrame() {
            return 1;
        },
        cancelAnimationFrame() {},
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
        fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
        showToast() {},
        currentState: {
            panel: 'onair',
            currentStationId: 4,
            studios: [],
            selectedStudioId: 0,
            joinedStudioId: 0,
            chatHistory: [],
        },
        Auth: {
            getUser() {
                return { id: 7, username: 'dj-a', role: 'dj' };
            },
            getAccessToken() {
                return 'token';
            },
        },
        document: {
            addEventListener() {},
            getElementById(id) {
                return elements[id] || null;
            },
            querySelectorAll() {
                return [];
            },
            querySelector() {
                return null;
            },
            createElement(tagName) {
                return createElement({ id: tagName });
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
    context.apiFetch = async (url, options = {}) => {
        apiCalls.push({ url, options });
        const pathText = String(url);
        if (pathText.includes('/api/studios/9/chat') && String(options?.method || 'GET').toUpperCase() === 'POST') {
            return {
                message: {
                    id: 2,
                    studio_id: 9,
                    user_id: 7,
                    user_name: 'dj-a',
                    message: String(JSON.parse(String(options.body || '{}')).message || ''),
                    created_at: '2026-03-20T10:00:10Z',
                },
            };
        }
        if (pathText.includes('/api/studios?')) {
            return {
                station_id: 4,
                selected_studio_id: 9,
                chat_messages: [],
                studios: [
                    {
                        id: 9,
                        station_id: 4,
                        name: 'Studio A',
                        description: '',
                        sort_order: 1,
                        is_active: true,
                        is_on_air: true,
                        current_user_id: 7,
                        joined: true,
                        live_presence_count: 2,
                        active_dj: { username: 'dj-a' },
                    },
                    {
                        id: 10,
                        station_id: 4,
                        name: 'Studio B',
                        description: '',
                        sort_order: 2,
                        is_active: true,
                        is_on_air: false,
                        current_user_id: null,
                        joined: false,
                        live_presence_count: 1,
                    },
                ],
            };
        }
        if (pathText.includes('/api/studios/9/chat')) {
            return {
                studio_id: 9,
                messages: [
                    { id: 1, studio_id: 9, user_name: 'dj-a', message: 'stand by', created_at: '2026-03-20T10:00:00Z' },
                ],
            };
        }
        if (pathText.includes('/api/studios/10/chat')) {
            return { studio_id: 10, messages: [] };
        }
        return { ok: true };
    };
    vm.runInNewContext(studioJsSource, context, { filename: studioJsPath });
    return { context, elements, apiCalls };
}

test('StudioManager renders station studios and appends live chat messages', async () => {
    const { context, elements } = createContext();

    await context.StudioManager.applySnapshot({
        station_id: 4,
        studios: [
            { id: 9, name: 'Studio A', is_on_air: true, current_user_id: 7, joined: true, live_presence_count: 2, active_dj: { username: 'dj-a' } },
            { id: 10, name: 'Studio B', is_on_air: false, current_user_id: null, joined: false, live_presence_count: 1 },
        ],
        selected_studio_id: 9,
        chat_messages: [],
    });

    assert.match(elements.studioStrip.innerHTML, /Studio A/);
    assert.match(elements.studioStrip.innerHTML, /data-studio-id="9"/);
    assert.equal(elements.studioChatInput.disabled, false);
    assert.equal(elements.studioChatState.hidden, true);

    context.StudioManager.handleWsEvent({
        type: 'chat.message',
        station_id: 4,
        payload: { studio_id: 9, user_name: 'dj-a', message: 'stand by', created_at: '2026-03-20T10:00:00Z' },
    });

    assert.match(elements.studioChatHistory.innerHTML, /stand by/);
});

test('StudioManager refresh loads chat history when snapshot history is empty', async () => {
    const { context, apiCalls } = createContext();

    await context.StudioManager.refresh({ stationId: 4, force: true });

    const chatRequests = apiCalls.filter(call => String(call.url).includes('/api/studios/9/chat'));
    assert.equal(chatRequests.length, 1);
    assert.match(
        context.document.getElementById('studioChatHistory').innerHTML,
        /stand by/
    );
});

test('StudioManager disables composer until the selected studio is joined', async () => {
    const { context, elements } = createContext();
    context.currentState.selectedStudioId = 9;
    context.currentState.joinedStudioId = 0;

    await context.StudioManager.applySnapshot({
        station_id: 4,
        studios: [
            { id: 9, name: 'Studio A', is_on_air: true, current_user_id: null, joined: false, live_presence_count: 0 },
        ],
        selected_studio_id: 9,
        chat_messages: [],
    });

    assert.equal(elements.studioChatInput.disabled, true);
    assert.equal(elements.studioChatSendBtn.disabled, true);
    assert.match(elements.studioChatState.textContent, /Join this studio to chat/);

    await context.StudioManager.applySnapshot({
        station_id: 4,
        studios: [
            { id: 9, name: 'Studio A', is_on_air: true, current_user_id: 7, joined: true, live_presence_count: 1 },
        ],
        selected_studio_id: 9,
        chat_messages: [],
    });

    assert.equal(elements.studioChatInput.disabled, false);
    assert.equal(elements.studioChatSendBtn.disabled, false);
    assert.equal(elements.studioChatState.hidden, true);
});

test('StudioManager submitChat posts the message and clears composer only on success', async () => {
    const { context, elements, apiCalls } = createContext();
    await context.StudioManager.applySnapshot({
        station_id: 4,
        selected_studio_id: 9,
        studios: [
            { id: 9, name: 'Studio A', is_on_air: true, current_user_id: 7, joined: true, live_presence_count: 1 },
        ],
        chat_messages: [],
    });
    elements.studioChatInput.value = 'go live';

    const response = await context.StudioManager.submitChat();

    assert.equal(String(apiCalls.at(-1)?.options?.method || '').toUpperCase(), 'POST');
    assert.equal(JSON.parse(apiCalls.at(-1).options.body).message, 'go live');
    assert.equal(elements.studioChatInput.value, '');
    assert.equal(response.message.message, 'go live');

    elements.studioChatInput.value = 'retry later';
    context.apiFetch = async () => {
        throw new Error('boom');
    };

    await assert.rejects(() => context.StudioManager.submitChat(), /boom/);
    assert.equal(elements.studioChatInput.value, 'retry later');
});

test('WS.handleEvent routes studio events through StudioManager', async () => {
    const { context } = createContext();
    const received = [];
    context.currentState.currentStationId = 4;
    context.StudioManager.handleWsEvent = (event) => {
        received.push(String(event?.type || ''));
    };

    await context.WS.handleEvent({
        type: 'studio.status',
        station_id: 4,
        payload: { station_id: 4, studios: [] },
    });
    await context.WS.handleEvent({
        type: 'dj.presence',
        station_id: 4,
        payload: { count: 2, connections: [] },
    });
    await context.WS.handleEvent({
        type: 'chat.message',
        station_id: 4,
        payload: { studio_id: 9, message: 'hello' },
    });

    assert.deepEqual(received, ['studio.status', 'dj.presence', 'chat.message']);
});
