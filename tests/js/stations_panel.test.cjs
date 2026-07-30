const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(root, 'app', 'static', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app', 'static', 'js', 'app.js'), 'utf8');

function createClassList(initial = []) {
    const values = new Set(initial.map(token => String(token)));
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
            const value = String(token);
            if (force === true) {
                values.add(value);
                return true;
            }
            if (force === false) {
                values.delete(value);
                return false;
            }
            if (values.has(value)) {
                values.delete(value);
                return false;
            }
            values.add(value);
            return true;
        },
    };
}

function createElement({ id = '', value = '', dataset = {}, classes = [] } = {}) {
    return {
        id,
        value,
        dataset: { ...dataset },
        hidden: false,
        disabled: false,
        checked: false,
        style: {},
        textContent: '',
        innerHTML: '',
        classList: createClassList(classes),
        addEventListener() {},
        setAttribute(name, nextValue) {
            this[name] = nextValue;
        },
        appendChild() {},
        querySelectorAll() {
            return Array.isArray(this.querySelectorAllResult) ? this.querySelectorAllResult : [];
        },
    };
}

function createContext({ fetchImpl } = {}) {
    const storage = new Map();
    storage.set('cleanroom_auth_user', JSON.stringify({
        id: 1,
        username: 'station-admin',
        display_name: 'Station Admin',
        role: 'viewer',
        effective_permissions: ['stations.view', 'stations.create', 'stations.edit', 'stations.delete'],
    }));
    const stationsAdminList = createElement({ id: 'stationsAdminList' });
    const adminStationName = createElement({ id: 'adminStationName' });
    const stationSelector = createElement({ id: 'stationSelector', value: '1' });
    const programAssignmentStationSelect = createElement({ id: 'programAssignmentStationSelect', value: '1' });

    const context = {
        console,
        setTimeout() { return 1; },
        clearTimeout() {},
        setInterval() { return 1; },
        clearInterval() {},
        requestAnimationFrame() { return 1; },
        cancelAnimationFrame() {},
        performance: { now: () => 0 },
        fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({}) })),
        location: {
            pathname: '/',
            search: '',
            hash: '',
            protocol: 'http:',
            host: 'example.test',
            origin: 'http://example.test',
            href: 'http://example.test/',
            assign() {},
            replace() {},
        },
        localStorage: {
            getItem(key) {
                return storage.has(String(key)) ? storage.get(String(key)) : null;
            },
            setItem(key, value) {
                storage.set(String(key), String(value));
            },
            removeItem(key) {
                storage.delete(String(key));
            },
            clear() {
                storage.clear();
            },
        },
        navigator: { userAgent: 'node-test' },
        AbortController,
        URL,
        URLSearchParams,
        FormData: class FormData {},
        Blob: class Blob {},
        File: class File {},
        confirm: () => true,
        alert: () => {},
        document: {
            addEventListener() {},
            getElementById(id) {
                return {
                    stationsAdminList,
                    adminStationName,
                    stationSelector,
                    programAssignmentStationSelect,
                }[id] || null;
            },
            querySelectorAll() {
                return [];
            },
            querySelector() {
                return null;
            },
            createElement() {
                return createElement();
            },
            body: {
                appendChild() {},
            },
        },
    };

    context.window = context;
    context.globalThis = context;
    context.self = context;
    vm.runInNewContext(appJs, context, { filename: path.join(root, 'app', 'static', 'js', 'app.js') });
    context.renderStationSelector = () => {};
    context.renderProgramAssignmentStationOptions = () => {};
    context.applyLibraryScopeUi = () => {};
    context.refreshActiveBroadcastStation = async () => null;
    context.showToast = () => {};

    return {
        context,
        stationsAdminList,
        adminStationName,
        stationSelector,
        programAssignmentStationSelect,
    };
}

test('stations panel shell exposes list and create controls', () => {
    assert.match(indexHtml, /data-subpage="stations"/);
    assert.match(indexHtml, /id="stationsAdminList"/);
    assert.match(indexHtml, /id="adminStationName"/);
    assert.match(appJs, /function loadStationsAdminPanel/);
    assert.match(appJs, /function createAdminStation/);
    assert.match(appJs, /function deleteAdminStation/);
});

