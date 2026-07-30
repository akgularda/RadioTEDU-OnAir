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
        style: {},
        textContent: '',
        innerHTML: '',
        classList: createClassList(classes),
        options: [],
        selectedIndex: -1,
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

function createSelectElement({ id = '', options = [] } = {}) {
    const element = createElement({ id });
    element.options = options;
    Object.defineProperty(element, 'selectedOptions', {
        get() {
            return element.options.filter(option => !!option.selected);
        },
    });
    return element;
}

function createContext({ fetchImpl } = {}) {
    const storage = new Map();
    const stationSelector = createSelectElement({ id: 'stationSelector' });
    const programAssignmentStationSelect = createSelectElement({ id: 'programAssignmentStationSelect' });
    const programAssignmentShowSelect = createSelectElement({ id: 'programAssignmentShowSelect' });
    const programAssignmentUserSelect = createSelectElement({ id: 'programAssignmentUserSelect' });
    const programAssignmentRoleSelect = createSelectElement({
        id: 'programAssignmentRoleSelect',
        options: [
            { value: 'dj', selected: true },
            { value: 'producer', selected: false },
        ],
    });
    const programAssignmentCapabilityList = createElement({ id: 'programAssignmentCapabilityList' });
    const programAssignmentList = createElement({ id: 'programAssignmentList' });
    const programAssignmentSaveBtn = createElement({ id: 'programAssignmentSaveBtn' });

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
                    stationSelector,
                    programAssignmentStationSelect,
                    programAssignmentShowSelect,
                    programAssignmentUserSelect,
                    programAssignmentRoleSelect,
                    programAssignmentCapabilityList,
                    programAssignmentList,
                    programAssignmentSaveBtn,
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

    return {
        context,
        stationSelector,
        programAssignmentStationSelect,
        programAssignmentShowSelect,
        programAssignmentUserSelect,
        programAssignmentRoleSelect,
        programAssignmentCapabilityList,
        programAssignmentList,
        programAssignmentSaveBtn,
    };
}

test('program assignments panel shell includes the station, show, user, and capability controls', () => {
    assert.match(indexHtml, /data-subpage="program-assignments"/);
    assert.match(indexHtml, /id="programAssignmentStationSelect"/);
    assert.match(indexHtml, /id="programAssignmentShowSelect"/);
    assert.match(indexHtml, /id="programAssignmentUserSelect"/);
    assert.match(indexHtml, /id="programAssignmentCapabilityList"/);
    assert.match(indexHtml, /id="programAssignmentList"/);
    assert.match(indexHtml, /id="programAssignmentSaveBtn"/);
    assert.doesNotMatch(indexHtml, /Program assignment management will be added in a later task\./);
    assert.match(appJs, /function renderProgramAssignmentCapabilities/);
    assert.match(appJs, /show\.broadcast/);
    assert.match(appJs, /show\.queue_edit/);
    assert.match(appJs, /show\.jingle_manage/);
});

test('renderProgramAssignmentCapabilities renders the show capability toggle list', () => {
    const { context, programAssignmentCapabilityList } = createContext();

    context.renderProgramAssignmentCapabilities(['show.broadcast', 'show.jingle_manage']);

    assert.match(programAssignmentCapabilityList.innerHTML, /class="program-assignment-capability"/);
    assert.match(programAssignmentCapabilityList.innerHTML, /data-permission-key="show\.broadcast"[^>]*checked/);
    assert.match(programAssignmentCapabilityList.innerHTML, /data-permission-key="show\.queue_edit"/);
    assert.match(programAssignmentCapabilityList.innerHTML, /data-permission-key="show\.jingle_manage"[^>]*checked/);
});

