const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(
  path.join(root, 'app', 'static', 'deterministic-wall', 'index.html'),
  'utf8',
);
const script = fs.readFileSync(
  path.join(root, 'app', 'static', 'deterministic-wall', 'app.js'),
  'utf8',
);

function scriptSection(startMarker, endMarker) {
  const start = script.indexOf(startMarker);
  const end = script.indexOf(endMarker, start);
  assert.notEqual(start, -1, `Could not find ${startMarker}`);
  assert.notEqual(end, -1, `Could not find ${endMarker}`);
  return script.slice(start, end);
}

function classList() {
  const values = new Set();
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); },
  };
}

function createMouseHarness() {
  const views = ['onair', 'media', 'automation', 'emergency', 'services', 'settings', 'diagnostics'];
  const attributes = new WeakMap();
  const buttons = views.map((view) => ({
    dataset: { operatorNav: view },
    closest(selector) { return selector === '[data-operator-nav]' ? this : null; },
    setAttribute(name, value) {
      const values = attributes.get(this) || new Map();
      values.set(name, value);
      attributes.set(this, values);
    },
    removeAttribute(name) { attributes.get(this)?.delete(name); },
    getAttribute(name) { return attributes.get(this)?.get(name) || null; },
  }));
  const panels = views.map((view) => ({ dataset: { operatorView: view }, hidden: false }));
  const listeners = new Map();
  const local = new Map();
  const window = {
    location: { href: 'http://wall.test/app', hash: '' },
    history: {
      replaceState(_state, _title, next) {
        const url = new URL(String(next));
        window.location.href = url.href;
        window.location.hash = url.hash;
      },
    },
    scrollTo() {},
  };
  const elements = {
    operatorNavigation: { addEventListener(type, callback) { listeners.set(type, callback); } },
    workspaceEyebrow: { textContent: '' },
    workspaceTitle: { textContent: '', focus() {} },
    workspaceDescription: { textContent: '' },
    workspaceStation: { textContent: '' },
  };
  const document = {
    title: '',
    querySelectorAll(selector) {
      if (selector === '[data-operator-view]') return panels;
      if (selector === '[data-operator-nav]') return buttons;
      return [];
    },
    querySelector() { return null; },
    getElementById(id) { return elements[id] || null; },
  };
  const context = {
    OPERATOR_VIEWS: Object.fromEntries(views.map((view) => [view, {
      eyebrow: `${view} eyebrow`, title: `${view} title`, description: `${view} description`,
    }])),
    state: { activeView: 'onair', stationId: null },
    document,
    window,
    $: (id) => document.getElementById(id),
    localStorage: { getItem(key) { return local.get(key) || null; }, setItem(key, value) { local.set(key, value); } },
    URL,
  };
  vm.createContext(context);
  vm.runInContext(
    `${scriptSection('function activateOperatorView(', 'function formatDuration(')}\n`
      + 'globalThis.__initializeOperatorNavigation = initializeOperatorNavigation;',
    context,
  );
  context.__initializeOperatorNavigation();
  return { buttons, panels, listeners, local, window, document, elements, state: context.state };
}

