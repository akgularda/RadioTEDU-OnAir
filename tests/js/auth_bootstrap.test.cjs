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
        clear() {
            values.clear();
        },
    };
}

function createElement(tagName = 'div') {
    const listeners = new Map();
    const classSet = new Set();
    let classNameValue = '';
    const syncClassName = () => {
        classNameValue = Array.from(classSet).join(' ');
    };
    return {
        tagName: String(tagName).toUpperCase(),
        dataset: {},
        style: {},
        hidden: false,
        value: '',
        checked: false,
        textContent: '',
        innerHTML: '',
        disabled: false,
        children: [],
        get options() {
            return this.children;
        },
        get selectedOptions() {
            return this.children.filter(child => !!child?.selected);
        },
        get className() {
            return classNameValue;
        },
        set className(value) {
            classSet.clear();
            String(value || '').trim().split(/\s+/).filter(Boolean).forEach(token => classSet.add(token));
            syncClassName();
        },
        classList: {
            add(...tokens) {
                tokens.forEach(token => classSet.add(String(token)));
                syncClassName();
            },
            remove(...tokens) {
                tokens.forEach(token => classSet.delete(String(token)));
                syncClassName();
            },
            toggle(token, force) {
                const normalized = String(token);
                if (force === true) {
                    classSet.add(normalized);
                    syncClassName();
                    return true;
                }
                if (force === false) {
                    classSet.delete(normalized);
                    syncClassName();
                    return false;
                }
                if (classSet.has(normalized)) {
                    classSet.delete(normalized);
                    syncClassName();
                    return false;
                }
                classSet.add(normalized);
                syncClassName();
                return true;
            },
            contains(token) {
                return classSet.has(String(token));
            },
        },
        addEventListener(eventName, handler) {
            listeners.set(String(eventName), handler);
        },
        removeEventListener(eventName) {
            listeners.delete(String(eventName));
        },
        async trigger(eventName, event = {}) {
            const handler = listeners.get(String(eventName));
            if (handler) {
                return await handler({
                    preventDefault() {},
                    stopPropagation() {},
                    ...event,
                });
            }
            return undefined;
        },
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        replaceChildren(...children) {
            this.children = children.slice();
        },
        querySelectorAll() {
            return this.children.slice();
        },
        querySelector() {
            return this.children[0] || null;
        },
        remove() {},
        setAttribute(name, value) {
            this[name] = String(value);
        },
    };
}

