/**
 * src/api.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all API communication in the Marqland Studios
 * admin app. Replaces both the old api.js and baseurl.js — import everything
 * you need from here.
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
 *  BASE_URL   — fully-qualified API base including /api suffix
 *               e.g. "http://localhost:5000/api"
 *  API_ROOT   — server root without /api suffix
 *               e.g. "http://localhost:5000"  — use to build static asset URLs
 *  getBaseUrl — @deprecated, kept for backward compat
 *
 * Default export
 * ──────────────
 *  api        — authenticated axios instance; use for all API calls
 *               api.get('/products')
 *               api.post('/vendors', payload)
 *
 * Features
 * ─────────
 *  • Structured logging on every request / response / error
 *  • Request timing (ms) logged on each response
 *  • Automatic JWT attach via request interceptor
 *  • Silent token-refresh on 401 with a single-flight queue
 *  • Force-logout when refresh fails or no refresh token exists
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
 * Use this to build static asset URLs, e.g. `${API_ROOT}${product.imageUrl}`
 * Note: after the R2 migration, imageUrl fields will be full https:// URLs
 * and won't need this prefix.
 */
export const API_ROOT = BASE_URL.replace('/api', '');

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
});

// ─── Token helpers ────────────────────────────────────────────────────────────
const TOKEN_KEY   = 'marqland_token';
const REFRESH_KEY = 'marqland_refresh';
const USER_KEY    = 'marqland_user';

const getToken        = ()      => localStorage.getItem(TOKEN_KEY);
const getRefreshToken = ()      => localStorage.getItem(REFRESH_KEY);
const setToken        = (token) => localStorage.setItem(TOKEN_KEY, token);
const clearAuth       = ()      => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
};

const bearerHeader = (token) => `Bearer ${token}`;

// ─── Request interceptor — attach JWT + stamp request start time ──────────────
api.interceptors.request.use(
  (config) => {
    config.metadata = { startTime: Date.now() };

    const token = getToken();
    if (token) {
      config.headers['Authorization'] = bearerHeader(token);
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

// ─── Response interceptor — log timing, handle 401 / refresh ─────────────────
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
  clearAuth();
  window.location.href = '/';
};

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

      if (isRefreshing) {
        // Park this request until the in-flight refresh resolves
        log.debug('Token refresh in progress — queuing request', originalRequest.url);
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((newToken) => {
          originalRequest.headers['Authorization'] = bearerHeader(newToken);
          return api(originalRequest);
        });
      }

      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        log.warn('No refresh token found — logging out');
        forceLogout();
        return Promise.reject(error);
      }

      isRefreshing = true;
      log.info('Attempting silent token refresh…');

      try {
        // Plain axios call to avoid re-triggering this interceptor
        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {
          refreshToken,
        });

        const newToken = data.accessToken;
        setToken(newToken);
        api.defaults.headers.common['Authorization'] = bearerHeader(newToken);
        originalRequest.headers['Authorization']     = bearerHeader(newToken);

        log.info('Token refreshed successfully');
        flushQueue(null, newToken);
        return api(originalRequest);

      } catch (refreshError) {
        log.error('Token refresh failed', refreshError.message);
        flushQueue(refreshError, null);
        forceLogout();
        return Promise.reject(refreshError);

      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;