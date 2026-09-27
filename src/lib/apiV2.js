/**
 * src/lib/apiV2.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Client for the backend's /api/v2 endpoints (see backend routes/v2/index.js).
 *
 * Every v2 response is { success, data, error, meta }. This wrapper:
 *   • unwraps it — resolves to { data, meta }, rejects with an ApiError
 *     ({ code, message, status, details, retryable }) that UI can show as-is
 *   • puts a hard timeout on every request (10s default, never "spins forever")
 *   • retries transient failures (network drop, 408/429/5xx) with exponential
 *     backoff + jitter — GETs always, mutations only when they carry an
 *     Idempotency-Key, so a retry can never create a duplicate
 *   • honours Retry-After on 429/503
 *
 * Built on the shared authenticated axios instance (src/api.js), so the JWT
 * and silent token refresh keep working unchanged.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import api from '../api';

export const DEFAULT_TIMEOUT_MS = 12_000; // server answers (or 504s) within 10s

export class ApiError extends Error {
  constructor({ message, code, status, details, retryable }) {
    super(message || 'Something went wrong. Please try again.');
    this.name = 'ApiError';
    this.code = code || 'UNKNOWN';
    this.status = status || 0;
    this.details = details;
    this.retryable = Boolean(retryable);
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export const newIdempotencyKey = () =>
  (window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).replace(/[^A-Za-z0-9_-]/g, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt, base = 400, max = 8000) => {
  const ceiling = Math.min(max, base * 2 ** (attempt - 1));
  return ceiling / 2 + Math.random() * (ceiling / 2);
};

/** Normalise any axios failure into an ApiError. */
export const toApiError = (err) => {
  if (err instanceof ApiError) return err;
  if (err?.code === 'ERR_CANCELED') return new ApiError({ message: 'Cancelled.', code: 'CANCELLED' });
  const res = err?.response;
  if (!res) {
    const timedOut = err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '');
    return new ApiError({
      message: timedOut ? 'The server took too long to respond.' : 'Network problem — check your connection.',
      code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
      retryable: true,
    });
  }
  const body = res.data || {};
  const e = body.error && typeof body.error === 'object' ? body.error : { message: body.message || body.error };
  return new ApiError({
    message: e.message || `Request failed (${res.status}).`,
    code: e.code || `HTTP_${res.status}`,
    status: res.status,
    details: e.details,
    retryable: RETRYABLE_STATUS.has(res.status),
  });
};

/**
 * request('get', '/v2/products', { params })
 * request('post', '/v2/products', { data, idempotencyKey: newIdempotencyKey() })
 */
export const request = async (method, url, {
  data, params, headers = {}, timeout = DEFAULT_TIMEOUT_MS, retries,
  idempotencyKey, signal, onUploadProgress,
} = {}) => {
  const isRead = method.toLowerCase() === 'get';
  const maxRetries = retries ?? (isRead || idempotencyKey ? 3 : 0);
  const finalHeaders = { ...headers, ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) };

  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await api.request({ method, url, data, params, headers: finalHeaders, timeout, signal, onUploadProgress });
      const body = res.data;
      if (body && typeof body === 'object' && 'success' in body) {
        if (!body.success) throw new ApiError({ ...body.error, status: res.status });
        return { data: body.data, meta: body.meta || {}, status: res.status };
      }
      return { data: body, meta: {}, status: res.status };
    } catch (raw) {
      const err = toApiError(raw);
      if (err.code === 'CANCELLED' || !err.retryable || attempt > maxRetries || signal?.aborted) throw err;
      const retryAfter = Number(raw?.response?.headers?.['retry-after']);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
    }
  }
};

const v2 = {
  get: (url, opts) => request('get', url, opts),
  post: (url, data, opts = {}) => request('post', url, { ...opts, data }),
  patch: (url, data, opts = {}) => request('patch', url, { ...opts, data }),
  put: (url, data, opts = {}) => request('put', url, { ...opts, data }),
  delete: (url, opts) => request('delete', url, opts),
};

export default v2;
