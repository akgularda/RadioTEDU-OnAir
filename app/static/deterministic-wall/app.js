'use strict';

const AUTH_KEYS = Object.freeze({
  access: 'cleanroom_auth_access_token',
  refresh: 'cleanroom_auth_refresh_token',
  user: 'cleanroom_auth_user',
});
const OPERATOR_VIEWS = Object.freeze({
  onair: { eyebrow: 'LIVE CONTROL', title: 'On Air', description: 'Control the active broadcast and see what plays next.' },
  media: { eyebrow: 'LIBRARY & PLAYOUT', title: 'Media', description: 'Import, validate, find, queue, and reorder station audio.' },
  automation: { eyebrow: 'DETERMINISTIC RULES', title: 'Automation', description: 'Manage jingles and exact, operator-defined insertion rules.' },
  emergency: { eyebrow: 'PRIORITY TAKEOVER', title: 'Emergency Broadcast', description: 'Preview and broadcast an approved external public-service source.' },
  services: { eyebrow: 'OPTIONAL SYSTEMS', title: 'Services', description: 'Control Ollama, RadioTEDU AI, Voting, Juke, and their databases.' },
  settings: { eyebrow: 'STATION ADMINISTRATION', title: 'Settings', description: 'Configure the selected station, output, and operator account.' },
  diagnostics: { eyebrow: 'RELIABILITY', title: 'Diagnostics', description: 'Run readiness checks and review operator activity.' },
});

const state = {
  stationId: null,
  stations: [],
  health: null,
  runtime: null,
  ai: null,
  stationSettings: null,
  stationOutput: null,
  libraryWatcher: null,
  unifiedMedia: null,
  integrations: null,
  radioteduServices: null,
  serviceActionArmed: {},
  activeView: 'onair',
  setupState: null,
  audioDevices: [],
  sweeper: null,
  queue: [],
  library: [],
  libraryPage: 1,
  libraryPages: 1,
  libraryTotal: 0,
  jingles: [],
  busy: false,
  refreshTimer: null,
  timelineTimer: null,
  timelineAnchorAt: 0,
  startArmedUntil: 0,
  startArmTimer: null,
  stopArmedUntil: 0,
  stopArmTimer: null,
  stationDeleteArmedUntil: 0,
  stationDeleteArmTimer: null,
  emergency: {
    active: false,
    starting: false,
    stopping: false,
    stationId: null,
    stream: null,
    audioContext: null,
    sourceNode: null,
    processorNode: null,
    silentGainNode: null,
    pendingChunks: [],
    draining: false,
    droppedChunks: 0,
    originalSettings: null,
    statusTimer: null,
    openedWindow: null,
    armedUntil: 0,
    armTimer: null,
    sourceUrl: '',
  },
};

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const asBool = (value) => value === true || ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());

function activateOperatorView(requestedView, { persist = true, focus = false } = {}) {
  const view = OPERATOR_VIEWS[requestedView] ? requestedView : 'onair';
  state.activeView = view;
  document.querySelectorAll('[data-operator-view]').forEach((node) => {
    node.hidden = node.dataset.operatorView !== view;
  });
  document.querySelectorAll('[data-operator-nav]').forEach((button) => {
    const active = button.dataset.operatorNav === view;
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const definition = OPERATOR_VIEWS[view];
  $('workspaceEyebrow').textContent = definition.eyebrow;
  $('workspaceTitle').textContent = definition.title;
  $('workspaceDescription').textContent = definition.description;
  $('workspaceStation').textContent = state.stationId ? `Active: ${selectedStationName()}` : 'No station selected';
  document.title = `${definition.title} · RadioTEDU OnAir`;
  if (persist) {
    localStorage.setItem('radiotedu_onair_active_view', view);
    const url = new URL(window.location.href);
    url.hash = view;
    window.history.replaceState({}, '', url);
  }
  if (focus) $('workspaceTitle').focus?.({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function initializeOperatorNavigation() {
  const stationCard = document.querySelector('.station-card');
  const settingsGroup = document.querySelector('.configuration-grid');
  if (stationCard && settingsGroup) settingsGroup.appendChild(stationCard);
  const hashView = String(window.location.hash || '').replace(/^#/, '');
  const savedView = localStorage.getItem('radiotedu_onair_active_view') || '';
  activateOperatorView(OPERATOR_VIEWS[hashView] ? hashView : savedView, { persist: false });
  $('operatorNavigation').addEventListener('click', (event) => {
    const button = event.target.closest('[data-operator-nav]');
    if (button) activateOperatorView(button.dataset.operatorNav, { focus: true });
  });
}

function formatDuration(seconds, empty = '--:--') {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return empty;
  const rounded = Math.max(0, Math.ceil(total));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatClock(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function estimatedClockDate(value, reference = new Date()) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const candidate = new Date(reference);
  candidate.setHours(Number(match[1]), Number(match[2]), Number(match[3] || 0), 0);
  if (candidate.getTime() < reference.getTime() - 6 * 60 * 60 * 1000) candidate.setDate(candidate.getDate() + 1);
  if (candidate.getTime() > reference.getTime() + 18 * 60 * 60 * 1000) candidate.setDate(candidate.getDate() - 1);
  return candidate;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function errorMessage(error) {
  if (!error) return 'Unknown error';
  const message = String(error.message || error).trim();
  return message.length > 260 ? `${message.slice(0, 257)}…` : message;
}

function setResult(id, message = '', type = '') {
  const node = $(id);
  if (!node) return;
  node.textContent = message;
  node.className = `action-result${type ? ` ${type}` : ''}`;
}

function toast(message, type = 'success') {
  const node = document.createElement('div');
  node.className = `toast${type === 'error' ? ' error' : ''}`;
  node.textContent = message;
  $('toastRegion').appendChild(node);
  window.setTimeout(() => node.remove(), 5200);
}

function logActivity(message, type = 'success') {
  const node = document.createElement('li');
  if (type === 'error') node.className = 'error';
  node.innerHTML = `${escapeHtml(message)}<time>${new Date().toLocaleTimeString([], { hour12: false })}</time>`;
  $('activityList').prepend(node);
  while ($('activityList').children.length > 30) $('activityList').lastElementChild.remove();
}

function setBusy(enabled, title = 'Working…', detail = 'Waiting for verified state') {
  state.busy = Boolean(enabled);
  $('busyOverlay').hidden = !enabled;
  $('busyTitle').textContent = title;
  $('busyDetail').textContent = detail;
  document.querySelectorAll('button').forEach((button) => {
    if (enabled) {
      button.dataset.beforeBusy = button.disabled ? '1' : '0';
      button.disabled = true;
    } else if (button.dataset.beforeBusy !== '1') {
      button.disabled = false;
      delete button.dataset.beforeBusy;
    } else {
      delete button.dataset.beforeBusy;
    }
  });
  if (!enabled) {
    syncActionButtons();
    if (state.radioteduServices) renderRadioTEDUServices();
  }
}

function setConnection(mode, label) {
  const node = $('connectionState');
  node.className = `connection-pill ${mode}`;
  node.innerHTML = `<span></span>${escapeHtml(label)}`;
}

function parseResponseError(text, status, requestId = '') {
  let detail = text;
  try {
    const data = JSON.parse(text);
    const raw = data.detail ?? data.message ?? data.error ?? text;
    detail = typeof raw === 'string' ? raw : JSON.stringify(raw);
  } catch (_) { /* Keep response text. */ }
  const suffix = requestId ? ` [request ${requestId}]` : '';
  const error = new Error(`${status}: ${String(detail || 'Request failed')}${suffix}`);
  error.status = Number(status || 0);
  error.requestId = requestId;
  return error;
}

async function rawFetch(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: 'no-store', ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function saveSession(payload) {
  if (payload.access_token) localStorage.setItem(AUTH_KEYS.access, String(payload.access_token));
  if (payload.refresh_token) localStorage.setItem(AUTH_KEYS.refresh, String(payload.refresh_token));
  if (payload.user) localStorage.setItem(AUTH_KEYS.user, JSON.stringify(payload.user));
}

function clearSession() {
  Object.values(AUTH_KEYS).forEach((key) => localStorage.removeItem(key));
}

async function refreshSession() {
  const refreshToken = localStorage.getItem(AUTH_KEYS.refresh);
  if (!refreshToken) return false;
  const response = await rawFetch('/api/auth/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }),
  }, 12000);
  if (!response.ok) return false;
  saveSession(await response.json());
  return true;
}

async function api(url, options = {}, retry = true) {
  const method = String(options.method || 'GET').toUpperCase();
  const maxAttempts = Math.max(1, Number(options.transportAttempts || (method === 'GET' || options.idempotent ? 3 : 1)));
  const requestOptions = { ...options };
  delete requestOptions.timeoutMs;
  delete requestOptions.transportAttempts;
  delete requestOptions.idempotent;
  const headers = new Headers(options.headers || {});
  const token = localStorage.getItem(AUTH_KEYS.access);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response;
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      response = await rawFetch(url, { ...requestOptions, headers }, options.timeoutMs || 20000);
      if (![502, 503, 504].includes(response.status) || attempt >= maxAttempts - 1) break;
      lastError = parseResponseError(await response.text(), response.status, response.headers.get('X-Request-ID') || '');
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts - 1) throw error;
    }
    await sleep(350 * (attempt + 1));
  }
  if (!response) throw lastError || new Error('Backend did not return a response');
  if (response.status === 401 && retry && await refreshSession()) return api(url, options, false);
  const text = await response.text();
  if (!response.ok) throw parseResponseError(text, response.status, response.headers.get('X-Request-ID') || '');
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return text; }
}

async function poll(check, { attempts = 20, interval = 500, description = 'state' } = {}) {
  let lastValue;
  for (let index = 0; index < attempts; index += 1) {
    lastValue = await check();
    if (lastValue && lastValue.verified) return lastValue.value;
    await sleep(interval);
  }
  throw new Error(`Timed out verifying ${description}`);
}

async function verifiedMutation(mutate, verify, options = {}) {
  let mutationResult;
  let mutationError = null;
  try {
    mutationResult = await mutate();
  } catch (error) {
    mutationError = error;
  }
  try {
    const value = await poll(async () => {
      try {
        return await verify();
      } catch (_) {
        return { verified: false };
      }
    }, options);
    return { mutationResult, value, recoveredTransportError: Boolean(mutationError) };
  } catch (verificationError) {
    throw mutationError || verificationError;
  }
}

function selectedStationName() {
  return state.stations.find((station) => Number(station.id) === Number(state.stationId))?.name || `Station ${state.stationId}`;
}

async function ensureSignedIn() {
  if (!localStorage.getItem(AUTH_KEYS.access)) return false;
  try {
    await api('/api/auth/me');
    return true;
  } catch (_) {
    clearSession();
    return false;
  }
}

async function login(event) {
  event.preventDefault();
  $('loginButton').disabled = true;
  $('loginError').textContent = '';
  try {
    const response = await rawFetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('loginUsername').value.trim(), password: $('loginPassword').value }),
    }, 12000);
    const text = await response.text();
    if (!response.ok) throw parseResponseError(text, response.status, response.headers.get('X-Request-ID') || '');
    saveSession(JSON.parse(text));
    $('loginPassword').value = '';
    await showApp();
  } catch (error) {
    $('loginError').textContent = errorMessage(error);
  } finally {
    $('loginButton').disabled = false;
  }
}

async function showApp() {
  $('authGate').hidden = true;
  $('appShell').hidden = false;
  await loadStations();
  await refreshAll(true);
  startRefreshTimer();
  startTimelineTimer();
}

function showLogin() {
  stopRefreshTimer();
  stopTimelineTimer();
  $('appShell').hidden = true;
  $('authGate').hidden = false;
  $('loginUsername').focus();
}

async function logout() {
  if (state.emergency.active || state.emergency.starting) await stopEmergency('sign out').catch(() => {});
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* local logout still succeeds */ }
  clearSession();
  showLogin();
}

async function loadStations(preferredId = null) {
  const [stationsPayload, activePayload] = await Promise.all([api('/api/stations'), api('/api/stations/active')]);
  state.stations = Array.isArray(stationsPayload?.stations) ? stationsPayload.stations : [];
  const requested = Number(new URLSearchParams(window.location.search).get('station_id') || 0);
  const saved = Number(localStorage.getItem('deterministic_wall_station_id') || 0);
  const candidate = Number(preferredId || requested || state.stationId || saved || activePayload?.station_id || state.stations[0]?.id || 0);
  state.stationId = state.stations.some((station) => Number(station.id) === candidate) ? candidate : Number(state.stations[0]?.id || 0);
  if (!state.stationId) throw new Error('No station is available');
  localStorage.setItem('deterministic_wall_station_id', String(state.stationId));
  $('stationSelect').innerHTML = state.stations.map((station) => `<option value="${Number(station.id)}">${escapeHtml(station.name)}</option>`).join('');
  $('stationSelect').value = String(state.stationId);
  $('stationCount').textContent = String(state.stations.length);
  document.querySelector('.station-card h2').textContent = state.stations.length ? 'Add another station' : 'Add your first station';
  $('workspaceStation').textContent = `Active: ${selectedStationName()}`;
}

async function loadCoreStatus() {
  const sid = state.stationId;
  const [health, runtime, ai, sweeper, publicStations, stationSettings, stationOutput, libraryWatcher, unifiedMedia] = await Promise.all([
    api(`/api/health?station_id=${sid}`),
    api(`/api/runtime/${sid}/status`),
    api(`/api/ai/settings?station_id=${sid}`),
    api(`/api/sweeper/config?station_id=${sid}`),
    rawFetch('/api/public/stations', { cache: 'no-store' }, 12000).then((response) => response.ok ? response.json() : { stations: [] }),
    api(`/api/settings/station?station_id=${sid}`),
    api(`/api/stations/output?station_id=${sid}`),
    api('/api/library/watcher/status').catch(() => ({ running: false, profiles: [] })),
    api('/api/library/unified-media/status').catch(() => ({ root: '', views: [], source_map_configured: false, last_error: '' })),
  ]);
  state.health = health;
  state.runtime = runtime;
  state.timelineAnchorAt = Date.now();
  state.ai = ai;
  state.sweeper = sweeper;
  state.stationSettings = stationSettings?.settings || stationSettings || {};
  state.stationOutput = stationOutput || {};
  state.libraryWatcher = libraryWatcher || { running: false, profiles: [] };
  state.unifiedMedia = unifiedMedia || { root: '', views: [], source_map_configured: false, last_error: '' };
  const publicStation = (publicStations.stations || []).find((station) => Number(station.id) === Number(sid));
  renderCoreStatus(publicStation);
  renderLibraryProfile();
  renderUnifiedMedia();
  renderOutputConfiguration();
  renderAiConfiguration();
  renderTimeline();
  renderEmergencyStatus(runtime);
}

async function loadOperatorConfiguration() {
  const [setupState, devicePayload, integrations, radioteduServices] = await Promise.all([
    api(`/api/setup/state?station_id=${state.stationId}`),
    api('/api/audio/devices').catch(() => ({ devices: [] })),
    api('/api/integrations/radiotedu').catch(() => ({
      voting_enabled: false,
      study_enabled: false,
    })),
    state.radioteduServices
      ? Promise.resolve(state.radioteduServices)
      : api('/api/integrations/radiotedu/services?refresh_health=false').catch(() => ({
        services: {},
        definitions: [],
        status: [],
      })),
  ]);
  state.setupState = setupState || {};
  state.audioDevices = Array.isArray(devicePayload?.devices) ? devicePayload.devices : [];
  state.integrations = integrations || {};
  state.radioteduServices = radioteduServices || { services: {}, definitions: [], status: [] };
  renderOutputConfiguration();
  renderAiConfiguration();
  renderIntegrations();
  renderRadioTEDUServices();
  renderReadiness();
}

function renderIntegrations() {
  const config = state.integrations || {};
  setCleanChecked('votingEnabled', Boolean(config.voting_enabled));
  setCleanValue('votingBaseUrl', config.voting_base_url || '');
  setCleanValue('votingDeviceId', config.voting_agent_device_id || '');
  setCleanValue('votingAgentToken', '');
  setCleanChecked('studyEnabled', Boolean(config.study_enabled));
  setCleanValue('studyBaseUrl', config.study_base_url || '');
  $('integrationState').textContent = config.voting_enabled || config.study_enabled ? 'Configured' : 'Optional';
  $('votingAgentToken').placeholder = config.voting_agent_token_configured
    ? 'Saved securely — leave blank to keep'
    : 'Required when voting is enabled';
}

function serviceControlId(serviceId, field) {
  return `service-${serviceId}-${field}`;
}

function isWindowsScmOwned(definition, status = {}) {
  return String(status.startup_owner || definition.startup_owner || '') === 'windows_scm';
}

