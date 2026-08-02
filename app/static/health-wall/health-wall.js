(() => {
  'use strict';

  const ENDPOINT = '/api/monitor/snapshot';
  const POLL_MS = 5000;
  const model = { snapshot: null, receivedAt: 0, failures: 0, summaryText: '' };
  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function normalizedState(value) {
    const state = String(value || 'unknown').toLowerCase();
    if (['healthy', 'ready', 'running', 'online', 'live', 'ok'].includes(state)) return 'healthy';
    if (['degraded', 'warning', 'retrying', 'recovering'].includes(state)) return 'warning';
    if (['unavailable', 'critical', 'failed', 'offline', 'not_ready', 'error'].includes(state)) return 'critical';
    if (['maintenance', 'intentional_stop', 'idle', 'muted', 'standby', 'disabled'].includes(state)) return 'maintenance';
    return 'unknown';
  }

  function stateText(value) {
    return String(value || 'unknown').replaceAll('_', ' ');
  }

  function formatCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat().format(number) : '—';
  }

  function parseTime(value) {
    if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function durationText(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(value / 60);
    return `${String(minutes).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  }

  function stationCard(station) {
    const health = normalizedState(station.health);
    const playing = station.now_playing || {};
    const runtime = station.runtime || {};
    const microphone = station.microphones || {};
    const title = playing.title || runtime.active_stream_title || 'No current track';
    const artist = playing.artist || runtime.active_stream_artist || station.active_show_name || 'Awaiting playout metadata';
    const duration = Number(playing.duration || 0);
    const started = parseTime(playing.started_at);
    const worker = runtime.worker_loop || {};
    const physicalDevice = microphone.physical_device || {};
    const deviceText = physicalDevice.discovery === 'disabled'
      ? ' · physical discovery disabled'
      : (physicalDevice.selection === 'not-present'
        ? ' · configured device missing'
        : (physicalDevice.stale ? ' · device evidence stale' : (physicalDevice.presence === 'present'
          ? ` · ${physicalDevice.selection === 'selected' ? 'selected device' : 'device present'}`
          : (physicalDevice.presence === 'missing' ? ' · no device' : ' · device unknown'))));
    const microphoneText = microphone.capability
      ? `${stateText(microphone.state)}${microphone.receiving ? ` · ${Math.round(Number(microphone.level_db || -60))} dB` : ''}`
      : 'not monitored';
    const microphoneDisplay = microphone.capability ? `${microphoneText}${deviceText}` : microphoneText;
    return `<article class="station-card" data-tone="${health}">
      <div class="station-top">
        <span class="station-name">${escapeHtml(station.name || `Station ${station.station_id || ''}`)}</span>
        <span class="state-label ${health}">${escapeHtml(stateText(station.health))}</span>
      </div>
      <div class="now-playing">
        <div class="now-playing-top"><span class="eyebrow">NOW PLAYING</span><span class="track-time" data-progress-time data-started="${started}" data-duration="${duration}">--:-- / ${durationText(duration)}</span></div>
        <div class="now-playing-title">${escapeHtml(title)}</div>
        <div class="now-playing-artist">${escapeHtml(artist)}</div>
        <div class="progress"><span data-progress-bar data-started="${started}" data-duration="${duration}"></span></div>
      </div>
      <div class="station-facts">
        <div class="fact"><small>Worker</small><b>${worker.running ? 'Running' : 'Stopped'}</b></div>
        <div class="fact"><small>Output</small><b>${escapeHtml(runtime.output_mode || (runtime.liquidsoap_connected ? 'Connected' : 'Unknown'))}</b></div>
        <div class="fact"><small>Microphone</small><b class="${normalizedState(microphone.state)}">${escapeHtml(microphoneDisplay)}</b></div>
      </div>
    </article>`;
  }

  function renderStations(snapshot) {
    const stations = Array.isArray(snapshot.stations) ? snapshot.stations : [];
    $('stationGrid').classList.remove('skeleton-grid');
    $('stationGrid').innerHTML = stations.length ? stations.map(stationCard).join('') : '<div class="empty">No configured stations were returned.</div>';
    const live = stations.filter((item) => normalizedState(item.health) === 'healthy').length;
    $('stationSummary').textContent = `${live} of ${stations.length} healthy`;
    updateProgress();
  }

  function integrationCard(label, value, detail) {
    const tone = normalizedState(value);
    return `<article class="integration-card"><h3>${escapeHtml(label)}</h3><strong class="${tone}">${escapeHtml(stateText(value))}</strong><p>${escapeHtml(detail)}</p></article>`;
  }

  function renderIntegrations(snapshot) {
    const integrations = snapshot.integrations || {};
    const services = Array.isArray(snapshot.services?.items) ? snapshot.services.items : [];
    const serviceDetail = (prefix) => {
      const found = services.filter((item) => String(item.id || '').startsWith(prefix));
      if (!found.length) return 'No configured service evidence';
      return found.map((item) => `${item.name}: ${stateText(item.state)}`).join(' · ');
    };
    const cards = [
      integrationCard('Juke', integrations.juke, serviceDetail('juke_')),
      integrationCard('Voting', integrations.voting, serviceDetail('voting_')),
      integrationCard('Icecast', integrations.icecast, 'Local source and mount evidence'),
      integrationCard('Public /ai', integrations.public_ai, 'Independent public-origin evidence'),
      integrationCard('Public /event', integrations.public_event, 'Independent public-origin evidence'),
    ];
    $('integrationGrid').innerHTML = cards.join('');
  }

  function renderCatalog(snapshot) {
    const catalog = snapshot.library?.product_catalog || {};
    const products = Array.isArray(catalog.products) ? catalog.products : [];
    $('catalogPoll').textContent = catalog.poll_interval_seconds ? `Scanner interval ${catalog.poll_interval_seconds}s` : '';
    $('catalogList').innerHTML = products.length ? products.map((item) => {
      const tone = normalizedState(item.state);
      const detail = `Generation ${formatCount(item.generation)}${item.retry_count ? ` · retry ${item.retry_count}` : ''}`;
      return `<div class="list-row"><div class="identity"><b>${escapeHtml(item.product || 'Product')}</b><small>${escapeHtml(detail)}</small></div><div class="value"><b>${formatCount(item.file_count)}</b><br><span class="${tone}">${escapeHtml(stateText(item.state))}</span></div></div>`;
    }).join('') : '<div class="empty">Product catalog evidence unavailable.</div>';
  }

  function renderServices(snapshot) {
    const serviceContainer = snapshot.services || {};
    const services = Array.isArray(serviceContainer.items) ? serviceContainer.items : [];
    $('serviceList').innerHTML = services.length ? services.map((item) => {
      const tone = item.enabled ? normalizedState(item.state) : 'unknown';
      const startup = item.enabled ? (item.auto_start ? 'automatic' : 'manual') : 'disabled';
      return `<div class="list-row"><div class="identity"><b>${escapeHtml(item.name || item.id)}</b><small>${escapeHtml(item.startup_owner || 'local')} · ${startup}</small></div><div class="value ${tone}">${escapeHtml(item.enabled ? stateText(item.state) : 'disabled')}</div></div>`;
    }).join('') : '<div class="empty">Service evidence unavailable.</div>';
  }

  function healthItems(snapshot) {
    const items = [];
    for (const station of snapshot.stations || []) items.push({ name: station.name || 'Station', state: station.health });
    for (const [name, state] of Object.entries(snapshot.integrations || {})) items.push({ name, state });
    for (const service of snapshot.services?.items || []) if (service.enabled) items.push({ name: service.name || service.id, state: service.state });
    for (const product of snapshot.library?.product_catalog?.products || []) items.push({ name: `${product.product} catalog`, state: product.state });
    return items;
  }

  function renderSummary(snapshot) {
    const items = healthItems(snapshot);
    const critical = items.filter((item) => normalizedState(item.state) === 'critical');
    const warning = items.filter((item) => normalizedState(item.state) === 'warning');
    const unknown = items.filter((item) => normalizedState(item.state) === 'unknown');
    $('criticalCount').textContent = critical.length;
    $('warningCount').textContent = warning.length;
    $('unknownCount').textContent = unknown.length;
    const incidents = [...critical, ...warning];
    $('incidentTicker').textContent = incidents.length
      ? incidents.map((item) => `${item.name}: ${stateText(item.state)}`).join('   •   ')
      : unknown.length ? `${unknown.length} component${unknown.length === 1 ? '' : 's'} awaiting evidence` : 'No active incidents.';
    const text = `${critical.length} critical, ${warning.length} warning, ${unknown.length} unknown.`;
    if (text !== model.summaryText) {
      model.summaryText = text;
      $('assistiveSummary').textContent = text;
    }
  }

  function render(snapshot) {
    renderStations(snapshot);
    renderIntegrations(snapshot);
    renderCatalog(snapshot);
    renderServices(snapshot);
    renderSummary(snapshot);
  }

  function staleSnapshot(snapshot) {
    const stale = JSON.parse(JSON.stringify(snapshot));
    for (const station of stale.stations || []) {
      station.health = 'stale';
      if (station.microphones) station.microphones.state = 'stale';
    }
    for (const name of Object.keys(stale.integrations || {})) stale.integrations[name] = 'stale';
    for (const service of stale.services?.items || []) if (service.enabled) service.state = 'stale';
    for (const product of stale.library?.product_catalog?.products || []) product.state = 'stale';
    return stale;
  }

  function updateProgress() {
    const now = Date.now();
    document.querySelectorAll('[data-progress-bar]').forEach((node) => {
      const started = Number(node.dataset.started || 0);
      const duration = Number(node.dataset.duration || 0);
      const elapsed = started && duration ? Math.max(0, (now - started) / 1000) : 0;
      node.style.width = `${duration ? Math.min(100, (elapsed / duration) * 100) : 0}%`;
    });
    document.querySelectorAll('[data-progress-time]').forEach((node) => {
      const started = Number(node.dataset.started || 0);
      const duration = Number(node.dataset.duration || 0);
      const elapsed = started && duration ? Math.min(duration, Math.max(0, (now - started) / 1000)) : 0;
      node.textContent = `${durationText(elapsed)} / ${durationText(duration)}`;
    });
  }

  function updateClock() {
    $('localClock').textContent = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
    if (!model.snapshot) return;
    const generated = parseTime(model.snapshot.generated_at);
    const age = generated ? Math.max(0, Math.floor((Date.now() - generated) / 1000)) : Math.floor((Date.now() - model.receivedAt) / 1000);
    $('snapshotAge').textContent = model.failures ? `Monitor disconnected · last snapshot ${age}s old` : `Local snapshot ${age}s old`;
    updateProgress();
  }

  async function poll() {
    try {
      const response = await fetch(ENDPOINT, { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`monitor_http_${response.status}`);
      const snapshot = await response.json();
      if (!snapshot || Number(snapshot.schema_version) !== 1 || !Array.isArray(snapshot.stations)) throw new Error('monitor_invalid_snapshot');
      model.snapshot = snapshot;
      model.receivedAt = Date.now();
      model.failures = 0;
      $('connectionBanner').className = 'connection-banner connected';
      render(snapshot);
    } catch (error) {
      model.failures += 1;
      const banner = $('connectionBanner');
      banner.className = 'connection-banner disconnected';
      banner.textContent = model.snapshot
        ? 'Health Wall disconnected from the local monitor. Last known evidence is retained and is not considered healthy.'
        : 'Health Wall cannot reach the local monitor. Broadcast state is unknown.';
      if (model.snapshot) render(staleSnapshot(model.snapshot));
      if (!model.snapshot) {
        $('incidentTicker').textContent = 'Monitor connection unavailable.';
        $('criticalCount').textContent = '0';
        $('warningCount').textContent = '0';
        $('unknownCount').textContent = '1';
      }
    }
  }

  updateClock();
  poll();
  setInterval(updateClock, 1000);
  setInterval(poll, POLL_MS);
})();
