/**
 * src/pages/orders/ordersApi.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Every Order Management call to the backend's /api/v2/orders, in one place.
 * Built on lib/apiV2.js, so each call gets the standard envelope unwrapping,
 * a hard timeout, ApiError messages the UI can show as-is, and automatic
 * retries for reads (mutations retry only when they carry an idempotency key,
 * so a retry can never create a duplicate order or double-start a project).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import api from '../../api';
import v2, { newIdempotencyKey, toApiError } from '../../lib/apiV2';

const BASE = '/v2/orders';
const once = () => ({ idempotencyKey: newIdempotencyKey() });
const data = (p) => p.then((r) => r.data);

// Uploads and OCR legitimately take longer than the 12s default.
const SLOW = { timeout: 90_000 };
const UPLOAD = { timeout: 180_000 };

const form = (entries) => {
  const fd = new FormData();
  Object.entries(entries).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v) && v[0] instanceof Blob) v.forEach((f) => fd.append(k, f, f.name || 'file'));
    else if (v instanceof Blob) fd.append(k, v, v.name || 'file');
    else fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  return fd;
};

// The meta vocabulary (procurement stages) never changes at runtime — fetch once.
let metaPromise = null;
let vendorPromise = null;

const ordersApi = {
  meta: () => {
    if (!metaPromise) metaPromise = data(v2.get(`${BASE}/meta`)).catch((err) => { metaPromise = null; throw err; });
    return metaPromise;
  },

  /** [{ id, name, category, city, preferred }] — fetched once per page load, shared by every picker. */
  vendorOptions: () => {
    if (!vendorPromise) vendorPromise = data(v2.get(`${BASE}/vendor-options`)).catch((err) => { vendorPromise = null; throw err; });
    return vendorPromise;
  },

  list:   (params) => data(v2.get(BASE, { params })),
  get:    (id) => data(v2.get(`${BASE}/${id}`)),
  create: (payload) => data(v2.post(BASE, payload, once())),
  update: (id, patch) => data(v2.patch(`${BASE}/${id}`, patch, once())),
  remove: (id) => data(v2.delete(`${BASE}/${id}`)),

  /** Reads a quote PDF/image for the Start Project preview. Stores nothing. */
  parseQuote: (id, file) => data(v2.post(`${BASE}/${id}/quote/parse`, form({ quote: file }), SLOW)),

  /** Inquiry → ongoing, with the optional quote file and the confirmed line items. */
  start: (id, { quoteNumber, items, quoteDocument, file }) =>
    data(v2.post(`${BASE}/${id}/start`, form({ quoteNumber, items: items || [], quoteDocument, quote: file }), { ...SLOW, ...once() })),

  complete: (id, invoiceNumber) => data(v2.post(`${BASE}/${id}/complete`, { invoiceNumber }, once())),

  postTimeline: (id, payload) => data(v2.post(`${BASE}/${id}/timeline`, payload, once())),

  // ── Procurement items ──
  addItems:   (id, items) => data(v2.post(`${BASE}/${id}/items`, { items }, once())),
  updateItem: (id, itemId, patch) => data(v2.patch(`${BASE}/${id}/items/${itemId}`, patch)),
  removeItem: (id, itemId) => data(v2.delete(`${BASE}/${id}/items/${itemId}`)),

  // ── Files ──
  listFiles: (id) => v2.get(`${BASE}/${id}/files`, { timeout: 25_000 }).then((r) => ({ files: r.data, live: r.meta?.live })),

  /** @param {'attachment'|'screenshot'|'quote'} category */
  uploadFiles: (id, files, category, onProgress) =>
    v2.post(`${BASE}/${id}/files`, form({ files }), {
      ...UPLOAD, ...once(),
      params: { category },
      onUploadProgress: onProgress && ((e) => e.total && onProgress(Math.round((e.loaded / e.total) * 100))),
    }).then((r) => ({ files: r.data, failed: r.meta?.failed || [] })),

  removeFile: (id, itemId) => data(v2.delete(`${BASE}/${id}/files/${encodeURIComponent(itemId)}`, { timeout: 25_000 })),

  /**
   * The file's bytes as a Blob, through the authenticated endpoint (the JWT
   * rides on the shared axios instance — no public proxy, no expiring links).
   */
  fileBlob: async (id, itemId, { signal } = {}) => {
    try {
      const res = await api.get(`${BASE}/${id}/files/${encodeURIComponent(itemId)}/content`, {
        responseType: 'blob', timeout: 120_000, signal,
      });
      return res.data;
    } catch (err) {
      throw toApiError(err);
    }
  },
};

export default ordersApi;