function createContext({
    pathname = '/',
    search = '',
    fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true }) }),
} = {}) {
    let timerId = 0;
    const intervalCalls = [];
    const clearedIntervals = [];
    const originalFunctions = {};
    const noopTimer = () => {
        timerId += 1;
        return timerId;
    };
    const intervalTimer = (callback, delay) => {
        timerId += 1;
        intervalCalls.push({ id: timerId, callback, delay });
        return timerId;
    };
    const storage = createStorage();
    const eventListeners = new Map();
    const elementCache = new Map();
    const loginForm = createElement('form');
    const loginUsername = createElement('input');
    const loginPassword = createElement('input');
    const loginError = createElement('p');
    const loginSubmit = createElement('button');
    const updateLocation = (next) => {
        const resolved = new URL(String(next), 'http://example.test');
        location.pathname = resolved.pathname;
        location.search = resolved.search;
        location.hash = resolved.hash;
        location.href = resolved.href;
        location.assigned = String(next);
    };
    const location = {
        pathname,
        search,
        hash: '',
        protocol: 'http:',
        host: 'example.test',
        origin: 'http://example.test',
        href: `http://example.test${pathname}${search}`,
        assigned: null,
        assign(next) {
            updateLocation(next);
        },
        replace(next) {
            updateLocation(next);
        },
    };
    const context = {
        console,
        setTimeout: noopTimer,
        clearTimeout() {},
        setInterval: intervalTimer,
        clearInterval(timer) {
            clearedIntervals.push(timer);
        },
        addEventListener() {},
        requestAnimationFrame() {
            return 1;
        },
        cancelAnimationFrame() {},
        performance: { now: () => 0 },
        fetch: fetchImpl,
        location,
        localStorage: storage,
        navigator: { userAgent: 'node-test' },
        AbortController,
        URL,
        URLSearchParams,
        FormData: class FormData {},
        Blob: class Blob {},
        File: class File {},
        confirm: () => true,
        alert: () => {},
        history: {
            replaceState(_state, _title, next) {
                if (next !== undefined && next !== null) {
                    updateLocation(next);
                }
            },
        },
        document: {
            title: 'Initial Title',
            addEventListener(eventName, handler) {
                if (!eventListeners.has(eventName)) {
                    eventListeners.set(eventName, []);
                }
                eventListeners.get(eventName).push(handler);
            },
            getElementById(id) {
                if (elementCache.has(id)) {
                    return elementCache.get(id);
                }
                const element = {
                    loginForm,
                    loginUsername,
                    loginPassword,
                    loginError,
                    loginSubmit,
                }[id] || createElement('div');
                element.id = id;
                elementCache.set(id, element);
                return element;
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
    if (pathname !== '/login.html') {
        [
            'initAuthUi',
            'updateAuthUi',
            'initClock',
            'initNavigation',
            'initOnAirModeUi',
            'initSubpages',
            'initUserModalUi',
            'initRoleTemplateModalUi',
            'initProgramAssignmentsPanel',
            'initAdCampaignEditModalUi',
            'initAdsPricingUi',
            'initStationSwitcher',
            'initPolling',
            'initGlobalErrorHandlers',
            'initYtDlpImportUi',
            'initUploadImportUi',
            'initLibraryScopeUi',
            'toggleStationOutputModeUi',
            'initShowsPanel',
        ].forEach(name => {
            if (typeof context[name] === 'function') {
                originalFunctions[name] = context[name];
                context[name] = () => {};
            }
        });
        context.StudioManager = {
            init: async () => {},
            destroy: () => {},
        };
        context.SoundBoardManager = {
            init: async () => {},
            destroy: () => {},
            loadItems: () => {},
            enableHotkeys: () => {},
            disableHotkeys: () => {},
        };
        context.MicManager = {
            init: async () => {},
            destroy: () => {},
        };
    }
    return {
        context,
        location,
        storage,
        loginForm,
        loginUsername,
        loginPassword,
        loginError,
        loginSubmit,
        intervalCalls,
        clearedIntervals,
        originalFunctions,
        async triggerDOMContentLoaded() {
            const handlers = eventListeners.get('DOMContentLoaded') || [];
            for (const handler of handlers) {
                await handler();
            }
        },
    };
}

test('apiFetch attaches Authorization bearer token', async () => {
    const fetchCalls = [];
    const { context, storage } = createContext({
        fetchImpl: async (url, options = {}) => {
            fetchCalls.push({ url, options });
            return {
                ok: true,
                json: async () => ({ ok: true }),
            };
        },
    });

    storage.setItem('cleanroom_auth_access_token', 'test-access-token');
    await context.apiFetch('/api/tracks?station_id=1');

    assert.equal(fetchCalls.length, 1);
    assert.equal(
        fetchCalls[0].options.headers.Authorization,
        'Bearer test-access-token',
    );
});

test('apiFetch returns null for successful 204 responses without a body', async () => {
    const { context, storage } = createContext({
        fetchImpl: async () => ({
            ok: true,
            status: 204,
            text: async () => '',
            json: async () => {
                throw new Error('json should not be called for 204');
            },
        }),
    });

    storage.setItem('cleanroom_auth_access_token', 'test-access-token');
    const result = await context.apiFetch('/api/soundboard/1', { method: 'DELETE' });

    assert.equal(result, null);
});

test('authenticated app bootstrap redirects unauthenticated users to login page', async () => {
    const { location, triggerDOMContentLoaded } = createContext({ pathname: '/app' });

    await triggerDOMContentLoaded();

    assert.equal(location.pathname, '/login.html');
});

test('401 auth expiry redirects back to the current app station context', async () => {
    const { context, location, storage } = createContext({
        pathname: '/app',
        search: '?station_id=7',
        fetchImpl: async () => ({
            ok: false,
            status: 401,
            text: async () => 'Unauthorized',
        }),
    });

    storage.setItem('cleanroom_auth_access_token', 'test-access-token');

    await context.apiFetch('/api/tracks?station_id=7').catch(() => {});

    assert.equal(location.pathname, '/login.html');
    assert.equal(new URLSearchParams(location.search).get('next'), '/app?station_id=7');
});

test('logout redirects back to the public lobby', async () => {
    const { context, location, storage } = createContext({
        pathname: '/app',
        search: '?station_id=7',
        fetchImpl: async () => ({
            ok: true,
            json: async () => ({ ok: true }),
        }),
    });

    storage.setItem('cleanroom_auth_access_token', 'test-access-token');

    await context.Auth.logout();

    assert.equal(location.pathname, '/');
    assert.equal(location.search, '');
});

test('loadSharedSettings hydrates the display brand input and visible shell brand text', async () => {
    const { context } = createContext({
        pathname: '/app',
        fetchImpl: async () => ({
            ok: true,
            json: async () => ({
                settings: {
                    ui_language: 'en-US',
                    default_crossfade_seconds: 3.0,
                    operation_logs_enabled: true,
                    auto_scan_on_startup: false,
                    display_brand_name: 'Studio North',
                },
            }),
        }),
    });

    await context.loadSharedSettings(true);

    assert.equal(context.document.getElementById('sysDisplayBrandName').value, 'Studio North');
    assert.equal(context.document.getElementById('brandLogoText').textContent, 'Studio North');
    assert.equal(context.document.title, 'Studio North Control Surface');
});

test('saveSystemSettings persists the configured display brand name', async () => {
    const fetchCalls = [];
    const { context } = createContext({
        pathname: '/app',
        fetchImpl: async (url, options = {}) => {
            fetchCalls.push({ url: String(url), options });
            if (options.method === 'PUT') {
                return {
                    ok: true,
                    json: async () => ({ ok: true }),
                };
            }
            return {
                ok: true,
                json: async () => ({
                    settings: {
                        ui_language: 'en-US',
                        default_crossfade_seconds: 3.0,
                        operation_logs_enabled: true,
                        auto_scan_on_startup: false,
                        display_brand_name: 'Studio North',
                    },
                }),
            };
        },
    });

    context.currentState.sharedSettings.default_crossfade_seconds = 3.0;
    context.document.getElementById('sysUiLanguage').value = 'en-US';
    context.document.getElementById('sysCrossfadeSeconds').value = '3.0';
    context.document.getElementById('sysOperationLogsEnabled').checked = true;
    context.document.getElementById('sysAutoScanOnStartup').checked = false;
    context.document.getElementById('sysDisplayBrandName').value = 'Night Shift Radio';

    await context.saveSystemSettings();

    const putCall = fetchCalls.find(call => call.options.method === 'PUT');
    assert.ok(putCall, 'expected a PUT request to save system settings');
    const payload = JSON.parse(putCall.options.body);
    assert.equal(payload.display_brand_name, 'Night Shift Radio');
});

test('auth redirect prefers the live app station over a stale station_id in the url', async () => {
    const { context, location, storage } = createContext({
        pathname: '/app',
        search: '?station_id=2',
        fetchImpl: async () => ({
            ok: false,
            status: 401,
            text: async () => 'Unauthorized',
        }),
    });

    storage.setItem('cleanroom_auth_access_token', 'test-access-token');
    context.currentState.currentStationId = 7;

    await context.apiFetch('/api/tracks?station_id=7').catch(() => {});

    assert.equal(location.pathname, '/login.html');
    assert.equal(new URLSearchParams(location.search).get('next'), '/app?station_id=7');
});

test('switching stations rewrites the authenticated app url to the selected station', async () => {
    const { context, location } = createContext({
        pathname: '/app/',
        search: '?station_id=7',
    });

    context.currentState.stations = [
        { id: 7, name: 'Bravo' },
        { id: 11, name: 'Delta' },
    ];
    context.currentState.currentStationId = 7;
    context.refreshActiveBroadcastStation = async () => null;
    context.refreshStudioWorkspace = async () => {};
    context.syncStationTargetSelectors = () => {};
    context.syncProgramAssignmentStationState = () => {};
    context.renderProgramAssignmentStationOptions = () => {};
    context.applyLibraryScopeUi = () => {};
    context.refreshAll = () => {};
    context.showToast = () => {};
    context.WS = { connect() {} };
    context._currentStationName = () => 'Delta';
    context.document.getElementById('stationSelector').value = '11';

    await context.changeStation();

    assert.equal(location.pathname, '/app');
    assert.equal(location.search, '?station_id=11');
});

test('after switching stations auth expiry redirects stay aligned with the rewritten app url', async () => {
    const { context, location, storage } = createContext({
        pathname: '/app',
        search: '?station_id=7',
        fetchImpl: async (url) => {
            if (String(url).includes('/api/tracks')) {
                return {
                    ok: false,
                    status: 401,
                    text: async () => 'Unauthorized',
                };
            }
            return {
                ok: true,
                json: async () => ({ ok: true }),
            };
        },
    });

    storage.setItem('cleanroom_auth_access_token', 'test-access-token');
    context.currentState.stations = [
        { id: 7, name: 'Bravo' },
        { id: 11, name: 'Delta' },
    ];
    context.currentState.currentStationId = 7;
    context.refreshActiveBroadcastStation = async () => null;
    context.refreshStudioWorkspace = async () => {};
    context.syncStationTargetSelectors = () => {};
    context.syncProgramAssignmentStationState = () => {};
    context.renderProgramAssignmentStationOptions = () => {};
    context.applyLibraryScopeUi = () => {};
    context.refreshAll = () => {};
    context.showToast = () => {};
    context.WS = { connect() {} };
    context._currentStationName = () => 'Delta';
    context.document.getElementById('stationSelector').value = '11';

    await context.changeStation();
    await context.apiFetch('/api/tracks?station_id=11').catch(() => {});

    assert.equal(location.pathname, '/login.html');
    assert.equal(new URLSearchParams(location.search).get('next'), '/app?station_id=11');
});

test('public lobby bootstrap does not redirect unauthenticated users to login', async () => {
    const { location, triggerDOMContentLoaded } = createContext({ pathname: '/' });

    await triggerDOMContentLoaded();

    assert.equal(location.pathname, '/');
});

test('login success redirects to the supplied next route', async () => {
    const { location, loginForm, loginUsername, loginPassword, triggerDOMContentLoaded } = createContext({
        pathname: '/login.html',
        search: '?station_id=7&next=%2Fapp%3Fstation_id%3D7',
        fetchImpl: async (url) => {
            if (String(url).includes('/api/auth/login')) {
                return {
                    ok: true,
                    json: async () => ({
                        access_token: 'test-access-token',
                        refresh_token: 'test-refresh-token',
                        user: { id: 1, username: 'dj' },
                    }),
                };
            }
            if (String(url).includes('/api/auth/me')) {
                return {
                    ok: true,
                    json: async () => ({ id: 1, username: 'dj' }),
                };
            }
            return {
                ok: true,
                json: async () => ({ ok: true }),
            };
        },
    });

    loginUsername.value = 'dj';
    loginPassword.value = 'secret';
    await triggerDOMContentLoaded();
    await loginForm.trigger('submit');

    assert.equal(location.pathname, '/app');
    assert.equal(location.search, '?station_id=7');
});

test('unsafe external next parameter falls back to the app shell', async () => {
    const { location, loginForm, loginUsername, loginPassword, triggerDOMContentLoaded } = createContext({
        pathname: '/login.html',
        search: '?next=https%3A%2F%2Fevil.example%2Fphish',
        fetchImpl: async (url) => {
            if (String(url).includes('/api/auth/login')) {
                return {
                    ok: true,
                    json: async () => ({
                        access_token: 'test-access-token',
                        refresh_token: 'test-refresh-token',
                        user: { id: 1, username: 'dj' },
                    }),
                };
            }
            if (String(url).includes('/api/auth/me')) {
                return {
                    ok: true,
                    json: async () => ({ id: 1, username: 'dj' }),
                };
            }
            return {
                ok: true,
                json: async () => ({ ok: true }),
            };
        },
    });

    loginUsername.value = 'dj';
    loginPassword.value = 'secret';
    await triggerDOMContentLoaded();
    await loginForm.trigger('submit');

    assert.equal(location.pathname, '/app');
    assert.equal(location.search, '');
});

test('same-origin login next paths outside the app shell fall back to the app shell', async () => {
    const { location, loginForm, loginUsername, loginPassword, triggerDOMContentLoaded } = createContext({
        pathname: '/login.html',
        search: '?next=%2Flogin.html',
        fetchImpl: async (url) => {
            if (String(url).includes('/api/auth/login')) {
                return {
                    ok: true,
                    json: async () => ({
                        access_token: 'test-access-token',
                        refresh_token: 'test-refresh-token',
                        user: { id: 1, username: 'dj' },
                    }),
                };
            }
            if (String(url).includes('/api/auth/me')) {
                return {
                    ok: true,
                    json: async () => ({ id: 1, username: 'dj' }),
                };
            }
            return {
                ok: true,
                json: async () => ({ ok: true }),
            };
        },
    });

    loginUsername.value = 'dj';
    loginPassword.value = 'secret';
    await triggerDOMContentLoaded();
    await loginForm.trigger('submit');

    assert.equal(location.pathname, '/app');
    assert.equal(location.search, '');
});

test('same-origin api next paths fall back to the app shell', async () => {
    const { location, loginForm, loginUsername, loginPassword, triggerDOMContentLoaded } = createContext({
        pathname: '/login.html',
        search: '?next=%2Fapi%2Ftracks%3Fstation_id%3D7',
        fetchImpl: async (url) => {
            if (String(url).includes('/api/auth/login')) {
                return {
                    ok: true,
                    json: async () => ({
                        access_token: 'test-access-token',
                        refresh_token: 'test-refresh-token',
                        user: { id: 1, username: 'dj' },
                    }),
                };
            }
            if (String(url).includes('/api/auth/me')) {
                return {
                    ok: true,
                    json: async () => ({ id: 1, username: 'dj' }),
                };
            }
            return {
                ok: true,
                json: async () => ({ ok: true }),
            };
        },
    });

    loginUsername.value = 'dj';
    loginPassword.value = 'secret';
    await triggerDOMContentLoaded();
    await loginForm.trigger('submit');

    assert.equal(location.pathname, '/app');
    assert.equal(location.search, '');
});

test('/app bootstrap uses station_id from the URL as the initial station selection', async () => {
    const { context, storage, triggerDOMContentLoaded } = createContext({
        pathname: '/app',
        search: '?station_id=7',
        fetchImpl: async (url) => {
            if (String(url).includes('/api/auth/me')) {
                return {
                    ok: true,
                    json: async () => ({ id: 1, username: 'dj' }),
                };
            }
            if (String(url).includes('/api/stations')) {
                return {
                    ok: true,
                    json: async () => ({
                        stations: [
                            { id: 1, name: 'Alpha' },
                            { id: 7, name: 'Bravo' },
                        ],
                    }),
                };
            }
            return {
                ok: true,
                json: async () => ({ ok: true }),
            };
        },
    });

    storage.setItem('cleanroom_auth_access_token', 'test-access-token');

    await triggerDOMContentLoaded();

    assert.equal(context.currentState.currentStationId, 7);
});

test('/app bootstrap resolves the station before on-air initialization observes station context', async () => {
    let observedStationId = null;
    const { context, storage, triggerDOMContentLoaded } = createContext({
        pathname: '/app',
        search: '?station_id=7',
        fetchImpl: async (url) => {
            if (String(url).includes('/api/auth/me')) {
                return {
                    ok: true,
                    json: async () => ({ id: 1, username: 'dj' }),
                };
            }
            if (String(url).includes('/api/stations/active')) {
                return {
                    ok: true,
                    json: async () => ({ station_id: 7 }),
                };
            }
            if (String(url).includes('/api/stations')) {
                return {
                    ok: true,
                    json: async () => ({
                        stations: [
                            { id: 1, name: 'Alpha' },
                            { id: 7, name: 'Bravo' },
                        ],
                    }),
                };
            }
            return {
                ok: true,
                json: async () => ({ ok: true }),
            };
        },
    });

    storage.setItem('cleanroom_auth_access_token', 'test-access-token');
    context.initOnAirModeUi = () => {
        observedStationId = context.currentState.currentStationId;
    };

    await triggerDOMContentLoaded();

    assert.equal(observedStationId, 7);
});

test('/app bootstrap prefers a saved station when the URL station id is not present', async () => {
    const { context, storage, triggerDOMContentLoaded } = createContext({
        pathname: '/app',
        search: '?station_id=99',
        fetchImpl: async (url) => {
            if (String(url).includes('/api/auth/me')) {
                return {
                    ok: true,
                    json: async () => ({ id: 1, username: 'dj' }),
                };
            }
            if (String(url).includes('/api/stations')) {
                return {
                    ok: true,
                    json: async () => ({
                        stations: [
                            { id: 1, name: 'Alpha' },
                            { id: 2, name: 'Bravo' },
                        ],
                    }),
                };
            }
            return {
                ok: true,
                json: async () => ({ ok: true }),
            };
        },
    });

    storage.setItem('radio_station_id', '2');
    storage.setItem('cleanroom_auth_access_token', 'test-access-token');

    await triggerDOMContentLoaded();

    assert.equal(context.currentState.currentStationId, 2);
});

test('/app bootstrap defers hidden panel initialization until activation', async () => {
    const calls = [];
    const { context, storage, triggerDOMContentLoaded } = createContext({
        pathname: '/app',
        search: '?station_id=7',
        fetchImpl: async (url) => {
            if (String(url).includes('/api/auth/me')) {
                return {
                    ok: true,
                    json: async () => ({ id: 1, username: 'dj' }),
                };
            }
            if (String(url).includes('/api/stations/active')) {
                return {
                    ok: true,
                    json: async () => ({ station_id: 7 }),
                };
            }
            if (String(url).includes('/api/stations')) {
                return {
                    ok: true,
                    json: async () => ({
                        stations: [
                            { id: 1, name: 'Alpha' },
                            { id: 7, name: 'Bravo' },
                        ],
                    }),
                };
            }
            return {
                ok: true,
                json: async () => ({ ok: true }),
            };
        },
    });

    storage.setItem('cleanroom_auth_access_token', 'test-access-token');
    context.initOnAirModeUi = () => { calls.push('onair'); };
    context.initUserModalUi = () => { calls.push('users'); };
    context.initRoleTemplateModalUi = () => { calls.push('roles'); };
    context.initProgramAssignmentsPanel = () => { calls.push('program-assignments'); };
    context.initAdCampaignEditModalUi = () => { calls.push('ads'); };
    context.initAdsPricingUi = () => { calls.push('ads-pricing'); };
    context.initYtDlpImportUi = () => { calls.push('downloads'); };
    context.initUploadImportUi = () => { calls.push('uploads'); };
    context.initLibraryScopeUi = () => { calls.push('library'); };

    await triggerDOMContentLoaded();

    assert.ok(calls.includes('onair'));
    assert.deepEqual(calls.filter(name => name !== 'onair'), []);
});

test('switchPanel lazily initializes library data on first activation', async () => {
    const fetchCalls = [];
    const calls = [];
    const { context, storage, triggerDOMContentLoaded } = createContext({
        pathname: '/app',
        search: '?station_id=7',
        fetchImpl: async (url) => {
            fetchCalls.push(String(url));
            if (String(url).includes('/api/auth/me')) {
                return {
                    ok: true,
                    json: async () => ({ id: 1, username: 'dj' }),
                };
            }
            if (String(url).includes('/api/stations/active')) {
                return {
                    ok: true,
                    json: async () => ({ station_id: 7 }),
                };
            }
            if (String(url).includes('/api/stations')) {
                return {
                    ok: true,
                    json: async () => ({
                        stations: [
                            { id: 1, name: 'Alpha' },
                            { id: 7, name: 'Bravo' },
                        ],
                    }),
                };
            }
            return {
                ok: true,
                json: async () => ({ ok: true }),
            };
        },
    });

    storage.setItem('cleanroom_auth_access_token', 'test-access-token');
    context.computeVisiblePanels = () => ['onair', 'library', 'downloads'];
    context.initLibraryScopeUi = () => { calls.push('init-library'); };

    await triggerDOMContentLoaded();

    calls.length = 0;
    fetchCalls.length = 0;
    assert.equal(context.switchPanel('library'), true);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.deepEqual(calls, ['init-library']);
    assert.ok(fetchCalls.some(url => url.includes('/api/library/metadata/rules?station_id=7')));
    assert.ok(fetchCalls.some(url => url.includes('/api/tracks?station_id=7')));
    assert.ok(fetchCalls.some(url => url.includes('/api/sweeper/config?station_id=7')));

    calls.length = 0;
    fetchCalls.length = 0;
    assert.equal(context.switchPanel('library'), true);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.deepEqual(calls, []);
    assert.deepEqual(fetchCalls, []);
});

test('download polling starts only after the downloads panel is opened', async () => {
    const { context, storage, triggerDOMContentLoaded, intervalCalls, clearedIntervals, originalFunctions } = createContext({
        pathname: '/app',
        search: '?station_id=7',
        fetchImpl: async (url) => {
            if (String(url).includes('/api/auth/me')) {
                return {
                    ok: true,
                    json: async () => ({ id: 1, username: 'dj' }),
                };
            }
            if (String(url).includes('/api/stations/active')) {
                return {
                    ok: true,
                    json: async () => ({ station_id: 7 }),
                };
            }
            if (String(url).includes('/api/stations')) {
                return {
                    ok: true,
                    json: async () => ({
                        stations: [
                            { id: 1, name: 'Alpha' },
                            { id: 7, name: 'Bravo' },
                        ],
                    }),
                };
            }
            return {
                ok: true,
                json: async () => ({ ok: true }),
            };
        },
    });

    storage.setItem('cleanroom_auth_access_token', 'test-access-token');
    context.initPolling = originalFunctions.initPolling;
    context.computeVisiblePanels = () => ['onair', 'downloads'];

    await triggerDOMContentLoaded();

    assert.equal(intervalCalls.some(call => call.delay === 2500), false);

    context.switchPanel('downloads');
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(intervalCalls.filter(call => call.delay === 2500).length, 1);

    context.switchPanel('onair');
    await Promise.resolve();
    await Promise.resolve();

    assert.ok(clearedIntervals.length >= 1);
});
