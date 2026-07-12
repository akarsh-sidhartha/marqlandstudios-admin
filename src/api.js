/**
 * src/api.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all API communication in the Marqland Studios
 * admin app, AND the single source of truth for the access token / refresh
 * flow. AuthContext.js no longer implements its own competing HTTP client —
 * it delegates all network calls to `api` and reads/writes the token via the
 * exports below, so there is exactly one refresh-token flow in the app.
 *
 * BASE URL priority order:
 *  1. REACT_APP_API_URL env var   (set in .env / .env.production)
 *     → dev:  REACT_APP_API_URL=http://localhost:5000
 *     → prod: REACT_APP_API_URL=https://api.marqlandstudios.com
 *  2. Same-origin /api             (Cloudflare / nginx reverse-proxy fallback)
 *  3. http://localhost:5000/api    (last-resort local dev fallback)
 *
 * Named exports
 * ─────────────
 *  BASE_URL          — fully-qualified API base including /api suffix
 *  API_ROOT           — server root without /api suffix
 *  getBaseUrl          — @deprecated, kept for backward compat
 *  getAccessToken      — current in-memory access token (or null)
 *  setAccessToken      — set the in-memory access token (used by AuthContext after login/refresh)
 *  clearAccessToken    — drop the in-memory access token
 *  getCachedUser/setCachedUser/clearCachedUser — cached profile for instant UI paint on reload
 *                         (display data only — never a credential, safe to keep in localStorage)
 *  refreshAccessToken  — exchanges the httpOnly refresh-token cookie for a new access token.
 *                         Single-flight: concurrent callers share one in-flight request.
 *
 * Default export
 * ──────────────
 *  api        — authenticated axios instance; use for all API calls
 *               api.get('/products')
 *               api.post('/vendors', payload)
 *
 * Token storage — SECURITY NOTE
 * ──────────────────────────────
 *  The access token lives ONLY in memory (a module-level variable, never
 *  localStorage), so it's naturally cleared on tab close/reload and can't be
 *  read by an XSS payload trawling storage. The refresh token never reaches
 *  the browser's JS at all — the backend sets it as an httpOnly, Secure,
 *  SameSite cookie on /auth/login and /auth/refresh (see authRoutes.js), so
 *  neither this file nor any component can read or leak it. On page load,
 *  AuthContext calls refreshAccessToken() to silently re-establish an access
 *  token using that cookie before rendering the authenticated app.
 *
 * Features
 * ─────────
 *  • Structured logging on every request / response / error
 *  • Request timing (ms) logged on each response
 *  • Automatic JWT attach via request interceptor
 *  • Silent token-refresh on 401 with a single-flight queue
 *  • Force-logout when refresh fails or no refresh-token cookie exists
 * ─────────────────────────────────────────────────────────────────────────────
 */

import axios from 'axios';
import { createLogger } from './utils/logger';

const log = createLogger('api');

// ─── Base URL resolution ──────────────────────────────────────────────────────
// Resolved once at module load — stable reference for the lifetime of the page.

const resolveBaseUrl = () => {
  // 1. Explicit env override — works for both dev and prod via .env
  if (process.env.REACT_APP_API_URL) {
    const url = `${process.env.REACT_APP_API_URL}/api`;
    log.info('Using env-configured API URL', url);
    return url;
  }

  // 2. Production: same-origin (Cloudflare / nginx routes /api → backend)
  if (
    typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
  ) {
    const { protocol, hostname } = window.location;
    const url = `${protocol}//${hostname}/api`;
    log.info('Using same-origin API URL', url);
    return url;
  }

  // 3. Last-resort local dev fallback (should rarely be needed given .env)
  const url = 'http://localhost:5000/api';
  log.debug('Using local dev API URL', url);
  return url;
};

/** Fully-qualified API base URL including /api suffix. */
export const BASE_URL = resolveBaseUrl();

/**
 * Server root without the /api suffix.
 * Uses a trailing-replace so "https://api.marqlandstudios.com/api"
 * becomes "https://api.marqlandstudios.com" — not "https:/.marqlandstudios.com"
 * which is what .replace('/api', '') (first-match) incorrectly produces.
 */
export const API_ROOT = BASE_URL.replace(/\/api$/, '');

/** @deprecated Use BASE_URL directly. Kept for backward compatibility. */
export const getBaseUrl = () => BASE_URL;

