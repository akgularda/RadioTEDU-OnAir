const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(root, 'app', 'static', 'index.html'), 'utf8');
const lobbyHtml = fs.readFileSync(path.join(root, 'app', 'static', 'lobby.html'), 'utf8');
const loginHtml = fs.readFileSync(path.join(root, 'app', 'static', 'login.html'), 'utf8');
const manifestJson = fs.readFileSync(path.join(root, 'app', 'static', 'manifest.json'), 'utf8');
const serviceWorkerJs = fs.readFileSync(path.join(root, 'app', 'static', 'sw.js'), 'utf8');
const mainCss = fs.readFileSync(path.join(root, 'app', 'static', 'css', 'main.css'), 'utf8');
const CURRENT_CSS_URL = '/static/css/main.css?v=20';
const CURRENT_APP_JS_URL = '/static/js/app.js?v=22';
const CURRENT_LOBBY_JS_URL = '/static/js/lobby.js?v=3';
const CURRENT_AI_HOST_JS_URL = '/static/js/ai-host.js?v=4';

function extractBlocks(source, marker) {
    const blocks = [];
    let searchIndex = 0;

    while (searchIndex < source.length) {
        const start = source.indexOf(marker, searchIndex);
        if (start < 0) {
            break;
        }

        const openBrace = source.indexOf('{', start);
        assert.ok(openBrace >= 0, `Missing opening brace for: ${marker}`);

        let depth = 0;
        let end = -1;
        for (let index = openBrace; index < source.length; index += 1) {
            const char = source[index];
            if (char === '{') {
                depth += 1;
            } else if (char === '}') {
                depth -= 1;
                if (depth === 0) {
                    end = index;
                    break;
                }
            }
        }

        assert.ok(end >= 0, `Unterminated block for: ${marker}`);
        blocks.push(source.slice(openBrace + 1, end));
        searchIndex = end + 1;
    }

    return blocks;
}

function extractQuotedArrayValues(source, marker) {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `Missing array marker: ${marker}`);

    const openBracket = source.indexOf('[', start);
    assert.ok(openBracket >= 0, `Missing opening bracket for: ${marker}`);

    let depth = 0;
    let end = -1;
    for (let index = openBracket; index < source.length; index += 1) {
        const char = source[index];
        if (char === '[') {
            depth += 1;
        } else if (char === ']') {
            depth -= 1;
            if (depth === 0) {
                end = index;
                break;
            }
        }
    }

    assert.ok(end >= 0, `Unterminated array for: ${marker}`);
    return Array.from(source.slice(openBracket, end + 1).matchAll(/'([^']+)'/g), match => match[1]);
}

function extractLocalShellAssetUrls(html) {
    return Array.from(
        html.matchAll(/(?:src|href)="([^"]+)"/g),
        match => match[1]
    ).filter(url => url.startsWith('/'));
}

test('PWA shell assets exist and are linked from both entrypoints', () => {
    const manifest = JSON.parse(manifestJson);
    assert.equal(manifest.name, 'RadioTEDU OnAir');
    assert.ok(
        manifest.icons.some(icon => icon.src === '/static/icons/icon-192.png' && icon.sizes === '192x192'),
        'Expected a 192x192 installable icon'
    );
    assert.ok(
        manifest.icons.some(icon => icon.src === '/static/icons/icon-512.png' && icon.sizes === '512x512'),
        'Expected a 512x512 installable icon'
    );
    assert.match(indexHtml, /rel="manifest"/);
    assert.match(lobbyHtml, /rel="manifest"/);
    assert.match(loginHtml, /rel="manifest"/);
    assert.match(lobbyHtml, /navigator\.serviceWorker\.register\('\/sw\.js',\s*\{\s*scope:\s*'\/'\s*\}\)/);
    assert.match(indexHtml, /navigator\.serviceWorker\.register\('\/sw\.js',\s*\{\s*scope:\s*'\/'\s*\}\)/);
    assert.match(loginHtml, /navigator\.serviceWorker\.register\('\/sw\.js',\s*\{\s*scope:\s*'\/'\s*\}\)/);
});

test('entrypoints load the editorial broadcast font pair', () => {
    for (const html of [indexHtml, lobbyHtml, loginHtml]) {
        assert.match(html, /fonts\.googleapis\.com\/css2\?family=Albert\+Sans/i);
        assert.match(html, /family=Archivo/i);
    }
});

