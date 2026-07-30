const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(root, 'app', 'static', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app', 'static', 'js', 'app.js'), 'utf8');

function createElement({ id = '', classes = [], hidden = false, disabled = false, value = '', dataset = {} } = {}) {
    return {
        id,
        hidden,
        disabled,
        value,
        dataset: { ...dataset },
        classList: {
            _values: new Set(classes.map(token => String(token))),
            add(...tokens) {
                tokens.forEach(token => this._values.add(String(token)));
            },
            remove(...tokens) {
                tokens.forEach(token => this._values.delete(String(token)));
            },
            contains(token) {
                return this._values.has(String(token));
            },
            toggle(token, force) {
                const value = String(token);
                if (force === true) {
                    this._values.add(value);
                    return true;
                }
                if (force === false) {
                    this._values.delete(value);
                    return false;
                }
                if (this._values.has(value)) {
                    this._values.delete(value);
                    return false;
                }
                this._values.add(value);
                return true;
            },
        },
        style: {},
        textContent: '',
        innerHTML: '',
        addEventListener() {},
        remove() {},
        setAttribute(name, value) {
            this[name] = value;
        },
        appendChild() {},
        querySelectorAll() {
            return [];
        },
    };
}

function createContext({ fetchImpl } = {}) {
    const storage = new Map();
    const rolePermissionGroups = createElement({ id: 'rolePermissionGroups' });
    const roleTemplateList = createElement({ id: 'roleTemplateList' });
    const roleTemplateForm = createElement({ id: 'roleTemplateForm' });
    const roleTemplateId = createElement({ id: 'roleTemplateId' });
    const roleTemplateName = createElement({ id: 'roleTemplateName' });
    const roleTemplateDescription = createElement({ id: 'roleTemplateDescription' });
    const roleTemplateModalTitle = createElement({ id: 'roleTemplateModalTitle' });
    const roleTemplateSaveBtn = createElement({ id: 'roleTemplateSaveBtn' });
    const roleTemplateDeleteBtn = createElement({ id: 'roleTemplateDeleteBtn' });
    const roleTemplateModal = createElement({ id: 'roleTemplateModal' });

    const context = {
        console,
        setTimeout() { return 1; },
        clearTimeout() {},
        setInterval() { return 1; },
        clearInterval() {},
        requestAnimationFrame() { return 1; },
        cancelAnimationFrame() {},
        performance: { now: () => 0 },
        fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({ items: [], permission_groups: {} }) })),
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
                    rolePermissionGroups,
                    roleTemplateList,
                    roleTemplateForm,
                    roleTemplateId,
                    roleTemplateName,
                    roleTemplateDescription,
                    roleTemplateModalTitle,
                    roleTemplateSaveBtn,
                    roleTemplateDeleteBtn,
                    roleTemplateModal,
                }[id] || null;
            },
            querySelectorAll() { return []; },
            querySelector() { return null; },
            createElement() { return createElement(); },
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
        rolePermissionGroups,
        roleTemplateList,
        roleTemplateForm,
        roleTemplateId,
        roleTemplateName,
        roleTemplateDescription,
        roleTemplateModalTitle,
        roleTemplateSaveBtn,
        roleTemplateDeleteBtn,
        roleTemplateModal,
    };
}

test('roles panel shell includes the checklist containers and render markers', () => {
    assert.match(indexHtml, /data-subpage="roles"/);
    assert.match(indexHtml, /id="roleTemplateList"/);
    assert.match(indexHtml, /id="roleTemplateForm"/);
    assert.match(indexHtml, /id="rolePermissionGroups"/);
    assert.doesNotMatch(indexHtml, /rolePermissionCatalog/);
    assert.doesNotMatch(indexHtml, /stations\.create/);

    assert.match(appJs, /permission_groups/);
    assert.match(appJs, /currentState\.rolePermissionGroups/);
});

test('renderRolePermissionGroups builds grouped checklist markup from the backend catalog', () => {
    const { context, rolePermissionGroups } = createContext();
    context.currentState.rolePermissionGroups = {
        stations: ['stations.view', 'stations.create'],
        logs: ['logs.view'],
    };

    context.renderRolePermissionGroups(['stations.create']);

    assert.match(rolePermissionGroups.innerHTML, /class="role-permission-group"/);
    assert.match(rolePermissionGroups.innerHTML, /class="role-permission-check"/);
    assert.match(rolePermissionGroups.innerHTML, /data-permission-group="stations"/);
    assert.match(rolePermissionGroups.innerHTML, /data-permission-key="stations\.create"[^>]*checked/);
    assert.match(rolePermissionGroups.innerHTML, /data-permission-key="logs\.view"/);
});

test('system role templates render read-only controls and no edit affordance', () => {
    const { context, roleTemplateList, rolePermissionGroups, roleTemplateName, roleTemplateDescription, roleTemplateSaveBtn, roleTemplateDeleteBtn } = createContext();
    const systemRole = {
        id: 1,
        name: 'Legacy Admin',
        description: 'Built-in administrator role',
        is_system: true,
        is_active: true,
        permission_keys: ['roles.manage'],
    };
    const normalRole = {
        id: 2,
        name: 'Queue Team',
        description: 'Queue operators',
        is_system: false,
        is_active: true,
        permission_keys: ['queue.view'],
    };

    context.currentState.roleTemplates = [systemRole, normalRole];
    context.currentState.rolePermissionGroups = {
        roles: ['roles.manage'],
    };

    context.renderRoleTemplatesList();
    assert.doesNotMatch(roleTemplateList.innerHTML, /openRoleTemplateEditModal\(1\)/);
    assert.match(roleTemplateList.innerHTML, /openRoleTemplateEditModal\(2\)/);
    assert.match(roleTemplateList.innerHTML, /System/);

    context.syncRoleTemplateForm(systemRole);
    assert.equal(roleTemplateName.disabled, true);
    assert.equal(roleTemplateDescription.disabled, true);
    assert.equal(roleTemplateSaveBtn.disabled, true);
    assert.equal(roleTemplateDeleteBtn.hidden, true);
    assert.match(rolePermissionGroups.innerHTML, /disabled/);
});

test('role actions swallow api failures instead of rejecting', async () => {
    const { context, roleTemplateName, roleTemplateDescription, roleTemplateId, roleTemplateList } = createContext({
        fetchImpl: async () => {
            throw new Error('boom');
        },
    });

    context.currentState.rolePermissionGroups = {
        roles: ['roles.manage'],
    };

    roleTemplateName.value = 'New Role';
    roleTemplateDescription.value = 'Testing';
    roleTemplateId.value = '';

    await assert.doesNotReject(context.loadRoleTemplates());
    assert.match(roleTemplateList.innerHTML, /could not be loaded/i);

    const saved = await context.saveRoleTemplate();
    assert.equal(saved, null);

    const deleted = await context.deleteRoleTemplate(99);
    assert.equal(deleted, null);
});
