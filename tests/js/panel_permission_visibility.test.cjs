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

function createContext(user = null) {
    const storage = createStorage();
    if (user) {
        storage.setItem('cleanroom_auth_user', JSON.stringify(user));
    }

    const context = {
        console,
        setTimeout() {
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
        performance: { now: () => 0 },
        fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
        location: {
            pathname: '/',
            protocol: 'http:',
            host: 'example.test',
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
                    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
                    appendChild() {},
                    setAttribute() {},
                    addEventListener() {},
                    remove() {},
                    style: {},
                    dataset: {},
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

test('panel visibility is permission-driven', () => {
    const context = createContext();
    const panels = context.computeVisiblePanels({
        effective_permissions: new Set(['program.panel.open', 'queue.view']),
    });

    assert.equal(panels.includes('program'), true);
    assert.equal(panels.includes('shows'), false);
    assert.equal(panels.includes('admin-access'), false);
});

test('program panel requires explicit permission', () => {
    const context = createContext();

    assert.equal(
        context.canOpenProgramPanel({ effective_permissions: ['queue.view'] }),
        false,
    );
    assert.equal(
        context.canOpenProgramPanel({ effective_permissions: ['program.panel.open'] }),
        true,
    );
});

test('settings panel follows station permissions', () => {
    const context = createContext();

    const stationViewerPanels = context.computeVisiblePanels({
        effective_permissions: new Set(['stations.view']),
    });
    const stationEditorPanels = context.computeVisiblePanels({
        effective_permissions: new Set(['stations.edit']),
    });
    const viewerPanels = context.computeVisiblePanels({
        effective_permissions: new Set(['queue.view']),
    });

    assert.equal(stationViewerPanels.includes('settings'), true);
    assert.equal(stationEditorPanels.includes('settings'), true);
    assert.equal(viewerPanels.includes('settings'), false);
});

test('reset-password operators can access admin access users tab', () => {
    const context = createContext();
    const user = {
        effective_permissions: new Set(['users.reset_password']),
    };

    assert.equal(context.canAccessAdminAccessPanel(user), true);
    assert.equal(context.canAccessAdminAccessSubpage('users', user), true);
    assert.equal(context.computeVisiblePanels(user).includes('admin-access'), true);
});
