const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(
  path.join(root, 'app', 'static', 'deterministic-wall', 'index.html'),
  'utf8',
);
const script = fs.readFileSync(
  path.join(root, 'app', 'static', 'deterministic-wall', 'app.js'),
  'utf8',
);

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
