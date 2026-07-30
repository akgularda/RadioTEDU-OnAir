/**
 * Public station lobby
 * Renders the public broadcast wall and hands users off to login.
 */

(function () {
    const PUBLIC_STATIONS_ENDPOINT = '/api/public/stations';
    const SYSTEM_SETTINGS_ENDPOINT = '/api/settings/system';
    const LOGIN_PATH = '/login.html';
    const APP_PATH = '/app';
    const DEFAULT_DISPLAY_BRAND = 'RadioTEDU OnAir';
    let progressTimerId = null;
    let progressRenderers = [];

    const STATUS_META = {
        live: {
            label: 'Live',
            description: 'On air',
            className: 'lobby-card--live',
        },
        degraded: {
            label: 'Degraded',
            description: 'Needs attention',
            className: 'lobby-card--degraded',
        },
        offline: {
            label: 'Offline',
            description: 'Currently silent',
            className: 'lobby-card--offline',
        },
    };

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeStatus(value) {
        const status = String(value ?? '').trim().toLowerCase();
        return STATUS_META[status] ? status : 'offline';
    }

    function normalizeDisplayBrandName(value) {
        const normalized = String(value ?? '')
            .replace(/\s+/g, ' ')
            .trim();
        return normalized || DEFAULT_DISPLAY_BRAND;
    }

    function applyBrand(name) {
        const safeBrand = normalizeDisplayBrandName(name);
        const brandEl = document.getElementById('lobbyBrandName');
        if (brandEl) {
            brandEl.textContent = safeBrand;
        }
        if (typeof document !== 'undefined' && 'title' in document) {
            document.title = `${safeBrand} Broadcast Wall`;
        }
        return safeBrand;
    }

    async function loadBrand() {
        try {
            const response = await fetch(SYSTEM_SETTINGS_ENDPOINT);
            if (!response.ok) {
                throw new Error(`Failed to load public brand (${response.status})`);
            }
            const payload = await response.json();
            const settings = payload?.settings || {};
            return applyBrand(settings.display_brand_name);
        } catch (_) {
            return applyBrand(DEFAULT_DISPLAY_BRAND);
        }
    }

    function getStationList(payload) {
        if (Array.isArray(payload)) {
            return payload;
        }
        if (payload && Array.isArray(payload.stations)) {
            return payload.stations;
        }
        return [];
    }

    function buildLoginUrl(stationId) {
        const params = new URLSearchParams();
        params.set('station_id', String(stationId));
        params.set('next', `${APP_PATH}?station_id=${String(stationId)}`);
        return `${LOGIN_PATH}?${params.toString()}`;
    }

    function nowPlayingText(nowPlaying) {
        if (!nowPlaying || typeof nowPlaying !== 'object') {
            return 'No track metadata available';
        }
        const title = String(nowPlaying.title ?? '').trim();
        const artist = String(nowPlaying.artist ?? '').trim();
        if (title && artist) {
            return `${artist} - ${title}`;
        }
        if (title) {
            return title;
        }
        if (artist) {
            return artist;
        }
        return 'No track metadata available';
    }

    function parseStartedAt(value) {
        const raw = String(value ?? '').trim();
        if (!raw) {
            return null;
        }
        const parsed = Date.parse(raw);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function formatPlaybackClock(totalSeconds) {
        const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds ?? 0) || 0));
        const hours = Math.floor(safeSeconds / 3600);
        const minutes = Math.floor((safeSeconds % 3600) / 60);
        const seconds = safeSeconds % 60;
        if (hours > 0) {
            return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function formatPlaybackProgress(nowPlaying, nowMs = Date.now()) {
        if (!nowPlaying || typeof nowPlaying !== 'object') {
            return '';
        }
        const duration = Number(nowPlaying.duration ?? 0);
        const startedAtMs = parseStartedAt(nowPlaying.started_at);
        if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(startedAtMs)) {
            return '';
        }
        const elapsedSeconds = Math.min(
            Math.max(0, duration),
            Math.max(0, Math.floor((Number(nowMs) - startedAtMs) / 1000)),
        );
        return `(${formatPlaybackClock(elapsedSeconds)} / ${formatPlaybackClock(duration)})`;
    }

    function buildNowPlayingText(nowPlaying, nowMs = Date.now()) {
        const baseText = nowPlayingText(nowPlaying);
        const progressText = formatPlaybackProgress(nowPlaying, nowMs);
        return progressText ? `${baseText} ${progressText}` : baseText;
    }

    function resetProgressTicker() {
        if (progressTimerId !== null) {
            clearInterval(progressTimerId);
            progressTimerId = null;
        }
        progressRenderers = [];
    }

    function armProgressTicker() {
        if (progressRenderers.length === 0) {
            return;
        }
        progressTimerId = setInterval(() => {
            progressRenderers.forEach(render => {
                try {
                    render();
                } catch (_) {
                    // Keep the lobby responsive even if one card render fails.
                }
            });
        }, 1000);
    }

    function summaryText(station) {
        const showName = String(station.active_show_name ?? '').trim();
        const reason = String(station.status_reason ?? '').trim();
        if (showName && reason) {
            return `${showName} - ${reason}`;
        }
        if (showName) {
            return showName;
        }
        if (reason) {
            return reason;
        }
        return 'Broadcast details will appear here.';
    }

    function createCardElement(station, status, { loading = false } = {}) {
        const meta = STATUS_META[status];
        const card = document.createElement('article');
        card.className = `lobby-card ${meta.className}`;
        card.dataset.stationId = String(station.id);
        if (loading) {
            card.classList.add('lobby-card--loading');
        } else {
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            card.setAttribute('aria-label', `Open login for ${station.name ?? 'station'}`);
            card.addEventListener('click', () => {
                window.location.assign(buildLoginUrl(station.id));
            });
            card.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    window.location.assign(buildLoginUrl(station.id));
                }
            });
        }

        const top = document.createElement('div');
        top.className = 'lobby-card-top';

        const nameWrap = document.createElement('div');
        nameWrap.className = 'lobby-card-namewrap';

        const kicker = document.createElement('p');
        kicker.className = 'lobby-card-kicker';
        kicker.textContent = loading ? 'Broadcast wall' : meta.description;

        const heading = document.createElement('h2');
        heading.textContent = loading ? 'Loading stations' : String(station.name ?? 'Untitled Station');

        const sub = document.createElement('p');
        sub.className = 'lobby-card-sub';
        sub.textContent = loading
            ? 'Waiting for catalog data'
            : summaryText(station);

        const badge = document.createElement('span');
        badge.className = `lobby-status-badge lobby-status-badge--${status}`;
        badge.textContent = loading ? 'Loading' : meta.label;

        nameWrap.appendChild(kicker);
        nameWrap.appendChild(heading);
        nameWrap.appendChild(sub);
        top.appendChild(nameWrap);
        top.appendChild(badge);

        const nowPlaying = document.createElement('div');
        nowPlaying.className = 'lobby-card-nowplaying';
        const renderNowPlaying = () => {
            nowPlaying.textContent = loading
                ? 'Public station details will render here.'
                : buildNowPlayingText(station.now_playing);
        };
        renderNowPlaying();
        if (!loading && formatPlaybackProgress(station.now_playing)) {
            progressRenderers.push(renderNowPlaying);
        }

        const footer = document.createElement('div');
        footer.className = 'lobby-card-footer';

        const footnote = document.createElement('span');
        footnote.className = 'lobby-card-footnote';
        footnote.textContent = loading ? 'Loading' : `Station #${station.id}`;

        const action = document.createElement('span');
        action.className = 'lobby-card-action';
        action.textContent = loading ? 'Loading' : 'Open login';

        footer.appendChild(footnote);
        footer.appendChild(action);

        card.appendChild(top);
        card.appendChild(nowPlaying);
        card.appendChild(footer);
        return card;
    }

    function setSummaryCounts(stations) {
        const counts = {
            live: 0,
            degraded: 0,
            offline: 0,
        };
        for (const station of stations) {
            const status = normalizeStatus(station.status);
            counts[status] += 1;
        }

        const liveCount = document.getElementById('lobbyLiveCount');
        const degradedCount = document.getElementById('lobbyDegradedCount');
        const offlineCount = document.getElementById('lobbyOfflineCount');

        if (liveCount) liveCount.textContent = `${counts.live} live`;
        if (degradedCount) degradedCount.textContent = `${counts.degraded} degraded`;
        if (offlineCount) offlineCount.textContent = `${counts.offline} offline`;
    }

    function clearGrid(grid) {
        if (!grid) return;
        if (typeof grid.replaceChildren === 'function') {
            grid.replaceChildren();
            return;
        }
        if (Array.isArray(grid.children)) {
            grid.children.length = 0;
        }
        if ('innerHTML' in grid) {
            grid.innerHTML = '';
        }
    }

    function createStateCard({ title, message, badgeLabel, badgeStatus, footnote = '', actionLabel = '' }) {
        const card = document.createElement('article');
        card.className = 'lobby-card lobby-card-empty lobby-card--loading';

        const top = document.createElement('div');
        top.className = 'lobby-card-top';

        const nameWrap = document.createElement('div');
        nameWrap.className = 'lobby-card-namewrap';

        const kicker = document.createElement('p');
        kicker.className = 'lobby-card-kicker';
        kicker.textContent = 'Broadcast wall';

        const heading = document.createElement('h2');
        heading.textContent = title;

        const sub = document.createElement('p');
        sub.className = 'lobby-card-sub';
        sub.textContent = message;

        const badge = document.createElement('span');
        badge.className = `lobby-status-badge lobby-status-badge--${badgeStatus}`;
        badge.textContent = badgeLabel;

        nameWrap.appendChild(kicker);
        nameWrap.appendChild(heading);
        nameWrap.appendChild(sub);
        top.appendChild(nameWrap);
        top.appendChild(badge);

        const nowPlaying = document.createElement('div');
        nowPlaying.className = 'lobby-card-nowplaying';
        nowPlaying.textContent = message;

        const footer = document.createElement('div');
        footer.className = 'lobby-card-footer';

        const footnoteEl = document.createElement('span');
        footnoteEl.className = 'lobby-card-footnote';
        footnoteEl.textContent = footnote;

        const action = document.createElement('span');
        action.className = 'lobby-card-action';
        action.textContent = actionLabel;

        footer.appendChild(footnoteEl);
        footer.appendChild(action);

        card.appendChild(top);
        card.appendChild(nowPlaying);
        card.appendChild(footer);
        return card;
    }

    function renderEmptyState(grid, message) {
        if (!grid) return;
        clearGrid(grid);
        grid.appendChild(createStateCard({
            title: 'No active stations',
            message,
            badgeLabel: 'Offline',
            badgeStatus: 'offline',
            footnote: 'No stations',
            actionLabel: 'Check back soon',
        }));
    }

    async function loadStations() {
        const grid = document.getElementById('publicStationGrid');
        if (!grid) {
            return [];
        }

        resetProgressTicker();
        grid.setAttribute('aria-busy', 'true');

        try {
            const response = await fetch(PUBLIC_STATIONS_ENDPOINT);
            if (!response.ok) {
                throw new Error(`Failed to load public stations (${response.status})`);
            }
            const payload = await response.json();
            const stations = getStationList(payload);

            if (stations.length === 0) {
                renderEmptyState(grid, 'No stations are currently available in the public catalog.');
                setSummaryCounts([]);
                return [];
            }

            clearGrid(grid);
            for (const station of stations) {
                const status = normalizeStatus(station.status);
                const card = createCardElement(station, status);
                grid.appendChild(card);
            }

            setSummaryCounts(stations);
            armProgressTicker();
            return stations;
        } catch (error) {
            console.error('Failed to load public stations', error);
            renderEmptyState(grid, 'Broadcast data could not be loaded right now.');
            setSummaryCounts([]);
            return [];
        } finally {
            grid.setAttribute('aria-busy', 'false');
        }
    }

    async function boot() {
        const shell = document.getElementById('publicStationLobby');
        if (shell) {
            shell.setAttribute('data-lobby-ready', 'true');
        }
        applyBrand(DEFAULT_DISPLAY_BRAND);
        await loadBrand();
        await loadStations();
    }

    const api = {
        loadStations,
        loadBrand,
        buildLoginUrl,
        normalizeStatus,
        formatPlaybackProgress,
        nowPlayingText,
    };

    globalThis.PublicLobby = api;

    const readyState = String(document.readyState ?? '');
    if (readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else if (readyState === 'interactive' || readyState === 'complete') {
        boot();
    }
})();
