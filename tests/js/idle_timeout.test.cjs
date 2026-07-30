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

function createClock(start = 0) {
    let now = start;
    let nextId = 1;
    const timers = new Map();

    const runDueTimers = () => {
        let progressed = true;
        while (progressed) {
            progressed = false;
            const dueTimers = Array.from(timers.entries())
                .filter(([, timer]) => !timer.cleared && timer.at <= now)
                .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);

            if (!dueTimers.length) break;

            for (const [id, timer] of dueTimers) {
                if (timer.cleared) continue;
                if (timer.interval != null) {
                    timer.at += timer.interval;
                } else {
                    timer.cleared = true;
                    timers.delete(id);
                }
                timer.fn();
                progressed = true;
            }
        }
    };

    return {
        now() {
            return now;
        },
        set(value) {
            now = value;
            runDueTimers();
        },
        advance(ms) {
            now += ms;
            runDueTimers();
        },
        setTimeout(fn, delay = 0) {
            const id = nextId++;
            timers.set(id, {
                fn: typeof fn === 'function' ? fn : () => {},
                at: now + Number(delay || 0),
                cleared: false,
                interval: null,
            });
            return id;
        },
        clearTimeout(id) {
            const timer = timers.get(id);
            if (timer) timer.cleared = true;
            timers.delete(id);
        },
        setInterval(fn, delay = 0) {
            const id = nextId++;
            timers.set(id, {
                fn: typeof fn === 'function' ? fn : () => {},
                at: now + Number(delay || 0),
                cleared: false,
                interval: Math.max(0, Number(delay || 0)),
            });
            return id;
        },
        clearInterval(id) {
            const timer = timers.get(id);
            if (timer) timer.cleared = true;
            timers.delete(id);
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
        textContent: '',
        innerHTML: '',
        disabled: false,
        value: '',
        children: [],
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
            if (!handler) return undefined;
            return await handler({
                preventDefault() {},
                stopPropagation() {},
                currentTarget: this,
                target: this,
                ...event,
            });
        },
        click() {
            if (typeof this.onclick === 'function') {
                this.onclick({ currentTarget: this, target: this });
            }
            return this.trigger('click');
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
        setAttribute(name, value) {
            this[name] = String(value);
        },
        remove() {},
    };
}