// ─── Axios instance ───────────────────────────────────────────────────────────
// NOTE: Do NOT set a global Content-Type header here.
// When sending FormData (file uploads), axios must auto-detect the content type
// and set "multipart/form-data; boundary=--XYZ…" automatically.
// A hardcoded "application/json" here overrides that and breaks all file uploads.
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  // Required so the browser attaches the httpOnly refresh_token cookie on
  // /auth/refresh and /auth/logout calls. Harmless on every other call — the
  // cookie is path-scoped to /api/auth server-side, so it's simply omitted
  // from requests to any other endpoint regardless of this flag.
  withCredentials: true,
});

// ─── Access-token store (in-memory only — see file header) ───────────────────
let accessToken = null;

export const getAccessToken   = () => accessToken;
export const setAccessToken   = (token) => { accessToken = token; };
export const clearAccessToken = () => { accessToken = null; };

// ─── Cached user profile (display data only, not a credential) ───────────────
const USER_KEY = 'marqland_user';

export const getCachedUser = () => {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
export const setCachedUser   = (user) => localStorage.setItem(USER_KEY, JSON.stringify(user));
export const clearCachedUser = () => localStorage.removeItem(USER_KEY);

const bearerHeader = (token) => `Bearer ${token}`;

// ─── Request interceptor — attach JWT + stamp request start time ──────────────
api.interceptors.request.use(
  (config) => {
    config.metadata = { startTime: Date.now() };

    if (accessToken) {
      config.headers['Authorization'] = bearerHeader(accessToken);
    }

    log.debug(`→ ${config.method?.toUpperCase()} ${config.url}`, {
      params: config.params,
    });

    return config;
  },
  (error) => {
    log.error('Request setup failed', error);
    return Promise.reject(error);
  }
);

// ─── Silent token refresh — single source of truth for the whole app ─────────
let isRefreshing = false;
let failedQueue  = [];   // [{ resolve, reject }]

const flushQueue = (error, token = null) => {
  failedQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve(token)
  );
  failedQueue = [];
};

const forceLogout = () => {
  log.warn('Session expired — forcing logout');
  clearAccessToken();
  clearCachedUser();
  window.location.href = '/';
};

/**
 * Exchanges the httpOnly refresh_token cookie for a new access token.
 * Single-flight: if a refresh is already in progress, concurrent callers
 * park on the same result instead of firing their own request (this is what
 * prevents the old two-refresh-implementations race between api.js and
 * AuthContext.js — there is now exactly one implementation, called from both
 * places).
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.silent=false] — when true, a failed refresh does NOT
 *   force a redirect to "/". Used for the initial page-load session check,
 *   where "no valid cookie" just means "not logged in yet", not "session
 *   expired mid-use" — without this flag every anonymous page load would
 *   bounce through forceLogout's window.location.href = '/' redirect.
 */
export const refreshAccessToken = async ({ silent = false } = {}) => {
  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      failedQueue.push({ resolve, reject });
    });
  }

  isRefreshing = true;
  log.info('Attempting silent token refresh…');

  try {
    const { data } = await axios.post(
      `${BASE_URL}/auth/refresh`,
      {},
      { withCredentials: true }
    );

    const newToken = data.accessToken;
    setAccessToken(newToken);

    log.info('Token refreshed successfully');
    flushQueue(null, newToken);
    return newToken;

  } catch (refreshError) {
    log.error('Token refresh failed', refreshError.message);
    flushQueue(refreshError, null);
    clearAccessToken();
    clearCachedUser();
    if (!silent) forceLogout();
    throw refreshError;

  } finally {
    isRefreshing = false;
  }
};

// ─── Response interceptor — log timing, handle 401 / refresh ─────────────────
api.interceptors.response.use(
  (response) => {
    const ms = Date.now() - (response.config.metadata?.startTime ?? Date.now());
    log.debug(
      `← ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url} (${ms}ms)`
    );
    return response;
  },

  async (error) => {
    const { config: originalRequest, response } = error;
    const status = response?.status;
    const ms     = Date.now() - (originalRequest?.metadata?.startTime ?? Date.now());

    log.error(
      `← ${status ?? 'ERR'} ${originalRequest?.method?.toUpperCase()} ${originalRequest?.url} (${ms}ms)`,
      error.message
    );

    // ── 401 → attempt silent token refresh ───────────────────────────────────
    if (status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const newToken = await refreshAccessToken();
        originalRequest.headers['Authorization'] = bearerHeader(newToken);
        return api(originalRequest);
      } catch (refreshError) {
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