test('selecting an unassigned user preserves selection and allows a new assignment save', async () => {
    const calls = [];
    const { context, programAssignmentShowSelect, programAssignmentUserSelect, programAssignmentRoleSelect, programAssignmentCapabilityList } = createContext({
        fetchImpl: async (url, options = {}) => {
            calls.push({ url, options });
            if (String(url).includes('/api/shows/11/assign')) {
                return { ok: true, json: async () => ({ ok: true, assignments: [] }) };
            }
            return { ok: true, json: async () => ({ items: [] }) };
        },
    });

    programAssignmentShowSelect.value = '11';
    context.currentState.programAssignments = {
        stationId: 2,
        showId: 11,
        assignmentUserId: null,
        assignmentRole: 'dj',
        permissionKeys: [],
        shows: [{ id: 11, station_id: 2, name: 'Morning Drive', is_active: true }],
        assignments: [],
        users: [
            { id: 7, username: 'sara', display_name: 'Sara', role: 'host', is_active: true },
        ],
    };

    context.selectProgramAssignment(7);

    assert.equal(programAssignmentUserSelect.value, '7');
    assert.equal(programAssignmentRoleSelect.value, 'dj');

    programAssignmentRoleSelect.value = 'producer';
    programAssignmentCapabilityList.querySelectorAllResult = [
        { dataset: { permissionKey: 'show.broadcast' }, checked: true },
        { dataset: { permissionKey: 'show.queue_edit' }, checked: true },
        { dataset: { permissionKey: 'show.jingle_manage' }, checked: false },
    ];

    await assert.doesNotReject(context.saveProgramAssignment());

    const saveCall = calls.find(call => String(call.url).includes('/api/shows/11/assign'));
    assert.ok(saveCall, 'expected assign request to be sent');
    assert.equal(saveCall.options.method, 'POST');
    assert.deepEqual(JSON.parse(saveCall.options.body), {
        user_id: 7,
        role: 'producer',
        permission_keys: ['show.broadcast', 'show.queue_edit'],
    });
});

test('loadProgramAssignmentsPanel tracks the current station after a global station change', async () => {
    const calls = [];
    const { context, stationSelector, programAssignmentShowSelect, programAssignmentUserSelect } = createContext({
        fetchImpl: async (url) => {
            const href = String(url);
            calls.push(href);
            if (href.includes('/api/shows/?station_id=5')) {
                return {
                    ok: true,
                    json: async () => ([
                        { id: 41, station_id: 5, name: 'Drive Time', is_active: true },
                    ]),
                };
            }
            if (href.includes('/api/shows/41/assignments')) {
                return {
                    ok: true,
                    json: async () => ([
                        { user_id: 9, username: 'maria', display_name: 'Maria', role: 'producer', permission_keys: ['show.broadcast'] },
                    ]),
                };
            }
            if (href.includes('/api/shows/?station_id=6')) {
                return {
                    ok: true,
                    json: async () => ([
                        { id: 61, station_id: 6, name: 'Night Shift', is_active: true },
                    ]),
                };
            }
            if (href.includes('/api/shows/61/assignments')) {
                return {
                    ok: true,
                    json: async () => ([]),
                };
            }
            if (href.includes('/api/shows/41/assignment-candidates')) {
                return {
                    ok: true,
                    json: async () => ({
                        items: [
                            { id: 9, username: 'maria', display_name: 'Maria', role: 'producer', is_active: true },
                            { id: 10, username: 'noah', display_name: 'Noah', role: 'host', is_active: true },
                        ],
                    }),
                };
            }
            return { ok: true, json: async () => ({ items: [] }) };
        },
    });

    context.currentState.panel = 'admin-access';
    context.currentState.subpages['admin-access'] = 'program-assignments';
    context.currentState.currentStationId = 2;
    context.currentState.programAssignments.stationId = 2;
    context.currentState.programAssignments.showId = 41;
    context.currentState.programAssignments.assignmentUserId = 7;
    context.currentState.stations = [
        { id: 2, name: 'Station Two' },
        { id: 5, name: 'Station Five' },
        { id: 6, name: 'Station Six' },
    ];
    stationSelector.value = '5';

    context.refreshActiveBroadcastStation = async () => null;
    context.refreshStudioWorkspace = async () => {};
    context.applyLibraryScopeUi = () => {};
    context.syncStationTargetSelectors = () => {};
    context.refreshAll = () => {};
    context.showToast = () => {};
    context.WS = { connect() {} };
    context.loadControlSettings = () => {};

    await assert.doesNotReject(context.changeStation());

    assert.equal(context.currentState.currentStationId, 5);
    assert.equal(context.currentState.programAssignments.stationId, 5);
    assert.equal(context.currentState.programAssignments.assignmentUserId, 9);
    assert.equal(programAssignmentShowSelect.value, '41');
    assert.equal(programAssignmentUserSelect.value, '9');
    assert.match(calls.join('\n'), /\/api\/shows\/\?station_id=5/);
    assert.match(calls.join('\n'), /\/api\/shows\/41\/assignment-candidates/);
    assert.doesNotMatch(calls.join('\n'), /\/api\/users/);

    stationSelector.value = '6';
    await assert.doesNotReject(context.changeStation());

    assert.equal(context.currentState.currentStationId, 6);
    assert.equal(context.currentState.programAssignments.stationId, 6);
    assert.equal(context.currentState.programAssignments.assignmentUserId, null);
    assert.equal(programAssignmentShowSelect.value, '61');
    assert.equal(programAssignmentUserSelect.value, '');
    assert.match(calls.join('\n'), /\/api\/shows\/\?station_id=6/);
});