function windowsScmOwnershipText(autonomousStartup = {}) {
  const ready = autonomousStartup.ready === true;
  const state = String(autonomousStartup.state || (ready ? 'verified' : 'commissioning pending')).replaceAll('_', ' ');
  const reasons = Array.isArray(autonomousStartup.reasons) && autonomousStartup.reasons.length
    ? ` Blocking checks: ${autonomousStartup.reasons.map((reason) => escapeHtml(String(reason).replaceAll('_', ' '))).join(', ')}.`
    : '';
  const verifiedAt = autonomousStartup.verified_at
    ? ` Foreground evidence verified ${escapeHtml(new Date(autonomousStartup.verified_at).toLocaleString())}.`
    : '';
  const evidence = autonomousStartup.evidence && Object.keys(autonomousStartup.evidence).length
    ? ` Evidence: ${escapeHtml(JSON.stringify(autonomousStartup.evidence))}.`
    : '';
  return `<b>Windows SCM owns autonomous startup.</b> SCM enrollment is gated by commissioning; autonomous readiness: ${escapeHtml(state)}.${ready ? '' : reasons}${verifiedAt}${evidence} App startup is disabled here; Start/Stop remain manual controls.`;
}

function renderRadioTEDUServices() {
  const container = $('serviceControlCards');
  if (!container) return;
  const payload = state.radioteduServices || {};
  const definitions = Array.isArray(payload.definitions) ? payload.definitions : [];
  const signature = definitions.map((item) => `${item.id}:${item.startup_owner || ''}`).join('|');
  if (container.dataset.signature !== signature) {
    container.dataset.signature = signature;
    container.innerHTML = definitions.map((definition) => {
      const isOllama = definition.kind === 'ollama';
      const mounts = Array.isArray(definition.mounts) && definition.mounts.length
        ? ` Mounts: ${definition.mounts.join(', ')}.`
        : '';
      const windowsScmOwned = isWindowsScmOwned(definition);
      return `
        <section class="service-control-card" data-service-card="${escapeHtml(definition.id)}" data-state="disabled">
          <div class="service-card-head">
            <div>
              <div class="eyebrow">${escapeHtml(definition.product)}</div>
              <h4>${escapeHtml(definition.name)}</h4>
              <p>${escapeHtml(definition.description)}${escapeHtml(mounts)}</p>
            </div>
            <span class="mini-state service-card-state" id="${serviceControlId(definition.id, 'state')}">Loading</span>
          </div>
          <div class="service-switches">
            <label class="check-row"><input id="${serviceControlId(definition.id, 'enabled')}" type="checkbox"> Enable management</label>
            <label class="check-row"><input id="${serviceControlId(definition.id, 'autostart')}" type="checkbox"${windowsScmOwned ? ' disabled' : ''}> Start with RadioTEDU OnAir</label>
          </div>
          <div class="service-startup-owner" id="${serviceControlId(definition.id, 'startup-owner')}"${windowsScmOwned ? '' : ' hidden'}>${windowsScmOwned ? '<b>Windows SCM owns autonomous startup.</b> SCM enrollment is gated by commissioning; Start/Stop remain manual controls.' : ''}</div>
          ${isOllama ? `
          <div class="ollama-controls">
            <div class="inline-status"><b>Local-only runtime</b><br>RadioTEDU OnAir detects the installed Ollama executable and talks only to 127.0.0.1. AI can be disabled without affecting music, microphone, or streaming.</div>
            <label>Model to install<input id="${serviceControlId(definition.id, 'model')}" value="qwen2.5:0.5b" maxlength="120" autocomplete="off" placeholder="qwen2.5:0.5b"></label>
          </div>` : `<div class="service-paths">
            <div class="service-path-picker">
              <label>Component source folder<input id="${serviceControlId(definition.id, 'source')}" autocomplete="off" placeholder="Absolute local source path"></label>
              <button class="button secondary" type="button" data-service-path="source" data-service-id="${escapeHtml(definition.id)}" data-picker-kind="folder">Browse</button>
            </div>
            <div class="service-path-picker">
              <label>${definition.id.startsWith('rtai_') ? 'Protected configuration folder' : 'Protected .env file'}<input id="${serviceControlId(definition.id, 'config')}" autocomplete="off" placeholder="Absolute protected path"></label>
              <button class="button secondary" type="button" data-service-path="config" data-service-id="${escapeHtml(definition.id)}" data-picker-kind="${definition.id.startsWith('rtai_') ? 'folder' : 'file'}">Browse</button>
            </div>
            <label class="service-health-field">Health URLs — one per line<textarea id="${serviceControlId(definition.id, 'health')}" rows="2" placeholder="Loopback HTTP or external HTTPS"></textarea></label>
            ${definition.database_supported ? `<div class="service-backup-field service-path-picker"><label>Database backup folder<input id="${serviceControlId(definition.id, 'backup')}" autocomplete="off" placeholder="Required before database updates"></label><button class="button secondary" type="button" data-service-path="backup" data-service-id="${escapeHtml(definition.id)}" data-picker-kind="folder">Browse</button></div>` : ''}
          </div>`}
          <div class="service-health-summary" id="${serviceControlId(definition.id, 'summary')}">Save paths, then check health.</div>
          <div class="service-actions">
            <button class="button secondary" type="button" data-service-action="check" data-service-id="${escapeHtml(definition.id)}">Check</button>
            <button class="button secondary" type="button" data-service-action="start" data-service-id="${escapeHtml(definition.id)}">Start</button>
            <button class="button secondary" type="button" data-service-action="stop" data-service-id="${escapeHtml(definition.id)}">Stop</button>
            <button class="button secondary" type="button" data-service-action="restart" data-service-id="${escapeHtml(definition.id)}">Restart</button>
            ${isOllama ? `<button class="button secondary" type="button" data-service-action="pull_model" data-service-id="${escapeHtml(definition.id)}">Install model</button>` : `<button class="button secondary" type="button" data-service-action="update_repository" data-service-id="${escapeHtml(definition.id)}">Update repository</button>`}
            ${definition.database_supported ? `<button class="button danger" type="button" data-service-action="update_database" data-service-id="${escapeHtml(definition.id)}">Update database</button>` : ''}
          </div>
        </section>`;
    }).join('');
    container.querySelectorAll('input, textarea').forEach((node) => {
      node.addEventListener('input', () => { node.dataset.dirty = '1'; });
    });
  }
  const configurations = payload.services || {};
  const statuses = new Map((payload.status || []).map((item) => [item.id, item]));
  definitions.forEach((definition) => {
    const serviceId = definition.id;
    const config = configurations[serviceId] || {};
    const status = statuses.get(serviceId) || {};
    const windowsScmOwned = isWindowsScmOwned(definition, status);
    setCleanChecked(serviceControlId(serviceId, 'enabled'), Boolean(config.enabled));
    setCleanChecked(serviceControlId(serviceId, 'autostart'), Boolean(config.auto_start));
    const autoStart = $(serviceControlId(serviceId, 'autostart'));
    if (autoStart) {
      autoStart.disabled = windowsScmOwned;
      autoStart.title = windowsScmOwned
        ? 'Windows SCM owns autonomous startup. This saved RadioTEDU OnAir preference is retained but not used to start the service.'
        : '';
    }
    const startupOwner = $(serviceControlId(serviceId, 'startup-owner'));
    if (startupOwner) {
      startupOwner.hidden = !windowsScmOwned;
      startupOwner.innerHTML = windowsScmOwned
        ? windowsScmOwnershipText(status.autonomous_startup || {})
        : '';
    }
    if ($(serviceControlId(serviceId, 'source'))) setCleanValue(serviceControlId(serviceId, 'source'), config.source_dir || '');
    if ($(serviceControlId(serviceId, 'config'))) setCleanValue(serviceControlId(serviceId, 'config'), config.config_path || '');
    if ($(serviceControlId(serviceId, 'health'))) setCleanValue(serviceControlId(serviceId, 'health'), (config.health_urls || []).join('\n'));
    if ($(serviceControlId(serviceId, 'backup'))) {
      setCleanValue(serviceControlId(serviceId, 'backup'), config.database_backup_dir || '');
    }
    const stateLabel = String(status.state || (config.enabled ? 'configured' : 'disabled')).replaceAll('_', ' ');
    $(serviceControlId(serviceId, 'state')).textContent = stateLabel;
    const card = container.querySelector(`[data-service-card="${serviceId}"]`);
    if (card) card.dataset.state = status.state || 'disabled';
    const health = Array.isArray(status.health) ? status.health : [];
    const healthText = health.length
      ? health.map((item) => {
        const signals = item.signals && Object.keys(item.signals).length
          ? ` — ${escapeHtml(JSON.stringify(item.signals).slice(0, 360))}`
          : '';
        return `${item.ok ? 'OK' : 'FAIL'} ${escapeHtml(item.url)} (${escapeHtml(item.status || 'offline')}, ${escapeHtml(item.latency_ms)} ms)${signals}`;
      }).join('<br>')
      : 'Health has not been checked in this view.';
    const sourceText = definition.kind === 'ollama'
      ? status.source?.ready ? 'Ollama installed' : 'Ollama is not installed'
      : status.source?.ready
        ? `Source ready${status.source.commit ? ` at ${escapeHtml(status.source.commit)}${status.source.dirty ? ' (local changes)' : ''}` : ''}`
        : `Source ${status.source?.configured ? 'not ready' : 'not configured'}`;
    const mountText = Array.isArray(status.mounts) && status.mounts.length
      ? status.mounts.join(', ')
      : 'none';
    const database = status.database || {};
    const lastUpdate = database.last_update_at
      ? new Date(database.last_update_at).toLocaleString()
      : '';
    const databaseText = definition.database_supported
      ? `<br><b>Database: ${escapeHtml(database.kind || definition.database_kind || 'managed')}</b> · ${escapeHtml(String(database.state || 'not ready').replaceAll('_', ' '))} · Backups: ${database.backup_configured ? 'configured' : 'not configured'}${lastUpdate ? ` · Last update: ${escapeHtml(lastUpdate)} · ${Number((database.last_backup_files || []).length)} backup file(s)` : ''}`
      : '';
    $(serviceControlId(serviceId, 'summary')).innerHTML = `<b>${escapeHtml(sourceText)}</b> · Runtime: ${escapeHtml(status.runtime || 'stopped')} · Config: ${status.config_ready ? 'ready' : 'not ready'} · Mounts: ${escapeHtml(mountText)}<br>${healthText}${databaseText}`;
    const running = status.runtime === 'running';
    const externallyRunning = status.runtime === 'external';
    const start = card?.querySelector('[data-service-action="start"]');
    const stop = card?.querySelector('[data-service-action="stop"]');
    const restart = card?.querySelector('[data-service-action="restart"]');
    if (start) start.disabled = running || externallyRunning;
    if (stop) stop.disabled = !running;
    if (restart) restart.disabled = !running;
  });
  const active = (payload.status || []).filter((item) => item.runtime === 'running').length;
  const unhealthy = (payload.status || []).filter((item) => item.enabled && ['degraded', 'not_ready'].includes(item.state)).length;
  $('serviceControlState').textContent = unhealthy ? `${unhealthy} need attention` : active ? `${active} running` : 'Ready';
}

function collectRadioTEDUServiceSettings() {
  const payload = {};
  (state.radioteduServices?.definitions || []).forEach((definition) => {
    const serviceId = definition.id;
    const config = state.radioteduServices?.services?.[serviceId] || {};
    const status = (state.radioteduServices?.status || []).find((item) => item.id === serviceId) || {};
    const autoStart = $(serviceControlId(serviceId, 'autostart'));
    const windowsScmOwned = isWindowsScmOwned(definition, status);
    payload[serviceId] = {
      enabled: $(serviceControlId(serviceId, 'enabled')).checked,
      auto_start: windowsScmOwned ? Boolean(config.auto_start) : Boolean(autoStart?.checked),
      source_dir: $(serviceControlId(serviceId, 'source'))?.value.trim() || '',
      config_path: $(serviceControlId(serviceId, 'config'))?.value.trim() || '',
      health_urls: $(serviceControlId(serviceId, 'health'))?.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) || config.health_urls || [],
      database_backup_dir: $(serviceControlId(serviceId, 'backup'))?.value.trim() || '',
    };
  });
  return payload;
}

async function pickRadioTEDUServicePath(button) {
  const serviceId = button.dataset.serviceId;
  const field = button.dataset.servicePath;
  const kind = button.dataset.pickerKind === 'file' ? 'file' : 'folder';
  const endpoint = kind === 'file'
    ? '/api/operator/pick-file'
    : '/api/operator/pick-folder';
  const input = $(serviceControlId(serviceId, field));
  if (!serviceId || !field || !input) return;
  setBusy(true, `Selecting ${field.replaceAll('_', ' ')}…`, 'Use the operating-system picker');
  setResult('serviceControlResult');
  try {
    const result = await api(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kind === 'file'
        ? { initial_path: input.value.trim(), description: `Select ${serviceId} protected configuration` }
        : { initial_folder: input.value.trim(), description: `Select ${serviceId} ${field.replaceAll('_', ' ')}` }),
      timeoutMs: 620000,
    });
    const selected = kind === 'file' ? result.path : result.folder;
    if (result.selected && selected) {
      input.value = selected;
      input.dataset.dirty = '1';
      const message = `${serviceId} ${field.replaceAll('_', ' ')} selected. Save settings to verify it.`;
      setResult('serviceControlResult', message, 'success');
      logActivity(message);
    }
  } catch (error) {
    const message = errorMessage(error);
    setResult('serviceControlResult', message, 'error');
    logActivity(`Path selection failed: ${message}`, 'error');
  } finally {
    setBusy(false);
  }
}

function renderCoreStatus(publicStation = null) {
  const health = state.health || {};
  const runtime = health.runtime || state.runtime || {};
  const loop = health.worker_loop || state.runtime?.worker_loop || {};
  const branches = health.runtime_branch_health || runtime.branch_health || {};
  const onAir = Boolean(health.engine_running && runtime.running && runtime.output_feed_active && (branches.icecast || branches.local));
  $('broadcastTitle').textContent = onAir ? 'Broadcast is live' : 'Broadcast is stopped';
  $('onAirLamp').className = `status-lamp ${onAir ? 'live' : 'off'}`;
  $('onAirLamp').innerHTML = `<span></span><b>${onAir ? 'ON AIR' : 'OFF AIR'}</b>`;
  $('engineState').textContent = runtime.running || health.engine_running ? 'Running' : 'Stopped';
  $('loopState').textContent = loop.running ? 'Running' : 'Stopped';
  $('icecastState').textContent = branches.icecast ? 'Connected' : (health.output_mode === 'icecast' ? 'Disconnected' : 'Not selected');
  const recovery = runtime.recovery || state.runtime?.recovery || {};
  $('recoveryState').textContent = recovery.state === 'retry_wait'
    ? `Retry in ${Math.ceil(Number(recovery.retry_in_seconds || 0))}s`
    : (recovery.state === 'recovering' ? 'Recovering' : recovery.state === 'recovered' ? 'Recovered' : 'Idle');
  $('recoveryState').title = recovery.message || recovery.error_code || '';
  const nowPlaying = publicStation?.now_playing || {};
  $('nowPlayingTitle').textContent = nowPlaying.title || 'No track reported';
  $('nowPlayingArtist').textContent = nowPlaying.artist || (onAir ? selectedStationName() : 'Broadcast is not running');

  const aiEnabled = asBool(state.ai?.ai_host_enabled);
  const readiness = health.ai_prefetch?.startup_state || {};
  $('aiTitle').textContent = aiEnabled ? 'AI host is enabled' : 'AI host is disabled';
  $('aiLamp').className = `status-lamp ${aiEnabled ? (readiness.ready ? 'live' : 'warming') : 'off'}`;
  $('aiLamp').innerHTML = `<span></span><b>${aiEnabled ? (readiness.ready ? 'ENABLED' : 'WARMING') : 'DISABLED'}</b>`;
  $('aiDescription').textContent = aiEnabled ? (readiness.message || 'AI intros are enabled for upcoming music.') : 'Tracks play without generated AI introductions.';
  $('aiProvider').textContent = state.ai?.tts_provider || '—';
  $('aiReadiness').textContent = aiEnabled ? (readiness.ready ? 'Ready' : readiness.state || 'Warming') : 'Disabled';
  setCleanChecked('sweeperEnabled', Boolean(state.sweeper?.enabled));
  $('sweeperLamp').textContent = state.sweeper?.enabled
    ? `On - every ${state.sweeper.interval} completed song${Number(state.sweeper.interval) === 1 ? '' : 's'}`
    : 'Off';
  setCleanValue('sweeperInterval', String(state.sweeper?.interval || 2));
  setCleanValue('sweeperMode', ['ordered', 'random'].includes(state.sweeper?.mode) ? state.sweeper.mode : 'ordered');
  setCleanChecked('broadcastAutostartEnabled', asBool(state.stationSettings?.broadcast_autostart_enabled));
  $('jingleCount').textContent = String(state.sweeper?.jingle_count || state.jingles.length || 0);
  syncActionButtons();
}

