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

function createElement() {
    return {
        style: {},
        dataset: {},
        disabled: false,
        hidden: false,
        textContent: '',
        innerHTML: '',
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        appendChild() {},
        setAttribute() {},
        addEventListener() {},
        remove() {},
    };
}

function createContext(elements = {}) {
    const storage = createStorage();
    const context = {
        console,
        setTimeout() { return 1; },
        clearTimeout() {},
        setInterval() { return 1; },
        clearInterval() {},
        requestAnimationFrame() { return 1; },
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
            createElement,
            body: {
                appendChild() {},
            },
        },
    };

    context.document.getElementById = (id) => elements[id] || null;

    context.window = context;
    context.globalThis = context;
    context.self = context;
    vm.runInNewContext(appJsSource, context, { filename: appJsPath });
    return context;
}

test('program controls respect show capability grants', () => {
    const context = createContext();
    const state = context.getProgramControlState({
        selectedShowId: 7,
        currentUser: {
            effective_permissions: new Set(['program.panel.open']),
            show_permissions: { 7: new Set(['show.queue_edit']) },
        },
    });

    assert.equal(state.canGoLive, false);
    assert.equal(state.canEditQueue, true);
    assert.equal(state.canGoBreak, false);
    assert.equal(state.canEndShow, false);
});

test('program controls switch based on active session state and per-show capabilities', () => {
    const context = createContext();
    const state = context.getProgramControlState({
        selectedShowId: 9,
        activeShowSession: { show_id: 9, status: 'live' },
        currentUser: {
            effective_permissions: new Set(['program.panel.open']),
            show_permissions: { 9: new Set(['show.broadcast', 'show.end']) },
        },
    });

    assert.equal(state.canGoLive, false);
    assert.equal(state.canGoBreak, false);
    assert.equal(state.canEndShow, true);
    assert.equal(state.canEditQueue, false);
});

test('program controls require a claimed workspace before pre-live go-live is enabled', () => {
    const context = createContext();
    context.currentState.programWorkspaceClaimedShowId = null;
    const state = context.getProgramControlState({
        selectedShowId: 13,
        currentUser: {
            effective_permissions: new Set(['program.panel.open']),
            show_permissions: { 13: new Set(['show.broadcast']) },
        },
    });

    assert.equal(state.canGoLive, false);

    context.currentState.programWorkspaceClaimedShowId = 13;
    const claimedState = context.getProgramControlState({
        selectedShowId: 13,
        currentUser: {
            effective_permissions: new Set(['program.panel.open']),
            show_permissions: { 13: new Set(['show.broadcast']) },
        },
    });

    assert.equal(claimedState.canGoLive, true);
});

test('renderBroadcastControls shows end button during break states when show.end is granted', () => {
    const elements = {
        showBroadcastControls: createElement(),
        showBroadcastStatus: createElement(),
        btnGoLive: createElement(),
        btnGoBreak: createElement(),
        btnEndShow: createElement(),
    };
    const context = createContext(elements);
    context.currentState.selectedShowId = 9;
    context.currentState.activeShowSession = { show_id: 9, status: 'break_outro' };
    context.Auth.getUser = () => ({
        role: 'producer',
        show_permissions: { 9: new Set(['show.end']) },
    });

    context.renderBroadcastControls();

    assert.equal(elements.showBroadcastControls.style.display, 'block');
    assert.equal(elements.btnGoLive.style.display, 'none');
    assert.equal(elements.btnGoBreak.style.display, 'none');
    assert.equal(elements.btnEndShow.style.display, 'inline-flex');
    assert.equal(elements.btnEndShow.disabled, false);
});

test('renderBroadcastControls accepts serialized show permission payloads', () => {
    const elements = {
        showBroadcastControls: createElement(),
        showBroadcastStatus: createElement(),
        btnGoLive: createElement(),
        btnGoBreak: createElement(),
        btnEndShow: createElement(),
    };
    const context = createContext(elements);
    context.currentState.selectedShowId = 9;
    context.currentState.activeShowSession = { show_id: 9, status: 'on_break' };
    context.Auth.getUser = () => ({
        role: 'producer',
        show_permissions: { '9': ['show.end'] },
    });

    context.renderBroadcastControls();

    assert.equal(elements.btnEndShow.style.display, 'inline-flex');
    assert.equal(elements.btnEndShow.disabled, false);
});