test('loadStationsAdminPanel renders station rows and active badge', async () => {
    const { context, stationsAdminList } = createContext({
        fetchImpl: async (url) => {
            if (String(url).includes('/api/stations/active')) {
                return { ok: true, json: async () => ({ station_id: 2 }) };
            }
            if (String(url).includes('/api/stations')) {
                return {
                    ok: true,
                    json: async () => ({
                        stations: [
                            { id: 1, name: 'Main Radio', slug: 'main-radio' },
                            { id: 2, name: 'Talk FM', slug: 'talk-fm' },
                        ],
                    }),
                };
            }
            return { ok: false, status: 404, json: async () => ({}) };
        },
    });

    await context.loadStationsAdminPanel(true);

    assert.match(stationsAdminList.innerHTML, /Main Radio/);
    assert.match(stationsAdminList.innerHTML, /Talk FM/);
    assert.match(stationsAdminList.innerHTML, /Active/);
    assert.match(stationsAdminList.innerHTML, /data-action="set-active-station"/);
    assert.match(stationsAdminList.innerHTML, /data-action="delete-station"/);
});

test('delete action is disabled when only one station remains', async () => {
    const { context, stationsAdminList } = createContext({
        fetchImpl: async (url) => {
            if (String(url).includes('/api/stations/active')) {
                return { ok: true, json: async () => ({ station_id: 1 }) };
            }
            if (String(url).includes('/api/stations')) {
                return {
                    ok: true,
                    json: async () => ({
                        stations: [{ id: 1, name: 'Main Radio', slug: 'main-radio' }],
                    }),
                };
            }
            return { ok: false, status: 404, json: async () => ({}) };
        },
    });

    await context.loadStationsAdminPanel(true);

    assert.match(stationsAdminList.innerHTML, /data-action="delete-station"[^>]*disabled/);
});

test('create and delete handlers call station endpoints and reload the panel', async () => {
    const calls = [];
    let phase = 0;
    const { context, stationsAdminList, adminStationName } = createContext({
        fetchImpl: async (url, options = {}) => {
            calls.push({ url: String(url), options });
            if (String(url).includes('/api/stations/active')) {
                return { ok: true, json: async () => ({ station_id: 1 }) };
            }
            if (String(url).endsWith('/api/stations') && (!options.method || options.method === 'GET')) {
                if (phase === 0) {
                    return { ok: true, json: async () => ({ stations: [{ id: 1, name: 'Main Radio', slug: 'main-radio' }] }) };
                }
                if (phase === 1) {
                    return {
                        ok: true,
                        json: async () => ({
                            stations: [
                                { id: 1, name: 'Main Radio', slug: 'main-radio' },
                                { id: 2, name: 'Second Station', slug: 'second-station' },
                            ],
                        }),
                    };
                }
                return { ok: true, json: async () => ({ stations: [{ id: 1, name: 'Main Radio', slug: 'main-radio' }] }) };
            }
            if (String(url).endsWith('/api/stations') && options.method === 'POST') {
                phase = 1;
                return { ok: true, json: async () => ({ id: 2 }) };
            }
            if (String(url).includes('/api/stations/2') && options.method === 'DELETE') {
                phase = 2;
                return { ok: true, json: async () => ({ ok: true, deleted_station_id: 2, active_station_id: 1 }) };
            }
            return { ok: false, status: 404, json: async () => ({}) };
        },
    });

    await context.loadStationsAdminPanel(true);
    adminStationName.value = 'Second Station';

    await assert.doesNotReject(context.createAdminStation());
    assert.match(stationsAdminList.innerHTML, /Second Station/);

    await assert.doesNotReject(context.deleteAdminStation(2));
    assert.doesNotMatch(stationsAdminList.innerHTML, /Second Station/);

    const createCall = calls.find(call => call.url.endsWith('/api/stations') && call.options.method === 'POST');
    const deleteCall = calls.find(call => call.url.includes('/api/stations/2') && call.options.method === 'DELETE');
    assert.ok(createCall, 'expected create request');
    assert.ok(deleteCall, 'expected delete request');
});

test('loadStations does not inject a synthetic fallback station row', async () => {
    const { context } = createContext({
        fetchImpl: async (url) => {
            if (String(url).includes('/api/stations/active')) {
                return { ok: true, json: async () => ({ station_id: null }) };
            }
            if (String(url).includes('/api/stations')) {
                return { ok: true, json: async () => ({ stations: [] }) };
            }
            return { ok: false, status: 404, json: async () => ({}) };
        },
    });

    await context.loadStations();

    assert.deepEqual(context.currentState.stations, []);
    assert.equal(context.currentState.currentStationId, null);
});