function renderLibraryProfile() {
  const folderInput = $('libraryFolder');
  if (!folderInput) return;
  const settings = state.stationSettings || {};
  if (folderInput.dataset.dirty !== '1') folderInput.value = settings.music_library_folder || '';
  if ($('libraryProfileLabel').dataset.dirty !== '1') $('libraryProfileLabel').value = settings.library_profile_label || '';
  if ($('libraryDefaultGenre').dataset.dirty !== '1') $('libraryDefaultGenre').value = settings.library_default_genre || '';
  if ($('libraryDefaultLanguage').dataset.dirty !== '1') $('libraryDefaultLanguage').value = settings.library_default_language || '';
  const managedMode = String(settings.library_management_mode || 'merge').toLowerCase();
  $('libraryReplaceOutside').checked = managedMode === 'replace';
  const label = String(settings.library_profile_label || '').trim();
  const folder = String(settings.music_library_folder || '').trim();
  const watcherProfile = (state.libraryWatcher?.profiles || []).find((profile) => (
    Number(profile.station_id) === Number(state.stationId) && profile.track_type === 'music'
  ));
  const watcherState = watcherProfile
    ? ` · auto ${watcherProfile.status || 'watching'}`
    : (folder ? ' · auto watcher pending' : '');
  const persistedActiveFiles = Number(settings.library_active_files);
  const activeFiles = Number.isFinite(persistedActiveFiles)
    ? persistedActiveFiles
    : 0;
  $('libraryProfileState').textContent = folder
    ? `${label || 'Managed folder'} · ${managedMode === 'replace' ? 'exact replacement' : 'merge'} · ${activeFiles} active items${watcherState}`
    : 'No managed music folder has been configured for this station.';
  $('libraryManagedPath').textContent = folder || 'Choose a folder below, then sync and verify it.';
  if ($('jingleFolder') && $('jingleFolder').dataset.dirty !== '1') {
    $('jingleFolder').value = settings.jingle_library_folder || '';
    $('jingleFolderReplace').checked = String(settings.jingle_library_management_mode || 'merge').toLowerCase() === 'replace';
  }
}

function setCleanValue(id, value) {
  const node = $(id);
  if (node && node.dataset.dirty !== '1') node.value = value ?? '';
}

function setCleanChecked(id, value) {
  const node = $(id);
  if (node && node.dataset.dirty !== '1') node.checked = Boolean(value);
}

function renderOutputConfiguration() {
  const output = state.stationOutput || {};
  const station = state.stations.find((item) => Number(item.id) === Number(state.stationId)) || {};
  setCleanValue('currentStationName', station.name || '');
  setCleanValue('currentOutputGain', Number(output.output_gain_db || 0));
  setCleanChecked('currentIcecastEnabled', output.icecast_enabled);
  setCleanValue('currentIcecastHost', output.icecast_host || '127.0.0.1');
  setCleanValue('currentIcecastPort', Number(output.icecast_port || 8000));
  setCleanValue('currentIcecastMount', output.icecast_mount || `/station${state.stationId || 1}`);
  setCleanValue('currentIcecastUser', output.icecast_user || 'source');
  setCleanValue('currentIcecastPassword', output.icecast_password || '');
  setCleanValue('currentIcecastProfile', output.stream_codec_profile || 'aac_plus_196');
  setCleanChecked('currentIcecastTlsEnabled', asBool(output.icecast_tls_enabled));
  setCleanChecked('currentLocalEnabled', output.local_output_enabled);

  const selectedDevice = $('currentOutputDevice')?.dataset.dirty === '1'
    ? $('currentOutputDevice').value
    : String(output.output_device_id || '');
  const deviceOptions = [...state.audioDevices];
  if (selectedDevice && !deviceOptions.some((device) => String(device.id) === selectedDevice)) {
    deviceOptions.unshift({ id: selectedDevice, label: `${selectedDevice} (currently configured)` });
  }
  if ($('currentOutputDevice')) {
    $('currentOutputDevice').innerHTML = '<option value="">Choose an output device</option>' + deviceOptions.map((device) =>
      `<option value="${escapeHtml(device.id)}">${escapeHtml(device.label || device.id)}</option>`).join('');
    $('currentOutputDevice').value = selectedDevice;
  }
  const targets = [output.icecast_enabled ? output.icecast_mount || 'Icecast' : '', output.local_output_enabled ? 'local monitor' : ''].filter(Boolean);
  $('outputConfigState').textContent = targets.length ? targets.join(' + ') : 'No output configured';
  toggleCurrentOutputFields();
}

function renderAiConfiguration() {
  const settings = state.ai || {};
  setCleanChecked('aiConfigEnabled', asBool(settings.ai_host_enabled));
  setCleanValue('aiLlmModel', settings.llm_model || 'Qwen/Qwen2.5-0.5B-Instruct');
  setCleanValue('aiTtsProvider', settings.tts_provider || 'local-qwen-tts');
  setCleanValue('aiVoicePersona', settings.voice_persona || 'auto');
  setCleanValue('aiTtsModelPath', settings.tts_model_path || '');
  setCleanValue('aiMaxSeconds', Number(settings.announcement_max_seconds || 15));
  setCleanValue('aiStationInterval', Number(settings.station_id_announcement_interval || 1800));
  setCleanChecked('aiIncludeHistory', asBool(settings.include_music_history));
  setCleanChecked('aiEducational', asBool(settings.educational_segments_enabled));
  setCleanValue('aiPromptTemplate', settings.prompt_template || '');
  const enabled = asBool(settings.ai_host_enabled);
  $('aiConfigState').textContent = enabled ? `${settings.tts_provider || 'AI voice'} enabled` : 'Disabled; music continuity remains active';
  if (!state.busy) $('testAiButton').disabled = !enabled;
}

function renderReadiness() {
  const setup = state.setupState || {};
  const checks = Array.isArray(setup.checks) ? setup.checks : [];
  const node = $('readinessList');
  if (!node) return;
  node.innerHTML = checks.length ? checks.map((check) => {
    const optional = check.required === false && !check.ready;
    const className = check.ready ? 'ready' : (optional ? 'optional' : '');
    const label = optional
      ? `${check.label || check.name || 'Check'} · Optional`
      : (check.label || check.name || 'Check');
    return `<li class="${className}"><span><b>${escapeHtml(label)}</b>${escapeHtml(check.message || (check.ready ? 'Ready' : 'Needs attention'))}</span></li>`;
  }).join('') : '<li><span><b>Self-check unavailable</b>Run the check again when the backend is connected.</span></li>';
  const blocking = Array.isArray(setup.blocking_reasons)
    ? setup.blocking_reasons
    : (Array.isArray(setup.blocking) ? setup.blocking : []);
  $('readinessState').textContent = setup.can_complete ? 'Ready for broadcast' : `${blocking.length || checks.filter((check) => !check.ready).length} action(s) needed`;
}

function syncActionButtons() {
  if (state.busy) return;
  const runtime = state.health?.runtime || state.runtime || {};
  const loop = state.health?.worker_loop || state.runtime?.worker_loop || {};
  const running = Boolean(state.health?.engine_running && runtime.running && runtime.output_feed_active);
  const stationReady = Number(state.stationId || 0) > 0;
  $('startBroadcastButton').disabled = !stationReady || (running && loop.running);
  $('startBroadcastButton').textContent = state.startArmedUntil > Date.now() ? 'Confirm start broadcast' : 'Start broadcast';
  $('stopBroadcastButton').disabled = !stationReady || (!running && !loop.running);
  $('stopBroadcastButton').textContent = state.stopArmedUntil > Date.now() ? 'Confirm stop — keep playlist' : 'Stop stream — keep playlist';
  const aiEnabled = asBool(state.ai?.ai_host_enabled);
  $('enableAiButton').disabled = aiEnabled;
  $('disableAiButton').disabled = !aiEnabled;
  if ($('testAiButton')) $('testAiButton').disabled = !aiEnabled;
  if ($('deleteStationButton')) $('deleteStationButton').disabled = state.stations.length <= 1;
  $('libraryPrev').disabled = state.libraryPage <= 1;
  $('libraryNext').disabled = state.libraryPage >= state.libraryPages;
}

function renderUnifiedMedia() {
  const payload = state.unifiedMedia || {};
  const root = String(payload.root || '').trim();
  const configured = Boolean(payload.source_map_configured);
  const lastError = String(payload.last_error || '').trim();
  const views = Array.isArray(payload.views) ? payload.views : [];
  const stateLabel = lastError
    ? 'Needs attention'
    : configured && payload.layout_ready
      ? 'Ready'
      : configured
        ? 'Layout pending'
        : 'Source map required';
  $('unifiedMediaState').textContent = stateLabel;
  $('unifiedMediaRoot').textContent = root || 'No media root is configured.';
  $('unifiedMediaViews').innerHTML = views.length
    ? views.map((view) => `<div class="unified-media-view ${view.exists ? 'ready' : 'pending'}"><b>${escapeHtml(view.directory || view.view || 'View')}</b><span>${Number(view.file_count || 0)} linked file(s) · ${view.exists ? 'available' : 'not published'}</span></div>`).join('')
    : '<div class="empty-state">No managed media views are available yet.</div>';
  const refreshAt = String(payload.last_refresh_at || payload.last_published_at || '').trim();
  const refreshText = refreshAt ? `Last refresh: ${new Date(refreshAt).toLocaleString()}` : 'No refresh has been recorded.';
  $('unifiedMediaDetails').textContent = lastError
    ? `${refreshText} Last error: ${lastError}`
    : `${refreshText} ${configured ? 'Source map is explicit and ready for a safe rebuild.' : 'Create the protected explicit source map before rebuilding.'}`;
  $('refreshUnifiedMediaButton').disabled = !configured;
}

function disarmStartBroadcast() {
  state.startArmedUntil = 0;
  if (state.startArmTimer) window.clearTimeout(state.startArmTimer);
  state.startArmTimer = null;
  $('startBroadcastButton').textContent = 'Start broadcast';
}

function disarmStopBroadcast() {
  state.stopArmedUntil = 0;
  if (state.stopArmTimer) window.clearTimeout(state.stopArmTimer);
  state.stopArmTimer = null;
  $('stopBroadcastButton').textContent = 'Stop stream — keep playlist';
}

async function loadQueue() {
  const payload = await api(`/api/queue?station_id=${state.stationId}`);
  state.queue = Array.isArray(payload?.items) ? payload.items : [];
  renderQueue();
  renderTimeline();
}

function renderQueue() {
  const node = $('queueList');
  if (!state.queue.length) {
    node.innerHTML = '<div class="empty-state">The queue is empty.</div>';
    return;
  }
  const movable = state.queue.filter((item) => {
    const played = Boolean(item.is_played) || String(item.status) === 'done';
    const current = Boolean(item.is_current) || String(item.status) === 'playing';
    return !played && !current && Number(item.queue_index ?? item.index ?? -1) >= 0;
  });
  const firstMovableIndex = Number(movable[0]?.queue_index ?? movable[0]?.index ?? -1);
  const lastMovableIndex = Number(movable[movable.length - 1]?.queue_index ?? movable[movable.length - 1]?.index ?? -1);
  node.innerHTML = state.queue.map((item) => {
    const queueIndex = Number(item.queue_index ?? item.index ?? -1);
    const played = Boolean(item.is_played) || String(item.status) === 'done';
    const current = Boolean(item.is_current) || String(item.status) === 'playing';
    const trackId = Number(item.track_id || 0);
    return `<div class="media-row ${current ? 'playing' : ''} ${played ? 'done' : ''}">
      <div class="media-title"><small>${current ? 'Playing now' : played ? 'Played' : item.is_next ? 'Up next' : 'Queued'}</small><b>${escapeHtml(item.title || 'Untitled')}</b><span>${escapeHtml(item.artist || item.track_type || '')}</span></div>
      <div class="row-actions">
        ${!played && !current && queueIndex >= 0 ? `<button class="icon-button" data-queue-action="up" data-index="${queueIndex}" title="Move up" aria-label="Move ${escapeHtml(item.title)} up" ${queueIndex === firstMovableIndex ? 'disabled' : ''}>↑</button><button class="icon-button" data-queue-action="down" data-index="${queueIndex}" title="Move down" aria-label="Move ${escapeHtml(item.title)} down" ${queueIndex === lastMovableIndex ? 'disabled' : ''}>↓</button><button class="icon-button remove" data-queue-action="remove" data-index="${queueIndex}" title="Remove" aria-label="Remove ${escapeHtml(item.title)}">×</button>` : ''}
      </div><input type="hidden" value="${trackId}">
    </div>`;
  }).join('');
}

function timelineSnapshot(now = new Date()) {
  const activeItems = state.queue.filter((item) => !item.is_played && String(item.status || '').toLowerCase() !== 'done');
  const current = activeItems.find((item) => item.is_current || String(item.status || '').toLowerCase() === 'playing') || null;
  const pending = activeItems.filter((item) => item !== current);
  const duration = Math.max(0, Number(current?.duration || 0));
  const anchorAge = state.timelineAnchorAt ? Math.max(0, (Date.now() - state.timelineAnchorAt) / 1000) : 0;
  const elapsed = current ? Math.max(0, Number(state.runtime?.elapsed || 0) + anchorAge) : 0;
  const remaining = duration > 0 ? Math.max(0, duration - elapsed) : null;
  const startedAt = current ? new Date(now.getTime() - elapsed * 1000) : null;
  const endsAt = remaining === null ? null : new Date(now.getTime() + remaining * 1000);
  let cursor = endsAt || now;
  const forecast = pending.slice(0, 10).map((item) => {
    const backendStart = estimatedClockDate(item.estimated_time, now);
    const start = backendStart && backendStart.getTime() >= now.getTime() - 5000 ? backendStart : new Date(cursor);
    const itemDuration = Math.max(0, Number(item.duration || 0));
    const end = itemDuration > 0 ? new Date(start.getTime() + itemDuration * 1000) : null;
    cursor = end || start;
    return { item, start, end, duration: itemDuration };
  });
  return { current, duration, elapsed, remaining, startedAt, endsAt, forecast };
}

function renderTimeline() {
  const now = new Date();
  const timeline = timelineSnapshot(now);
  $('timelineClock').textContent = formatClock(now);
  if (!timeline.current) {
    $('timelineNowTitle').textContent = 'No track is currently playing';
    $('timelineNowArtist').textContent = state.runtime?.running ? 'Waiting for the next queue item' : 'Broadcast is stopped';
    $('timelineRemaining').textContent = '--:--';
    $('timelineEndTime').textContent = 'End time unavailable';
    $('timelineProgressBar').style.width = '0%';
  } else {
    $('timelineNowTitle').textContent = timeline.current.title || 'Untitled';
    $('timelineNowArtist').textContent = timeline.current.artist || timeline.current.track_type || selectedStationName();
    $('timelineRemaining').textContent = timeline.remaining === null ? '--:--' : formatDuration(timeline.remaining);
    $('timelineEndTime').textContent = timeline.endsAt ? `Ends ${formatClock(timeline.endsAt)}` : 'Duration unavailable';
    const progress = timeline.duration > 0 ? Math.max(0, Math.min(100, (timeline.elapsed / timeline.duration) * 100)) : 0;
    $('timelineProgressBar').style.width = `${progress.toFixed(2)}%`;
  }
  $('forecastList').innerHTML = timeline.forecast.length ? timeline.forecast.map(({ item, start, end, duration }, index) => `
    <li class="forecast-item">
      <span class="forecast-index">${String(index + 1).padStart(2, '0')}</span>
      <span class="forecast-track"><b>${escapeHtml(item.title || 'Untitled')}</b><span>${escapeHtml(item.artist || item.track_type || '')}${duration > 0 ? ` · ${formatDuration(duration)}` : ''}</span></span>
      <span class="forecast-time"><b>${formatClock(start)}</b><small>${end ? `ends ${formatClock(end)}` : 'end unknown'}</small></span>
    </li>`).join('') : '<li class="empty-state">No upcoming songs are queued.</li>';
}

function startTimelineTimer() {
  stopTimelineTimer();
  renderTimeline();
  state.timelineTimer = window.setInterval(renderTimeline, 1000);
}

function stopTimelineTimer() {
  if (state.timelineTimer) window.clearInterval(state.timelineTimer);
  state.timelineTimer = null;
}

