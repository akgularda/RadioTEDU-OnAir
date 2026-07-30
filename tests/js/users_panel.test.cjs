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

function createElement({ id = '', classes = [], hidden = false, disabled = false, value = '', dataset = {} } = {}) {
    return {
        id,
        hidden,
        disabled,
        value,
        dataset: { ...dataset },
        classList: createClassList(classes),
        style: {},
        textContent: '',
        innerHTML: '',
        selectedIndex: -1,
        options: [],
        addEventListener() {},
        remove() {},
        setAttribute(name, nextValue) {
            this[name] = nextValue;
        },
        appendChild() {},
        querySelectorAll() {
            return [];
        },
    };
}

function createMultiSelectElement({ id = '', options = [] } = {}) {
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
    const userList = createElement({ id: 'userList' });
    const userModal = createElement({ id: 'userModal' });
    const userForm = createElement({ id: 'userForm' });
    const userModalTitle = createElement({ id: 'userModalTitle' });
    const userId = createElement({ id: 'userId' });
    const userUsername = createElement({ id: 'userUsername' });
    const userDisplayName = createElement({ id: 'userDisplayName' });
    const userRole = createElement({ id: 'userRole' });
    const userPassword = createElement({ id: 'userPassword' });
    const userResetPassword = createElement({ id: 'userResetPassword' });
    const userActive = createElement({ id: 'userActive' });
    const userRoleTemplateSelect = createMultiSelectElement({ id: 'userRoleTemplateSelect' });
    const effectivePermissionsPreview = createElement({ id: 'effectivePermissionsPreview' });
    const userDraftPermissionsPreview = createElement({ id: 'userDraftPermissionsPreview' });
    const userSaveBtn = createElement({ id: 'userSaveBtn' });
    const userResetPasswordBtn = createElement({ id: 'userResetPasswordBtn' });

    const context = {
        console,
        setTimeout() { return 1; },
        clearTimeout() {},
        setInterval() { return 1; },
        clearInterval() {},
        requestAnimationFrame() { return 1; },
        cancelAnimationFrame() {},
        performance: { now: () => 0 },
        fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({ items: [] }) })),
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
                    userList,
                    userModal,
                    userForm,
                    userModalTitle,
                    userId,
                    userUsername,
                    userDisplayName,
                    userRole,
                    userPassword,
                    userResetPassword,
                    userActive,
                    userRoleTemplateSelect,
                    effectivePermissionsPreview,
                    userDraftPermissionsPreview,
                    userSaveBtn,
                    userResetPasswordBtn,
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
        userList,
        userModal,
        userForm,
        userModalTitle,
        userId,
        userUsername,
        userDisplayName,
        userRole,
        userPassword,
        userResetPassword,
        userActive,
        userRoleTemplateSelect,
        effectivePermissionsPreview,
        userDraftPermissionsPreview,
        userSaveBtn,
        userResetPasswordBtn,
    };
}

test('users panel shell exposes the management list, modal, and actions', () => {
    assert.match(indexHtml, /data-subpage="users"/);
    assert.match(indexHtml, /id="userList"/);
    assert.match(indexHtml, /id="userModal"/);
    assert.match(indexHtml, /id="userRoleTemplateSelect"/);
    assert.match(indexHtml, /id="effectivePermissionsPreview"/);
    assert.match(indexHtml, /id="userDraftPermissionsPreview"/);
    assert.match(indexHtml, /id="userResetPasswordBtn"/);
    assert.doesNotMatch(indexHtml, /User administration will live here in a later task\./);

    assert.match(appJs, /\/api\/users/);
    assert.match(appJs, /role_template_ids/);
    assert.match(appJs, /effective_permissions/);
});

