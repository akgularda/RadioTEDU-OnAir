/**
 * RadioTEDU OnAir - Frontend Logic
 * Connects the UI to the FastAPI backend.
 */

const API_BASE = ""; // Same origin
const SYSTEM_SETTINGS_DEFAULTS = Object.freeze({
    ui_language: 'en-US',
    default_crossfade_seconds: 3.0,
    operation_logs_enabled: true,
    auto_scan_on_startup: false,
    display_brand_name: 'RadioTEDU OnAir',
    active_station_id: 1,
    speaker_monitor_station_id: 1,
});
const SHOW_CAPABILITY_KEYS = Object.freeze([
    'show.broadcast',
    'show.queue_edit',
    'show.jingle_manage',
    'show.break_control',
    'show.end',
]);

const MAX_CLIENT_ERROR_LOGS = 300;
const ADS_PRICING_STORAGE_KEY = 'radio_ads_pricing_v1';
const AUTH_STORAGE_KEYS = Object.freeze({
    accessToken: 'cleanroom_auth_access_token',
    refreshToken: 'cleanroom_auth_refresh_token',
    user: 'cleanroom_auth_user',
});
let lastToastFingerprint = '';
let lastToastAt = 0;

function clipText(value, maxLen = 300) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

function parseApiErrorText(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return '';
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
            const detail = parsed.detail ?? parsed.message ?? parsed.error;
            if (detail !== undefined && detail !== null) {
                return clipText(typeof detail === 'string' ? detail : JSON.stringify(detail), 420);
            }
        }
    } catch (_) {
        // Keep raw text when it is not JSON.
    }
    return clipText(text, 420);
}

function recordClientError({ title, detail = '', source = 'ui', level = 'error', statusCode = 0 } = {}) {
    const eventTitle = clipText(title || 'Client error', 160) || 'Client error';
    const eventDetail = clipText(detail, 500);
    const nowIso = new Date().toISOString();
    const item = {
        id: `client-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        played_at: nowIso,
        title: eventTitle,
        artist: source || 'UI',
        duration: 0,
        track_type: 'system',
        source: 'client',
        log_type: 'client',
        action: eventTitle,
        method: 'UI',
        endpoint: source || 'ui',
        status_code: statusCode || 0,
        duration_ms: 0,
        level: level || 'error',
        details: eventDetail,
    };

    currentState.clientErrors.unshift(item);
    if (currentState.clientErrors.length > MAX_CLIENT_ERROR_LOGS) {
        currentState.clientErrors.length = MAX_CLIENT_ERROR_LOGS;
    }

    if (currentState.panel === 'logs') {
        renderCombinedLogs();
    }
}

function cloneHeaders(headers) {
    if (!headers) return {};
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        return Object.fromEntries(headers.entries());
    }
    if (Array.isArray(headers)) {
        return Object.fromEntries(headers);
    }
    return { ...headers };
}

function hasAuthorizationHeader(headers) {
    return Object.keys(headers || {}).some(key => String(key).toLowerCase() === 'authorization');
}

function isAuthApiUrl(url) {
    const token = String(url || '');
    return token.includes('/api/auth/login')
        || token.includes('/api/auth/refresh')
        || token.includes('/api/auth/logout')
        || token.includes('/api/auth/me')
        || token.includes('/api/auth/password');
}

function getSafeSameOriginPath(candidate, fallback = '/app') {
    const fallbackPath = String(fallback || '/app') || '/app';
    const raw = String(candidate || '').trim();
    if (!raw) {
        return fallbackPath;
    }

    try {
        const base = String(window.location?.origin || window.location?.href || '');
        const resolved = base ? new URL(raw, base) : new URL(raw);
        if (String(window.location?.origin || '') && resolved.origin !== String(window.location.origin)) {
            return fallbackPath;
        }
        return `${resolved.pathname}${resolved.search}${resolved.hash}` || fallbackPath;
    } catch (_) {
        return fallbackPath;
    }
}

function getSafeAppShellPath(candidate, fallback = '/app') {
    const fallbackPath = String(fallback || '/app') || '/app';
    const safePath = getSafeSameOriginPath(candidate, fallbackPath);
    try {
        const base = String(window.location?.origin || window.location?.href || '');
        const resolved = base ? new URL(safePath, base) : new URL(safePath);
        if (resolved.pathname !== '/app' && resolved.pathname !== '/app/') {
            return fallbackPath;
        }
        return `${resolved.pathname}${resolved.search}${resolved.hash}` || fallbackPath;
    } catch (_) {
        return fallbackPath;
    }
}

function getLoginNextPath() {
    if (!String(window.location?.pathname || '').endsWith('/login.html')) {
        return '/app';
    }
    const params = new URLSearchParams(String(window.location?.search || ''));
    return getSafeAppShellPath(params.get('next'), '/app');
}

function getCurrentSameOriginPath() {
    if (isAuthenticatedAppShell()) {
        try {
            const stationId = Number(currentState?.currentStationId || 0);
            const stations = Array.isArray(currentState?.stations) ? currentState.stations : [];
            const hasResolvedStation = Number.isInteger(stationId) && stationId > 0
                && (stationId !== 1 || stations.some(station => Number(station?.id || 0) === stationId));
            if (hasResolvedStation) {
                return `/app?station_id=${stationId}`;
            }
        } catch (_) {
            // Fall back to the current URL if app state is not ready yet.
        }
    }
    const pathname = String(window.location?.pathname || '');
    const search = String(window.location?.search || '');
    const hash = String(window.location?.hash || '');
    return getSafeSameOriginPath(`${pathname}${search}${hash}`, '/app');
}

function syncAuthenticatedAppShellUrl() {
    if (!isAuthenticatedAppShell() || typeof window?.history?.replaceState !== 'function') {
        return false;
    }
    const stationId = Number(currentState?.currentStationId || 0);
    if (!Number.isInteger(stationId) || stationId <= 0) {
        return false;
    }

    const pathname = String(window.location?.pathname || '/app');
    if (pathname.replace(/\/+$/, '') !== '/app') {
        return false;
    }

    const hash = String(window.location?.hash || '');
    const nextPath = `/app?station_id=${stationId}${hash}`;
    const currentPath = `${pathname}${String(window.location?.search || '')}${hash}`;
    if (currentPath === nextPath) {
        return false;
    }

    window.history.replaceState(window.history.state || null, '', nextPath);
    return true;
}

function getPreferredStationIdFromUrl() {
    const params = new URLSearchParams(String(window.location?.search || ''));
    const raw = Number(params.get('station_id') || 0);
    return Number.isInteger(raw) && raw > 0 ? raw : null;
}

const Auth = {
    getAccessToken() {
        return window.localStorage.getItem(AUTH_STORAGE_KEYS.accessToken) || '';
    },
    getRefreshToken() {
        return window.localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken) || '';
    },
    getUser() {
        const raw = window.localStorage.getItem(AUTH_STORAGE_KEYS.user);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (_) {
            return null;
        }
    },
    setUser(user) {
        if (!user || typeof user !== 'object') {
            window.localStorage.removeItem(AUTH_STORAGE_KEYS.user);
            return;
        }
        window.localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify(user));
    },
    setSession(payload = {}) {
        if (payload.access_token) {
            window.localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, String(payload.access_token));
        }
        if (payload.refresh_token) {
            window.localStorage.setItem(AUTH_STORAGE_KEYS.refreshToken, String(payload.refresh_token));
        }
        if (payload.user) {
            this.setUser(payload.user);
        }
    },
    clearSession() {
        window.localStorage.removeItem(AUTH_STORAGE_KEYS.accessToken);
        window.localStorage.removeItem(AUTH_STORAGE_KEYS.refreshToken);
        window.localStorage.removeItem(AUTH_STORAGE_KEYS.user);
    },
    isLoginPage() {
        return String(window.location?.pathname || '').endsWith('/login.html');
    },
    redirectToLogin() {
        if (this.isLoginPage()) return;
        const nextPath = getCurrentSameOriginPath();
        const loginPath = `/login.html?next=${encodeURIComponent(nextPath)}`;
        if (typeof window.location?.replace === 'function') {
            window.location.replace(loginPath);
            return;
        }
        if (window.location) {
            window.location.pathname = '/login.html';
            window.location.search = `?next=${encodeURIComponent(nextPath)}`;
        }
    },
    redirectToLobby() {
        if (typeof window.location?.replace === 'function') {
            window.location.replace('/');
            return;
        }
        if (window.location) {
            window.location.pathname = '/';
            window.location.search = '';
            window.location.hash = '';
        }
    },
    redirectToApp(nextPath = null) {
        const target = nextPath !== null && nextPath !== undefined
            ? getSafeAppShellPath(nextPath, '/app')
            : getLoginNextPath();
        if (typeof window.location?.replace === 'function') {
            window.location.replace(target);
            return;
        }
        if (window.location) {
            const resolved = String(target || '/app');
            const [pathnameAndSearch, hash = ''] = resolved.split('#');
            const [pathname = '/app', search = ''] = pathnameAndSearch.split('?');
            window.location.pathname = pathname || '/app';
            window.location.search = search ? `?${search}` : '';
            window.location.hash = hash ? `#${hash}` : '';
        }
    },
    withAuthHeaders(headers = {}, accessToken = this.getAccessToken(), skipAuthHeader = false) {
        const nextHeaders = cloneHeaders(headers);
        if (!skipAuthHeader && accessToken && !hasAuthorizationHeader(nextHeaders)) {
            nextHeaders.Authorization = `Bearer ${accessToken}`;
        }
        return nextHeaders;
    },
    async login(username, password) {
        const response = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        if (!response.ok) {
            const detail = parseApiErrorText(await response.text()) || 'Login failed';
            throw new Error(detail);
        }
        const data = await response.json();
        this.setSession(data);
        return data;
    },
    async refresh() {
        const refreshToken = this.getRefreshToken();
        if (!refreshToken) return null;
        const response = await fetch(`${API_BASE}/api/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!response.ok) {
            this.clearSession();
            return null;
        }
        const data = await response.json();
        this.setSession({ ...data, user: this.getUser() });
        return data;
    },
    async ensureSession() {
        if (!this.getAccessToken()) {
            return false;
        }
        try {
            const user = await apiFetch(`${API_BASE}/api/auth/me`, {
                skipAuthRedirect: true,
            });
            this.setUser(user);
            return true;
        } catch (_) {
            return false;
        }
    },
    async bootstrap() {
        const ok = await this.ensureSession();
        if (!ok) {
            this.clearSession();
            this.redirectToLogin();
            return false;
        }
        return true;
    },
    async bootstrapLoginPage() {
        if (!this.getAccessToken()) {
            return false;
        }
        const ok = await this.ensureSession();
        if (ok) {
            this.redirectToApp();
            return true;
        }
        this.clearSession();
        return false;
    },
    async logout() {
        try {
            if (typeof globalThis !== 'undefined' && globalThis.IdleSessionManager?.stop) {
                globalThis.IdleSessionManager.stop();
            }
            await apiFetch(`${API_BASE}/api/auth/logout`, {
                method: 'POST',
                skipAuthRetry: true,
                skipAuthRedirect: true,
            });
        } catch (_) {
            // Clear the local session even if the server call fails.
        }
        if (typeof globalThis !== 'undefined' && globalThis.WS?.disconnect) {
            globalThis.WS.disconnect(true);
        }
        this.clearSession();
        this.redirectToLobby();
    },
};

if (typeof globalThis !== 'undefined') {
    globalThis.Auth = Auth;
}

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const IDLE_WARNING_MS = 60 * 1000;
const IDLE_ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'];

function isAuthenticatedAppShell() {
    const pathname = String(window.location?.pathname || '');
    return pathname.replace(/\/+$/, '') === '/app';
}

function formatIdleRemaining(ms) {
    const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
    if (totalSeconds >= 60) {
        const minutes = Math.ceil(totalSeconds / 60);
        return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }
    return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
}

function getIdleSessionUi() {
    return {
        banner: document.getElementById('idleTimeoutBanner'),
        message: document.getElementById('idleTimeoutMessage'),
        countdown: document.getElementById('idleTimeoutCountdown'),
        staySignedInBtn: document.getElementById('idleStaySignedInBtn'),
    };
}

const IdleSessionManager = (() => {
    let enabled = false;
    let active = false;
    let warningVisible = false;
    let expiresAt = 0;
    let warningTimerId = null;
    let expiryTimerId = null;
    let warningTickTimerId = null;
    let listenersBound = false;
    let buttonBound = false;

    function clearTimer(timerId, clearFn) {
        if (timerId !== null && timerId !== undefined) {
            clearFn(timerId);
        }
    }

    function remainingMs() {
        return Math.max(0, expiresAt - Date.now());
    }

    function renderWarning() {
        const ui = getIdleSessionUi();
        if (!ui.banner) return;

        const visible = enabled && active && warningVisible && remainingMs() > 0;
        ui.banner.hidden = !visible;

        if (!visible) {
            return;
        }

        const text = formatIdleRemaining(remainingMs());
        if (ui.message) {
            ui.message.textContent = `You've been inactive. Your session expires in ${text}.`;
        }
        if (ui.countdown) {
            ui.countdown.textContent = `Expires in ${text}`;
        }
    }

    function hideWarning() {
        warningVisible = false;
        const ui = getIdleSessionUi();
        if (ui.banner) {
            ui.banner.hidden = true;
        }
        clearTimer(warningTickTimerId, clearInterval);
        warningTickTimerId = null;
    }

    function expire() {
        if (!enabled || !active) return;
        stop();
        if (typeof Auth.logout === 'function') {
            void Auth.logout();
        }
    }

    function showWarning() {
        if (!enabled || !active) return;
        warningVisible = true;
        renderWarning();
        clearTimer(warningTickTimerId, clearInterval);
        warningTickTimerId = setInterval(() => {
            if (!enabled || !active || !warningVisible) return;
            if (remainingMs() <= 0) {
                expire();
                return;
            }
            renderWarning();
        }, 1000);
    }

    function schedule() {
        clearTimer(warningTimerId, clearTimeout);
        clearTimer(expiryTimerId, clearTimeout);
        warningTimerId = null;
        expiryTimerId = null;

        if (!enabled || !active) {
            hideWarning();
            return;
        }

        const msLeft = remainingMs();
        if (msLeft <= 0) {
            expire();
            return;
        }

        if (msLeft <= IDLE_WARNING_MS) {
            showWarning();
            expiryTimerId = setTimeout(expire, msLeft);
            return;
        }

        hideWarning();
        warningTimerId = setTimeout(() => {
            showWarning();
        }, msLeft - IDLE_WARNING_MS);
        expiryTimerId = setTimeout(expire, msLeft);
    }

    function reset() {
        if (!enabled || !active) return false;
        expiresAt = Date.now() + IDLE_TIMEOUT_MS;
        warningVisible = false;
        schedule();
        return true;
    }

    function handleActivity() {
        reset();
    }

    function bindListeners() {
        if (listenersBound) return;
        listenersBound = true;
        if (typeof document?.addEventListener === 'function') {
            IDLE_ACTIVITY_EVENTS.forEach((eventName) => {
                document.addEventListener(eventName, handleActivity, true);
            });
        }
        if (typeof window?.addEventListener === 'function') {
            window.addEventListener('scroll', handleActivity, true);
        }
    }

    function bindButton() {
        if (buttonBound) return;
        const ui = getIdleSessionUi();
        if (!ui.staySignedInBtn || typeof ui.staySignedInBtn.addEventListener !== 'function') {
            return;
        }
        buttonBound = true;
        ui.staySignedInBtn.addEventListener('click', (event) => {
            event.preventDefault?.();
            reset();
        });
    }

    function start() {
        enabled = true;
        active = true;
        warningVisible = false;
        bindListeners();
        bindButton();
        expiresAt = Date.now() + IDLE_TIMEOUT_MS;
        schedule();
        return getState();
    }

    function stop() {
        clearTimer(warningTimerId, clearTimeout);
        clearTimer(expiryTimerId, clearTimeout);
        warningTimerId = null;
        expiryTimerId = null;
        active = false;
        enabled = false;
        hideWarning();
    }

    function init(options = {}) {
        const shouldEnable = Object.prototype.hasOwnProperty.call(options, 'enabled')
            ? !!options.enabled
            : isAuthenticatedAppShell();
        if (!shouldEnable) {
            stop();
            return getState();
        }
        bindListeners();
        bindButton();
        return start();
    }

    function getState() {
        return {
            enabled,
            active,
            warningVisible,
            expiresAt,
            remainingMs: remainingMs(),
        };
    }

    return {
        init,
        start,
        stop,
        reset,
        getState,
    };
})();

if (typeof globalThis !== 'undefined') {
    globalThis.IdleSessionManager = IdleSessionManager;
}

// API fetch wrapper with error handling
async function apiFetch(url, options = {}) {
    const requestOptions = { ...(options || {}) };
    const skipAuthRetry = !!requestOptions.skipAuthRetry;
    const skipAuthRedirect = !!requestOptions.skipAuthRedirect;
    const skipAuthHeader = !!requestOptions.skipAuthHeader;
    delete requestOptions.skipAuthRetry;
    delete requestOptions.skipAuthRedirect;
    delete requestOptions.skipAuthHeader;

    const attemptFetch = async (accessToken) => {
        const headers = Auth.withAuthHeaders(requestOptions.headers, accessToken, skipAuthHeader);
        return fetch(url, { ...requestOptions, headers });
    };

    let res;
    try {
        res = await attemptFetch(Auth.getAccessToken());
    } catch (err) {
        const method = String(requestOptions?.method || 'GET').toUpperCase();
        const requestLabel = `${method} ${url}`;
        const detail = clipText(err?.message || 'Network request failed', 420);
        recordClientError({
            title: 'Network request failed',
            detail: `${requestLabel} | ${detail}`,
            source: 'api',
            level: 'error'
        });
        showToast({ message: 'Could not reach backend service.', detail }, 'error', { title: 'Network Error', duration: 10000 });
        throw err;
    }

    if (res.status === 401 && !skipAuthRetry && !isAuthApiUrl(url)) {
        const refreshed = await Auth.refresh();
        if (refreshed?.access_token) {
            res = await attemptFetch(Auth.getAccessToken());
        }
    }

    if (!res.ok) {
        if (res.status === 401 && !skipAuthRedirect) {
            Auth.clearSession();
            Auth.redirectToLogin();
        }

        const method = String(requestOptions?.method || 'GET').toUpperCase();
        const requestLabel = `${method} ${url}`;
        const errText = await res.text();
        const detail = parseApiErrorText(errText) || `${requestLabel} failed`;
        const level = res.status >= 500 ? 'error' : 'warn';

        recordClientError({
            title: `API error (${res.status})`,
            detail: `${requestLabel} | ${detail}`,
            source: 'api',
            level,
            statusCode: res.status
        });
        showToast(
            { message: `Request failed (${res.status})`, detail },
            'error',
            { title: 'API Error', duration: 9000 }
        );
        throw new Error(detail || `Request failed (${res.status})`);
    }
    if (res.status === 204 || res.status === 205) {
        return null;
    }

    if (typeof res.text === 'function') {
        const responseText = await res.text();
        if (!responseText) {
            return null;
        }

        try {
            return JSON.parse(responseText);
        } catch (_) {
            return responseText;
        }
    }

    if (typeof res.json === 'function') {
        return res.json();
    }

    return null;
}

function normalizeDisplayBrandName(value) {
    const normalized = String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized || SYSTEM_SETTINGS_DEFAULTS.display_brand_name;
}

function getDisplayBrandTitle(brandName) {
    const safeBrand = normalizeDisplayBrandName(brandName);
    const pathname = String(window.location?.pathname || '');
    if (pathname === '/' || pathname === '/index.html') {
        return `${safeBrand} Broadcast Wall`;
    }
    if (String(pathname).endsWith('/login.html')) {
        return `${safeBrand} Login`;
    }
    return `${safeBrand} Control Surface`;
}

function applyDisplayBrandName(value) {
    const safeBrand = normalizeDisplayBrandName(value);
    const brandSlots = ['brandLogoText', 'authBrandName', 'lobbyBrandName'];
    brandSlots.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = safeBrand;
        }
    });
    if (typeof document !== 'undefined' && 'title' in document) {
        document.title = getDisplayBrandTitle(safeBrand);
    }
    return safeBrand;
}

async function loadDisplayBrandName() {
    try {
        const data = await apiFetch(`${API_BASE}/api/settings/system`, {
            skipAuthRetry: true,
            skipAuthRedirect: true,
        });
        const settings = { ...SYSTEM_SETTINGS_DEFAULTS, ...(data?.settings || {}) };
        currentState.sharedSettings = { ...currentState.sharedSettings, ...settings };
        return applyDisplayBrandName(settings.display_brand_name);
    } catch (_) {
        return applyDisplayBrandName(currentState.sharedSettings?.display_brand_name);
    }
}


// State
let currentState = {
    panel: 'onair',
    currentStationId: 1, // Default station
    activeBroadcastStationId: 1,
    stations: [],
    sharedSettings: { ...SYSTEM_SETTINGS_DEFAULTS },
    stationSettings: {},
    tracks: [],
    playlists: [],
    schedules: [],
    logs: [],
    serverLogs: [],
    clientErrors: [],
    stats: {},
    health: {},
    currentTrack: null,
    nextTrack: null,
    queueItems: [],
    queueStationId: 1,
    onAirMode: 'automation',
    programMusicMode: 'normal',
    isDucking: false,
    programLibraryTracks: [],
    programLibrarySearch: '',
    programLibraryStationId: null,
    programQueueItems: [],
    programQueueSource: 'automation',
    programQueueEffectiveSource: 'automation',
    programQueueFallbackActive: false,
    selectedShowId: null,
    activeShowSession: null,
    programWorkspaceClaimedShowId: null,
    programQueueStationId: null,
    programQueueMinTracksForHost: 3,
    studios: [],
    selectedStudioId: 0,
    joinedStudioId: 0,
    chatHistory: [],
    metadataRules: [],
    libraryScope: 'local',
    librarySourceStationId: null,
    currentPage: 1,
    totalPages: 1,
    adsBreakSets: [],
    adsCampaigns: [],
    adsRuntime: null,
    adTracks: [],
    adJingleTracks: [],
    adsStationId: null,
    adBreakSetEditorId: null,
    adCampaignEditorId: null,
    adCampaignModalEditorId: null,
    adsPricing: {
        currency: 'USD',
        pricePerSecond: 0.2,
        fallbackDurationSec: 30,
        trackPricing: {},
        activeOnly: true,
    },
    rolePermissionGroups: {},
    roleTemplates: [],
    roleTemplateEditorId: null,
    roleTemplateModalMode: 'create',
    users: [],
    userEditorId: null,
    userSelectedId: null,
    userModalMode: 'create',
    programAssignments: {
        stationId: null,
        showId: null,
        assignmentUserId: null,
        assignmentRole: 'dj',
        permissionKeys: [],
        shows: [],
        assignments: [],
        users: [],
    },
    subpages: {
        library: 'catalog',
        downloads: 'imports',
        ads: 'overview',
        'admin-access': 'users',
    }
};

if (typeof globalThis !== 'undefined') {
    globalThis.currentState = currentState;
}

function readAppPerfToggle(name, fallback = false) {
    const key = String(name || '').trim();
    if (!key) return fallback;

    try {
        const runtimeFlags = globalThis.__RADIO_APP_PERF__;
        if (runtimeFlags && typeof runtimeFlags === 'object' && key in runtimeFlags) {
            return Boolean(runtimeFlags[key]);
        }
    } catch (_) {
        // Ignore runtime flag lookup failures.
    }

    try {
        const raw = window.localStorage.getItem(`radio_app_perf_${key}`);
        if (raw === '1' || raw === 'true') return true;
        if (raw === '0' || raw === 'false') return false;
    } catch (_) {
        // Ignore storage lookup failures.
    }

    return fallback;
}

const APP_PERF_FLAGS = Object.freeze({
    lazyPanels: readAppPerfToggle('lazy_panels', true),
    eagerPanelFallback: readAppPerfToggle('eager_panel_fallback', false),
    visiblePanelPolling: readAppPerfToggle('visible_panel_polling', true),
});

function isLazyPanelModeEnabled() {
    return APP_PERF_FLAGS.lazyPanels && !APP_PERF_FLAGS.eagerPanelFallback;
}

function isVisiblePanelPollingEnabled() {
    return isLazyPanelModeEnabled() && APP_PERF_FLAGS.visiblePanelPolling;
}

const panelRuntimeState = {
    initialized: new Set(),
    initPromises: new Map(),
    lastRefreshAt: {},
    lastStationId: {},
    pollingReady: false,
    panelTimers: new Map(),
    shellTimers: new Map(),
};

let playlistEditorState = {
    playlistId: null,
    name: '',
    items: []
};
let autoPlaylistFilterStation = null;
let scheduleCache = [];
let scheduleEditorState = { scheduleId: null };
let ytdlpSettingsLoaded = false;
let ytdlpFocusedJobId = null;
let ytdlpLastTerminalStatus = {};
let audioToolsState = {
    trackId: null,
    title: '',
    artist: '',
    filePath: '',
    mediaUrl: '',
    duration: 0,
    zoom: 1,
    viewportStart: 0,
    viewportDuration: 0,
    selectionStart: 0,
    selectionEnd: 0,
    selectionAnchor: 0,
    selecting: false,
    waveformPeaks: [],
    loadToken: 0,
    canvasBound: false,
    playerBound: false,
    rafId: null,
    segments: []
};
let _programLibrarySearchTimer = null;
let _programLibraryReqSeq = 0;
let _programLibraryAppliedSeq = 0;
let _programLibraryLastQueryKey = '';
let _programQueueInFlight = false;
let _programQueueLastAt = 0;
let _programAdsRuntimeInFlight = false;
let _programAdsRuntimeLastAt = 0;

// ============================================
// INITIALIZATION
// ============================================
function updateAuthUi() {
    const user = Auth.getUser();
    const nameEl = document.getElementById('authDisplayName');
    const roleEl = document.getElementById('authRole');
    if (nameEl) {
        nameEl.textContent = user?.display_name || user?.username || 'Unknown User';
    }
    if (roleEl) {
        roleEl.textContent = user?.role ? String(user.role).toUpperCase() : 'UNAUTHENTICATED';
    }
    syncPanelVisibilityUi();
    syncMicPanelAccessUi();
    syncAdminAccessUi();
}

function initAuthUi() {
    const logoutBtn = document.getElementById('authLogoutBtn');
    if (!logoutBtn || logoutBtn.dataset.boundClick === '1') return;
    logoutBtn.dataset.boundClick = '1';
    logoutBtn.addEventListener('click', () => {
        Auth.logout();
    });
}

function initLoginPage() {
    const form = document.getElementById('loginForm');
    if (!form || form.dataset.boundSubmit === '1') return;

    const usernameEl = document.getElementById('loginUsername');
    const passwordEl = document.getElementById('loginPassword');
    const errorEl = document.getElementById('loginError');
    const submitBtn = document.getElementById('loginSubmit');

    const setError = (message = '') => {
        if (!errorEl) return;
        errorEl.textContent = message;
        errorEl.hidden = !message;
    };

    form.dataset.boundSubmit = '1';
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const username = String(usernameEl?.value || '').trim();
        const password = String(passwordEl?.value || '');

        setError('');
        if (submitBtn) submitBtn.disabled = true;

        try {
            await Auth.login(username, password);
            const ok = await Auth.ensureSession();
            if (!ok) {
                throw new Error('Session bootstrap failed');
            }
            Auth.redirectToApp();
        } catch (err) {
            setError(clipText(err?.message || 'Sign in failed', 180));
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });
}

const WS = {
    socket: null,
    reconnectTimer: 0,
    stationId: null,
    manualClose: false,
    connect(forceReconnect = false) {
        if (Auth.isLoginPage() || typeof WebSocket === 'undefined') {
            return;
        }
        const token = Auth.getAccessToken();
        const stationId = Number(currentState.currentStationId || 1);
        if (!token || !Number.isInteger(stationId) || stationId <= 0) {
            return;
        }
        const readyState = Number(this.socket?.readyState);
        const isOpen = typeof WebSocket !== 'undefined' && readyState === WebSocket.OPEN;
        const isConnecting = typeof WebSocket !== 'undefined' && readyState === WebSocket.CONNECTING;
        if (!forceReconnect && this.socket && this.stationId === stationId && (isOpen || isConnecting)) {
            return;
        }

        this.disconnect(true);
        this.manualClose = false;
        this.stationId = stationId;

        const url = buildWsUrl(token, stationId);
        if (!url) return;
        const socket = new WebSocket(url);
        this.socket = socket;

        socket.addEventListener('message', async (event) => {
            try {
                const payload = JSON.parse(String(event?.data || '{}'));
                await this.handleEvent(payload);
            } catch (_) {
                // Ignore malformed websocket frames.
            }
        });

        socket.addEventListener('close', () => {
            const shouldReconnect = !this.manualClose;
            if (this.socket === socket) {
                this.socket = null;
            }
            if (shouldReconnect) {
                this.scheduleReconnect();
            }
        });
    },
    disconnect(manual = false) {
        this.manualClose = manual;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = 0;
        }
        if (this.socket) {
            try {
                this.socket.close();
            } catch (_) {
                // Ignore close errors.
            }
            this.socket = null;
        }
    },
    send(payload) {
        const socket = this.socket;
        if (!socket || typeof socket.send !== 'function') {
            return false;
        }
        const openState = typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1;
        if (Number(socket.readyState) !== Number(openState)) {
            return false;
        }
        if (payload instanceof ArrayBuffer || ArrayBuffer.isView(payload)) {
            socket.send(payload);
            return true;
        }
        socket.send(JSON.stringify(payload || {}));
        return true;
    },
    scheduleReconnect() {
        if (this.reconnectTimer || Auth.isLoginPage() || !Auth.getAccessToken()) {
            return;
        }
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = 0;
            this.connect(true);
        }, 2000);
    },
    async handleEvent(event) {
        const eventType = String(event?.type || '').trim();
        const stationId = Number(event?.station_id || event?.payload?.station_id || 0);
        const currentStationId = Number(currentState.currentStationId || 0);
        if (stationId > 0 && currentStationId > 0 && stationId !== currentStationId) {
            return;
        }

        if (eventType === 'queue.updated') {
            applyQueueSnapshot(event?.payload || {});
            return;
        }
        if (eventType === 'health.updated') {
            applyHealthSnapshot(event?.payload || {});
            return;
        }
        if (eventType === 'runtime.updated' || eventType === 'track.changed' || eventType === 'engine.event') {
            await applyStatusSnapshot(event?.payload || {});
        }
        if (eventType === 'mic.status' || eventType === 'mic.level' || eventType === 'mic.error'
            || eventType === 'webrtc.answer' || eventType === 'webrtc.ice' || eventType === 'webrtc.error') {
            if (globalThis.MicManager && typeof globalThis.MicManager.handleWsEvent === 'function') {
                await globalThis.MicManager.handleWsEvent(event);
            }
        }
        if (eventType === 'studio.status' || eventType === 'dj.presence' || eventType === 'chat.message') {
            if (globalThis.StudioManager && typeof globalThis.StudioManager.handleWsEvent === 'function') {
                await globalThis.StudioManager.handleWsEvent(event);
            }
        }
        if (eventType === 'soundboard.played' || eventType === 'soundboard.stopped') {
            if (globalThis.SoundBoardManager && typeof globalThis.SoundBoardManager.handleWsEvent === 'function') {
                await globalThis.SoundBoardManager.handleWsEvent(event);
            }
        }
        if (eventType === 'show.preparing' || eventType === 'show.going_live' ||
            eventType === 'show.intro_playing' || eventType === 'show.live' ||
            eventType === 'show.break_start' || eventType === 'show.break_end' ||
            eventType === 'show.outro_playing' || eventType === 'show.ended') {
            loadCurrentSession();
        }
        if (eventType === 'show.queue_low') {
            const warn = document.getElementById('showQueueWarning');
            if (warn) {
                warn.style.display = 'block';
                setTimeout(() => { warn.style.display = 'none'; }, 15000);
            }
        }
    },
};

function buildWsUrl(token, stationId) {
    const protocol = String(window.location?.protocol || 'http:') === 'https:' ? 'wss' : 'ws';
    const host = String(window.location?.host || '').trim();
    if (!host) return '';
    return `${protocol}://${host}/ws?token=${encodeURIComponent(token)}&station_id=${stationId}`;
}

if (typeof globalThis !== 'undefined') {
    globalThis.WS = WS;
}

function normalizeOperatorRole(role) {
    const normalized = String(role || '').trim().toLowerCase();
    return normalized === 'superadmin' ? 'admin' : normalized;
}

function canUseLiveMicUi() {
    const role = normalizeOperatorRole(Auth.getUser()?.role);
    return role === 'admin' || role === 'dj';
}

function getEffectivePermissionSet(user = Auth.getUser()) {
    const permissions = user?.effective_permissions;
    if (!permissions) {
        return new Set();
    }
    if (permissions instanceof Set) {
        return new Set(Array.from(permissions, permission => String(permission).trim()).filter(Boolean));
    }
    if (Array.isArray(permissions)) {
        return new Set(permissions.map(permission => String(permission).trim()).filter(Boolean));
    }
    return new Set(Array.from(new Set(permissions), permission => String(permission).trim()).filter(Boolean));
}

function hasPermission(permissionKey, user = Auth.getUser()) {
    const key = String(permissionKey || '').trim();
    if (!key) return false;
    return getEffectivePermissionSet(user).has(key);
}

function hasEffectivePermission(permissionKey, user = Auth.getUser()) {
    return hasPermission(permissionKey, user);
}

function canAccessAdminAccessPanel(user = Auth.getUser()) {
    return [
        'users.manage',
        'users.reset_password',
        'roles.manage',
        'show.assign.manage',
        'stations.view',
        'stations.create',
        'stations.edit',
        'stations.delete',
    ].some(permissionKey => hasEffectivePermission(permissionKey, user));
}

function canOpenProgramPanel(user = Auth.getUser()) {
    return hasPermission('program.panel.open', user);
}

function normalizePermissionSet(permissionValues) {
    if (!permissionValues) {
        return new Set();
    }
    if (permissionValues instanceof Set) {
        return new Set(Array.from(permissionValues, permission => String(permission).trim()).filter(Boolean));
    }
    if (Array.isArray(permissionValues)) {
        return new Set(permissionValues.map(permission => String(permission).trim()).filter(Boolean));
    }
    if (permissionValues instanceof Map) {
        return new Set(Array.from(permissionValues.values(), permission => String(permission).trim()).filter(Boolean));
    }
    return new Set(Array.from(new Set(permissionValues), permission => String(permission).trim()).filter(Boolean));
}

function getShowPermissionSet(showId, user = Auth.getUser()) {
    const normalizedShowId = Number(showId || 0);
    if (!Number.isInteger(normalizedShowId) || normalizedShowId <= 0) {
        return new Set();
    }

    const role = normalizeOperatorRole(user?.role);
    if (role === 'admin') {
        return new Set(SHOW_CAPABILITY_KEYS);
    }

    const showPermissions = user?.show_permissions;
    if (!showPermissions) {
        return new Set();
    }

    const directPermissions = showPermissions instanceof Map
        ? (showPermissions.get(normalizedShowId) ?? showPermissions.get(String(normalizedShowId)))
        : showPermissions[normalizedShowId] ?? showPermissions[String(normalizedShowId)];
    return normalizePermissionSet(directPermissions);
}

function getProgramControlState({
    selectedShowId = currentState.selectedShowId,
    activeShowSession = currentState.activeShowSession,
    currentUser = Auth.getUser(),
} = {}) {
    const session = activeShowSession || null;
    const showId = Number(session?.show_id || selectedShowId || 0);
    const permissions = getShowPermissionSet(showId, currentUser);
    const isAdmin = String(currentUser?.role || '').trim().toLowerCase() === 'admin';
    const sessionStatus = String(session?.status || '').trim().toLowerCase();

    const canBroadcast = isAdmin || permissions.has('show.broadcast');
    const canBreakControl = isAdmin || permissions.has('show.break_control');
    const canEnd = isAdmin || permissions.has('show.end');
    const canQueueEdit = isAdmin || permissions.has('show.queue_edit');
    const canManageJingles = isAdmin || permissions.has('show.jingle_manage');
    const hasWorkspaceClaim = Boolean(
        session || (showId > 0 && Number(currentState.programWorkspaceClaimedShowId || 0) === showId)
    );

    return {
        showId,
        selectedShowId: Number(selectedShowId || 0),
        sessionStatus,
        showPermissions: permissions,
        canEditQueue: canQueueEdit,
        canManageJingles,
        canGoLive: Boolean(canBroadcast && !!showId && hasWorkspaceClaim && (!session || sessionStatus === 'preparing')),
        canGoBreak: Boolean(session && sessionStatus === 'live' && canBreakControl),
        canEndShow: Boolean(session && ['live', 'on_break', 'break_outro', 'break_intro'].includes(sessionStatus) && canEnd),
    };
}

function getCurrentProgramActionShowId() {
    return Number(currentState.activeShowSession?.show_id || currentState.selectedShowId || 0);
}

function canManageUsers(user = Auth.getUser()) {
    return hasEffectivePermission('users.manage', user);
}

function canResetUserPasswords(user = Auth.getUser()) {
    return canManageUsers(user) || hasEffectivePermission('users.reset_password', user);
}

function refreshSoundboardSurfaces({ reload = false } = {}) {
    const manager = globalThis.SoundBoardManager;
    if (!manager) return;
    if (reload && typeof manager.loadItems === 'function') {
        manager.loadItems(currentState.currentStationId || 1);
        return;
    }
    if (typeof manager.render === 'function') {
        manager.render();
    }
}

function computeVisiblePanels(currentUser = Auth.getUser()) {
    const user = currentUser || Auth.getUser();
    const visiblePanels = ['onair'];
    const addPanel = (panelId, allowed) => {
        if (allowed && !visiblePanels.includes(panelId)) {
            visiblePanels.push(panelId);
        }
    };

    addPanel('program', canOpenProgramPanel(user));
    addPanel('library', hasPermission('library.view', user) || hasPermission('library.edit', user));
    addPanel('downloads', hasPermission('downloads.use', user));
    addPanel('playlists', hasPermission('playlists.view', user) || hasPermission('playlists.edit', user));
    addPanel('schedule', hasPermission('schedule.view', user) || hasPermission('schedule.edit', user));
    addPanel('ads', hasPermission('ads.view', user) || hasPermission('ads.edit', user));
    addPanel(
        'soundboard',
        hasPermission('soundboard.view', user)
            || hasPermission('soundboard.play', user)
            || hasPermission('soundboard.manage', user),
    );
    addPanel('shows', hasPermission('shows.view', user) || hasPermission('shows.manage', user));
    addPanel('admin-access', canAccessAdminAccessPanel(user));
    addPanel('ai-host', true);  // AI Host visible to all authenticated users
    addPanel('logs', hasPermission('logs.view', user));
    addPanel(
        'settings',
        hasPermission('stations.view', user)
            || hasPermission('stations.create', user)
            || hasPermission('stations.edit', user)
            || hasPermission('stations.delete', user),
    );

    return visiblePanels;
}

function syncPanelVisibilityUi() {
    const user = Auth.getUser();
    const visiblePanels = new Set(computeVisiblePanels(user));
    const activePanel = visiblePanels.has(currentState.panel) ? currentState.panel : 'onair';

    if (currentState.panel !== activePanel) {
        currentState.panel = activePanel;
    }

    document.querySelectorAll('.nav-btn[data-panel]').forEach(btn => {
        const panelId = String(btn.dataset?.panel || '').trim();
        const allowed = visiblePanels.has(panelId);
        btn.hidden = !allowed;
        btn.disabled = !allowed;
        btn.setAttribute?.('aria-hidden', String(!allowed));
        btn.setAttribute?.('aria-disabled', String(!allowed));
        btn.classList.toggle('active', panelId === activePanel);
    });

    document.querySelectorAll('.panel[id^="panel-"]').forEach(panel => {
        const panelId = String(panel.id || '').replace(/^panel-/, '');
        const allowed = visiblePanels.has(panelId);
        panel.hidden = !allowed;
        panel.classList.toggle('active', panelId === activePanel);
    });

    syncOnAirModeUi();
}

if (typeof globalThis !== 'undefined') {
    globalThis.hasPermission = hasPermission;
    globalThis.canOpenProgramPanel = canOpenProgramPanel;
    globalThis.computeVisiblePanels = computeVisiblePanels;
}

function canAccessAdminAccessSubpage(subpage, user = Auth.getUser()) {
    const safeSubpage = String(subpage || '').trim();
    if (safeSubpage === 'users') {
        return canManageUsers(user) || canResetUserPasswords(user);
    }
    if (safeSubpage === 'roles') {
        return hasEffectivePermission('roles.manage', user);
    }
    if (safeSubpage === 'program-assignments') {
        return hasEffectivePermission('show.assign.manage', user);
    }
    if (safeSubpage === 'stations') {
        return ['stations.view', 'stations.create', 'stations.edit', 'stations.delete']
            .some(permissionKey => hasEffectivePermission(permissionKey, user));
    }
    return false;
}

function getAdminAccessAllowedSubpages(user = Auth.getUser()) {
    return ['users', 'roles', 'program-assignments', 'stations']
        .filter(subpage => canAccessAdminAccessSubpage(subpage, user));
}

function getAdminAccessFallbackSubpage(user = Auth.getUser(), preferred = 'users') {
    const allowed = getAdminAccessAllowedSubpages(user);
    if (allowed.includes(preferred)) {
        return preferred;
    }
    return allowed[0] || null;
}

function syncAdminAccessUi() {
    const navBtn = Array.from(document.querySelectorAll('.nav-btn'))
        .find(btn => String(btn.dataset?.panel || '').trim() === 'admin-access') || null;
    const panel = document.getElementById('panel-admin-access');
    const user = Auth.getUser();
    const allowedSubpages = getAdminAccessAllowedSubpages(user);
    const allowed = canAccessAdminAccessPanel();

    if (navBtn) {
        navBtn.hidden = !allowed;
        navBtn.disabled = !allowed;
        navBtn.setAttribute?.('aria-hidden', String(!allowed));
        navBtn.setAttribute?.('aria-disabled', String(!allowed));
    }

    if (panel) {
        panel.hidden = !allowed;
    }

    document.querySelectorAll('.subpage-tabs[data-group="admin-access"] .subpage-tab').forEach(btn => {
        const subpage = String(btn.dataset?.subpage || '').trim();
        const subpageAllowed = allowedSubpages.includes(subpage);
        btn.hidden = !subpageAllowed;
        btn.disabled = !subpageAllowed;
        btn.setAttribute?.('aria-hidden', String(!subpageAllowed));
        btn.setAttribute?.('aria-disabled', String(!subpageAllowed));
    });

    document.querySelectorAll('.subpage-view[data-group="admin-access"]').forEach(view => {
        const subpage = String(view.dataset?.subpage || '').trim();
        view.hidden = !allowedSubpages.includes(subpage);
    });

    const activeAdminSubpage = String(currentState.subpages?.['admin-access'] || '').trim();
    if (allowed && currentState.panel === 'admin-access' && !allowedSubpages.includes(activeAdminSubpage)) {
        const fallback = getAdminAccessFallbackSubpage(user);
        if (fallback) {
            currentState.subpages['admin-access'] = fallback;
            switchSubpage('admin-access', fallback, true);
        }
    }

    if (!allowed && currentState.panel === 'admin-access') {
        switchPanel('onair');
    }
}

function syncMicPanelAccessUi() {
    const micPanel = document.getElementById('micPanel');
    if (!micPanel) return;
    micPanel.hidden = !canUseLiveMicUi();
}

function getRolePermissionGroups() {
    return currentState.rolePermissionGroups || {};
}

function canManageStationsAdmin(user = Auth.getUser()) {
    return ['stations.view', 'stations.create', 'stations.edit', 'stations.delete']
        .some(permissionKey => hasEffectivePermission(permissionKey, user));
}

function canCreateStationsAdmin(user = Auth.getUser()) {
    return hasEffectivePermission('stations.create', user);
}

function canEditStationsAdmin(user = Auth.getUser()) {
    return hasEffectivePermission('stations.edit', user);
}

function canDeleteStationsAdmin(user = Auth.getUser()) {
    return hasEffectivePermission('stations.delete', user);
}

function getStationsAdminState() {
    if (!currentState.stationsAdmin || typeof currentState.stationsAdmin !== 'object') {
        currentState.stationsAdmin = {
            items: [],
            activeStationId: null,
        };
    }
    return currentState.stationsAdmin;
}

function normalizeStationAdminItem(station) {
    const raw = station && typeof station === 'object' ? station : {};
    const id = Number(raw.id || 0);
    const name = String(raw.name || '').trim() || (id > 0 ? `Station ${id}` : 'Untitled Station');
    const slug = String(raw.slug || '').trim() || `station-${id || 'x'}`;
    return { id, name, slug };
}

function renderStationsAdminList() {
    const container = document.getElementById('stationsAdminList');
    const nameInput = document.getElementById('adminStationName');
    const createBtn = document.getElementById('adminStationCreateBtn');
    if (!container) return;

    const state = getStationsAdminState();
    const items = Array.isArray(state.items) ? state.items : [];
    const activeStationId = Number(state.activeStationId || 0);
    const allowManage = canManageStationsAdmin();
    const allowCreate = canCreateStationsAdmin();
    const allowEdit = canEditStationsAdmin();
    const allowDelete = canDeleteStationsAdmin();

    if (nameInput) {
        nameInput.disabled = !allowCreate;
    }
    if (createBtn) {
        createBtn.hidden = !allowCreate;
        createBtn.disabled = !allowCreate;
    }

    if (!allowManage) {
        container.innerHTML = '<div class="admin-access-empty">Station permissions are required.</div>';
        return;
    }

    if (!items.length) {
        container.innerHTML = '<div class="admin-access-empty">No stations found.</div>';
        return;
    }

    container.innerHTML = items.map(station => {
        const stationId = Number(station.id || 0);
        const isActive = stationId > 0 && stationId === activeStationId;
        const disableDelete = !allowDelete || items.length <= 1;
        const disableActivate = !allowEdit || isActive;
        return `
            <article class="program-assignment-item stations-admin-item ${isActive ? 'active' : ''}">
                <div class="program-assignment-item-main">
                    <div class="program-assignment-item-head">
                        <strong>${escapeHtml(station.name || `Station ${stationId}`)}</strong>
                        <span class="program-assignment-role">${isActive ? 'Active' : `#${stationId}`}</span>
                    </div>
                    <div class="program-assignment-item-meta">
                        <span>${escapeHtml(station.slug || '')}</span>
                        <span>${isActive ? 'Active broadcast target' : 'Available station'}</span>
                    </div>
                </div>
                <div class="program-assignment-item-actions">
                    <button
                        class="btn-sm"
                        type="button"
                        data-action="set-active-station"
                        onclick="setActiveAdminStation(${stationId})"
                        ${disableActivate ? 'disabled' : ''}
                    >${isActive ? 'Active' : 'Set Active'}</button>
                    <button
                        class="btn-sm delete-btn"
                        type="button"
                        data-action="delete-station"
                        onclick="deleteAdminStation(${stationId})"
                        ${disableDelete ? 'disabled' : ''}
                    >Delete</button>
                </div>
            </article>
        `;
    }).join('');
}

async function loadStationsAdminPanel(forceRefresh = false) {
    const container = document.getElementById('stationsAdminList');
    if (container && (forceRefresh || !Array.isArray(getStationsAdminState().items) || !getStationsAdminState().items.length)) {
        container.innerHTML = '<div class="admin-access-empty">Loading stations...</div>';
    }

    try {
        const stationsPayload = await apiFetch(`${API_BASE}/api/stations`);
        const activePayload = await apiFetch(`${API_BASE}/api/stations/active`);
        const items = Array.isArray(stationsPayload?.stations)
            ? stationsPayload.stations
            : (Array.isArray(stationsPayload) ? stationsPayload : []);
        const normalized = items.map(normalizeStationAdminItem).filter(station => Number(station.id || 0) > 0);
        const activeStationId = Number(activePayload?.station_id || normalized[0]?.id || 0) || null;

        const state = getStationsAdminState();
        state.items = normalized;
        state.activeStationId = activeStationId;
        currentState.stations = normalized;
        if (activeStationId) {
            currentState.currentStationId = activeStationId;
        } else if (normalized[0]?.id) {
            currentState.currentStationId = Number(normalized[0].id);
        }
        renderStationsAdminList();
        renderStationSelector();
        renderProgramAssignmentStationOptions();
        applyLibraryScopeUi();
        return state;
    } catch (err) {
        if (container) {
            container.innerHTML = '<div class="admin-access-empty">Stations could not be loaded.</div>';
        }
        console.warn('stations admin load failed', err);
        return null;
    }
}

async function createAdminStation() {
    const nameInput = document.getElementById('adminStationName');
    const stationName = String(nameInput?.value || '').trim();
    if (!stationName) {
        showToast('Station name is required', 'error');
        return null;
    }

    try {
        const payload = await apiFetch(`${API_BASE}/api/stations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: stationName }),
        });
        if (nameInput) {
            nameInput.value = '';
        }
        await loadStationsAdminPanel(true);
        showToast(`Station created: ${stationName}`);
        return payload;
    } catch (err) {
        console.warn('station create failed', err);
        return null;
    }
}

async function setActiveAdminStation(stationId) {
    const sid = Number(stationId || 0);
    if (!Number.isInteger(sid) || sid <= 0) return null;

    try {
        await apiFetch(`${API_BASE}/api/stations/active`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ station_id: sid }),
        });
        await loadStationsAdminPanel(true);
        return true;
    } catch (err) {
        console.warn('station activate failed', err);
        return null;
    }
}

async function deleteAdminStation(stationId) {
    const sid = Number(stationId || 0);
    if (!Number.isInteger(sid) || sid <= 0) return null;
    if (typeof confirm === 'function' && !confirm('Delete this station?')) {
        return null;
    }

    try {
        const payload = await apiFetch(`${API_BASE}/api/stations/${sid}`, { method: 'DELETE' });
        await loadStationsAdminPanel(true);
        return payload;
    } catch (err) {
        console.warn('station delete failed', err);
        return null;
    }
}

function normalizeRolePermissionGroups(permissionGroups) {
    if (!permissionGroups || typeof permissionGroups !== 'object') return {};
    return Object.entries(permissionGroups).reduce((acc, [group, permissions]) => {
        if (!Array.isArray(permissions)) return acc;
        acc[String(group)] = permissions.map(permission => String(permission)).filter(Boolean);
        return acc;
    }, {});
}

function getRolePermissionGroupLabel(groupKey) {
    return String(groupKey || '')
        .split(/[\s._-]+/g)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function normalizeRoleTemplateItem(item) {
    return {
        id: Number(item?.id || 0),
        name: String(item?.name || '').trim(),
        description: String(item?.description || '').trim(),
        is_system: !!item?.is_system,
        is_active: item?.is_active !== false,
        permission_keys: Array.isArray(item?.permission_keys)
            ? item.permission_keys.map(permission => String(permission)).filter(Boolean)
            : [],
    };
}

function normalizeUserItem(item) {
    return {
        id: Number(item?.id || 0),
        username: String(item?.username || '').trim(),
        display_name: String(item?.display_name || '').trim(),
        role: String(item?.role || '').trim() || 'viewer',
        legacy_role: String(item?.legacy_role || item?.role || '').trim() || 'viewer',
        is_active: item?.is_active !== false,
        role_template_ids: Array.isArray(item?.role_template_ids)
            ? item.role_template_ids.map(roleTemplateId => Number(roleTemplateId)).filter(Number.isFinite)
            : [],
        effective_permissions: Array.isArray(item?.effective_permissions)
            ? item.effective_permissions.map(permission => String(permission)).filter(Boolean)
            : [],
        last_login_at: item?.last_login_at || null,
        avatar_url: String(item?.avatar_url || '').trim(),
    };
}

function normalizeProgramAssignmentShow(item) {
    return {
        id: Number(item?.id || 0),
        station_id: Number(item?.station_id || 0),
        name: String(item?.name || '').trim(),
        description: String(item?.description || '').trim(),
        is_active: item?.is_active !== false,
    };
}

function normalizeProgramAssignmentItem(item) {
    return {
        user_id: Number(item?.user_id || 0),
        username: String(item?.username || '').trim(),
        display_name: String(item?.display_name || '').trim(),
        role: String(item?.role || 'dj').trim() || 'dj',
        permission_keys: Array.isArray(item?.permission_keys)
            ? item.permission_keys.map(permission => String(permission)).filter(Boolean)
            : [],
    };
}

function getLegacyRoleTemplateName(role) {
    const normalizedRole = String(role || '').trim().toLowerCase();
    if (normalizedRole === 'admin') return 'Legacy Admin';
    if (normalizedRole === 'dj') return 'Legacy DJ';
    if (normalizedRole === 'producer') return 'Legacy Producer';
    if (normalizedRole === 'viewer') return 'Legacy Viewer';
    return '';
}

function getRoleTemplateById(roleTemplateId) {
    const targetId = Number(roleTemplateId || 0);
    if (!Number.isInteger(targetId) || targetId <= 0) return null;
    return (Array.isArray(currentState.roleTemplates) ? currentState.roleTemplates : [])
        .find(role => Number(role.id) === targetId) || null;
}

function getRoleTemplateIdsForRole(role) {
    const legacyName = getLegacyRoleTemplateName(role);
    if (!legacyName) return [];
    return (Array.isArray(currentState.roleTemplates) ? currentState.roleTemplates : [])
        .filter(roleTemplate => String(roleTemplate.name || '') === legacyName)
        .map(roleTemplate => Number(roleTemplate.id))
        .filter(Number.isFinite);
}

function collectSelectedUserRoleTemplateIds() {
    const select = document.getElementById('userRoleTemplateSelect');
    if (!select) return [];

    if (select.selectedOptions && typeof select.selectedOptions.length === 'number') {
        return Array.from(select.selectedOptions)
            .map(option => Number(option.value || option.dataset?.roleTemplateId || 0))
            .filter(Number.isFinite);
    }

    if (select.options) {
        const optionMatches = Array.from(select.options)
            .filter(option => !!option?.selected)
            .map(option => Number(option.value || option.dataset?.roleTemplateId || 0))
            .filter(Number.isFinite);
        return optionMatches;
    }

    return [];
}

function renderUserRoleTemplateOptions(selectedRoleTemplateIds = []) {
    const select = document.getElementById('userRoleTemplateSelect');
    if (!select) return;

    const roles = (Array.isArray(currentState.roleTemplates) ? currentState.roleTemplates : [])
        .filter(role => role?.is_active !== false);
    const selected = new Set((Array.isArray(selectedRoleTemplateIds) ? selectedRoleTemplateIds : [])
        .map(roleTemplateId => Number(roleTemplateId))
        .filter(Number.isFinite));

    if (!roles.length) {
        select.innerHTML = `
            <option value="" disabled selected>No role templates loaded</option>
        `;
        return;
    }

    select.innerHTML = roles.map(role => `
        <option value="${Number(role.id || 0)}" ${selected.has(Number(role.id || 0)) ? 'selected' : ''}>
            ${escapeHtml(role.name || `Role #${Number(role.id || 0)}`)}
        </option>
    `).join('');
}

function getSelectedUserRoleTemplateSummaries(roleTemplateIds = collectSelectedUserRoleTemplateIds()) {
    const selectedIds = Array.from(new Set((Array.isArray(roleTemplateIds) ? roleTemplateIds : [])
        .map(roleTemplateId => Number(roleTemplateId))
        .filter(Number.isFinite)));
    return selectedIds.map(roleTemplateId => {
        const template = getRoleTemplateById(roleTemplateId);
        return {
            id: roleTemplateId,
            name: template?.name || `Role #${roleTemplateId}`,
            permission_keys: Array.isArray(template?.permission_keys) ? template.permission_keys : [],
        };
    });
}

function buildUserDraftPermissionsPreview() {
    const roleInput = document.getElementById('userRole');
    const usernameInput = document.getElementById('userUsername');
    const displayNameInput = document.getElementById('userDisplayName');
    const activeInput = document.getElementById('userActive');
    const selectedTemplates = getSelectedUserRoleTemplateSummaries();
    const permissionKeys = Array.from(new Set(selectedTemplates.flatMap(template => template.permission_keys || [])));
    const roleLabel = String(roleInput?.value || 'viewer').trim().toUpperCase();
    const displayName = String(displayNameInput?.value || usernameInput?.value || 'New user').trim() || 'New user';
    const statusLabel = activeInput?.checked === false ? 'Inactive' : 'Active';

    return `
        <div class="user-preview-summary">
            <div class="user-preview-line">
                <span class="user-preview-label">Draft user</span>
                <strong>${escapeHtml(displayName)}</strong>
            </div>
            <div class="user-preview-line">
                <span class="user-preview-label">Legacy role</span>
                <strong>${escapeHtml(roleLabel)}</strong>
            </div>
            <div class="user-preview-line">
                <span class="user-preview-label">Status</span>
                <strong>${escapeHtml(statusLabel)}</strong>
            </div>
            <div class="user-preview-line">
                <span class="user-preview-label">Role templates</span>
                <div class="user-preview-tags">
                    ${selectedTemplates.length
                        ? selectedTemplates.map(template => `<span class="user-preview-tag">${escapeHtml(template.name)}</span>`).join('')
                        : '<span class="user-preview-empty-tag">No role templates selected</span>'}
                </div>
            </div>
            <div class="user-preview-line">
                <span class="user-preview-label">Effective permissions</span>
                <div class="user-preview-tags">
                    ${permissionKeys.length
                        ? permissionKeys.map(permission => `<span class="user-preview-tag">${escapeHtml(permission)}</span>`).join('')
                        : '<span class="user-preview-empty-tag">No effective permissions</span>'}
                </div>
            </div>
        </div>
    `;
}

function buildUserEffectivePermissionsPreview(user = null) {
    const normalizedUser = user ? normalizeUserItem(user) : null;
    const selectedRoleTemplateIds = normalizedUser?.role_template_ids?.length
        ? normalizedUser.role_template_ids
        : getRoleTemplateIdsForRole(normalizedUser?.role || '');
    const roleTemplateNames = selectedRoleTemplateIds
        .map(roleTemplateId => getRoleTemplateById(roleTemplateId)?.name || `Role #${roleTemplateId}`)
        .filter(Boolean);
    const effectivePermissions = normalizedUser?.effective_permissions || [];
    const roleLabel = normalizedUser?.role ? normalizedUser.role.toUpperCase() : 'NEW USER';

    if (!normalizedUser) {
        return `
            <div class="user-preview-empty">
                Select a user to review the inherited permissions from their role templates.
            </div>
        `;
    }

    return `
        <div class="user-preview-summary">
            <div class="user-preview-line">
                <span class="user-preview-label">Legacy role</span>
                <strong>${escapeHtml(roleLabel)}</strong>
            </div>
            <div class="user-preview-line">
                <span class="user-preview-label">Role templates</span>
                <div class="user-preview-tags">
                    ${roleTemplateNames.length
                        ? roleTemplateNames.map(name => `<span class="user-preview-tag">${escapeHtml(name)}</span>`).join('')
                        : '<span class="user-preview-empty-tag">No templates assigned</span>'}
                </div>
            </div>
            <div class="user-preview-line">
                <span class="user-preview-label">Effective permissions</span>
                <div class="user-preview-tags">
                    ${effectivePermissions.length
                        ? effectivePermissions.map(permission => `<span class="user-preview-tag">${escapeHtml(permission)}</span>`).join('')
                        : '<span class="user-preview-empty-tag">No effective permissions</span>'}
                </div>
            </div>
        </div>
    `;
}

function renderUsersList() {
    const container = document.getElementById('userList');
    if (!container) return;

    const users = Array.isArray(currentState.users) ? currentState.users : [];
    if (!users.length) {
        container.innerHTML = `
            <div class="admin-access-empty">
                No users loaded yet.
                <button class="btn-sm" type="button" onclick="loadUsers(true)">Load users</button>
            </div>
        `;
        const preview = document.getElementById('effectivePermissionsPreview');
        if (preview) {
            preview.innerHTML = buildUserEffectivePermissionsPreview(null);
        }
        return;
    }

    container.innerHTML = users.map(user => {
        const isSelected = Number(currentState.userSelectedId || 0) === Number(user.id || 0);
        const effectivePermissions = Array.isArray(user.effective_permissions) ? user.effective_permissions : [];
        const roleTemplateNames = (Array.isArray(user.role_template_ids) ? user.role_template_ids : [])
            .map(roleTemplateId => getRoleTemplateById(roleTemplateId)?.name || `Role #${roleTemplateId}`)
            .filter(Boolean);
        return `
            <article class="user-item ${isSelected ? 'active' : ''}" data-user-id="${Number(user.id || 0)}">
                <button class="user-item-main" type="button" onclick="selectUser(${Number(user.id || 0)})">
                    <div class="user-item-head">
                        <strong>${escapeHtml(user.display_name || user.username || 'Untitled user')}</strong>
                        <div class="user-item-badges">
                            <span class="user-item-badge ${user.is_active ? 'is-active' : 'is-inactive'}">${user.is_active ? 'Active' : 'Inactive'}</span>
                            <span class="user-item-badge">${escapeHtml(String(user.role || 'viewer').toUpperCase())}</span>
                        </div>
                    </div>
                    <div class="user-item-meta">
                        <span>@${escapeHtml(user.username || 'unknown')}</span>
                        <span>${Array.isArray(user.role_template_ids) && user.role_template_ids.length ? `${user.role_template_ids.length} role templates` : 'Legacy role only'}</span>
                        <span>${roleTemplateNames.length ? escapeHtml(roleTemplateNames.join(', ')) : 'No explicit templates'}</span>
                        <span>${effectivePermissions.length ? escapeHtml(effectivePermissions.join(', ')) : 'No effective permissions'}</span>
                    </div>
                </button>
                <div class="user-item-actions">
                    <button class="btn-sm" type="button" onclick="openUserEditModal(${Number(user.id || 0)})">Edit</button>
                    <button class="btn-sm delete-btn" type="button" onclick="promptResetUserPassword(${Number(user.id || 0)})">Reset Password</button>
                </div>
            </article>
        `;
    }).join('');

    renderUserSelectedPreview();
}

function renderUserSelectedPreview() {
    const preview = document.getElementById('effectivePermissionsPreview');
    if (!preview) return;
    const selectedUser = (Array.isArray(currentState.users) ? currentState.users : [])
        .find(user => Number(user.id || 0) === Number(currentState.userSelectedId || 0))
        || null;
    preview.innerHTML = buildUserEffectivePermissionsPreview(selectedUser);
}

function renderUserDraftPermissionsPreview() {
    const preview = document.getElementById('userDraftPermissionsPreview');
    if (!preview) return;
    preview.innerHTML = buildUserDraftPermissionsPreview();
}

function canReadRoleTemplates(user = Auth.getUser()) {
    return hasEffectivePermission('roles.manage', user) || canManageUsers(user);
}

function syncUserForm(user = null) {
    const idInput = document.getElementById('userId');
    const usernameInput = document.getElementById('userUsername');
    const displayNameInput = document.getElementById('userDisplayName');
    const roleInput = document.getElementById('userRole');
    const activeInput = document.getElementById('userActive');
    const passwordInput = document.getElementById('userPassword');
    const resetPasswordInput = document.getElementById('userResetPassword');
    const titleEl = document.getElementById('userModalTitle');
    const saveBtn = document.getElementById('userSaveBtn');
    const resetPasswordBtn = document.getElementById('userResetPasswordBtn');
    const selectedUser = user ? normalizeUserItem(user) : null;
    const isEditing = !!selectedUser?.id;

    currentState.userEditorId = selectedUser?.id || null;
    currentState.userModalMode = isEditing ? 'edit' : 'create';

    if (idInput) idInput.value = selectedUser?.id ? String(selectedUser.id) : '';
    if (usernameInput) {
        usernameInput.value = selectedUser?.username || '';
        usernameInput.disabled = isEditing;
    }
    if (displayNameInput) {
        displayNameInput.value = selectedUser?.display_name || '';
    }
    if (roleInput) {
        roleInput.value = selectedUser?.role || 'viewer';
    }
    if (activeInput) {
        activeInput.checked = selectedUser ? selectedUser.is_active : true;
    }
    if (passwordInput) {
        passwordInput.value = '';
        passwordInput.hidden = isEditing;
    }
    if (resetPasswordInput) {
        resetPasswordInput.value = '';
        resetPasswordInput.hidden = !isEditing;
    }
    if (titleEl) {
        titleEl.textContent = isEditing ? `Edit User #${selectedUser.id}` : 'Create User';
    }
    if (saveBtn) {
        saveBtn.textContent = isEditing ? 'Save Changes' : 'Create User';
    }
    if (resetPasswordBtn) {
        resetPasswordBtn.hidden = !isEditing;
        resetPasswordBtn.disabled = !isEditing;
    }

    renderUserRoleTemplateOptions(selectedUser?.role_template_ids || []);
    renderUserDraftPermissionsPreview();
    renderUserSelectedPreview();
}

function selectUser(userId) {
    const targetId = Number(userId || 0);
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    currentState.userSelectedId = targetId;
    renderUsersList();
}

async function loadUsers(forceRefresh = false) {
    const container = document.getElementById('userList');
    if (container && (forceRefresh || !Array.isArray(currentState.users) || !currentState.users.length)) {
        container.innerHTML = '<div class="admin-access-empty">Loading users...</div>';
    }

    try {
        if ((!Array.isArray(currentState.roleTemplates) || !currentState.roleTemplates.length) && canReadRoleTemplates()) {
            await loadRoleTemplates(true);
        }

        const payload = await apiFetch(`${API_BASE}/api/users`);
        const items = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : []);
        currentState.users = items.map(normalizeUserItem);
        if (!currentState.userSelectedId && currentState.users.length) {
            currentState.userSelectedId = currentState.users[0].id;
        }
        renderUsersList();
        return currentState.users;
    } catch (err) {
        if (container) {
            container.innerHTML = '<div class="admin-access-empty">Users could not be loaded.</div>';
        }
        renderUserSelectedPreview();
        return null;
    }
}

function openUserCreateModal() {
    syncUserForm(null);
    const modal = document.getElementById('userModal');
    if (modal) modal.style.display = 'flex';
}

function openUserEditModal(userId) {
    const targetId = Number(userId || 0);
    const user = (Array.isArray(currentState.users) ? currentState.users : [])
        .find(item => Number(item.id || 0) === targetId) || null;
    if (!user) {
        showToast('User not found', 'error');
        return;
    }
    currentState.userSelectedId = targetId;
    syncUserForm(user);
    const modal = document.getElementById('userModal');
    if (modal) modal.style.display = 'flex';
}

function closeUserModal() {
    const modal = document.getElementById('userModal');
    if (modal) modal.style.display = 'none';
    currentState.userEditorId = null;
    currentState.userModalMode = 'create';
    const resetPasswordInput = document.getElementById('userResetPassword');
    if (resetPasswordInput) resetPasswordInput.value = '';
}

function promptResetUserPassword(userId) {
    const targetUser = (Array.isArray(currentState.users) ? currentState.users : [])
        .find(user => Number(user.id || 0) === Number(userId || 0)) || null;
    if (!targetUser) {
        showToast('User not found', 'error');
        return null;
    }
    openUserEditModal(targetUser.id);
    const resetPasswordInput = document.getElementById('userResetPassword');
    if (resetPasswordInput && typeof resetPasswordInput.focus === 'function') {
        resetPasswordInput.focus();
    }
    return targetUser;
}

async function resetUserPassword(userId, newPassword) {
    const targetId = Number(userId || 0);
    const password = String(newPassword || '').trim();
    if (!Number.isInteger(targetId) || targetId <= 0) return null;
    if (password.length < 8) {
        showToast('Password must be at least 8 characters', 'error');
        return null;
    }

    try {
        await apiFetch(`${API_BASE}/api/users/${targetId}/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_password: password }),
        });
        showToast('Password reset');
        const resetPasswordInput = document.getElementById('userResetPassword');
        if (resetPasswordInput) resetPasswordInput.value = '';
        await loadUsers(true);
        return true;
    } catch (_) {
        return null;
    }
}

async function saveUser() {
    const idInput = document.getElementById('userId');
    const usernameInput = document.getElementById('userUsername');
    const displayNameInput = document.getElementById('userDisplayName');
    const roleInput = document.getElementById('userRole');
    const activeInput = document.getElementById('userActive');
    const passwordInput = document.getElementById('userPassword');
    const resetPasswordInput = document.getElementById('userResetPassword');

    const userId = Number(idInput?.value || 0);
    const isEditing = Number.isInteger(userId) && userId > 0;
    const username = String(usernameInput?.value || '').trim();
    const displayName = String(displayNameInput?.value || '').trim();
    const role = String(roleInput?.value || '').trim() || 'viewer';
    const isActive = activeInput ? !!activeInput.checked : true;
    const selectedRoleTemplateIds = collectSelectedUserRoleTemplateIds();
    const createPassword = String(passwordInput?.value || '').trim();
    const resetPassword = String(resetPasswordInput?.value || '').trim();

    try {
        if (!displayName) {
            showToast('Display name is required', 'error');
            return null;
        }
        if (!role) {
            showToast('Legacy role is required', 'error');
            return null;
        }
        if (!isEditing && username.length < 1) {
            showToast('Username is required', 'error');
            return null;
        }
        if (!isEditing && createPassword.length < 8) {
            showToast('Password must be at least 8 characters', 'error');
            return null;
        }

        const payload = {
            display_name: displayName,
            role,
            is_active: isActive,
            role_template_ids: selectedRoleTemplateIds,
        };
        if (!isEditing) {
            payload.username = username;
            payload.password = createPassword;
        }

        const url = isEditing ? `${API_BASE}/api/users/${userId}` : `${API_BASE}/api/users`;
        const method = isEditing ? 'PUT' : 'POST';

        const result = await apiFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        showToast(isEditing ? 'User updated' : 'User created');
        if (resetPassword && isEditing) {
            await resetUserPassword(userId, resetPassword);
        } else {
            await loadUsers(true);
        }
        if (result?.id) {
            currentState.userSelectedId = Number(result.id || userId || 0) || currentState.userSelectedId;
            renderUsersList();
        }
        if (isEditing) {
            syncUserForm(result || null);
        } else {
            closeUserModal();
        }
        return result;
    } catch (_) {
        return null;
    }
}

function initUserModalUi() {
    const modal = document.getElementById('userModal');
    const form = document.getElementById('userForm');
    const roleSelect = document.getElementById('userRole');
    const roleTemplateSelect = document.getElementById('userRoleTemplateSelect');
    const usernameInput = document.getElementById('userUsername');
    const displayNameInput = document.getElementById('userDisplayName');
    const activeInput = document.getElementById('userActive');
    const resetPasswordBtn = document.getElementById('userResetPasswordBtn');
    const resetPasswordInput = document.getElementById('userResetPassword');

    if (modal && modal.dataset.bound === '1') return;
    if (modal) {
        modal.dataset.bound = '1';
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeUserModal();
            }
        });
    }
    if (form && form.dataset.boundSubmit !== '1') {
        form.dataset.boundSubmit = '1';
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            saveUser();
        });
    }
    if (roleSelect && roleSelect.dataset.boundChange !== '1') {
        roleSelect.dataset.boundChange = '1';
        roleSelect.addEventListener('change', () => {
            renderUserDraftPermissionsPreview();
            renderUserSelectedPreview();
        });
    }
    if (roleTemplateSelect && roleTemplateSelect.dataset.boundChange !== '1') {
        roleTemplateSelect.dataset.boundChange = '1';
        roleTemplateSelect.addEventListener('change', () => {
            renderUserDraftPermissionsPreview();
            renderUserSelectedPreview();
        });
    }
    if (usernameInput && usernameInput.dataset.boundInput !== '1') {
        usernameInput.dataset.boundInput = '1';
        usernameInput.addEventListener('input', () => {
            renderUserDraftPermissionsPreview();
        });
    }
    if (displayNameInput && displayNameInput.dataset.boundInput !== '1') {
        displayNameInput.dataset.boundInput = '1';
        displayNameInput.addEventListener('input', () => {
            renderUserDraftPermissionsPreview();
        });
    }
    if (activeInput && activeInput.dataset.boundChange !== '1') {
        activeInput.dataset.boundChange = '1';
        activeInput.addEventListener('change', () => {
            renderUserDraftPermissionsPreview();
        });
    }
    if (resetPasswordBtn && resetPasswordBtn.dataset.boundClick !== '1') {
        resetPasswordBtn.dataset.boundClick = '1';
        resetPasswordBtn.addEventListener('click', async () => {
            const userId = Number(document.getElementById('userId')?.value || 0);
            const password = String(resetPasswordInput?.value || '').trim();
            await resetUserPassword(userId, password);
        });
    }
}

function renderRolePermissionGroups(selectedPermissions = [], readOnly = false) {
    const container = document.getElementById('rolePermissionGroups');
    if (!container) return;

    const selected = new Set((Array.isArray(selectedPermissions) ? selectedPermissions : [])
        .map(permission => String(permission).trim())
        .filter(Boolean));
    const groups = getRolePermissionGroups();

    if (!Object.keys(groups).length) {
        container.innerHTML = `
            <div class="role-template-empty">
                Permission catalog is loading...
            </div>
        `;
        return;
    }

    container.innerHTML = Object.entries(groups).map(([groupKey, permissions]) => {
        const safeGroupKey = escapeHtml(groupKey);
        const safeGroupLabel = escapeHtml(getRolePermissionGroupLabel(groupKey));
        return `
            <section class="role-permission-group" data-permission-group="${safeGroupKey}">
                <div class="role-permission-group-head">
                    <div>
                        <h4>${safeGroupLabel}</h4>
                        <p>${escapeHtml(permissions.length)} permissions</p>
                    </div>
                </div>
                <div class="role-permission-grid">
                    ${permissions.map(permissionKey => `
                        <label class="role-permission-check">
                            <input type="checkbox" data-permission-key="${escapeHtml(permissionKey)}" ${selected.has(permissionKey) ? 'checked' : ''} ${readOnly ? 'disabled' : ''}>
                            <span>${escapeHtml(permissionKey)}</span>
                        </label>
                    `).join('')}
                </div>
            </section>
        `;
    }).join('');
}

function getProgramAssignmentsState() {
    if (!currentState.programAssignments || typeof currentState.programAssignments !== 'object') {
        currentState.programAssignments = {
            stationId: null,
            showId: null,
            assignmentUserId: null,
            assignmentRole: 'dj',
            permissionKeys: [],
            shows: [],
            assignments: [],
            users: [],
        };
    }
    return currentState.programAssignments;
}

function getProgramAssignmentByUserId(userId) {
    const targetId = Number(userId || 0);
    if (!Number.isInteger(targetId) || targetId <= 0) return null;
    return (Array.isArray(getProgramAssignmentsState().assignments) ? getProgramAssignmentsState().assignments : [])
        .find(assignment => Number(assignment.user_id || 0) === targetId) || null;
}

function resolveProgramAssignmentEditorSelection(assignments = [], preferredUserId = null) {
    const rows = Array.isArray(assignments) ? assignments : [];
    const preferredId = Number(preferredUserId || 0);
    if (Number.isInteger(preferredId) && preferredId > 0) {
        const preferredAssignment = rows.find(assignment => Number(assignment.user_id || 0) === preferredId) || null;
        if (preferredAssignment) {
            return { assignment: preferredAssignment, selectedUserId: preferredId };
        }
    }

    const firstAssignment = rows[0] || null;
    if (firstAssignment) {
        return {
            assignment: firstAssignment,
            selectedUserId: Number(firstAssignment.user_id || 0) || null,
        };
    }

    return { assignment: null, selectedUserId: null };
}

function resetProgramAssignmentsPanelState(stationId = currentState.currentStationId) {
    const state = getProgramAssignmentsState();
    const nextStationId = Number(stationId || currentState.currentStationId || 0) || null;
    state.stationId = nextStationId;
    state.showId = null;
    state.assignmentUserId = null;
    state.assignmentRole = 'dj';
    state.permissionKeys = [];
    state.shows = [];
    state.assignments = [];
    state.users = [];
    renderProgramAssignmentStationOptions();
    renderProgramAssignmentShowOptions();
    renderProgramAssignmentUserOptions();
    syncProgramAssignmentForm(null, null);
    renderProgramAssignmentList();
}

function collectSelectedProgramAssignmentPermissionKeys() {
    const container = document.getElementById('programAssignmentCapabilityList');
    if (!container || typeof container.querySelectorAll !== 'function') return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"][data-permission-key]:checked'))
        .filter(input => input?.checked !== false)
        .map(input => String(input.dataset?.permissionKey || '').trim())
        .filter(Boolean);
}

function renderProgramAssignmentStationOptions() {
    const select = document.getElementById('programAssignmentStationSelect');
    if (!select) return;
    const stations = Array.isArray(currentState.stations) ? currentState.stations : [];
    const state = getProgramAssignmentsState();
    const selectedStationId = Number(state.stationId || currentState.currentStationId || stations[0]?.id || 0);

    if (!stations.length) {
        select.innerHTML = '<option value="">No stations available</option>';
        select.value = '';
        return;
    }

    select.innerHTML = stations.map(station => `
        <option value="${Number(station.id || 0)}" ${Number(station.id || 0) === selectedStationId ? 'selected' : ''}>
            ${escapeHtml(station.name || `Station ${station.id}`)}
        </option>
    `).join('');
    select.value = selectedStationId ? String(selectedStationId) : '';
}

function renderProgramAssignmentShowOptions() {
    const select = document.getElementById('programAssignmentShowSelect');
    if (!select) return;
    const state = getProgramAssignmentsState();
    const shows = Array.isArray(state.shows) ? state.shows : [];
    const selectedShowId = Number(state.showId || shows[0]?.id || 0);

    if (!shows.length) {
        select.innerHTML = '<option value="">No shows available for this station</option>';
        select.value = '';
        return;
    }

    select.innerHTML = shows.map(show => `
        <option value="${Number(show.id || 0)}" ${Number(show.id || 0) === selectedShowId ? 'selected' : ''}>
            ${escapeHtml(show.name || `Show ${show.id}`)}
        </option>
    `).join('');
    select.value = selectedShowId ? String(selectedShowId) : '';
}

function renderProgramAssignmentUserOptions() {
    const select = document.getElementById('programAssignmentUserSelect');
    if (!select) return;
    const state = getProgramAssignmentsState();
    const users = Array.isArray(state.users) ? state.users : [];
    const selectedUserId = Number(state.assignmentUserId || 0);

    if (!users.length) {
        select.innerHTML = '<option value="">No eligible users found</option>';
        select.value = '';
        return;
    }

    select.innerHTML = [
        '<option value="">Select a user</option>',
        ...users.map(user => {
            const label = `${user.display_name || user.username || 'Untitled'} (${String(user.role || 'dj').toUpperCase()})`;
            return `<option value="${Number(user.id || 0)}" ${Number(user.id || 0) === selectedUserId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
        }),
    ].join('');
    select.value = selectedUserId ? String(selectedUserId) : '';
}

function renderProgramAssignmentCapabilities(selectedPermissionKeys = [], readOnly = false) {
    const container = document.getElementById('programAssignmentCapabilityList');
    if (!container) return;

    const selected = new Set((Array.isArray(selectedPermissionKeys) ? selectedPermissionKeys : [])
        .map(permission => String(permission).trim())
        .filter(Boolean));

    container.innerHTML = SHOW_CAPABILITY_KEYS.map(permissionKey => `
        <label class="program-assignment-capability${readOnly ? ' is-readonly' : ''}">
            <input type="checkbox" data-permission-key="${permissionKey}"${selected.has(permissionKey) ? ' checked' : ''}${readOnly ? ' disabled' : ''}>
            <span>${escapeHtml(permissionKey)}</span>
        </label>
    `).join('');
}

function renderProgramAssignmentList() {
    const container = document.getElementById('programAssignmentList');
    if (!container) return;

    const state = getProgramAssignmentsState();
    const assignments = Array.isArray(state.assignments) ? state.assignments : [];
    if (!assignments.length) {
        container.innerHTML = '<div class="admin-access-empty">No assignments loaded yet.</div>';
        return;
    }

    container.innerHTML = assignments.map(assignment => {
        const isSelected = Number(state.assignmentUserId || 0) === Number(assignment.user_id || 0);
        const permissions = Array.isArray(assignment.permission_keys) ? assignment.permission_keys : [];
        return `
            <article class="program-assignment-item ${isSelected ? 'active' : ''}">
                <button class="program-assignment-item-main" type="button" onclick="selectProgramAssignment(${Number(assignment.user_id || 0)})">
                    <div class="program-assignment-item-head">
                        <strong>${escapeHtml(assignment.display_name || assignment.username || 'Untitled user')}</strong>
                        <span class="program-assignment-role">${escapeHtml(String(assignment.role || 'dj').toUpperCase())}</span>
                    </div>
                    <div class="program-assignment-item-meta">
                        <span>@${escapeHtml(assignment.username || 'unknown')}</span>
                        <span>${permissions.length ? escapeHtml(permissions.join(', ')) : 'No show capabilities'}</span>
                    </div>
                </button>
                <div class="program-assignment-item-actions">
                    <button class="btn-sm" type="button" onclick="selectProgramAssignment(${Number(assignment.user_id || 0)})">Edit</button>
                    <button class="btn-sm delete-btn" type="button" onclick="removeProgramAssignment(${Number(assignment.user_id || 0)})">Remove</button>
                </div>
            </article>
        `;
    }).join('');
}

function syncProgramAssignmentForm(assignment = null, selectedUserId = null) {
    const state = getProgramAssignmentsState();
    const selected = assignment ? normalizeProgramAssignmentItem(assignment) : null;
    const targetUserId = Number(selectedUserId || selected?.user_id || 0) || null;
    state.assignmentUserId = targetUserId;
    state.assignmentRole = selected?.role || 'dj';
    state.permissionKeys = Array.isArray(selected?.permission_keys) ? selected.permission_keys : [];

    const userSelect = document.getElementById('programAssignmentUserSelect');
    const roleSelect = document.getElementById('programAssignmentRoleSelect');
    const saveBtn = document.getElementById('programAssignmentSaveBtn');
    const removeBtn = document.getElementById('programAssignmentRemoveBtn');

    if (userSelect) {
        userSelect.value = state.assignmentUserId ? String(state.assignmentUserId) : '';
    }
    if (roleSelect) {
        roleSelect.value = state.assignmentRole;
    }
    if (saveBtn) {
        saveBtn.textContent = selected ? 'Update Assignment' : 'Save Assignment';
    }
    if (removeBtn) {
        removeBtn.disabled = !selected;
    }

    renderProgramAssignmentCapabilities(state.permissionKeys, false);
}

function selectProgramAssignment(userId) {
    const targetId = Number(userId || 0);
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    const assignment = getProgramAssignmentByUserId(targetId);
    if (assignment) {
        syncProgramAssignmentForm(assignment, targetId);
    } else {
        startProgramAssignmentForUser(targetId);
    }
    renderProgramAssignmentList();
}

function initProgramAssignmentsPanel() {
    const stationSelect = document.getElementById('programAssignmentStationSelect');
    if (stationSelect && !stationSelect.dataset.boundChange) {
        stationSelect.dataset.boundChange = '1';
        stationSelect.addEventListener('change', () => {
            const globalStationSelect = document.getElementById('stationSelector');
            if (globalStationSelect) {
                globalStationSelect.value = stationSelect.value;
            }
            changeStation().catch(() => {});
        });
    }

    const showSelect = document.getElementById('programAssignmentShowSelect');
    if (showSelect && !showSelect.dataset.boundChange) {
        showSelect.dataset.boundChange = '1';
        showSelect.addEventListener('change', () => {
            const state = getProgramAssignmentsState();
            state.showId = Number(showSelect.value || 0) || null;
            state.assignmentUserId = null;
            state.permissionKeys = [];
            loadProgramAssignmentAssignments(true).catch(() => {});
        });
    }

    const userSelect = document.getElementById('programAssignmentUserSelect');
    if (userSelect && !userSelect.dataset.boundChange) {
        userSelect.dataset.boundChange = '1';
        userSelect.addEventListener('change', () => {
            const selectedUserId = Number(userSelect.value || 0);
            if (!Number.isInteger(selectedUserId) || selectedUserId <= 0) {
                syncProgramAssignmentForm(null, null);
                renderProgramAssignmentList();
                return;
            }
            selectProgramAssignment(selectedUserId);
        });
    }

    renderProgramAssignmentStationOptions();
}

async function loadProgramAssignmentUsers(forceRefresh = false) {
    const state = getProgramAssignmentsState();
    if (!forceRefresh && Array.isArray(state.users) && state.users.length) {
        renderProgramAssignmentUserOptions();
        return state.users;
    }

    const showId = Number(state.showId || document.getElementById('programAssignmentShowSelect')?.value || 0);
    state.showId = Number.isInteger(showId) && showId > 0 ? showId : null;
    if (!state.showId) {
        state.users = [];
        renderProgramAssignmentUserOptions();
        return [];
    }

    try {
        const payload = await apiFetch(`${API_BASE}/api/shows/${state.showId}/assignment-candidates`);
        const users = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
        state.users = users
            .map(normalizeUserItem)
            .filter(user => user.is_active !== false);
        renderProgramAssignmentUserOptions();
        return state.users;
    } catch (err) {
        state.users = [];
        renderProgramAssignmentUserOptions();
        return null;
    }
}

async function loadProgramAssignmentAssignments(forceRefresh = false) {
    const state = getProgramAssignmentsState();
    const showId = Number(state.showId || document.getElementById('programAssignmentShowSelect')?.value || 0);
    state.showId = Number.isInteger(showId) && showId > 0 ? showId : null;
    if (!state.showId) {
        state.assignments = [];
        renderProgramAssignmentList();
        syncProgramAssignmentForm(null);
        return [];
    }

    if (!forceRefresh && Array.isArray(state.assignments) && state.assignments.length) {
        renderProgramAssignmentList();
        return state.assignments;
    }

    const container = document.getElementById('programAssignmentList');
    if (container) {
        container.innerHTML = '<div class="admin-access-empty">Loading assignments...</div>';
    }

    try {
        const payload = await apiFetch(`${API_BASE}/api/shows/${state.showId}/assignments`);
        state.assignments = Array.isArray(payload) ? payload.map(normalizeProgramAssignmentItem) : [];
        const resolved = resolveProgramAssignmentEditorSelection(state.assignments, state.assignmentUserId);
        syncProgramAssignmentForm(resolved.assignment, resolved.selectedUserId);
        renderProgramAssignmentList();
        return state.assignments;
    } catch (err) {
        state.assignments = [];
        if (container) {
            container.innerHTML = '<div class="admin-access-empty">Assignments could not be loaded.</div>';
        }
        syncProgramAssignmentForm(null);
        return null;
    }
}

async function loadProgramAssignmentsPanel(forceRefresh = false) {
    const state = getProgramAssignmentsState();
    const stationSelect = document.getElementById('programAssignmentStationSelect');
    const stationId = Number(stationSelect?.value || state.stationId || currentState.currentStationId || 1);
    state.stationId = Number.isInteger(stationId) && stationId > 0 ? stationId : Number(currentState.currentStationId || 1);

    renderProgramAssignmentStationOptions();

    try {
        const showsPayload = await apiFetch(`${API_BASE}/api/shows/?station_id=${state.stationId}`);
        const shows = Array.isArray(showsPayload) ? showsPayload : Array.isArray(showsPayload?.items) ? showsPayload.items : [];
        state.shows = shows.map(normalizeProgramAssignmentShow);
        if (!state.showId || !state.shows.some(show => Number(show.id) === Number(state.showId))) {
            state.showId = state.shows[0]?.id || null;
        }
        renderProgramAssignmentShowOptions();
        await loadProgramAssignmentUsers(forceRefresh);
        await loadProgramAssignmentAssignments(true);
        const resolved = resolveProgramAssignmentEditorSelection(state.assignments, state.assignmentUserId);
        syncProgramAssignmentForm(resolved.assignment, resolved.selectedUserId);
        renderProgramAssignmentList();
        return state;
    } catch (err) {
        const container = document.getElementById('programAssignmentList');
        if (container) {
            container.innerHTML = '<div class="admin-access-empty">Program assignments could not be loaded.</div>';
        }
        resetProgramAssignmentsPanelState(state.stationId);
        console.warn('program assignments load failed', err);
        return null;
    }
}

async function saveProgramAssignment() {
    const state = getProgramAssignmentsState();
    const showId = Number(document.getElementById('programAssignmentShowSelect')?.value || state.showId || 0);
    const userId = Number(document.getElementById('programAssignmentUserSelect')?.value || state.assignmentUserId || 0);
    const role = String(document.getElementById('programAssignmentRoleSelect')?.value || state.assignmentRole || 'dj').trim() || 'dj';
    const permissionKeys = collectSelectedProgramAssignmentPermissionKeys();
    const knownShow = (Array.isArray(state.shows) ? state.shows : [])
        .some(show => Number(show.id || 0) === showId);
    const knownUser = (Array.isArray(state.users) ? state.users : [])
        .some(user => Number(user.id || 0) === userId)
        || (Array.isArray(state.assignments) ? state.assignments : [])
            .some(assignment => Number(assignment.user_id || 0) === userId);

    if (!Number.isInteger(showId) || showId <= 0 || !knownShow) {
        showToast('Select a show first', 'error');
        return null;
    }
    if (!Number.isInteger(userId) || userId <= 0 || !knownUser) {
        showToast('Select a user first', 'error');
        return null;
    }

    try {
        await apiFetch(`${API_BASE}/api/shows/${showId}/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: userId,
                role,
                permission_keys: permissionKeys,
            }),
        });
        state.showId = showId;
        state.assignmentUserId = userId;
        state.assignmentRole = role;
        state.permissionKeys = permissionKeys;
        await loadProgramAssignmentAssignments(true);
        return true;
    } catch (err) {
        console.warn('program assignment save failed', err);
        return null;
    }
}

async function removeProgramAssignment(userId = null) {
    const state = getProgramAssignmentsState();
    const showId = Number(document.getElementById('programAssignmentShowSelect')?.value || state.showId || 0);
    const targetUserId = Number(userId || document.getElementById('programAssignmentUserSelect')?.value || state.assignmentUserId || 0);

    if (!Number.isInteger(showId) || showId <= 0 || !Number.isInteger(targetUserId) || targetUserId <= 0) {
        return null;
    }

    try {
        await apiFetch(`${API_BASE}/api/shows/${showId}/assign/${targetUserId}`, { method: 'DELETE' });
        state.assignmentUserId = null;
        state.permissionKeys = [];
        await loadProgramAssignmentAssignments(true);
        return true;
    } catch (err) {
        console.warn('program assignment remove failed', err);
        return null;
    }
}

function startProgramAssignmentForUser(userId) {
    const targetId = Number(userId || 0);
    if (!Number.isInteger(targetId) || targetId <= 0) {
        return null;
    }
    syncProgramAssignmentForm(null, targetId);
    renderProgramAssignmentList();
    return targetId;
}

function syncProgramAssignmentStationState(stationId = currentState.currentStationId) {
    const state = getProgramAssignmentsState();
    const targetStationId = Number(stationId || 0);
    if (!Number.isInteger(targetStationId) || targetStationId <= 0) {
        return null;
    }
    state.stationId = targetStationId;
    state.showId = null;
    state.assignmentUserId = null;
    state.assignmentRole = 'dj';
    state.permissionKeys = [];
    state.assignments = [];
    return targetStationId;
}

function renderRoleTemplatesList() {
    const container = document.getElementById('roleTemplateList');
    if (!container) return;

    const roles = Array.isArray(currentState.roleTemplates) ? currentState.roleTemplates : [];
    if (!roles.length) {
        container.innerHTML = `
            <div class="role-template-empty">
                No role templates loaded yet.
                <button class="btn-sm" type="button" onclick="loadRoleTemplates(true)">Load roles</button>
            </div>
        `;
        return;
    }

    container.innerHTML = roles.map(role => {
        const isSelected = Number(currentState.roleTemplateEditorId || 0) === Number(role.id || 0);
        const permissionCount = Array.isArray(role.permission_keys) ? role.permission_keys.length : 0;
        return `
            <article class="role-template-item ${isSelected ? 'active' : ''}" data-role-template-id="${Number(role.id || 0)}">
                <div class="role-template-item-main">
                    <div class="role-template-item-head">
                        <strong>${escapeHtml(role.name || 'Untitled role')}</strong>
                        <div class="role-template-badges">
                            ${role.is_system ? '<span class="role-template-badge">System</span>' : ''}
                            <span class="role-template-badge ${role.is_active ? 'is-active' : 'is-inactive'}">${role.is_active ? 'Active' : 'Inactive'}</span>
                        </div>
                    </div>
                    <div class="role-template-item-meta">
                        <span>${escapeHtml(role.description || 'No description')}</span>
                        <span>${permissionCount} permissions</span>
                    </div>
                </div>
                <div class="role-template-item-actions">
                    ${role.is_system ? '' : `<button class="btn-sm" type="button" onclick="openRoleTemplateEditModal(${Number(role.id || 0)})">Edit</button>`}
                    <button class="btn-sm delete-btn" type="button" onclick="deleteRoleTemplate(${Number(role.id || 0)})" ${role.is_system ? 'disabled' : ''}>Deactivate</button>
                </div>
            </article>
        `;
    }).join('');
}

function syncRoleTemplateForm(role = null) {
    const form = document.getElementById('roleTemplateForm');
    const idInput = document.getElementById('roleTemplateId');
    const nameInput = document.getElementById('roleTemplateName');
    const descriptionInput = document.getElementById('roleTemplateDescription');
    const titleEl = document.getElementById('roleTemplateModalTitle');
    const saveBtn = document.getElementById('roleTemplateSaveBtn');
    const deleteBtn = document.getElementById('roleTemplateDeleteBtn');
    const selectedRole = role ? normalizeRoleTemplateItem(role) : null;
    const readOnly = !!selectedRole?.is_system;

    currentState.roleTemplateEditorId = selectedRole?.id || null;
    currentState.roleTemplateModalMode = readOnly ? 'view' : (selectedRole ? 'edit' : 'create');

    if (idInput) idInput.value = selectedRole?.id ? String(selectedRole.id) : '';
    if (nameInput) {
        nameInput.value = selectedRole?.name || '';
        nameInput.disabled = readOnly;
    }
    if (descriptionInput) {
        descriptionInput.value = selectedRole?.description || '';
        descriptionInput.disabled = readOnly;
    }
    if (titleEl) titleEl.textContent = selectedRole ? (readOnly ? `View Role #${selectedRole.id}` : `Edit Role #${selectedRole.id}`) : 'Create Role';
    if (saveBtn) {
        saveBtn.textContent = selectedRole ? (readOnly ? 'Read Only' : 'Save Changes') : 'Create Role';
        saveBtn.disabled = readOnly;
    }
    if (deleteBtn) deleteBtn.hidden = !selectedRole || selectedRole.is_system;

    renderRolePermissionGroups(selectedRole?.permission_keys || [], readOnly);
    renderRoleTemplatesList();

    if (form) {
        form.dataset.mode = readOnly ? 'view' : (selectedRole ? 'edit' : 'create');
    }
}

async function loadRoleTemplates(forceRefresh = false) {
    const list = document.getElementById('roleTemplateList');
    if (list && (forceRefresh || !Array.isArray(currentState.roleTemplates) || !currentState.roleTemplates.length)) {
        list.innerHTML = '<div class="role-template-empty">Loading role templates...</div>';
    }

    try {
        const payload = await apiFetch(`${API_BASE}/api/roles`);
        currentState.rolePermissionGroups = normalizeRolePermissionGroups(payload?.permission_groups);
        currentState.roleTemplates = Array.isArray(payload?.items) ? payload.items.map(normalizeRoleTemplateItem) : [];
        if (!currentState.roleTemplateEditorId && currentState.roleTemplates.length) {
            currentState.roleTemplateEditorId = currentState.roleTemplates[0].id;
        }
        renderRoleTemplatesList();
        const selectedRole = currentState.roleTemplates.find(role => Number(role.id) === Number(currentState.roleTemplateEditorId || 0)) || null;
        syncRoleTemplateForm(selectedRole);
        return currentState.roleTemplates;
    } catch (err) {
        if (list) {
            list.innerHTML = '<div class="role-template-empty">Role templates could not be loaded.</div>';
        }
        return null;
    }
}

function openRoleTemplateCreateModal() {
    syncRoleTemplateForm(null);
    const modal = document.getElementById('roleTemplateModal');
    if (modal) modal.style.display = 'flex';
}

function openRoleTemplateEditModal(roleId) {
    const targetId = Number(roleId || 0);
    const role = (Array.isArray(currentState.roleTemplates) ? currentState.roleTemplates : [])
        .find(item => Number(item.id) === targetId);
    if (!role) {
        showToast('Role template not found', 'error');
        return;
    }
    syncRoleTemplateForm(role);
    const modal = document.getElementById('roleTemplateModal');
    if (modal) modal.style.display = 'flex';
}

function closeRoleTemplateModal() {
    const modal = document.getElementById('roleTemplateModal');
    if (modal) modal.style.display = 'none';
    currentState.roleTemplateEditorId = null;
    currentState.roleTemplateModalMode = 'create';
}

function collectSelectedRolePermissions() {
    const container = document.getElementById('rolePermissionGroups');
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"][data-permission-key]:checked'))
        .map(input => String(input.dataset.permissionKey || '').trim())
        .filter(Boolean);
}

async function saveRoleTemplate() {
    const idInput = document.getElementById('roleTemplateId');
    const nameInput = document.getElementById('roleTemplateName');
    const descriptionInput = document.getElementById('roleTemplateDescription');
    const roleId = Number(idInput?.value || 0);
    const selectedRole = roleId > 0
        ? (Array.isArray(currentState.roleTemplates) ? currentState.roleTemplates : []).find(role => Number(role.id) === roleId) || null
        : null;
    if (selectedRole?.is_system) {
        showToast('System role templates are read only', 'warning');
        return null;
    }
    const name = String(nameInput?.value || '').trim();
    const description = String(descriptionInput?.value || '').trim();
    const permission_keys = collectSelectedRolePermissions();

    try {
        if (!name) {
            showToast('Role name is required', 'error');
            return null;
        }

        const payload = { name, description, permission_keys };
        const url = roleId > 0 ? `${API_BASE}/api/roles/${roleId}` : `${API_BASE}/api/roles`;
        const method = roleId > 0 ? 'PUT' : 'POST';

        const result = await apiFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        showToast(roleId > 0 ? 'Role template updated' : 'Role template created');
        await loadRoleTemplates(true);
        if (result?.id) {
            openRoleTemplateEditModal(result.id);
        } else {
            closeRoleTemplateModal();
        }
        return result;
    } catch (_) {
        return null;
    }
}

async function deleteRoleTemplate(roleId) {
    const targetId = Number(roleId || 0);
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    const targetRole = (Array.isArray(currentState.roleTemplates) ? currentState.roleTemplates : []).find(role => Number(role.id) === targetId) || null;
    if (targetRole?.is_system) {
        showToast('System role templates cannot be deactivated', 'warning');
        return null;
    }
    if (!confirm('Deactivate this role template?')) return;

    try {
        await apiFetch(`${API_BASE}/api/roles/${targetId}`, { method: 'DELETE' });
        showToast('Role template deactivated');
        if (Number(currentState.roleTemplateEditorId || 0) === targetId) {
            closeRoleTemplateModal();
        }
        await loadRoleTemplates(true);
        return true;
    } catch (_) {
        return null;
    }
}

function initRoleTemplateModalUi() {
    const modal = document.getElementById('roleTemplateModal');
    const form = document.getElementById('roleTemplateForm');
    if (modal && modal.dataset.bound === '1') return;
    if (modal) {
        modal.dataset.bound = '1';
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeRoleTemplateModal();
            }
        });
    }
    if (form && form.dataset.boundSubmit !== '1') {
        form.dataset.boundSubmit = '1';
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            saveRoleTemplate();
        });
    }
}

async function refreshStudioWorkspace(forceRefresh = false) {
    if (!globalThis.StudioManager || typeof globalThis.StudioManager.refresh !== 'function') {
        return null;
    }
    return globalThis.StudioManager.refresh({
        stationId: Number(currentState.currentStationId || 1),
        force: !!forceRefresh,
    });
}

// ====================== SHOW MANAGEMENT ======================

let _showsCache = [];
let _showDetailId = null;

async function loadShows(stationId) {
    try {
        const shows = await apiFetch(`${API_BASE}/api/shows/?station_id=${Number(stationId || currentState.currentStationId || 1)}`);
        _showsCache = Array.isArray(shows) ? shows : [];
        renderShowsList();
        renderProgramShowSelector();
    } catch (e) { console.warn('loadShows failed', e); }
}

function renderShowsList() {
    const el = document.getElementById('showsList');
    if (!el) return;
    if (!_showsCache.length) {
        el.innerHTML = '<p class="empty-hint">No shows defined yet.</p>';
        return;
    }
    el.innerHTML = _showsCache.map(s => `
        <div class="show-card" data-show-id="${s.id}">
            <span class="show-color-dot" style="background:${s.color || '#4a90d9'}"></span>
            <span class="show-card-name">${s.name}</span>
            <span class="show-card-desc">${s.description || ''}</span>
            <div class="show-card-actions">
                <button class="btn-sm" type="button" onclick="openShowDetail(${s.id})" title="Assignments & Audio">
                    <span class="material-icons-round">settings</span>
                </button>
                <button class="btn-sm" type="button" onclick="openShowEditModal(${s.id})" title="Edit">
                    <span class="material-icons-round">edit</span>
                </button>
                <button class="btn-sm btn-danger" type="button" onclick="deleteShow(${s.id})" title="Delete">
                    <span class="material-icons-round">delete</span>
                </button>
            </div>
        </div>
    `).join('');
}

function renderProgramShowSelector() {
    const sel = document.getElementById('programShowSelect');
    const wrap = document.getElementById('programShowSelector');
    if (!sel || !wrap) return;
    if (!_showsCache.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    const current = currentState.selectedShowId || '';
    sel.innerHTML = '<option value="">— select show —</option>' +
        _showsCache.map(s =>
            `<option value="${s.id}" ${s.id == current ? 'selected' : ''}>${s.name}</option>`
        ).join('');
}

function handleProgramShowSelect(val) {
    currentState.selectedShowId = val ? Number(val) : null;
    if (!currentState.selectedShowId && Number(currentState.activeShowSession?.show_id || 0) <= 0) {
        currentState.programWorkspaceClaimedShowId = null;
    }
    renderBroadcastControls();
    refreshSoundboardSurfaces();
    if (currentState.onAirMode === 'program' && currentState.selectedShowId) {
        claimProgramWorkspace({ silent: false }).then((claimed) => {
            if (!claimed) return;
            loadCurrentSession();
            loadProgramQueueState(true);
        });
    }
}

function openShowCreateModal() {
    document.getElementById('showFormId').value = '';
    document.getElementById('showFormName').value = '';
    document.getElementById('showFormDesc').value = '';
    document.getElementById('showFormColor').value = '#4a90d9';
    document.getElementById('showModalTitle').textContent = 'New Show';
    document.getElementById('showModal').showModal();
}

function openShowEditModal(showId) {
    const show = _showsCache.find(s => s.id === showId);
    if (!show) return;
    document.getElementById('showFormId').value = show.id;
    document.getElementById('showFormName').value = show.name;
    document.getElementById('showFormDesc').value = show.description || '';
    document.getElementById('showFormColor').value = show.color || '#4a90d9';
    document.getElementById('showModalTitle').textContent = 'Edit Show';
    document.getElementById('showModal').showModal();
}

async function handleShowFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('showFormId').value;
    const payload = {
        name: document.getElementById('showFormName').value,
        description: document.getElementById('showFormDesc').value,
        color: document.getElementById('showFormColor').value,
        station_id: Number(currentState.currentStationId || 1),
    };
    try {
        if (id) {
            await apiFetch(`${API_BASE}/api/shows/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } else {
            await apiFetch(`${API_BASE}/api/shows/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        }
        document.getElementById('showModal').close();
        loadShows();
    } catch (err) { console.warn('show save failed', err); }
    return false;
}

async function deleteShow(showId) {
    if (!confirm('Delete this show?')) return;
    try {
        await apiFetch(`${API_BASE}/api/shows/${showId}`, { method: 'DELETE' });
        loadShows();
    } catch (err) { console.warn('delete show failed', err); }
}

async function openShowDetail(showId) {
    _showDetailId = showId;
    const show = _showsCache.find(s => s.id === showId);
    document.getElementById('showDetailTitle').textContent = show ? show.name : 'Show Details';
    await loadShowAssignments(showId);
    await loadAssignableUsers();
    document.getElementById('showDetailModal').showModal();
}

async function loadShowAssignments(showId) {
    const el = document.getElementById('showAssignmentsList');
    if (!el) return;
    try {
        const resp = await apiFetch(`${API_BASE}/api/shows/${showId}/assignments`);
        const assignments = Array.isArray(resp) ? resp : [];
        if (!assignments.length) {
            el.innerHTML = '<p class="empty-hint">No users assigned yet.</p>';
            return;
        }
        el.innerHTML = assignments.map(a => `
            <div class="show-assignment-row">
                <span>${a.username} (${a.role})</span>
                <button class="btn-sm btn-danger" type="button"
                    onclick="handleUnassignUser(${a.user_id})">Remove</button>
            </div>
        `).join('');
    } catch (_) {
        el.innerHTML = '<p class="empty-hint">Could not load assignments.</p>';
    }
}

async function handleUnassignUser(userId) {
    if (!_showDetailId) return;
    try {
        await apiFetch(`${API_BASE}/api/shows/${_showDetailId}/assign/${userId}`, { method: 'DELETE' });
        await loadShowAssignments(_showDetailId);
    } catch (err) { console.warn('unassign failed', err); }
}

async function loadAssignableUsers() {
    try {
        const data = await apiFetch(`${API_BASE}/api/users`);
        const users = Array.isArray(data?.items) ? data.items : [];
        const sel = document.getElementById('showAssignUserId');
        if (!sel) return;
        sel.innerHTML = users
            .filter(u => u.role === 'dj' || u.role === 'producer')
            .map(u => `<option value="${u.id}">${u.username} (${u.role})</option>`)
            .join('');
    } catch (_) {}
}

async function handleAssignUser() {
    if (!_showDetailId) return;
    const userId = Number(document.getElementById('showAssignUserId').value);
    const role = document.getElementById('showAssignRole').value;
    try {
        await apiFetch(`${API_BASE}/api/shows/${_showDetailId}/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, role }),
        });
        await loadShowAssignments(_showDetailId);
    } catch (err) { console.warn('assign failed', err); }
}

async function handleShowAudioUpload(input, type) {
    if (!_showDetailId || !input.files[0]) return;
    const form = new FormData();
    form.append('file', input.files[0]);
    form.append('type', type);
    try {
        await apiFetch(`${API_BASE}/api/shows/${_showDetailId}/upload-audio`, {
            method: 'POST',
            body: form,
        });
        loadShows();
    } catch (err) { console.warn('audio upload failed', err); }
}

function initShowsPanel() {
    loadShows();
    loadCurrentSession();
}

// ── Show Broadcast Controls ────────────────────────────────

async function loadCurrentSession() {
    try {
        const stationId = Number(currentState.currentStationId || 1);
        const showId = getCurrentProgramActionShowId();
        if (showId <= 0) {
            currentState.activeShowSession = null;
            renderBroadcastControls();
            return;
        }
        const params = new URLSearchParams({ station_id: String(stationId) });
        if (showId > 0) {
            params.set('show_id', String(showId));
        }
        const data = await apiFetch(`${API_BASE}/api/shows/session/current?${params.toString()}`);
        currentState.activeShowSession = data?.session || null;
        if (Number(currentState.activeShowSession?.show_id || 0) > 0) {
            currentState.programWorkspaceClaimedShowId = Number(currentState.activeShowSession.show_id);
        }
        renderBroadcastControls();
        refreshSoundboardSurfaces();
    } catch (e) {
        console.error('Failed to load current session:', e);
    }
}

function renderBroadcastControls() {
    const container = document.getElementById('showBroadcastControls');
    const statusEl = document.getElementById('showBroadcastStatus');
    const btnGoLive = document.getElementById('btnGoLive');
    const btnGoBreak = document.getElementById('btnGoBreak');
    const btnEndShow = document.getElementById('btnEndShow');
    if (!container || !statusEl || !btnGoLive || !btnGoBreak || !btnEndShow) return;

    const session = currentState.activeShowSession;
    const showSelected = currentState.selectedShowId;
    const controlState = getProgramControlState({
        selectedShowId: showSelected,
        activeShowSession: session,
    });
    const setButtonVisible = (button, visible) => {
        button.style.display = visible ? 'inline-flex' : 'none';
        button.disabled = !visible;
    };

    if (!showSelected && !session) {
        container.style.display = 'none';
        refreshSoundboardSurfaces();
        return;
    }
    container.style.display = 'block';

    // Reset all buttons
    setButtonVisible(btnGoLive, false);
    setButtonVisible(btnGoBreak, false);
    setButtonVisible(btnEndShow, false);

    if (!session) {
        statusEl.textContent = 'Ready to broadcast';
        statusEl.style.background = '#e8f5e9';
        statusEl.style.color = '#2e7d32';
        setButtonVisible(btnGoLive, controlState.canGoLive);
        refreshSoundboardSurfaces();
        return;
    }

    const status = session.status;
    const statusLabels = {
        preparing: 'Preparing...',
        going_live: 'Going Live — waiting for current track...',
        intro_playing: 'Intro Playing...',
        live: 'ON AIR',
        break_outro: 'Going to Break...',
        on_break: 'On Break — Ads Playing',
        break_intro: 'Returning from Break...',
        outro_playing: 'Outro Playing — Ending Show...',
    };
    const statusColors = {
        preparing: { bg: '#e8f5e9', fg: '#2e7d32' },
        going_live: { bg: '#fff3e0', fg: '#e65100' },
        intro_playing: { bg: '#fff3e0', fg: '#e65100' },
        live: { bg: '#c62828', fg: '#ffffff' },
        break_outro: { bg: '#fff3e0', fg: '#e65100' },
        on_break: { bg: '#e3f2fd', fg: '#1565c0' },
        break_intro: { bg: '#fff3e0', fg: '#e65100' },
        outro_playing: { bg: '#fce4ec', fg: '#c62828' },
    };

    statusEl.textContent = statusLabels[status] || status;
    const colors = statusColors[status] || { bg: '#f5f5f5', fg: '#333' };
    statusEl.style.background = colors.bg;
    statusEl.style.color = colors.fg;

    if (status === 'preparing') {
        setButtonVisible(btnGoLive, controlState.canGoLive);
    } else if (status === 'live') {
        setButtonVisible(btnGoBreak, controlState.canGoBreak);
        setButtonVisible(btnEndShow, controlState.canEndShow);
    } else if (['on_break', 'break_outro', 'break_intro'].includes(status)) {
        setButtonVisible(btnEndShow, controlState.canEndShow);
    }
    refreshSoundboardSurfaces();
}

async function handleGoLive() {
    const showId = currentState.selectedShowId;
    if (!showId) return;
    try {
        const data = await apiFetch(`${API_BASE}/api/shows/${showId}/go-live`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ station_id: currentState.currentStationId || 1 }),
        });
        currentState.activeShowSession = data?.session || null;
        renderBroadcastControls();
    } catch (e) {
        console.error('Go live failed:', e);
        alert(e?.message || 'Failed to go live');
    }
}

async function handleGoBreak() {
    const session = currentState.activeShowSession;
    if (!session) return;
    try {
        const data = await apiFetch(`${API_BASE}/api/shows/${session.show_id}/go-break`, {
            method: 'POST',
        });
        currentState.activeShowSession = data?.session || null;
        renderBroadcastControls();
    } catch (e) {
        console.error('Go to break failed:', e);
        alert(e?.message || 'Failed to go to break');
    }
}

async function handleEndShow() {
    const session = currentState.activeShowSession;
    if (!session) return;
    if (!confirm('End the current show?')) return;
    try {
        const data = await apiFetch(`${API_BASE}/api/shows/${session.show_id}/end`, {
            method: 'POST',
        });
        currentState.activeShowSession = data?.session || null;
        renderBroadcastControls();
    } catch (e) {
        console.error('End show failed:', e);
        alert(e?.message || 'Failed to end show');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    applyDisplayBrandName(currentState.sharedSettings?.display_brand_name);
    if (String(window.location?.pathname || '') === '/') {
        return;
    }
    if (Auth.isLoginPage()) {
        initLoginPage();
        await loadDisplayBrandName();
        await Auth.bootstrapLoginPage();
        return;
    }

    const authReady = await Auth.bootstrap();
    if (!authReady) {
        return;
    }

    await loadDisplayBrandName();

    if (typeof globalThis !== 'undefined' && globalThis.IdleSessionManager?.init) {
        globalThis.IdleSessionManager.init();
    }

    initAuthUi();
    updateAuthUi();
    initClock();
    initNavigation();
    await loadStations(getPreferredStationIdFromUrl());
    initSubpages({ eager: !isLazyPanelModeEnabled() });
    initStationSwitcher();
    initPolling();
    initGlobalErrorHandlers();
    syncPanelVisibilityUi();
    await refreshHealth();

    if (!isLazyPanelModeEnabled()) {
        await initializePanelsEagerly();
        WS.connect();
        await refreshAll({ force: true, eager: true });
        if (typeof document.dispatchEvent === 'function') {
            document.dispatchEvent(typeof CustomEvent === 'function'
                ? new CustomEvent('radiotedu:app-ready')
                : { type: 'radiotedu:app-ready' });
        }
        return;
    }

    await PanelRegistry.initOnce(currentState.panel);
    WS.connect();
    await refreshVisiblePanel({ force: true, stationId: currentState.currentStationId });
    if (typeof document.dispatchEvent === 'function') {
        document.dispatchEvent(typeof CustomEvent === 'function'
            ? new CustomEvent('radiotedu:app-ready')
            : { type: 'radiotedu:app-ready' });
    }
});

function initClock() {
    const clockEl = document.getElementById('clock');
    if (!clockEl) return;
    setInterval(() => {
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString('en-US', { hour12: false });
    }, 1000);
}

function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const panelId = btn.dataset.panel;
            const switched = switchPanel(panelId);
            if (!switched) return;

            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

function normalizeOnAirMode(mode) {
    const raw = String(mode || '').trim().toLowerCase();
    return raw === 'program' ? 'program' : 'automation';
}

function normalizeProgramMusicMode(mode) {
    const raw = String(mode || '').trim().toLowerCase();
    if (raw === 'duck' || raw === 'low' || raw === 'talk') return 'duck';
    if (raw === 'mute' || raw === 'off' || raw === 'silent' || raw === 'nomusic') return 'mute';
    return 'normal';
}

function normalizeProgramQueueSource(source) {
    const raw = String(source || '').trim().toLowerCase();
    return raw === 'host' ? 'host' : 'automation';
}

function normalizeProgramQueueMinTracks(value) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return 3;
}

function initOnAirModeUi() {
    const tabWrap = document.getElementById('onairModeTabs');
    if (tabWrap && tabWrap.dataset.boundClick !== '1') {
        tabWrap.dataset.boundClick = '1';
        tabWrap.addEventListener('click', (event) => {
            const btn = event.target.closest('.onair-mode-tab[data-onair-mode]');
            if (!btn) return;
            switchOnAirMode(btn.dataset.onairMode || 'automation');
        });
    }
    currentState.onAirMode = normalizeOnAirMode(currentState.onAirMode);
    currentState.programMusicMode = normalizeProgramMusicMode(currentState.programMusicMode);
    syncOnAirModeUi();
    syncProgramMusicModeUi();
    initLiveAudioSliders();
}

function initLiveAudioSliders() {
    const sliders = [
        { id: 'micGainSlider', valueId: 'micGainValue', key: 'mic_gain', pct: true },
        { id: 'musicGainSlider', valueId: 'musicGainValue', key: 'music_gain', pct: true },
        { id: 'duckLevelSlider', valueId: 'duckLevelValue', key: 'duck_level', pct: true },
    ];
    let sendTimer = null;
    function sendLiveAudioSettings() {
        clearTimeout(sendTimer);
        sendTimer = setTimeout(async () => {
            const stationId = Number(currentState.currentStationId || 1);
            const micGain = parseFloat(document.getElementById('micGainSlider')?.value ?? 1);
            const musicGain = parseFloat(document.getElementById('musicGainSlider')?.value ?? 1);
            const duckLevel = parseFloat(document.getElementById('duckLevelSlider')?.value ?? 0.15);
            const mode = normalizeProgramMusicMode(currentState.programMusicMode);
            try {
                const resp = await fetch(`${API_BASE}/api/audio/live/settings`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', ...Auth.withAuthHeaders() },
                    body: JSON.stringify({
                        station_id: stationId,
                        program_music_mode: mode,
                        mic_gain: micGain,
                        music_gain: musicGain,
                        duck_level: duckLevel,
                    }),
                });
                if (!resp.ok) console.warn('[live-audio] PUT failed:', resp.status, await resp.text().catch(() => ''));
            } catch (err) { console.warn('[live-audio] PUT error:', err); }
        }, 150);
    }
    globalThis._sendLiveAudioSettings = sendLiveAudioSettings;
    for (const s of sliders) {
        const slider = document.getElementById(s.id);
        const label = document.getElementById(s.valueId);
        if (!slider) continue;
        slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            if (label) label.textContent = s.pct ? `${Math.round(v * 100)}%` : v.toFixed(2);
            sendLiveAudioSettings();
        });
    }
    // Load saved values from backend and sync mode
    (async () => {
        try {
            const stationId = Number(currentState.currentStationId || 1);
            const resp = await fetch(`${API_BASE}/api/audio/live/status?station_id=${stationId}`, {
                headers: Auth.withAuthHeaders(),
            });
            if (!resp.ok) return;
            const data = await resp.json();
            for (const s of sliders) {
                const val = data?.[s.key];
                if (val == null) continue;
                const slider = document.getElementById(s.id);
                const label = document.getElementById(s.valueId);
                if (slider) slider.value = val;
                if (label) label.textContent = s.pct ? `${Math.round(val * 100)}%` : parseFloat(val).toFixed(2);
            }
            // Sync mode from backend so slider updates don't overwrite it
            const serverMode = normalizeProgramMusicMode(data?.program_music_mode);
            currentState.programMusicMode = serverMode;
            syncProgramMusicModeUi();
        } catch (err) { console.warn('[live-audio] GET status error:', err); }
    })();
}

function switchOnAirMode(mode) {
    const previousMode = normalizeOnAirMode(currentState.onAirMode);
    currentState.onAirMode = normalizeOnAirMode(mode);
    syncOnAirModeUi();
    if (currentState.onAirMode === 'program') {
        enterProgramModeWorkspace(previousMode !== 'program');
    }
}

function syncOnAirModeUi() {
    const panel = document.getElementById('panel-onair');
    let safeMode = normalizeOnAirMode(currentState.onAirMode);
    if (safeMode === 'program' && !canOpenProgramPanel()) {
        currentState.onAirMode = 'automation';
        safeMode = 'automation';
    }
    const isProgramMode = safeMode === 'program';
    if (panel?.classList && typeof panel.classList.toggle === 'function') {
        panel.classList.toggle('program-mode', isProgramMode);
    }

    document.querySelectorAll('.onair-mode-tab[data-onair-mode]').forEach(btn => {
        const mode = normalizeOnAirMode(btn.dataset.onairMode || 'automation');
        const allowed = mode !== 'program' || canOpenProgramPanel();
        btn.hidden = !allowed;
        btn.disabled = !allowed;
        btn.setAttribute?.('aria-hidden', String(!allowed));
        btn.setAttribute?.('aria-disabled', String(!allowed));
        btn.classList.toggle('active', allowed && mode === safeMode);
    });
}

function syncProgramMusicModeUi() {
    const mode = normalizeProgramMusicMode(currentState.programMusicMode);
    currentState.programMusicMode = mode;
    currentState.isDucking = mode === 'duck';

    const labelEl = document.getElementById('programMusicModeLabel');
    if (labelEl) {
        if (mode === 'duck') labelEl.textContent = 'Music: Low Background';
        else if (mode === 'mute') labelEl.textContent = 'Music: Muted';
        else labelEl.textContent = 'Music: Normal';
    }

    document.querySelectorAll('.btn-program-mode[data-program-music-mode]').forEach(btn => {
        const targetMode = normalizeProgramMusicMode(btn.dataset.programMusicMode || 'normal');
        btn.classList.toggle('active', targetMode === mode);
    });

    const talkBtn = document.getElementById('btnTalkover');
    if (talkBtn) {
        talkBtn.classList.toggle('active', mode !== 'normal');
    }

    const talkLabel = document.getElementById('btnTalkoverLabel');
    if (talkLabel) {
        if (mode === 'duck') talkLabel.textContent = 'TALK MODE: LOW MUSIC';
        else if (mode === 'mute') talkLabel.textContent = 'LIVE: NO MUSIC';
        else talkLabel.textContent = 'TALK MODE';
    }
}

async function setProgramMusicMode(mode, options = {}) {
    const targetMode = normalizeProgramMusicMode(mode);
    const silentToast = !!options.silentToast;
    const stationId = Number(currentState.currentStationId || 1);

    try {
        const data = await requestProgramMusicMode(targetMode, stationId);
        const effectiveMode = normalizeProgramMusicMode(
            data?.effective_mode || data?.mode || targetMode
        );
        currentState.programMusicMode = effectiveMode;
        syncProgramMusicModeUi();
        // Push mode + current slider values to the unified settings endpoint
        if (globalThis._sendLiveAudioSettings) globalThis._sendLiveAudioSettings();

        const warnings = Array.isArray(data?.warnings)
            ? data.warnings.map(x => String(x || '').trim()).filter(Boolean)
            : [];

        if (!silentToast) {
            if (effectiveMode === 'duck') {
                showToast('Background music set to low');
            } else if (effectiveMode === 'mute') {
                showToast('Background music muted');
            } else {
                showToast('Background music restored');
            }
            if (warnings.length) {
                showToast({ message: 'Live control has limitations', detail: warnings.join(' ') }, 'warning', {
                    title: 'Compatibility',
                    duration: 7000
                });
            }
        }
        return true;
    } catch (e) {
        return false;
    }
}

async function requestProgramMusicMode(targetMode, stationId) {
    const params = new URLSearchParams({
        mode: String(targetMode || 'normal'),
        station_id: String(stationId),
    });
    const showId = getCurrentProgramActionShowId();
    if (showId > 0) {
        params.set('show_id', String(showId));
    }
    const modernUrl = `${API_BASE}/api/liquidsoap/program/music?${params.toString()}`;
    let response;
    try {
        response = await fetch(modernUrl, {
            method: 'POST',
            headers: Auth.withAuthHeaders(),
        });
    } catch (err) {
        const detail = clipText(err?.message || 'Network request failed', 420);
        recordClientError({
            title: 'Network request failed',
            detail: `POST ${modernUrl} | ${detail}`,
            source: 'api',
            level: 'error'
        });
        showToast({ message: 'Could not reach backend service.', detail }, 'error', { title: 'Network Error', duration: 10000 });
        throw err;
    }

    if (response.status === 404) {
        return requestProgramMusicModeLegacy(targetMode, stationId);
    }

    if (!response.ok) {
        const errText = await response.text();
        const detail = parseApiErrorText(errText) || `POST ${modernUrl} failed (${response.status})`;
        const level = response.status >= 500 ? 'error' : 'warn';
        recordClientError({
            title: `API error (${response.status})`,
            detail: `POST ${modernUrl} | ${detail}`,
            source: 'api',
            level,
            statusCode: response.status
        });
        showToast(
            { message: `Request failed (${response.status})`, detail },
            'error',
            { title: 'API Error', duration: 9000 }
        );
        throw new Error(detail || `Request failed (${response.status})`);
    }

    return response.json();
}

async function requestProgramMusicModeLegacy(targetMode, stationId) {
    const fallbackMode = targetMode === 'normal' ? 'normal' : 'duck';
    const duckOn = fallbackMode === 'duck';
    const params = new URLSearchParams({
        on: duckOn ? 'true' : 'false',
        station_id: String(stationId),
    });
    const showId = getCurrentProgramActionShowId();
    if (showId > 0) {
        params.set('show_id', String(showId));
    }
    const legacyUrl = `${API_BASE}/api/liquidsoap/duck?${params.toString()}`;

    let response;
    try {
        response = await fetch(legacyUrl, {
            method: 'POST',
            headers: Auth.withAuthHeaders(),
        });
    } catch (err) {
        const detail = clipText(err?.message || 'Network request failed', 420);
        recordClientError({
            title: 'Network request failed',
            detail: `POST ${legacyUrl} | ${detail}`,
            source: 'api',
            level: 'error'
        });
        showToast({ message: 'Could not reach backend service.', detail }, 'error', { title: 'Network Error', duration: 10000 });
        throw err;
    }

    if (!response.ok) {
        const errText = await response.text();
        const detail = parseApiErrorText(errText) || `POST ${legacyUrl} failed (${response.status})`;
        const level = response.status >= 500 ? 'error' : 'warn';
        recordClientError({
            title: `API error (${response.status})`,
            detail: `POST ${legacyUrl} | ${detail}`,
            source: 'api',
            level,
            statusCode: response.status
        });
        showToast(
            { message: `Request failed (${response.status})`, detail },
            'error',
            { title: 'API Error', duration: 9000 }
        );
        throw new Error(detail || `Request failed (${response.status})`);
    }

    const warnings = [
        'Compatibility mode active: legacy talk endpoint is in use.'
    ];
    if (targetMode === 'mute') {
        warnings.push('This engine version cannot mute music live; low background mode was applied.');
    }

    return {
        mode: fallbackMode,
        effective_mode: fallbackMode,
        requested_mode: targetMode,
        supported: targetMode === fallbackMode,
        warnings,
    };
}

async function activateProgramTalkMode() {
    switchOnAirMode('program');
    const nextMode = currentState.programMusicMode === 'duck' ? 'normal' : 'duck';
    await setProgramMusicMode(nextMode);
}

async function closeProgramMode() {
    const ok = await setProgramMusicMode('normal', { silentToast: true });
    if (!ok) return;
    switchOnAirMode('automation');
    showToast('Radio Program Mode closed');
}

function isProgramLiveWorkspaceActive() {
    return currentState.panel === 'onair' && normalizeOnAirMode(currentState.onAirMode) === 'program';
}

function renderProgramQueueSourceUi() {
    const source = normalizeProgramQueueSource(currentState.programQueueSource);
    const effectiveSource = normalizeProgramQueueSource(currentState.programQueueEffectiveSource || source);
    const fallbackActive = Boolean(currentState.programQueueFallbackActive) || source !== effectiveSource;
    const hostQueueSize = Array.isArray(currentState.programQueueItems) ? currentState.programQueueItems.length : 0;
    const minHostTracks = normalizeProgramQueueMinTracks(currentState.programQueueMinTracksForHost);
    const canActivateHost = hostQueueSize >= minHostTracks;
    const controlState = getProgramControlState();
    const canSwitchSource = (
        controlState.showPermissions.has('show.broadcast')
        || controlState.canGoLive
        || controlState.canGoBreak
        || controlState.canEndShow
    );

    currentState.programQueueSource = source;
    currentState.programQueueEffectiveSource = effectiveSource;
    currentState.programQueueFallbackActive = fallbackActive;
    currentState.programQueueMinTracksForHost = minHostTracks;

    const badgeEl = document.getElementById('programQueueSourceBadge');
    if (badgeEl) {
        if (source === 'host') {
            badgeEl.textContent = fallbackActive ? 'Source: Host (fallback)' : 'Source: Host';
        } else {
            badgeEl.textContent = 'Source: Automation';
        }
        if (fallbackActive) {
            badgeEl.title = 'Host source selected, but host queue is empty. Automation queue keeps playing.';
        } else if (!canActivateHost && source !== 'host') {
            badgeEl.title = `Add at least ${minHostTracks} songs to activate host queue (current: ${hostQueueSize}).`;
        } else {
            badgeEl.title = '';
        }
    }

    document.querySelectorAll('.btn-program-source[data-program-queue-source]').forEach(btn => {
        const target = normalizeProgramQueueSource(btn.dataset.programQueueSource);
        btn.classList.toggle('active', target === source);
        btn.classList.toggle('effective', target === effectiveSource);
        btn.classList.toggle('fallback', target === 'host' && fallbackActive && source === 'host');
        if (!canSwitchSource) {
            btn.disabled = true;
            btn.title = 'Broadcast permission is required to switch sources.';
            return;
        }
        if (target === 'host') {
            const shouldDisable = source !== 'host' && !canActivateHost;
            btn.disabled = shouldDisable;
            btn.title = shouldDisable
                ? `Add at least ${minHostTracks} songs to host queue first (current: ${hostQueueSize}).`
                : '';
        }
    });
}

function enterProgramModeWorkspace(forceRefresh = false) {
    renderProgramQueueSourceUi();
    renderProgramMiniQueue();
    renderProgramBreakCountdown();
    refreshStudioWorkspace(forceRefresh);
    loadProgramMusicLibrary(forceRefresh);
    loadProgramAdsRuntimePreview(forceRefresh);
    if (Number(currentState.activeShowSession?.show_id || 0) <= 0 && Number(currentState.selectedShowId || 0) > 0) {
        claimProgramWorkspace({ silent: true }).then((claimed) => {
            if (!claimed) return;
            loadProgramQueueState(forceRefresh);
            loadCurrentSession();
        });
        return;
    }
    loadProgramQueueState(forceRefresh);
    loadCurrentSession();
}

function formatProgramCountdown(totalSeconds) {
    const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function parseProgramSlotDate(slotTime, nowDate = new Date()) {
    const token = String(slotTime || '').trim();
    const match = token.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

    const target = new Date(nowDate);
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() < nowDate.getTime()) {
        target.setDate(target.getDate() + 1);
    }
    return target;
}

function renderProgramBreakCountdown() {
    const countdownEl = document.getElementById('programBreakCountdown');
    const headlineEl = document.getElementById('programBreakHeadline');
    const listEl = document.getElementById('programBreakList');
    if (!countdownEl || !headlineEl || !listEl) return;

    const runtime = currentState.adsRuntime || null;
    const dueSlots = Array.isArray(runtime?.due_slots) ? runtime.due_slots : [];
    const nextSlots = Array.isArray(runtime?.next_slots) ? runtime.next_slots : [];
    const slots = nextSlots.length ? nextSlots : dueSlots;
    const primary = dueSlots.length ? dueSlots[0] : (slots[0] || null);

    if (!primary) {
        countdownEl.textContent = '--:--:--';
        headlineEl.textContent = 'No upcoming ad break.';
        listEl.innerHTML = '';
        return;
    }

    const slotTime = String(primary.slot_time || '--:--');
    const breakName = repairMojibakeText(primary.break_set_name, 'Ad Break');
    if (dueSlots.length) {
        countdownEl.textContent = 'DUE NOW';
        headlineEl.textContent = `${slotTime} · ${breakName}`;
    } else {
        const nowDate = new Date();
        const target = parseProgramSlotDate(slotTime, nowDate);
        const remainingSec = target
            ? Math.max(0, Math.floor((target.getTime() - nowDate.getTime()) / 1000))
            : 0;
        countdownEl.textContent = formatProgramCountdown(remainingSec);
        headlineEl.textContent = `Next ad break ${slotTime} · ${breakName}`;
    }

    const previewRows = slots.slice(0, 4);
    listEl.innerHTML = previewRows.map((row, idx) => {
        const rowTime = String(row?.slot_time || '--:--');
        const rowName = repairMojibakeText(row?.break_set_name, 'Ad Break');
        const activeCampaigns = Array.isArray(row?.active_campaigns) ? row.active_campaigns : [];
        const campaignLabel = activeCampaigns.length
            ? activeCampaigns.map(c => repairMojibakeText(c?.name, `Campaign #${c?.id || '-'}`)).join(', ')
            : 'No campaign';

        let statusLabel = 'Upcoming';
        let statusClass = 'next';
        if (row?.played_today) {
            statusLabel = 'Played';
            statusClass = 'played';
        } else if (row?.is_due) {
            statusLabel = 'Due now';
            statusClass = 'due';
        }

        const nowDate = new Date();
        const targetDate = parseProgramSlotDate(rowTime, nowDate);
        let etaText = 'ready';
        if (row?.played_today) {
            etaText = 'played today';
        } else if (!row?.is_due && targetDate) {
            const remaining = Math.max(0, Math.floor((targetDate.getTime() - nowDate.getTime()) / 1000));
            etaText = `in ${formatProgramCountdown(remaining)}`;
        }

        return `
            <div class="live-break-item ${idx === 0 ? 'primary' : ''}">
                <div class="live-break-item-top">
                    <span class="live-break-time">${escapeHtml(`${rowTime} · ${rowName}`)}</span>
                    <span class="live-break-status ${statusClass}">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="live-break-meta">${escapeHtml(campaignLabel)}</div>
                <div class="live-break-meta">${escapeHtml(etaText)}</div>
            </div>
        `;
    }).join('');
}

async function loadProgramAdsRuntimePreview(force = false) {
    const nowMs = Date.now();
    if (!force && (nowMs - _programAdsRuntimeLastAt) < 12000) {
        return;
    }
    if (_programAdsRuntimeInFlight) return;

    _programAdsRuntimeInFlight = true;
    try {
        await loadAdsRuntime();
        _programAdsRuntimeLastAt = Date.now();
    } finally {
        _programAdsRuntimeInFlight = false;
    }
}

async function pushProgramLibraryTrack(encodedPath) {
    const pathToken = String(encodedPath || '').trim();
    if (!pathToken) return;

    let filePath = '';
    try {
        filePath = decodeURIComponent(pathToken);
    } catch (_) {
        filePath = pathToken;
    }
    if (!filePath) return;
    await pushToLive(filePath);
}

function renderProgramMusicLibrary(options = {}) {
    const listEl = document.getElementById('programLibraryList');
    if (!listEl) return;

    const errorText = String(options?.errorText || '').trim();
    const rows = Array.isArray(currentState.programLibraryTracks) ? currentState.programLibraryTracks : [];
    const searchText = String(currentState.programLibrarySearch || '').trim();
    const controlState = getProgramControlState();
    const allowQueueEdit = !!controlState.canEditQueue;
    const legacyRole = String(Auth.getUser()?.role || '').trim().toLowerCase();
    const allowPlayNow = (
        (legacyRole === 'admin' || legacyRole === 'dj')
        && (
            legacyRole === 'admin'
            || controlState.showPermissions.has('show.broadcast')
            || controlState.canGoLive
            || controlState.canGoBreak
            || controlState.canEndShow
        )
    );

    if (!rows.length) {
        const emptyText = errorText
            || (searchText ? 'No songs matched this search.' : 'No songs in library yet.');
        listEl.innerHTML = `<div class="live-program-empty">${escapeHtml(emptyText)}</div>`;
        return;
    }

    listEl.innerHTML = rows.slice(0, 80).map(track => {
        const title = repairMojibakeText(track?.title, 'Untitled');
        const artist = repairMojibakeText(track?.artist, 'Unknown Artist');
        const duration = formatDuration(track?.duration || 0);
        const trackId = Number(track?.id || track?.track_id || 0);
        const canQueue = allowQueueEdit && Number.isInteger(trackId) && trackId > 0;
        const pathValue = String(track?.file_path || '').replace(/\\/g, '/');
        const canPlay = !!pathValue && allowPlayNow;
        const encodedPath = encodeURIComponent(pathValue);
        return `
            <div class="live-program-row">
                <div class="live-program-row-main">
                    <div class="live-program-row-title">${escapeHtml(title)}</div>
                    <div class="live-program-row-sub">
                        <span>${escapeHtml(artist)}</span>
                        <span>${escapeHtml(duration)}</span>
                    </div>
                </div>
                <div class="live-program-row-actions">
                    <button class="btn-sm" type="button" title="Add to host queue"
                        onclick="addTrackToProgramQueue(${trackId})" ${canQueue ? '' : 'disabled'}>
                        <span class="material-icons-round">playlist_add</span>
                    </button>
                    <button class="btn-sm" type="button" title="Play now"
                        onclick="pushProgramLibraryTrack('${encodedPath}')" ${canPlay ? '' : 'disabled'}>
                        <span class="material-icons-round">play_arrow</span>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function loadProgramMusicLibrary(force = false) {
    const listEl = document.getElementById('programLibraryList');
    if (!listEl) return;

    const stationId = Number(currentState.currentStationId || 1);
    const searchInput = document.getElementById('programLibrarySearch');
    const searchText = String(searchInput?.value || '').trim();
    const queryKey = `${stationId}|${searchText.toLowerCase()}`;

    if (!force && queryKey === _programLibraryLastQueryKey && Number(currentState.programLibraryStationId || 0) === stationId) {
        renderProgramMusicLibrary();
        return;
    }

    _programLibraryLastQueryKey = queryKey;
    listEl.innerHTML = '<div class="live-program-empty">Loading songs...</div>';

    const reqSeq = ++_programLibraryReqSeq;
    try {
        const url = new URL(`${window.location.origin}/api/tracks`);
        url.searchParams.set('station_id', String(stationId));
        url.searchParams.set('track_type', 'music');
        url.searchParams.set('sort_by', 'title');
        url.searchParams.set('sort_order', 'asc');
        url.searchParams.set('page', '1');
        url.searchParams.set('per_page', '80');
        if (searchText) {
            url.searchParams.set('search', searchText);
        }

        const data = await apiFetch(url.toString());
        if (reqSeq < _programLibraryAppliedSeq) return;
        _programLibraryAppliedSeq = reqSeq;

        currentState.programLibraryTracks = Array.isArray(data?.tracks) ? data.tracks : [];
        currentState.programLibrarySearch = searchText;
        currentState.programLibraryStationId = stationId;
        renderProgramMusicLibrary();
    } catch (_) {
        if (reqSeq < _programLibraryAppliedSeq) return;
        _programLibraryAppliedSeq = reqSeq;
        _programLibraryLastQueryKey = '';
        currentState.programLibraryTracks = [];
        currentState.programLibrarySearch = searchText;
        currentState.programLibraryStationId = stationId;
        renderProgramMusicLibrary({ errorText: 'Music library could not be loaded.' });
    }
}

function onProgramLibrarySearchInput() {
    if (_programLibrarySearchTimer) {
        clearTimeout(_programLibrarySearchTimer);
    }
    _programLibrarySearchTimer = setTimeout(() => {
        loadProgramMusicLibrary(false);
    }, 260);
}

function applyProgramQueueSnapshotState(queueView, stationId) {
    const snapshot = queueView || {};
    currentState.programQueueItems = Array.isArray(snapshot?.items) ? snapshot.items : [];
    currentState.programQueueMinTracksForHost = normalizeProgramQueueMinTracks(
        snapshot?.host_min_tracks_to_activate || currentState.programQueueMinTracksForHost
    );
    currentState.programQueueSource = normalizeProgramQueueSource(snapshot?.source || currentState.programQueueSource);
    currentState.programQueueEffectiveSource = normalizeProgramQueueSource(
        snapshot?.effective_source || currentState.programQueueSource
    );
    currentState.programQueueFallbackActive = Boolean(snapshot?.fallback_active);
    currentState.programQueueStationId = stationId;
    const showId = Number(currentState.activeShowSession?.show_id || currentState.selectedShowId || 0);
    if (showId > 0) {
        currentState.programWorkspaceClaimedShowId = showId;
    }
    _programQueueLastAt = Date.now();
}

async function claimProgramWorkspace(options = {}) {
    const silent = !!options.silent;
    const stationId = Number(currentState.currentStationId || 1);
    const showId = Number(currentState.selectedShowId || 0);
    const force = !!options.force;
    if (showId <= 0) return false;
    if (Number(currentState.activeShowSession?.show_id || 0) > 0) return true;

    try {
        const data = await apiFetch(`${API_BASE}/api/program/workspace/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ station_id: stationId, show_id: showId, force }),
        });
        currentState.programWorkspaceClaimedShowId = showId;
        applyProgramQueueSnapshotState(data?.queue || {}, stationId);
        renderProgramQueueSourceUi();
        renderProgramMiniQueue();
        refreshSoundboardSurfaces();
        return true;
    } catch (_) {
        if (Number(currentState.activeShowSession?.show_id || 0) <= 0) {
            currentState.programWorkspaceClaimedShowId = null;
        }
        if (!silent) {
            showToast('Program workspace could not be claimed for this show', 'error');
        }
        return false;
    }
}

async function releaseProgramWorkspace(options = {}) {
    const silent = !!options.silent;
    const stationId = Number(options.stationId || currentState.currentStationId || 1);
    const showId = Number(options.showId || currentState.programWorkspaceClaimedShowId || currentState.selectedShowId || 0);
    if (stationId <= 0 || showId <= 0) return true;
    if (Number(currentState.activeShowSession?.show_id || 0) > 0) return true;

    try {
        const params = new URLSearchParams({
            station_id: String(stationId),
            show_id: String(showId),
        });
        const data = await apiFetch(`${API_BASE}/api/program/workspace/claim?${params.toString()}`, {
            method: 'DELETE',
        });
        if (Number(currentState.currentStationId || 0) === stationId) {
            currentState.programWorkspaceClaimedShowId = null;
            applyProgramQueueSnapshotState(data?.queue || {}, stationId);
            renderProgramQueueSourceUi();
            renderProgramMiniQueue();
            refreshSoundboardSurfaces();
        }
        return true;
    } catch (_) {
        if (!silent) {
            showToast('Program workspace could not be released', 'error');
        }
        return false;
    }
}

async function loadProgramQueueState(force = false) {
    const listEl = document.getElementById('programMiniQueue');
    if (!listEl) return;

    const stationId = Number(currentState.currentStationId || 1);
    const showId = getCurrentProgramActionShowId();
    if (showId <= 0) {
        currentState.programQueueItems = [];
        currentState.programQueueSource = 'automation';
        currentState.programQueueEffectiveSource = 'automation';
        currentState.programQueueFallbackActive = false;
        currentState.programQueueStationId = stationId;
        if (force) {
            listEl.innerHTML = '<div class="live-program-empty">Select a show to open the host workspace.</div>';
        } else {
            renderProgramQueueSourceUi();
            renderProgramMiniQueue();
        }
        return;
    }
    if (!force && _programQueueInFlight) return;
    if (!force && Number(currentState.programQueueStationId || 0) === stationId && (Date.now() - _programQueueLastAt) < 2200) {
        renderProgramQueueSourceUi();
        renderProgramMiniQueue();
        return;
    }

    if (force) {
        listEl.innerHTML = '<div class="live-program-empty">Loading host queue...</div>';
    }

    _programQueueInFlight = true;
    try {
        const params = new URLSearchParams({ station_id: String(stationId) });
        if (showId > 0) {
            params.set('show_id', String(showId));
        }
        const data = await apiFetch(`${API_BASE}/api/program/queue?${params.toString()}`);
        applyProgramQueueSnapshotState(data, stationId);
        renderProgramQueueSourceUi();
        renderProgramMiniQueue();
    } catch (_) {
        if (force) {
            listEl.innerHTML = '<div class="live-program-empty">Host queue could not be loaded.</div>';
        }
    } finally {
        _programQueueInFlight = false;
    }
}

async function setProgramQueueSource(source) {
    const stationId = Number(currentState.currentStationId || 1);
    const targetSource = normalizeProgramQueueSource(source);
    const minHostTracks = normalizeProgramQueueMinTracks(currentState.programQueueMinTracksForHost);
    const hostQueueTotal = Array.isArray(currentState.programQueueItems) ? currentState.programQueueItems.length : 0;
    const showId = getCurrentProgramActionShowId();

    if (targetSource === 'host' && hostQueueTotal < minHostTracks) {
        showToast(
            `Host queue icin en az ${minHostTracks} sarki gerekli (simdi: ${hostQueueTotal})`,
            'warning'
        );
        renderProgramQueueSourceUi();
        return;
    }

    try {
        const data = await apiFetch(`${API_BASE}/api/program/queue/source`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ station_id: stationId, show_id: showId || null, source: targetSource })
        });
        const queueView = data?.queue || {};
        currentState.programQueueMinTracksForHost = normalizeProgramQueueMinTracks(
            queueView?.host_min_tracks_to_activate || currentState.programQueueMinTracksForHost
        );
        currentState.programQueueSource = normalizeProgramQueueSource(queueView?.source || data?.source || targetSource);
        currentState.programQueueEffectiveSource = normalizeProgramQueueSource(
            queueView?.effective_source || data?.effective_source || currentState.programQueueSource
        );
        currentState.programQueueFallbackActive = Boolean(queueView?.fallback_active ?? data?.fallback_active);
        currentState.programQueueItems = Array.isArray(queueView?.items) ? queueView.items : currentState.programQueueItems;
        currentState.programQueueStationId = stationId;
        renderProgramQueueSourceUi();
        renderProgramMiniQueue();
        loadQueue();

        if (targetSource === 'host' && currentState.programQueueFallbackActive) {
            showToast('Host source selected, but host queue is empty. Automation stays on air.', 'warning');
        } else {
            showToast(targetSource === 'host' ? 'Host queue is now on air' : 'Automation queue is now on air');
        }
    } catch (_) {
        // apiFetch already surfaces backend/network errors with detail.
    }
}

async function addTrackToProgramQueue(trackId) {
    const numericTrackId = Number(trackId || 0);
    if (!Number.isInteger(numericTrackId) || numericTrackId <= 0) return;

    const stationId = Number(currentState.currentStationId || 1);
    const showId = getCurrentProgramActionShowId();
    try {
        const data = await apiFetch(`${API_BASE}/api/program/queue/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ station_id: stationId, show_id: showId || null, track_id: numericTrackId })
        });
        const queueView = data?.queue || {};
        currentState.programQueueMinTracksForHost = normalizeProgramQueueMinTracks(
            queueView?.host_min_tracks_to_activate || currentState.programQueueMinTracksForHost
        );
        currentState.programQueueItems = Array.isArray(queueView?.items) ? queueView.items : currentState.programQueueItems;
        currentState.programQueueSource = normalizeProgramQueueSource(queueView?.source || currentState.programQueueSource);
        currentState.programQueueEffectiveSource = normalizeProgramQueueSource(
            queueView?.effective_source || currentState.programQueueEffectiveSource
        );
        currentState.programQueueFallbackActive = Boolean(queueView?.fallback_active);
        currentState.programQueueStationId = stationId;
        _programQueueLastAt = Date.now();
        renderProgramQueueSourceUi();
        renderProgramMiniQueue();
        showToast('Track added to host queue');
    } catch (_) {
        showToast('Track could not be added to host queue', 'error');
    }
}

async function moveProgramQueueItem(fromIndex, toIndex) {
    const stationId = Number(currentState.currentStationId || 1);
    const showId = getCurrentProgramActionShowId();
    try {
        const data = await apiFetch(`${API_BASE}/api/program/queue/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ station_id: stationId, show_id: showId || null, from_index: fromIndex, to_index: toIndex })
        });
        const queueView = data?.queue || {};
        currentState.programQueueMinTracksForHost = normalizeProgramQueueMinTracks(
            queueView?.host_min_tracks_to_activate || currentState.programQueueMinTracksForHost
        );
        currentState.programQueueItems = Array.isArray(queueView?.items) ? queueView.items : currentState.programQueueItems;
        currentState.programQueueSource = normalizeProgramQueueSource(queueView?.source || currentState.programQueueSource);
        currentState.programQueueEffectiveSource = normalizeProgramQueueSource(
            queueView?.effective_source || currentState.programQueueEffectiveSource
        );
        currentState.programQueueFallbackActive = Boolean(queueView?.fallback_active);
        currentState.programQueueStationId = stationId;
        _programQueueLastAt = Date.now();
        renderProgramQueueSourceUi();
        renderProgramMiniQueue();
    } catch (_) {
        showToast('Host queue order could not be changed', 'error');
    }
}

async function removeProgramQueueItem(queueIndex) {
    const stationId = Number(currentState.currentStationId || 1);
    const showId = getCurrentProgramActionShowId();
    try {
        const data = await apiFetch(
            `${API_BASE}/api/program/queue/${queueIndex}?station_id=${stationId}&show_id=${showId || ''}`,
            { method: 'DELETE' }
        );
        const queueView = data?.queue || {};
        currentState.programQueueMinTracksForHost = normalizeProgramQueueMinTracks(
            queueView?.host_min_tracks_to_activate || currentState.programQueueMinTracksForHost
        );
        currentState.programQueueItems = Array.isArray(queueView?.items) ? queueView.items : currentState.programQueueItems;
        currentState.programQueueSource = normalizeProgramQueueSource(queueView?.source || currentState.programQueueSource);
        currentState.programQueueEffectiveSource = normalizeProgramQueueSource(
            queueView?.effective_source || currentState.programQueueEffectiveSource
        );
        currentState.programQueueFallbackActive = Boolean(queueView?.fallback_active);
        currentState.programQueueStationId = stationId;
        _programQueueLastAt = Date.now();
        renderProgramQueueSourceUi();
        renderProgramMiniQueue();
    } catch (_) {
        showToast('Track could not be removed from host queue', 'error');
    }
}

function renderProgramMiniQueue() {
    const listEl = document.getElementById('programMiniQueue');
    if (!listEl) return;

    const queueRows = Array.isArray(currentState.programQueueItems) ? currentState.programQueueItems : [];
    const minHostTracks = normalizeProgramQueueMinTracks(currentState.programQueueMinTracksForHost);
    if (!queueRows.length) {
        const emptyText = normalizeProgramQueueSource(currentState.programQueueSource) === 'host'
            ? 'Host queue is empty. Add songs from the library.'
            : `Host queue is empty. Add at least ${minHostTracks} songs before switching on air.`;
        listEl.innerHTML = `<div class="live-program-empty">${escapeHtml(emptyText)}</div>`;
        return;
    }

    const rows = queueRows.slice(0, 18);
    const totalQueue = Math.max(0, Number(queueRows.length || 0));
    const activeHostSource = normalizeProgramQueueSource(currentState.programQueueEffectiveSource) === 'host';
    const controlState = getProgramControlState();
    const allowQueueEdit = !!controlState.canEditQueue;
    const legacyRole = String(Auth.getUser()?.role || '').trim().toLowerCase();
    const allowPlayNow = (
        (legacyRole === 'admin' || legacyRole === 'dj')
        && (
            legacyRole === 'admin'
            || controlState.showPermissions.has('show.broadcast')
            || controlState.canGoLive
            || controlState.canGoBreak
            || controlState.canEndShow
        )
    );

    listEl.innerHTML = rows.map((item, idx) => {
        const queueIndexRaw = item?.queue_index;
        const hasQueueIndex = Number.isInteger(queueIndexRaw) && queueIndexRaw >= 0;
        const queueIndex = hasQueueIndex ? queueIndexRaw : idx;
        const canMoveUp = allowQueueEdit && hasQueueIndex && queueIndex > 0;
        const canMoveDown = allowQueueEdit && hasQueueIndex && queueIndex < (totalQueue - 1);
        const canRemove = allowQueueEdit && hasQueueIndex;
        const pathValue = String(item?.file_path || '').replace(/\\/g, '/');
        const canPlayNow = !!pathValue && allowPlayNow;
        const encodedPath = encodeURIComponent(pathValue);

        const title = repairMojibakeText(item?.title, 'Untitled');
        const artist = repairMojibakeText(item?.artist, 'Unknown Artist');
        const duration = formatDuration(item?.duration || 0);
        const trackType = String(item?.track_type || 'music').toLowerCase();
        const badgeType = trackType === 'ad' ? 'ad' : (trackType === 'jingle' ? 'jingle' : 'music');

        let statusLabel = activeHostSource ? 'Queued' : 'Standby';
        let statusClass = 'queued';
        if (item?.is_current) {
            statusLabel = 'On Air';
            statusClass = 'onair';
        } else if (item?.is_next) {
            statusLabel = 'Next';
            statusClass = 'next';
        } else if (item?.is_played) {
            statusLabel = 'Played';
            statusClass = 'played';
        }

        return `
            <div class="live-program-row">
                <div class="live-program-row-main">
                    <div class="live-program-row-title">${escapeHtml(title)}</div>
                    <div class="live-program-row-sub">
                        <span>${escapeHtml(artist)}</span>
                        <span>${escapeHtml(duration)}</span>
                        <span class="badge badge-${badgeType}">${escapeHtml(trackType)}</span>
                        <span class="live-program-row-status ${statusClass}">${escapeHtml(statusLabel)}</span>
                    </div>
                </div>
                <div class="live-program-row-actions">
                    <button class="btn-sm" type="button" title="Move up"
                        onclick="moveProgramQueueItem(${queueIndex}, ${queueIndex - 1})" ${canMoveUp ? '' : 'disabled'}>
                        <span class="material-icons-round">arrow_upward</span>
                    </button>
                    <button class="btn-sm" type="button" title="Move down"
                        onclick="moveProgramQueueItem(${queueIndex}, ${queueIndex + 1})" ${canMoveDown ? '' : 'disabled'}>
                        <span class="material-icons-round">arrow_downward</span>
                    </button>
                    <button class="btn-sm" type="button" title="Remove"
                        onclick="removeProgramQueueItem(${queueIndex})" ${canRemove ? '' : 'disabled'}>
                        <span class="material-icons-round">close</span>
                    </button>
                    <button class="btn-sm" type="button" title="Play now"
                        onclick="pushProgramLibraryTrack('${encodedPath}')" ${canPlayNow ? '' : 'disabled'}>
                        <span class="material-icons-round">play_arrow</span>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function initAdCampaignEditModalUi() {
    const modal = document.getElementById('adCampaignEditModal');
    if (!modal || modal.dataset.bound === '1') return;
    modal.dataset.bound = '1';
    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeAdCampaignEditModal();
        }
    });
}

function switchSubpage(group, subpage, skipRemember = false, options = {}) {
    const safeGroup = String(group || '').trim();
    const safeSubpage = String(subpage || '').trim();
    const silentRefresh = options && options.silentRefresh === true;
    if (!safeGroup || !safeSubpage) return false;
    if (safeGroup === 'admin-access' && !canAccessAdminAccessSubpage(safeSubpage)) {
        return false;
    }

    let hasTarget = false;
    document.querySelectorAll(`.subpage-view[data-group="${safeGroup}"]`).forEach(view => {
        const isActive = String(view.dataset.subpage || '') === safeSubpage;
        view.classList.toggle('active', isActive);
        if (isActive) hasTarget = true;
    });
    if (!hasTarget) return false;

    document.querySelectorAll(`.subpage-tabs[data-group="${safeGroup}"] .subpage-tab`).forEach(btn => {
        const isActive = String(btn.dataset.subpage || '') === safeSubpage;
        btn.classList.toggle('active', isActive);
    });

    if (!skipRemember) {
        currentState.subpages[safeGroup] = safeSubpage;
    }
    if (silentRefresh) {
        return true;
    }
    if (safeGroup === 'admin-access' && safeSubpage === 'users') {
        loadUsers().catch(() => {});
    }
    if (safeGroup === 'admin-access' && safeSubpage === 'roles') {
        loadRoleTemplates().catch(() => {});
    }
    if (safeGroup === 'admin-access' && safeSubpage === 'program-assignments') {
        loadProgramAssignmentsPanel(true).catch(() => {});
    }
    if (safeGroup === 'admin-access' && safeSubpage === 'stations') {
        loadStationsAdminPanel(true).catch(() => {});
    }
    return true;
}

function ensureSubpageSelection(group) {
    const safeGroup = String(group || '').trim();
    if (!safeGroup) return;

    const saved = String(currentState.subpages?.[safeGroup] || '').trim();
    if (saved && switchSubpage(safeGroup, saved, true, { silentRefresh: true })) return;

    if (safeGroup === 'admin-access') {
        const fallback = getAdminAccessFallbackSubpage();
        if (fallback) {
            currentState.subpages[safeGroup] = fallback;
            switchSubpage(safeGroup, fallback, false, { silentRefresh: true });
        }
        return;
    }

    const firstBtn = document.querySelector(`.subpage-tabs[data-group="${safeGroup}"] .subpage-tab`);
    if (!firstBtn) return;
    const firstSubpage = String(firstBtn.dataset.subpage || '').trim();
    if (!firstSubpage) return;
    switchSubpage(safeGroup, firstSubpage, true, { silentRefresh: true });
}

async function loadAdminAccessActiveSubpage(forceRefresh = false) {
    if (!canAccessAdminAccessPanel()) {
        return null;
    }

    ensureSubpageSelection('admin-access');
    const activeSubpage = String(
        currentState.subpages?.['admin-access'] || getAdminAccessFallbackSubpage() || ''
    ).trim();
    if (!activeSubpage) {
        return null;
    }

    if (activeSubpage === 'roles') {
        return loadRoleTemplates(forceRefresh);
    }
    if (activeSubpage === 'program-assignments') {
        return loadProgramAssignmentsPanel(forceRefresh);
    }
    if (activeSubpage === 'stations') {
        return loadStationsAdminPanel(forceRefresh);
    }
    return loadUsers(forceRefresh);
}

function prepareSubpagesForStartup() {
    ensureSubpageSelection('library');
    ensureSubpageSelection('downloads');
    ensureSubpageSelection('ads');
    ensureSubpageSelection('admin-access');
    loadAdminAccessActiveSubpage(true).catch(() => {});
}

function initSubpages(options = {}) {
    document.querySelectorAll('.subpage-tabs[data-group]').forEach(tabBar => {
        if (tabBar.dataset.boundClick === '1') return;
        tabBar.dataset.boundClick = '1';
        tabBar.addEventListener('click', (event) => {
            const btn = event.target.closest('.subpage-tab[data-subpage]');
            if (!btn) return;
            const group = String(tabBar.dataset.group || '').trim();
            const subpage = String(btn.dataset.subpage || '').trim();
            switchSubpage(group, subpage);
        });
    });

    if (options && options.eager) {
        prepareSubpagesForStartup();
    }
}

function setNamedInterval(store, key, callback, intervalMs) {
    if (store.has(key)) {
        return store.get(key);
    }
    const timerId = setInterval(callback, intervalMs);
    store.set(key, timerId);
    return timerId;
}

function clearNamedInterval(store, key) {
    if (!store.has(key)) {
        return false;
    }
    clearInterval(store.get(key));
    store.delete(key);
    return true;
}

function clearNamedIntervalsByPrefix(store, prefix) {
    Array.from(store.keys())
        .filter(key => key.startsWith(prefix))
        .forEach(key => {
            clearNamedInterval(store, key);
        });
}

async function initializeOnAirPanel() {
    initOnAirModeUi();
    if (globalThis.StudioManager && typeof globalThis.StudioManager.init === 'function') {
        await globalThis.StudioManager.init();
    }
    if (globalThis.SoundBoardManager && typeof globalThis.SoundBoardManager.init === 'function') {
        await globalThis.SoundBoardManager.init();
    }
    if (canUseLiveMicUi() && globalThis.MicManager && typeof globalThis.MicManager.init === 'function') {
        await globalThis.MicManager.init();
    } else if (globalThis.MicManager && typeof globalThis.MicManager.destroy === 'function') {
        globalThis.MicManager.destroy();
    }
}

async function refreshOnAirPanel({ force = false } = {}) {
    await Promise.all([
        refreshHealth(),
        refreshStatus(),
        refreshNextTrack(),
        loadQueue(),
        loadShows(currentState.currentStationId),
        loadCurrentSession(),
        refreshStudioWorkspace(force),
    ]);
    if (normalizeOnAirMode(currentState.onAirMode) === 'program') {
        enterProgramModeWorkspace(force);
    }
}

function initializeLibraryPanel() {
    initLibraryScopeUi();
}

async function refreshLibraryPanel() {
    ensureSubpageSelection('library');
    await loadLibraryFilterOptions();
    await loadMetadataRules();
    await loadLibrary(currentState.currentPage || 1);
    await Promise.all([
        loadCartwall(),
        loadSweeperConfig(),
    ]);
}

function initializeDownloadsPanel() {
    initYtDlpImportUi();
    initUploadImportUi();
}

async function refreshDownloadsPanel({ force = false } = {}) {
    ensureSubpageSelection('downloads');
    await loadYtDlpSettings(force);
    await loadYtDlpQueueStatus(true);
}

function initializeAdsPanel() {
    initAdCampaignEditModalUi();
    initAdsPricingUi();
}

async function refreshAdsPanel({ force = false } = {}) {
    ensureSubpageSelection('ads');
    await loadAdsPanelData(force);
}

function initializeAdminAccessPanel() {
    initUserModalUi();
    initRoleTemplateModalUi();
    initProgramAssignmentsPanel();
}

async function refreshAdminAccessPanel({ force = false } = {}) {
    ensureSubpageSelection('admin-access');
    await loadAdminAccessActiveSubpage(force);
}

async function initializePanelsEagerly() {
    initializeLibraryPanel();
    initializeDownloadsPanel();
    initializeAdsPanel();
    initializeAdminAccessPanel();
    toggleStationOutputModeUi();
    await initializeOnAirPanel();
}

const PanelRegistry = {
    configs: {
        onair: {
            cacheMs: 1000,
            init: initializeOnAirPanel,
            refresh: refreshOnAirPanel,
            polling: [
                {
                    key: 'status',
                    intervalMs: 1000,
                    run: () => {
                        if (currentState.panel !== 'onair') return;
                        refreshStatus();
                    },
                },
                {
                    key: 'queue',
                    intervalMs: 3000,
                    run: () => {
                        if (currentState.panel !== 'onair') return;
                        loadQueue();
                    },
                },
                {
                    key: 'program-break-countdown',
                    intervalMs: 1000,
                    run: () => {
                        if (!isProgramLiveWorkspaceActive()) return;
                        renderProgramBreakCountdown();
                    },
                },
                {
                    key: 'program-ads-preview',
                    intervalMs: 15000,
                    run: () => {
                        if (!isProgramLiveWorkspaceActive()) return;
                        loadProgramAdsRuntimePreview(false);
                    },
                },
                {
                    key: 'program-queue-state',
                    intervalMs: 3000,
                    run: () => {
                        if (!isProgramLiveWorkspaceActive()) return;
                        loadProgramQueueState(false);
                    },
                },
            ],
        },
        library: {
            cacheMs: 10000,
            init: initializeLibraryPanel,
            refresh: refreshLibraryPanel,
        },
        downloads: {
            cacheMs: 5000,
            init: initializeDownloadsPanel,
            refresh: refreshDownloadsPanel,
            polling: [
                {
                    key: 'ytdlp-queue',
                    intervalMs: 2500,
                    run: () => {
                        if (currentState.panel !== 'downloads') return;
                        loadYtDlpQueueStatus(true);
                    },
                },
            ],
        },
        playlists: {
            cacheMs: 10000,
            refresh: async () => {
                await loadPlaylists();
            },
        },
        schedule: {
            cacheMs: 10000,
            refresh: async () => {
                await loadSchedule();
            },
        },
        ads: {
            cacheMs: 5000,
            init: initializeAdsPanel,
            refresh: refreshAdsPanel,
            polling: [
                {
                    key: 'runtime',
                    intervalMs: 15000,
                    run: () => {
                        if (currentState.panel !== 'ads') return;
                        loadAdsRuntime();
                    },
                },
            ],
        },
        soundboard: {
            cacheMs: 5000,
            refresh: async () => {
                refreshSoundboardSurfaces({ reload: true });
            },
        },
        shows: {
            cacheMs: 10000,
            refresh: async () => {
                await loadShows(currentState.currentStationId);
            },
        },
        'admin-access': {
            cacheMs: 5000,
            init: initializeAdminAccessPanel,
            refresh: refreshAdminAccessPanel,
        },
        'ai-host': {
            cacheMs: 10000,
            refresh: async () => {
                if (typeof showAIHostPanel === 'function') {
                    showAIHostPanel();
                }
            },
        },
        logs: {
            cacheMs: 5000,
            refresh: async () => {
                await loadLogs();
            },
        },
        settings: {
            cacheMs: 10000,
            refresh: async ({ force = false } = {}) => {
                await loadControlSettings(force);
            },
        },
    },
    async initOnce(panelId) {
        const safePanelId = String(panelId || '').trim();
        const config = this.configs[safePanelId];
        if (!config || panelRuntimeState.initialized.has(safePanelId)) {
            return false;
        }
        if (panelRuntimeState.initPromises.has(safePanelId)) {
            return panelRuntimeState.initPromises.get(safePanelId);
        }

        const initPromise = (async () => {
            if (typeof config.init === 'function') {
                await config.init();
            }
            panelRuntimeState.initialized.add(safePanelId);
            panelRuntimeState.initPromises.delete(safePanelId);
            return true;
        })().catch(err => {
            panelRuntimeState.initPromises.delete(safePanelId);
            throw err;
        });

        panelRuntimeState.initPromises.set(safePanelId, initPromise);
        return initPromise;
    },
    shouldRefresh(panelId, { force = false, stationId = currentState.currentStationId } = {}) {
        const safePanelId = String(panelId || '').trim();
        const config = this.configs[safePanelId];
        if (!config) {
            return false;
        }
        if (force || !panelRuntimeState.initialized.has(safePanelId)) {
            return true;
        }

        const safeStationId = Number(stationId || currentState.currentStationId || 0);
        const lastStationId = Number(panelRuntimeState.lastStationId[safePanelId] || 0);
        if (safeStationId > 0 && lastStationId > 0 && lastStationId !== safeStationId) {
            return true;
        }

        const lastRefreshAt = Number(panelRuntimeState.lastRefreshAt[safePanelId] || 0);
        if (!lastRefreshAt) {
            return true;
        }

        const cacheMs = Number(config.cacheMs || 0);
        if (cacheMs <= 0) {
            return true;
        }
        return (Date.now() - lastRefreshAt) >= cacheMs;
    },
    async refresh(panelId, options = {}) {
        const safePanelId = String(panelId || '').trim();
        const config = this.configs[safePanelId];
        if (!config) {
            return false;
        }

        await this.initOnce(safePanelId);
        if (!this.shouldRefresh(safePanelId, options)) {
            return false;
        }

        if (typeof config.refresh === 'function') {
            await config.refresh(options);
        }
        panelRuntimeState.lastRefreshAt[safePanelId] = Date.now();
        panelRuntimeState.lastStationId[safePanelId] = Number(options.stationId || currentState.currentStationId || 0);
        return true;
    },
    invalidateStationCaches(stationId = currentState.currentStationId) {
        Object.keys(this.configs).forEach(panelId => {
            panelRuntimeState.lastRefreshAt[panelId] = 0;
            panelRuntimeState.lastStationId[panelId] = Number(stationId || 0);
        });
    },
    teardownPolling(panelId) {
        if (!isVisiblePanelPollingEnabled()) {
            return;
        }
        const safePanelId = String(panelId || '').trim();
        if (!safePanelId) {
            Array.from(panelRuntimeState.panelTimers.keys()).forEach(key => {
                clearNamedInterval(panelRuntimeState.panelTimers, key);
            });
            return;
        }
        clearNamedIntervalsByPrefix(panelRuntimeState.panelTimers, `${safePanelId}:`);
    },
    syncPolling() {
        if (!panelRuntimeState.pollingReady || !isVisiblePanelPollingEnabled()) {
            return;
        }

        setNamedInterval(panelRuntimeState.shellTimers, 'shell:health-fallback', () => {
            if (currentState.panel === 'onair') return;
            refreshHealth();
        }, 15000);

        const activePanelId = String(currentState.panel || 'onair').trim() || 'onair';
        Object.keys(this.configs).forEach(panelId => {
            if (panelId !== activePanelId) {
                this.teardownPolling(panelId);
            }
        });

        const config = this.configs[activePanelId];
        const polling = Array.isArray(config?.polling) ? config.polling : [];
        polling.forEach(task => {
            setNamedInterval(
                panelRuntimeState.panelTimers,
                `${activePanelId}:${task.key}`,
                task.run,
                task.intervalMs,
            );
        });
    },
};

if (typeof globalThis !== 'undefined') {
    globalThis.PanelRegistry = PanelRegistry;
}

async function refreshVisiblePanel(options = {}) {
    const activePanelId = String(currentState.panel || 'onair').trim() || 'onair';
    return PanelRegistry.refresh(activePanelId, options);
}

async function refreshAllPanelsLegacy(forceRefresh = false) {
    await Promise.all([
        refreshHealth(),
        refreshStatus(),
        refreshNextTrack(),
        loadLibraryFilterOptions(),
        loadMetadataRules(),
        loadLibrary(),
        loadPlaylists(),
        loadSchedule(),
        loadAdsPanelData(forceRefresh),
        loadQueue(),
        loadShows(currentState.currentStationId),
    ]);
    await Promise.all([
        loadCartwall(),
        loadSweeperConfig(),
        loadCurrentSession(),
    ]);
    if (normalizeOnAirMode(currentState.onAirMode) === 'program') {
        enterProgramModeWorkspace(true);
    }
}

function initStationSwitcher() {
    const selector = document.getElementById('stationSelector');
    if (selector && !selector.dataset.boundChange) {
        selector.dataset.boundChange = '1';
        selector.addEventListener('change', () => {
            changeStation();
        });
    }

    const nameInput = document.getElementById('stationCreateName');
    if (nameInput && !nameInput.dataset.boundEnter) {
        nameInput.dataset.boundEnter = '1';
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                createStationFromModal();
            }
        });
    }
}

function refreshPanelOnSwitchLegacy(panelId) {
    if (panelId === 'library') {
        loadLibraryFilterOptions();
        loadMetadataRules();
        loadLibrary();
        loadCartwall();
        loadSweeperConfig();
    }
    if (panelId === 'downloads') {
        loadYtDlpSettings(true);
        loadYtDlpQueueStatus(true);
    }
    if (panelId === 'playlists') loadPlaylists();
    if (panelId === 'schedule') loadSchedule();
    if (panelId === 'ads') loadAdsPanelData(true);
    if (panelId === 'logs') loadLogs();
    if (panelId === 'settings') loadControlSettings(true);
    if (panelId === 'admin-access') {
        loadAdminAccessActiveSubpage(true).catch(() => {});
    }
    if (panelId === 'ai-host' && typeof showAIHostPanel === 'function') {
        showAIHostPanel();
    }
    if (panelId === 'onair' && normalizeOnAirMode(currentState.onAirMode) === 'program') {
        enterProgramModeWorkspace(false);
    }
}

function switchPanel(panelId) {
    const safePanelId = String(panelId || '').trim();
    if (!safePanelId) {
        return false;
    }
    const visiblePanels = new Set(computeVisiblePanels());
    if (safePanelId !== 'onair' && !visiblePanels.has(safePanelId)) {
        return false;
    }

    currentState.panel = safePanelId;
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const targetPanel = document.getElementById(`panel-${safePanelId}`);
    if (targetPanel) targetPanel.classList.add('active');
    document.querySelectorAll('.nav-btn[data-panel]').forEach(btn => {
        const btnPanelId = String(btn.dataset?.panel || '').trim();
        btn.classList.toggle('active', btnPanelId === safePanelId);
    });

    if (['library', 'downloads', 'ads', 'admin-access'].includes(safePanelId)) {
        ensureSubpageSelection(safePanelId);
    }

    syncOnAirModeUi();
    // Soundboard hotkeys — active only when panel is visible
    if (globalThis.SoundBoardManager) {
        if (safePanelId === 'soundboard') {
            SoundBoardManager.enableHotkeys();
            SoundBoardManager.loadItems(currentState.currentStationId);
        } else if (safePanelId === 'onair') {
            SoundBoardManager.loadItems(currentState.currentStationId);
        } else {
            SoundBoardManager.disableHotkeys();
        }
    }
    syncPanelVisibilityUi();
    if (!isLazyPanelModeEnabled()) {
        refreshPanelOnSwitchLegacy(safePanelId);
        return true;
    }
    PanelRegistry.syncPolling();
    refreshVisiblePanel({ force: false, stationId: currentState.currentStationId }).catch(err => {
        console.warn(`Panel activation failed for ${safePanelId}`, err);
    });
    return true;
}

function initPolling(options = {}) {
    if (panelRuntimeState.pollingReady) {
        return;
    }
    panelRuntimeState.pollingReady = true;

    if ((options && options.eager) || !isVisiblePanelPollingEnabled()) {
    // Poll for status and current playing track every 1 second (needed for progress bar)
        setInterval(refreshStatus, 1000);
        setInterval(refreshHealth, 5000);
        setInterval(loadQueue, 3000);
        setInterval(() => {
            if (!isProgramLiveWorkspaceActive()) return;
            renderProgramBreakCountdown();
        }, 1000);
        setInterval(() => {
            if (currentState.panel !== 'ads') return;
            loadAdsRuntime();
        }, 15000);
        setInterval(() => {
            if (!isProgramLiveWorkspaceActive()) return;
            loadProgramAdsRuntimePreview(false);
        }, 15000);
        setInterval(() => {
            if (!isProgramLiveWorkspaceActive()) return;
            loadProgramQueueState(false);
        }, 3000);
        return;
    }

    PanelRegistry.syncPolling();
}

async function refreshAll(options = {}) {
    const forceRefresh = options.force !== false;
    if ((options && options.eager) || !isLazyPanelModeEnabled()) {
        await refreshAllPanelsLegacy(forceRefresh);
        return;
    }
    await refreshVisiblePanel({
        force: forceRefresh,
        stationId: currentState.currentStationId,
    });
}

function _getSavedStationId() {
    const raw = window.localStorage.getItem('radio_station_id');
    const val = Number(raw);
    return Number.isInteger(val) && val > 0 ? val : null;
}

function _saveStationId(stationId) {
    const sid = Number(stationId);
    if (Number.isInteger(sid) && sid > 0) {
        window.localStorage.setItem('radio_station_id', String(sid));
    }
}

function _currentStationName() {
    const sid = Number(currentState.currentStationId || 1);
    const station = (currentState.stations || []).find(s => Number(s.id) === sid);
    return station?.name || `Station ${sid}`;
}

function _stationNameById(stationId) {
    const sid = Number(stationId || 0);
    if (!Number.isInteger(sid) || sid <= 0) return '';
    const station = (currentState.stations || []).find(s => Number(s.id) === sid);
    return station?.name || `Station ${sid}`;
}

function repairMojibakeText(value, fallback = '') {
    const raw = String(value ?? '').trim();
    if (!raw) return fallback;
    if (!/[ÃÂâ�]/.test(raw)) return raw;

    try {
        const repaired = decodeURIComponent(escape(raw)).trim();
        if (repaired && !/[ÃÂâ�]/.test(repaired)) return repaired;
    } catch (_) {
        // Ignore and use fallback below.
    }
    return fallback || raw;
}

function normalizeScheduleWindowText(value) {
    const text = repairMojibakeText(value, '');
    if (!text) return '';
    const matches = text.match(/\b\d{1,2}:\d{2}\b/g) || [];
    if (matches.length >= 2) return `${matches[0]} - ${matches[1]}`;
    if (matches.length === 1) return matches[0];
    return text;
}

function normalizeTrackCompareText(value) {
    const text = repairMojibakeText(value, '').trim().toLowerCase();
    if (!text) return '';
    return text
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function findQueueTrackForNowPlaying(current) {
    if (!current || Number(currentState.queueStationId || 0) !== Number(currentState.currentStationId || 0)) {
        return null;
    }
    const items = Array.isArray(currentState.queueItems) ? currentState.queueItems : [];
    if (!items.length) return null;

    const titleNorm = normalizeTrackCompareText(current.title);
    const artistNorm = normalizeTrackCompareText(current.artist);

    const matchesCurrent = items.filter(item => item && item.is_current);
    const pool = matchesCurrent.length ? matchesCurrent : items;

    const scoreMatch = (item) => {
        const itemTitle = normalizeTrackCompareText(item?.title);
        const itemArtist = normalizeTrackCompareText(item?.artist);
        if (!itemTitle || !titleNorm) return false;
        const titleOk = itemTitle === titleNorm || itemTitle.includes(titleNorm) || titleNorm.includes(itemTitle);
        if (!titleOk) return false;
        if (!artistNorm || !itemArtist) return true;
        return itemArtist === artistNorm || itemArtist.includes(artistNorm) || artistNorm.includes(itemArtist);
    };

    return pool.find(scoreMatch) || items.find(scoreMatch) || matchesCurrent[0] || null;
}

function resolveDeckTotalDuration(current, statusData) {
    const base = Number.parseFloat(current?.duration || 0);
    if (Number.isFinite(base) && base > 0) return base;

    const metaDur = Number.parseFloat(statusData?.metadata?.duration || 0);
    if (Number.isFinite(metaDur) && metaDur > 0) return metaDur;

    const queueTrack = findQueueTrackForNowPlaying(current);
    const queueDur = Number.parseFloat(queueTrack?.duration || 0);
    if (Number.isFinite(queueDur) && queueDur > 0) return queueDur;

    return 0;
}

function renderStationSelector() {
    const selector = document.getElementById('stationSelector');
    if (!selector) return;

    const stations = Array.isArray(currentState.stations) ? currentState.stations : [];
    if (!stations.length) {
        selector.innerHTML = '<option value="">No stations available</option>';
        selector.value = '';
        currentState.currentStationId = null;
        return;
    }

    selector.innerHTML = stations.map(station => `<option value="${station.id}">${station.name}</option>`).join('');

    selector.value = String(currentState.currentStationId);
    if (selector.value !== String(currentState.currentStationId)) {
        const firstStationId = Number(stations[0]?.id || 1);
        currentState.currentStationId = firstStationId;
        selector.value = String(firstStationId);
    }

    syncStationTargetSelectors();
    applyLibraryScopeUi();
}

function renderStationOptions(selectEl, selectedStationId, includePlaceholder = false) {
    if (!selectEl) return;
    const stations = Array.isArray(currentState.stations) ? currentState.stations : [];
    if (!stations.length) {
        const placeholder = includePlaceholder ? '<option value="">Select station...</option>' : '<option value="">No stations available</option>';
        selectEl.innerHTML = placeholder;
        selectEl.value = '';
        return;
    }

    const selected = Number(selectedStationId || currentState.currentStationId || stations[0].id || 1);
    const placeholder = includePlaceholder ? '<option value="">Select station...</option>' : '';
    const options = stations.map(station => `<option value="${station.id}">${station.name}</option>`).join('');
    selectEl.innerHTML = `${placeholder}${options}`;
    selectEl.value = String(selected);
    if (selectEl.value !== String(selected)) {
        selectEl.value = String(stations[0]?.id || 1);
    }
}

function syncStationTargetSelectors() {
    const currentStationId = Number(currentState.currentStationId || 1);
    const sourceStationId = Number(currentState.librarySourceStationId || currentStationId);

    const librarySourceEl = document.getElementById('librarySourceStation');
    if (librarySourceEl) {
        renderStationOptions(librarySourceEl, sourceStationId, false);
        const selected = Number(librarySourceEl.value || currentStationId);
        currentState.librarySourceStationId = Number.isInteger(selected) && selected > 0 ? selected : currentStationId;
    }

    const ytdlpTargetEl = document.getElementById('ytDlpTargetStation');
    if (ytdlpTargetEl) {
        const preferred = Number(ytdlpTargetEl.value || currentStationId);
        renderStationOptions(ytdlpTargetEl, preferred, false);
    }

    const uploadTargetEl = document.getElementById('uploadTargetStation');
    if (uploadTargetEl) {
        const preferred = Number(uploadTargetEl.value || currentStationId);
        renderStationOptions(uploadTargetEl, preferred, false);
    }
}

function applyLibraryScopeUi() {
    const scopeEl = document.getElementById('libraryScope');
    const sourceEl = document.getElementById('librarySourceStation');
    if (!scopeEl) return;

    const rawScope = String(scopeEl.value || currentState.libraryScope || 'local').trim().toLowerCase();
    const scope = ['local', 'station', 'all'].includes(rawScope) ? rawScope : 'local';
    currentState.libraryScope = scope;
    scopeEl.value = scope;

    if (scope === 'local') {
        currentState.librarySourceStationId = Number(currentState.currentStationId || 1);
    } else if (!Number(currentState.librarySourceStationId || 0)) {
        currentState.librarySourceStationId = Number(currentState.currentStationId || 1);
    }

    if (sourceEl) {
        syncStationTargetSelectors();
        sourceEl.disabled = scope !== 'station';
    }
}

function onLibraryScopeChanged() {
    applyLibraryScopeUi();
    loadLibraryFilterOptions();
    searchTracks();
}

function onLibrarySourceStationChanged() {
    const sourceEl = document.getElementById('librarySourceStation');
    if (!sourceEl) return;
    const sid = Number(sourceEl.value || 0);
    if (Number.isInteger(sid) && sid > 0) {
        currentState.librarySourceStationId = sid;
    }
    if (currentState.libraryScope === 'station') {
        loadLibraryFilterOptions();
        searchTracks();
    }
}

function buildLibraryScopeParams() {
    const scope = String(currentState.libraryScope || 'local');
    const params = { library_scope: scope };
    if (scope === 'station') {
        const sourceStationId = Number(currentState.librarySourceStationId || currentState.currentStationId || 1);
        params.source_station_id = sourceStationId;
    }
    return params;
}

function initLibraryScopeUi() {
    applyLibraryScopeUi();
}

async function refreshActiveBroadcastStation() {
    try {
        const data = await apiFetch(`${API_BASE}/api/stations/active`);
        const sid = Number(data?.station_id || 0);
        if (Number.isInteger(sid) && sid > 0) {
            currentState.activeBroadcastStationId = sid;
        }
        return data;
    } catch (e) {
        console.warn('Could not load active broadcast station', e);
        return null;
    }
}

async function loadStations(preferredStationId = null) {
    try {
        const data = await apiFetch(`${API_BASE}/api/stations`);
        let stations = Array.isArray(data?.stations) ? data.stations : [];
        if (!stations.length && Array.isArray(data)) {
            stations = data;
        }
        currentState.stations = stations;
        const requestedStationId = Number(preferredStationId || 0);
        const savedStationId = Number(_getSavedStationId() || 0);
        const currentStationId = Number(currentState.currentStationId || 0);
        const requestedStation = Number.isInteger(requestedStationId) && requestedStationId > 0
            ? stations.find(s => Number(s.id) === requestedStationId) || null
            : null;
        const savedStation = Number.isInteger(savedStationId) && savedStationId > 0
            ? stations.find(s => Number(s.id) === savedStationId) || null
            : null;
        const currentStation = Number.isInteger(currentStationId) && currentStationId > 0
            ? stations.find(s => Number(s.id) === currentStationId) || null
            : null;
        const selected = requestedStation || savedStation || currentStation || stations[0] || null;
        currentState.currentStationId = selected ? Number(selected.id) : null;
        if (currentState.currentStationId && (currentState.libraryScope === 'local' || !Number(currentState.librarySourceStationId || 0))) {
            currentState.librarySourceStationId = currentState.currentStationId;
        }
        if (currentState.currentStationId) {
            _saveStationId(currentState.currentStationId);
            syncAuthenticatedAppShellUrl();
        }
        await refreshActiveBroadcastStation();
    } catch (e) {
        console.error('Station list could not be loaded', e);
        currentState.stations = [];
        currentState.currentStationId = null;
        await refreshActiveBroadcastStation();
    }
    renderStationSelector();
    renderProgramAssignmentStationOptions();
    applyLibraryScopeUi();
}

async function _createStationWithPrompt() {
    openStationCreateModal();
}

function openStationCreateModal() {
    const modal = document.getElementById('stationCreateModal');
    const nameInput = document.getElementById('stationCreateName');
    const descInput = document.getElementById('stationCreateDescription');
    if (!modal || !nameInput || !descInput) return;

    nameInput.value = '';
    descInput.value = '';
    modal.style.display = 'flex';
    setTimeout(() => nameInput.focus(), 0);
}

function closeStationCreateModal() {
    const modal = document.getElementById('stationCreateModal');
    if (!modal) return;
    modal.style.display = 'none';
}

async function createStationFromModal() {
    const nameInput = document.getElementById('stationCreateName');
    const descInput = document.getElementById('stationCreateDescription');
    if (!nameInput || !descInput) return;

    const stationName = (nameInput.value || '').trim();
    const stationDescription = (descInput.value || '').trim();

    if (!stationName) {
        showToast('Station name is required', 'error');
        nameInput.focus();
        return;
    }

    try {
        const data = await apiFetch(`${API_BASE}/api/stations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: stationName,
                description: stationDescription
            })
        });
        const newStationId = Number(data?.station?.id || 0);
        await loadStations(newStationId > 0 ? newStationId : null);
        autoPlaylistFilterStation = null;
        _playlistCache = [];
        scheduleCache = [];
        ytdlpSettingsLoaded = false;
        ytdlpFocusedJobId = null;
        showToast(`Station created: ${data?.station?.name || stationName}`);
        closeStationCreateModal();
        PanelRegistry.invalidateStationCaches(currentState.currentStationId);
        await refreshHealth();
        WS.connect(true);
        await refreshAll({ force: true });
    } catch (e) {
        const message = String(e?.message || '');
        const detail = message.slice(0, 140).trim();
        showToast(detail ? `Station could not be created: ${detail}` : 'Station could not be created', 'error');
    }
}

window.openStationCreateModal = openStationCreateModal;
window.closeStationCreateModal = closeStationCreateModal;
window.createStationFromModal = createStationFromModal;
window.loadStationsAdminPanel = loadStationsAdminPanel;
window.createAdminStation = createAdminStation;
window.setActiveAdminStation = setActiveAdminStation;
window.deleteAdminStation = deleteAdminStation;

async function changeStation() {
    const selector = document.getElementById('stationSelector');
    if (!selector) return;

    const selectedValue = String(selector.value || '').trim();
    if (selectedValue === 'new') {
        await _createStationWithPrompt();
        return;
    }

    const stationId = Number(selectedValue);
    if (!Number.isInteger(stationId) || stationId <= 0) {
        renderStationSelector();
        return;
    }
    const previousStationId = Number(currentState.currentStationId || 1);
    if (stationId === previousStationId) return;
    const previousClaimedShowId = Number(currentState.programWorkspaceClaimedShowId || currentState.selectedShowId || 0);
    if (Number(currentState.activeShowSession?.show_id || 0) <= 0 && previousClaimedShowId > 0) {
        await releaseProgramWorkspace({
            stationId: previousStationId,
            showId: previousClaimedShowId,
            silent: true,
        });
    }

    currentState.currentStationId = stationId;
    currentState.selectedShowId = null;
    currentState.activeShowSession = null;
    currentState.programWorkspaceClaimedShowId = null;
    if (currentState.libraryScope === 'local') {
        currentState.librarySourceStationId = stationId;
    }
    _saveStationId(stationId);
    syncAuthenticatedAppShellUrl();
    syncStationTargetSelectors();
    syncProgramAssignmentStationState(stationId);
    renderProgramAssignmentStationOptions();
    if (currentState.panel === 'admin-access'
        && currentState.subpages?.['admin-access'] === 'program-assignments') {
        await loadProgramAssignmentsPanel(true);
    }
    applyLibraryScopeUi();
    autoPlaylistFilterStation = null;
    _playlistCache = [];
    scheduleCache = [];
    ytdlpSettingsLoaded = false;
    ytdlpFocusedJobId = null;
    await refreshActiveBroadcastStation();
    _lastPlayingTitle = '';
    _onAirClock = { title: '', artist: '', total: 0, remaining: 0, elapsed: 0, ts: Date.now() / 1000 };
    refreshSoundboardSurfaces({ reload: true });
    const timeEl = document.getElementById('deckATime');
    const progressEl = document.getElementById('deckAProgress');
    if (timeEl) timeEl.textContent = '00:00 / 00:00';
    if (progressEl) progressEl.style.width = '0%';
    const selectedName = _currentStationName();
    showToast(`Switched to ${selectedName}`);
    if (currentState.panel === 'onair' || currentState.panel === 'soundboard') {
        refreshSoundboardSurfaces({ reload: true });
    }
    PanelRegistry.invalidateStationCaches(stationId);
    await refreshHealth();
    WS.connect(true);
    await refreshAll({ force: true });
}

// ============================================
// QUEUE — Solea Tarzı Kuyruk Yönetimi
// ============================================

function applyQueueSnapshot(data) {
    currentState.queueItems = Array.isArray(data?.items) ? data.items : [];
    currentState.queueStationId = Number(data?.station_id || currentState.currentStationId || 1);
    currentState.programQueueSource = normalizeProgramQueueSource(
        data?.queue_source || currentState.programQueueSource
    );
    currentState.programQueueEffectiveSource = normalizeProgramQueueSource(
        data?.effective_queue_source || currentState.programQueueEffectiveSource
    );
    currentState.programQueueFallbackActive =
        currentState.programQueueSource !== currentState.programQueueEffectiveSource;
    if (isProgramLiveWorkspaceActive()) {
        renderProgramQueueSourceUi();
    }

    const nameEl = document.getElementById('queuePlaylistName');
    const timeEl = document.getElementById('queueScheduleTime');
    const playlistName = repairMojibakeText(data?.schedule_name || data?.playlist_name, 'No Active Playlist');
    const scheduleTime = normalizeScheduleWindowText(data?.schedule_time);
    if (nameEl) nameEl.textContent = playlistName || '—';
    if (timeEl) timeEl.textContent = scheduleTime;

    const tbody = document.getElementById('queueTableBody');
    if (!tbody) {
        renderProgramMiniQueue();
        return;
    }

    if (!data?.items || data.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted)">
            <span class="material-icons-round" style="font-size:32px;display:block;margin-bottom:8px">playlist_remove</span>
            No tracks in queue. Add tracks to a playlist from the library.
        </td></tr>`;
        renderProgramMiniQueue();
        return;
    }

    const rowsHtml = [];
    let lastAdBreakGroupKey = '';

    (data.items || []).forEach((item, idx) => {
        const isCurrent = item.is_current;
        const isNext = item.is_next;
        const isPlayed = item.is_played;
        const queueIndexRaw = item.queue_index;
        const hasQueueIndex = Number.isInteger(queueIndexRaw) && queueIndexRaw >= 0;
        const queueIndex = hasQueueIndex ? queueIndexRaw : idx;
        const adBreakBefore = Array.isArray(item.ad_break_before) ? item.ad_break_before : [];
        const isVirtualAdBreak = Boolean(item && item.is_virtual) && String(item.virtual_kind || '') === 'ad_break';

        const breakSlotTime = String(item.ad_break_slot_time || '--:--');
        const breakSetName = repairMojibakeText(item.ad_break_set_name || 'Ad Break', 'Ad Break');
        const breakCampaigns = Array.isArray(item.ad_campaign_names) && item.ad_campaign_names.length
            ? item.ad_campaign_names.map(name => repairMojibakeText(name, name)).join(', ')
            : 'No campaign';
        const adBreakGroupKey = isVirtualAdBreak
            ? `${breakSlotTime}|${breakSetName}|${breakCampaigns}`
            : '';

        if (isVirtualAdBreak && adBreakGroupKey !== lastAdBreakGroupKey) {
            const breakEta = String(item.estimated_time || '--:--:--');
            rowsHtml.push(`<tr class="queue-row queue-row-ad-break-header">
                <td colspan="8">
                    <div class="queue-ad-break-headline">
                        <span class="material-icons-round">campaign</span>
                        <span>Reklam Kuşağı ${escapeHtml(breakSlotTime)} · ${escapeHtml(breakSetName)}</span>
                    </div>
                    <div class="queue-ad-break-subline">Başlangıç: ${escapeHtml(breakEta)} · Kampanyalar: ${escapeHtml(breakCampaigns)}</div>
                </td>
            </tr>`);
            lastAdBreakGroupKey = adBreakGroupKey;
        } else if (!isVirtualAdBreak) {
            lastAdBreakGroupKey = '';
        }

        let rowClass = 'queue-row';
        let statusIcon = 'schedule';
        let statusColor = 'var(--text-secondary)';

        if (isVirtualAdBreak) {
            rowClass += ' queue-row-ad-break-item';
            if (item.track_type === 'ad') {
                rowClass += ' queue-row-ad-main';
                statusIcon = 'campaign';
                statusColor = 'var(--red)';
            } else {
                rowClass += ' queue-row-ad-jingle';
                statusIcon = 'graphic_eq';
                statusColor = 'var(--orange)';
            }
        } else if (isCurrent) {
            rowClass = 'queue-row queue-row-current';
            statusIcon = 'play_arrow';
            statusColor = 'var(--green)';
        } else if (isNext) {
            rowClass = 'queue-row queue-row-next';
            statusIcon = 'hourglass_top';
            statusColor = 'var(--cyan)';
        } else if (isPlayed) {
            rowClass = 'queue-row queue-row-played';
            statusIcon = 'check_circle';
            statusColor = 'var(--text-muted)';
        }

        if (!isVirtualAdBreak && item.track_type === 'jingle') {
            rowClass += ' queue-row-jingle';
            if (!isCurrent && !isNext && !isPlayed) {
                statusIcon = 'graphic_eq';
                statusColor = 'var(--orange)';
            }
        } else if (!isVirtualAdBreak && item.track_type === 'announcement') {
            rowClass += ' queue-row-announcement';
            if (!isCurrent && !isNext && !isPlayed) {
                statusIcon = 'record_voice_over';
                statusColor = 'var(--cyan)';
            }
        }

        const stage = String(item.ad_break_stage || '').toLowerCase();
        let stageLabel = '';
        let stageClass = '';
        if (isVirtualAdBreak) {
            if (stage === 'entry') {
                stageLabel = 'Giriş Jingle';
                stageClass = 'stage-entry';
            } else if (stage === 'exit') {
                stageLabel = 'Çıkış Jingle';
                stageClass = 'stage-exit';
            } else {
                stageLabel = 'Reklam';
                stageClass = 'stage-ad';
            }
        }
        const stageChip = stageLabel
            ? `<span class="queue-stage-chip ${stageClass}">${escapeHtml(stageLabel)}</span>`
            : '';

        const dur = formatDuration(item.duration);
        const typeBadge = item.track_type === 'jingle'
            ? 'badge-jingle'
            : (item.track_type === 'ad'
                ? 'badge-ad'
                : (item.track_type === 'announcement' ? 'badge-announcement' : 'badge-music'));
        const adBreakNote = adBreakBefore.map(marker => {
            const setName = repairMojibakeText(marker.break_set_name || 'Ad Break', 'Ad Break');
            const slotTime = String(marker.slot_time || '--:--');
            const eta = String(marker.estimated_time || item.estimated_time || '--:--:--');
            const campaigns = Array.isArray(marker.campaign_names) && marker.campaign_names.length
                ? marker.campaign_names.map(name => repairMojibakeText(name, name)).join(', ')
                : 'No campaign';
            return `<div class="queue-ad-break-note">Ad Break ${escapeHtml(slotTime)} → ${escapeHtml(eta)} · ${escapeHtml(setName)} · ${escapeHtml(campaigns)}</div>`;
        }).join('');
        const virtualContext = isVirtualAdBreak
            ? `<div class="queue-ad-break-sub">${escapeHtml(item.track_type === 'ad' ? `Kampanya: ${breakCampaigns}` : `Kuşak: ${breakSetName} (${breakSlotTime})`)}</div>`
            : '';

        const titleText = repairMojibakeText(item.title, 'Untitled');
        const artistText = repairMojibakeText(item.artist, 'Unknown Artist');

        rowsHtml.push(`<tr class="${rowClass}" data-queue-index="${hasQueueIndex ? queueIndex : ''}">
            <td><span class="material-icons-round" style="font-size:18px;color:${statusColor}">${statusIcon}</span></td>
            <td class="queue-rank">${item.position !== null ? item.position : '—'}</td>
            <td class="queue-est-time">${item.estimated_time || '—'}</td>
            <td class="queue-title">${stageChip}${titleText}${virtualContext}${adBreakNote}</td>
            <td class="queue-artist">${artistText}</td>
            <td class="queue-dur">${dur}</td>
            <td><span class="badge ${typeBadge}">${item.track_type || 'music'}</span></td>
            <td class="queue-actions">
                <button class="btn-sm" onclick="moveQueueItem(${queueIndex}, ${queueIndex - 1})" title="Up" ${!hasQueueIndex || queueIndex === 0 ? 'disabled' : ''}>
                    <span class="material-icons-round">arrow_upward</span>
                </button>
                <button class="btn-sm" onclick="moveQueueItem(${queueIndex}, ${queueIndex + 1})" title="Down" ${!hasQueueIndex || queueIndex >= (Number(data.total || 0) - 1) ? 'disabled' : ''}>
                    <span class="material-icons-round">arrow_downward</span>
                </button>
                <button class="btn-sm" onclick="removeQueueItem(${queueIndex})" title="Remove from Queue" style="color:var(--red)" ${!hasQueueIndex ? 'disabled' : ''}>
                    <span class="material-icons-round">close</span>
                </button>
            </td>
        </tr>`);
    });

    tbody.innerHTML = rowsHtml.join('');
    renderProgramMiniQueue();
}

async function loadQueue() {
    try {
        const data = await apiFetch(`${API_BASE}/api/queue?station_id=${currentState.currentStationId}`);
        applyQueueSnapshot(data);
    } catch (e) {
        console.error("Queue load failed:", e);
    }
}

async function moveQueueItem(fromIndex, toIndex) {
    try {
        await apiFetch(`${API_BASE}/api/queue/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_index: fromIndex, to_index: toIndex, station_id: currentState.currentStationId })
        });
        await loadQueue();
    } catch (e) {
        showToast("Queue order could not be changed", "error");
    }
}

async function removeQueueItem(queueIndex) {
    try {
        await apiFetch(`${API_BASE}/api/queue/${queueIndex}?station_id=${currentState.currentStationId}`, { method: 'DELETE' });
        showToast("Track removed from queue");
        await loadQueue();
    } catch (e) {
        showToast("Could not remove", "error");
    }
}

// ... (STATION MANAGEMENT) ...

const runtimeIndicatorApi = window.CleanroomRuntimeIndicator || null;
const ENGINE_STATUS_GRACE_MS = Number(
    runtimeIndicatorApi?.DEFAULT_ENGINE_ALIVE_GRACE_MS || 2000
);
let _runtimeIndicatorState = runtimeIndicatorApi?.createRuntimeIndicatorState
    ? runtimeIndicatorApi.createRuntimeIndicatorState()
    : { stationId: null, lastAliveAtMs: 0, displayAlive: false, lastObservedAlive: null };

function resolveDisplayedEngineAlive(engineAlive, stationId = null) {
    const sid = Number(stationId || currentState.currentStationId || 0);
    if (!runtimeIndicatorApi?.applyRuntimeIndicatorSample) {
        return Boolean(engineAlive);
    }
    _runtimeIndicatorState = runtimeIndicatorApi.applyRuntimeIndicatorSample(
        _runtimeIndicatorState,
        {
            stationId: sid,
            observedAlive: engineAlive,
            nowMs: Date.now(),
            graceMs: ENGINE_STATUS_GRACE_MS,
        }
    );
    return Boolean(_runtimeIndicatorState.displayAlive);
}

function updateHeaderRuntimeInfo({ engineAlive = null, tracksInLibrary = null, stationId = null } = {}) {
    const displayEngineAlive = resolveDisplayedEngineAlive(engineAlive, stationId);
    const engineEl = document.getElementById('engineStatus');
    if (engineEl) {
        engineEl.classList.remove('connected', 'disconnected');
        engineEl.classList.add(displayEngineAlive ? 'connected' : 'disconnected');

        const iconEl = engineEl.querySelector('.material-icons-round');
        if (iconEl) iconEl.textContent = displayEngineAlive ? 'power' : 'power_off';

        const spans = engineEl.querySelectorAll('span');
        const labelEl = spans.length ? spans[spans.length - 1] : null;
        if (labelEl) labelEl.textContent = displayEngineAlive ? 'Engine On' : 'Engine Off';
    }

    const liveBadge = document.getElementById('liveBadge');
    if (liveBadge) {
        liveBadge.style.opacity = displayEngineAlive ? '1' : '0.45';
        liveBadge.style.filter = displayEngineAlive ? 'none' : 'grayscale(1)';
        const spans = liveBadge.querySelectorAll('span');
        const labelEl = spans.length ? spans[spans.length - 1] : null;
        if (labelEl) labelEl.textContent = displayEngineAlive ? 'ON AIR' : 'OFF AIR';
    }

    const countEl = document.getElementById('trackCount');
    if (countEl && Number.isFinite(tracksInLibrary)) {
        countEl.textContent = String(Math.max(0, Math.trunc(Number(tracksInLibrary) || 0)));
    }

    return displayEngineAlive;
}

function healthSnapshotShowsEngineAlive() {
    const health = currentState.health || {};
    const runtime = health.runtime || {};
    const runtimeBranchHealth = health.runtime_branch_health || runtime.branch_health || {};
    return Boolean(
        health.engine_running ||
        health.liquidsoap_connected ||
        runtime.running ||
        runtime.program_running ||
        runtime.output_feed_active ||
        runtimeBranchHealth.icecast
    );
}

function healthSnapshotShowsEngineStopped() {
    const health = currentState.health || {};
    if (!Object.keys(health).length) return false;
    return !healthSnapshotShowsEngineAlive();
}

function applyHealthSnapshot(data) {
    currentState.health = data || {};
    const requestedStationId = Number(data?.station_id || currentState.currentStationId || 0);
    const activeSid = Number(data?.active_station_id || 0);
    if (Number.isInteger(activeSid) && activeSid > 0) {
        currentState.activeBroadcastStationId = activeSid;
    }
    updateHeaderRuntimeInfo({
        engineAlive: Boolean(data?.engine_running || data?.liquidsoap_connected),
        tracksInLibrary: Number(data?.tracks_in_library || 0),
        stationId: requestedStationId,
    });
}

async function refreshHealth() {
    try {
        const res = await fetch(`${API_BASE}/api/health?station_id=${currentState.currentStationId}`);
        if (!res.ok) throw new Error(`health ${res.status}`);
        const data = await res.json();
        applyHealthSnapshot(data);
    } catch (e) {
        updateHeaderRuntimeInfo({
            engineAlive: null,
            tracksInLibrary: Number(currentState.health?.tracks_in_library || 0),
            stationId: Number(currentState.currentStationId || 0),
        });
    }
}

let _lastPlayingTitle = '';
let _statusRequestSeq = 0;
let _statusAppliedSeq = 0;
let _statusRequestInFlight = false;
let _deckGapSinceMs = 0;
const DECK_METADATA_GAP_HOLD_MS = 4500;
let _onAirClock = { title: '', artist: '', total: 0, remaining: 0, elapsed: 0, ts: Date.now() / 1000 };
let _deckClockRafId = 0;
// Smooth deck-A clock renderer — runs every animation frame
function renderDeckAClock() {
    _deckClockRafId = requestAnimationFrame(renderDeckAClock);
    const timeEl = document.getElementById('deckATime');
    const progressEl = document.getElementById('deckAProgress');
    if (!timeEl && !progressEl) return;

    const clock = _onAirClock;
    if (!clock.title) return; // nothing playing

    const nowSec = Date.now() / 1000;
    const delta = Math.max(0, nowSec - (clock.ts || nowSec));
    const total = clock.total || 0;
    let elapsed = Math.max(0, (clock.elapsed || 0) + delta);
    if (total > 0) elapsed = Math.min(total, elapsed);

    if (timeEl) {
        const newText = total > 0
            ? `${formatDuration(elapsed)} / ${formatDuration(total)}`
            : (elapsed > 0 ? `${formatDuration(elapsed)} / --:--` : '00:00 / 00:00');
        if (timeEl.textContent !== newText) timeEl.textContent = newText;
    }
    if (progressEl) {
        const pct = total > 0 ? `${Math.max(0, Math.min(100, (elapsed / total) * 100))}%` : '0%';
        if (progressEl.style.width !== pct) progressEl.style.width = pct;
    }
}
requestAnimationFrame(renderDeckAClock);

function buildOnAirTrackKey(track) {
    if (!track) return '';
    const title = normalizeTrackCompareText(track.title || '');
    const artist = normalizeTrackCompareText(track.artist || '');
    if (!title && !artist) return '';
    return `${title}|${artist}`;
}

async function applyStatusSnapshot(data, options = {}) {
    const requestedStationId = Number(
        options.requestedStationId || data?.station_id || currentState.currentStationId || 1
    );
    const activeSid = Number(data?.active_station_id || 0);
    if (Number.isInteger(activeSid) && activeSid > 0) {
        currentState.activeBroadcastStationId = activeSid;
    }
    const statusAlive = Boolean(data?.alive || data?.engine_running || data?.liquidsoap_connected);
    const healthAlive = healthSnapshotShowsEngineAlive();
    const displayEngineAlive = updateHeaderRuntimeInfo({
        engineAlive: Boolean(statusAlive || healthAlive),
        tracksInLibrary: Number(currentState.health?.tracks_in_library || 0),
        stationId: requestedStationId,
    });
    const statusDataForUi = (!statusAlive && displayEngineAlive)
        ? { ...data, alive: true }
        : data;
    if (typeof data?.program_music_mode === 'string') {
        currentState.programMusicMode = normalizeProgramMusicMode(data.program_music_mode);
        syncProgramMusicModeUi();
    }
    currentState.programQueueSource = normalizeProgramQueueSource(
        data?.program_queue_source || currentState.programQueueSource
    );
    currentState.programQueueEffectiveSource = normalizeProgramQueueSource(
        data?.program_queue_effective_source || currentState.programQueueEffectiveSource
    );
    currentState.programQueueFallbackActive =
        currentState.programQueueSource !== currentState.programQueueEffectiveSource;
    currentState.currentTrack = data?.current_track || null;
    if (isProgramLiveWorkspaceActive()) {
        renderProgramQueueSourceUi();
    }
    if (displayEngineAlive) {
        await updateOnAirInfo(statusDataForUi);
        const nowTitle = (data?.current_track && data.current_track.title) || (data?.metadata && data.metadata.title) || '';
        if (data?.alive && nowTitle && nowTitle !== _lastPlayingTitle) {
            _lastPlayingTitle = nowTitle;
            loadQueue();
        }
        return;
    }
    _lastPlayingTitle = '';
    _deckGapSinceMs = 0;
    _onAirClock = { title: '', artist: '', total: 0, remaining: 0, elapsed: 0, ts: Date.now() / 1000 };
    await updateOnAirInfo(null);
}

function buildQueueStatusFallback(data, requestedStationId) {
    const items = Array.isArray(data?.items) ? data.items : [];
    const current = items.find(item => item?.is_current || item?.status === 'playing');
    if (!current) return null;
    const duration = Number.parseFloat(current.duration || 0);
    const currentTrack = {
        id: Number(current.track_id || current.id || 0),
        title: current.title || 'Untitled Track',
        artist: current.artist || '',
        album: current.album || '',
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
        track_type: current.track_type || 'music',
        cover_art_url: current.cover_art_url || '',
    };
    return {
        alive: true,
        status: 'active',
        station_id: requestedStationId,
        active_station_id: Number(currentState.activeBroadcastStationId || requestedStationId || 0),
        current_track: currentTrack,
        metadata: { ...currentTrack },
        elapsed: 0,
        remaining: currentTrack.duration,
        engine_running: true,
        liquidsoap_connected: true,
        program_music_mode: currentState.programMusicMode,
        program_queue_source: currentState.programQueueSource,
        program_queue_effective_source: currentState.programQueueEffectiveSource,
        program_queue_total: Number(data?.total || items.length || 0),
    };
}

async function applyQueueStatusFallback(requestedStationId) {
    const data = await apiFetch(`${API_BASE}/api/queue?station_id=${requestedStationId}`);
    applyQueueSnapshot(data);
    const fallbackStatus = buildQueueStatusFallback(data, requestedStationId);
    if (!fallbackStatus) return false;
    await applyStatusSnapshot(fallbackStatus, { requestedStationId });
    return true;
}

async function refreshStatus() {
    if (_statusRequestInFlight) return;
    _statusRequestInFlight = true;
    const requestedStationId = Number(currentState.currentStationId || 1);
    const requestedShowId = getCurrentProgramActionShowId();
    const canReadStationRuntime = hasPermission('stations.view') || hasPermission('stations.edit');
    const canReadClaimedProgramRuntime = (
        requestedShowId > 0
        && Number(currentState.activeShowSession?.show_id || 0) === 0
        && Number(currentState.programWorkspaceClaimedShowId || 0) === requestedShowId
    );
    if (!canReadStationRuntime && !(requestedShowId > 0 && (Number(currentState.activeShowSession?.show_id || 0) > 0 || canReadClaimedProgramRuntime))) {
        _statusRequestInFlight = false;
        return;
    }
    const reqSeq = ++_statusRequestSeq;
    let timeoutId = null;
    try {
        const abortController = new AbortController();
        timeoutId = setTimeout(() => abortController.abort(), 3500);
        const params = new URLSearchParams({ station_id: String(requestedStationId) });
        if (requestedShowId > 0) {
            params.set('show_id', String(requestedShowId));
        }
        const data = await apiFetch(
            `${API_BASE}/api/liquidsoap/status?${params.toString()}`,
            { signal: abortController.signal }
        );
        clearTimeout(timeoutId);
        timeoutId = null;
        if (reqSeq < _statusAppliedSeq) return;
        if (Number(currentState.currentStationId || 0) !== requestedStationId) return;
        _statusAppliedSeq = reqSeq;
        await applyStatusSnapshot(data, { requestedStationId });
    } catch (e) {
        if (reqSeq < _statusAppliedSeq) return;
        if (Number(currentState.currentStationId || 0) !== requestedStationId) return;
        const healthAlive = healthSnapshotShowsEngineAlive();
        const displayEngineAlive = updateHeaderRuntimeInfo({
            engineAlive: healthAlive ? true : null,
            tracksInLibrary: Number(currentState.health?.tracks_in_library || 0),
            stationId: requestedStationId,
        });
        if (!healthSnapshotShowsEngineStopped()) {
            try {
                const appliedFallback = await applyQueueStatusFallback(requestedStationId);
                if (appliedFallback) return;
            } catch (fallbackError) {
                console.warn("Queue status fallback failed:", fallbackError);
            }
        }
        if (!displayEngineAlive) {
            _lastPlayingTitle = '';
            _deckGapSinceMs = 0;
            _onAirClock = { title: '', artist: '', total: 0, remaining: 0, elapsed: 0, ts: Date.now() / 1000 };
            updateOnAirInfo(null);
        }
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        _statusRequestInFlight = false;
    }
}

async function refreshNextTrack() {
    try {
        const data = await apiFetch(`${API_BASE}/api/tracks/next?station_id=${currentState.currentStationId}`);
        if (data.id) {
            currentState.nextTrack = data;
            const titleEl = document.getElementById('deckBTitle');
            const artistEl = document.getElementById('deckBArtist');
            if (titleEl) titleEl.textContent = data.title || "Untitled Track";
            if (artistEl) artistEl.textContent = data.artist || "Unknown Artist";
        }
    } catch (e) { }
}

async function updateOnAirInfo(statusData) {
    try {
        let current = null;
        const nowSec = Date.now() / 1000;
        const nowMs = Date.now();

        if (statusData && statusData.current_track) {
            current = {
                title: statusData.current_track.title,
                artist: statusData.current_track.artist,
                duration: parseFloat(statusData.current_track.duration || 0)
            };
        } else if (statusData && statusData.metadata && statusData.metadata.title) {
            current = {
                title: statusData.metadata.title,
                artist: statusData.metadata.artist,
                duration: parseFloat(statusData.metadata.duration || 0)
            };
        }

        const titleEl = document.getElementById('deckATitle');
        const artistEl = document.getElementById('deckAArtist');

        if (!current) {
            // During crossfade/track switch, metadata can be empty for a short moment.
            // Hold last known deck state instead of flashing "Loading...".
            if (statusData && statusData.alive && _onAirClock.title) {
                if (!_deckGapSinceMs) _deckGapSinceMs = nowMs;
                if ((nowMs - _deckGapSinceMs) <= DECK_METADATA_GAP_HOLD_MS) {
                    // Keep _onAirClock as-is; renderDeckAClock will interpolate smoothly
                    if (titleEl) titleEl.textContent = repairMojibakeText(_onAirClock.title, 'Loading...');
                    if (artistEl) artistEl.textContent = repairMojibakeText(_onAirClock.artist, '-');
                    return;
                }
            }
            _deckGapSinceMs = 0;
            _onAirClock = { title: '', artist: '', total: 0, remaining: 0, elapsed: 0, ts: nowSec };
            if (titleEl) titleEl.textContent = 'Loading...';
            if (artistEl) artistEl.textContent = '-';
            return;
        }
        _deckGapSinceMs = 0;

        const displayTitle = repairMojibakeText(current.title, current.title || 'Untitled Track');
        const displayArtist = repairMojibakeText(current.artist, current.artist || 'Unknown Artist');
        if (titleEl) titleEl.textContent = displayTitle || 'Untitled Track';
        if (artistEl) artistEl.textContent = displayArtist || 'Unknown Artist';

        const total = resolveDeckTotalDuration(current, statusData);
        const backendRemainingRaw = parseFloat((statusData && statusData.remaining) || 0);
        const backendElapsedRaw = Number.parseFloat((statusData && statusData.elapsed) ?? NaN);
        const backendElapsed = Number.isFinite(backendElapsedRaw) && backendElapsedRaw >= 0
            ? backendElapsedRaw
            : null;

        // Determine the backend's best-guess elapsed value
        let backendBestElapsed = null;
        if (total > 0) {
            if (Number.isFinite(backendRemainingRaw) && backendRemainingRaw > 0) {
                backendBestElapsed = Math.max(0, total - backendRemainingRaw);
            } else if (backendElapsed !== null) {
                backendBestElapsed = Math.min(total, backendElapsed);
            }
        } else if (backendElapsed !== null) {
            backendBestElapsed = backendElapsed;
        }

        const FORWARD_DRIFT_THRESHOLD = 2.0;
        const BACKWARD_DRIFT_THRESHOLD = 4.0;
        const incomingTrackKey = buildOnAirTrackKey(current);
        const clockTrackKey = buildOnAirTrackKey(_onAirClock);
        const isSameTrack = incomingTrackKey
            ? incomingTrackKey === clockTrackKey
            : _onAirClock.title === (current.title || '');

        if (total > 0) {
            let elapsed;
            if (isSameTrack && _onAirClock.total > 0) {
                // Smoothly interpolate from the last known position using local clock
                const localElapsed = Math.max(0, (_onAirClock.elapsed || 0) + (nowSec - _onAirClock.ts));
                elapsed = Math.min(total, localElapsed);

                // Use asymmetric drift thresholds: tolerate small backward jitter, quickly catch forward jumps.
                if (backendBestElapsed !== null) {
                    const drift = backendBestElapsed - elapsed;
                    if (drift > FORWARD_DRIFT_THRESHOLD || drift < -BACKWARD_DRIFT_THRESHOLD) {
                        elapsed = backendBestElapsed;
                    }
                }
            } else {
                // New track — seed from backend or start at 0
                elapsed = backendBestElapsed !== null ? backendBestElapsed : 0;
            }

            const remaining = Math.max(0, total - elapsed);
            _onAirClock = {
                title: current.title || '',
                artist: current.artist || '',
                total: total,
                remaining: remaining,
                elapsed: elapsed,
                ts: nowSec
            };
            // DOM update is handled by renderDeckAClock (requestAnimationFrame)
        } else {
            let elapsedUnknown;
            if (isSameTrack) {
                const localElapsed = Math.max(0, (_onAirClock.elapsed || 0) + (nowSec - _onAirClock.ts));
                elapsedUnknown = localElapsed;
                if (backendBestElapsed !== null) {
                    const drift = backendBestElapsed - elapsedUnknown;
                    if (drift > FORWARD_DRIFT_THRESHOLD || drift < -BACKWARD_DRIFT_THRESHOLD) {
                        elapsedUnknown = backendBestElapsed;
                    }
                }
            } else {
                elapsedUnknown = backendBestElapsed !== null ? backendBestElapsed : 0;
            }
            _onAirClock = {
                title: current.title || '',
                artist: current.artist || '',
                total: 0,
                remaining: 0,
                elapsed: elapsedUnknown,
                ts: nowSec
            };
            // DOM update is handled by renderDeckAClock (requestAnimationFrame)
        }

    } catch (e) {
        console.error('updateOnAirInfo failed', e);
    }
}

// ============================================
// ACTIONS
// ============================================

async function skipTrack() {
    try {
        const stationId = Number(currentState.currentStationId || 1);
        const params = new URLSearchParams({ station_id: String(stationId) });
        const showId = getCurrentProgramActionShowId();
        if (showId > 0) {
            params.set('show_id', String(showId));
        }
        await apiFetch(`${API_BASE}/api/liquidsoap/skip?${params.toString()}`, { method: 'POST' });
        showToast("Track skipped");
        setTimeout(async () => {
            await loadQueue();
            await refreshStatus();
        }, 450);
    } catch (e) {
        showToast("Skip failed!", "error");
    }
}

async function toggleDuck() {
    await activateProgramTalkMode();
}

async function triggerScan() {
    showToast("Scanning library...");
    try {
        const data = await apiFetch(`${API_BASE}/api/scanner/scan?station_id=${currentState.currentStationId}`, { method: 'POST' });
        const totalAdded = Number(data?.results?.music?.added || 0) + Number(data?.results?.jingles?.added || 0) + Number(data?.results?.ads?.added || 0);
        showToast(`Scan complete: ${totalAdded} new file(s).`);
        refreshHealth();
        if (currentState.panel === 'library') loadLibrary();
        loadCartwall();
    } catch (e) {
        showToast("Scan failed!", "error");
    }
}

async function normalizeLibraryMetadata() {
    showToast("Running metadata auto-fix...");
    try {
        const scopeParams = buildLibraryScopeParams();
        const selectedScope = String(scopeParams.library_scope || 'local');
        const useItunes = !!document.getElementById('metadataUseItunes')?.checked;
        const countryRaw = String(document.getElementById('metadataItunesCountry')?.value || 'TR').trim().toUpperCase();
        const confidenceRaw = Number(document.getElementById('metadataItunesConfidence')?.value || 0.88);
        const itunesCountry = countryRaw || 'TR';
        const itunesConfidence = Number.isFinite(confidenceRaw) ? confidenceRaw : 0.88;

        const data = await apiFetch(`${API_BASE}/api/library/metadata/autofix`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                station_id: currentState.currentStationId,
                analyze_bpm: true,
                limit: 0,
                library_scope: selectedScope,
                source_station_id: scopeParams.source_station_id || null,
                auto_seed_rules: true,
                rule_scope: selectedScope === 'all' ? 'global' : 'station',
                verify_with_itunes: useItunes,
                itunes_country: itunesCountry,
                itunes_min_confidence: itunesConfidence,
                itunes_track_type: 'music',
            })
        });

        const summary = data?.summary || {};
        const seed = data?.rule_seed || {};
        const itunes = data?.itunes_verify || {};
        const updated = Number(summary.updated || 0);
        const bpmUpdated = Number(summary.bpm_updated || 0);
        const errors = Number(summary.errors || 0);
        const ruleHits = Number(summary.metadata_rule_hits || 0);
        const rulesCreated = Number(seed.created || 0);
        const rulesReactivated = Number(seed.reactivated || 0);
        const rulesDeactivated = Number(seed.deactivated_station_duplicates || 0);
        const itunesUpdated = Number(itunes.updated || 0);
        const itunesMatched = Number(itunes.matched || 0);
        const itunesLow = Number(itunes.low_confidence || 0);
        const stationCount = Array.isArray(data?.library_station_ids) ? data.library_station_ids.length : 1;
        const scope = String(data?.library_scope || scopeParams.library_scope || 'local');
        const itunesText = useItunes
            ? `, iTunes upd:${itunesUpdated}/${itunesMatched}, low:${itunesLow}`
            : '';
        const resultText = `Auto-fix: ${updated} track(s), BPM:${bpmUpdated}, rule hits:${ruleHits}, rules+${rulesCreated}/${rulesReactivated}, dup-off:${rulesDeactivated}${itunesText}, errors:${errors} [scope:${scope}, stations:${stationCount}]`;
        showToast(resultText);
        setMetadataRuleResult(resultText, errors > 0 ? 'error' : 'success');
        await loadMetadataRules();
        await loadLibrary(currentState.currentPage || 1);
    } catch (e) {
        showToast("Metadata auto-fix failed", "error");
        setMetadataRuleResult('Metadata auto-fix failed.', 'error');
    }
}

async function analyzeLibraryBpm() {
    showToast("Analyzing BPM values...");
    try {
        const data = await apiFetch(`${API_BASE}/api/library/bpm/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                station_id: currentState.currentStationId,
                only_missing: true,
                track_type: 'music',
                limit: 0
            })
        });

        const summary = data?.summary || {};
        const bpmUpdated = Number(summary.bpm_updated || 0);
        const analyzed = Number(summary.analyzed || 0);
        const skipped = Number(summary.skipped || 0);
        showToast(`BPM analysis complete: ${bpmUpdated} updated, ${analyzed} analyzed, ${skipped} skipped.`);
        await loadLibrary(currentState.currentPage || 1);
    } catch (e) {
        showToast("BPM analysis failed", "error");
    }
}

async function triggerScanAndTrim() {
    showToast("Scanning and cleaning intros/silence...");
    try {
        const folder = String(document.getElementById('scanFolderPath')?.value || '').trim();
        const recursive = document.getElementById('scanFolderRecursive')?.checked !== false;
        const params = new URLSearchParams({
            station_id: String(currentState.currentStationId || 1),
            recursive: String(recursive),
            trim_silence: 'true',
            clean_intro: 'true',
        });
        if (folder) params.set('folder', folder);
        const data = await apiFetch(
            `${API_BASE}/api/scanner/scan?${params.toString()}`,
            { method: 'POST' }
        );

        const totalAdded = Number(data?.results?.music?.added || 0) + Number(data?.results?.jingles?.added || 0) + Number(data?.results?.ads?.added || 0);
        const trimSummary = data?.trim || {};
        const trimmed = Number(trimSummary?.trimmed || 0);
        const removedSec = Number(trimSummary?.removed_seconds_total || 0);
        const introSummary = data?.intro_clean || {};
        const introCleaned = Number(introSummary?.cleaned || 0);
        const introRemoved = Number(introSummary?.removed_seconds_total || 0);

        showToast(`Scan complete: ${totalAdded} added, silence:${trimmed} (${removedSec.toFixed(1)}s), intro:${introCleaned} (${introRemoved.toFixed(1)}s).`);
        refreshHealth();
        await loadLibrary(currentState.currentPage || 1);
        await loadCartwall();
    } catch (e) {
        showToast("Scan clean failed!", "error");
    }
}

function trimTrackSilence(trackId, title = '', artist = '', filePath = '') {
    openAudioToolsModal(trackId, title, artist, filePath, 'auto');
    setAudioToolsStatus('Use the Auto Silence Trim card and click Apply Auto Trim.', 'ok');
}

async function trimFilteredTracks() {
    const trackType = document.getElementById('filterType')?.value || 'any';
    const scopeText = trackType && trackType !== 'any' ? trackType : 'all visible types';
    if (!confirm(`Trim start/end silence for ${scopeText}?`)) return;

    try {
        const data = await apiFetch(`${API_BASE}/api/tracks/trim/silence/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                station_id: currentState.currentStationId,
                track_type: trackType || 'any',
                only_untrimmed: true,
                only_imports: false,
                limit: 500
            })
        });

        const summary = data?.summary || {};
        const trimmed = Number(summary?.trimmed || 0);
        const failed = Number(summary?.failed || 0);
        const removed = Number(summary?.removed_seconds_total || 0);
        showToast(`Batch trim: ${trimmed} trimmed, ${failed} failed (${removed.toFixed(1)}s removed).`);
        await loadLibrary(currentState.currentPage || 1);
    } catch (e) {
        showToast('Batch trim failed', 'error');
    }
}

function formatAudioToolsTime(seconds, showCents = true) {
    const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const totalCent = Math.floor(safe * 100);
    const mins = Math.floor(totalCent / 6000);
    const secs = Math.floor((totalCent % 6000) / 100);
    const cent = totalCent % 100;
    if (!showCents) {
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cent).padStart(2, '0')}`;
}

function getAudioToolsPlayer() {
    return document.getElementById('audioToolsPlayer');
}

function setAudioToolsStatus(text, kind = 'info') {
    const el = document.getElementById('audioToolsStatus');
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('status-error', 'status-ok');
    if (kind === 'error') el.classList.add('status-error');
    if (kind === 'ok') el.classList.add('status-ok');
}

function setAudioToolsSelectionLabel() {
    const label = document.getElementById('audioToolsSelectionLabel');
    const start = Number(audioToolsState.selectionStart || 0);
    const end = Number(audioToolsState.selectionEnd || 0);
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    if (label) label.textContent = `Selection: ${from.toFixed(2)}s - ${to.toFixed(2)}s`;

    const hint = document.getElementById('manualTrimSelectionHint');
    if (hint) {
        const duration = Number(audioToolsState.duration || getAudioToolsPlayer()?.duration || 0);
        const len = Math.max(0, to - from);
        if (duration > 0 && len > 0.03) {
            const startCut = Math.max(0, from);
            const endCut = Math.max(0, duration - to);
            hint.textContent = `Selection length ${len.toFixed(2)}s. Manual trim will cut ${startCut.toFixed(2)}s head and ${endCut.toFixed(2)}s tail.`;
        } else {
            hint.textContent = 'Select a range on waveform to enable trim.';
        }
    }
}

function setAudioToolsTimeLabel() {
    const label = document.getElementById('audioToolsTime');
    if (!label) return;
    const player = getAudioToolsPlayer();
    const current = Number(player?.currentTime || 0);
    const duration = Number(audioToolsState.duration || player?.duration || 0);
    label.textContent = `${formatAudioToolsTime(current, false)} / ${formatAudioToolsTime(duration, false)}`;
}

function normalizeMediaUrl(filePath) {
    if (!filePath) return '';
    const normalizedPath = String(filePath).replace(/\\/g, '/');
    const mediaIndex = normalizedPath.toLowerCase().indexOf('/media/');
    if (mediaIndex === -1) return '';
    const relativePath = normalizedPath.substring(mediaIndex + 7).replace(/^\/+/, '');
    if (!relativePath) return '';
    return `/api/media/${relativePath.split('/').map(part => encodeURIComponent(part)).join('/')}`;
}

function getTrackPathFromState(trackId) {
    const item = (currentState.tracks || []).find(t => Number(t.id) === Number(trackId));
    return item?.file_path ? String(item.file_path).replace(/\\/g, '/') : '';
}

function clampAudioToolsTime(sec) {
    const duration = Number(audioToolsState.duration || 0);
    if (!Number.isFinite(sec)) return 0;
    if (!duration) return Math.max(0, sec);
    return Math.max(0, Math.min(duration, sec));
}

function getAudioToolsViewport() {
    const duration = Number(audioToolsState.duration || 0);
    if (!duration) return { start: 0, end: 0, span: 0 };

    const zoom = Math.max(1, Math.min(8, Number(audioToolsState.zoom || 1)));
    const minSpan = Math.min(6, duration);
    let span = zoom <= 1 ? duration : Math.max(duration / zoom, minSpan);
    span = Math.min(duration, span);

    const maxStart = Math.max(0, duration - span);
    const start = Math.max(0, Math.min(Number(audioToolsState.viewportStart || 0), maxStart));

    audioToolsState.zoom = zoom;
    audioToolsState.viewportDuration = span;
    audioToolsState.viewportStart = start;
    return { start, end: start + span, span };
}

function keepPlayheadVisibleInViewport(playheadSec) {
    if (Number(audioToolsState.zoom || 1) <= 1) return;
    const { start, end, span } = getAudioToolsViewport();
    if (!span) return;

    const leftPad = span * 0.12;
    const rightPad = span * 0.12;
    if (playheadSec >= start + leftPad && playheadSec <= end - rightPad) return;

    const duration = Number(audioToolsState.duration || 0);
    const maxStart = Math.max(0, duration - span);
    const desiredStart = playheadSec - (span * 0.5);
    audioToolsState.viewportStart = Math.max(0, Math.min(desiredStart, maxStart));
}

function resizeWaveCanvas() {
    const canvas = document.getElementById('audioWaveformCanvas');
    if (!canvas) return { canvas: null, ctx: null };

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(320, Math.floor(rect.width * dpr));
    const height = Math.max(120, Math.floor((rect.height || 220) * dpr));
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }

    return { canvas, ctx: canvas.getContext('2d') };
}

function drawWaveGrid(ctx, width, height) {
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 10; i++) {
        const x = Math.floor((i / 10) * width) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }

    const mid = Math.floor(height / 2) + 0.5;
    ctx.strokeStyle = 'rgba(141,163,197,0.45)';
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();
}

function drawAudioWaveform() {
    const { canvas, ctx } = resizeWaveCanvas();
    if (!canvas || !ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#0f1726');
    bg.addColorStop(1, '#0a111c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    drawWaveGrid(ctx, width, height);

    const duration = Number(audioToolsState.duration || 0);
    const peaks = audioToolsState.waveformPeaks || [];
    const player = getAudioToolsPlayer();
    const playhead = clampAudioToolsTime(Number(player?.currentTime || 0));
    const { start, span } = getAudioToolsViewport();

    const selFrom = Math.min(Number(audioToolsState.selectionStart || 0), Number(audioToolsState.selectionEnd || 0));
    const selTo = Math.max(Number(audioToolsState.selectionStart || 0), Number(audioToolsState.selectionEnd || 0));
    if (span > 0 && selTo > selFrom) {
        const x1 = Math.max(0, Math.min(width, ((selFrom - start) / span) * width));
        const x2 = Math.max(0, Math.min(width, ((selTo - start) / span) * width));
        const fillX = Math.min(x1, x2);
        const fillW = Math.abs(x2 - x1);
        if (fillW > 0) {
            ctx.fillStyle = 'rgba(0, 212, 255, 0.20)';
            ctx.fillRect(fillX, 0, fillW, height);
        }
    }

    if (duration > 0 && peaks.length > 0 && span > 0) {
        const totalPeaks = peaks.length;
        const startIndex = Math.max(0, Math.floor((start / duration) * totalPeaks));
        const endIndex = Math.max(startIndex + 1, Math.ceil(((start + span) / duration) * totalPeaks));
        const visibleCount = endIndex - startIndex;
        const center = height / 2;

        ctx.strokeStyle = '#3ee3ff';
        ctx.lineWidth = 1;

        for (let x = 0; x < width; x++) {
            const from = startIndex + Math.floor((x / width) * visibleCount);
            const to = Math.min(endIndex - 1, startIndex + Math.floor(((x + 1) / width) * visibleCount));
            let peak = 0;
            for (let i = from; i <= to; i++) {
                const val = Number(peaks[i] || 0);
                if (val > peak) peak = val;
            }

            const amp = Math.max(1, peak * (height * 0.44));
            ctx.beginPath();
            ctx.moveTo(x + 0.5, center - amp);
            ctx.lineTo(x + 0.5, center + amp);
            ctx.stroke();
        }

        if (playhead >= start && playhead <= start + span) {
            const playX = ((playhead - start) / span) * width;
            ctx.strokeStyle = '#ff7a7a';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(playX, 0);
            ctx.lineTo(playX, height);
            ctx.stroke();
        }
    }

    setAudioToolsTimeLabel();
    setAudioToolsSelectionLabel();
}

function audioToolsSecondsFromPointer(clientX) {
    const canvas = document.getElementById('audioWaveformCanvas');
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return 0;

    const clampedX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const { start, span } = getAudioToolsViewport();
    if (!span) return 0;
    return clampAudioToolsTime(start + (clampedX / rect.width) * span);
}

function bindAudioToolsCanvas() {
    const canvas = document.getElementById('audioWaveformCanvas');
    if (!canvas || audioToolsState.canvasBound) return;

    canvas.addEventListener('pointerdown', (e) => {
        if (!audioToolsState.trackId) return;
        const pointerTime = audioToolsSecondsFromPointer(e.clientX);
        audioToolsState.selecting = true;
        audioToolsState.selectionAnchor = pointerTime;
        audioToolsState.selectionStart = pointerTime;
        audioToolsState.selectionEnd = pointerTime;
        canvas.setPointerCapture(e.pointerId);
        drawAudioWaveform();
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!audioToolsState.selecting) return;
        const pointerTime = audioToolsSecondsFromPointer(e.clientX);
        audioToolsState.selectionStart = Math.min(audioToolsState.selectionAnchor, pointerTime);
        audioToolsState.selectionEnd = Math.max(audioToolsState.selectionAnchor, pointerTime);
        drawAudioWaveform();
    });

    const stopSelection = (e) => {
        if (!audioToolsState.selecting) return;
        const pointerTime = audioToolsSecondsFromPointer(e.clientX);
        const anchor = Number(audioToolsState.selectionAnchor || 0);
        const from = Math.min(anchor, pointerTime);
        const to = Math.max(anchor, pointerTime);

        audioToolsState.selecting = false;
        audioToolsState.selectionStart = from;
        audioToolsState.selectionEnd = to;

        if (Math.abs(to - from) < 0.03) {
            const player = getAudioToolsPlayer();
            if (player) player.currentTime = pointerTime;
        }
        drawAudioWaveform();
    };

    canvas.addEventListener('pointerup', stopSelection);
    canvas.addEventListener('pointercancel', stopSelection);
    window.addEventListener('resize', () => {
        if (document.getElementById('audioToolsModal')?.style.display === 'flex') {
            drawAudioWaveform();
        }
    });

    audioToolsState.canvasBound = true;
}

function stopAudioToolsRenderLoop() {
    if (audioToolsState.rafId) {
        cancelAnimationFrame(audioToolsState.rafId);
        audioToolsState.rafId = null;
    }
}

function startAudioToolsRenderLoop() {
    stopAudioToolsRenderLoop();
    const tick = () => {
        const player = getAudioToolsPlayer();
        if (!player || player.paused) {
            audioToolsState.rafId = null;
            drawAudioWaveform();
            return;
        }
        keepPlayheadVisibleInViewport(Number(player.currentTime || 0));
        drawAudioWaveform();
        audioToolsState.rafId = requestAnimationFrame(tick);
    };
    audioToolsState.rafId = requestAnimationFrame(tick);
}

function bindAudioToolsPlayer() {
    const player = getAudioToolsPlayer();
    if (!player || audioToolsState.playerBound) return;

    player.addEventListener('loadedmetadata', () => {
        const duration = Number(player.duration || 0);
        if (duration > 0 && (!audioToolsState.duration || audioToolsState.duration <= 0)) {
            audioToolsState.duration = duration;
            setAudioToolsZoom(audioToolsState.zoom || 1);
        } else {
            setAudioToolsTimeLabel();
            drawAudioWaveform();
        }
    });

    player.addEventListener('timeupdate', () => {
        keepPlayheadVisibleInViewport(Number(player.currentTime || 0));
        if (!audioToolsState.rafId) drawAudioWaveform();
    });

    player.addEventListener('play', () => {
        setAudioToolsStatus('Playing preview');
        startAudioToolsRenderLoop();
    });

    player.addEventListener('pause', () => {
        stopAudioToolsRenderLoop();
        setAudioToolsStatus('Preview paused');
        drawAudioWaveform();
    });

    player.addEventListener('ended', () => {
        stopAudioToolsRenderLoop();
        setAudioToolsStatus('Preview finished');
        drawAudioWaveform();
    });

    audioToolsState.playerBound = true;
}

async function decodeWaveformPeaks(mediaUrl) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error('WebAudio API unavailable');

    const res = await fetch(mediaUrl);
    if (!res.ok) throw new Error(`Waveform fetch failed (${res.status})`);
    const binary = await res.arrayBuffer();

    const ctx = new AudioCtx();
    try {
        const audioBuffer = await ctx.decodeAudioData(binary.slice(0));
        const samples = audioBuffer.getChannelData(0);
        const duration = Number(audioBuffer.duration || 0);
        const bucketTarget = Math.max(1600, Math.min(10000, Math.floor(duration * 180)));
        const step = Math.max(1, Math.floor(samples.length / bucketTarget));
        const peaks = [];

        for (let i = 0; i < samples.length; i += step) {
            let max = 0;
            const end = Math.min(samples.length, i + step);
            for (let j = i; j < end; j++) {
                const abs = Math.abs(samples[j]);
                if (abs > max) max = abs;
            }
            peaks.push(max);
        }
        return { peaks, duration };
    } finally {
        try {
            await ctx.close();
        } catch (_) { }
    }
}

async function loadAudioToolsWaveform(filePath) {
    const player = getAudioToolsPlayer();
    if (!player) return;

    const mediaUrl = normalizeMediaUrl(filePath);
    audioToolsState.filePath = filePath || '';
    audioToolsState.mediaUrl = mediaUrl || '';
    audioToolsState.waveformPeaks = [];
    audioToolsState.duration = 0;
    audioToolsState.viewportStart = 0;
    audioToolsState.viewportDuration = 0;
    audioToolsState.selectionStart = 0;
    audioToolsState.selectionEnd = 0;
    audioToolsState.selectionAnchor = 0;

    if (!mediaUrl) {
        player.pause();
        player.removeAttribute('src');
        player.load();
        setAudioToolsStatus('Track path is invalid, preview is unavailable.', 'error');
        drawAudioWaveform();
        return;
    }

    player.pause();
    player.src = mediaUrl;
    player.currentTime = 0;
    player.load();

    setAudioToolsStatus('Loading waveform...');
    drawAudioWaveform();

    const loadToken = ++audioToolsState.loadToken;
    try {
        const wave = await decodeWaveformPeaks(mediaUrl);
        if (loadToken !== audioToolsState.loadToken) return;

        audioToolsState.waveformPeaks = wave.peaks || [];
        audioToolsState.duration = Number(wave.duration || player.duration || 0);
        setAudioToolsZoom(audioToolsState.zoom || 1);
        setAudioToolsStatus(`Waveform ready (${formatAudioToolsTime(audioToolsState.duration, false)})`, 'ok');
    } catch (e) {
        if (loadToken !== audioToolsState.loadToken) return;
        audioToolsState.waveformPeaks = [];
        audioToolsState.duration = Number(player.duration || 0);
        setAudioToolsStatus('Waveform unavailable. You can still edit by entering time values.', 'error');
        drawAudioWaveform();
    }
}

function resetAudioToolsState() {
    audioToolsState.trackId = null;
    audioToolsState.title = '';
    audioToolsState.artist = '';
    audioToolsState.filePath = '';
    audioToolsState.mediaUrl = '';
    audioToolsState.duration = 0;
    audioToolsState.zoom = 1;
    audioToolsState.viewportStart = 0;
    audioToolsState.viewportDuration = 0;
    audioToolsState.selectionStart = 0;
    audioToolsState.selectionEnd = 0;
    audioToolsState.selectionAnchor = 0;
    audioToolsState.selecting = false;
    audioToolsState.waveformPeaks = [];
    audioToolsState.loadToken += 1;
    audioToolsState.rafId = null;
    audioToolsState.segments = [];
}

function focusAudioToolCard(tool = 'manual') {
    const idMap = {
        manual: 'manualTrimCard',
        auto: 'autoTrimCard',
        censor: 'censorCard'
    };

    const focusId = idMap[tool] || idMap.manual;
    const cards = document.querySelectorAll('#audioToolsModal .audio-tool-card');
    cards.forEach(card => card.classList.remove('card-focus-flash'));

    const card = document.getElementById(focusId);
    if (!card) return;
    card.classList.add('card-focus-flash');
    setTimeout(() => {
        card.classList.remove('card-focus-flash');
    }, 900);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openAudioToolsModal(trackId, title = '', artist = '', filePath = '', focusTool = 'manual') {
    audioToolsState.trackId = trackId;
    audioToolsState.title = title || 'Untitled';
    audioToolsState.artist = artist || 'Unknown Artist';
    audioToolsState.filePath = filePath || getTrackPathFromState(trackId);
    audioToolsState.segments = [];
    audioToolsState.zoom = 1;
    audioToolsState.viewportStart = 0;
    audioToolsState.viewportDuration = 0;
    audioToolsState.selectionStart = 0;
    audioToolsState.selectionEnd = 0;
    audioToolsState.selectionAnchor = 0;
    audioToolsState.selecting = false;

    const labelEl = document.getElementById('audioToolsTrackLabel');
    if (labelEl) labelEl.textContent = `${audioToolsState.artist} - ${audioToolsState.title} (#${trackId})`;

    const thEl = document.getElementById('autoTrimThreshold');
    const minEl = document.getElementById('autoTrimMinSilence');
    const zoomEl = document.getElementById('audioToolsZoom');
    if (thEl) thEl.value = '-45';
    if (minEl) minEl.value = '0.15';
    if (zoomEl) zoomEl.value = '1';

    renderCensorSegments();
    bindAudioToolsCanvas();
    bindAudioToolsPlayer();

    document.getElementById('audioToolsModal').style.display = 'flex';
    setAudioToolsZoom(1);
    loadAudioToolsWaveform(audioToolsState.filePath);
    focusAudioToolCard(focusTool);
}

function closeAudioToolsModal() {
    const modal = document.getElementById('audioToolsModal');
    const player = getAudioToolsPlayer();
    stopAudioToolsRenderLoop();

    if (player) {
        player.pause();
        player.removeAttribute('src');
        player.load();
    }
    if (modal) modal.style.display = 'none';

    resetAudioToolsState();
}

function setAudioToolsZoom(value) {
    const zoom = Math.max(1, Math.min(8, parseInt(value, 10) || 1));
    audioToolsState.zoom = zoom;

    const zoomInput = document.getElementById('audioToolsZoom');
    const zoomLabel = document.getElementById('audioToolsZoomLabel');
    if (zoomInput && String(zoomInput.value) !== String(zoom)) zoomInput.value = String(zoom);
    if (zoomLabel) zoomLabel.textContent = `${zoom}x`;

    const duration = Number(audioToolsState.duration || getAudioToolsPlayer()?.duration || 0);
    if (duration > 0) {
        const minSpan = Math.min(6, duration);
        const nextSpan = zoom <= 1 ? duration : Math.max(duration / zoom, minSpan);
        const span = Math.min(duration, nextSpan);
        const focus = clampAudioToolsTime(Number(getAudioToolsPlayer()?.currentTime || 0));
        const maxStart = Math.max(0, duration - span);
        audioToolsState.viewportDuration = span;
        audioToolsState.viewportStart = Math.max(0, Math.min(focus - (span / 2), maxStart));
    }

    drawAudioWaveform();
}

function toggleAudioToolsPlay() {
    const player = getAudioToolsPlayer();
    if (!player || !player.src) {
        showToast('Preview source is not ready', 'error');
        return;
    }

    if (player.paused) {
        player.play().catch(() => {
            showToast('Preview playback failed', 'error');
        });
    } else {
        player.pause();
    }
}

function stopAudioToolsPlay() {
    const player = getAudioToolsPlayer();
    if (!player) return;
    player.pause();
    player.currentTime = 0;
    setAudioToolsStatus('Preview stopped');
    drawAudioWaveform();
}

function getAudioToolsSelectionRange() {
    const from = Math.min(Number(audioToolsState.selectionStart || 0), Number(audioToolsState.selectionEnd || 0));
    const to = Math.max(Number(audioToolsState.selectionStart || 0), Number(audioToolsState.selectionEnd || 0));
    if (to - from <= 0.03) {
        return null;
    }
    return { from, to };
}

function addSelectionAsCensorSegment() {
    const range = getAudioToolsSelectionRange();
    if (!range) {
        return showToast('Select a range on waveform first', 'error');
    }

    const effect = document.getElementById('censorEffect')?.value || 'mute';
    audioToolsState.segments.push({
        start: Number(range.from.toFixed(3)),
        end: Number(range.to.toFixed(3)),
        effect
    });
    renderCensorSegments();
    showToast(`Segment added: ${range.from.toFixed(2)}s - ${range.to.toFixed(2)}s`);
}

function clearCensorSegments() {
    audioToolsState.segments = [];
    renderCensorSegments();
}

function renderCensorSegments() {
    const list = document.getElementById('censorSegmentsList');
    if (!list) return;

    if (!audioToolsState.segments.length) {
        list.innerHTML = '<div class="segment-item"><span>No segments added.</span></div>';
        return;
    }

    list.innerHTML = audioToolsState.segments.map((s, idx) => `
        <div class="segment-item">
            <span>${idx + 1}. ${s.effect} | ${Number(s.start).toFixed(2)}s - ${Number(s.end).toFixed(2)}s</span>
            <button onclick="removeCensorSegment(${idx})" title="Remove">remove</button>
        </div>
    `).join('');
}

function removeCensorSegment(index) {
    audioToolsState.segments = audioToolsState.segments.filter((_, i) => i !== index);
    renderCensorSegments();
}

async function applyManualTrim() {
    const trackId = audioToolsState.trackId;
    if (!trackId) return showToast('No track selected', 'error');

    const duration = Number(audioToolsState.duration || getAudioToolsPlayer()?.duration || 0);
    if (!duration) return showToast('Track duration is not ready', 'error');

    const range = getAudioToolsSelectionRange();
    if (!range) return showToast('Select a range on waveform first', 'error');

    const startCut = Math.max(0, range.from);
    const endCut = Math.max(0, duration - range.to);
    if (!Number.isFinite(startCut) || !Number.isFinite(endCut)) {
        return showToast('Invalid selection range', 'error');
    }

    try {
        await apiFetch(`${API_BASE}/api/tracks/${trackId}/trim/manual`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ start_cut: startCut, end_cut: endCut })
        });
        showToast('Manual trim completed');
        await loadLibrary(currentState.currentPage || 1);
        await loadAudioToolsWaveform(audioToolsState.filePath || getTrackPathFromState(trackId));
    } catch (e) {
        showToast('Manual trim failed', 'error');
    }
}

async function applyAutoTrimTrack() {
    const trackId = audioToolsState.trackId;
    if (!trackId) return showToast('No track selected', 'error');

    const threshold = Number(document.getElementById('autoTrimThreshold')?.value || -45);
    const minSilence = Number(document.getElementById('autoTrimMinSilence')?.value || 0.15);

    try {
        await apiFetch(`${API_BASE}/api/tracks/${trackId}/trim/silence`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ threshold_db: threshold, min_silence: minSilence, skip_if_already_trimmed: false })
        });
        showToast('Auto trim completed');
        await loadLibrary(currentState.currentPage || 1);
        await loadAudioToolsWaveform(audioToolsState.filePath || getTrackPathFromState(trackId));
    } catch (e) {
        showToast('Auto trim failed', 'error');
    }
}

async function applyCensorSegments() {
    const trackId = audioToolsState.trackId;
    if (!trackId) return showToast('No track selected', 'error');
    if (!audioToolsState.segments.length) return showToast('No censor segment added', 'error');

    try {
        await apiFetch(`${API_BASE}/api/tracks/${trackId}/censor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segments: audioToolsState.segments })
        });
        showToast('Censor effects applied');
        audioToolsState.segments = [];
        renderCensorSegments();
        await loadLibrary(currentState.currentPage || 1);
        await loadAudioToolsWaveform(audioToolsState.filePath || getTrackPathFromState(trackId));
    } catch (e) {
        showToast('Censor processing failed', 'error');
    }
}

function setYtDlpStatus(text, type = 'info') {
    const el = document.getElementById('ytDlpStatus');
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('status-info', 'status-running', 'status-success', 'status-error');
    el.classList.add(`status-${type}`);
}

function setYtDlpResult(text) {
    const el = document.getElementById('ytDlpResult');
    if (!el) return;
    el.textContent = text || '';
}

function setYtDlpBinaryStatus(text, ok = null) {
    const el = document.getElementById('ytDlpBinaryStatus');
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('binary-ok', 'binary-warn');
    if (ok === true) el.classList.add('binary-ok');
    if (ok === false) el.classList.add('binary-warn');
}

function setUploadImportStatus(text, type = 'info') {
    const el = document.getElementById('uploadImportStatus');
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('status-info', 'status-running', 'status-success', 'status-error');
    el.classList.add(`status-${type}`);
}

function setUploadImportResult(text) {
    const el = document.getElementById('uploadImportResult');
    if (!el) return;
    el.textContent = text || '';
}

function initUploadImportUi() {
    const fileInput = document.getElementById('uploadImportFiles');
    if (fileInput && !fileInput.dataset.boundChange) {
        fileInput.dataset.boundChange = '1';
        fileInput.addEventListener('change', () => {
            const files = Array.from(fileInput.files || []);
            if (!files.length) {
                setUploadImportResult('No upload job yet.');
                return;
            }
            const totalSizeMb = files.reduce((sum, file) => sum + Number(file.size || 0), 0) / (1024 * 1024);
            setUploadImportResult(`Selected ${files.length} file(s), ${totalSizeMb.toFixed(1)} MB total`);
        });
    }
    setUploadImportStatus('Ready');
    setUploadImportResult('No upload job yet.');
    syncStationTargetSelectors();
}

async function uploadLibraryFiles() {
    const fileInput = document.getElementById('uploadImportFiles');
    const trackTypeEl = document.getElementById('uploadTrackType');
    const targetStationEl = document.getElementById('uploadTargetStation');
    const autoTrimEl = document.getElementById('uploadAutoTrim');
    const autoIntroEl = document.getElementById('uploadAutoIntroClean');
    const uploadBtn = document.getElementById('uploadImportBtn');

    const files = Array.from(fileInput?.files || []);
    if (!files.length) {
        setUploadImportStatus('Please select at least one audio file', 'error');
        showToast('Please select at least one audio file', 'error');
        return;
    }

    const trackType = String(trackTypeEl?.value || 'music').trim().toLowerCase();
    const targetStationId = Number(targetStationEl?.value || currentState.currentStationId || 1);
    const effectiveTargetStationId = Number.isInteger(targetStationId) && targetStationId > 0
        ? targetStationId
        : Number(currentState.currentStationId || 1);

    const originalBtnHtml = uploadBtn ? uploadBtn.innerHTML : '';
    if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<span class="material-icons-round">hourglass_top</span>Uploading...';
    }
    setUploadImportStatus(`Uploading ${files.length} file(s)...`, 'running');

    try {
        const formData = new FormData();
        formData.append('station_id', String(currentState.currentStationId));
        formData.append('target_station_id', String(effectiveTargetStationId));
        formData.append('track_type', trackType);
        formData.append('auto_trim_silence', autoTrimEl?.checked ? 'true' : 'false');
        formData.append('auto_intro_clean', autoIntroEl?.checked ? 'true' : 'false');
        files.forEach(file => formData.append('files', file));

        const data = await apiFetch(`${API_BASE}/api/library/import/upload`, {
            method: 'POST',
            body: formData,
        });

        const imported = Number(data?.scan?.added || 0);
        const uploaded = Number(data?.uploaded_files || files.length);
        const targetStationName = data?.target_station_name || _stationNameById(data?.target_station_id || effectiveTargetStationId);
        setUploadImportStatus(`Completed. ${imported} track(s) imported.`, 'success');
        setUploadImportResult(`Uploaded: ${uploaded} | Imported: ${imported} | Station: ${targetStationName || '-'} | Target: ${data?.target_dir || '-'}`);
        showToast(`Upload complete: ${imported} track(s) -> ${targetStationName || `Station ${effectiveTargetStationId}`}`);
        if (fileInput) fileInput.value = '';

        await loadLibraryFilterOptions();
        await loadLibrary(currentState.currentPage || 1);
        await loadCartwall();
        await refreshHealth();
    } catch (e) {
        const msg = String(e?.message || '').replace(/^Error:\s*/, '') || 'Upload import failed';
        setUploadImportStatus(msg, 'error');
        setUploadImportResult('Upload failed. Check file format and backend logs.');
        showToast(msg, 'error');
    } finally {
        if (uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = originalBtnHtml || '<span class="material-icons-round">upload</span>Upload and Import';
        }
    }
}

function formatYtDlpDate(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleTimeString('en-US', { hour12: false });
}

function ytdlpStatusClass(status) {
    if (status === 'running') return 'status-running';
    if (status === 'completed') return 'status-success';
    if (status === 'failed') return 'status-error';
    return 'status-info';
}

function shortenYtDlpUrl(url, maxLen = 78) {
    const value = String(url || '').trim();
    if (value.length <= maxLen) return value || '-';
    return `${value.slice(0, maxLen - 3)}...`;
}

function findYtDlpJobInSnapshot(snapshot, jobId) {
    if (!snapshot || !jobId) return null;
    if (snapshot.running && snapshot.running.id === jobId) return snapshot.running;
    const queued = (snapshot.queue || []).find(j => j.id === jobId);
    if (queued) return queued;
    return (snapshot.recent || []).find(j => j.id === jobId) || null;
}

function renderYtDlpQueueStatus(snapshot) {
    const summaryEl = document.getElementById('ytDlpQueueSummary');
    const queueBody = document.getElementById('ytDlpQueueBody');
    const recentBody = document.getElementById('ytDlpRecentBody');

    const running = snapshot?.running || null;
    const queue = Array.isArray(snapshot?.queue) ? snapshot.queue : [];
    const recent = Array.isArray(snapshot?.recent) ? snapshot.recent : [];
    const counts = snapshot?.counts || {};

    if (summaryEl) {
        summaryEl.textContent = `Running: ${counts.running || 0} | Queued: ${counts.queued || 0} | Recent completed: ${counts.completed || 0} | Recent failed: ${counts.failed || 0}`;
    }

    if (queueBody) {
        const rows = [];
        if (running) rows.push(running);
        rows.push(...queue);

        if (!rows.length) {
            queueBody.innerHTML = '<tr><td colspan="6" class="queue-empty-cell">Queue is empty.</td></tr>';
        } else {
            queueBody.innerHTML = rows.map(job => {
                const targetName = _stationNameById(job?.target_station_id || job?.station_id);
                return `
                <tr>
                    <td>#${job.queue_position || '-'}</td>
                    <td><span class="status-pill ${ytdlpStatusClass(job.status)}">${job.status || '-'}</span></td>
                    <td>${job.phase || '-'}</td>
                    <td title="${job.url || ''}">${shortenYtDlpUrl(job.url)}</td>
                    <td>${job.track_type || 'music'}${targetName ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${targetName}</div>` : ''}</td>
                    <td>${formatYtDlpDate(job.created_at)}</td>
                </tr>
            `;
            }).join('');
        }
    }

    if (recentBody) {
        if (!recent.length) {
            recentBody.innerHTML = '<tr><td colspan="7" class="queue-empty-cell">No recent jobs.</td></tr>';
        } else {
            recentBody.innerHTML = recent.map(job => {
                const imported = Number(job?.result?.scan?.added || 0);
                const downloaded = Number(job?.result?.downloaded_files || 0);
                const targetName = _stationNameById(job?.target_station_id || job?.station_id);
                const summary = job.status === 'completed'
                    ? `${imported} imported / ${downloaded} file(s)`
                    : (job.error || job.message || '-');
                return `
                <tr>
                    <td><code>${job.id}</code></td>
                    <td><span class="status-pill ${ytdlpStatusClass(job.status)}">${job.status || '-'}</span></td>
                    <td>${job.phase || '-'}</td>
                    <td title="${job.url || ''}">${shortenYtDlpUrl(job.url, 64)}</td>
                    <td>${job.track_type || 'music'}${targetName ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${targetName}</div>` : ''}</td>
                    <td>${formatYtDlpDate(job.finished_at || job.updated_at)}</td>
                    <td title="${summary}">${shortenYtDlpUrl(summary, 48)}</td>
                </tr>
                `;
            }).join('');
        }
    }
}

async function loadYtDlpQueueStatus(silent = false) {
    try {
        const data = await apiFetch(`${API_BASE}/api/library/import/ytdlp/jobs/status?limit_recent=25`);
        renderYtDlpQueueStatus(data);

        if (ytdlpFocusedJobId) {
            const focused = findYtDlpJobInSnapshot(data, ytdlpFocusedJobId);
            if (focused && (focused.status === 'queued' || focused.status === 'running')) {
                const posText = focused.queue_position ? ` #${focused.queue_position}` : '';
                setYtDlpStatus(`${focused.status.toUpperCase()}${posText} - ${focused.phase || 'working'}`, 'running');
            }
            if (focused && (focused.status === 'completed' || focused.status === 'failed')) {
                if (ytdlpLastTerminalStatus[ytdlpFocusedJobId] !== focused.status) {
                    ytdlpLastTerminalStatus[ytdlpFocusedJobId] = focused.status;

                    if (focused.status === 'completed') {
                        const imported = Number(focused?.result?.scan?.added || 0);
                        const downloaded = Number(focused?.result?.downloaded_files || 0);
                        const trimmedCount = Number(focused?.result?.trim?.trimmed || 0);
                        const trimRemovedSec = Number(focused?.result?.trim?.removed_seconds_total || 0);
                        const introCleaned = Number(focused?.result?.intro_clean?.cleaned || 0);
                        const introRemovedSec = Number(focused?.result?.intro_clean?.removed_seconds_total || 0);
                        const introPreset = String(focused?.result?.intro_clean?.preset || focused?.result?.intro_clean_preset || 'normal');
                        const audioMode = focused?.result?.audio_mode || 'transcode';
                        const musicOnly = focused?.result?.music_only_mode === false ? 'off' : 'on';
                        const targetStationName = focused?.result?.target_station_name || _stationNameById(focused?.target_station_id || focused?.station_id) || '-';
                        const targetDir = focused?.result?.target_dir || '-';
                        setYtDlpStatus(`Completed. ${imported} track(s) imported.`, 'success');
                        setYtDlpResult(`Station: ${targetStationName} | Downloaded: ${downloaded} | Silence Trim: ${trimmedCount} (${trimRemovedSec.toFixed(1)}s) | Intro Clean: ${introCleaned} (${introRemovedSec.toFixed(1)}s, ${introPreset}) | Mode: ${audioMode} | Music-Only: ${musicOnly} | Target: ${targetDir}`);
                        showToast(`Import complete: ${imported} track(s), ${downloaded} file(s) -> ${targetStationName}.`);
                        await loadLibrary(currentState.currentPage || 1);
                        await loadCartwall();
                        await refreshHealth();
                    } else {
                        const msg = focused.error || focused.message || 'yt-dlp import failed';
                        setYtDlpStatus(msg, 'error');
                        setYtDlpResult('Import failed. Check URL, yt-dlp binary, and backend logs.');
                        showToast(msg, 'error');
                    }
                }
            }
        }
    } catch (e) {
        if (!silent) {
            setYtDlpStatus('Could not load queue status', 'error');
        }
    }
}

function setSelectValueOrAppend(selectEl, value) {
    if (!selectEl || !value) return;
    const valueStr = String(value);
    const hasOption = Array.from(selectEl.options || []).some(o => o.value === valueStr);
    if (!hasOption) {
        const opt = document.createElement('option');
        opt.value = valueStr;
        opt.textContent = valueStr.toUpperCase ? valueStr.toUpperCase() : valueStr;
        selectEl.appendChild(opt);
    }
    selectEl.value = valueStr;
}

function initYtDlpImportUi() {
    const urlEl = document.getElementById('ytDlpUrl');
    if (urlEl) {
        urlEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                downloadWithYtDlp();
            }
        });
    }
    setYtDlpStatus('Ready');
    setYtDlpResult('No completed import yet.');
    setYtDlpBinaryStatus('Checking yt-dlp...');
    loadYtDlpQueueStatus(true);
}

async function loadYtDlpSettings(force = false) {
    if (ytdlpSettingsLoaded && !force) return;

    try {
        const data = await apiFetch(`${API_BASE}/api/library/import/ytdlp/settings?station_id=${currentState.currentStationId}`);

        const formatEl = document.getElementById('ytDlpAudioFormat');
        const qualityEl = document.getElementById('ytDlpAudioQuality');
        const playlistEl = document.getElementById('ytDlpPlaylist');
        const musicOnlyEl = document.getElementById('ytDlpMusicOnly');
        const targetStationEl = document.getElementById('ytDlpTargetStation');
        const autoTrimEl = document.getElementById('ytDlpAutoTrim');
        const trimThresholdEl = document.getElementById('ytDlpTrimThreshold');
        const trimMinSilenceEl = document.getElementById('ytDlpTrimMinSilence');
        const autoIntroEl = document.getElementById('ytDlpAutoIntroClean');
        const introPresetEl = document.getElementById('ytDlpIntroPreset');
        const introMaxCutEl = document.getElementById('ytDlpIntroMaxCut');

        if ((!currentState.stations || !currentState.stations.length) && Array.isArray(data.stations) && data.stations.length) {
            currentState.stations = data.stations;
        }
        syncStationTargetSelectors();
        if (targetStationEl) {
            const candidate = Number(targetStationEl.value || currentState.currentStationId || 1);
            const fallback = Number(currentState.currentStationId || 1);
            targetStationEl.value = String(Number.isInteger(candidate) && candidate > 0 ? candidate : fallback);
        }

        if (formatEl) setSelectValueOrAppend(formatEl, (data.default_audio_format || '').toLowerCase());
        if (qualityEl) setSelectValueOrAppend(qualityEl, String(data.default_audio_quality || '192'));
        if (playlistEl) playlistEl.checked = !!data.default_allow_playlist;
        if (musicOnlyEl) musicOnlyEl.checked = data.default_music_only_mode !== false;
        if (autoTrimEl) autoTrimEl.checked = !!data.default_auto_trim;
        if (trimThresholdEl) trimThresholdEl.value = String(data.trim_threshold_db ?? -45);
        if (trimMinSilenceEl) trimMinSilenceEl.value = String(data.trim_min_silence ?? 0.15);
        if (autoIntroEl) autoIntroEl.checked = !!data.default_auto_intro_clean;
        if (introPresetEl) setSelectValueOrAppend(introPresetEl, String(data.default_intro_clean_preset || 'normal').toLowerCase());
        if (introMaxCutEl) introMaxCutEl.value = String(data.intro_max_cut_s ?? 18);

        if (data.binary_found) {
            const shownPath = data.binary_path || data.binary || 'yt-dlp';
            if (data.ffmpeg_found) {
                setYtDlpBinaryStatus(`yt-dlp ready: ${shownPath}`, true);
                setYtDlpStatus('Ready');
            } else {
                setYtDlpBinaryStatus(`yt-dlp ready (ffmpeg missing): ${shownPath}`, false);
                setYtDlpStatus('Ready (direct stream mode, no transcoding)');
            }
        } else {
            setYtDlpBinaryStatus('yt-dlp not found. Check backend/.env YTDLP_BINARY', false);
            setYtDlpStatus('yt-dlp is not available', 'error');
        }

        ytdlpSettingsLoaded = true;
    } catch (e) {
        setYtDlpBinaryStatus('yt-dlp settings unavailable', false);
        setYtDlpStatus('Could not load yt-dlp settings', 'error');
    }
}

async function downloadWithYtDlp() {
    await loadYtDlpSettings();

    const urlEl = document.getElementById('ytDlpUrl');
    const typeEl = document.getElementById('ytDlpTrackType');
    const formatEl = document.getElementById('ytDlpAudioFormat');
    const qualityEl = document.getElementById('ytDlpAudioQuality');
    const targetStationEl = document.getElementById('ytDlpTargetStation');
    const playlistEl = document.getElementById('ytDlpPlaylist');
    const musicOnlyEl = document.getElementById('ytDlpMusicOnly');
    const autoTrimEl = document.getElementById('ytDlpAutoTrim');
    const trimThresholdEl = document.getElementById('ytDlpTrimThreshold');
    const trimMinSilenceEl = document.getElementById('ytDlpTrimMinSilence');
    const autoIntroEl = document.getElementById('ytDlpAutoIntroClean');
    const introPresetEl = document.getElementById('ytDlpIntroPreset');
    const introMaxCutEl = document.getElementById('ytDlpIntroMaxCut');
    const importBtn = document.getElementById('ytDlpImportBtn');

    const url = (urlEl?.value || '').trim();
    if (!url) {
        setYtDlpStatus('URL is required', 'error');
        return showToast('URL is required', 'error');
    }

    const trackType = (typeEl?.value || 'music').trim().toLowerCase();
    const targetStationId = Number(targetStationEl?.value || currentState.currentStationId || 1);
    const effectiveTargetStationId = Number.isInteger(targetStationId) && targetStationId > 0
        ? targetStationId
        : Number(currentState.currentStationId || 1);
    const audioFormat = (formatEl?.value || 'mp3').trim().toLowerCase();
    const audioQuality = String(qualityEl?.value || '192').trim();
    const allowPlaylist = !!playlistEl?.checked;
    const musicOnlyMode = trackType === 'music' ? !!musicOnlyEl?.checked : false;
    const autoTrimSilence = !!autoTrimEl?.checked;
    const trimThresholdDb = Number(trimThresholdEl?.value ?? -45);
    const trimMinSilence = Number(trimMinSilenceEl?.value ?? 0.15);
    const autoIntroClean = !!autoIntroEl?.checked;
    const introPreset = String(introPresetEl?.value || 'normal').trim().toLowerCase();
    const introMaxCut = Number(introMaxCutEl?.value ?? 18);

    const originalBtnHtml = importBtn ? importBtn.innerHTML : '';
    if (importBtn) {
        importBtn.disabled = true;
        importBtn.innerHTML = '<span class="material-icons-round">hourglass_top</span>Queueing...';
    }
    setYtDlpStatus('Submitting to queue...', 'running');
    showToast('yt-dlp import queued...');

    try {
        const data = await apiFetch(`${API_BASE}/api/library/import/ytdlp/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url,
                track_type: trackType,
                station_id: currentState.currentStationId,
                target_station_id: effectiveTargetStationId,
                download_playlist: allowPlaylist,
                music_only_mode: musicOnlyMode,
                audio_format: audioFormat,
                audio_quality: audioQuality,
                auto_trim_silence: autoTrimSilence,
                trim_threshold_db: Number.isFinite(trimThresholdDb) ? trimThresholdDb : -45,
                trim_min_silence: Number.isFinite(trimMinSilence) ? trimMinSilence : 0.15,
                auto_intro_clean: autoIntroClean,
                intro_clean_preset: introPreset || 'normal',
                intro_max_cut_s: Number.isFinite(introMaxCut) ? introMaxCut : 18
            })
        });

        const job = data?.job || {};
        const position = Number(job?.queue_position || 0);
        ytdlpFocusedJobId = job?.id || null;
        const targetName = _stationNameById(job?.target_station_id || effectiveTargetStationId);

        setYtDlpStatus(`Queued${position ? ` (#${position})` : ''}. Waiting for worker...`, 'running');
        setYtDlpResult(`Job ID: ${job?.id || '-'} | Target: ${targetName || '-'} | URL: ${shortenYtDlpUrl(url, 56)}`);
        showToast(`Queued${position ? ` at #${position}` : ''}: ${job?.id || ''} -> ${targetName || `Station ${effectiveTargetStationId}`}`);
        if (urlEl) urlEl.value = '';
        await loadYtDlpQueueStatus(true);
    } catch (e) {
        const msg = (e && e.message ? e.message : '').replace(/^Error:\s*/, '');
        setYtDlpStatus(msg || 'Could not queue yt-dlp import', 'error');
        setYtDlpResult('Queue request failed. Check URL, yt-dlp binary, and backend logs.');
        showToast(msg || 'Could not queue yt-dlp import', 'error');
    } finally {
        if (importBtn) {
            importBtn.disabled = false;
            importBtn.innerHTML = originalBtnHtml || '<span class="material-icons-round">cloud_download</span>Download and Import';
        }
    }
}

async function pushToLive(filePath) {
    try {
        const stationId = Number(currentState.currentStationId || 1);
        const params = new URLSearchParams({
            station_id: String(stationId),
            file_path: String(filePath || ''),
        });
        const showId = getCurrentProgramActionShowId();
        if (showId > 0) {
            params.set('show_id', String(showId));
        }
        await apiFetch(`${API_BASE}/api/liquidsoap/push?${params.toString()}`, { method: 'POST' });
        showToast("Play now started");
        await refreshStatus();
        await loadQueue();
    } catch (e) {
        showToast("Add failed!", "error");
    }
}

async function playCartOverlay(filePath) {
    try {
        const stationId = Number(currentState.currentStationId || 1);
        const params = new URLSearchParams({
            station_id: String(stationId),
            file_path: String(filePath || ''),
        });
        const showId = getCurrentProgramActionShowId();
        if (showId > 0) {
            params.set('show_id', String(showId));
        }
        await apiFetch(`${API_BASE}/api/liquidsoap/cart?${params.toString()}`, { method: 'POST' });
        showToast("Cart played");
    } catch (e) {
        showToast("Cart failed!", "error");
    }
}

// ============================================
// TEST MODE - PREVIEW PLAYER
// ============================================

function previewTrack(id, title, artist, filePath) {
    console.log("DEBUG: Previewing track", { id, title, artist, filePath });
    const playerDiv = document.getElementById('testPlayer');
    const audio = document.getElementById('audioPreview');
    const info = document.getElementById('testTrackInfo');

    if (!playerDiv || !audio || !info) return;

    // Normalleşterme: Ters slaşları düzelt ve /media/ kelimesinden sonrasını al (case-insensitive)
    let normalizedPath = filePath.replace(/\\/g, '/');
    let mediaIndex = normalizedPath.toLowerCase().indexOf('/media/');

    if (mediaIndex === -1) {
        showToast("Error: Media path not found!", "error");
        console.error("Path doesn't contain /media/ context", normalizedPath);
        return;
    }

    let relativePath = normalizedPath.substring(mediaIndex + 7); // 7 is length of '/media/'
    const mediaUrl = `/api/media/${relativePath}`;

    console.log("DEBUG: Calculated Media URL", mediaUrl);

    info.textContent = `${artist} - ${title}`;
    audio.src = mediaUrl;
    playerDiv.style.display = 'flex';

    audio.play().catch(e => {
        console.error("Audio play failed:", e);
        showToast("Audio playback failed!", "error");
    });

    showToast("Test mode: Local preview started");
}

function closeTestMode() {
    const playerDiv = document.getElementById('testPlayer');
    const audio = document.getElementById('audioPreview');
    if (playerDiv) playerDiv.style.display = 'none';
    if (audio) {
        audio.pause();
        audio.src = "";
    }
}

function setMetadataRuleResult(message, type = 'info') {
    const el = document.getElementById('metadataRuleResult');
    if (!el) return;
    const safe = String(message || '').trim() || 'No metadata rule action yet.';
    el.textContent = safe;
    el.dataset.state = String(type || 'info');
}

async function loadMetadataRules() {
    const tableBody = document.getElementById('metadataRulesTableBody');
    if (!tableBody) return;

    try {
        const stationId = Number(currentState.currentStationId || 1);
        const data = await apiFetch(`${API_BASE}/api/library/metadata/rules?station_id=${stationId}&include_inactive=true`);
        currentState.metadataRules = Array.isArray(data?.rules) ? data.rules : [];
        renderMetadataRules();
    } catch (e) {
        currentState.metadataRules = [];
        renderMetadataRules();
        setMetadataRuleResult('Could not load metadata rules.', 'error');
    }
}

function renderMetadataRules() {
    const tbody = document.getElementById('metadataRulesTableBody');
    if (!tbody) return;
    const rules = Array.isArray(currentState.metadataRules) ? currentState.metadataRules : [];

    if (!rules.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align:center;padding:16px;color:var(--text-muted)">
                    No metadata rules yet. Add your first rule above.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = rules.map(rule => {
        const id = Number(rule?.id || 0);
        const scope = String(rule?.scope || 'station');
        const scopeLabel = scope === 'global' ? 'Global' : _stationNameById(rule?.station_id) || `Station ${rule?.station_id || currentState.currentStationId}`;
        const active = Boolean(rule?.is_active);
        const caseFlag = rule?.is_case_sensitive ? ' (case)' : '';
        return `
            <tr>
                <td>${escapeHtml(rule?.name || '')}</td>
                <td>${escapeHtml(scopeLabel)}</td>
                <td>${escapeHtml(rule?.target_field || '')}</td>
                <td>${escapeHtml(`${rule?.match_type || ''}${caseFlag}`)}</td>
                <td title="${escapeHtml(rule?.pattern || '')}">${escapeHtml(rule?.pattern || '')}</td>
                <td title="${escapeHtml(rule?.replacement || '')}">${escapeHtml(rule?.replacement || '')}</td>
                <td>${Number(rule?.priority || 0)}</td>
                <td>
                    <button class="btn-sm" onclick="toggleMetadataRuleActive(${id}, ${active ? 'false' : 'true'})" title="${active ? 'Disable' : 'Enable'}">
                        <span class="material-icons-round">${active ? 'toggle_on' : 'toggle_off'}</span>
                    </button>
                </td>
                <td>
                    <button class="btn-sm" onclick="deleteMetadataRule(${id})" title="Delete Rule">
                        <span class="material-icons-round">delete</span>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

async function createMetadataRule() {
    const scopeEl = document.getElementById('metadataRuleScope');
    const nameEl = document.getElementById('metadataRuleName');
    const fieldEl = document.getElementById('metadataRuleField');
    const matchEl = document.getElementById('metadataRuleMatchType');
    const patternEl = document.getElementById('metadataRulePattern');
    const replacementEl = document.getElementById('metadataRuleReplacement');
    const caseEl = document.getElementById('metadataRuleCaseSensitive');
    const priorityEl = document.getElementById('metadataRulePriority');

    if (!scopeEl || !fieldEl || !matchEl || !patternEl || !replacementEl || !caseEl || !priorityEl || !nameEl) {
        return;
    }

    const pattern = String(patternEl.value || '').trim();
    if (!pattern) {
        showToast('Rule pattern is required', 'error');
        return;
    }

    const scope = String(scopeEl.value || 'station').trim().toLowerCase();
    const priority = Number(priorityEl.value || 100);
    const payload = {
        station_id: scope === 'station' ? Number(currentState.currentStationId || 1) : null,
        scope,
        name: String(nameEl.value || '').trim(),
        target_field: String(fieldEl.value || 'title').trim().toLowerCase(),
        match_type: String(matchEl.value || 'contains').trim().toLowerCase(),
        pattern,
        replacement: String(replacementEl.value || ''),
        is_case_sensitive: Boolean(caseEl.checked),
        priority: Number.isFinite(priority) ? Math.round(priority) : 100,
        is_active: true,
    };

    try {
        await apiFetch(`${API_BASE}/api/library/metadata/rules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        patternEl.value = '';
        replacementEl.value = '';
        if (nameEl) nameEl.value = '';
        setMetadataRuleResult('Metadata rule created.', 'success');
        showToast('Metadata rule created');
        await loadMetadataRules();
    } catch (e) {
        const detail = String(e?.message || '').slice(0, 200);
        setMetadataRuleResult(detail ? `Rule create failed: ${detail}` : 'Rule create failed.', 'error');
        showToast('Metadata rule create failed', 'error');
    }
}

async function toggleMetadataRuleActive(ruleId, nextState) {
    const rid = Number(ruleId || 0);
    if (!Number.isInteger(rid) || rid <= 0) return;
    try {
        await apiFetch(`${API_BASE}/api/library/metadata/rules/${rid}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: Boolean(nextState) }),
        });
        setMetadataRuleResult(`Rule #${rid} ${nextState ? 'enabled' : 'disabled'}.`, 'success');
        await loadMetadataRules();
    } catch (e) {
        showToast('Rule update failed', 'error');
        setMetadataRuleResult(`Rule #${rid} update failed.`, 'error');
    }
}

async function deleteMetadataRule(ruleId) {
    const rid = Number(ruleId || 0);
    if (!Number.isInteger(rid) || rid <= 0) return;
    if (!confirm(`Delete metadata rule #${rid}?`)) return;
    try {
        await apiFetch(`${API_BASE}/api/library/metadata/rules/${rid}`, { method: 'DELETE' });
        setMetadataRuleResult(`Rule #${rid} deleted.`, 'success');
        showToast('Metadata rule deleted');
        await loadMetadataRules();
    } catch (e) {
        showToast('Rule delete failed', 'error');
        setMetadataRuleResult(`Rule #${rid} delete failed.`, 'error');
    }
}

// ============================================
// LIBRARY & DATA LOADING
// ============================================

async function loadLibrary(page = 1) {
    const search = document.getElementById('searchInput').value;
    const artist = document.getElementById('filterArtist').value;
    const genre = document.getElementById('filterGenre').value;
    const language = document.getElementById('filterLanguage').value;
    const type = document.getElementById('filterType').value;
    const scopeParams = buildLibraryScopeParams();

    const url = new URL(`${window.location.origin}/api/tracks`);
    url.searchParams.set('station_id', currentState.currentStationId);
    url.searchParams.set('library_scope', scopeParams.library_scope || 'local');
    if (scopeParams.source_station_id) {
        url.searchParams.set('source_station_id', scopeParams.source_station_id);
    }
    url.searchParams.set('page', page);
    url.searchParams.set('search', search);
    if (artist) url.searchParams.set('artist', artist);
    if (genre) url.searchParams.set('genre', genre);
    if (language) url.searchParams.set('language', language);
    if (type) url.searchParams.set('track_type', type);

    try {
        const data = await apiFetch(url.toString());
        currentState.tracks = Array.isArray(data?.tracks) ? data.tracks : [];
        currentState.currentPage = Number(data?.page || page || 1);
        currentState.totalPages = Number(data?.total_pages || 1);

        const tbody = document.getElementById('trackTableBody');
        if (!tbody) return;

        const showStationContext = String(scopeParams.library_scope || 'local') !== 'local';
        tbody.innerHTML = currentState.tracks.map(t => {
            const normalizedPath = String(t.file_path || '').replace(/\\/g, '/');
            const safeTitle = escapeInlineJsString(t.title || '');
            const safeArtist = escapeInlineJsString(t.artist || '');
            const safePath = escapeInlineJsString(normalizedPath);
            const stationLabel = showStationContext ? escapeHtml(_stationNameById(t.station_id)) : '';
            const displayTitle = escapeHtml(t.title || 'Untitled');
            const displayArtist = escapeHtml(t.artist || 'Unknown');
            const displayAlbum = escapeHtml(t.album || '—');
            const displayGenre = escapeHtml(t.genre || '—');
            const displayTrackType = escapeHtml(t.track_type || 'music');
            return `
            <tr>
                <td>${displayTitle}${stationLabel ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${stationLabel}</div>` : ''}</td>
                <td>${displayArtist}</td>
                <td>${displayAlbum}</td>
                <td>${displayGenre}</td>
                <td>${Number(t.bpm || 0) > 0 ? Math.round(Number(t.bpm)) : '—'}</td>
                <td>${formatDuration(t.duration)}</td>
                <td><span class="badge badge-${displayTrackType}">${displayTrackType}</span></td>
                <td class="library-actions-cell">
                    <div class="library-actions">
                        <button class="btn-sm btn-preview" onclick="previewTrack(${t.id}, '${safeTitle}', '${safeArtist}', '${safePath}')" title="Test Mode (Preview)">
                            <span class="material-icons-round">headphones</span>
                        </button>
                        <button class="btn-sm" onclick="pushToLive('${safePath}')" title="Play Now">
                            <span class="material-icons-round">play_arrow</span>
                        </button>
                        <button class="btn-sm" onclick="trimTrackSilence(${t.id}, '${safeTitle}', '${safeArtist}', '${safePath}')" title="Open Trim Editor">
                            <span class="material-icons-round">content_cut</span>
                        </button>
                        <button class="btn-sm" onclick="openAudioToolsModal(${t.id}, '${safeTitle}', '${safeArtist}', '${safePath}')" title="Audio Tools">
                            <span class="material-icons-round">tune</span>
                        </button>
                        <button class="btn-sm" onclick="addToPlaylistDialog(${t.id})" title="Add to Playlist">
                            <span class="material-icons-round">playlist_add</span>
                        </button>
                        <button class="btn-sm delete-btn" onclick="deleteLibraryTrack(${t.id}, '${safeTitle}')" title="Delete from Library">
                            <span class="material-icons-round">delete</span>
                        </button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');

        renderPagination(data.page, data.total_pages);
    } catch (e) {
        console.error("Library load failed", e);
    }
}

function searchTracks() {
    currentState.currentPage = 1;
    loadLibrary(1);
}

async function deleteLibraryTrack(trackId, trackTitle = '') {
    const tid = Number(trackId || 0);
    if (!Number.isInteger(tid) || tid <= 0) return;
    const label = String(trackTitle || `Track #${tid}`).trim() || `Track #${tid}`;
    if (!confirm(`Delete "${label}" from library?`)) return;

    try {
        await apiFetch(`${API_BASE}/api/tracks/${tid}`, { method: 'DELETE' });
        const currentPage = Math.max(1, Number(currentState.currentPage || 1));
        await loadLibrary(currentPage);
        if ((currentState.tracks || []).length === 0 && currentPage > 1) {
            await loadLibrary(currentPage - 1);
        }
        await loadLibraryFilterOptions();
        await Promise.all([
            loadQueue(),
            refreshStatus(),
            refreshNextTrack(),
        ]);
        showToast(`Deleted: ${label}`);
    } catch (e) {
        const detail = String(e?.message || '').slice(0, 200);
        showToast(detail ? `Track delete failed: ${detail}` : 'Track delete failed', 'error');
    }
}

async function loadLibraryFilterOptions() {
    const artistSelect = document.getElementById('filterArtist');
    const genreSelect = document.getElementById('filterGenre');
    const languageSelect = document.getElementById('filterLanguage');
    if (!artistSelect && !genreSelect && !languageSelect) return;

    const selectedArtist = artistSelect?.value || '';
    const selectedGenre = genreSelect?.value || '';
    const selectedLanguage = languageSelect?.value || '';
    const scopeParams = buildLibraryScopeParams();

    const url = new URL(`${window.location.origin}/api/tracks/filters/options`);
    url.searchParams.set('station_id', currentState.currentStationId);
    url.searchParams.set('library_scope', scopeParams.library_scope || 'local');
    if (scopeParams.source_station_id) {
        url.searchParams.set('source_station_id', scopeParams.source_station_id);
    }

    try {
        const data = await apiFetch(url.toString());
        setSelectOptions('filterArtist', 'All Artists', data.artists || []);
        setSelectOptions('filterGenre', 'All Genres', data.genres || []);
        setSelectOptions('filterLanguage', 'All Languages', data.languages || []);

        if (artistSelect) artistSelect.value = selectedArtist;
        if (genreSelect) genreSelect.value = selectedGenre;
        if (languageSelect) languageSelect.value = selectedLanguage;
    } catch (e) {
        console.warn('Could not load library filter options', e);
    }
}

function renderPagination(current, total) {
    const container = document.getElementById('pagination');
    if (!container) return;
    if (total <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    const start = Math.max(1, current - 2);
    const end = Math.min(total, current + 2);

    if (start > 1) html += `<button onclick="loadLibrary(1)">1</button>${start > 2 ? '...' : ''}`;

    for (let i = start; i <= end; i++) {
        html += `<button class="${i === current ? 'active' : ''}" onclick="loadLibrary(${i})">${i}</button>`;
    }

    if (end < total) html += `${end < total - 1 ? '...' : ''}<button onclick="loadLibrary(${total})">${total}</button>`;

    container.innerHTML = html;
}

async function loadCartwall() {
    try {
        const data = await apiFetch(`${API_BASE}/api/tracks?station_id=${currentState.currentStationId}&track_type=jingle&per_page=12`);
        const tracks = Array.isArray(data?.tracks)
            ? data.tracks
            : (Array.isArray(data?.items) ? data.items : []);

        const grid = document.getElementById('cartwallGrid');
        if (grid) {
            grid.innerHTML = tracks.map(t => {
                const safePath = escapeInlineJsString(String(t.file_path || '').replace(/\\/g, '/'));
                const title = String(t.title || '').trim();
                const fallbackName = String(t.file_path || '').split(/[\\/]/).pop() || 'Cart';
                const buttonTitle = escapeHtml(title || fallbackName);
                const buttonLabel = escapeHtml(title || fallbackName);
                return `
                <button class="cart-btn" onclick="playCartOverlay('${safePath}')" title="${buttonTitle}">
                    ${buttonLabel}
                </button>
            `;
            }).join('');
        }
    } catch (e) {
        console.error("Cartwall load failed", e);
    }
}

// ============================================
// SWEEPER CONFIG
// ============================================

async function loadSweeperConfig() {
    try {
        const data = await apiFetch(`${API_BASE}/api/sweeper/config?station_id=${currentState.currentStationId}`);
        applySweeperConfigUi(data);
    } catch (e) {
        console.error("Sweeper config load failed", e);
    }
}

function applySweeperConfigUi(data = {}) {
    const enabledEl = document.getElementById('sweeperEnabled');
    const intervalEl = document.getElementById('sweeperInterval');
    const countEl = document.getElementById('sweeperJingleCount');
    const jingleCount = Number(data?.jingle_count || 0);
    const hasJingles = jingleCount > 0;

    if (enabledEl) {
        enabledEl.checked = Boolean(data?.enabled) && hasJingles;
        enabledEl.disabled = !hasJingles;
        enabledEl.title = hasJingles ? '' : 'Load at least one jingle to enable auto sweeper';
    }
    if (intervalEl) intervalEl.value = data?.interval || 3;
    if (countEl) {
        countEl.textContent = hasJingles
            ? `${jingleCount} jingle${jingleCount === 1 ? '' : 's'}`
            : '0 jingles - load one to enable auto sweeper';
    }
}

async function saveSweeperConfig() {
    try {
        const enabled = document.getElementById('sweeperEnabled')?.checked || false;
        const interval = parseInt(document.getElementById('sweeperInterval')?.value || '3');
        const currentConfig = await apiFetch(`${API_BASE}/api/sweeper/config?station_id=${currentState.currentStationId}`);

        if (enabled && Number(currentConfig?.jingle_count || 0) <= 0) {
            applySweeperConfigUi(currentConfig);
            showToast('Load at least one jingle before enabling auto sweeper', 'error');
            return;
        }

        const data = await apiFetch(`${API_BASE}/api/sweeper/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                station_id: currentState.currentStationId,
                enabled: enabled,
                interval: interval,
                mode: 'random'
            })
        });

        applySweeperConfigUi(data);
        if (data?.reason === 'no_jingles') {
            showToast('Load at least one jingle before enabling auto sweeper', 'error');
        } else {
            showToast(data?.enabled ? `Sweeper enabled (every ${data.interval || interval} tracks)` : 'Sweeper disabled');
        }
        loadQueue();
    } catch (e) {
        showToast('Could not save sweeper settings', 'error');
        loadSweeperConfig();
    }
}

// ============================================
// STARTUP SOUND CONFIG
// ============================================

async function loadStartupSoundConfig() {
    try {
        const data = await apiFetch(`${API_BASE}/api/startup-sound/config?station_id=${currentState.currentStationId}`);
        const enabledEl = document.getElementById('startupSoundEnabled');
        const modeEl = document.getElementById('startupSoundMode');
        const trackEl = document.getElementById('startupSoundTrackId');
        const trackRow = document.getElementById('startupSoundTrackRow');

        if (enabledEl) enabledEl.checked = data.enabled;
        if (modeEl) modeEl.value = data.mode || 'random';

        // Populate jingle dropdown
        if (trackEl && data.jingles) {
            trackEl.innerHTML = '<option value="0">— Seçin —</option>';
            for (const j of data.jingles) {
                const opt = document.createElement('option');
                opt.value = j.id;
                opt.textContent = j.label;
                trackEl.appendChild(opt);
            }
            if (data.track_id > 0) trackEl.value = data.track_id;
        }

        // Show/hide track selector based on mode
        if (trackRow) {
            trackRow.style.display = (data.mode === 'specific') ? '' : 'none';
        }
    } catch (e) {
        console.error("Startup sound config load failed", e);
    }
}

function onStartupSoundModeChange() {
    const mode = document.getElementById('startupSoundMode')?.value || 'random';
    const trackRow = document.getElementById('startupSoundTrackRow');
    if (trackRow) {
        trackRow.style.display = (mode === 'specific') ? '' : 'none';
    }
}

async function saveStartupSoundConfig() {
    try {
        const enabled = document.getElementById('startupSoundEnabled')?.checked || false;
        const mode = document.getElementById('startupSoundMode')?.value || 'random';
        const trackId = parseInt(document.getElementById('startupSoundTrackId')?.value || '0');

        await apiFetch(`${API_BASE}/api/startup-sound/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                station_id: currentState.currentStationId,
                enabled: enabled,
                mode: mode,
                track_id: trackId
            })
        });

        const modeLabel = mode === 'random' ? 'rastgele jingle' : 'belirli ses';
        showToast(enabled ? `Başlangıç sesi aktif (${modeLabel})` : 'Başlangıç sesi kapatıldı');
    } catch (e) {
        showToast('Başlangıç sesi kaydedilemedi', 'error');
    }
}

async function uploadStartupSound(inputEl) {
    const file = inputEl.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('station_id', currentState.currentStationId);
    formData.append('file', file);

    try {
        const data = await apiFetch(`${API_BASE}/api/startup-sound/upload`, {
            method: 'POST',
            body: formData
        });

        if (data?.ok) {
            showToast(`"${data.title}" yüklendi`);
            // Reload dropdown to include new file, then auto-select it
            await loadStartupSoundConfig();
            const trackEl = document.getElementById('startupSoundTrackId');
            if (trackEl && data.track_id) {
                trackEl.value = data.track_id;
            }
        }
    } catch (e) {
        showToast('Ses dosyası yüklenemedi', 'error');
    }
    inputEl.value = '';
}

async function loadPlaylists() {
    try {
        const data = await apiFetch(`${API_BASE}/api/playlists?station_id=${currentState.currentStationId}`);
        const rows = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);

        const grid = document.getElementById('playlistGrid');
        if (grid) {
            grid.innerHTML = rows.map(p => `
                <div class="playlist-card" onclick="viewPlaylist(${p.id})">
                    <div class="playlist-card-icon">
                        <span class="material-icons-round">queue_music</span>
                    </div>
                    <div class="playlist-card-info">
                        <h4>${p.name}</h4>
                        <p>${p.description || 'No description'}</p>
                        <div class="playlist-meta">
                            <span>${p.item_count || 0} tracks</span>
                            <span class="badge">${String(p.playlist_type || 'manual').toUpperCase()}</span>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        const scheduleSelect = document.getElementById('schedulePlaylist');
        if (scheduleSelect) {
            scheduleSelect.innerHTML = rows.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        }
    } catch (e) { /* Error handled in apiFetch */ }
}

async function loadSchedule() {
    try {
        // Timeline verisi + normal schedule verisi
        const [timeline, scheduleData] = await Promise.all([
            apiFetch(`${API_BASE}/api/schedule/timeline?station_id=${currentState.currentStationId}`),
            apiFetch(`${API_BASE}/api/schedule?station_id=${currentState.currentStationId}`)
        ]);
        scheduleCache = Array.isArray(scheduleData)
            ? scheduleData
            : (Array.isArray(scheduleData?.items) ? scheduleData.items : []);
        const timelineBlocks = Array.isArray(timeline?.blocks)
            ? timeline.blocks
            : (Array.isArray(timeline?.items) ? timeline.items : []);

        // Gün etiketi
        const dayLabel = document.getElementById('timelineDayLabel');
        if (dayLabel) dayLabel.textContent = timeline.day_name || 'Today';

        // Saat işaretlerini oluştur
        const hoursEl = document.getElementById('timelineHours');
        if (hoursEl && !hoursEl.children.length) {
            let hoursHtml = '';
            for (let h = 0; h < 24; h++) {
                hoursHtml += `<div class="timeline-hour-mark"><span>${h.toString().padStart(2, '0')}</span></div>`;
            }
            hoursEl.innerHTML = hoursHtml;
        }

        // Timeline bloklarını çiz
        const blocksEl = document.getElementById('timelineBlocks');
        if (blocksEl) {
            blocksEl.innerHTML = timelineBlocks.map((b, i) => {
                const scheduleName = repairMojibakeText(b.schedule_name || b.event_name || b.playlist_name, b.playlist_name || 'Schedule');
                const startToken = String(b.start_time || '00:00');
                const endToken = String(b.end_time || startToken);
                const startParts = startToken.split(':');
                const endParts = endToken.split(':');
                const startMin = parseInt(startParts[0] || 0, 10) * 60 + parseInt(startParts[1] || 0, 10);
                const endMin = parseInt(endParts[0] || 0, 10) * 60 + parseInt(endParts[1] || 0, 10);
                const leftPct = (startMin / 1440) * 100;
                const widthPct = (Math.max(0, endMin - startMin) / 1440) * 100;
                const durMinutes = Math.round((Number(b.total_duration) || 0) / 60);
                return `<div class="timeline-block tblock-${i % 7}" 
                    style="left:${leftPct}%;width:${widthPct}%"
                    title="${scheduleName} (${startToken}-${endToken}) — ${b.track_count || 0} tracks, ${durMinutes}m">
                    <div>
                        <div class="timeline-block-text">${scheduleName}</div>
                        <div class="timeline-block-sub">${b.track_count || 0} tracks</div>
                    </div>
                </div>`;
            }).join('');
        }

        // Şu anki zaman çizgisi
        updateTimelineNow();

        // Detaylı liste
        const entriesEl = document.getElementById('scheduleEntries');
        if (entriesEl) {
            entriesEl.innerHTML = scheduleCache.map((s, i) => `
                <div class="schedule-entry">
                    <div class="schedule-entry-color tblock-${i % 7}" style="background:var(--accent)"></div>
                    <div class="schedule-entry-time">${s.start_time} — ${s.end_time}</div>
                    <div class="schedule-entry-info">
                        <div class="schedule-entry-name">${repairMojibakeText(s.schedule_name || s.event_name || s.playlist_name, s.playlist_name || 'Schedule')}</div>
                        <div class="schedule-entry-meta">Playlist: ${repairMojibakeText(s.playlist_name, 'Unknown')} · ${s.track_count || 0} tracks · ${formatDays(s.day_of_week)}</div>
                    </div>
                    <div class="schedule-entry-days">${formatDays(s.day_of_week)}</div>
                    <button class="btn-sm" onclick="editSchedule(${s.id})" title="Edit">
                        <span class="material-icons-round">edit</span>
                    </button>
                    <button class="btn-sm" onclick="deleteSchedule(${s.id})" title="Delete">
                        <span class="material-icons-round">delete</span>
                    </button>
                </div>
            `).join('');
        }
    } catch (e) {
        console.error("Schedule load failed", e);
    }
}

function updateTimelineNow() {
    const nowLine = document.getElementById('timelineNow');
    if (!nowLine) return;
    const now = new Date();
    const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
    const pct = (minutesSinceMidnight / 1440) * 100;
    nowLine.style.left = pct + '%';
    nowLine.style.display = 'block';
}

// Timeline'ı her dakika güncelle
setInterval(updateTimelineNow, 60000);

function initGlobalErrorHandlers() {
    if (window.__radioErrorHandlersBound) return;
    window.__radioErrorHandlersBound = true;

    window.addEventListener('error', (event) => {
        const message = clipText(event?.message || 'Unexpected frontend error', 200);
        const stackOrLocation = event?.error?.stack
            || `${event?.filename || 'app.js'}:${event?.lineno || 0}:${event?.colno || 0}`;
        const detail = clipText(stackOrLocation, 500);
        recordClientError({
            title: message,
            detail,
            source: 'window.error',
            level: 'error'
        });
        showToast({ message, detail }, 'error', { title: 'Frontend Error', duration: 11000 });
    });

    window.addEventListener('unhandledrejection', (event) => {
        let message = 'Unhandled promise rejection';
        let detail = '';
        const reason = event?.reason;
        if (reason instanceof Error) {
            message = clipText(reason.message || message, 200);
            detail = clipText(reason.stack || '', 500);
        } else {
            detail = clipText(String(reason ?? ''), 500);
        }
        recordClientError({
            title: message,
            detail,
            source: 'promise',
            level: 'error'
        });
        showToast({ message, detail }, 'error', { title: 'Frontend Error', duration: 11000 });
    });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeInlineJsString(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')
        .replace(/"/g, '\\x22')
        .replace(/'/g, "\\'")
        .replace(/</g, '\\x3C')
        .replace(/>/g, '\\x3E')
        .replace(/&/g, '\\x26');
}

function normalizeLogLevel(log) {
    const raw = String(log?.level || '').trim().toLowerCase();
    if (raw === 'error') return 'error';
    if (raw === 'warn' || raw === 'warning') return 'warn';
    if (raw === 'info') return 'info';

    const status = Number(log?.status_code || 0);
    if (status >= 500) return 'error';
    if (status >= 400) return 'warn';
    return 'info';
}

function logLevelLabel(level) {
    if (level === 'error') return 'ERROR';
    if (level === 'warn') return 'WARN';
    return 'INFO';
}

function logSourceLabel(log) {
    if (log?.log_type === 'play') return 'Playback';
    if (log?.log_type === 'operation') return 'API';
    if (log?.log_type === 'client') return 'UI';
    return 'System';
}

function logEventLabel(log) {
    if (log?.title) return String(log.title);
    if (log?.action) return String(log.action);
    return '-';
}

function logDetailLabel(log) {
    if (log?.log_type === 'play') {
        const artist = String(log?.artist || 'Unknown Artist');
        const trackType = String(log?.track_type || 'music');
        const dur = formatDuration(Number(log?.duration || 0));
        return `${artist} | ${trackType} | ${dur}`;
    }

    const pieces = [];
    if (log?.method || log?.endpoint) {
        pieces.push(`${log?.method || ''} ${log?.endpoint || ''}`.trim());
    }
    if (Number(log?.status_code || 0) > 0) {
        pieces.push(`HTTP ${log.status_code}`);
    }
    if (Number(log?.duration_ms || 0) > 0) {
        pieces.push(`${Math.round(Number(log.duration_ms || 0))} ms`);
    }
    if (log?.details) {
        pieces.push(String(log.details));
    } else if (log?.artist && log?.log_type !== 'play') {
        pieces.push(String(log.artist));
    }

    return pieces.filter(Boolean).join(' | ') || '-';
}

function getLogDateRange() {
    const from = document.getElementById('logDateFrom')?.value || '';
    const to = document.getElementById('logDateTo')?.value || '';
    const fromTs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toTs = to ? new Date(`${to}T23:59:59`).getTime() : null;
    return { from, to, fromTs, toTs };
}

function buildLogsQuery({ format = '', limit = 1000, perPage = 100 } = {}) {
    const { from, to } = getLogDateRange();
    const params = new URLSearchParams({
        station_id: String(currentState.currentStationId || 1),
        scope: 'all',
    });

    if (format) {
        params.set('format', format);
        params.set('limit', String(limit));
    } else {
        params.set('per_page', String(perPage));
    }

    if (from) params.set('date_from', `${from}T00:00:00`);
    if (to) params.set('date_to', `${to}T23:59:59`);
    return params.toString();
}

function logInRange(log, range) {
    const ts = new Date(log?.played_at || '').getTime();
    if (!Number.isFinite(ts)) return false;
    if (range.fromTs !== null && ts < range.fromTs) return false;
    if (range.toTs !== null && ts > range.toTs) return false;
    return true;
}

function mergedLogsForPanel() {
    const range = getLogDateRange();
    const serverLogs = Array.isArray(currentState.serverLogs) ? currentState.serverLogs : [];
    const clientLogs = Array.isArray(currentState.clientErrors) ? currentState.clientErrors : [];

    const combined = [
        ...serverLogs,
        ...clientLogs,
    ].filter(log => logInRange(log, range));

    combined.sort((a, b) => {
        const aTs = new Date(a?.played_at || 0).getTime() || 0;
        const bTs = new Date(b?.played_at || 0).getTime() || 0;
        return bTs - aTs;
    });

    return combined.slice(0, 250);
}

function renderLogErrorBanner(logs) {
    const banner = document.getElementById('logErrorBanner');
    if (!banner) return;

    const errorLogs = (logs || []).filter(l => normalizeLogLevel(l) === 'error');
    if (!errorLogs.length) {
        banner.style.display = 'none';
        banner.textContent = '';
        return;
    }

    const latest = errorLogs[0];
    const latestTs = latest?.played_at ? new Date(latest.played_at).toLocaleString('en-US') : '-';
    const latestEvent = clipText(logEventLabel(latest), 120);
    banner.style.display = 'flex';
    banner.textContent = `${errorLogs.length} error log(s) found. Latest: ${latestTs} | ${latestEvent}`;
}

function renderLogsTable(logs) {
    const tbody = document.getElementById('logTableBody');
    if (!tbody) return;

    if (!logs || !logs.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center;padding:20px;color:var(--text-secondary)">
                    No log records for selected range.
                </td>
            </tr>
        `;
        renderLogErrorBanner([]);
        return;
    }

    tbody.innerHTML = logs.map((log) => {
        const level = normalizeLogLevel(log);
        const source = logSourceLabel(log);
        const levelText = logLevelLabel(level);
        const ts = log?.played_at ? new Date(log.played_at).toLocaleString('en-US') : '-';
        const eventText = clipText(logEventLabel(log), 180);
        const detailText = clipText(logDetailLabel(log), 300);
        const rowClass = level === 'error' ? 'log-row-error' : (level === 'warn' ? 'log-row-warn' : '');

        return `
            <tr class="${rowClass}">
                <td>${escapeHtml(ts)}</td>
                <td><span class="badge badge-system">${escapeHtml(source)}</span></td>
                <td class="log-event-cell" title="${escapeHtml(logEventLabel(log))}">${escapeHtml(eventText)}</td>
                <td class="log-detail-cell" title="${escapeHtml(logDetailLabel(log))}">${escapeHtml(detailText)}</td>
                <td><span class="badge badge-level-${level}">${escapeHtml(levelText)}</span></td>
            </tr>
        `;
    }).join('');

    renderLogErrorBanner(logs);
}

function renderCombinedLogs() {
    const merged = mergedLogsForPanel();
    currentState.logs = merged;
    renderLogsTable(merged);
}

async function loadLogs() {
    const url = `${API_BASE}/api/logs?${buildLogsQuery({ perPage: 100 })}`;

    try {
        const data = await apiFetch(url);
        currentState.serverLogs = Array.isArray(data?.logs) ? data.logs : [];
        renderCombinedLogs();
    } catch (e) {
        console.error("Logs load failed", e);
        renderCombinedLogs();
    }
}

function exportLogs() {
    const url = `${API_BASE}/api/logs/export?${buildLogsQuery({ format: 'csv', limit: 1000 })}`;
    window.open(url, '_blank', 'noopener');
}

async function loadControlSettings(force = false) {
    try {
        await Promise.all([
            loadSharedSettings(force),
            loadStationScopedSettings(force),
            loadRuntimeInfo(),
            loadStartupSoundConfig()
        ]);
    } catch (e) {
        console.error('Settings load failed', e);
    }
}

async function loadSharedSettings(_force = false) {
    try {
        const data = await apiFetch(`${API_BASE}/api/settings/system`);
        const settings = { ...SYSTEM_SETTINGS_DEFAULTS, ...(data?.settings || {}) };
        currentState.sharedSettings = settings;
        applyDisplayBrandName(settings.display_brand_name);

        const uiLang = document.getElementById('sysUiLanguage');
        const crossfade = document.getElementById('sysCrossfadeSeconds');
        const opLogs = document.getElementById('sysOperationLogsEnabled');
        const autoScan = document.getElementById('sysAutoScanOnStartup');
        const displayBrand = document.getElementById('sysDisplayBrandName');

        if (uiLang) uiLang.value = settings.ui_language || 'en-US';
        if (crossfade) crossfade.value = String(settings.default_crossfade_seconds ?? 3.0);
        if (opLogs) opLogs.checked = !!settings.operation_logs_enabled;
        if (autoScan) autoScan.checked = !!settings.auto_scan_on_startup;
        if (displayBrand) displayBrand.value = normalizeDisplayBrandName(settings.display_brand_name);
    } catch (e) {
        showToast('Could not load shared settings', 'error');
    }
}

async function loadStationScopedSettings(_force = false) {
    try {
        const data = await apiFetch(`${API_BASE}/api/settings/station?station_id=${currentState.currentStationId}`);
        const settings = data?.settings || {};
        currentState.stationSettings = settings;

        const stationName = document.getElementById('settingsStationName');
        const timezone = document.getElementById('stTimezone');
        const gain = document.getElementById('stOutputGainDb');
        const outputMode = document.getElementById('stOutputMode');
        const speakerMonitor = document.getElementById('stSpeakerMonitorEnabled');
        const speakerMonitorHint = document.getElementById('stSpeakerMonitorHint');
        const tagline = document.getElementById('stTagline');
        const icecastHost = document.getElementById('stIcecastHost');
        const icecastPort = document.getElementById('stIcecastPort');
        const icecastMount = document.getElementById('stIcecastMount');
        const icecastUsername = document.getElementById('stIcecastUsername');
        const streamCodecProfile = document.getElementById('stStreamCodecProfile');
        const icecastPassword = document.getElementById('stIcecastPassword');
        const icecastName = document.getElementById('stIcecastStreamName');
        const icecastDescription = document.getElementById('stIcecastStreamDescription');
        const icecastGenre = document.getElementById('stIcecastStreamGenre');
        const icecastPublic = document.getElementById('stIcecastPublic');
        const autoTrim = document.getElementById('stAutoTrimImports');
        const autoIntro = document.getElementById('stAutoIntroCleanImports');
        const loudnessNorm = document.getElementById('stLoudnessNormalization');

        if (stationName) stationName.textContent = data?.station?.name || _currentStationName();
        if (timezone) timezone.value = settings.station_timezone || 'UTC';
        if (gain) gain.value = String(settings.output_gain_db ?? 0);
        if (outputMode) outputMode.value = settings.output_mode || 'speaker';
        if (speakerMonitor) speakerMonitor.checked = settings.speaker_monitor_enabled !== false;
        if (speakerMonitorHint) speakerMonitorHint.textContent = 'In speaker mode this stays enabled.';
        if (tagline) tagline.value = settings.station_tagline || '';
        if (icecastHost) icecastHost.value = settings.icecast_host || '127.0.0.1';
        if (icecastPort) icecastPort.value = String(settings.icecast_port ?? 8000);
        if (icecastMount) icecastMount.value = settings.icecast_mount || '/live';
        if (icecastUsername) icecastUsername.value = settings.icecast_username || 'source';
        if (streamCodecProfile) {
            streamCodecProfile.value = settings.stream_codec_profile || 'aac_192';
            if (!streamCodecProfile.value) streamCodecProfile.value = 'aac_192';
        }
        if (icecastPassword) icecastPassword.value = settings.icecast_password || '';
        if (icecastName) icecastName.value = settings.icecast_stream_name || 'RadioTEDU OnAir';
        if (icecastDescription) icecastDescription.value = settings.icecast_stream_description || settings.icecast_stream_name || '';
        if (icecastGenre) icecastGenre.value = settings.icecast_stream_genre || 'Various';
        if (icecastPublic) icecastPublic.checked = !!settings.icecast_public;
        if (autoTrim) autoTrim.checked = !!settings.auto_trim_imports;
        if (autoIntro) autoIntro.checked = !!settings.auto_intro_clean_imports;
        if (loudnessNorm) loudnessNorm.checked = settings.loudness_normalization_enabled !== false;
        toggleStationOutputModeUi();
    } catch (e) {
        showToast('Could not load station settings', 'error');
    }
}

function toggleStationOutputModeUi() {
    const outputMode = document.getElementById('stOutputMode')?.value || 'speaker';
    const speakerMonitor = document.getElementById('stSpeakerMonitorEnabled');
    const speakerMonitorHint = document.getElementById('stSpeakerMonitorHint');
    document.querySelectorAll('.icecast-field').forEach((el) => {
        el.style.display = outputMode === 'icecast' ? '' : 'none';
    });
    if (speakerMonitor) {
        if (outputMode === 'speaker') {
            speakerMonitor.checked = true;
            speakerMonitor.disabled = true;
            if (speakerMonitorHint) {
                speakerMonitorHint.textContent = 'Speaker mode requires local speaker output.';
            }
        } else {
            speakerMonitor.disabled = false;
            if (speakerMonitorHint) {
                speakerMonitorHint.textContent = 'Enable or disable local speaker monitor while streaming to Icecast.';
            }
        }
    }
}

async function loadRuntimeInfo() {
    const container = document.getElementById('settingsInfo');
    if (!container) return;
    try {
        const data = await apiFetch(`${API_BASE}/api/health?station_id=${currentState.currentStationId}`);
        const outputMode = data.output_mode || 'speaker';
        const speakerMonitor = outputMode === 'speaker'
            ? true
            : !!data.speaker_monitor_enabled;
        container.innerHTML = `
            <div class="settings-row"><span class="label">Station</span><span class="value">${data.station_name || _currentStationName()}</span></div>
            <div class="settings-row"><span class="label">System Reliability</span><span class="value">${escapeHtml(String(data.overall_state || 'unknown').toUpperCase())}</span></div>
            <div class="settings-row"><span class="label">Database Integrity</span><span class="value">${escapeHtml(String(data.database?.integrity || 'unknown'))}</span></div>
            <div class="settings-row"><span class="label">Database Durability</span><span class="value">${escapeHtml(String(data.database?.journal_mode || 'unknown').toUpperCase())} / ${escapeHtml(String(data.database?.synchronous || 'unknown').toUpperCase())}</span></div>
            <div class="settings-row"><span class="label">Storage Free</span><span class="value">${Number(data.database?.disk_free_percent || 0).toFixed(1)}%</span></div>
            <div class="settings-row"><span class="label">Active Broadcast Station</span><span class="value">${data.active_station_id ?? '-'}</span></div>
            <div class="settings-row"><span class="label">Playback Output</span><span class="value">${outputMode === 'icecast' ? 'Icecast' : 'Speaker (Local)'}</span></div>
            <div class="settings-row"><span class="label">Speaker Monitor</span><span class="value">${speakerMonitor ? 'Enabled' : 'Disabled'}</span></div>
            <div class="settings-row"><span class="label">Library Tracks</span><span class="value">${data.tracks_in_library ?? 0}</span></div>
            <div class="settings-row"><span class="label">Engine Connection</span><span class="value">${data.liquidsoap_connected ? 'Connected' : 'Disconnected'}</span></div>
            <div class="settings-row"><span class="label">Music Folder</span><span class="value">${data.music_dir || '-'}</span></div>
            <div class="settings-row"><span class="label">Jingle Folder</span><span class="value">${data.jingle_dir || '-'}</span></div>
            <div class="settings-row"><span class="label">Ads Folder</span><span class="value">${data.ads_dir || '-'}</span></div>
        `;
    } catch (e) {
        container.innerHTML = `<div class="settings-row"><span class="label">Status</span><span class="value">Runtime info unavailable</span></div>`;
    }
}

// ============================================
// ENGINE RESTART CONFIRMATION MODAL
// ============================================
let _restartConfirmResolve = null;

function showRestartConfirmModal(changedFields) {
    const modal = document.getElementById('restartConfirmModal');
    const changesEl = document.getElementById('restartConfirmChanges');
    if (!modal || !changesEl) return Promise.resolve(true); // fallback: auto-confirm

    if (changedFields.length > 0) {
        changesEl.innerHTML = '<strong style="display:block;margin-bottom:6px">Changed settings (engine restart needed):</strong>' +
            changedFields.map(f => `<div style="padding:2px 0">• ${escapeHtml(f)}</div>`).join('');
    } else {
        changesEl.innerHTML = '<em>Engine configuration has changed.</em>';
    }
    modal.style.display = 'flex';
    return new Promise(resolve => {
        _restartConfirmResolve = resolve;
    });
}

function closeRestartConfirmModal(confirmed) {
    const modal = document.getElementById('restartConfirmModal');
    if (modal) modal.style.display = 'none';
    if (_restartConfirmResolve) {
        _restartConfirmResolve(!!confirmed);
        _restartConfirmResolve = null;
    }
}
window.closeRestartConfirmModal = closeRestartConfirmModal;

// Engine-restart-affecting station setting keys (changes to these trigger engine restart)
const ENGINE_AFFECTING_STATION_KEYS = [
    'output_mode', 'output_gain_db', 'speaker_monitor_enabled',
    'loudness_normalization_enabled',
    'icecast_host', 'icecast_port', 'icecast_mount',
    'icecast_username', 'icecast_password',
    'icecast_stream_name', 'icecast_stream_description',
    'icecast_stream_genre', 'icecast_public'
];

const ENGINE_SETTING_LABELS = {
    output_mode: 'Playback Output',
    output_gain_db: 'Output Gain (dB)',
    speaker_monitor_enabled: 'Speaker Monitor',
    loudness_normalization_enabled: 'Loudness Normalization',
    icecast_host: 'Icecast Host',
    icecast_port: 'Icecast Port',
    icecast_mount: 'Icecast Mount',
    icecast_username: 'Icecast Username',
    icecast_password: 'Icecast Password',
    icecast_stream_name: 'Stream Name',
    icecast_stream_description: 'Stream Description',
    icecast_stream_genre: 'Stream Genre',
    icecast_public: 'Public Stream Listing',
    default_crossfade_seconds: 'Default Crossfade'
};

function _detectEngineAffectingChanges(payload, savedSettings, affectingKeys) {
    const changed = [];
    for (const key of affectingKeys) {
        if (!(key in payload)) continue;
        const newVal = payload[key];
        const oldVal = savedSettings[key];
        // Compare appropriately
        const newStr = String(newVal ?? '');
        const oldStr = String(oldVal ?? '');
        if (newStr !== oldStr) {
            const label = ENGINE_SETTING_LABELS[key] || key;
            changed.push(label);
        }
    }
    return changed;
}

async function saveSystemSettings() {
    const crossfadeInput = document.getElementById('sysCrossfadeSeconds');
    const uiLanguageInput = document.getElementById('sysUiLanguage');
    const opLogsInput = document.getElementById('sysOperationLogsEnabled');
    const autoScanInput = document.getElementById('sysAutoScanOnStartup');
    const displayBrandInput = document.getElementById('sysDisplayBrandName');

    const crossfade = Number(crossfadeInput?.value ?? 3.0);
    if (!Number.isFinite(crossfade)) {
        showToast('Default crossfade must be numeric', 'error');
        return;
    }

    const payload = {
        ui_language: uiLanguageInput?.value || 'en-US',
        default_crossfade_seconds: crossfade,
        operation_logs_enabled: !!opLogsInput?.checked,
        auto_scan_on_startup: !!autoScanInput?.checked,
        display_brand_name: normalizeDisplayBrandName(displayBrandInput?.value),
    };

    // Check if crossfade changed (triggers engine restart for all stations)
    const savedCrossfade = Number(currentState.sharedSettings?.default_crossfade_seconds ?? 3.0);
    if (Math.abs(crossfade - savedCrossfade) > 0.001) {
        const confirmed = await showRestartConfirmModal(['Default Crossfade']);
        if (!confirmed) return;
    }

    try {
        await apiFetch(`${API_BASE}/api/settings/system`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showToast('Shared settings saved');
        await loadSharedSettings(true);
    } catch (e) {
        showToast('Could not save shared settings', 'error');
    }
}

async function saveStationSettings() {
    const timezoneInput = document.getElementById('stTimezone');
    const gainInput = document.getElementById('stOutputGainDb');
    const outputModeInput = document.getElementById('stOutputMode');
    const speakerMonitorInput = document.getElementById('stSpeakerMonitorEnabled');
    const taglineInput = document.getElementById('stTagline');
    const icecastHostInput = document.getElementById('stIcecastHost');
    const icecastPortInput = document.getElementById('stIcecastPort');
    const icecastMountInput = document.getElementById('stIcecastMount');
    const icecastUserInput = document.getElementById('stIcecastUsername');
    const streamCodecProfileInput = document.getElementById('stStreamCodecProfile');
    const icecastPassInput = document.getElementById('stIcecastPassword');
    const icecastNameInput = document.getElementById('stIcecastStreamName');
    const icecastDescriptionInput = document.getElementById('stIcecastStreamDescription');
    const icecastGenreInput = document.getElementById('stIcecastStreamGenre');
    const icecastPublicInput = document.getElementById('stIcecastPublic');
    const autoTrimInput = document.getElementById('stAutoTrimImports');
    const autoIntroInput = document.getElementById('stAutoIntroCleanImports');
    const loudnessNormInput = document.getElementById('stLoudnessNormalization');

    const gain = Number(gainInput?.value ?? 0);
    const outputMode = (outputModeInput?.value || 'speaker').toLowerCase() === 'icecast' ? 'icecast' : 'speaker';
    const speakerMonitorEnabled = outputMode === 'speaker' ? true : !!speakerMonitorInput?.checked;
    const icecastPort = Number(icecastPortInput?.value ?? 8000);
    if (!Number.isFinite(gain)) {
        showToast('Output gain must be numeric', 'error');
        return;
    }
    if (outputMode === 'icecast' && (!Number.isFinite(icecastPort) || icecastPort < 1 || icecastPort > 65535)) {
        showToast('Icecast port must be between 1 and 65535', 'error');
        return;
    }

    const icecastPasswordValue = (icecastPassInput?.value || '').trim();
    const streamCodecProfile = streamCodecProfileInput?.value || 'aac_192';
    const streamBitrate = Number(
        streamCodecProfileInput?.selectedOptions?.[0]?.dataset?.bitrate ?? 192
    );
    const payload = {
        station_id: Number(currentState.currentStationId),
        station_timezone: timezoneInput?.value || 'UTC',
        output_gain_db: gain,
        output_mode: outputMode,
        speaker_monitor_enabled: speakerMonitorEnabled,
        station_tagline: taglineInput?.value || '',
        icecast_host: icecastHostInput?.value || '127.0.0.1',
        icecast_port: Number.isFinite(icecastPort) && icecastPort > 0 ? Math.round(icecastPort) : 8000,
        icecast_mount: icecastMountInput?.value || '/live',
        icecast_username: icecastUserInput?.value || 'source',
        stream_codec_profile: streamCodecProfile,
        stream_bitrate_kbps: Number.isFinite(streamBitrate) ? streamBitrate : 192,
        icecast_stream_name: icecastNameInput?.value || 'RadioTEDU OnAir',
        icecast_stream_description: icecastDescriptionInput?.value || '',
        icecast_stream_genre: icecastGenreInput?.value || 'Various',
        icecast_public: !!icecastPublicInput?.checked,
        auto_trim_imports: !!autoTrimInput?.checked,
        auto_intro_clean_imports: !!autoIntroInput?.checked,
        loudness_normalization_enabled: !!loudnessNormInput?.checked
    };
    if (icecastPasswordValue) {
        payload.icecast_password = icecastPasswordValue;
    }

    // Detect if any engine-affecting settings have changed
    const saved = currentState.stationSettings || {};
    const changedFields = _detectEngineAffectingChanges(payload, saved, ENGINE_AFFECTING_STATION_KEYS);
    if (changedFields.length > 0) {
        const confirmed = await showRestartConfirmModal(changedFields);
        if (!confirmed) return;
    }

    try {
        const data = await apiFetch(`${API_BASE}/api/settings/station`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const restartRequested = !!data?.output_runtime?.restart_requested;
        showToast(restartRequested ? 'Station settings saved. Audio engine restarting...' : 'Station settings saved');
        await loadStationScopedSettings(true);
        await loadRuntimeInfo();
    } catch (e) {
        showToast('Could not save station settings', 'error');
    }
}

// ============================================
// MODALS & FORMS
// ============================================

function showCreatePlaylist() {
    document.getElementById('createPlaylistModal').style.display = 'flex';
}

async function createPlaylist() {
    const name = document.getElementById('newPlaylistName').value;
    const description = document.getElementById('newPlaylistDesc').value;

    if (!name) return showToast("Playlist name is required", "error");

    try {
        const result = await apiFetch(`${API_BASE}/api/playlists`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, station_id: currentState.currentStationId })
        });

        document.getElementById('createPlaylistModal').style.display = 'none';
        document.getElementById('newPlaylistName').value = '';
        document.getElementById('newPlaylistDesc').value = '';

        showToast("Playlist created successfully");
        _playlistCache = [];
        await loadPlaylists();

        if (result && result.playlist_id) {
            viewPlaylist(result.playlist_id);
        }
    } catch (e) { /* Error handled in apiFetch */ }
}

function setSelectOptions(selectId, allLabel, values) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const opts = (values || []).map(v => `<option value="${v}">${v}</option>`).join('');
    select.innerHTML = `<option value="">${allLabel}</option>${opts}`;
}

function setDatalistOptions(listId, values) {
    const list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = (values || []).map(v => `<option value="${v}"></option>`).join('');
}

async function loadAutoPlaylistFilters() {
    if (autoPlaylistFilterStation === currentState.currentStationId) return;

    const data = await apiFetch(`${API_BASE}/api/tracks/filters/options?station_id=${currentState.currentStationId}`);
    setDatalistOptions('autoPlaylistArtistList', data.artists || []);
    setSelectOptions('autoPlaylistGenre', 'All Genres', data.genres || []);
    autoPlaylistFilterStation = currentState.currentStationId;
}

async function showAutoPlaylistModal() {
    document.getElementById('autoPlaylistModal').style.display = 'flex';
    try {
        await loadAutoPlaylistFilters();
    } catch (e) { /* Error handled in apiFetch */ }
}

function closeAutoPlaylistModal() {
    document.getElementById('autoPlaylistModal').style.display = 'none';
}

async function createAutoPlaylist() {
    const name = document.getElementById('autoPlaylistName').value.trim();
    const description = document.getElementById('autoPlaylistDesc').value.trim();
    const artist = document.getElementById('autoPlaylistArtist').value;
    const genre = document.getElementById('autoPlaylistGenre').value;
    const trackType = document.getElementById('autoPlaylistType').value;
    const bpmMinRaw = document.getElementById('autoPlaylistBpmMin').value;
    const bpmMaxRaw = document.getElementById('autoPlaylistBpmMax').value;
    const limitRaw = document.getElementById('autoPlaylistLimit').value;
    const sortBy = document.getElementById('autoPlaylistSort').value;

    if (!name) return showToast('Playlist name is required', 'error');

    const bpmMin = bpmMinRaw === '' ? null : Number(bpmMinRaw);
    const bpmMax = bpmMaxRaw === '' ? null : Number(bpmMaxRaw);
    if ((bpmMin !== null && Number.isNaN(bpmMin)) || (bpmMax !== null && Number.isNaN(bpmMax))) {
        return showToast('Invalid BPM value', 'error');
    }

    const limit = Math.max(1, Math.min(parseInt(limitRaw || '50', 10), 500));

    try {
        const result = await apiFetch(`${API_BASE}/api/playlists/auto/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                description,
                station_id: currentState.currentStationId,
                artist: artist || null,
                genre: genre || null,
                track_type: trackType || 'any',
                bpm_min: bpmMin,
                bpm_max: bpmMax,
                limit,
                sort_by: sortBy || 'random'
            })
        });

        showToast(`Playlist created with ${result.track_count || 0} tracks`);
        closeAutoPlaylistModal();
        _playlistCache = [];
        await loadPlaylists();

        if (result.playlist_id) {
            viewPlaylist(result.playlist_id);
        }
    } catch (e) { /* Error handled in apiFetch */ }
}

function setScheduleModalMode(schedule = null) {
    const titleEl = document.getElementById('scheduleModalTitle');
    const saveBtn = document.getElementById('scheduleSaveBtn');

    if (!schedule) {
        scheduleEditorState.scheduleId = null;
        if (titleEl) titleEl.textContent = 'New Schedule';
        if (saveBtn) saveBtn.textContent = 'Create';
        return;
    }

    scheduleEditorState.scheduleId = schedule.id;
    if (titleEl) titleEl.textContent = 'Edit Schedule';
    if (saveBtn) saveBtn.textContent = 'Update';
}

function closeScheduleModal() {
    document.getElementById('createScheduleModal').style.display = 'none';
    setScheduleModalMode(null);
}

async function showCreateSchedule() {
    let playlistSelect = document.getElementById('schedulePlaylist');
    if (playlistSelect && playlistSelect.options.length === 0) {
        await loadPlaylists();
        playlistSelect = document.getElementById('schedulePlaylist');
    }
    const startInput = document.getElementById('scheduleStart');
    const endInput = document.getElementById('scheduleEnd');
    const daySelect = document.getElementById('scheduleDays');
    const eventNameInput = document.getElementById('scheduleEventName');

    if (playlistSelect && playlistSelect.options.length > 0) {
        playlistSelect.selectedIndex = 0;
    }
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    if (daySelect) daySelect.value = '*';
    if (eventNameInput) eventNameInput.value = '';

    setScheduleModalMode(null);
    document.getElementById('createScheduleModal').style.display = 'flex';
}

async function editSchedule(id) {
    const schedule = scheduleCache.find(s => s.id === id);
    if (!schedule) return showToast('Schedule not found', 'error');

    let playlistSelect = document.getElementById('schedulePlaylist');
    if (playlistSelect && playlistSelect.options.length === 0) {
        await loadPlaylists();
        playlistSelect = document.getElementById('schedulePlaylist');
    }
    const startInput = document.getElementById('scheduleStart');
    const endInput = document.getElementById('scheduleEnd');
    const daySelect = document.getElementById('scheduleDays');
    const eventNameInput = document.getElementById('scheduleEventName');

    if (playlistSelect) {
        const playlistIdStr = String(schedule.playlist_id);
        const hasOption = Array.from(playlistSelect.options).some(o => o.value === playlistIdStr);
        if (!hasOption) {
            const opt = document.createElement('option');
            opt.value = playlistIdStr;
            opt.textContent = schedule.playlist_name || `Playlist ${playlistIdStr}`;
            playlistSelect.appendChild(opt);
        }
        playlistSelect.value = playlistIdStr;
    }
    if (startInput) startInput.value = schedule.start_time || '';
    if (endInput) endInput.value = schedule.end_time || '';
    if (daySelect) daySelect.value = schedule.day_of_week || '*';
    if (eventNameInput) eventNameInput.value = schedule.event_name || '';

    setScheduleModalMode(schedule);
    document.getElementById('createScheduleModal').style.display = 'flex';
}

async function createSchedule() {
    const playlist_id = document.getElementById('schedulePlaylist').value;
    const event_name = document.getElementById('scheduleEventName').value.trim();
    const start_time = document.getElementById('scheduleStart').value;
    const end_time = document.getElementById('scheduleEnd').value;
    const day_of_week = document.getElementById('scheduleDays').value;
    const isEdit = scheduleEditorState.scheduleId !== null;

    if (!start_time || !end_time) return showToast("Start and end times are required", "error");

    try {
        await apiFetch(isEdit ? `${API_BASE}/api/schedule/${scheduleEditorState.scheduleId}` : `${API_BASE}/api/schedule`, {
            method: isEdit ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playlist_id, event_name, start_time, end_time, day_of_week, station_id: currentState.currentStationId })
        });
        closeScheduleModal();
        showToast(isEdit ? "Schedule updated successfully" : "Schedule saved successfully");
        await loadSchedule();
    } catch (e) { /* Error handled in apiFetch */ }
}

async function deleteSchedule(id) {
    if (!confirm("Are you sure you want to delete this schedule?")) return;
    try {
        await apiFetch(
            `${API_BASE}/api/schedule/${id}?station_id=${currentState.currentStationId}`,
            { method: 'DELETE' }
        );
        showToast("Schedule deleted");
        loadSchedule();
    } catch (e) { /* Error handled in apiFetch */ }
}

// ============================================
// ADS PANEL
// ============================================

function todayIsoDate() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function datePlusIso(days = 0) {
    const d = new Date();
    d.setDate(d.getDate() + Number(days || 0));
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function formatAdDaySpec(spec) {
    const text = String(spec || '*').trim();
    if (!text || text === '*') return 'Every Day';
    if (text === '0,1,2,3,4') return 'Weekdays';
    if (text === '5,6') return 'Weekend';
    return formatDays(text);
}

function normalizeAdSlotToken(token) {
    const raw = String(token || '').trim();
    if (!raw) return '';
    const hourOnly = raw.match(/^(\d{1,2})$/);
    if (hourOnly) {
        const hour = Number(hourOnly[1]);
        if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
            return `${String(hour).padStart(2, '0')}:00`;
        }
        return '';
    }
    const match = raw.match(/^(\d{1,2})[:.](\d{1,2})$/);
    if (!match) return '';
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return '';
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseAdSlotInput(rawText) {
    const tokens = String(rawText || '')
        .split(/[\s,;]+/)
        .map(t => t.trim())
        .filter(Boolean);

    const seen = new Set();
    const times = [];
    const invalid = [];

    for (const token of tokens) {
        const normalized = normalizeAdSlotToken(token);
        if (!normalized) {
            invalid.push(token);
            continue;
        }
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        times.push(normalized);
    }

    return { times, invalid };
}

function buildAdIntervalSlots(intervalMinutes) {
    const step = Math.max(1, Number.parseInt(String(intervalMinutes || 60), 10) || 60);
    const times = [];
    for (let minuteOfDay = 0; minuteOfDay < 1440; minuteOfDay += step) {
        const hour = Math.floor(minuteOfDay / 60);
        const minute = minuteOfDay % 60;
        times.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    }
    return times.join(',');
}

const AD_BREAK_PRESETS = {
    morning: {
        name: 'Morning Breaks',
        description: 'Quick preset',
        daySpec: '0,1,2,3,4',
        slots: '08:00,10:00,12:00',
    },
    drive: {
        name: 'Drive Time Breaks',
        description: 'Quick preset',
        daySpec: '0,1,2,3,4',
        slots: '17:00,18:00,19:00',
    },
    hourly: {
        name: 'Hourly Breaks',
        description: 'Quick preset',
        daySpec: '*',
        slots: buildAdIntervalSlots(60),
    },
    half_hour: {
        name: 'Every 30 Minutes',
        description: 'Quick preset',
        daySpec: '*',
        slots: buildAdIntervalSlots(30),
    },
    quarter_hour: {
        name: 'Every 15 Minutes',
        description: 'Quick preset',
        daySpec: '*',
        slots: buildAdIntervalSlots(15),
    },
    forty_five: {
        name: 'Every 45 Minutes',
        description: 'Quick preset',
        daySpec: '*',
        slots: buildAdIntervalSlots(45),
    },
    weekend: {
        name: 'Weekend Breaks',
        description: 'Quick preset',
        daySpec: '5,6',
        slots: '10:00,12:00,14:00,18:00',
    },
};

function applyAdBreakPreset(presetKey) {
    const preset = AD_BREAK_PRESETS[String(presetKey || '').trim()];
    if (!preset) return;
    const nameEl = document.getElementById('adBreakSetName');
    const descEl = document.getElementById('adBreakSetDescription');
    const slotsEl = document.getElementById('adBreakSetSlots');
    const daysEl = document.getElementById('adBreakSetDays');
    const activeEl = document.getElementById('adBreakSetActive');
    if (nameEl && !(nameEl.value || '').trim()) nameEl.value = preset.name;
    if (descEl && !(descEl.value || '').trim()) descEl.value = preset.description;
    if (slotsEl) slotsEl.value = preset.slots;
    if (daysEl) daysEl.value = preset.daySpec;
    if (activeEl) activeEl.checked = true;
}

function getMultiSelectValues(selectId) {
    const select = document.getElementById(selectId);
    return getMultiSelectValuesFromElement(select);
}

function getMultiSelectValuesFromElement(selectEl) {
    if (!selectEl) return [];
    return Array.from(selectEl.selectedOptions)
        .map(opt => Number(opt.value))
        .filter(v => Number.isInteger(v) && v > 0);
}

function setMultiSelectValues(selectEl, values) {
    if (!selectEl) return;
    const rawValues = Array.isArray(values) ? values : [];
    const scopedValues = selectEl.multiple ? rawValues : rawValues.slice(0, 1);
    const selected = new Set(scopedValues.map(v => String(v)));
    Array.from(selectEl.options).forEach(option => {
        option.selected = selected.has(String(option.value));
    });
}

function ensureMultiOption(selectEl, value, label) {
    if (!selectEl) return;
    const valueText = String(value);
    const exists = Array.from(selectEl.options).some(opt => String(opt.value) === valueText);
    if (exists) return;
    const option = document.createElement('option');
    option.value = valueText;
    option.textContent = label;
    option.dataset.synthetic = '1';
    selectEl.appendChild(option);
}

function getFlatAdSlots() {
    const breakSets = Array.isArray(currentState.adsBreakSets) ? currentState.adsBreakSets : [];
    const rows = [];
    breakSets.forEach(set => {
        const slots = Array.isArray(set?.slots) ? set.slots : [];
        slots.forEach(slot => {
            rows.push({
                slot_id: Number(slot.id || slot.slot_id || 0),
                slot_time: String(slot.slot_time || ''),
                day_of_week: String(slot.day_of_week || '*'),
                position: Number(slot.position || 0),
                is_active: !!slot.is_active,
                break_set_id: Number(set.id || 0),
                break_set_name: String(set.name || ''),
                break_set_active: !!set.is_active,
            });
        });
    });

    rows.sort((a, b) => {
        const at = String(a.slot_time || '');
        const bt = String(b.slot_time || '');
        if (at !== bt) return at.localeCompare(bt);
        const ap = Number(a.position || 0);
        const bp = Number(b.position || 0);
        if (ap !== bp) return ap - bp;
        return Number(a.slot_id || 0) - Number(b.slot_id || 0);
    });
    return rows.filter(row => Number.isInteger(row.slot_id) && row.slot_id > 0);
}

function getSlotIdsByBreakSetId(breakSetId) {
    const targetId = Number(breakSetId || 0);
    if (!Number.isInteger(targetId) || targetId <= 0) return [];
    return getFlatAdSlots()
        .filter(row => Number(row.break_set_id || 0) === targetId)
        .map(row => Number(row.slot_id || 0))
        .filter(id => Number.isInteger(id) && id > 0);
}

function inferBreakSetFromSlotIds(slotIds) {
    const ids = Array.isArray(slotIds) ? slotIds : [];
    if (!ids.length) return 0;
    const slotMap = new Map(getFlatAdSlots().map(row => [Number(row.slot_id || 0), Number(row.break_set_id || 0)]));
    const setIds = new Set();
    for (const rawId of ids) {
        const slotId = Number(rawId || 0);
        const breakSetId = Number(slotMap.get(slotId) || 0);
        if (breakSetId > 0) setIds.add(breakSetId);
    }
    if (setIds.size !== 1) return 0;
    return Array.from(setIds)[0];
}

function inferBreakSetIdsFromSlotIds(slotIds) {
    const ids = Array.isArray(slotIds) ? slotIds : [];
    if (!ids.length) return [];
    const slotMap = new Map(getFlatAdSlots().map(row => [Number(row.slot_id || 0), Number(row.break_set_id || 0)]));
    const setIds = new Set();
    ids.forEach(rawId => {
        const slotId = Number(rawId || 0);
        const breakSetId = Number(slotMap.get(slotId) || 0);
        if (breakSetId > 0) setIds.add(breakSetId);
    });
    return Array.from(setIds).sort((a, b) => a - b);
}

function expandSlotIdsFromBreakSetIds(breakSetIds) {
    const setIds = Array.isArray(breakSetIds) ? breakSetIds : [];
    const merged = new Set();
    setIds.forEach(rawSetId => {
        const setId = Number(rawSetId || 0);
        if (!Number.isInteger(setId) || setId <= 0) return;
        const slotIds = getSlotIdsByBreakSetId(setId);
        slotIds.forEach(slotId => merged.add(Number(slotId || 0)));
    });
    return Array.from(merged)
        .filter(id => Number.isInteger(id) && id > 0)
        .sort((a, b) => a - b);
}

function renderAdCampaignBreakSetOptionsFor(selectId, selectedIds = null) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const selected = Array.isArray(selectedIds) ? selectedIds : getMultiSelectValuesFromElement(select);
    const sets = Array.isArray(currentState.adsBreakSets) ? currentState.adsBreakSets : [];

    if (!sets.length) {
        select.innerHTML = '';
        return;
    }

    const sorted = sets.slice().sort((a, b) => {
        const an = String(a?.name || '').toLowerCase();
        const bn = String(b?.name || '').toLowerCase();
        if (an !== bn) return an.localeCompare(bn);
        return Number(a?.id || 0) - Number(b?.id || 0);
    });

    select.innerHTML = sorted.map(set => {
        const setId = Number(set.id || 0);
        const setName = escapeHtml(set.name || `Break Set #${setId}`);
        const slotCount = Array.isArray(set.slots) ? set.slots.length : 0;
        const inactiveTag = set.is_active ? '' : ' [inactive]';
        return `<option value="${setId}">${setName} (${slotCount} slots)${inactiveTag}</option>`;
    }).join('');
    setMultiSelectValues(select, selected);
}

function renderAdCampaignBreakSetOptions(selectedIds = null) {
    renderAdCampaignBreakSetOptionsFor('adCampaignBreakSets', selectedIds);
}

function renderAdCampaignEditBreakSetOptions(selectedIds = null) {
    renderAdCampaignBreakSetOptionsFor('adCampaignEditBreakSets', selectedIds);
}

function selectAllCampaignBreakSets() {
    const select = document.getElementById('adCampaignBreakSets');
    if (!select) return;
    const setIds = (Array.isArray(currentState.adsBreakSets) ? currentState.adsBreakSets : [])
        .map(set => Number(set.id || 0))
        .filter(id => Number.isInteger(id) && id > 0);
    if (!setIds.length) {
        showToast('No break set available', 'warning');
        return;
    }
    setMultiSelectValues(select, setIds);
}

function clearCampaignBreakSets() {
    const select = document.getElementById('adCampaignBreakSets');
    if (!select) return;
    setMultiSelectValues(select, []);
}

function selectAllCampaignEditBreakSets() {
    const select = document.getElementById('adCampaignEditBreakSets');
    if (!select) return;
    const setIds = (Array.isArray(currentState.adsBreakSets) ? currentState.adsBreakSets : [])
        .map(set => Number(set.id || 0))
        .filter(id => Number.isInteger(id) && id > 0);
    if (!setIds.length) {
        showToast('No break set available', 'warning');
        return;
    }
    setMultiSelectValues(select, setIds);
}

function clearCampaignEditBreakSets() {
    const select = document.getElementById('adCampaignEditBreakSets');
    if (!select) return;
    setMultiSelectValues(select, []);
}

function renderCampaignBreakSetQuickOptionsTo(selectId, selectedBreakSetId = null) {
    const quickSelect = document.getElementById(selectId);
    if (!quickSelect) return;
    const selectedValue = selectedBreakSetId !== null && selectedBreakSetId !== undefined
        ? Number(selectedBreakSetId || 0)
        : Number(quickSelect.value || 0);
    const sets = Array.isArray(currentState.adsBreakSets) ? currentState.adsBreakSets : [];
    quickSelect.innerHTML = [
        '<option value="">Choose break set...</option>',
        ...sets.map(set => {
            const setId = Number(set.id || 0);
            const slotCount = Array.isArray(set.slots) ? set.slots.length : 0;
            const inactiveTag = set.is_active ? '' : ' [inactive]';
            const setName = escapeHtml(set.name || `Break Set #${setId}`);
            return `<option value="${setId}">${setName} (${slotCount} slots)${inactiveTag}</option>`;
        }),
    ].join('');
    if (selectedValue > 0) {
        quickSelect.value = String(selectedValue);
    }
}

function renderCampaignBreakSetQuickOptions(selectedBreakSetId = null) {
    renderCampaignBreakSetQuickOptionsTo('adCampaignBreakSetQuick', selectedBreakSetId);
}

function renderAdCampaignEditQuickOptions(selectedBreakSetId = null) {
    renderCampaignBreakSetQuickOptionsTo('adCampaignEditBreakSetQuick', selectedBreakSetId);
}

function selectCampaignSlotsByBreakSet() {
    const breakSetSelect = document.getElementById('adCampaignBreakSetQuick');
    const slotSelect = document.getElementById('adCampaignSlots');
    if (!breakSetSelect || !slotSelect) return;
    const breakSetId = Number(breakSetSelect.value || 0);
    if (!breakSetId) {
        showToast('Choose a break set first', 'warning');
        return;
    }
    const slotIds = getSlotIdsByBreakSetId(breakSetId);
    if (!slotIds.length) {
        showToast('Selected break set has no slot', 'warning');
        return;
    }
    setMultiSelectValues(slotSelect, slotIds);
    showToast(`${slotIds.length} slot selected`);
}

function selectCampaignEditSlotsByBreakSet() {
    const breakSetSelect = document.getElementById('adCampaignEditBreakSetQuick');
    const slotSelect = document.getElementById('adCampaignEditSlots');
    if (!breakSetSelect || !slotSelect) return;
    const breakSetId = Number(breakSetSelect.value || 0);
    if (!breakSetId) {
        showToast('Choose a break set first', 'warning');
        return;
    }
    const slotIds = getSlotIdsByBreakSetId(breakSetId);
    if (!slotIds.length) {
        showToast('Selected break set has no slot', 'warning');
        return;
    }
    setMultiSelectValues(slotSelect, slotIds);
    showToast(`${slotIds.length} slot selected`);
}

function selectAllCampaignSlots() {
    const slotSelect = document.getElementById('adCampaignSlots');
    if (!slotSelect) return;
    const slotIds = getFlatAdSlots()
        .map(row => Number(row.slot_id || 0))
        .filter(id => Number.isInteger(id) && id > 0);
    if (!slotIds.length) {
        showToast('No slot available', 'warning');
        return;
    }
    setMultiSelectValues(slotSelect, slotIds);
}

function selectAllCampaignEditSlots() {
    const slotSelect = document.getElementById('adCampaignEditSlots');
    if (!slotSelect) return;
    const slotIds = getFlatAdSlots()
        .map(row => Number(row.slot_id || 0))
        .filter(id => Number.isInteger(id) && id > 0);
    if (!slotIds.length) {
        showToast('No slot available', 'warning');
        return;
    }
    setMultiSelectValues(slotSelect, slotIds);
}

function clearCampaignSlots() {
    const slotSelect = document.getElementById('adCampaignSlots');
    if (!slotSelect) return;
    setMultiSelectValues(slotSelect, []);
}

function clearCampaignEditSlots() {
    const slotSelect = document.getElementById('adCampaignEditSlots');
    if (!slotSelect) return;
    setMultiSelectValues(slotSelect, []);
}

function selectAllCampaignTracks() {
    const trackSelect = document.getElementById('adCampaignTracks');
    if (!trackSelect) return;
    const trackIds = (currentState.adTracks || [])
        .map(track => Number(track.id || track.track_id || 0))
        .filter(id => Number.isInteger(id) && id > 0);
    if (!trackIds.length) {
        showToast('No ad track available', 'warning');
        return;
    }
    setMultiSelectValues(trackSelect, trackIds);
    updateAdsPanelOverview(currentState.adsRuntime);
}

function selectAllCampaignEditTracks() {
    const trackSelect = document.getElementById('adCampaignEditTracks');
    if (!trackSelect) return;
    const trackIds = (currentState.adTracks || [])
        .map(track => Number(track.id || track.track_id || 0))
        .filter(id => Number.isInteger(id) && id > 0);
    if (!trackIds.length) {
        showToast('No ad track available', 'warning');
        return;
    }
    setMultiSelectValues(trackSelect, trackIds);
}

function clearCampaignTracks() {
    const trackSelect = document.getElementById('adCampaignTracks');
    if (!trackSelect) return;
    setMultiSelectValues(trackSelect, []);
    updateAdsPanelOverview(currentState.adsRuntime);
}

function clearCampaignEditTracks() {
    const trackSelect = document.getElementById('adCampaignEditTracks');
    if (!trackSelect) return;
    setMultiSelectValues(trackSelect, []);
}

function summarizeAdSlotRows(slots) {
    const rows = Array.isArray(slots) ? slots : [];
    if (!rows.length) return 'No slots';
    return rows
        .map(slot => `${slot.slot_time || '--:--'} (${formatAdDaySpec(slot.day_of_week)})`)
        .join(' | ');
}

function renderAdCampaignSlotOptionsFor(selectId, selectedIds = null, quickSelectRender = null) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const selected = Array.isArray(selectedIds) ? selectedIds : getMultiSelectValuesFromElement(select);
    const slotRows = getFlatAdSlots();

    if (!slotRows.length) {
        select.innerHTML = '';
        for (const slotId of selected) {
            ensureMultiOption(select, slotId, `[Missing slot #${slotId}]`);
        }
        setMultiSelectValues(select, selected);
        if (typeof quickSelectRender === 'function') quickSelectRender(null);
        return;
    }

    select.innerHTML = slotRows.map(slot => {
        const dayLabel = formatAdDaySpec(slot.day_of_week);
        const setName = escapeHtml(slot.break_set_name || `Break Set #${slot.break_set_id}`);
        const statusText = slot.is_active && slot.break_set_active ? '' : ' [inactive]';
        return `<option value="${slot.slot_id}">${setName} - ${slot.slot_time} (${dayLabel})${statusText}</option>`;
    }).join('');

    for (const slotId of selected) {
        ensureMultiOption(select, slotId, `[Missing slot #${slotId}]`);
    }
    setMultiSelectValues(select, selected);
    const inferredBreakSetId = inferBreakSetFromSlotIds(selected);
    if (typeof quickSelectRender === 'function') {
        quickSelectRender(inferredBreakSetId > 0 ? inferredBreakSetId : null);
    }
}

function renderAdCampaignSlotOptions(selectedIds = null) {
    renderAdCampaignSlotOptionsFor('adCampaignSlots', selectedIds, renderCampaignBreakSetQuickOptions);
}

function renderAdCampaignEditSlotOptions(selectedIds = null) {
    renderAdCampaignSlotOptionsFor('adCampaignEditSlots', selectedIds, renderAdCampaignEditQuickOptions);
}

function renderAdCampaignTrackOptionsFor(selectId, selectedIds = null) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const selected = Array.isArray(selectedIds) ? selectedIds : getMultiSelectValuesFromElement(select);
    const tracks = Array.isArray(currentState.adTracks) ? currentState.adTracks : [];

    if (!tracks.length) {
        select.innerHTML = '';
        for (const trackId of selected) {
            ensureMultiOption(select, trackId, `[Missing ad track #${trackId}]`);
        }
        setMultiSelectValues(select, selected);
        return;
    }

    const optionsHtml = tracks.map(track => {
        const tid = Number(track.id || track.track_id || 0);
        const title = escapeHtml(track.title || `Track #${tid}`);
        const artist = escapeHtml(track.artist || 'Unknown');
        const duration = formatDuration(Number(track.duration || 0));
        return `<option value="${tid}">${title} - ${artist} (${duration})</option>`;
    }).join('');
    if (select.multiple) {
        select.innerHTML = optionsHtml;
    } else {
        select.innerHTML = `<option value="">Choose ad track...</option>${optionsHtml}`;
    }

    for (const trackId of selected) {
        ensureMultiOption(select, trackId, `[Missing ad track #${trackId}]`);
    }
    setMultiSelectValues(select, selected);
    if (!select.multiple && !selected.length) {
        select.value = '';
    }
}

function renderAdCampaignTrackOptions(selectedIds = null) {
    renderAdCampaignTrackOptionsFor('adCampaignTracks', selectedIds);
}

function renderAdCampaignEditTrackOptions(selectedIds = null) {
    renderAdCampaignTrackOptionsFor('adCampaignEditTracks', selectedIds);
}

function renderAdBreakJingleOptions(selectedIntroId = null, selectedOutroId = null) {
    const introSelect = document.getElementById('adBreakSetIntroJingle');
    const outroSelect = document.getElementById('adBreakSetOutroJingle');
    if (!introSelect || !outroSelect) return;

    const fallbackIntro = selectedIntroId === null ? Number(introSelect.value || 0) : Number(selectedIntroId || 0);
    const fallbackOutro = selectedOutroId === null ? Number(outroSelect.value || 0) : Number(selectedOutroId || 0);
    const selectedIntro = Number.isInteger(fallbackIntro) && fallbackIntro > 0 ? fallbackIntro : 0;
    const selectedOutro = Number.isInteger(fallbackOutro) && fallbackOutro > 0 ? fallbackOutro : 0;

    const jingles = Array.isArray(currentState.adJingleTracks) ? currentState.adJingleTracks : [];
    const optionRows = jingles.map(track => {
        const tid = Number(track.id || track.track_id || 0);
        const title = escapeHtml(track.title || `Track #${tid}`);
        const artist = escapeHtml(track.artist || 'Jingle');
        const duration = formatDuration(Number(track.duration || 0));
        return `<option value="${tid}">${title} - ${artist} (${duration})</option>`;
    });

    introSelect.innerHTML = ['<option value="">No Entry Jingle</option>', ...optionRows].join('');
    outroSelect.innerHTML = ['<option value="">No Exit Jingle</option>', ...optionRows].join('');

    if (selectedIntro > 0) {
        ensureMultiOption(introSelect, selectedIntro, `[Missing jingle #${selectedIntro}]`);
        introSelect.value = String(selectedIntro);
    } else {
        introSelect.value = '';
    }
    if (selectedOutro > 0) {
        ensureMultiOption(outroSelect, selectedOutro, `[Missing jingle #${selectedOutro}]`);
        outroSelect.value = String(selectedOutro);
    } else {
        outroSelect.value = '';
    }
}

function resetAdBreakSetForm() {
    currentState.adBreakSetEditorId = null;
    const label = document.getElementById('adBreakSetEditorLabel');
    if (label) label.textContent = 'New Set';
    const nameEl = document.getElementById('adBreakSetName');
    const descEl = document.getElementById('adBreakSetDescription');
    const slotsEl = document.getElementById('adBreakSetSlots');
    const daysEl = document.getElementById('adBreakSetDays');
    const activeEl = document.getElementById('adBreakSetActive');
    const introJingleEl = document.getElementById('adBreakSetIntroJingle');
    const outroJingleEl = document.getElementById('adBreakSetOutroJingle');
    if (nameEl) nameEl.value = '';
    if (descEl) descEl.value = '';
    if (slotsEl) slotsEl.value = '';
    if (daysEl) {
        Array.from(daysEl.querySelectorAll('option[data-custom="1"]')).forEach(opt => opt.remove());
        daysEl.value = '*';
    }
    if (activeEl) activeEl.checked = true;
    if (introJingleEl) introJingleEl.value = '';
    if (outroJingleEl) outroJingleEl.value = '';
    renderAdBreakJingleOptions(null, null);
}

function resetAdCampaignForm() {
    currentState.adCampaignEditorId = null;
    const label = document.getElementById('adCampaignEditorLabel');
    if (label) label.textContent = 'New Campaign';

    const today = todayIsoDate();
    const nameEl = document.getElementById('adCampaignName');
    const startEl = document.getElementById('adCampaignStart');
    const endEl = document.getElementById('adCampaignEnd');
    const dayIntervalEl = document.getElementById('adCampaignDayInterval');
    const dailyLimitEl = document.getElementById('adCampaignDailyLimit');
    const priorityEl = document.getElementById('adCampaignPriority');
    const notesEl = document.getElementById('adCampaignNotes');
    const activeEl = document.getElementById('adCampaignActive');
    if (nameEl) nameEl.value = '';
    if (startEl) startEl.value = today;
    if (endEl) endEl.value = datePlusIso(30);
    if (dayIntervalEl) dayIntervalEl.value = '1';
    if (dailyLimitEl) dailyLimitEl.value = '0';
    if (priorityEl) priorityEl.value = '0';
    if (notesEl) notesEl.value = '';
    if (activeEl) activeEl.checked = true;

    renderAdCampaignBreakSetOptions([]);
    renderAdCampaignTrackOptions([]);
    updateAdsPanelOverview(currentState.adsRuntime);
}

function normalizeAdsPricingConfig(raw = {}) {
    const cfg = raw && typeof raw === 'object' ? raw : {};
    const currency = String(cfg.currency || 'USD').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'USD';
    const pricePerSecond = Math.max(0, Number.parseFloat(cfg.pricePerSecond ?? cfg.price_per_second ?? 0.2) || 0.2);
    const fallbackDurationSec = Math.max(1, Math.min(600, Number.parseFloat(cfg.fallbackDurationSec ?? cfg.fallback_duration_sec ?? 30) || 30));
    const activeOnly = cfg.activeOnly === undefined ? true : !!cfg.activeOnly;
    const rawTrackPricing = cfg.trackPricing ?? cfg.track_pricing;
    const sourceMap = rawTrackPricing && typeof rawTrackPricing === 'object' ? rawTrackPricing : {};
    const trackPricing = {};
    Object.entries(sourceMap).forEach(([rawTrackId, rawRule]) => {
        const trackId = Number.parseInt(String(rawTrackId || ''), 10);
        if (!Number.isInteger(trackId) || trackId <= 0) return;
        const rule = rawRule && typeof rawRule === 'object' ? rawRule : {};
        const isFree = rule.isFree === undefined ? true : !!rule.isFree;
        const mode = String(rule.mode || 'per_second').toLowerCase() === 'total' ? 'total' : 'per_second';
        const value = Math.max(0, Number.parseFloat(rule.value ?? rule.rate ?? pricePerSecond) || pricePerSecond);
        trackPricing[String(trackId)] = { isFree, mode, value };
    });
    return { currency, pricePerSecond, fallbackDurationSec, trackPricing, activeOnly };
}

function loadAdsPricingConfig() {
    try {
        const rawText = window.localStorage.getItem(ADS_PRICING_STORAGE_KEY);
        if (!rawText) return normalizeAdsPricingConfig(currentState.adsPricing);
        const parsed = JSON.parse(rawText);
        return normalizeAdsPricingConfig(parsed);
    } catch (_) {
        return normalizeAdsPricingConfig(currentState.adsPricing);
    }
}

function saveAdsPricingConfig(config) {
    try {
        window.localStorage.setItem(ADS_PRICING_STORAGE_KEY, JSON.stringify(normalizeAdsPricingConfig(config)));
    } catch (_) {
        // Ignore local storage failures.
    }
}

function applyAdsPricingConfigToUi(config = currentState.adsPricing) {
    const cfg = normalizeAdsPricingConfig(config);
    const currencyEl = document.getElementById('adsPriceCurrency');
    const ppsEl = document.getElementById('adsPricePerSecond');
    const fallbackEl = document.getElementById('adsFallbackDuration');
    const activeOnlyEl = document.getElementById('adsPricingActiveOnly');
    if (currencyEl) currencyEl.value = cfg.currency;
    if (ppsEl) ppsEl.value = String(cfg.pricePerSecond);
    if (fallbackEl) fallbackEl.value = String(Math.round(cfg.fallbackDurationSec));
    if (activeOnlyEl) activeOnlyEl.checked = !!cfg.activeOnly;
}

function readAdsPricingConfigFromUi() {
    const base = normalizeAdsPricingConfig(currentState.adsPricing);
    const currencyEl = document.getElementById('adsPriceCurrency');
    const ppsEl = document.getElementById('adsPricePerSecond');
    const fallbackEl = document.getElementById('adsFallbackDuration');
    const activeOnlyEl = document.getElementById('adsPricingActiveOnly');
    return normalizeAdsPricingConfig({
        ...base,
        currency: currencyEl ? currencyEl.value : base.currency,
        pricePerSecond: ppsEl ? ppsEl.value : base.pricePerSecond,
        fallbackDurationSec: fallbackEl ? fallbackEl.value : base.fallbackDurationSec,
        activeOnly: activeOnlyEl ? activeOnlyEl.checked : base.activeOnly,
        trackPricing: base.trackPricing,
    });
}

function initAdsPricingUi() {
    const currencyEl = document.getElementById('adsPriceCurrency');
    const ppsEl = document.getElementById('adsPricePerSecond');
    const fallbackEl = document.getElementById('adsFallbackDuration');
    const activeOnlyEl = document.getElementById('adsPricingActiveOnly');
    const trackBody = document.getElementById('adsPricingTrackBody');
    if (!currencyEl || !ppsEl || !fallbackEl || !activeOnlyEl || !trackBody) return;

    currentState.adsPricing = loadAdsPricingConfig();
    applyAdsPricingConfigToUi(currentState.adsPricing);
    renderAdsTrackPricingTable(currentState.adsPricing);

    if (currencyEl.dataset.boundPricing === '1') return;
    currencyEl.dataset.boundPricing = '1';

    const onPricingInput = () => {
        currentState.adsPricing = readAdsPricingConfigFromUi();
        saveAdsPricingConfig(currentState.adsPricing);
        updateAdsPanelOverview(currentState.adsRuntime);
    };

    [currencyEl, ppsEl, fallbackEl, activeOnlyEl].forEach(el => {
        if (!el) return;
        el.addEventListener('input', onPricingInput);
        el.addEventListener('change', onPricingInput);
    });

    const campaignTracksEl = document.getElementById('adCampaignTracks');
    if (campaignTracksEl && campaignTracksEl.dataset.boundPricingScope !== '1') {
        campaignTracksEl.dataset.boundPricingScope = '1';
        campaignTracksEl.addEventListener('change', () => {
            updateAdsPanelOverview(currentState.adsRuntime);
        });
    }

    trackBody.addEventListener('change', (event) => {
        const row = event.target.closest('tr[data-track-id]');
        if (!row) return;
        const trackId = Number(row.dataset.trackId || 0);
        if (!Number.isInteger(trackId) || trackId <= 0) return;

        const isFreeEl = row.querySelector('.ads-track-free');
        const modeEl = row.querySelector('.ads-track-mode');
        const valueEl = row.querySelector('.ads-track-rate');
        const nextRule = {
            isFree: !!isFreeEl?.checked,
            mode: String(modeEl?.value || 'per_second').toLowerCase() === 'total' ? 'total' : 'per_second',
            value: Math.max(0, Number.parseFloat(valueEl?.value || String(currentState.adsPricing.pricePerSecond || 0.2)) || 0),
        };

        const normalized = normalizeAdsPricingConfig(currentState.adsPricing);
        const map = { ...(normalized.trackPricing || {}) };
        map[String(trackId)] = nextRule;
        currentState.adsPricing = normalizeAdsPricingConfig({ ...normalized, trackPricing: map });
        saveAdsPricingConfig(currentState.adsPricing);
        updateAdsPanelOverview(currentState.adsRuntime);
    });
}

function parseIsoDateLocal(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    const d = new Date(year, month, day);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
}

function toCampaignWeekday(dateObj) {
    const jsDay = Number(dateObj?.getDay?.() || 0); // Sun=0
    return (jsDay + 6) % 7; // Mon=0
}

function parseCampaignDaySpecSet(spec) {
    const text = String(spec || '*').trim();
    if (!text || text === '*') return new Set([0, 1, 2, 3, 4, 5, 6]);
    const values = text
        .split(',')
        .map(token => Number.parseInt(String(token).trim(), 10))
        .filter(v => Number.isInteger(v) && v >= 0 && v <= 6);
    return new Set(values.length ? values : [0, 1, 2, 3, 4, 5, 6]);
}

function campaignActiveOnDate(campaign, targetDate) {
    const startDay = parseIsoDateLocal(campaign?.start_date);
    const endDay = parseIsoDateLocal(campaign?.end_date);
    if (!startDay || !endDay) return false;
    if (targetDate < startDay || targetDate > endDay) return false;
    const interval = Math.max(1, Number.parseInt(String(campaign?.day_interval || '1'), 10) || 1);
    const daysSinceStart = Math.floor((targetDate - startDay) / 86400000);
    return daysSinceStart % interval === 0;
}

function estimateCampaignPlaysForDate(campaign, targetDate) {
    if (!campaign || !campaignActiveOnDate(campaign, targetDate)) return 0;
    const slots = Array.isArray(campaign.slots) ? campaign.slots : [];
    if (!slots.length) return 0;
    const weekday = toCampaignWeekday(targetDate);
    let slotCount = 0;
    slots.forEach(slot => {
        const daySet = parseCampaignDaySpecSet(slot?.day_of_week);
        if (daySet.has(weekday)) slotCount += 1;
    });
    const dailyLimit = Math.max(0, Number.parseInt(String(campaign.daily_repeat_limit || '0'), 10) || 0);
    if (dailyLimit > 0) slotCount = Math.min(slotCount, dailyLimit);
    return slotCount;
}

function estimateCampaignPlaysForPeriod(campaign, periodDays, fromDate = new Date()) {
    const horizon = Math.max(1, Number.parseInt(String(periodDays || 30), 10) || 30);
    const base = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
    let total = 0;
    for (let i = 0; i < horizon; i += 1) {
        const dateObj = new Date(base);
        dateObj.setDate(base.getDate() - i);
        total += estimateCampaignPlaysForDate(campaign, dateObj);
    }
    return total;
}

function campaignAverageAdSeconds(campaign, fallbackDurationSec) {
    const tracks = Array.isArray(campaign?.tracks) ? campaign.tracks : [];
    const durations = tracks
        .map(track => Number.parseFloat(track?.duration || 0))
        .filter(value => Number.isFinite(value) && value > 0);
    if (!durations.length) return fallbackDurationSec;
    const sum = durations.reduce((acc, value) => acc + value, 0);
    return sum / durations.length;
}

function formatAdsMoney(amount, currencyCode = 'USD') {
    const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    const code = String(currencyCode || 'USD').trim().toUpperCase() || 'USD';
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: code,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    } catch (_) {
        return `${value.toFixed(2)} ${code}`;
    }
}

function resolveTrackPricingRule(trackId, pricing) {
    const normalized = normalizeAdsPricingConfig(pricing);
    const map = normalized.trackPricing || {};
    const existing = map[String(trackId)];
    if (!existing) {
        return { isFree: true, mode: 'per_second', value: normalized.pricePerSecond };
    }
    return {
        isFree: existing.isFree === undefined ? true : !!existing.isFree,
        mode: String(existing.mode || 'per_second').toLowerCase() === 'total' ? 'total' : 'per_second',
        value: Math.max(0, Number.parseFloat(existing.value || 0) || 0),
    };
}

function computeTrackPricePerPlay(track, pricing, explicitRule = null) {
    const trackId = Number(track?.track_id || track?.id || 0);
    const rule = explicitRule || resolveTrackPricingRule(trackId, pricing);
    if (!rule || rule.isFree) return 0;
    const duration = Math.max(1, Number.parseFloat(track?.duration || 0) || Number(pricing.fallbackDurationSec || 30));
    if (rule.mode === 'total') return Math.max(0, Number(rule.value || 0));
    return Math.max(0, Number(rule.value || 0)) * duration;
}

function renderAdsTrackPricingTable(pricing = currentState.adsPricing) {
    const tbody = document.getElementById('adsPricingTrackBody');
    if (!tbody) return;
    const cfg = normalizeAdsPricingConfig(pricing);
    const allTracks = Array.isArray(currentState.adTracks) ? currentState.adTracks : [];
    const selectedTrackIds = getMultiSelectValues('adCampaignTracks');
    const selectedSet = new Set(selectedTrackIds.map(id => Number(id || 0)).filter(id => id > 0));

    if (!selectedSet.size) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Select one ad track in New Campaign to set pricing for that ad.</td></tr>';
        return;
    }

    if (!allTracks.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No ad tracks available.</td></tr>';
        return;
    }

    const tracks = allTracks.filter(track => {
        const trackId = Number(track?.id || track?.track_id || 0);
        return selectedSet.has(trackId);
    });

    if (!tracks.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Selected ad track(s) not found in library.</td></tr>';
        return;
    }

    const sorted = tracks.slice().sort((a, b) => {
        const ta = String(a?.title || '').toLowerCase();
        const tb = String(b?.title || '').toLowerCase();
        if (ta !== tb) return ta.localeCompare(tb);
        return Number(a?.id || a?.track_id || 0) - Number(b?.id || b?.track_id || 0);
    });

    tbody.innerHTML = sorted.map(track => {
        const trackId = Number(track?.id || track?.track_id || 0);
        const title = escapeHtml(track?.title || `Track #${trackId}`);
        const artist = escapeHtml(track?.artist || 'Unknown');
        const duration = Number.parseFloat(track?.duration || 0);
        const durationSec = Number.isFinite(duration) && duration > 0 ? duration : Number(cfg.fallbackDurationSec || 30);
        const rule = resolveTrackPricingRule(trackId, cfg);
        const pricePerPlay = computeTrackPricePerPlay({ ...track, duration: durationSec }, cfg, rule);
        const modeLabel = rule.mode === 'total' ? 'Total' : 'Per Sec';
        const fieldsClass = rule.isFree ? 'ads-track-price-fields is-hidden' : 'ads-track-price-fields';
        return `
            <tr data-track-id="${trackId}">
                <td>${title} <span class="ads-track-artist">- ${artist}</span></td>
                <td>${durationSec.toFixed(1)}</td>
                <td>
                    <label class="ads-track-free-wrap">
                        <input type="checkbox" class="ads-track-free" ${rule.isFree ? 'checked' : ''}>
                    </label>
                </td>
                <td>
                    <div class="${fieldsClass}">
                        <select class="ads-track-mode">
                            <option value="per_second" ${rule.mode === 'per_second' ? 'selected' : ''}>Per Second</option>
                            <option value="total" ${rule.mode === 'total' ? 'selected' : ''}>Total</option>
                        </select>
                    </div>
                    ${rule.isFree ? '<span class="ads-track-free-label">Free</span>' : ''}
                </td>
                <td>
                    <div class="${fieldsClass}">
                        <input type="number" class="ads-track-rate" min="0" step="0.01" value="${Number(rule.value || 0).toFixed(2)}">
                    </div>
                </td>
                <td>${escapeHtml(rule.isFree ? formatAdsMoney(0, cfg.currency) : `${formatAdsMoney(pricePerPlay, cfg.currency)} (${modeLabel})`)}</td>
            </tr>
        `;
    }).join('');
}

function buildAdsRevenueModel(runtimeData = currentState.adsRuntime) {
    const pricing = normalizeAdsPricingConfig(currentState.adsPricing);
    const allCampaigns = Array.isArray(currentState.adsCampaigns) ? currentState.adsCampaigns : [];
    const campaigns = pricing.activeOnly
        ? allCampaigns.filter(campaign => !!campaign?.is_active)
        : allCampaigns;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthlyDays = 30;
    const rows = [];
    let dailyTotal = 0;
    let monthlyTotal = 0;

    campaigns.forEach(campaign => {
        const campaignTracks = Array.isArray(campaign.tracks) ? campaign.tracks : [];
        const selectedTrack = campaignTracks[0] || null;
        const avgSeconds = selectedTrack
            ? campaignAverageAdSeconds({ tracks: [selectedTrack] }, pricing.fallbackDurationSec)
            : pricing.fallbackDurationSec;
        const pricePerPlay = selectedTrack ? computeTrackPricePerPlay(selectedTrack, pricing) : 0;
        const playsToday = estimateCampaignPlaysForDate(campaign, today);
        const playsMonthly = estimateCampaignPlaysForPeriod(campaign, monthlyDays, today);
        const dailyRevenue = playsToday * pricePerPlay;
        const monthlyRevenue = playsMonthly * pricePerPlay;
        const paidTracks = pricePerPlay > 0 ? 1 : 0;
        const trackCount = selectedTrack ? 1 : 0;
        dailyTotal += dailyRevenue;
        monthlyTotal += monthlyRevenue;

        rows.push({
            campaignId: Number(campaign.id || 0),
            campaignName: String(campaign.name || `Campaign #${campaign.id || '-'}`),
            avgSeconds,
            pricePerPlay,
            playsToday,
            playsMonthly,
            dailyRevenue,
            monthlyRevenue,
            formula: `${paidTracks}/${trackCount || 0} paid ad(s) x ${playsMonthly} plays (last 30d)`,
        });
    });

    rows.sort((a, b) => b.monthlyRevenue - a.monthlyRevenue);
    return {
        pricing,
        campaignCount: campaigns.length,
        dailyTotal,
        monthlyTotal,
        monthlyDays,
        dueSlots: Array.isArray(runtimeData?.due_slots) ? runtimeData.due_slots.length : 0,
        rows,
    };
}

function renderAdsRevenueTable(model) {
    const summaryEl = document.getElementById('adsPricingSummary');
    const tableBody = document.getElementById('adsPricingTableBody');
    if (summaryEl) {
        const formulaText = `Total = campaign scheduled plays x ad-based price/play. 30d column shows last 30 days estimate.`;
        summaryEl.textContent = formulaText;
    }
    if (!tableBody) return;

    if (!model.rows.length) {
        tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">No campaign matches pricing filters.</td></tr>';
        return;
    }

    tableBody.innerHTML = model.rows.map(row => `
        <tr>
            <td>${escapeHtml(row.campaignName)}</td>
            <td>${row.avgSeconds.toFixed(1)}</td>
            <td>${escapeHtml(formatAdsMoney(row.pricePerPlay, model.pricing.currency))}</td>
            <td>${row.playsToday}</td>
            <td>${row.playsMonthly}</td>
            <td>${escapeHtml(formatAdsMoney(row.dailyRevenue, model.pricing.currency))}</td>
            <td>${escapeHtml(formatAdsMoney(row.monthlyRevenue, model.pricing.currency))}</td>
            <td>${escapeHtml(row.formula)}</td>
        </tr>
    `).join('');
}

async function loadAdsPanelData(force = false) {
    const stationId = Number(currentState.currentStationId || 1);
    const stationChanged = Number(currentState.adsStationId || 0) !== stationId;
    const needsBootstrap = !Array.isArray(currentState.adsBreakSets)
        || !Array.isArray(currentState.adsCampaigns)
        || !Array.isArray(currentState.adTracks)
        || !Array.isArray(currentState.adJingleTracks);

    if (stationChanged) {
        resetAdBreakSetForm();
        resetAdCampaignForm();
        closeAdCampaignEditModal();
    }

    if (force || stationChanged || needsBootstrap) {
        await Promise.all([
            loadAdBreakSets(),
            loadAdTracksForCampaignForm(),
        ]);
        await loadAdCampaigns();
    } else {
        renderAdBreakSets(currentState.adsBreakSets);
        renderAdCampaigns(currentState.adsCampaigns);
        renderAdCampaignBreakSetOptions();
        renderAdCampaignEditBreakSetOptions();
        renderAdCampaignTrackOptions();
        renderAdCampaignEditTrackOptions();
        renderAdBreakJingleOptions();
    }

    await loadAdsRuntime();
    updateAdsPanelOverview(currentState.adsRuntime);
}

function setAdsKpiValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(value);
}

function updateAdsPanelOverview(runtimeData = currentState.adsRuntime) {
    currentState.adsPricing = normalizeAdsPricingConfig(readAdsPricingConfigFromUi());
    saveAdsPricingConfig(currentState.adsPricing);
    renderAdsTrackPricingTable(currentState.adsPricing);
    const breakSetCount = Array.isArray(currentState.adsBreakSets) ? currentState.adsBreakSets.length : 0;
    const campaignRows = Array.isArray(currentState.adsCampaigns) ? currentState.adsCampaigns : [];
    const campaignCount = campaignRows.length;
    const trackCount = Array.isArray(currentState.adTracks) ? currentState.adTracks.length : 0;
    const dueCount = Array.isArray(runtimeData?.due_slots) ? runtimeData.due_slots.length : 0;
    const revenueModel = buildAdsRevenueModel(runtimeData);

    setAdsKpiValue('adsKpiCampaigns', campaignCount);
    setAdsKpiValue('adsKpiDue', dueCount);
    setAdsKpiValue('adsKpiDailyRevenue', formatAdsMoney(revenueModel.dailyTotal, revenueModel.pricing.currency));
    setAdsKpiValue('adsKpiMonthlyRevenue', formatAdsMoney(revenueModel.monthlyTotal, revenueModel.pricing.currency));
    renderAdsRevenueTable(revenueModel);

    const hintEl = document.getElementById('adsPanelHint');
    if (!hintEl) return;

    const missing = [];
    if (breakSetCount === 0) missing.push('No break set configured.');
    if (campaignCount === 0) missing.push('No campaign configured.');
    if (trackCount === 0) missing.push('No ad tracks found in library.');

    if (!missing.length) {
        hintEl.style.display = 'none';
        hintEl.textContent = '';
        return;
    }

    hintEl.textContent = `Setup needed: ${missing.join(' ')}`;
    hintEl.style.display = 'flex';
}

async function loadAdBreakSets() {
    try {
        const data = await apiFetch(`${API_BASE}/api/ad-break-sets?station_id=${currentState.currentStationId}`);
        currentState.adsBreakSets = Array.isArray(data?.break_sets) ? data.break_sets : [];
        currentState.adsStationId = Number(data?.station_id || currentState.currentStationId || 1);
        renderAdBreakSets(currentState.adsBreakSets);
        renderAdCampaignBreakSetOptions();
        renderAdCampaignEditBreakSetOptions();
        renderAdBreakJingleOptions();
        updateAdsPanelOverview();

        if (currentState.adBreakSetEditorId) {
            const exists = currentState.adsBreakSets.some(row => Number(row.id) === Number(currentState.adBreakSetEditorId));
            if (!exists) resetAdBreakSetForm();
        }
    } catch (e) {
        showToast('Ad break sets could not be loaded', 'error');
    }
}

function renderAdBreakSets(breakSets) {
    const listEl = document.getElementById('adBreakSetsList');
    if (!listEl) return;
    const rows = Array.isArray(breakSets) ? breakSets : [];

    if (!rows.length) {
        listEl.innerHTML = `<div class="ads-item"><div class="ads-item-meta">No break set configured yet.</div></div>`;
        return;
    }

    listEl.innerHTML = rows.map(set => {
        const setId = Number(set.id || 0);
        const slotRows = Array.isArray(set.slots) ? set.slots : [];
        const name = escapeHtml(set.name || `Break Set #${setId}`);
        const desc = escapeHtml(set.description || '');
        const status = set.is_active ? 'Active' : 'Inactive';
        const introLabel = escapeHtml(set.intro_jingle_title || 'None');
        const outroLabel = escapeHtml(set.outro_jingle_title || 'None');
        return `
            <div class="ads-item">
                <div>
                    <div class="ads-item-title">${name}</div>
                    <div class="ads-item-meta">${status} · ${slotRows.length} slot(s)</div>
                    ${desc ? `<div class="ads-item-meta">${desc}</div>` : ''}
                    <div class="ads-item-meta">Entry jingle: ${introLabel} · Exit jingle: ${outroLabel}</div>
                    <div class="ads-item-slots">${escapeHtml(summarizeAdSlotRows(slotRows))}</div>
                </div>
                <div class="ads-item-actions">
                    <button class="btn-sm" onclick="editAdBreakSet(${setId})" title="Edit">
                        <span class="material-icons-round">edit</span>
                    </button>
                    <button class="btn-sm delete-btn" onclick="deleteAdBreakSet(${setId})" title="Delete">
                        <span class="material-icons-round">delete</span>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function saveAdBreakSet() {
    const nameEl = document.getElementById('adBreakSetName');
    const descEl = document.getElementById('adBreakSetDescription');
    const slotsEl = document.getElementById('adBreakSetSlots');
    const daysEl = document.getElementById('adBreakSetDays');
    const activeEl = document.getElementById('adBreakSetActive');
    const introJingleEl = document.getElementById('adBreakSetIntroJingle');
    const outroJingleEl = document.getElementById('adBreakSetOutroJingle');

    const name = String(nameEl?.value || '').trim();
    if (!name) {
        showToast('Break set name is required', 'error');
        return;
    }

    const parsed = parseAdSlotInput(slotsEl?.value || '');
    if (parsed.invalid.length) {
        showToast(`Invalid slot time: ${parsed.invalid[0]}`, 'error');
        return;
    }
    if (!parsed.times.length) {
        showToast('At least one slot time is required', 'error');
        return;
    }

    const daySpec = String(daysEl?.value || '*').trim() || '*';
    const slots = parsed.times.map((slotTime, idx) => ({
        slot_time: slotTime,
        day_of_week: daySpec,
        position: idx,
        is_active: true,
    }));

    const payload = {
        station_id: Number(currentState.currentStationId || 1),
        name,
        description: String(descEl?.value || '').trim(),
        intro_jingle_track_id: null,
        outro_jingle_track_id: null,
        is_active: !!activeEl?.checked,
        slots,
    };
    const introJingleId = Number.parseInt(String(introJingleEl?.value || ''), 10);
    const outroJingleId = Number.parseInt(String(outroJingleEl?.value || ''), 10);
    if (Number.isInteger(introJingleId) && introJingleId > 0) {
        payload.intro_jingle_track_id = introJingleId;
    }
    if (Number.isInteger(outroJingleId) && outroJingleId > 0) {
        payload.outro_jingle_track_id = outroJingleId;
    }

    const editingId = Number(currentState.adBreakSetEditorId || 0);
    const isEdit = Number.isInteger(editingId) && editingId > 0;

    try {
        await apiFetch(
            isEdit ? `${API_BASE}/api/ad-break-sets/${editingId}` : `${API_BASE}/api/ad-break-sets`,
            {
                method: isEdit ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }
        );
        showToast(isEdit ? 'Ad break set updated' : 'Ad break set created');
        resetAdBreakSetForm();
        await Promise.all([loadAdBreakSets(), loadAdCampaigns()]);
        await loadAdsRuntime();
    } catch (e) {
        // Error already handled in apiFetch
    }
}

async function editAdBreakSet(breakSetId) {
    const targetId = Number(breakSetId || 0);
    if (!Number.isInteger(targetId) || targetId <= 0) return;

    let row = (currentState.adsBreakSets || []).find(set => Number(set.id) === targetId);
    if (!row) {
        await loadAdBreakSets();
        row = (currentState.adsBreakSets || []).find(set => Number(set.id) === targetId);
    }
    if (!row) {
        showToast('Ad break set not found', 'error');
        return;
    }

    currentState.adBreakSetEditorId = targetId;
    const nameEl = document.getElementById('adBreakSetName');
    const descEl = document.getElementById('adBreakSetDescription');
    const slotsEl = document.getElementById('adBreakSetSlots');
    const daysEl = document.getElementById('adBreakSetDays');
    const activeEl = document.getElementById('adBreakSetActive');
    const introJingleEl = document.getElementById('adBreakSetIntroJingle');
    const outroJingleEl = document.getElementById('adBreakSetOutroJingle');
    const label = document.getElementById('adBreakSetEditorLabel');

    const slotRows = Array.isArray(row.slots) ? row.slots : [];
    const slotTimes = slotRows
        .map(slot => normalizeAdSlotToken(slot.slot_time))
        .filter(Boolean);
    const distinctDays = Array.from(new Set(slotRows.map(slot => String(slot.day_of_week || '*'))));
    const daysValue = distinctDays.length === 1 ? distinctDays[0] : '*';

    if (nameEl) nameEl.value = row.name || '';
    if (descEl) descEl.value = row.description || '';
    if (slotsEl) slotsEl.value = slotTimes.join(',');
    if (daysEl) {
        Array.from(daysEl.querySelectorAll('option[data-custom="1"]')).forEach(opt => opt.remove());
        const hasOption = Array.from(daysEl.options).some(opt => String(opt.value) === daysValue);
        if (!hasOption && daysValue && daysValue !== '*') {
            const customOption = document.createElement('option');
            customOption.value = daysValue;
            customOption.textContent = `Custom (${daysValue})`;
            customOption.dataset.custom = '1';
            daysEl.appendChild(customOption);
        }
        daysEl.value = hasOption || (daysValue && daysValue !== '*') ? daysValue : '*';
    }
    if (activeEl) activeEl.checked = !!row.is_active;
    const introId = Number(row.intro_jingle_track_id || 0);
    const outroId = Number(row.outro_jingle_track_id || 0);
    renderAdBreakJingleOptions(introId > 0 ? introId : null, outroId > 0 ? outroId : null);
    if (introJingleEl && introId <= 0) introJingleEl.value = '';
    if (outroJingleEl && outroId <= 0) outroJingleEl.value = '';
    if (label) label.textContent = `Editing #${targetId}`;
}

async function deleteAdBreakSet(breakSetId) {
    const targetId = Number(breakSetId || 0);
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    if (!confirm('Delete this ad break set?')) return;

    try {
        await apiFetch(
            `${API_BASE}/api/ad-break-sets/${targetId}?station_id=${currentState.currentStationId}`,
            { method: 'DELETE' }
        );
        if (Number(currentState.adBreakSetEditorId || 0) === targetId) {
            resetAdBreakSetForm();
        }
        showToast('Ad break set deleted');
        await Promise.all([loadAdBreakSets(), loadAdCampaigns()]);
        await loadAdsRuntime();
    } catch (e) {
        // Error already handled in apiFetch
    }
}

async function fetchStationTracksByType(stationId, trackType) {
    const tracks = [];
    let page = 1;
    let totalPages = 1;
    const wantedType = String(trackType || '').toLowerCase();

    while (page <= totalPages && page <= 20) {
        const url = new URL(`${window.location.origin}/api/tracks`);
        url.searchParams.set('station_id', String(stationId));
        url.searchParams.set('track_type', wantedType);
        url.searchParams.set('per_page', '500');
        url.searchParams.set('page', String(page));
        url.searchParams.set('sort_by', 'title');
        url.searchParams.set('sort_order', 'asc');

        const data = await apiFetch(url.toString());
        const rows = Array.isArray(data?.tracks) ? data.tracks : [];
        tracks.push(...rows.filter(track => String(track.track_type || '').toLowerCase() === wantedType));
        totalPages = Math.max(1, Number(data?.total_pages || 1));
        page += 1;
    }
    return tracks;
}

async function loadAdTracksForCampaignForm() {
    const stationId = Number(currentState.currentStationId || 1);

    try {
        const [adTracks, adJingleTracks] = await Promise.all([
            fetchStationTracksByType(stationId, 'ad'),
            fetchStationTracksByType(stationId, 'jingle'),
        ]);
        currentState.adTracks = adTracks;
        currentState.adJingleTracks = adJingleTracks;
    } catch (e) {
        currentState.adTracks = [];
        currentState.adJingleTracks = [];
        showToast('Ad/Jingle tracks could not be loaded', 'error');
    }

    renderAdCampaignTrackOptions();
    renderAdCampaignEditTrackOptions();
    renderAdBreakJingleOptions();
    updateAdsPanelOverview();
}

async function loadAdCampaigns() {
    try {
        const data = await apiFetch(`${API_BASE}/api/ad-campaigns?station_id=${currentState.currentStationId}`);
        currentState.adsCampaigns = Array.isArray(data?.campaigns) ? data.campaigns : [];
        renderAdCampaigns(currentState.adsCampaigns);
        updateAdsPanelOverview();

        if (currentState.adCampaignEditorId) {
            const exists = currentState.adsCampaigns.some(row => Number(row.id) === Number(currentState.adCampaignEditorId));
            if (!exists) resetAdCampaignForm();
        }
        if (currentState.adCampaignModalEditorId) {
            const exists = currentState.adsCampaigns.some(row => Number(row.id) === Number(currentState.adCampaignModalEditorId));
            if (!exists) closeAdCampaignEditModal();
        }
    } catch (e) {
        showToast('Ad campaigns could not be loaded', 'error');
    }
}

function renderAdCampaigns(campaigns) {
    const listEl = document.getElementById('adCampaignList');
    if (!listEl) return;
    const countEl = document.getElementById('adCampaignActiveCount');
    const rows = Array.isArray(campaigns) ? campaigns : [];
    const activeRows = rows.filter(campaign => !!campaign?.is_active);

    if (countEl) {
        countEl.textContent = `${activeRows.length} Active`;
    }

    if (!rows.length) {
        listEl.innerHTML = `<div class="ads-item"><div class="ads-item-meta">No campaign configured yet.</div></div>`;
        return;
    }

    if (!activeRows.length) {
        const inactiveCount = rows.length;
        listEl.innerHTML = `<div class="ads-item"><div class="ads-item-meta">No active campaign. ${inactiveCount} inactive campaign(s) available.</div></div>`;
        return;
    }

    listEl.innerHTML = activeRows.map(campaign => {
        const campaignId = Number(campaign.id || 0);
        const name = escapeHtml(campaign.name || `Campaign #${campaignId}`);
        const status = campaign.is_active ? 'Active' : 'Inactive';
        const slotRows = Array.isArray(campaign.slots) ? campaign.slots : [];
        const trackRows = Array.isArray(campaign.tracks) ? campaign.tracks : [];
        const slotText = summarizeAdSlotRows(slotRows);
        const primaryTrack = trackRows[0] || null;
        const primaryTrackTitle = primaryTrack
            ? (primaryTrack.title || `Track #${primaryTrack.track_id}`)
            : 'No track';
        const trackSummary = trackRows.length > 1
            ? `${primaryTrackTitle} (+${trackRows.length - 1} legacy track)`
            : primaryTrackTitle;
        const extraRules = [];
        const interval = Number(campaign.day_interval || 1);
        const dailyLimit = Number(campaign.daily_repeat_limit || 0);
        const priority = Number(campaign.priority || 0);
        if (interval > 1) extraRules.push(`every ${interval} days`);
        if (dailyLimit > 0) extraRules.push(`limit ${dailyLimit}/day`);
        if (priority !== 0) extraRules.push(`priority ${priority}`);
        const ruleSummary = extraRules.length ? ` · ${extraRules.join(' · ')}` : '';
        return `
            <div class="ads-item">
                <div>
                    <div class="ads-item-title">${name}</div>
                    <div class="ads-item-meta">
                        ${status} · ${escapeHtml(campaign.start_date || '--')} → ${escapeHtml(campaign.end_date || '--')}
                        · ${slotRows.length} slot(s) · ${primaryTrack ? 1 : 0} ad${escapeHtml(ruleSummary)}
                    </div>
                    <div class="ads-item-meta">Today plays: ${Number(campaign.today_play_count || 0)} · Next: ${escapeHtml(campaign.next_run_at || 'n/a')}</div>
                    <div class="ads-item-slots">Slots: ${escapeHtml(slotText)}</div>
                    <div class="ads-item-slots">Tracks: ${escapeHtml(trackSummary)}</div>
                </div>
                <div class="ads-item-actions">
                    <button class="btn-sm" onclick="editAdCampaign(${campaignId})" title="Edit">
                        <span class="material-icons-round">edit</span>
                    </button>
                    <button class="btn-sm delete-btn" onclick="deleteAdCampaign(${campaignId})" title="Delete">
                        <span class="material-icons-round">delete</span>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function saveAdCampaign() {
    const nameEl = document.getElementById('adCampaignName');
    const startEl = document.getElementById('adCampaignStart');
    const endEl = document.getElementById('adCampaignEnd');
    const dayIntervalEl = document.getElementById('adCampaignDayInterval');
    const dailyLimitEl = document.getElementById('adCampaignDailyLimit');
    const priorityEl = document.getElementById('adCampaignPriority');
    const notesEl = document.getElementById('adCampaignNotes');
    const activeEl = document.getElementById('adCampaignActive');

    const name = String(nameEl?.value || '').trim();
    if (!name) {
        showToast('Campaign name is required', 'error');
        return;
    }

    const startDate = String(startEl?.value || '').trim() || todayIsoDate();
    const endDate = String(endEl?.value || '').trim() || startDate;
    const dayInterval = Math.max(1, Number.parseInt(String(dayIntervalEl?.value || '1'), 10) || 1);
    const dailyLimit = Math.max(0, Number.parseInt(String(dailyLimitEl?.value || '0'), 10) || 0);
    const priority = Number.parseInt(String(priorityEl?.value || '0'), 10) || 0;
    const breakSetIds = getMultiSelectValues('adCampaignBreakSets');
    const slotIds = expandSlotIdsFromBreakSetIds(breakSetIds);
    let trackIds = getMultiSelectValues('adCampaignTracks');

    if (!breakSetIds.length) {
        showToast('Select at least one break set', 'error');
        return;
    }

    if (!slotIds.length) {
        showToast('Selected break set has no slot', 'error');
        return;
    }

    if (!trackIds.length) {
        showToast('Select at least one ad track', 'error');
        return;
    }

    const payload = {
        station_id: Number(currentState.currentStationId || 1),
        name,
        start_date: startDate,
        end_date: endDate,
        day_interval: dayInterval,
        daily_repeat_limit: dailyLimit,
        priority,
        is_active: !!activeEl?.checked,
        notes: String(notesEl?.value || '').trim(),
        slot_ids: slotIds,
        track_ids: trackIds,
    };

    const editingId = Number(currentState.adCampaignEditorId || 0);
    const isEdit = Number.isInteger(editingId) && editingId > 0;

    try {
        await apiFetch(
            isEdit ? `${API_BASE}/api/ad-campaigns/${editingId}` : `${API_BASE}/api/ad-campaigns`,
            {
                method: isEdit ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }
        );
        showToast(isEdit ? 'Ad campaign updated' : 'Ad campaign created');
        resetAdCampaignForm();
        await loadAdCampaigns();
        await loadAdsRuntime();
    } catch (e) {
        // Error already handled in apiFetch
    }
}

function closeAdCampaignEditModal() {
    const modal = document.getElementById('adCampaignEditModal');
    if (modal) modal.style.display = 'none';
    currentState.adCampaignModalEditorId = null;
    const labelEl = document.getElementById('adCampaignEditLabel');
    if (labelEl) labelEl.textContent = 'Campaign #-';
}

async function saveAdCampaignEditModal() {
    const editingId = Number(currentState.adCampaignModalEditorId || 0);
    if (!Number.isInteger(editingId) || editingId <= 0) {
        showToast('No campaign selected for edit', 'error');
        return;
    }

    const nameEl = document.getElementById('adCampaignEditName');
    const startEl = document.getElementById('adCampaignEditStart');
    const endEl = document.getElementById('adCampaignEditEnd');
    const dayIntervalEl = document.getElementById('adCampaignEditDayInterval');
    const dailyLimitEl = document.getElementById('adCampaignEditDailyLimit');
    const priorityEl = document.getElementById('adCampaignEditPriority');
    const notesEl = document.getElementById('adCampaignEditNotes');
    const activeEl = document.getElementById('adCampaignEditActive');

    const name = String(nameEl?.value || '').trim();
    if (!name) {
        showToast('Campaign name is required', 'error');
        return;
    }

    const startDate = String(startEl?.value || '').trim() || todayIsoDate();
    const endDate = String(endEl?.value || '').trim() || startDate;
    const dayInterval = Math.max(1, Number.parseInt(String(dayIntervalEl?.value || '1'), 10) || 1);
    const dailyLimit = Math.max(0, Number.parseInt(String(dailyLimitEl?.value || '0'), 10) || 0);
    const priority = Number.parseInt(String(priorityEl?.value || '0'), 10) || 0;
    const breakSetIds = getMultiSelectValues('adCampaignEditBreakSets');
    const slotIds = expandSlotIdsFromBreakSetIds(breakSetIds);
    const trackIds = getMultiSelectValues('adCampaignEditTracks');

    if (!breakSetIds.length) {
        showToast('Select at least one break set', 'error');
        return;
    }

    if (!slotIds.length) {
        showToast('Selected break set has no slot', 'error');
        return;
    }
    if (!trackIds.length) {
        showToast('Select at least one ad track', 'error');
        return;
    }

    const payload = {
        station_id: Number(currentState.currentStationId || 1),
        name,
        start_date: startDate,
        end_date: endDate,
        day_interval: dayInterval,
        daily_repeat_limit: dailyLimit,
        priority,
        is_active: !!activeEl?.checked,
        notes: String(notesEl?.value || '').trim(),
        slot_ids: slotIds,
        track_ids: trackIds,
    };

    try {
        await apiFetch(
            `${API_BASE}/api/ad-campaigns/${editingId}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }
        );
        showToast('Ad campaign updated');
        closeAdCampaignEditModal();
        await loadAdCampaigns();
        await loadAdsRuntime();
    } catch (e) {
        // Error already handled in apiFetch
    }
}

async function editAdCampaign(campaignId) {
    const targetId = Number(campaignId || 0);
    if (!Number.isInteger(targetId) || targetId <= 0) return;

    if (!currentState.adsBreakSets.length) {
        await loadAdBreakSets();
    }
    if (!currentState.adTracks.length) {
        await loadAdTracksForCampaignForm();
    }

    let row = (currentState.adsCampaigns || []).find(campaign => Number(campaign.id) === targetId);
    if (!row) {
        await loadAdCampaigns();
        row = (currentState.adsCampaigns || []).find(campaign => Number(campaign.id) === targetId);
    }
    if (!row) {
        showToast('Ad campaign not found', 'error');
        return;
    }

    currentState.adCampaignModalEditorId = targetId;
    const modalEl = document.getElementById('adCampaignEditModal');
    const labelEl = document.getElementById('adCampaignEditLabel');
    const nameEl = document.getElementById('adCampaignEditName');
    const startEl = document.getElementById('adCampaignEditStart');
    const endEl = document.getElementById('adCampaignEditEnd');
    const dayIntervalEl = document.getElementById('adCampaignEditDayInterval');
    const dailyLimitEl = document.getElementById('adCampaignEditDailyLimit');
    const priorityEl = document.getElementById('adCampaignEditPriority');
    const notesEl = document.getElementById('adCampaignEditNotes');
    const activeEl = document.getElementById('adCampaignEditActive');

    if (!modalEl || !nameEl || !startEl || !endEl || !dayIntervalEl || !dailyLimitEl || !priorityEl || !notesEl || !activeEl) {
        showToast('Edit modal could not be opened', 'error');
        return;
    }

    if (labelEl) labelEl.textContent = `Campaign #${targetId}`;
    nameEl.value = row.name || '';
    startEl.value = row.start_date || todayIsoDate();
    endEl.value = row.end_date || row.start_date || todayIsoDate();
    dayIntervalEl.value = String(Math.max(1, Number(row.day_interval || 1)));
    dailyLimitEl.value = String(Math.max(0, Number(row.daily_repeat_limit || 0)));
    priorityEl.value = String(Number(row.priority || 0));
    notesEl.value = row.notes || '';
    activeEl.checked = !!row.is_active;

    const slotIds = Array.isArray(row.slot_ids) ? row.slot_ids : [];
    const trackIds = Array.isArray(row.track_ids) ? row.track_ids : [];
    const breakSetIds = inferBreakSetIdsFromSlotIds(slotIds);
    renderAdCampaignEditBreakSetOptions(breakSetIds);
    renderAdCampaignEditTrackOptions(trackIds);
    modalEl.style.display = 'flex';
}

async function deleteAdCampaign(campaignId) {
    const targetId = Number(campaignId || 0);
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    if (!confirm('Delete this ad campaign?')) return;

    try {
        await apiFetch(
            `${API_BASE}/api/ad-campaigns/${targetId}?station_id=${currentState.currentStationId}`,
            { method: 'DELETE' }
        );
        if (Number(currentState.adCampaignEditorId || 0) === targetId) {
            resetAdCampaignForm();
        }
        if (Number(currentState.adCampaignModalEditorId || 0) === targetId) {
            closeAdCampaignEditModal();
        }
        showToast('Ad campaign deleted');
        await loadAdCampaigns();
        await loadAdsRuntime();
    } catch (e) {
        // Error already handled in apiFetch
    }
}

function renderAdsRuntimeTableRows(targetBodyId, rows, emptyText) {
    const tbody = document.getElementById(targetBodyId);
    if (!tbody) return;
    const entries = Array.isArray(rows) ? rows : [];

    if (!entries.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">${escapeHtml(emptyText)}</td></tr>`;
        return;
    }

    tbody.innerHTML = entries.map(row => {
        const activeCampaigns = Array.isArray(row.active_campaigns) ? row.active_campaigns : [];
        const campaignLabel = activeCampaigns.length
            ? activeCampaigns.map(c => c.name || `Campaign #${c.id}`).join(', ')
            : 'No active campaign';
        let status = row.played_today ? 'Played' : 'Upcoming';
        if (row.is_due && !row.played_today) {
            status = activeCampaigns.length ? 'Ready' : 'Due / No campaign';
        }
        return `
            <tr>
                <td>${escapeHtml(row.slot_time || '--:--')}</td>
                <td>${escapeHtml(row.break_set_name || '-')}</td>
                <td>${escapeHtml(campaignLabel)}</td>
                <td>${escapeHtml(status)}</td>
            </tr>
        `;
    }).join('');
}

function renderAdsRuntimeHistory(historyRows) {
    const historyEl = document.getElementById('adsRuntimeHistory');
    if (!historyEl) return;
    const rows = Array.isArray(historyRows) ? historyRows : [];

    if (!rows.length) {
        historyEl.innerHTML = 'No ad playback history yet.';
        return;
    }

    historyEl.innerHTML = rows.map(row => {
        const playedAt = row.played_at
            ? new Date(String(row.played_at).replace(' ', 'T')).toLocaleString('en-US', { hour12: false })
            : `${row.context_date || ''} ${row.context_time || ''}`.trim();
        const campaign = row.campaign_name || `Campaign #${row.campaign_id || '-'}`;
        const track = row.track_title || (row.track_id ? `Track #${row.track_id}` : 'No ad selected');
        const artist = row.track_artist ? ` - ${row.track_artist}` : '';
        return `<div>${escapeHtml(playedAt)} | ${escapeHtml(campaign)} | ${escapeHtml(`${track}${artist}`)}</div>`;
    }).join('');
}

async function loadAdsRuntime() {
    try {
        const data = await apiFetch(`${API_BASE}/api/ads/runtime?station_id=${currentState.currentStationId}`);
        currentState.adsRuntime = data || null;

        const nowEl = document.getElementById('adsRuntimeNow');
        if (nowEl) {
            const nowText = String(data?.now || '').trim();
            nowEl.textContent = nowText || '—';
        }

        renderAdsRuntimeTableRows('adsRuntimeDueBody', data?.due_slots || [], 'No due slot right now.');
        renderAdsRuntimeTableRows('adsRuntimeNextBody', data?.next_slots || [], 'No upcoming slot found.');
        renderAdsRuntimeHistory(data?.history || []);
        updateAdsPanelOverview(data);
        renderProgramBreakCountdown();
    } catch (e) {
        // Avoid noisy toasts during polling when panel is not open.
        if (currentState.panel === 'ads') {
            showToast('Ad runtime preview could not be loaded', 'error');
        }
        updateAdsPanelOverview(null);
        renderProgramBreakCountdown();
    }
}

// ==================== UTILS ====================

function formatDuration(sec) {
    if (!sec) return "00:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatDays(days) {
    if (days === '*') return "Every Day";
    const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return days.split(',').map(d => names[parseInt(d)]).join(', ');
}

function dismissToast(toast) {
    if (!toast || toast.dataset.closing === '1') return;
    toast.dataset.closing = '1';
    toast.classList.add('toast-leave');
    setTimeout(() => toast.remove(), 220);
}

function showToast(msg, type = 'success', options = {}) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const asObject = msg && typeof msg === 'object' && !Array.isArray(msg);
    const message = clipText(asObject ? (msg.message ?? '') : msg, 220) || (type === 'error' ? 'An error occurred' : 'Completed');
    const detail = clipText(options.detail ?? (asObject ? (msg.detail ?? '') : ''), 500);
    const normalizedType = String(type || 'success').toLowerCase() === 'warn' ? 'warning' : String(type || 'success').toLowerCase();
    const safeType = ['success', 'error', 'warning', 'info'].includes(normalizedType) ? normalizedType : 'success';
    const defaultTitle = safeType === 'error' ? 'Error'
        : safeType === 'warning' ? 'Warning'
            : safeType === 'info' ? 'Info'
                : 'Success';
    const title = clipText(options.title || defaultTitle, 64);
    const duration = Number.isFinite(options.duration) ? Number(options.duration) : (safeType === 'error' ? 9000 : 3800);
    const fingerprint = `${safeType}|${title}|${message}|${detail}`;
    const now = Date.now();
    if (fingerprint === lastToastFingerprint && (now - lastToastAt) < 1200) {
        return;
    }
    lastToastFingerprint = fingerprint;
    lastToastAt = now;

    const toast = document.createElement('div');
    toast.className = `toast toast-${safeType}`;

    const head = document.createElement('div');
    head.className = 'toast-head';

    const icon = document.createElement('span');
    icon.className = 'material-icons-round toast-icon';
    icon.textContent = safeType === 'error' ? 'error'
        : safeType === 'warning' ? 'warning'
            : safeType === 'info' ? 'info'
                : 'check_circle';
    head.appendChild(icon);

    const titleEl = document.createElement('div');
    titleEl.className = 'toast-title';
    titleEl.textContent = title;
    head.appendChild(titleEl);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '<span class="material-icons-round">close</span>';
    closeBtn.addEventListener('click', () => dismissToast(toast));
    head.appendChild(closeBtn);

    const messageEl = document.createElement('div');
    messageEl.className = 'toast-message';
    messageEl.textContent = message;

    toast.appendChild(head);
    toast.appendChild(messageEl);

    if (detail) {
        const detailEl = document.createElement('div');
        detailEl.className = 'toast-detail';
        detailEl.textContent = detail;
        toast.appendChild(detailEl);
    }

    container.appendChild(toast);
    if (duration > 0 && !options.persistent) {
        setTimeout(() => dismissToast(toast), duration);
    }
}

function renderPlaylistEditor() {
    const body = document.getElementById('playlistModalBody');
    if (!body) return;

    const items = playlistEditorState.items || [];
    if (!items.length) {
        body.innerHTML = `<div class="playlist-editor-empty">This playlist is empty. You can add tracks from the library.</div>`;
        return;
    }

    body.innerHTML = `
        <div class="playlist-editor-summary">Total ${items.length} tracks. You can reorder or remove tracks.</div>
        <div class="table-wrapper">
            <table class="track-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Track</th>
                        <th>Artist</th>
                        <th>Duration</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map((item, idx) => `
                        <tr>
                            <td>${idx + 1}</td>
                            <td>${item.title || 'Untitled'}</td>
                            <td>${item.artist || 'Unknown'}</td>
                            <td>${formatDuration(item.duration || 0)}</td>
                            <td>
                                <div class="playlist-item-actions">
                                    <button class="btn-sm" onclick="movePlaylistItem(${item.item_id}, -1)" title="Up" ${idx === 0 ? 'disabled' : ''}>
                                        <span class="material-icons-round">arrow_upward</span>
                                    </button>
                                    <button class="btn-sm" onclick="movePlaylistItem(${item.item_id}, 1)" title="Down" ${idx === items.length - 1 ? 'disabled' : ''}>
                                        <span class="material-icons-round">arrow_downward</span>
                                    </button>
                                    <button class="btn-sm delete-btn" onclick="removePlaylistItem(${item.item_id})" title="Delete">
                                        <span class="material-icons-round">delete</span>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function savePlaylistOrder(nextItems, toastMessage = '') {
    const playlistId = playlistEditorState.playlistId;
    if (!playlistId) return;

    await apiFetch(`${API_BASE}/api/playlists/${playlistId}/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_ids: nextItems.map(x => x.item_id) })
    });

    playlistEditorState.items = nextItems.map((item, idx) => ({ ...item, position: idx + 1 }));
    renderPlaylistEditor();
    _playlistCache = [];
    await loadPlaylists();

    if (toastMessage) showToast(toastMessage);
}

async function movePlaylistItem(itemId, direction) {
    const items = playlistEditorState.items || [];
    const currentIndex = items.findIndex(x => x.item_id === itemId);
    if (currentIndex < 0) return;

    const targetIndex = direction < 0 ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    const nextItems = items.slice();
    [nextItems[currentIndex], nextItems[targetIndex]] = [nextItems[targetIndex], nextItems[currentIndex]];

    try {
        await savePlaylistOrder(nextItems, 'Playlist order updated');
    } catch (e) { /* Error handled in apiFetch */ }
}

async function removePlaylistItem(itemId) {
    const playlistId = playlistEditorState.playlistId;
    if (!playlistId) return;

    try {
        await apiFetch(`${API_BASE}/api/playlists/${playlistId}/items/${itemId}`, { method: 'DELETE' });

        const remaining = (playlistEditorState.items || []).filter(x => x.item_id !== itemId);
        if (remaining.length) {
            await savePlaylistOrder(remaining);
        } else {
            playlistEditorState.items = [];
            renderPlaylistEditor();
            _playlistCache = [];
            await loadPlaylists();
        }

        showToast('Track removed from playlist');
    } catch (e) { /* Error handled in apiFetch */ }
}

async function viewPlaylist(id) {
    try {
        const data = await apiFetch(`${API_BASE}/api/playlists/${id}`);
        playlistEditorState = {
            playlistId: id,
            name: data.name || 'Playlist',
            items: data.items || []
        };

        document.getElementById('playlistModalTitle').textContent = `${playlistEditorState.name} (Edit)`;
        renderPlaylistEditor();
        document.getElementById('playlistModal').style.display = 'flex';
    } catch (e) { /* Error handled in apiFetch */ }
}

async function deleteCurrentPlaylist() {
    const playlistId = playlistEditorState.playlistId;
    if (!playlistId) return showToast("No playlist selected", "error");

    const playlistName = playlistEditorState.name || "this playlist";
    if (!confirm(`Are you sure you want to delete "${playlistName}"?`)) return;

    try {
        await apiFetch(`${API_BASE}/api/playlists/${playlistId}`, { method: 'DELETE' });
        closePlaylistModal();
        _playlistCache = [];
        await loadPlaylists();
        await loadSchedule();
        showToast("Playlist deleted");
    } catch (e) { /* Error handled in apiFetch */ }
}

function closePlaylistModal() {
    document.getElementById('playlistModal').style.display = 'none';
    playlistEditorState = { playlistId: null, name: '', items: [] };
}

// -- Playlist'e şarkı ekleme dialog --
let _playlistCache = [];
async function addToPlaylistDialog(trackId) {
    // Eğer playlist cache boşsa, yükle
    if (!_playlistCache.length) {
        try {
            const data = await apiFetch(`${API_BASE}/api/playlists?station_id=${currentState.currentStationId}`);
            _playlistCache = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
        } catch (e) { return showToast("Playlists could not be loaded", "error"); }
    }

    if (!_playlistCache.length) return showToast("No playlist has been created yet!", "error");

    // Basit bir dropdown modal göster
    const choices = _playlistCache.map(p =>
        `<button onclick="addTrackToPlaylist(${p.id}, ${trackId}, '${escapeInlineJsString(p.name || '')}')">
            <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:6px">queue_music</span>
            ${escapeHtml(p.name || 'Playlist')}
        </button>`
    ).join('');

    // Mevcut dropdown varsa kaldır
    document.querySelectorAll('.add-to-playlist-dropdown.show').forEach(el => el.remove());

    // Yeni dropdown oluştur
    const dropdown = document.createElement('div');
    dropdown.className = 'add-to-playlist-dropdown show';
    dropdown.style.position = 'fixed';
    dropdown.style.zIndex = '999';
    dropdown.innerHTML = `<div style="padding:8px 16px;font-size:11px;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border)">SELECT PLAYLIST</div>${choices}`;

    // Ekranın ortasına yerleştir
    dropdown.style.top = '50%';
    dropdown.style.left = '50%';
    dropdown.style.transform = 'translate(-50%, -50%)';
    document.body.appendChild(dropdown);

    // Dışarı tıklayınca kapat
    setTimeout(() => {
        document.addEventListener('click', function closeDD(e) {
            if (!dropdown.contains(e.target)) {
                dropdown.remove();
                document.removeEventListener('click', closeDD);
            }
        });
    }, 100);
}

async function addTrackToPlaylist(playlistId, trackId, playlistName) {
    try {
        await apiFetch(`${API_BASE}/api/playlists/${playlistId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ track_id: trackId, position: 0 })
        });
        showToast(`Added to "${playlistName}"`);
        _playlistCache = [];
        await loadPlaylists();

        if (playlistEditorState.playlistId === playlistId) {
            await viewPlaylist(playlistId);
        }
    } catch (e) {
        showToast('Could not add!', 'error');
    }
    document.querySelectorAll('.add-to-playlist-dropdown.show').forEach(el => el.remove());
}
