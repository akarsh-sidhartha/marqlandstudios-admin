/**
 * src/baseurl.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolves the API base URL once at module load time so every caller gets the
 * same value without recomputing on every request.
 *
 * Priority order:
 *  1. REACT_APP_API_URL env var   (set in .env.production / CI)
 *  2. Same-origin /api             (Cloudflare / nginx reverse-proxy in prod)
 *  3. http://localhost:5000/api    (local dev fallback)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from './utils/logger';

const log = createLogger('baseurl');

const resolveBaseUrl = () => {
  // 1. Explicit override — highest priority (set this in CI or .env.production)
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

  // 3. Local development
  const url = 'http://localhost:5000/api';
  log.debug('Using local dev API URL', url);
  return url;
};

// Resolved once — stable reference for the lifetime of the page.
export const BASE_URL = resolveBaseUrl();

/** @deprecated Use the named export BASE_URL wherever possible. */
export const getBaseUrl = () => BASE_URL;