test('program queue UI disables edit actions without show.queue_edit', () => {
    const elements = {
        programMiniQueue: createElement(),
        programLibraryList: createElement(),
    };
    const context = createContext(elements);
    context.currentState.selectedShowId = 11;
    context.currentState.programQueueItems = [
        { queue_index: 0, title: 'Track A', artist: 'Artist A', duration: 120, track_type: 'music', file_path: 'a.mp3' },
        { queue_index: 1, title: 'Track B', artist: 'Artist B', duration: 120, track_type: 'music', file_path: 'b.mp3' },
    ];
    context.currentState.programLibraryTracks = [
        { id: 7, title: 'Song A', artist: 'Artist A', duration: 200, file_path: 'song-a.mp3' },
    ];
    context.Auth.getUser = () => ({
        role: 'viewer',
        show_permissions: { 11: new Set(['show.broadcast']) },
    });

    context.renderProgramMiniQueue();
    context.renderProgramMusicLibrary();

    assert.match(elements.programMiniQueue.innerHTML, /onclick="removeProgramQueueItem\(0\)" disabled/);
    assert.match(elements.programLibraryList.innerHTML, /onclick="addTrackToProgramQueue\(7\)" disabled/);
});

test('program queue source buttons require show.broadcast', () => {
    const hostButton = createElement();
    hostButton.dataset.programQueueSource = 'host';
    const automationButton = createElement();
    automationButton.dataset.programQueueSource = 'automation';
    const elements = {
        programQueueSourceBadge: createElement(),
    };
    const context = createContext(elements);
    context.currentState.selectedShowId = 15;
    context.currentState.programQueueItems = [
        { queue_index: 0, title: 'Track A', artist: 'Artist A', duration: 120, track_type: 'music', file_path: 'a.mp3' },
    ];
    context.currentState.programQueueMinTracksForHost = 1;
    context.currentState.programQueueSource = 'automation';
    context.currentState.programQueueEffectiveSource = 'automation';
    context.Auth.getUser = () => ({
        role: 'viewer',
        show_permissions: { 15: new Set(['show.queue_edit']) },
    });
    context.document.querySelectorAll = (selector) => {
        if (selector === '.btn-program-source[data-program-queue-source]') {
            return [hostButton, automationButton];
        }
        return [];
    };

    context.renderProgramQueueSourceUi();

    assert.equal(hostButton.disabled, true);
    assert.equal(automationButton.disabled, true);
});

test('program library play-now action stays disabled for non-dj broadcast users', () => {
    const elements = {
        programLibraryList: createElement(),
    };
    const context = createContext(elements);
    context.currentState.selectedShowId = 21;
    context.currentState.programLibraryTracks = [
        { id: 8, title: 'Song B', artist: 'Artist B', duration: 210, file_path: 'song-b.mp3' },
    ];
    context.Auth.getUser = () => ({
        role: 'producer',
        show_permissions: { 21: new Set(['show.broadcast', 'show.queue_edit']) },
    });

    context.renderProgramMusicLibrary();

    assert.match(elements.programLibraryList.innerHTML, /onclick="addTrackToProgramQueue\(8\)" >/);
    assert.match(elements.programLibraryList.innerHTML, /onclick="pushProgramLibraryTrack\('song-b\.mp3'\)" disabled/);
});

test('program workspace loaders scope session and queue requests by selected show', async () => {
    const calls = [];
    const elements = {
        programMiniQueue: createElement(),
        showBroadcastControls: createElement(),
        showBroadcastStatus: createElement(),
        btnGoLive: createElement(),
        btnGoBreak: createElement(),
        btnEndShow: createElement(),
    };
    const context = createContext(elements);
    context.currentState.currentStationId = 3;
    context.currentState.selectedShowId = 12;
    context.Auth.getUser = () => ({
        role: 'viewer',
        effective_permissions: new Set(['program.panel.open']),
        show_permissions: { 12: new Set(['show.queue_edit']) },
    });
    context.fetch = async (url) => {
        calls.push(String(url));
        return {
            ok: true,
            json: async () => (
                String(url).includes('/api/shows/session/current')
                    ? { session: null }
                    : {
                        items: [],
                        source: 'automation',
                        effective_source: 'automation',
                        fallback_active: false,
                        host_min_tracks_to_activate: 3,
                    }
            ),
            text: async () => '',
            status: 200,
        };
    };

    await context.loadProgramQueueState(true);
    await context.loadCurrentSession();

    assert.ok(calls.some(url => url.includes('/api/program/queue?station_id=3&show_id=12')));
    assert.ok(calls.some(url => url.includes('/api/shows/session/current?station_id=3&show_id=12')));
});

