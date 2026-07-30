const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appJsPath = path.resolve(__dirname, '..', '..', 'app', 'static', 'js', 'app.js');
const appJsSource = fs.readFileSync(appJsPath, 'utf8');
const indexHtmlPath = path.resolve(__dirname, '..', '..', 'app', 'static', 'index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

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

function createClassList(initial = []) {
    const values = new Set(initial);
    return {
        add(...tokens) {
            tokens.forEach(token => values.add(String(token)));
        },
        remove(...tokens) {
            tokens.forEach(token => values.delete(String(token)));
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
        contains(token) {
            return values.has(String(token));
        },
        toString() {
            return Array.from(values).join(' ');
        },
    };
}

function createElement({ id = '', classes = [], hidden = false, disabled = false, dataset = {} } = {}) {
    return {
        id,
        hidden,
        disabled,
        dataset: { ...dataset },
        classList: createClassList(classes),
        style: {},
        textContent: '',
        innerHTML: '',
        addEventListener() {},
        remove() {},
        setAttribute(name, value) {
            this[name] = value;
        },
        appendChild() {},
    };
}

function createContext(user) {
    const storage = createStorage();
    if (user) {
        storage.setItem('cleanroom_auth_user', JSON.stringify(user));
    }
    let timerId = 0;
    const noopTimer = () => {
        timerId += 1;
        return timerId;
    };

    const adminNavBtn = createElement({ classes: ['nav-btn'], dataset: { panel: 'admin-access' } });
    const onAirNavBtn = createElement({ classes: ['nav-btn', 'active'], dataset: { panel: 'onair' } });
    const adminPanel = createElement({ id: 'panel-admin-access', classes: ['panel', 'panel-clean'] });
    const onAirPanel = createElement({ id: 'panel-onair', classes: ['panel', 'active'] });
    const micPanel = createElement({ id: 'micPanel' });
    const authDisplayName = createElement({ id: 'authDisplayName' });
    const authRole = createElement({ id: 'authRole' });
    const adminUsersTab = createElement({ classes: ['subpage-tab', 'active'], dataset: { subpage: 'users' } });
    const adminRolesTab = createElement({ classes: ['subpage-tab'], dataset: { subpage: 'roles' } });
    const adminProgramsTab = createElement({ classes: ['subpage-tab'], dataset: { subpage: 'program-assignments' } });
    const adminStationsTab = createElement({ classes: ['subpage-tab'], dataset: { subpage: 'stations' } });
    const adminUsersView = createElement({ classes: ['subpage-view', 'active'], dataset: { group: 'admin-access', subpage: 'users' } });
    const adminRolesView = createElement({ classes: ['subpage-view'], dataset: { group: 'admin-access', subpage: 'roles' } });
    const adminProgramsView = createElement({ classes: ['subpage-view'], dataset: { group: 'admin-access', subpage: 'program-assignments' } });
    const adminStationsView = createElement({ classes: ['subpage-view'], dataset: { group: 'admin-access', subpage: 'stations' } });

    const byId = new Map([
        ['authDisplayName', authDisplayName],
        ['authRole', authRole],
        ['micPanel', micPanel],
        ['panel-admin-access', adminPanel],
        ['panel-onair', onAirPanel],
    ]);

    const querySelectorAll = (selector) => {
        if (selector === '.nav-btn') {
            return [onAirNavBtn, adminNavBtn];
        }
        if (selector === '.panel') {
            return [onAirPanel, adminPanel];
        }
        if (selector === '.subpage-tabs[data-group="admin-access"] .subpage-tab') {
            return [adminUsersTab, adminRolesTab, adminProgramsTab, adminStationsTab];
        }
        if (selector === '.subpage-view[data-group="admin-access"]') {
            return [adminUsersView, adminRolesView, adminProgramsView, adminStationsView];
        }
        if (selector === '.subpage-tabs[data-group="library"] .subpage-tab') {
            return [];
        }
        if (selector === '.subpage-tabs[data-group="downloads"] .subpage-tab') {
            return [];
        }
        if (selector === '.subpage-tabs[data-group="ads"] .subpage-tab') {
            return [];
        }
        return [];
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
        performance: { now: () => 0 },
        fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
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
        document: {
            addEventListener() {},
            getElementById(id) {
                return byId.get(id) || null;
            },
            querySelectorAll,
            querySelector(selector) {
                return querySelectorAll(selector)[0] || null;
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
    vm.runInNewContext(appJsSource, context, { filename: appJsPath });

    return {
        context,
        adminNavBtn,
        adminPanel,
        adminUsersTab,
        adminRolesTab,
        adminProgramsTab,
        adminStationsTab,
        adminUsersView,
        adminRolesView,
        adminProgramsView,
        adminStationsView,
        storage,
    };
}

test('admin access shell is hidden without roles.manage and switchPanel blocks it', () => {
    const { context, adminNavBtn, adminPanel } = createContext({
        id: 22,
        username: 'viewer',
        display_name: 'Viewer',
        role: 'viewer',
        effective_permissions: [],
    });

    context.updateAuthUi();

    assert.equal(adminNavBtn.hidden, true);
    assert.equal(adminNavBtn.disabled, true);
    assert.equal(context.switchPanel('admin-access'), false);
        assert.equal(adminPanel.classList.contains('active'), false);
        assert.equal(context.currentState.panel, 'onair');
});

test('admin access roles subpage stays hidden for users.manage-only and falls back to users', () => {
    const { context, adminRolesTab, adminRolesView, adminUsersTab, adminUsersView, adminPanel } = createContext({
        id: 23,
        username: 'user-manager',
        display_name: 'User Manager',
        role: 'viewer',
        effective_permissions: ['users.manage'],
    });

    context.currentState.subpages['admin-access'] = 'roles';
    context.updateAuthUi();
    assert.equal(context.switchPanel('admin-access'), true);

    assert.equal(adminRolesTab.hidden, true);
    assert.equal(adminRolesTab.disabled, true);
    assert.equal(adminRolesView.hidden, true);
    assert.equal(adminUsersTab.hidden, false);
    assert.equal(adminUsersView.hidden, false);
    assert.equal(adminUsersTab.classList.contains('active'), true);
    assert.equal(adminUsersView.classList.contains('active'), true);
    assert.equal(context.currentState.subpages['admin-access'], 'users');
    assert.equal(adminPanel.classList.contains('active'), true);
});

test('admin access shell is available with admin-access permissions and selects its users subpage', () => {
    const { context, adminNavBtn, adminPanel, adminUsersTab, adminUsersView } = createContext({
        id: 1,
        username: 'user-admin',
        display_name: 'User Admin',
        role: 'viewer',
        effective_permissions: ['users.manage'],
    });

    context.updateAuthUi();

    assert.equal(adminNavBtn.hidden, false);
    assert.equal(adminNavBtn.disabled, false);
    assert.equal(context.switchPanel('admin-access'), true);
    assert.equal(adminPanel.classList.contains('active'), true);
    assert.equal(adminUsersTab.classList.contains('active'), true);
    assert.equal(adminUsersView.classList.contains('active'), true);
    assert.equal(context.currentState.panel, 'admin-access');
});

test('admin access shell includes a stations subpage in the markup', () => {
    assert.match(indexHtml, /data-subpage="stations"/);
    assert.match(indexHtml, />\s*Stations\s*</);
});

test('station permissions expose the admin stations subpage and fall back to it', () => {
    const { context, adminStationsTab, adminStationsView, adminUsersTab, adminUsersView } = createContext({
        id: 24,
        username: 'station-admin',
        display_name: 'Station Admin',
        role: 'viewer',
        effective_permissions: ['stations.view'],
    });

    context.currentState.subpages['admin-access'] = 'users';
    context.updateAuthUi();
    assert.equal(context.switchPanel('admin-access'), true);

    assert.equal(context.canAccessAdminAccessSubpage('stations'), true);
    assert.equal(adminStationsTab.hidden, false);
    assert.equal(adminStationsView.hidden, false);
    assert.equal(adminUsersTab.hidden, true);
    assert.equal(adminUsersView.hidden, true);
    assert.equal(adminStationsTab.classList.contains('active'), true);
    assert.equal(adminStationsView.classList.contains('active'), true);
    assert.equal(context.currentState.subpages['admin-access'], 'stations');
});