test('service worker keeps canonical pages fresh and bypasses api traffic', () => {
    assert.match(serviceWorkerJs, /const SHELL_ASSETS = \[/);
    assert.match(serviceWorkerJs, /const SHELL_ASSET_SET = new Set\(SHELL_ASSETS\)/);
    assert.match(serviceWorkerJs, /function normalizeShellCacheKey\(requestUrl\)/);
    assert.match(serviceWorkerJs, /cache\.match\(cacheKey\)/);
    assert.match(serviceWorkerJs, /cache\.put\(cacheKey,\s*response\.clone\(\)\)/);
    assert.doesNotMatch(serviceWorkerJs, /cache\.match\(request\)/);
    assert.doesNotMatch(serviceWorkerJs, /cache\.put\(request/);
    assert.match(serviceWorkerJs, /request\.url\.includes\('\/api\/'\)/);
    assert.match(serviceWorkerJs, /const canonicalNavigation = SHELL_CANONICAL_PATHS\.has/);
});

test('worker normalizes query-bearing shell requests to canonical cache keys', async () => {
    const cacheCalls = { match: [], put: [] };
    let fetchHandler = null;
    const sandbox = {
        URL,
        caches: {
            open: async () => ({
                addAll: async () => {},
                match: async (key) => {
                    cacheCalls.match.push(String(key));
                    return null;
                },
                put: async (key) => {
                    cacheCalls.put.push(String(key));
                },
            }),
            keys: async () => [],
            delete: async () => true,
        },
        fetch: async () => ({ ok: true, clone: () => ({}) }),
        module: { exports: {} },
        self: {
            addEventListener: (eventName, handler) => {
                if (eventName === 'fetch') {
                    fetchHandler = handler;
                }
            },
        },
    };
    vm.runInNewContext(`${serviceWorkerJs}\nmodule.exports = { isShellAsset, normalizeShellCacheKey };`, sandbox);

    assert.equal(sandbox.module.exports.normalizeShellCacheKey('https://example.com/app?station_id=7'), '/app');
    assert.equal(
        sandbox.module.exports.normalizeShellCacheKey('https://example.com/login.html?next=%2Fapp%3Fstation_id%3D7'),
        '/login.html'
    );

    const event = {
        request: {
            method: 'GET',
            url: 'https://example.com/app?station_id=7',
        },
        respondWith(promise) {
            this.promise = promise;
        },
    };

    fetchHandler(event);
    await event.promise;

    assert.deepEqual(cacheCalls.match, []);
    assert.deepEqual(cacheCalls.put, ['/app']);
    assert.equal(sandbox.module.exports.isShellAsset('https://example.com/app?station_id=7'), true);
    assert.equal(sandbox.module.exports.isShellAsset('https://example.com/login.html?next=%2Fapp%3Fstation_id%3D7'), true);
});

test('worker shell matcher recognizes exact precache urls from the html entrypoints', () => {
    const sandbox = {
        URL,
        caches: {
            open: async () => ({ addAll: async () => {}, match: async () => null, put: async () => {} }),
            keys: async () => [],
            delete: async () => true,
        },
        fetch: async () => ({ ok: true, clone: () => ({}) }),
        module: { exports: {} },
        self: {
            addEventListener: () => {},
        },
    };
    vm.runInNewContext(`${serviceWorkerJs}\nmodule.exports = { isShellAsset };`, sandbox);

    assert.equal(sandbox.module.exports.isShellAsset(`https://example.com${CURRENT_APP_JS_URL}`), true);
    assert.equal(sandbox.module.exports.isShellAsset('https://example.com/static/js/app.js?v=5'), false);
    assert.equal(sandbox.module.exports.isShellAsset(`https://example.com${CURRENT_LOBBY_JS_URL}`), true);
    assert.equal(sandbox.module.exports.isShellAsset(`https://example.com${CURRENT_CSS_URL}`), true);
    assert.equal(sandbox.module.exports.isShellAsset('https://example.com/static/css/main.css?v=4'), false);
    assert.equal(sandbox.module.exports.isShellAsset('https://example.com/login.html'), true);
});

test('entrypoints and worker use the current cache-busting urls for changed shell assets', () => {
    for (const html of [indexHtml, lobbyHtml, loginHtml]) {
        assert.match(html, new RegExp(`href="${CURRENT_CSS_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    }
    assert.match(indexHtml, new RegExp(`src="${CURRENT_APP_JS_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.match(loginHtml, new RegExp(`src="${CURRENT_APP_JS_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.match(lobbyHtml, new RegExp(`src="${CURRENT_LOBBY_JS_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));

    const shellAssets = extractQuotedArrayValues(serviceWorkerJs, 'const SHELL_ASSETS = [');
    assert.ok(shellAssets.includes(CURRENT_CSS_URL));
    assert.ok(shellAssets.includes(CURRENT_APP_JS_URL));
    assert.ok(shellAssets.includes(CURRENT_LOBBY_JS_URL));
    assert.ok(shellAssets.includes(CURRENT_AI_HOST_JS_URL));
    assert.ok(shellAssets.includes('/static/js/soundboard.js?v=3'));
    assert.ok(shellAssets.includes('/app'));
    assert.ok(shellAssets.includes('/app/'));
    assert.deepEqual(shellAssets.filter(url => url.startsWith('/static/css/main.css?v=')), [CURRENT_CSS_URL]);
    assert.deepEqual(shellAssets.filter(url => url.startsWith('/static/js/app.js?v=')), [CURRENT_APP_JS_URL]);
    assert.deepEqual(shellAssets.filter(url => url.startsWith('/static/js/lobby.js?v=')), [CURRENT_LOBBY_JS_URL]);
    assert.deepEqual(shellAssets.filter(url => url.startsWith('/static/js/soundboard.js?v=')), ['/static/js/soundboard.js?v=3']);
});

test('worker precache urls match the shell urls emitted by the html entrypoints', () => {
    const expectedShellAssets = Array.from(
        new Set([
            ...extractLocalShellAssetUrls(indexHtml),
            ...extractLocalShellAssetUrls(lobbyHtml),
            ...extractLocalShellAssetUrls(loginHtml),
        ])
    )
        .filter(url => url.includes('?v='))
        .sort();
    const actualShellAssets = extractQuotedArrayValues(serviceWorkerJs, 'const SHELL_ASSETS = [')
        .filter(url => url.includes('?v='))
        .sort();

    assert.deepEqual(actualShellAssets, expectedShellAssets);
});

test('mobile shell polish rules are present in main css', () => {
    const mobileBlocks = extractBlocks(mainCss, '@media (max-width: 640px)');
    const mobileBlock = mobileBlocks.find(block => /\.ptt-button\s*\{[\s\S]*min-height:\s*96px;/.test(block));
    assert.ok(mobileBlock, 'Expected a max-width: 640px block to contain the enlarged PTT rule');
    assert.match(mobileBlock, /\.ptt-button\s*\{[\s\S]*min-height:\s*96px;/);
    assert.match(mobileBlock, /\.modal-overlay\s+\.modal-content/);
    assert.match(mobileBlock, /safe-area-inset-bottom/);
});