test('loadUsers renders user cards with role assignments and effective permissions previews', async () => {
    const roleTemplates = [
        { id: 1, name: 'Legacy Admin' },
        { id: 2, name: 'Legacy DJ' },
        { id: 3, name: 'Legacy Producer' },
    ];
    const fetchCalls = [];
    const { context, userList, userModal, userRoleTemplateSelect, effectivePermissionsPreview, userResetPasswordBtn } = createContext({
        fetchImpl: async (url, options = {}) => {
            fetchCalls.push({ url, options });
            if (String(url).includes('/api/users')) {
                return {
                    ok: true,
                    json: async () => ({
                        items: [
                            {
                                id: 7,
                                username: 'alice',
                                display_name: 'Alice',
                                role: 'admin',
                                legacy_role: 'admin',
                                is_active: true,
                                role_template_ids: [1, 2],
                                effective_permissions: ['roles.manage', 'users.manage'],
                            },
                        ],
                    }),
                };
            }
            if (String(url).includes('/api/roles')) {
                return {
                    ok: true,
                    json: async () => ({ items: roleTemplates, permission_groups: {} }),
                };
            }
            return { ok: true, json: async () => ({}) };
        },
    });

    context.currentState.roleTemplates = roleTemplates;

    await assert.doesNotReject(context.loadUsers());
    assert.match(userList.innerHTML, /Alice/);
    assert.match(userList.innerHTML, /Legacy Admin/);
    assert.match(userList.innerHTML, /roles\.manage/);
    assert.match(userList.innerHTML, /Reset Password/);

    context.openUserEditModal(7);
    assert.equal(userModal.style.display, 'flex');
    assert.match(userRoleTemplateSelect.innerHTML, /selected/);
    assert.match(effectivePermissionsPreview.innerHTML, /roles\.manage/);
    assert.equal(userResetPasswordBtn.hidden, false);
    assert.equal(userResetPasswordBtn.disabled, false);
    assert.ok(fetchCalls.some(call => String(call.url).includes('/api/users')));
});

test('initUserModalUi binds without reference errors', () => {
    const { context } = createContext();
    assert.doesNotThrow(() => context.initUserModalUi());
});

test('user modal uses live selection state, hides inactive templates, and updates the draft preview', async () => {
    const { context, userRoleTemplateSelect, userDraftPermissionsPreview } = createContext({
        fetchImpl: async (url) => {
            if (String(url).includes('/api/roles')) {
                return {
                    ok: true,
                    json: async () => ({
                        items: [
                            { id: 1, name: 'Legacy Admin', is_active: true, permission_keys: ['roles.manage'] },
                            { id: 2, name: 'Legacy DJ', is_active: true, permission_keys: ['queue.view'] },
                            { id: 3, name: 'Legacy Producer', is_active: false, permission_keys: ['stations.view'] },
                        ],
                        permission_groups: {},
                    }),
                };
            }
            if (String(url).includes('/api/users')) {
                return { ok: true, json: async () => ({ items: [] }) };
            }
            return { ok: true, json: async () => ({}) };
        },
    });

    context.currentState.roleTemplates = [
        { id: 1, name: 'Legacy Admin', is_active: true, permission_keys: ['roles.manage'] },
        { id: 2, name: 'Legacy DJ', is_active: true, permission_keys: ['queue.view'] },
        { id: 3, name: 'Legacy Producer', is_active: false, permission_keys: ['stations.view'] },
    ];

    context.openUserCreateModal();
    assert.doesNotMatch(userRoleTemplateSelect.innerHTML, /Legacy Producer/);

    userRoleTemplateSelect.options = [
        { value: '1', selected: true },
        { value: '2', selected: false },
    ];
    context.renderUserDraftPermissionsPreview();
    assert.match(userDraftPermissionsPreview.innerHTML, /roles\.manage/);
    assert.doesNotMatch(userDraftPermissionsPreview.innerHTML, /queue\.view/);

    userRoleTemplateSelect.options[0].selected = false;
    userRoleTemplateSelect.options[1].selected = true;
    context.renderUserDraftPermissionsPreview();
    assert.match(userDraftPermissionsPreview.innerHTML, /queue\.view/);
    assert.doesNotMatch(userDraftPermissionsPreview.innerHTML, /roles\.manage/);

    userRoleTemplateSelect.options[1].selected = false;
    context.renderUserDraftPermissionsPreview();
    assert.match(userDraftPermissionsPreview.innerHTML, /No role templates selected/i);
});

test('user save and password reset handlers are resilient to api failures', async () => {
    const calls = [];
    const { context } = createContext({
        fetchImpl: async (url, options = {}) => {
            calls.push({ url, options });
            if (String(url).includes('/api/users/')) {
                throw new Error('boom');
            }
            return { ok: true, json: async () => ({ items: [] }) };
        },
    });

    context.currentState.roleTemplates = [{ id: 1, name: 'Legacy Admin' }];
    context.openUserCreateModal();
    context.document.getElementById('userUsername').value = 'new.user';
    context.document.getElementById('userDisplayName').value = 'New User';
    context.document.getElementById('userPassword').value = 'password123';
    context.document.getElementById('userRole').value = 'admin';
    context.document.getElementById('userRoleTemplateSelect').innerHTML = '<option value="1" selected>Legacy Admin</option>';

    await assert.doesNotReject(context.saveUser());
    await assert.doesNotReject(context.resetUserPassword(7, 'changed-password'));
    assert.ok(calls.some(call => String(call.url).includes('/api/users')));
});