async function loadLibrary(page = state.libraryPage) {
  const search = encodeURIComponent($('librarySearch').value.trim());
  const type = encodeURIComponent($('libraryType').value);
  const payload = await api(`/api/tracks?station_id=${state.stationId}&page=${Math.max(1, page)}&per_page=12&search=${search}&track_type=${type}`);
  state.library = Array.isArray(payload?.tracks) ? payload.tracks : (payload?.items || []);
  state.libraryPage = Number(payload?.page || 1);
  state.libraryPages = Number(payload?.total_pages || 1);
  state.libraryTotal = Number(payload?.total || state.library.length);
  $('libraryCount').textContent = String(state.libraryTotal);
  $('libraryPage').textContent = `Page ${state.libraryPage} of ${state.libraryPages}`;
  renderLibrary();
  renderLibraryProfile();
  syncActionButtons();
}

function renderLibrary() {
  const node = $('libraryList');
  if (!state.library.length) {
    node.innerHTML = '<div class="empty-state">No matching audio found.</div>';
    return;
  }
  node.innerHTML = state.library.map((track) => `<div class="media-row">
    <div class="media-title"><small>${escapeHtml(track.track_type || 'music')}</small><b>${escapeHtml(track.title || 'Untitled')}</b><span>${escapeHtml(track.artist || track.album || 'Unknown artist')}</span></div>
    <div class="row-actions"><button class="icon-button add" data-add-track="${Number(track.id)}" title="Add to queue" aria-label="Add ${escapeHtml(track.title)} to queue">+ Queue</button></div>
  </div>`).join('');
}

async function loadJingles() {
  const payload = await api(`/api/tracks?station_id=${state.stationId}&track_type=jingle&per_page=50`);
  state.jingles = Array.isArray(payload?.tracks) ? payload.tracks : (payload?.items || []);
  $('jingleCount').textContent = String(state.jingles.length);
  $('jingleList').innerHTML = state.jingles.length ? state.jingles.map((track) => `<div class="media-row"><div class="media-title"><b>${escapeHtml(track.title || 'Untitled jingle')}</b><span>${escapeHtml(track.artist || 'Jingle')}</span></div><button class="icon-button add" data-add-track="${Number(track.id)}">+ Queue</button></div>`).join('') : '<div class="empty-state">No jingles loaded for this station.</div>';
}

async function syncLibraryFolder(event) {
  event.preventDefault();
  const folder = $('libraryFolder').value.trim();
  if (!folder) {
    setResult('librarySyncResult', 'Enter the full folder path that belongs to this station.', 'error');
    return;
  }
  const replace = $('libraryReplaceOutside').checked;
  const payload = {
    station_id: state.stationId,
    folder,
    recursive: $('libraryRecursive').checked,
    track_type: 'music',
    mode: replace ? 'replace' : 'merge',
    skip_unplayable: $('librarySkipUnplayable').checked,
    remove_pending_queue: replace,
    profile_label: $('libraryProfileLabel').value.trim(),
    default_genre: $('libraryDefaultGenre').value.trim(),
    default_language: $('libraryDefaultLanguage').value.trim(),
  };
  setBusy(true, 'Synchronizing station library…', replace
    ? 'Importing this folder, deactivating other music, rebuilding queue, and verifying'
    : 'Importing this folder and verifying every file');
  setResult('librarySyncResult');
  try {
    const result = await api('/api/library/folder/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: 600000,
      idempotent: true,
      transportAttempts: 2,
    });
    if (!result?.verified) throw new Error('Backend did not verify the managed library');
    delete $('libraryFolder').dataset.dirty;
    delete $('libraryProfileLabel').dataset.dirty;
    delete $('libraryDefaultGenre').dataset.dirty;
    delete $('libraryDefaultLanguage').dataset.dirty;
    await Promise.all([loadCoreStatus(), loadQueue(), loadLibrary(1), loadJingles(), loadOperatorConfiguration()]);
    const skipped = Number(result.invalid_files_skipped || 0);
    const message = `Verified: ${result.active_files} ${payload.profile_label || payload.default_genre || 'music'} file(s) are active for ${selectedStationName()}; ${result.added} added, ${result.deactivated} outside the folder deactivated, ${result.pending_queue_items_removed} stale queue item(s) removed${skipped ? `, ${skipped} unreadable file(s) skipped and reported` : ''}.`;
    setResult('librarySyncResult', message, 'success');
    logActivity(message);
    toast('Station library synchronized and verified');
  } catch (error) {
    const message = errorMessage(error);
    setResult('librarySyncResult', message, 'error');
    logActivity(`Library synchronization failed: ${message}`, 'error');
    toast(message, 'error');
  } finally {
    setBusy(false);
  }
}