function createContext({
    pathname = '/app',
    search = '',
    fetchImpl,
} = {}) {
    const clock = createClock(0);
    const storage = createStorage();
    const eventListeners = new Map();
    const elementCache = new Map();
    const logoutCalls = [];
    const idleBanner = createElement('section');
    idleBanner.hidden = true;
    const idleMessage = createElement('div');
    const idleCountdown = createElement('div');
    const staySignedInBtn = createElement('button');
    const location = {
        pathname,
        search,
        hash: '',
        protocol: 'http:',
        host: 'example.test',
        origin: 'http://example.test',
        href: `http://example.test${pathname}${search}`,
        assigned: null,
        replace(next) {
            this.assigned = String(next);
            const resolved = new URL(String(next), this.origin);
            this.pathname = resolved.pathname;
            this.search = resolved.search;
            this.hash = resolved.hash;
            this.href = resolved.href;
        },
    };

    const defaultFetch = async (url) => {
        if (String(url).includes('/api/auth/me')) {
            return {
                ok: true,
                json: async () => ({ id: 1, username: 'dj' }),
            };
        }
        if (String(url).includes('/api/stations')) {
            return {
                ok: true,
                json: async () => ({ stations: [{ id: 1, name: 'Alpha' }] }),
            };
        }
        return {
            ok: true,
            json: async () => ({ ok: true }),
        };
    };

    const context = {
        console,
        Date: class extends Date {
            static now() {
                return clock.now();
            }
        },
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        setInterval: clock.setInterval,
        clearInterval: clock.clearInterval,
        requestAnimationFrame(fn) {
            return clock.setTimeout(() => fn(clock.now()), 16);
        },
        cancelAnimationFrame: clock.clearTimeout,
        performance: { now: () => clock.now() },
        fetch: fetchImpl || defaultFetch,
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
        addEventListener(eventName, handler) {
            if (!eventListeners.has(eventName)) {
                eventListeners.set(eventName, []);
            }
            eventListeners.get(eventName).push(handler);
        },
        dispatchEvent(event) {
            const handlers = eventListeners.get(event?.type || '') || [];
            handlers.forEach(handler => handler({
                preventDefault() {},
                stopPropagation() {},
                target: event?.target || null,
                currentTarget: this,
                ...event,
            }));
        },
        document: {
            addEventListener(eventName, handler) {
                if (!eventListeners.has(eventName)) {
                    eventListeners.set(eventName, []);
                }
                eventListeners.get(eventName).push(handler);
            },
            dispatchEvent(event) {
                const handlers = eventListeners.get(event?.type || '') || [];
                handlers.forEach(handler => handler({
                    preventDefault() {},
                    stopPropagation() {},
                    target: event?.target || null,
                    currentTarget: this,
                    ...event,
                }));
            },
            getElementById(id) {
                if (elementCache.has(id)) {
                    return elementCache.get(id);
                }
                const mapping = {
                    idleTimeoutBanner: idleBanner,
                    idleTimeoutMessage: idleMessage,
                    idleTimeoutCountdown: idleCountdown,
                    idleStaySignedInBtn: staySignedInBtn,
                    toastContainer: createElement('div'),
                    authDisplayName: createElement('span'),
                    authRole: createElement('span'),
                    authLogoutBtn: createElement('button'),
                    loginForm: createElement('form'),
                    loginUsername: createElement('input'),
                    loginPassword: createElement('input'),
                    loginError: createElement('p'),
                    loginSubmit: createElement('button'),
                };
                const element = mapping[id] || createElement('div');
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
            createElement,
            body: {
                appendChild() {},
            },
        },
        window: null,
        globalThis: null,
        self: null,
    };

    context.window = context;
    context.globalThis = context;
    context.self = context;
    context.window.addEventListener = context.addEventListener;
    context.window.dispatchEvent = context.dispatchEvent;

    vm.runInNewContext(appJsSource, context, { filename: appJsPath });

    const stubbedFunctions = [
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
        'loadStations',
        'refreshAll',
    ];
    stubbedFunctions.forEach(name => {
        if (typeof context[name] === 'function') {
            context[name] = async () => {};
        }
    });

    if (context.WS && typeof context.WS.connect === 'function') {
        context.WS.connect = () => {};
    }

    context.StudioManager = {
        init: async () => {},
        destroy: () => {},
    };
    context.SoundBoardManager = {
        init: async () => {},
        destroy: () => {},
    };
    context.MicManager = {
        init: async () => {},
        destroy: () => {},
    };

    return {
        context,
        clock,
        storage,
        location,
        logoutCalls,
        async triggerDOMContentLoaded() {
            const handlers = eventListeners.get('DOMContentLoaded') || [];
            for (const handler of handlers) {
                await handler();
            }
        },
        installLogoutSpy() {
            if (!context.Auth) return;
            context.Auth.logout = async () => {
                logoutCalls.push(clock.now());
            };
        },
    };
}

function getManagerState(context) {
    assert.ok(context.IdleSessionManager, 'expected IdleSessionManager to be exposed');
    assert.equal(typeof context.IdleSessionManager.getState, 'function', 'IdleSessionManager.getState should exist');
    return context.IdleSessionManager.getState();
}

test('idle tracking starts only in authenticated app mode', async () => {
    const appContext = createContext({ pathname: '/app', search: '?station_id=7' });
    appContext.storage.setItem('cleanroom_auth_access_token', 'test-access-token');
    await appContext.triggerDOMContentLoaded();

    const appState = getManagerState(appContext.context);
    assert.equal(appState.enabled, true);
    assert.equal(appState.active, true);

    const publicContext = createContext({ pathname: '/' });
    await publicContext.triggerDOMContentLoaded();

    const publicState = getManagerState(publicContext.context);
    assert.equal(publicState.enabled, false);
    assert.equal(publicState.active, false);
});

test('idle manager treats /app/ the same as /app when initialized without an explicit flag', () => {
    const { context } = createContext({ pathname: '/app/' });

    const state = context.IdleSessionManager.init();

    assert.equal(state.enabled, true);
    assert.equal(state.active, true);
});

test('activity resets the timeout window and warning UI appears during the final 60 seconds', async () => {
    const { context, clock, storage, triggerDOMContentLoaded } = createContext({ pathname: '/app' });
    storage.setItem('cleanroom_auth_access_token', 'test-access-token');
    await triggerDOMContentLoaded();

    const initialState = getManagerState(context);
    assert.equal(initialState.warningVisible, false);

    clock.advance(14 * 60 * 1000 + 1000);

    const warningState = getManagerState(context);
    assert.equal(warningState.warningVisible, true);
    assert.ok(warningState.remainingMs <= 60000);

    const banner = context.document.getElementById('idleTimeoutBanner');
    assert.equal(banner.hidden, false);

    const beforeReset = warningState.expiresAt;
    context.document.dispatchEvent({ type: 'pointerdown' });

    const resetState = getManagerState(context);
    assert.equal(resetState.warningVisible, false);
    assert.ok(resetState.expiresAt > beforeReset);
    assert.ok(resetState.remainingMs > 14 * 60 * 1000);
});

test('clicking stay signed in resets the timer', async () => {
    const { context, clock, storage, triggerDOMContentLoaded, logoutCalls, installLogoutSpy } = createContext({ pathname: '/app' });
    storage.setItem('cleanroom_auth_access_token', 'test-access-token');
    await triggerDOMContentLoaded();
    installLogoutSpy();

    clock.advance(14 * 60 * 1000 + 1000);
    assert.equal(getManagerState(context).warningVisible, true);

    const button = context.document.getElementById('idleStaySignedInBtn');
    await button.click();

    const state = getManagerState(context);
    assert.equal(state.warningVisible, false);
    assert.ok(state.remainingMs > 14 * 60 * 1000);

    clock.advance(60 * 1000);
    assert.equal(logoutCalls.length, 0);
});

test('logout fires only after true inactivity', async () => {
    const { context, clock, storage, triggerDOMContentLoaded, logoutCalls, installLogoutSpy } = createContext({ pathname: '/app' });
    storage.setItem('cleanroom_auth_access_token', 'test-access-token');
    await triggerDOMContentLoaded();
    assert.equal(typeof context.Auth.logout, 'function');
    installLogoutSpy();

    clock.advance(14 * 60 * 1000 + 1);
    assert.equal(logoutCalls.length, 0);

    clock.advance(59 * 1000);
    assert.equal(logoutCalls.length, 0);

    clock.advance(1 * 1000);
    assert.equal(logoutCalls.length, 1);
});

test('public lobby does not start the idle timer', async () => {
    const { context, triggerDOMContentLoaded } = createContext({ pathname: '/' });
    await triggerDOMContentLoaded();

    const state = getManagerState(context);
    assert.equal(state.enabled, false);
    assert.equal(state.active, false);
    assert.equal(state.warningVisible, false);
});