test('program workspace loaders wait for explicit show selection before pre-live requests', async () => {
    const calls = [];
    const elements = {
        programMiniQueue: createElement(),
        showBroadcastControls: createElement(),
        showBroadcastStatus: createElement(),
        btnGoLive: createElement(),
        btnGoBreak: createElement(),
        btnEndShow: createElement(),
    };
    const context = createContext(elements);
    context.currentState.currentStationId = 5;
    context.currentState.selectedShowId = null;
    context.currentState.activeShowSession = null;
    context.Auth.getUser = () => ({
        role: 'viewer',
        effective_permissions: new Set(['program.panel.open']),
        show_permissions: { 44: new Set(['show.queue_edit']) },
    });
    context.fetch = async (url) => {
        calls.push(String(url));
        return {
            ok: true,
            json: async () => ({ items: [], source: 'automation', effective_source: 'automation', fallback_active: false }),
            text: async () => '',
            status: 200,
        };
    };

    await context.loadProgramQueueState(true);
    await context.loadCurrentSession();

    assert.equal(calls.length, 0);
});

test('program music mode request includes selected show context', async () => {
    const calls = [];
    const context = createContext();
    context.currentState.currentStationId = 7;
    context.currentState.selectedShowId = 19;
    context.fetch = async (url) => {
        calls.push(String(url));
        return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, effective_mode: 'duck' }),
            text: async () => '',
        };
    };

    await context.requestProgramMusicMode('duck', 7);

    assert.ok(calls.some(url => url.includes('/api/liquidsoap/program/music?mode=duck&station_id=7&show_id=19')));
});

test('refreshStatus skips show-scoped polling until the selected show is claimed', async () => {
    const calls = [];
    const context = createContext();
    context.currentState.currentStationId = 4;
    context.currentState.selectedShowId = 31;
    context.currentState.activeShowSession = null;
    context.currentState.programWorkspaceClaimedShowId = null;
    context.Auth.getUser = () => ({
        role: 'producer',
        effective_permissions: new Set(['program.panel.open']),
        show_permissions: { 31: new Set(['show.broadcast']) },
    });
    context.fetch = async (url) => {
        calls.push(String(url));
        return {
            ok: true,
            status: 200,
            json: async () => ({ alive: false }),
            text: async () => '',
        };
    };

    await context.refreshStatus();

    assert.equal(calls.length, 0);
});

test('enterProgramModeWorkspace stops after a failed silent claim', async () => {
    const context = createContext();
    let queueLoads = 0;
    let sessionLoads = 0;
    context.currentState.selectedShowId = 17;
    context.currentState.activeShowSession = null;
    context.claimProgramWorkspace = async () => false;
    context.loadProgramQueueState = async () => { queueLoads += 1; };
    context.loadCurrentSession = async () => { sessionLoads += 1; };
    context.refreshStudioWorkspace = async () => {};
    context.loadProgramMusicLibrary = async () => {};
    context.loadProgramAdsRuntimePreview = async () => {};

    context.enterProgramModeWorkspace(true);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(queueLoads, 0);
    assert.equal(sessionLoads, 0);
});

test('changeStation clears selected show and claimed workspace context', async () => {
    const stationSelector = createElement();
    stationSelector.value = '2';
    const elements = {
        stationSelector,
        deckATime: createElement(),
        deckAProgress: createElement(),
    };
    const context = createContext(elements);
    context.currentState.currentStationId = 1;
    context.currentState.selectedShowId = 22;
    context.currentState.activeShowSession = { show_id: 22, status: 'preparing' };
    context.currentState.programWorkspaceClaimedShowId = 22;
    context.refreshActiveBroadcastStation = async () => {};
    context.refreshStudioWorkspace = async () => {};
    context.releaseProgramWorkspace = async () => true;
    context.refreshAll = () => {};
    context.showToast = () => {};
    context.WS.connect = () => {};

    await context.changeStation();

    assert.equal(context.currentState.currentStationId, 2);
    assert.equal(context.currentState.selectedShowId, null);
    assert.equal(context.currentState.activeShowSession, null);
    assert.equal(context.currentState.programWorkspaceClaimedShowId, null);
});