async function requestManagedLibraryRescan() {
  setBusy(true, 'Queuing managed-folder rescan…', 'The watcher waits for files to finish copying before validation');
  setResult('librarySyncResult');
  try {
    const result = await api('/api/library/watcher/rescan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station_id: state.stationId, track_type: 'music' }),
      idempotent: true,
    });
    state.libraryWatcher = result;
    const queued = Number(result?.queued_profiles || 0);
    const message = queued
      ? 'Managed-folder rescan queued. New or changed files will be validated after they are stable.'
      : 'No managed music folder is active for this station. Save and verify a folder first.';
    setResult('librarySyncResult', message, queued ? 'success' : 'error');
    renderLibraryProfile();
  } catch (error) {
    const message = errorMessage(error);
    setResult('librarySyncResult', message, 'error');
    logActivity(`Managed-folder rescan failed: ${message}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function refreshUnifiedMedia() {
  setBusy(true, 'Refreshing unified media views…', 'Building staged hardlinks and queuing the managed-library watcher');
  setResult('unifiedMediaResult');
  try {
    const result = await api('/api/library/unified-media/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_library_rescan: true }),
      timeoutMs: 600000,
      idempotent: true,
    });
    state.libraryWatcher = result.watcher || state.libraryWatcher;
    state.unifiedMedia = await api('/api/library/unified-media/status');
    renderUnifiedMedia();
    renderLibraryProfile();
    await Promise.all([loadLibrary(1), loadJingles()]);
    const total = Object.values(result.views || {}).reduce((sum, count) => sum + Number(count || 0), 0);
    const queued = Number(result.library_rescan_queued_profiles || 0);
    const message = `Verified: ${total} hardlink view file(s) refreshed. ${queued} managed library profile(s) queued for safe rescan.`;
    setResult('unifiedMediaResult', message, 'success');
    logActivity(message);
    toast('Unified media views refreshed');
  } catch (error) {
    const message = errorMessage(error);
    setResult('unifiedMediaResult', message, 'error');
    logActivity(`Unified media refresh failed: ${message}`, 'error');
    toast(message, 'error');
    try {
      state.unifiedMedia = await api('/api/library/unified-media/status');
      renderUnifiedMedia();
    } catch (_) {
      // Preserve the original refresh failure for the operator.
    }
  } finally {
    setBusy(false);
  }
}

async function pickManagedFolder(inputId, description) {
  const input = $(inputId);
  setBusy(true, 'Choose a folder…', 'Use the native folder window, then return here');
  try {
    const result = await api('/api/operator/pick-folder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initial_folder: input.value.trim(), description }),
      timeoutMs: 610000,
    });
    if (result?.selected && result.folder) {
      input.value = result.folder;
      input.dataset.dirty = '1';
      input.focus();
      toast('Folder selected');
    }
  } catch (error) {
    const message = errorMessage(error); toast(message, 'error'); logActivity(`Folder selection failed: ${message}`, 'error');
  } finally { setBusy(false); }
}

async function refreshAll(silent = false) {
  // Verified mutations call this before their busy overlay is released. Silent
  // refreshes must still replace station-scoped caches (library, queue,
  // jingles, and settings), otherwise a newly selected station can briefly
  // display the previous station's controls and media.
  if (!state.stationId || (state.busy && !silent)) return;
  if (!silent) setConnection('', 'Refreshing');
  try {
    await Promise.all([loadCoreStatus(), loadQueue(), loadLibrary(1), loadJingles(), loadOperatorConfiguration()]);
    setConnection('online', 'Backend connected');
  } catch (error) {
    setConnection('offline', 'Connection failed');
    if (!silent) toast(errorMessage(error), 'error');
  }
}

async function saveBroadcastAutostart(enabled) {
  const payload = await api('/api/settings/station', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      station_id: state.stationId,
      broadcast_autostart_enabled: enabled ? 'true' : 'false',
    }),
    idempotent: true,
  });
  const saved = payload?.settings || payload || {};
  if (asBool(saved.broadcast_autostart_enabled) !== Boolean(enabled)) {
    const readBack = await api(`/api/settings/station?station_id=${state.stationId}`);
    const settings = readBack?.settings || readBack || {};
    if (asBool(settings.broadcast_autostart_enabled) !== Boolean(enabled)) {
      throw new Error('Backend did not persist the station broadcast start policy');
    }
  }
}

async function updateBroadcastAutostartFromControl() {
  const enabled = $('broadcastAutostartEnabled').checked;
  setBusy(true, 'Saving restart policy…', 'Persisting and verifying the selected station');
  setResult('broadcastResult');
  try {
    await saveBroadcastAutostart(enabled);
    clearFormDirty(['broadcastAutostartEnabled']);
    const message = enabled
      ? `Verified: ${selectedStationName()} will resume automatically when OnAir restarts.`
      : `Verified: ${selectedStationName()} will remain stopped when OnAir restarts.`;
    setResult('broadcastResult', message, 'success');
    logActivity(message);
    toast('Restart policy verified');
  } catch (error) {
    const message = errorMessage(error);
    setResult('broadcastResult', message, 'error');
    logActivity(`Restart policy failed: ${message}`, 'error');
    toast(message, 'error');
    await loadOperatorConfiguration().catch(() => {});
  } finally {
    setBusy(false);
  }
}

async function startBroadcast() {
  if (state.startArmedUntil <= Date.now()) {
    state.startArmedUntil = Date.now() + 20000;
    $('startBroadcastButton').textContent = 'Confirm start broadcast';
    setResult('broadcastResult', `Click “Confirm start broadcast” within 20 seconds to take ${selectedStationName()} on air.`);
    state.startArmTimer = window.setTimeout(() => {
      disarmStartBroadcast();
      setResult('broadcastResult', 'Start confirmation expired; nothing was changed.');
    }, 20000);
    return;
  }
  disarmStartBroadcast();
  disarmStopBroadcast();
  const resumeAfterRestart = $('broadcastAutostartEnabled').checked;
  setBusy(true, 'Starting broadcast…', 'Starting scheduler and verifying live output');
  setResult('broadcastResult');
  try {
    const current = await api(`/api/runtime/${state.stationId}/status`);
    const started = await verifiedMutation(async () => {
      await saveBroadcastAutostart(resumeAfterRestart);
      clearFormDirty(['broadcastAutostartEnabled']);
      if (!current?.worker_loop?.running) {
        await api(`/api/runtime/${state.stationId}/operator-start`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fallback_uri: '', interval_sec: 1 }), idempotent: true, timeoutMs: 45000,
        });
      } else {
        await api(`/api/runtime/${state.stationId}/operator-supervise`, { method: 'POST', idempotent: true });
      }
    }, async () => {
      const [health, settingPayload] = await Promise.all([
        api(`/api/health?station_id=${state.stationId}`),
        api(`/api/settings/station?station_id=${state.stationId}`),
      ]);
      const settings = settingPayload?.settings || settingPayload || {};
      const runtime = health.runtime || {};
      const branch = health.runtime_branch_health || {};
      const verified = Boolean(
        asBool(settings.broadcast_autostart_enabled) === resumeAfterRestart
        && health.worker_loop?.running
        && health.engine_running
        && runtime.running
        && runtime.output_feed_active
        && (branch.icecast || branch.local)
      );
      if (verified) state.health = health;
      return { verified, value: health };
    }, { attempts: 50, interval: 500, description: 'broadcast output' });
    state.health = started.value;
    renderCoreStatus();
    setResult(
      'broadcastResult',
      `Verified: scheduler, engine, and output feed are running under operator control. Restart policy is ${resumeAfterRestart ? 'enabled' : 'disabled'}. Any preserved item resumes from the front without changing queue order.`,
      'success',
    );
    logActivity(`Started broadcasting ${selectedStationName()}`);
    toast('Broadcast start verified');
  } catch (error) {
    const message = errorMessage(error);
    setResult('broadcastResult', message, 'error');
    logActivity(`Broadcast start failed: ${message}`, 'error');
    toast(message, 'error');
  } finally {
    setBusy(false);
    await loadCoreStatus().catch(() => {});
  }
}

async function stopBroadcast() {
  if (state.stopArmedUntil <= Date.now()) {
    disarmStartBroadcast();
    state.stopArmedUntil = Date.now() + 20000;
    $('stopBroadcastButton').textContent = 'Confirm stop — keep playlist';
    setResult('broadcastResult', `Click “Confirm stop — keep playlist” within 20 seconds to stop ${selectedStationName()} without clearing or advancing its queue.`);
    state.stopArmTimer = window.setTimeout(() => {
      disarmStopBroadcast();
      setResult('broadcastResult', 'Stop confirmation expired; nothing was changed.');
    }, 20000);
    return;
  }
  disarmStopBroadcast();
  setBusy(true, 'Stopping stream…', 'Freezing scheduler state, preserving the playlist, and verifying silence');
  setResult('broadcastResult');
  try {
    const stopped = await verifiedMutation(async () => {
      await saveBroadcastAutostart(false);
      $('broadcastAutostartEnabled').checked = false;
      clearFormDirty(['broadcastAutostartEnabled']);
      return api(`/api/runtime/${state.stationId}/operator-stop`, { method: 'POST', idempotent: true });
    }, async () => {
      const [runtime, settingPayload] = await Promise.all([
        api(`/api/runtime/${state.stationId}/status`),
        api(`/api/settings/station?station_id=${state.stationId}`),
      ]);
      const settings = settingPayload?.settings || settingPayload || {};
      const verified = !asBool(settings.broadcast_autostart_enabled) && !runtime?.running && !runtime?.worker_loop?.running;
      if (verified) state.runtime = runtime;
      return { verified, value: runtime };
    }, { attempts: 30, interval: 350, description: 'stopped runtime and scheduler' });
    const stoppedRuntime = stopped.value;
    const preservation = stopped.mutationResult || {};
    state.runtime = stoppedRuntime;
    state.health = {
      ...(state.health || {}),
      engine_running: false,
      runtime_branch_health: { icecast: false, local: false },
      runtime: {
        ...((state.health || {}).runtime || {}),
        ...stoppedRuntime,
        running: false,
        output_feed_active: false,
      },
      worker_loop: {
        ...((state.health || {}).worker_loop || {}),
        ...(stoppedRuntime.worker_loop || {}),
        running: false,
      },
    };
    renderCoreStatus();
    setResult(
      'broadcastResult',
      `Verified: stream and scheduler are stopped; ${Number(preservation.queue_items_after || 0)} playlist item(s) remain in order. The interrupted item will restart from its beginning when you resume.`,
      'success',
    );
    logActivity(`Stopped broadcasting ${selectedStationName()}`);
    toast('Broadcast stop verified');
  } catch (error) {
    const message = errorMessage(error);
    setResult('broadcastResult', message, 'error');
    logActivity(`Broadcast stop failed: ${message}`, 'error');
    toast(message, 'error');
  } finally {
    setBusy(false);
    await loadCoreStatus().catch(() => {});
  }
}

async function setAiEnabled(enabled) {
  setBusy(true, enabled ? 'Enabling AI host…' : 'Disabling AI host…', 'Saving and reading the setting back');
  setResult('aiResult');
  try {
    const current = await api(`/api/ai/settings?station_id=${state.stationId}`);
    const payload = {
      station_id: state.stationId,
      ai_host_enabled: Boolean(enabled),
      llm_model: current.llm_model,
      tts_provider: current.tts_provider,
      tts_model_path: current.tts_model_path,
      voice_persona: current.voice_persona,
      announcement_max_seconds: Number(current.announcement_max_seconds || 15),
      include_music_history: asBool(current.include_music_history),
      educational_segments_enabled: asBool(current.educational_segments_enabled),
      station_id_announcement_interval: Number(current.station_id_announcement_interval || 1800),
      prompt_template: current.prompt_template,
    };
    const changed = await verifiedMutation(() => api('/api/ai/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      timeoutMs: 30000, idempotent: true,
    }), async () => {
      const saved = await api(`/api/ai/settings?station_id=${state.stationId}`);
      return { verified: asBool(saved.ai_host_enabled) === Boolean(enabled), value: saved };
    }, { attempts: 16, interval: 350, description: `AI ${enabled ? 'enabled' : 'disabled'} setting` });
    state.ai = changed.value;
    clearFormDirty(['aiConfigEnabled']);
    renderAiConfiguration();
    setResult('aiResult', `Verified: AI host is ${enabled ? 'enabled' : 'disabled'}.`, 'success');
    logActivity(`${enabled ? 'Enabled' : 'Disabled'} AI host for ${selectedStationName()}`);
    toast(`AI host ${enabled ? 'enabled' : 'disabled'}`);
  } catch (error) {
    const message = errorMessage(error);
    setResult('aiResult', message, 'error');
    logActivity(`AI change failed: ${message}`, 'error');
    toast(message, 'error');
  } finally {
    setBusy(false);
    await loadCoreStatus().catch(() => {});
  }
}

function aiPayloadFromForm() {
  const maxSeconds = Number($('aiMaxSeconds').value);
  const stationInterval = Number($('aiStationInterval').value);
  if (!Number.isFinite(maxSeconds) || maxSeconds < 3 || maxSeconds > 120) throw new Error('Maximum announcement must be between 3 and 120 seconds');
  if (!Number.isFinite(stationInterval) || stationInterval < 60 || stationInterval > 86400) throw new Error('Station ID interval must be between 60 and 86400 seconds');
  const llmModel = $('aiLlmModel').value.trim();
  const prompt = $('aiPromptTemplate').value.trim();
  if (!llmModel) throw new Error('Enter the language model name');
  if (!prompt) throw new Error('Enter an AI prompt template');
  return {
    station_id: state.stationId,
    ai_host_enabled: $('aiConfigEnabled').checked,
    llm_model: llmModel,
    tts_provider: $('aiTtsProvider').value,
    tts_model_path: $('aiTtsModelPath').value.trim(),
    voice_persona: $('aiVoicePersona').value,
    announcement_max_seconds: maxSeconds,
    include_music_history: $('aiIncludeHistory').checked,
    educational_segments_enabled: $('aiEducational').checked,
    station_id_announcement_interval: stationInterval,
    prompt_template: prompt,
  };
}

function aiSettingsMatch(saved, payload) {
  return Boolean(saved)
    && asBool(saved.ai_host_enabled) === payload.ai_host_enabled
    && String(saved.llm_model || '') === payload.llm_model
    && String(saved.tts_provider || '') === payload.tts_provider
    && String(saved.tts_model_path || '') === payload.tts_model_path
    && String(saved.voice_persona || '') === payload.voice_persona
    && Number(saved.announcement_max_seconds) === payload.announcement_max_seconds
    && asBool(saved.include_music_history) === payload.include_music_history
    && asBool(saved.educational_segments_enabled) === payload.educational_segments_enabled
    && Number(saved.station_id_announcement_interval) === payload.station_id_announcement_interval
    && String(saved.prompt_template || '') === payload.prompt_template;
}

async function persistAiPayload(payload) {
  const changed = await verifiedMutation(() => api('/api/ai/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    timeoutMs: 45000, idempotent: true,
  }), async () => {
    const saved = await api(`/api/ai/settings?station_id=${state.stationId}`);
    return { verified: aiSettingsMatch(saved, payload), value: saved };
  }, { attempts: 18, interval: 350, description: 'saved AI configuration' });
  state.ai = changed.value;
  clearFormDirty(['aiConfigEnabled', 'aiLlmModel', 'aiTtsProvider', 'aiVoicePersona', 'aiTtsModelPath', 'aiMaxSeconds', 'aiStationInterval', 'aiIncludeHistory', 'aiEducational', 'aiPromptTemplate']);
  renderAiConfiguration();
  return changed;
}

async function saveAiConfiguration(event) {
  event.preventDefault();
  setResult('aiConfigResult');
  let payload;
  try { payload = aiPayloadFromForm(); } catch (error) {
    setResult('aiConfigResult', errorMessage(error), 'error');
    return;
  }
  setBusy(true, 'Saving AI configuration…', 'Writing every setting and reading it back');
  try {
    await persistAiPayload(payload);
    await loadOperatorConfiguration();
    const message = `Verified: AI configuration was saved${payload.ai_host_enabled ? ' and enabled' : ' with AI disabled'}.`;
    setResult('aiConfigResult', message, 'success'); setResult('aiResult', message, 'success'); logActivity(message); toast('AI configuration verified');
  } catch (error) {
    const message = errorMessage(error); setResult('aiConfigResult', message, 'error'); logActivity(`AI configuration failed: ${message}`, 'error'); toast(message, 'error');
  } finally {
    setBusy(false);
    await loadCoreStatus().catch(() => {});
  }
}

async function runAiTest() {
  setResult('aiConfigResult');
  let payload;
  try { payload = aiPayloadFromForm(); } catch (error) {
    setResult('aiConfigResult', errorMessage(error), 'error'); return;
  }
  if (!payload.ai_host_enabled) {
    setResult('aiConfigResult', 'Enable AI host before generating a voice test.', 'error');
    return;
  }
  setBusy(true, 'Generating AI test voice…', 'Saving settings, warming the selected runtime, synthesizing audio, and verifying the result');
  try {
    await persistAiPayload(payload);
    const tested = await verifiedMutation(() => api('/api/setup/test-ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station_id: state.stationId }), timeoutMs: 240000,
    }), async () => {
      const setup = await api(`/api/setup/state?station_id=${state.stationId}`);
      const check = (setup.checks || []).find((item) => item.name === 'ai_tts');
      return { verified: Boolean(check?.details?.test_passed), value: setup };
    }, { attempts: 20, interval: 1000, description: 'generated AI voice test' });
    state.setupState = tested.value;
    const aiCheck = (state.setupState.checks || []).find((item) => item.name === 'ai_tts');
    if (aiCheck?.details?.runtime_ready) {
      state.setupState = await api('/api/setup/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ station_id: state.stationId, check: 'ai_tts' }), idempotent: true, timeoutMs: 45000,
      });
    }
    renderReadiness();
    const message = aiCheck?.message || 'Verified: the AI voice test generated playable audio.';
    setResult('aiConfigResult', message, 'success'); logActivity(message); toast('AI voice test verified');
  } catch (error) {
    await loadOperatorConfiguration().catch(() => {});
    const aiCheck = (state.setupState?.checks || []).find((item) => item.name === 'ai_tts');
    const message = aiCheck?.message || errorMessage(error);
    setResult('aiConfigResult', message, 'error'); logActivity(`AI voice test failed: ${message}`, 'error'); toast(message, 'error');
  } finally { setBusy(false); }
}

async function refreshReadiness() {
  setBusy(true, 'Running installation self-check…', 'Inspecting media tools, outputs, AI, and startup readiness');
  setResult('readinessResult');
  try {
    await loadOperatorConfiguration();
    const blocking = state.setupState?.blocking_reasons || state.setupState?.blocking || [];
    const message = state.setupState?.can_complete ? 'Verified: every required station check is ready.' : `Self-check finished: ${blocking.length} required item(s) need attention.`;
    setResult('readinessResult', message, state.setupState?.can_complete ? 'success' : 'error');
    logActivity(message, state.setupState?.can_complete ? 'success' : 'error');
  } catch (error) {
    const message = errorMessage(error); setResult('readinessResult', message, 'error'); logActivity(`Self-check failed: ${message}`, 'error'); toast(message, 'error');
  } finally { setBusy(false); }
}

async function repairDependencies() {
  setBusy(true, 'Repairing managed dependencies…', 'Checking and installing the runtimes supplied by this radio package');
  setResult('readinessResult');
  try {
    const repaired = await api('/api/setup/repair-dependencies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station_id: state.stationId }), timeoutMs: 600000, idempotent: true, transportAttempts: 2,
    });
    state.setupState = repaired || {};
    renderReadiness();
    const blocking = state.setupState.blocking || [];
    const message = state.setupState.can_complete ? 'Verified: managed dependencies and all required checks are ready.' : `Repair finished; ${blocking.length} station item(s) still need attention.`;
    setResult('readinessResult', message, state.setupState.can_complete ? 'success' : 'error');
    logActivity(message, state.setupState.can_complete ? 'success' : 'error'); toast('Dependency repair finished');
  } catch (error) {
    const message = errorMessage(error); setResult('readinessResult', message, 'error'); logActivity(`Dependency repair failed: ${message}`, 'error'); toast(message, 'error');
  } finally { setBusy(false); }
}

async function changePassword(event) {
  event.preventDefault();
  const currentPassword = $('currentPassword').value;
  const newPassword = $('newPassword').value;
  if (newPassword !== $('repeatPassword').value) {
    setResult('passwordResult', 'The two new password fields do not match.', 'error'); return;
  }
  if (newPassword.length < 5) {
    setResult('passwordResult', 'The new password must contain at least 5 characters.', 'error'); return;
  }
  setBusy(true, 'Changing password…', 'Updating credentials and revoking older sessions');
  setResult('passwordResult');
  try {
    await api('/api/auth/password', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }), timeoutMs: 20000,
    });
    $('passwordForm').reset();
    clearSession();
    setBusy(false);
    showLogin();
    $('loginError').textContent = 'Password changed. Sign in with your new password.';
  } catch (error) {
    const message = errorMessage(error); setResult('passwordResult', message, 'error'); logActivity(`Password change failed: ${message}`, 'error'); toast(message, 'error'); setBusy(false);
  }
}

async function syncJingleFolder(event) {
  event.preventDefault();
  const folder = $('jingleFolder').value.trim();
  if (!folder) { setResult('jingleResult', 'Enter the full jingle folder path.', 'error'); return; }
  const replace = $('jingleFolderReplace').checked;
  setBusy(true, 'Synchronizing jingle folder…', 'Importing, reconciling, and verifying station jingles');
  setResult('jingleResult');
  try {
    const result = await api('/api/library/folder/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, timeoutMs: 600000, idempotent: true, transportAttempts: 2,
      body: JSON.stringify({ station_id: state.stationId, folder, recursive: true, track_type: 'jingle', mode: replace ? 'replace' : 'merge', remove_pending_queue: replace, profile_label: 'Jingles' }),
    });
    if (!result?.verified || result.track_type !== 'jingle') throw new Error('Backend did not verify the jingle folder');
    delete $('jingleFolder').dataset.dirty;
    await Promise.all([loadCoreStatus(), loadJingles(), loadQueue()]);
    const message = `Verified: ${result.active_files} station jingle(s) are active; ${result.added} added and ${result.deactivated} deactivated.`;
    setResult('jingleResult', message, 'success'); logActivity(message); toast('Jingle folder verified');
  } catch (error) {
    const message = errorMessage(error); setResult('jingleResult', message, 'error'); logActivity(`Jingle folder sync failed: ${message}`, 'error'); toast(message, 'error');
  } finally { setBusy(false); }
}

async function createStation(event) {
  event.preventDefault();
  const name = $('stationName').value.trim();
  if (!name) return;
  const configure = $('configureIcecast').checked;
  setBusy(true, 'Creating station…', configure ? 'Creating, configuring output, and verifying' : 'Creating and verifying');
  setResult('stationResult');
  let createdId = null;
  try {
    const created = await api('/api/stations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description: $('stationDescription').value.trim() }) });
    createdId = Number(created?.station?.id || created?.id || 0);
    if (!createdId) throw new Error('Backend did not return the new station ID');
    if (configure) {
      const profile = $('icecastProfile').value;
      await api('/api/stations/output', { method: 'POST', headers: { 'Content-Type': 'application/json' }, idempotent: true, body: JSON.stringify({
        station_id: createdId, local_output_enabled: false, output_device_id: '', icecast_enabled: true,
        icecast_host: $('icecastHost').value.trim(), icecast_port: Number($('icecastPort').value), icecast_mount: $('icecastMount').value.trim(),
        icecast_user: $('icecastUser').value.trim(), icecast_password: $('icecastPassword').value, output_gain_db: 0,
        stream_codec_profile: profile, stream_bitrate_kbps: profile === 'mp3_128' ? 128 : 196,
      }) });
      await api('/api/settings/station', { method: 'POST', headers: { 'Content-Type': 'application/json' }, idempotent: true, body: JSON.stringify({ station_id: createdId, output_mode: 'icecast' }) });
    }
    if ($('activateNewStation').checked) await api('/api/stations/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, idempotent: true, body: JSON.stringify({ station_id: createdId }) });
    await poll(async () => {
      const stations = await api('/api/stations');
      const found = (stations.stations || []).find((station) => Number(station.id) === createdId && station.name === name);
      if (!found) return { verified: false };
      if (!configure) return { verified: true, value: found };
      const output = await api(`/api/stations/output?station_id=${createdId}`);
      const verified = output.icecast_enabled && output.icecast_host === $('icecastHost').value.trim() && Number(output.icecast_port) === Number($('icecastPort').value) && output.icecast_mount === $('icecastMount').value.trim();
      return { verified, value: found };
    }, { attempts: 12, interval: 350, description: 'new station and output configuration' });
    await loadStations(createdId);
    $('stationForm').reset();
    $('configureIcecast').checked = true;
    $('icecastHost').value = '127.0.0.1'; $('icecastPort').value = '8000'; $('icecastMount').value = '/new-station'; delete $('icecastMount').dataset.edited; $('icecastUser').value = 'source'; $('icecastProfile').value = 'aac_plus_196';
    toggleIcecastFields();
    setResult('stationResult', `Verified: ${name} was created${configure ? ' with its Icecast output' : ''}.`, 'success');
    logActivity(`Created station ${name}${configure ? ' and verified Icecast output' : ''}`);
    toast('Station creation verified');
    await refreshAll(true);
  } catch (error) {
    let message = errorMessage(error);
    if (createdId) {
      try {
        await api(`/api/stations/${createdId}`, { method: 'DELETE' });
        message += ' The incomplete station was rolled back.';
      } catch (rollbackError) {
        message += ` Rollback also failed: ${errorMessage(rollbackError)}`;
      }
    }
    setResult('stationResult', message, 'error');
    logActivity(`Station creation failed: ${message}`, 'error');
    toast(message, 'error');
  } finally {
    setBusy(false);
  }
}

function toggleIcecastFields() {
  const enabled = $('configureIcecast').checked;
  $('icecastFields').hidden = !enabled;
  $('icecastFields').querySelectorAll('input,select').forEach((node) => { node.disabled = !enabled; });
}

function toggleCurrentOutputFields() {
  const icecastEnabled = $('currentIcecastEnabled')?.checked;
  const localEnabled = $('currentLocalEnabled')?.checked;
  if ($('currentIcecastFields')) {
    $('currentIcecastFields').hidden = !icecastEnabled;
    $('currentIcecastFields').querySelectorAll('input,select').forEach((node) => {
      node.disabled = !icecastEnabled;
      if (node.id !== 'currentIcecastPassword' && node.type !== 'checkbox') {
        node.required = Boolean(icecastEnabled);
      }
    });
  }
  if ($('currentDeviceLabel')) $('currentDeviceLabel').hidden = !localEnabled;
  if ($('currentOutputDevice')) {
    $('currentOutputDevice').disabled = !localEnabled;
    $('currentOutputDevice').required = Boolean(localEnabled);
  }
}

function currentOutputPayload() {
  const icecastEnabled = $('currentIcecastEnabled').checked;
  const localEnabled = $('currentLocalEnabled').checked;
  if (!icecastEnabled && !localEnabled) throw new Error('Enable at least one output: Icecast or local monitor');
  const mount = $('currentIcecastMount').value.trim();
  const password = $('currentIcecastPassword').value;
  if (icecastEnabled && !mount.startsWith('/')) throw new Error('Icecast mount must start with /');
  const existingCredential = Boolean(state.stationOutput?.icecast_password_configured);
  if (icecastEnabled && !password && !existingCredential) {
    throw new Error('Enter the Icecast source password');
  }
  if (localEnabled && !$('currentOutputDevice').value) throw new Error('Choose a local monitor device');
  const profile = $('currentIcecastProfile').value;
  return {
    station_id: state.stationId,
    local_output_enabled: localEnabled,
    output_device_id: localEnabled ? $('currentOutputDevice').value : '',
    icecast_enabled: icecastEnabled,
    icecast_host: $('currentIcecastHost').value.trim(),
    icecast_port: Number($('currentIcecastPort').value),
    icecast_mount: mount,
    icecast_user: $('currentIcecastUser').value.trim(),
    icecast_password: password,
    icecast_tls_enabled: $('currentIcecastTlsEnabled').checked,
    output_gain_db: Number($('currentOutputGain').value || 0),
    stream_codec_profile: profile,
    stream_bitrate_kbps: profile === 'mp3_128' ? 128 : 196,
  };
}

function outputMatches(saved, payload) {
  return Boolean(saved)
    && Boolean(saved.local_output_enabled) === payload.local_output_enabled
    && String(saved.output_device_id || '') === payload.output_device_id
    && Boolean(saved.icecast_enabled) === payload.icecast_enabled
    && String(saved.icecast_host || '') === payload.icecast_host
    && Number(saved.icecast_port) === payload.icecast_port
    && String(saved.icecast_mount || '') === payload.icecast_mount
    && String(saved.icecast_user || '') === payload.icecast_user
    && Boolean(saved.icecast_tls_enabled) === payload.icecast_tls_enabled
    && (!payload.icecast_enabled || Boolean(saved.icecast_password_configured))
    && String(saved.stream_codec_profile || '') === payload.stream_codec_profile
    && Number(saved.stream_bitrate_kbps) === payload.stream_bitrate_kbps;
}

function clearFormDirty(ids) {
  ids.forEach((id) => { const node = $(id); if (node) delete node.dataset.dirty; });
}

async function saveCurrentOutput(event) {
  event.preventDefault();
  setResult('outputConfigResult');
  let payload;
  try { payload = currentOutputPayload(); } catch (error) {
    setResult('outputConfigResult', errorMessage(error), 'error');
    return;
  }
  const stationName = $('currentStationName').value.trim();
  if (!stationName) return;
  const runtimeBefore = await api(`/api/runtime/${state.stationId}/status`).catch(() => ({}));
  const wasRunning = Boolean(runtimeBefore.running && runtimeBefore.output_feed_active);
  setBusy(true, 'Saving station output…', wasRunning ? 'Saving, applying to the live runtime, and verifying every required output' : 'Saving and reading the configuration back');
  try {
    const stored = await verifiedMutation(async () => {
      await api(`/api/stations/${state.stationId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: stationName }), idempotent: true,
      });
      await api('/api/stations/output', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), idempotent: true,
      });
    }, async () => {
      const [stationsPayload, output] = await Promise.all([
        api('/api/stations'), api(`/api/stations/output?station_id=${state.stationId}`),
      ]);
      const named = (stationsPayload.stations || []).some((station) => Number(station.id) === Number(state.stationId) && station.name === stationName);
      return { verified: named && outputMatches(output, payload), value: { stationsPayload, output } };
    }, { attempts: 18, interval: 350, description: 'saved station identity and output configuration' });
    state.stationOutput = stored.value.output;
    state.stations = stored.value.stationsPayload.stations || state.stations;

    let liveApplied = false;
    if (wasRunning && runtimeBefore.active_input_uri) {
      const current = state.queue.find((item) => item.is_current || String(item.status) === 'playing') || {};
      const applied = await verifiedMutation(() => api(`/api/runtime/${state.stationId}/operator-start-track`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input_uri: runtimeBefore.active_input_uri, stream_title: current.title || '', stream_artist: current.artist || '' }),
        timeoutMs: 45000,
      }), async () => {
        const health = await api(`/api/health?station_id=${state.stationId}`);
        const branches = health.runtime_branch_health || health.runtime?.branch_health || {};
        const verified = Boolean(health.runtime?.running && health.runtime?.output_feed_active
          && (!payload.icecast_enabled || branches.icecast)
          && (!payload.local_output_enabled || branches.local));
        return { verified, value: health };
      }, { attempts: 50, interval: 500, description: 'applied live output branches' });
      state.health = applied.value;
      liveApplied = true;
    }

    clearFormDirty(['currentStationName', 'currentOutputGain', 'currentIcecastEnabled', 'currentIcecastHost', 'currentIcecastPort', 'currentIcecastMount', 'currentIcecastUser', 'currentIcecastPassword', 'currentIcecastProfile', 'currentIcecastTlsEnabled', 'currentLocalEnabled', 'currentOutputDevice']);
    await loadStations(state.stationId);
    await loadOperatorConfiguration();
    renderOutputConfiguration();
    const message = liveApplied
      ? 'Verified: station identity and output were saved and every required live branch is healthy.'
      : 'Verified: station identity and output were saved. They will be used on the next broadcast start.';
    setResult('outputConfigResult', message, 'success'); logActivity(message); toast('Station output verified');
  } catch (error) {
    const message = errorMessage(error); setResult('outputConfigResult', message, 'error'); logActivity(`Output configuration failed: ${message}`, 'error'); toast(message, 'error');
  } finally {
    setBusy(false);
    await loadCoreStatus().catch(() => {});
  }
}