function invokeGuard(functionSource, handlerName, state, extras = {}) {
  const requests = [];
  const context = {
    state,
    Date,
    JSON,
    Object,
    Number,
    String,
    encodeURIComponent,
    window: { setTimeout() { return 1; }, clearTimeout() {} },
    document: { querySelectorAll() { return []; } },
    api: async (...args) => { requests.push(args); return {}; },
    fetch: (...args) => { requests.push(args); return Promise.resolve({}); },
    setResult() {},
    setBusy() {},
    selectedStationName() { return 'Test station'; },
    disarmStartBroadcast() {},
    disarmStopBroadcast() {},
    armEmergencyTakeover() {},
    clearEmergencyArm() {},
    clearServiceActionArm() {},
    ...extras,
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nglobalThis.__handler = ${handlerName};`, context);
  return { invoke: (...args) => context.__handler(...args), requests };
}

test('RadioTEDU OnAir wall is visibly branded and supports arbitrary station mounts', () => {
  assert.match(html, /RadioTEDU OnAir/);
  assert.match(html, /assets\/radiotedu-onair-logo\.png/);
  assert.match(html, /assets\/radiotedu-logo\.png/);
  assert.match(html, /assets\/rtai-logo\.png/);
  assert.match(html, /id="currentIcecastMount"[^>]*pattern="\/\.\*"/);
  assert.doesNotMatch(html.match(/id="currentIcecastMount"[^>]*>/)?.[0] || '', /readonly/);
  assert.match(script, /broadcast_autostart_enabled/);
});

test('multi-station, genre, queue, jingle, emergency, and optional AI controls are available', () => {
  assert.match(html, /class="station-control"/);
  assert.match(html, /class="status-card ai-card"/);
  assert.match(html, /class="status-card station-card"/);
  assert.match(html, /id="libraryFolderForm"/);
  assert.match(html, /id="jingleFolderForm"/);
  assert.match(html, /id="startEmergencyButton"/);
  assert.match(html, /id="aiConfigForm"/);
});

test('station context is accepted from the app URL and updated when the operator switches stations', () => {
  assert.match(script, /URLSearchParams\(window\.location\.search\).*station_id/s);
  assert.match(script, /window\.history\.replaceState\(\{\}, '', url\)/);
});

test('every JavaScript element reference exists in the wall document', () => {
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const scriptIds = new Set([...script.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]));
  const missing = [...scriptIds].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, []);
});

test('mouse navigation activates exactly one current operator workspace and persists its hash', () => {
  const harness = createMouseHarness();
  const expectedViews = ['onair', 'media', 'automation', 'emergency', 'services', 'settings', 'diagnostics'];
  const markupViews = [...html.matchAll(/data-operator-nav="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(markupViews, expectedViews);
  assert.equal(typeof harness.listeners.get('click'), 'function');

  for (const button of harness.buttons) {
    harness.listeners.get('click')({ target: button });
    const current = button.dataset.operatorNav;
    assert.equal(harness.state.activeView, current);
    assert.equal(harness.panels.filter((panel) => !panel.hidden).length, 1);
    assert.equal(harness.panels.find((panel) => !panel.hidden).dataset.operatorView, current);
    assert.equal(harness.buttons.filter((candidate) => candidate.getAttribute('aria-current') === 'page').length, 1);
    assert.equal(button.getAttribute('aria-current'), 'page');
    assert.equal(harness.window.location.hash, `#${current}`);
    assert.equal(harness.local.get('radiotedu_onair_active_view'), current);
    assert.equal(harness.document.title, `${current} title · RadioTEDU OnAir`);
  }
});

test('first mouse click on disruptive controls only arms confirmation and sends no request', async () => {
  assert.match(script, /\$\('startBroadcastButton'\)\.addEventListener\('click', startBroadcast\)/);
  assert.match(script, /\$\('stopBroadcastButton'\)\.addEventListener\('click', stopBroadcast\)/);
  assert.match(script, /\$\('startEmergencyButton'\)\.addEventListener\('click', startEmergency\)/);
  assert.match(script, /serviceButton\) controlRadioTEDUService\(serviceButton\)/);

  const startButton = { textContent: 'Start broadcast' };
  const start = invokeGuard(
    scriptSection('async function startBroadcast()', 'async function stopBroadcast()'),
    'startBroadcast',
    { startArmedUntil: 0 },
    { $: (id) => id === 'startBroadcastButton' ? startButton : { checked: false } },
  );
  await start.invoke();
  assert.deepEqual(start.requests, []);
  assert.equal(startButton.textContent, 'Confirm start broadcast');

  const stopButton = { textContent: 'Stop stream — keep playlist' };
  const stop = invokeGuard(
    scriptSection('async function stopBroadcast()', 'async function setAiEnabled('),
    'stopBroadcast',
    { stopArmedUntil: 0 },
    { $: (id) => id === 'stopBroadcastButton' ? stopButton : { checked: false } },
  );
  await stop.invoke();
  assert.deepEqual(stop.requests, []);
  assert.equal(stopButton.textContent, 'Confirm stop — keep playlist');

  let emergencyArms = 0;
  const emergency = invokeGuard(
    scriptSection('async function startEmergency()', 'async function stopEmergency('),
    'startEmergency',
    { stationId: 1, emergency: { active: false, starting: false, armedUntil: 0 } },
    { armEmergencyTakeover() { emergencyArms += 1; } },
  );
  await emergency.invoke();
  assert.equal(emergencyArms, 1);
  assert.deepEqual(emergency.requests, []);

  const serviceButton = {
    dataset: { serviceId: 'ollama', serviceAction: 'stop' },
    textContent: 'Stop service',
    classList: classList(),
  };
  const service = invokeGuard(
    scriptSection('async function controlRadioTEDUService(', 'async function publishVotingRound('),
    'controlRadioTEDUService',
    { serviceActionArmed: {} },
  );
  await service.invoke(serviceButton);
  assert.deepEqual(service.requests, []);
  assert.equal(serviceButton.classList.contains('armed'), true);
  assert.equal(serviceButton.textContent, 'Confirm Stop service');
});
