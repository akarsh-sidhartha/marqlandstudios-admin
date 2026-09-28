/**
 * paymentTracker/trackerApi.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Every Payment Tracker HTTP call lives here — components never build URLs or
 * FormData themselves.
 *
 *  • One `overview()` call loads the whole screen (PIs, payments, invoices,
 *    vendors). Filters run locally, so changing a filter costs no request.
 *  • Documents are read by the backend's open-source engine (`extract`) and
 *    sent as binary multipart — no base64 inflation, no paid AI API.
 *  • Every create carries an Idempotency-Key, so a double tap or a flaky
 *    mobile connection can never record the same payment twice.
 *  • Errors are normalised to { message, status, details } by `toApiError`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import api from '../../api';

const BASE = '/payment-tracker';

const newIdempotencyKey = () =>
  (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');

/** Plain object (+ optional File) → FormData. Skips empty values; arrays become JSON. */
export function toFormData(fields, file = null, fileField = 'file') {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) { if (v.length) fd.append(k, JSON.stringify(v)); return; }
    fd.append(k, v);
  });
  if (file) fd.append(fileField, file, file.name || fileField);
  return fd;
}

const ERROR_MESSAGES = {
  401: 'Your session has expired — please log in again.',
  403: "You don't have permission to perform this action.",
  404: 'The record was not found — it may have been deleted.',
  413: 'The file is too large. Please use a smaller image or PDF.',
  429: 'Too many requests — please wait a moment and try again.',
  500: 'A server error occurred. Please try again.',
  502: 'A storage service is temporarily unavailable. Please try again shortly.',
  503: 'This feature is temporarily unavailable.',
  504: 'The server took too long to respond. Please try again.',
};

/** Normalise any axios error into { message, status, details }. */
export function toApiError(e) {
  const status = e?.response?.status ?? (e?.code === 'ERR_NETWORK' ? 0 : null);
  const data = e?.response?.data || {};
  const fieldIssues = Array.isArray(data.details) ? data.details.map((d) => d.message).filter(Boolean) : [];
  const message =
    (fieldIssues.length && status === 400 ? fieldIssues.join(' ') : null)
    || (typeof data.error === 'string' && data.error.length < 240 ? data.error : null)
    || (typeof data.message === 'string' && data.message.length < 240 ? data.message : null)
    || ERROR_MESSAGES[status]
    || (status === 0 ? 'Network error — check your connection and try again.' : e?.message)
    || 'An unexpected error occurred. Please try again.';
  return { message, status, details: data.details };
}

export const friendlyError = (e) => toApiError(e).message;

/** True when the server rejected a create as a duplicate (409 with details.duplicate). */
export const duplicateInfo = (e) => (e?.response?.status === 409 && e.response.data?.details?.duplicate ? e.response.data.details : null);

const multipart = (url, fd, { method = 'post', idempotent = false } = {}) =>
  api.request({
    url, method, data: fd,
    headers: idempotent ? { 'Idempotency-Key': newIdempotencyKey() } : undefined,
    timeout: 120_000,
  }).then((r) => r.data);

const trackerApi = {
  overview: () => api.get(`${BASE}/overview`).then((r) => r.data),

  /** Read a PI / invoice / payment proof. docType: 'pi' | 'invoice' | 'payment' */
  extract: (file, docType) =>
    multipart(`${BASE}/extract`, toFormData({ docType }, file, 'file')),

  createPi: (fields, file) => multipart(`${BASE}/pi`, toFormData(fields, file, 'attachment'), { idempotent: true }),
  updatePi: (id, fields, file) => multipart(`${BASE}/pi/${id}`, toFormData(fields, file, 'attachment'), { method: 'patch' }),
  deletePi: (id) => api.delete(`${BASE}/pi/${id}`).then((r) => r.data),

  createInvoice: (fields, file) => multipart(`${BASE}/invoices`, toFormData(fields, file, 'file'), { idempotent: true }),
  deleteInvoice: (id) => api.delete(`${BASE}/invoices/${id}`).then((r) => r.data),

  createPayment: (fields, file) => multipart(`${BASE}/payments`, toFormData(fields, file, 'screenshot'), { idempotent: true }),
  mapPayment: (id, body) => api.patch(`${BASE}/payments/${id}/map`, body).then((r) => r.data),
  deletePayment: (id) => api.delete(`${BASE}/payments/${id}`).then((r) => r.data),
  linkPiToInvoice: (piId, invoiceId) => api.post(`${BASE}/payments/link-to-invoice`, { piId, invoiceId }).then((r) => r.data),

  saveVendorGst: (vendorId, gstNumber) => api.patch(`${BASE}/vendor-gst/${vendorId}`, { gstNumber }).then((r) => r.data),

  /** Fetch a stored document as a Blob (auth header attached by the api client). */
  fetchDocument: (path) => api.get(path.replace(/^\/api/, ''), { responseType: 'blob', timeout: 60_000 }),
};

export const docUrl = {
  invoice: (id) => `/api${BASE}/invoices/${id}/file`,
  piAttach: (id) => `/api${BASE}/pi/${id}/attachment`,
  payReceipt: (id) => `/api${BASE}/payments/${id}/screenshot`,
};

export default trackerApi;