async function testCurrentOutput() {
  setBusy(true, 'Testing stream destination…', 'Checking configuration, network reachability, and saved verification');
  setResult('outputConfigResult');
  try {
    const stateResult = await api(`/api/setup/state?station_id=${state.stationId}`);
    const streamCheck = (stateResult.checks || []).find((check) => check.name === 'stream_output');
    if (!$('currentIcecastEnabled').checked) throw new Error('Icecast is disabled for this station');
    if (!streamCheck?.details?.configured) throw new Error('Save a complete Icecast configuration before testing');
    if (!streamCheck?.details?.reachable) throw new Error(streamCheck?.message || 'The Icecast destination is not reachable');
    state.setupState = await api('/api/setup/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station_id: state.stationId, check: 'stream_output' }), idempotent: true,
    });
    renderReadiness();
    setResult('outputConfigResult', 'Verified: the stream destination is configured and reachable.', 'success');
    logActivity('Verified the current station stream destination'); toast('Stream destination verified');
  } catch (error) {
    const message = errorMessage(error); setResult('outputConfigResult', message, 'error'); logActivity(`Stream test failed: ${message}`, 'error'); toast(message, 'error');
  } finally { setBusy(false); }
}

function disarmStationDelete() {
  state.stationDeleteArmedUntil = 0;
  if (state.stationDeleteArmTimer) window.clearTimeout(state.stationDeleteArmTimer);
  state.stationDeleteArmTimer = null;
  $('deleteStationButton').textContent = 'Delete this station';
}

async function deleteCurrentStation() {
  if (state.stationDeleteArmedUntil <= Date.now()) {
    state.stationDeleteArmedUntil = Date.now() + 20000;
    $('deleteStationButton').textContent = `Confirm delete ${selectedStationName()}`;
    setResult('outputConfigResult', 'Click the delete button again within 20 seconds. This removes this station and its station-scoped data.');
    state.stationDeleteArmTimer = window.setTimeout(disarmStationDelete, 20000);
    return;
  }
  const deletingId = Number(state.stationId);
  const deletingName = selectedStationName();
  disarmStationDelete();
  setBusy(true, `Deleting ${deletingName}…`, 'Stopping only this station and verifying it is gone');
  try {
    await verifiedMutation(() => api(`/api/stations/${deletingId}`, { method: 'DELETE', timeoutMs: 45000 }), async () => {
      const stations = await api('/api/stations');
      return { verified: !(stations.stations || []).some((station) => Number(station.id) === deletingId), value: stations };
    }, { attempts: 20, interval: 400, description: 'station deletion' });
    await loadStations();
    clearFormDirty(['currentStationName', 'currentOutputGain', 'currentIcecastEnabled', 'currentIcecastHost', 'currentIcecastPort', 'currentIcecastMount', 'currentIcecastUser', 'currentIcecastPassword', 'currentIcecastProfile', 'currentIcecastTlsEnabled', 'currentLocalEnabled', 'currentOutputDevice']);
    await refreshAll(true);
    const message = `Verified: ${deletingName} was deleted.`;
    setResult('outputConfigResult', message, 'success'); logActivity(message); toast(message);
  } catch (error) {
    const message = errorMessage(error); setResult('outputConfigResult', message, 'error'); logActivity(`Station deletion failed: ${message}`, 'error'); toast(message, 'error');
  } finally { setBusy(false); }
}

async function addTrackToQueue(trackId) {
  const track = [...state.library, ...state.jingles].find((item) => Number(item.id) === Number(trackId));
  const alreadyPending = state.queue.some((item) => Number(item.track_id) === Number(trackId) && !item.is_played && String(item.status) !== 'done');
  setBusy(true, 'Adding to queue…', track?.title || `Track ${trackId}`);
  setResult('libraryResult'); setResult('queueResult');
  try {
    const queued = await verifiedMutation(() => api('/api/queue/push', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station_id: state.stationId, track_id: Number(trackId) }), idempotent: true,
    }), async () => {
      const queue = await api(`/api/queue?station_id=${state.stationId}`);
      state.queue = queue.items || [];
      const found = state.queue.some((item) => Number(item.track_id) === Number(trackId) && !item.is_played && String(item.status) !== 'done');
      return { verified: found, value: found };
    }, { attempts: 18, interval: 300, description: 'track in broadcast queue' });
    renderQueue();
    const deduped = alreadyPending || queued.mutationResult?.deduped;
    const message = deduped ? 'Track was already pending in the queue; no duplicate was created.' : `Verified: ${track?.title || 'Track'} was added to the queue.`;
    setResult('queueResult', message, 'success');
    logActivity(message);
    toast(deduped ? 'Already queued' : 'Queue insertion verified');
  } catch (error) {
    const message = errorMessage(error);
    setResult('queueResult', message, 'error');
    logActivity(`Queue insertion failed: ${message}`, 'error');
    toast(message, 'error');
  } finally { setBusy(false); }
}

async function queueAction(action, index) {
  setBusy(true, action === 'remove' ? 'Removing queue item…' : 'Reordering queue…', 'Saving and reading queue back');
  setResult('queueResult');
  const before = await api(`/api/queue?station_id=${state.stationId}`).catch(() => ({ items: [] }));
  const beforeItems = before.items || [];
  const target = beforeItems.find((item) => Number(item.queue_index ?? item.index) === Number(index));
  try {
    if (!target?.id) throw new Error('Queue item is no longer available; reload the queue and try again');
    const toIndex = action === 'up' ? Math.max(0, Number(index) - 1) : Number(index) + 1;
    await verifiedMutation(async () => {
      if (action === 'remove') {
        await api(`/api/queue/${index}?station_id=${state.stationId}`, { method: 'DELETE' });
      } else {
        await api('/api/queue/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ station_id: state.stationId, from_index: Number(index), to_index: toIndex }) });
      }
    }, async () => {
      const queue = await api(`/api/queue?station_id=${state.stationId}`);
      state.queue = queue.items || [];
      if (action === 'remove') {
        const exists = state.queue.some((item) => Number(item.id) === Number(target?.id) && !item.is_played);
        return { verified: !exists, value: queue };
      }
      const moved = state.queue.find((item) => Number(item.id) === Number(target.id));
      return { verified: Number(moved?.queue_index ?? moved?.index) === toIndex, value: queue };
    }, { attempts: 14, interval: 250, description: `queue ${action}` });
    renderQueue();
    const message = action === 'remove' ? 'Verified: queue item removed.' : 'Verified: queue order changed.';
    setResult('queueResult', message, 'success'); logActivity(message); toast(message);
  } catch (error) {
    const message = errorMessage(error); setResult('queueResult', message, 'error'); logActivity(`Queue change failed: ${message}`, 'error'); toast(message, 'error');
  } finally { setBusy(false); }
}

function currentUser() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEYS.user) || 'null') || {}; } catch (_) { return {}; }
}

function emergencyRecovery() {
  if (state.emergency.originalSettings) return state.emergency.originalSettings;
  try {
    const saved = JSON.parse(sessionStorage.getItem('deterministic_wall_emergency_recovery') || 'null');
    return saved?.settings || null;
  } catch (_) {
    return null;
  }
}

function saveEmergencyRecovery(stationId, settings) {
  state.emergency.originalSettings = settings;
  sessionStorage.setItem('deterministic_wall_emergency_recovery', JSON.stringify({ stationId: Number(stationId), settings }));
}

function clearEmergencyRecovery() {
  state.emergency.originalSettings = null;
  sessionStorage.removeItem('deterministic_wall_emergency_recovery');
}

function normalizeEmergencyUrl(raw) {
  const candidate = String(raw || '').trim();
  if (!candidate) throw new Error('Enter the Chrome page URL first');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  const parsed = new URL(withScheme);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Emergency Room accepts only http or https pages');
  return parsed.href;
}

function clearEmergencyArm() {
  state.emergency.armedUntil = 0;
  if (state.emergency.armTimer) window.clearTimeout(state.emergency.armTimer);
  state.emergency.armTimer = null;
}

function armEmergencyTakeover() {
  clearEmergencyArm();
  state.emergency.armedUntil = Date.now() + 20000;
  state.emergency.armTimer = window.setTimeout(() => {
    clearEmergencyArm();
    renderEmergencyStatus();
    setResult('emergencyResult', 'Emergency takeover confirmation expired. Nothing changed.');
  }, 20000);
  renderEmergencyStatus();
  setResult(
    'emergencyResult',
    'Takeover armed for 20 seconds. Click “Confirm emergency takeover” to open the page and request its audio.',
  );
}

function useEmergencyPreset() {
  const selected = String($('emergencyPreset').value || '').trim();
  if (!selected) {
    $('emergencyUrl').focus();
    setResult('emergencyResult', 'Custom source selected. Enter an approved HTTP or HTTPS page.');
    return;
  }
  const url = normalizeEmergencyUrl(selected);
  $('emergencyUrl').value = url;
  state.emergency.sourceUrl = url;
  clearEmergencyArm();
  renderEmergencyStatus();
  setResult('emergencyResult', `${$('emergencyPreset').selectedOptions[0].textContent} selected. Preview it before arming takeover.`, 'success');
}

function previewEmergencySource() {
  try {
    const url = normalizeEmergencyUrl($('emergencyUrl').value);
    $('emergencyUrl').value = url;
    state.emergency.sourceUrl = url;
    if (state.emergency.openedWindow && !state.emergency.openedWindow.closed) {
      state.emergency.openedWindow.location.href = url;
      state.emergency.openedWindow.focus();
    } else {
      state.emergency.openedWindow = window.open(url, '_blank', 'noopener=false');
    }
    if (!state.emergency.openedWindow) throw new Error('The browser blocked the preview window. Allow pop-ups for RadioTEDU OnAir and try again');
    clearEmergencyArm();
    renderEmergencyStatus();
    setResult('emergencyResult', 'Preview opened without changing the broadcast. Start playback on that page, then arm takeover.', 'success');
  } catch (error) {
    setResult('emergencyResult', errorMessage(error), 'error');
  }
}

async function ensureEmergencyStudioOwnership(stationId) {
  let snapshot = await api(`/api/studios?station_id=${stationId}`);
  let user = currentUser();
  if (!Number(user.id || 0)) {
    user = await api('/api/auth/me');
    localStorage.setItem(AUTH_KEYS.user, JSON.stringify(user));
  }
  const userId = Number(user.id || 0);
  if (!userId) throw new Error('The signed-in operator identity could not be verified');
  let studio = (snapshot.studios || []).find((item) => item.is_on_air)
    || (snapshot.studios || []).find((item) => item.is_active && (!item.current_user_id || Number(item.current_user_id) === userId));
  if (!studio) {
    const created = await api('/api/studios', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station_id: Number(stationId), name: 'Emergency Room', description: 'Browser-audio emergency takeover' }),
    });
    studio = created.studio;
  }
  if (!studio?.id) throw new Error('No studio is available for emergency audio');
  snapshot = await api(`/api/studios/${Number(studio.id)}/join`, { method: 'POST' });
  const verified = (snapshot.studios || []).find((item) => Number(item.id) === Number(studio.id));
  if (!verified?.is_on_air || Number(verified.current_user_id || 0) !== userId) {
    throw new Error('Emergency Room could not take ownership of the on-air studio');
  }
  return verified;
}

function resampleToPcm16(input, inputRate, outputRate = 24000) {
  const sourceRate = Math.max(1, Number(inputRate || 48000));
  const ratio = sourceRate / outputRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const pcm = new Int16Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(input.length - 1, leftIndex + 1);
    const fraction = sourceIndex - leftIndex;
    const sample = Math.max(-1, Math.min(1, input[leftIndex] + (input[rightIndex] - input[leftIndex]) * fraction));
    pcm[index] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
  }
  return pcm.buffer;
}

function enqueueEmergencyChunk(chunk) {
  if (!state.emergency.active && !state.emergency.starting) return;
  if (state.emergency.pendingChunks.length >= 36) {
    state.emergency.pendingChunks.shift();
    state.emergency.droppedChunks += 1;
  }
  state.emergency.pendingChunks.push(chunk);
  drainEmergencyChunks();
}