test('failed program assignment reload clears the editor and blocks stale saves', async () => {
    const calls = [];
    const { context, stationSelector, programAssignmentShowSelect, programAssignmentUserSelect, programAssignmentRoleSelect, programAssignmentCapabilityList, programAssignmentSaveBtn } = createContext({
        fetchImpl: async (url, options = {}) => {
            const href = String(url);
            calls.push({ url: href, options });
            if (href.includes('/api/shows/?station_id=7')) {
                throw new Error('station reload failed');
            }
            return { ok: true, json: async () => ({ items: [] }) };
        },
    });

    context.currentState.panel = 'admin-access';
    context.currentState.subpages['admin-access'] = 'program-assignments';
    context.currentState.currentStationId = 7;
    context.currentState.programAssignments.stationId = 7;
    context.currentState.programAssignments.showId = 41;
    context.currentState.programAssignments.assignmentUserId = 9;
    context.currentState.programAssignments.assignmentRole = 'producer';
    context.currentState.programAssignments.permissionKeys = ['show.broadcast'];
    context.currentState.programAssignments.shows = [
        { id: 41, station_id: 7, name: 'Legacy Show', is_active: true },
    ];
    context.currentState.programAssignments.assignments = [
        { user_id: 9, username: 'maria', display_name: 'Maria', role: 'producer', permission_keys: ['show.broadcast'] },
    ];
    context.currentState.programAssignments.users = [
        { id: 9, username: 'maria', display_name: 'Maria', role: 'producer', is_active: true },
    ];
    stationSelector.value = '7';
    programAssignmentShowSelect.value = '41';
    programAssignmentUserSelect.value = '9';
    programAssignmentRoleSelect.value = 'producer';
    programAssignmentCapabilityList.querySelectorAllResult = [
        { dataset: { permissionKey: 'show.broadcast' }, checked: true },
    ];

    context.refreshActiveBroadcastStation = async () => null;
    context.refreshStudioWorkspace = async () => {};
    context.applyLibraryScopeUi = () => {};
    context.syncStationTargetSelectors = () => {};
    context.refreshAll = () => {};
    context.showToast = () => {};
    context.WS = { connect() {} };
    context.loadControlSettings = () => {};

    await assert.doesNotReject(context.loadProgramAssignmentsPanel(true));

    assert.equal(context.currentState.programAssignments.shows.length, 0);
    assert.equal(context.currentState.programAssignments.assignments.length, 0);
    assert.equal(context.currentState.programAssignments.assignmentUserId, null);
    assert.equal(programAssignmentShowSelect.value, '');
    assert.equal(programAssignmentUserSelect.value, '');
    assert.equal(programAssignmentSaveBtn.textContent, 'Save Assignment');
    assert.equal(programAssignmentRoleSelect.value, 'dj');

    programAssignmentShowSelect.value = '41';
    programAssignmentUserSelect.value = '9';
    programAssignmentRoleSelect.value = 'producer';
    programAssignmentCapabilityList.querySelectorAllResult = [
        { dataset: { permissionKey: 'show.broadcast' }, checked: true },
    ];

    await assert.doesNotReject(context.saveProgramAssignment());

    const posts = calls.filter(call => call.options.method === 'POST');
    assert.equal(posts.length, 0);
});

test('active non-dj users remain available in the program assignment picker', async () => {
    const calls = [];
    const { context, programAssignmentUserSelect } = createContext({
        fetchImpl: async (url) => {
            const href = String(url);
            calls.push(href);
            if (href.includes('/api/shows/41/assignment-candidates')) {
                return {
                    ok: true,
                    json: async () => ({
                        items: [
                            { id: 1, username: 'alice', display_name: 'Alice', role: 'dj', is_active: true },
                            { id: 2, username: 'brad', display_name: 'Brad', role: 'host', is_active: true },
                            { id: 3, username: 'carol', display_name: 'Carol', role: 'producer', is_active: false },
                        ],
                    }),
                };
            }
            return { ok: true, json: async () => ({ items: [] }) };
        },
    });

    context.currentState.programAssignments.showId = 41;
    await assert.doesNotReject(context.loadProgramAssignmentUsers(true));

    assert.match(programAssignmentUserSelect.innerHTML, /Alice/);
    assert.match(programAssignmentUserSelect.innerHTML, /Brad/);
    assert.doesNotMatch(programAssignmentUserSelect.innerHTML, /Carol/);
    assert.match(calls.join('\n'), /\/api\/shows\/41\/assignment-candidates/);
    assert.doesNotMatch(calls.join('\n'), /\/api\/users/);
});