async function drainEmergencyChunks() {
  if (state.emergency.draining) return;
  state.emergency.draining = true;
  try {
    while ((state.emergency.active || state.emergency.starting) && state.emergency.pendingChunks.length) {
      const chunk = state.emergency.pendingChunks.shift();
      await api(`/api/audio/live/render/chunk?station_id=${Number(state.emergency.stationId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk, timeoutMs: 8000,
      });
    }
  } catch (error) {
    const message = `Emergency audio transport failed: ${errorMessage(error)}`;
    setResult('emergencyResult', message, 'error');
    logActivity(message, 'error');
    window.setTimeout(() => stopEmergency('transport failure').catch(() => {}), 0);
  } finally {
    state.emergency.draining = false;
  }
}

async function attachEmergencyAudio(stream) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Chrome audio processing is unavailable');
  const context = new AudioContextClass();
  await context.resume();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(8192, 1, 1);
  const silentGain = context.createGain();
  silentGain.gain.value = 0;
  processor.onaudioprocess = (event) => {
    if (!state.emergency.active && !state.emergency.starting) return;
    const samples = event.inputBuffer.getChannelData(0);
    enqueueEmergencyChunk(resampleToPcm16(samples, context.sampleRate));
  };
  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(context.destination);
  state.emergency.audioContext = context;
  state.emergency.sourceNode = source;
  state.emergency.processorNode = processor;
  state.emergency.silentGainNode = silentGain;
}

function releaseEmergencyMedia() {
  const emergency = state.emergency;
  if (emergency.processorNode) emergency.processorNode.onaudioprocess = null;
  [emergency.sourceNode, emergency.processorNode, emergency.silentGainNode].forEach((node) => {
    try { node?.disconnect(); } catch (_) { /* Already disconnected. */ }
  });
  try { emergency.stream?.getTracks().forEach((track) => track.stop()); } catch (_) { /* Already stopped. */ }
  try { emergency.audioContext?.close(); } catch (_) { /* Already closed. */ }
  emergency.stream = null;
  emergency.audioContext = null;
  emergency.sourceNode = null;
  emergency.processorNode = null;
  emergency.silentGainNode = null;
  emergency.pendingChunks = [];
}

function renderEmergencyStatus(runtime = state.runtime || {}) {
  const serverLive = Boolean(runtime?.live_mic_active);
  const live = Boolean(state.emergency.active || serverLive);
  const waiting = Boolean(state.emergency.starting || state.emergency.stopping);
  $('emergencyLamp').className = `status-lamp ${live ? 'live' : waiting ? 'warming' : 'off'}`;
  $('emergencyLamp').innerHTML = `<span></span><b>${live ? 'LIVE' : waiting ? 'WORKING' : 'OFF'}</b>`;
  $('emergencyProgramState').textContent = String(runtime?.program_music_mode || '').toLowerCase() === 'mute' ? 'Muted' : 'Normal';
  $('emergencySignalState').textContent = runtime?.live_mic_receiving ? `${Number(runtime.live_mic_peak_db || -60).toFixed(0)} dB` : live ? 'Waiting for sound' : 'Off';
  const bufferMs = Math.max(0, Math.round(Number(runtime?.live_mic_buffer_bytes || 0) / 48));
  $('emergencyBufferState').textContent = `${bufferMs} ms${state.emergency.droppedChunks ? ` · ${state.emergency.droppedChunks} dropped` : ''}`;
  const armed = !live && !waiting && Date.now() < Number(state.emergency.armedUntil || 0);
  $('emergencySourceState').textContent = state.emergency.sourceUrl
    ? state.emergency.sourceUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '')
    : 'Not selected';
  $('startEmergencyButton').textContent = armed ? 'Confirm emergency takeover' : 'Arm emergency takeover';
  $('startEmergencyButton').disabled = live || waiting;
  $('stopEmergencyButton').disabled = !live || state.emergency.starting || state.emergency.stopping;
  $('emergencyUrl').disabled = live || waiting;
  $('emergencyPreset').disabled = live || waiting;
  $('emergencyPresetButton').disabled = live || waiting;
  $('previewEmergencyButton').disabled = live || waiting;
  document.querySelector('.emergency-panel').classList.toggle('is-live', live);
  const emergencyNav = document.querySelector('[data-operator-nav="emergency"]');
  if (emergencyNav) emergencyNav.dataset.live = live ? 'true' : 'false';
}

async function refreshEmergencyStatus() {
  if (!state.emergency.active) return;
  try {
    const runtime = await api(`/api/runtime/${Number(state.emergency.stationId)}/status`);
    state.runtime = Number(state.emergency.stationId) === Number(state.stationId) ? runtime : state.runtime;
    renderEmergencyStatus(runtime);
  } catch (_) { /* Main refresh will surface backend connectivity. */ }
}

function startEmergencyStatusTimer() {
  if (state.emergency.statusTimer) window.clearInterval(state.emergency.statusTimer);
  state.emergency.statusTimer = window.setInterval(refreshEmergencyStatus, 1000);
}

function stopEmergencyStatusTimer() {
  if (state.emergency.statusTimer) window.clearInterval(state.emergency.statusTimer);
  state.emergency.statusTimer = null;
}

async function startEmergency() {
  if (state.emergency.active || state.emergency.starting) return;
  if (Date.now() >= Number(state.emergency.armedUntil || 0)) {
    armEmergencyTakeover();
    return;
  }
  clearEmergencyArm();
  state.emergency.starting = true;
  state.emergency.stationId = Number(state.stationId);
  state.emergency.droppedChunks = 0;
  setResult('emergencyResult', 'Opening the page and waiting for browser tab-audio permission...');
  renderEmergencyStatus();
  let settingsChanged = false;
  let renderStarted = false;
  try {
    const url = normalizeEmergencyUrl($('emergencyUrl').value);
    $('emergencyUrl').value = url;
    state.emergency.sourceUrl = url;
    if (state.emergency.openedWindow && !state.emergency.openedWindow.closed) {
      state.emergency.openedWindow.focus();
    } else {
      state.emergency.openedWindow = window.open(url, '_blank', 'noopener=false');
    }
    if (!state.emergency.openedWindow) throw new Error('The browser blocked the source window. Allow pop-ups for RadioTEDU OnAir and try again');
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Browser tab-audio sharing is not supported in this browser');
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' },
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      systemAudio: 'exclude',
    });
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('No tab audio was shared. Select the opened browser tab and enable Share tab audio');
    }
    state.emergency.stream = stream;
    const original = await api(`/api/audio/live/status?station_id=${state.emergency.stationId}`);
    saveEmergencyRecovery(state.emergency.stationId, {
      station_id: state.emergency.stationId,
      program_music_mode: original.program_music_mode || 'normal',
      mic_gain: Number(original.mic_gain ?? 1),
      music_gain: Number(original.music_gain ?? 1),
      duck_level: Number(original.duck_level ?? 0.15),
    });
    await ensureEmergencyStudioOwnership(state.emergency.stationId);
    await api('/api/audio/live/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...state.emergency.originalSettings, program_music_mode: 'mute', mic_gain: 1 }),
    });
    settingsChanged = true;
    await api('/api/audio/live/render/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station_id: state.emergency.stationId, source_name: 'Emergency Room browser audio', input_format: 's16le', sample_rate: 24000, channels: 1, max_buffer_bytes: 480000 }),
    });
    renderStarted = true;
    await attachEmergencyAudio(stream);
    state.emergency.active = true;
    stream.getTracks().forEach((track) => { track.onended = () => stopEmergency('browser stopped sharing').catch(() => {}); });
    const verifiedRuntime = await poll(async () => {
      const runtime = await api(`/api/runtime/${state.emergency.stationId}/status`);
      return {
        verified: Boolean(
          runtime.live_mic_active
          && runtime.program_music_mode === 'mute'
          && runtime.output_feed_active
          && (runtime.live_mic_receiving || Number(runtime.live_mic_buffer_bytes || 0) > 0)
        ),
        value: runtime,
      };
    }, { attempts: 30, interval: 250, description: 'exclusive emergency browser audio' });
    state.emergency.starting = false;
    state.runtime = verifiedRuntime;
    renderEmergencyStatus(verifiedRuntime);
    startEmergencyStatusTimer();
    setResult('emergencyResult', 'Verified: audio frames are arriving; normal playout is muted and only the shared browser page is on air.', 'success');
    logActivity(`Emergency Room started for ${selectedStationName()}`);
    toast('Emergency browser audio is live');
  } catch (error) {
    state.emergency.active = false;
    state.emergency.starting = false;
    releaseEmergencyMedia();
    if (renderStarted) await api('/api/audio/live/render/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ station_id: state.emergency.stationId }) }).catch(() => {});
    if (settingsChanged && emergencyRecovery()) await api('/api/audio/live/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(emergencyRecovery()) }).catch(() => {});
    clearEmergencyRecovery();
    const message = errorMessage(error);
    setResult('emergencyResult', message, 'error');
    logActivity(`Emergency Room failed: ${message}`, 'error');
    toast(message, 'error');
    await loadCoreStatus().catch(() => {});
    renderEmergencyStatus();
  }
}

async function stopEmergency(reason = 'operator stop') {
  if (state.emergency.stopping) return;
  state.emergency.stopping = true;
  state.emergency.starting = false;
  const stationId = Number(state.emergency.stationId || state.stationId);
  const restore = emergencyRecovery() || {
    station_id: stationId, program_music_mode: 'normal', mic_gain: 1, music_gain: 1, duck_level: 0.15,
  };
  stopEmergencyStatusTimer();
  releaseEmergencyMedia();
  renderEmergencyStatus();
  setResult('emergencyResult', 'Stopping tab audio and restoring the normal program...');
  try {
    await api('/api/audio/live/render/stop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ station_id: stationId }),
    });
    await api('/api/audio/live/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...restore, station_id: stationId }),
    });
    const verifiedRuntime = await poll(async () => {
      const runtime = await api(`/api/runtime/${stationId}/status`);
      return { verified: !runtime.live_mic_active && runtime.program_music_mode === restore.program_music_mode && runtime.output_feed_active, value: runtime };
    }, { attempts: 30, interval: 250, description: 'normal program restoration' });
    state.emergency.active = false;
    state.runtime = Number(stationId) === Number(state.stationId) ? verifiedRuntime : state.runtime;
    clearEmergencyRecovery();
    setResult('emergencyResult', `Verified: emergency audio stopped and the ${restore.program_music_mode} program mix was restored.`, 'success');
    logActivity(`Emergency Room stopped (${reason})`);
    toast('Normal program restored');
  } catch (error) {
    const message = errorMessage(error);
    setResult('emergencyResult', `Emergency stop needs attention: ${message}`, 'error');
    logActivity(`Emergency stop failed: ${message}`, 'error');
    toast(message, 'error');
  } finally {
    state.emergency.active = false;
    state.emergency.stopping = false;
    state.emergency.stationId = null;
    await loadCoreStatus().catch(() => {});
    renderEmergencyStatus();
  }
}

function emergencyPageHideCleanup() {
  if (!state.emergency.active && !state.emergency.starting) return;
  releaseEmergencyMedia();
  const stationId = Number(state.emergency.stationId || state.stationId);
  const token = localStorage.getItem(AUTH_KEYS.access);
  const restore = emergencyRecovery();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  fetch('/api/audio/live/render/stop', { method: 'POST', headers, body: JSON.stringify({ station_id: stationId }), keepalive: true }).catch(() => {});
  if (restore) fetch('/api/audio/live/settings', { method: 'PUT', headers, body: JSON.stringify({ ...restore, station_id: stationId }), keepalive: true }).catch(() => {});
}

async function uploadJingles(event) {
  event.preventDefault();
  const files = Array.from($('jingleFiles').files || []);
  if (!files.length) return;
  setBusy(true, 'Uploading jingles…', `${files.length} file${files.length === 1 ? '' : 's'}; waiting for library verification`);
  setResult('jingleResult');
  try {
    const form = new FormData();
    form.append('station_id', String(state.stationId)); form.append('target_station_id', String(state.stationId)); form.append('track_type', 'jingle'); form.append('auto_trim_silence', 'false'); form.append('auto_intro_clean', 'false');
    files.forEach((file) => form.append('files', file));
    const result = await api('/api/library/import/upload', { method: 'POST', body: form, timeoutMs: 120000 });
    const ids = Array.isArray(result?.imported_track_ids) ? result.imported_track_ids.map(Number) : [];
    if (!ids.length && Number(result?.scan?.added || 0) <= 0) {
      const failures = (result?.failed || []).map((item) => `${item.file}: ${item.error}`).join('; ');
      throw new Error(failures || 'No new jingle was imported');
    }
    await poll(async () => {
      const payload = await api(`/api/tracks?station_id=${state.stationId}&track_type=jingle&per_page=100`);
      state.jingles = payload.tracks || payload.items || [];
      const verified = ids.length ? ids.every((id) => state.jingles.some((track) => Number(track.id) === id)) : state.jingles.length >= Number(result.scan.added);
      return { verified, value: state.jingles };
    }, { attempts: 20, interval: 400, description: 'uploaded jingles in station library' });
    $('jingleFiles').value = ''; $('jingleFileLabel').textContent = 'Choose one or more jingle files';
    await Promise.all([loadJingles(), loadCoreStatus()]);
    const failedCount = Array.isArray(result.failed) ? result.failed.length : 0;
    const message = `Verified: ${ids.length || result.scan.added} jingle(s) imported${failedCount ? `; ${failedCount} file(s) failed` : ''}.`;
    setResult('jingleResult', message, failedCount ? 'error' : 'success'); logActivity(message, failedCount ? 'error' : 'success'); toast(message, failedCount ? 'error' : 'success');
  } catch (error) {
    const message = errorMessage(error); setResult('jingleResult', message, 'error'); logActivity(`Jingle upload failed: ${message}`, 'error'); toast(message, 'error');
  } finally { setBusy(false); }
}

async function saveSweeper(event) {
  event.preventDefault();
  const enabled = $('sweeperEnabled').checked;
  const interval = Number($('sweeperInterval').value);
  const mode = $('sweeperMode').value;
  if (!Number.isInteger(interval) || interval < 1 || interval > 100) {
    setResult('sweeperResult', 'Enter a whole number from 1 to 100 songs.', 'error');
    return;
  }
  if (!['ordered', 'random'].includes(mode)) {
    setResult('sweeperResult', 'Choose library order or random jingle selection.', 'error');
    return;
  }
  const readVerifiedSweeper = async () => {
    try {
      const saved = await api(`/api/sweeper/config?station_id=${state.stationId}`, { timeoutMs: 8000 });
      const expectedEnabled = enabled && Number(saved.jingle_count) > 0;
      return {
        verified: Boolean(saved.enabled) === expectedEnabled
          && Number(saved.interval) === interval
          && saved.interval_unit === 'tracks'
          && saved.mode === mode,
        value: saved,
      };
    } catch (_) {
      return { verified: false };
    }
  };
  setBusy(true, 'Saving automatic jingles…', 'Saving and verifying station automation');
  setResult('sweeperResult');
  try {
    const result = await api('/api/sweeper/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station_id: state.stationId, enabled, interval, interval_unit: 'tracks', mode }),
      timeoutMs: 60000,
      idempotent: true,
      transportAttempts: 2,
    });
    state.sweeper = await poll(readVerifiedSweeper, { attempts: 12, interval: 300, description: 'automatic jingle setting' });
    clearFormDirty(['sweeperEnabled', 'sweeperInterval', 'sweeperMode']);
    renderCoreStatus();
    if (enabled && result?.reason === 'no_jingles') throw new Error('Cannot enable automatic jingles because this station has no jingle files');
    const message = `Verified: automatic jingles ${state.sweeper.enabled ? `play after every ${interval} completed song${interval === 1 ? '' : 's'} using ${mode === 'ordered' ? 'library order' : 'random selection'}` : 'are disabled'}.`;
    setResult('sweeperResult', message, 'success'); logActivity(message); toast(message);
  } catch (error) {
    try {
      state.sweeper = await poll(readVerifiedSweeper, {
        attempts: 45,
        interval: 1000,
        description: 'delayed automatic jingle setting',
      });
      clearFormDirty(['sweeperEnabled', 'sweeperInterval', 'sweeperMode']);
      renderCoreStatus();
      const message = `Verified after a delayed backend response: automatic jingles ${state.sweeper.enabled ? `play after every ${interval} completed song${interval === 1 ? '' : 's'} using ${mode === 'ordered' ? 'library order' : 'random selection'}` : 'are disabled'}.`;
      setResult('sweeperResult', message, 'success'); logActivity(message); toast(message);
    } catch (_) {
      const message = errorMessage(error); setResult('sweeperResult', message, 'error'); logActivity(`Automatic jingle change failed: ${message}`, 'error'); toast(message, 'error');
    }
  } finally { setBusy(false); }
}

async function saveIntegrations(event) {
  event.preventDefault();
  setBusy(true, 'Saving RadioTEDU adapters…', 'Securing integration settings');
  setResult('integrationResult');
  const payload = {
    voting_enabled: $('votingEnabled').checked,
    voting_base_url: $('votingBaseUrl').value.trim(),
    voting_agent_device_id: $('votingDeviceId').value.trim(),
    voting_agent_token: $('votingAgentToken').value,
    study_enabled: $('studyEnabled').checked,
    study_base_url: $('studyBaseUrl').value.trim(),
  };
  try {
    await api('/api/integrations/radiotedu', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      idempotent: true,
    });
    state.integrations = await api('/api/integrations/radiotedu');
    renderIntegrations();
    const message = 'Verified: optional RadioTEDU integration settings were saved securely.';
    setResult('integrationResult', message, 'success'); logActivity(message); toast(message);
  } catch (error) {
    const message = errorMessage(error);
    setResult('integrationResult', message, 'error'); logActivity(`Integration save failed: ${message}`, 'error'); toast(message, 'error');
  } finally { setBusy(false); }
}

async function testIntegrations() {
  setBusy(true, 'Testing optional services…', 'Core playout remains independent');
  setResult('integrationResult');
  try {
    const status = await api('/api/integrations/radiotedu/status', { timeoutMs: 12000 });
    const votingState = status.voting?.state || 'disabled';
    const studyState = status.study?.state || 'disabled';
    const degraded = votingState === 'degraded';
    const message = `Voting: ${votingState}. Study: ${studyState}. Core playout is unaffected.`;
    $('integrationState').textContent = degraded ? 'Degraded' : 'Ready';
    setResult('integrationResult', message, degraded ? 'error' : 'success');
    logActivity(message, degraded ? 'error' : 'success');
  } catch (error) {
    const message = `${errorMessage(error)} Core playout is unaffected.`;
    $('integrationState').textContent = 'Degraded';
    setResult('integrationResult', message, 'error'); logActivity(message, 'error');
  } finally { setBusy(false); }
}

async function saveRadioTEDUServices(event) {
  event.preventDefault();
  setBusy(true, 'Saving managed services…', 'Validating fixed commands, paths, and health endpoints');
  setResult('serviceControlResult');
  try {
    const result = await api('/api/integrations/radiotedu/services', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ services: collectRadioTEDUServiceSettings() }),
      idempotent: true,
      timeoutMs: 20000,
    });
    state.radioteduServices = result;
    (result.definitions || []).forEach((definition) => {
      ['enabled', 'autostart', 'source', 'config', 'health', 'backup'].forEach((field) => {
        const node = $(serviceControlId(definition.id, field));
        if (node) delete node.dataset.dirty;
      });
    });
    renderRadioTEDUServices();
    const message = 'Verified: managed service settings were saved. No production service was started.';
    setResult('serviceControlResult', message, 'success');
    logActivity(message);
    toast(message);
  } catch (error) {
    const message = errorMessage(error);
    setResult('serviceControlResult', message, 'error');
    logActivity(`Managed service settings failed: ${message}`, 'error');
    toast(message, 'error');
  } finally {
    setBusy(false);
  }
}

async function checkAllRadioTEDUServices() {
  setBusy(true, 'Checking RadioTEDU services…', 'Testing health, source state, and managed runtime');
  setResult('serviceControlResult');
  try {
    state.radioteduServices = await api('/api/integrations/radiotedu/services?refresh_health=true', { timeoutMs: 35000 });
    renderRadioTEDUServices();
    const statuses = state.radioteduServices.status || [];
    const healthy = statuses.filter((item) => item.state === 'healthy').length;
    const enabled = statuses.filter((item) => item.enabled).length;
    const message = `Health check complete: ${healthy} of ${enabled} enabled services are healthy. Core playout was not changed.`;
    setResult('serviceControlResult', message, healthy === enabled ? 'success' : 'error');
    logActivity(message, healthy === enabled ? 'success' : 'error');
  } catch (error) {
    const message = errorMessage(error);
    setResult('serviceControlResult', message, 'error');
    logActivity(`Service health check failed: ${message}`, 'error');
  } finally {
    setBusy(false);
  }
}

function clearServiceActionArm(button) {
  const key = `${button.dataset.serviceId}:${button.dataset.serviceAction}`;
  delete state.serviceActionArmed[key];
  button.classList.remove('armed');
  button.textContent = button.dataset.originalLabel || button.textContent;
}

async function controlRadioTEDUService(button) {
  const serviceId = button.dataset.serviceId;
  const action = button.dataset.serviceAction;
  if (!serviceId || !action) return;
  if (action === 'check') {
    setBusy(true, 'Checking service…', 'Reading health without changing runtime');
    setResult('serviceControlResult');
    try {
      const result = await api(`/api/integrations/radiotedu/services/${encodeURIComponent(serviceId)}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check', confirmation: '' }),
        timeoutMs: 20000,
      });
      state.radioteduServices.status = result.status || [];
      renderRadioTEDUServices();
      const service = result.service || {};
      const message = `${service.name || serviceId}: ${String(service.state || 'checked').replaceAll('_', ' ')}. Runtime was not changed.`;
      setResult('serviceControlResult', message, service.state === 'healthy' || service.state === 'disabled' ? 'success' : 'error');
      logActivity(message);
    } catch (error) {
      const message = errorMessage(error);
      setResult('serviceControlResult', message, 'error');
      logActivity(`Service check failed: ${message}`, 'error');
    } finally {
      setBusy(false);
    }
    return;
  }
  const confirmations = {
    start: 'START SERVICE',
    stop: 'STOP SERVICE',
    restart: 'RESTART SERVICE',
    update_database: 'UPDATE DATABASE',
    update_repository: 'UPDATE REPOSITORY',
    pull_model: 'INSTALL MODEL',
  };
  const key = `${serviceId}:${action}`;
  const now = Date.now();
  if (!state.serviceActionArmed[key] || state.serviceActionArmed[key] < now) {
    Object.keys(state.serviceActionArmed).forEach((armedKey) => { delete state.serviceActionArmed[armedKey]; });
    document.querySelectorAll('[data-service-action].armed').forEach(clearServiceActionArm);
    state.serviceActionArmed[key] = now + 20000;
    button.dataset.originalLabel = button.textContent;
    button.classList.add('armed');
    button.textContent = `Confirm ${button.textContent}`;
    setResult('serviceControlResult', `Click “${button.textContent}” again within 20 seconds.`, 'error');
    window.setTimeout(() => {
      if ((state.serviceActionArmed[key] || 0) <= Date.now()) clearServiceActionArm(button);
    }, 20500);
    return;
  }
  clearServiceActionArm(button);
  setBusy(true, `${action.replaceAll('_', ' ')}…`, `Executing fixed ${serviceId} control`);
  setResult('serviceControlResult');
  try {
    const result = await api(`/api/integrations/radiotedu/services/${encodeURIComponent(serviceId)}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        confirmation: confirmations[action],
        model: action === 'pull_model' ? $(serviceControlId(serviceId, 'model'))?.value.trim() || '' : '',
      }),
      timeoutMs: ['update_database', 'pull_model'].includes(action) ? 1800000 : action === 'update_repository' ? 240000 : 60000,
      idempotent: !['update_database', 'update_repository', 'pull_model'].includes(action),
    });
    state.radioteduServices.status = result.status || [];
    renderRadioTEDUServices();
    const maintenance = action === 'update_database'
      ? result.backup_file
        ? ` Backup: ${result.backup_file}. ${Number(result.migrations_applied || 0)} migration task(s) applied.`
        : ` ${Array.isArray(result.stations) ? result.stations.length : 0} station database(s) backed up and updated.`
      : '';
    const message = `Verified: ${serviceId} ${action.replaceAll('_', ' ')} completed.${maintenance}`;
    setResult('serviceControlResult', message, 'success');
    logActivity(message);
    toast(message);
  } catch (error) {
    const message = errorMessage(error);
    setResult('serviceControlResult', message, 'error');
    logActivity(`${serviceId} ${action} failed: ${message}`, 'error');
    toast(message, 'error');
  } finally {
    setBusy(false);
  }
}

async function publishVotingRound() {
  const candidates = state.queue
    .filter((item) => !item.is_played && String(item.status || '').toLowerCase() !== 'done')
    .slice(0, 3);
  if (candidates.length !== 3) {
    toast('Queue at least three songs before publishing a voting round.', 'error');
    return;
  }
  setBusy(true, 'Publishing voting round…', 'Sending the next three songs');
  setResult('integrationResult');
  try {
    const result = await api('/api/integrations/radiotedu/voting/rounds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates: candidates.map((item, index) => ({
          id: `queue-${Number(item.id || index + 1)}`,
          song_id: String(item.track_id || item.id),
          title: String(item.title || 'Untitled'),
          artist: String(item.artist || 'RadioTEDU'),
          album_art_url: item.album_art_url || null,
        })),
      }),
      timeoutMs: 15000,
    });
    const ok = result.state === 'published';
    const message = ok
      ? `Voting round ${result.round_id} published for the next three songs.`
      : 'Voting service is degraded; the queue was not changed and playout continues.';
    setResult('integrationResult', message, ok ? 'success' : 'error');
    logActivity(message, ok ? 'success' : 'error');
  } catch (error) {
    const message = `${errorMessage(error)} The queue was not changed.`;
    setResult('integrationResult', message, 'error'); logActivity(message, 'error');
  } finally { setBusy(false); }
}

function startRefreshTimer() {
  stopRefreshTimer();
  state.refreshTimer = window.setInterval(() => {
    if (!state.busy && !document.hidden) Promise.all([loadCoreStatus(), loadQueue()]).then(() => setConnection('online', 'Backend connected')).catch(() => setConnection('offline', 'Connection failed'));
  }, 5000);
}

function stopRefreshTimer() {
  if (state.refreshTimer) window.clearInterval(state.refreshTimer);
  state.refreshTimer = null;
}

function bindEvents() {
  $('loginForm').addEventListener('submit', login);
  $('logoutButton').addEventListener('click', logout);
  $('refreshButton').addEventListener('click', () => refreshAll(false));
  $('queueRefreshButton').addEventListener('click', () => loadQueue().catch((error) => toast(errorMessage(error), 'error')));
  $('stationSelect').addEventListener('change', async () => {
    if (state.emergency.active || state.emergency.starting) await stopEmergency('station changed');
    disarmStartBroadcast();
    disarmStopBroadcast();
    disarmStationDelete();
    clearFormDirty([
      'libraryFolder', 'libraryProfileLabel', 'libraryDefaultGenre', 'libraryDefaultLanguage', 'jingleFolder', 'jingleFolderReplace',
      'broadcastAutostartEnabled',
      'currentStationName', 'currentOutputGain', 'currentIcecastEnabled', 'currentIcecastHost', 'currentIcecastPort', 'currentIcecastMount', 'currentIcecastUser', 'currentIcecastPassword', 'currentIcecastProfile', 'currentIcecastTlsEnabled', 'currentLocalEnabled', 'currentOutputDevice',
      'aiConfigEnabled', 'aiLlmModel', 'aiTtsProvider', 'aiVoicePersona', 'aiTtsModelPath', 'aiMaxSeconds', 'aiStationInterval', 'aiIncludeHistory', 'aiEducational', 'aiPromptTemplate',
    ]);
    state.stationId = Number($('stationSelect').value);
    $('workspaceStation').textContent = `Active: ${selectedStationName()}`;
    localStorage.setItem('deterministic_wall_station_id', String(state.stationId));
    const url = new URL(window.location.href);
    url.searchParams.set('station_id', String(state.stationId));
    window.history.replaceState({}, '', url);
    state.libraryPage = 1;
    await refreshAll(false);
  });
  $('startBroadcastButton').addEventListener('click', startBroadcast);
  $('stopBroadcastButton').addEventListener('click', stopBroadcast);
  $('emergencyPresetButton').addEventListener('click', useEmergencyPreset);
  $('previewEmergencyButton').addEventListener('click', previewEmergencySource);
  $('startEmergencyButton').addEventListener('click', startEmergency);
  $('stopEmergencyButton').addEventListener('click', () => stopEmergency('operator stop'));
  $('enableAiButton').addEventListener('click', () => setAiEnabled(true));
  $('disableAiButton').addEventListener('click', () => setAiEnabled(false));
  $('stationForm').addEventListener('submit', createStation);
  $('configureIcecast').addEventListener('change', toggleIcecastFields);
  $('currentOutputForm').addEventListener('submit', saveCurrentOutput);
  $('testCurrentOutputButton').addEventListener('click', testCurrentOutput);
  $('deleteStationButton').addEventListener('click', deleteCurrentStation);
  $('currentIcecastEnabled').addEventListener('change', toggleCurrentOutputFields);
  $('currentLocalEnabled').addEventListener('change', toggleCurrentOutputFields);
  $('aiConfigForm').addEventListener('submit', saveAiConfiguration);
  $('testAiButton').addEventListener('click', runAiTest);
  $('integrationForm').addEventListener('submit', saveIntegrations);
  $('testIntegrationsButton').addEventListener('click', testIntegrations);
  $('publishVotingRoundButton').addEventListener('click', publishVotingRound);
  $('serviceControlForm').addEventListener('submit', saveRadioTEDUServices);
  $('checkAllServicesButton').addEventListener('click', checkAllRadioTEDUServices);
  $('refreshReadinessButton').addEventListener('click', refreshReadiness);
  $('repairDependenciesButton').addEventListener('click', repairDependencies);
  $('passwordForm').addEventListener('submit', changePassword);
  $('stationName').addEventListener('input', () => {
    const mount = $('icecastMount');
    if (mount.dataset.edited === '1') return;
    const slug = $('stationName').value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    mount.value = `/${slug || 'new-station'}`;
  });
  $('icecastMount').addEventListener('input', () => { $('icecastMount').dataset.edited = '1'; });
  $('librarySearchForm').addEventListener('submit', (event) => { event.preventDefault(); loadLibrary(1).catch((error) => toast(errorMessage(error), 'error')); });
  $('libraryFolderForm').addEventListener('submit', syncLibraryFolder);
  $('rescanLibraryButton').addEventListener('click', requestManagedLibraryRescan);
  $('refreshUnifiedMediaButton').addEventListener('click', refreshUnifiedMedia);
  $('broadcastAutostartEnabled').addEventListener('change', updateBroadcastAutostartFromControl);
  $('browseLibraryFolderButton').addEventListener('click', () => pickManagedFolder('libraryFolder', 'Select this station\'s music folder'));
  ['libraryFolder', 'libraryProfileLabel', 'libraryDefaultGenre', 'libraryDefaultLanguage'].forEach((id) => {
    $(id).addEventListener('input', () => { $(id).dataset.dirty = '1'; });
  });
  $('libraryPrev').addEventListener('click', () => loadLibrary(state.libraryPage - 1));
  $('libraryNext').addEventListener('click', () => loadLibrary(state.libraryPage + 1));
  $('jingleUploadForm').addEventListener('submit', uploadJingles);
  $('jingleFolderForm').addEventListener('submit', syncJingleFolder);
  $('browseJingleFolderButton').addEventListener('click', () => pickManagedFolder('jingleFolder', 'Select this station\'s jingle folder'));
  $('jingleFiles').addEventListener('change', () => { const count = $('jingleFiles').files.length; $('jingleFileLabel').textContent = count ? `${count} file${count === 1 ? '' : 's'} selected` : 'Choose one or more jingle files'; });
  $('sweeperForm').addEventListener('submit', saveSweeper);
  [
    'jingleFolder', 'jingleFolderReplace',
    'sweeperEnabled', 'sweeperInterval', 'sweeperMode',
    'broadcastAutostartEnabled',
      'currentStationName', 'currentOutputGain', 'currentIcecastEnabled', 'currentIcecastHost', 'currentIcecastPort', 'currentIcecastMount', 'currentIcecastUser', 'currentIcecastPassword', 'currentIcecastProfile', 'currentIcecastTlsEnabled', 'currentLocalEnabled', 'currentOutputDevice',
    'aiConfigEnabled', 'aiLlmModel', 'aiTtsProvider', 'aiVoicePersona', 'aiTtsModelPath', 'aiMaxSeconds', 'aiStationInterval', 'aiIncludeHistory', 'aiEducational', 'aiPromptTemplate',
    'votingEnabled', 'votingBaseUrl', 'votingDeviceId', 'votingAgentToken', 'studyEnabled', 'studyBaseUrl',
  ].forEach((id) => $(id).addEventListener('input', () => { $(id).dataset.dirty = '1'; }));
  $('clearActivityButton').addEventListener('click', () => { $('activityList').innerHTML = ''; });
  document.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add-track]');
    if (add) addTrackToQueue(Number(add.dataset.addTrack));
    const queueButton = event.target.closest('[data-queue-action]');
    if (queueButton) queueAction(queueButton.dataset.queueAction, Number(queueButton.dataset.index));
    const serviceButton = event.target.closest('[data-service-action]');
    if (serviceButton) controlRadioTEDUService(serviceButton);
    const servicePathButton = event.target.closest('[data-service-path]');
    if (servicePathButton) pickRadioTEDUServicePath(servicePathButton);
  });
}

async function boot() {
  initializeOperatorNavigation();
  bindEvents();
  toggleIcecastFields();
  toggleCurrentOutputFields();
  setConnection('', 'Connecting');
  if (await ensureSignedIn()) {
    try { await showApp(); } catch (error) { toast(errorMessage(error), 'error'); showLogin(); }
  } else {
    showLogin();
  }
}

window.addEventListener('DOMContentLoaded', boot);
window.addEventListener('pagehide', emergencyPageHideCleanup);
