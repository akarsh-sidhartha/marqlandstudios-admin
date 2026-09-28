/**
 * paymentTracker/shared.js
 * Design tokens, formatters, date/FY helpers and the relationship helpers
 * (which payments belong to which PI / invoice) used across the tracker.
 */

// ── Design tokens ─────────────────────────────────────────────────────────────
export const T = {
  navy: '#0e1520',
  gold: '#b8975a',
  gold2: '#d4b06a',
  offwhite: '#faf8f5',
  text: '#1a1a1a',
  muted: '#888',
  border: 'rgba(0,0,0,0.07)',
  borderG: 'rgba(184,151,90,0.18)',
  dimBg: 'rgba(184,151,90,0.04)',
  red: '#dc2626',
  green: '#10b981',
  blue: '#1d4ed8',
  indigo: '#6366f1',
  cyan: '#0891b2',
  amber: '#f59e0b',
  slate: '#475569',
  slateL: '#94a3b8',
};
export const jost = '"Jost", sans-serif';
export const serif = '"Cormorant Garamond", Georgia, serif';

export const STATUS_META = {
  pending: { label: 'Pending', color: '#f59e0b' },
  partial: { label: 'Partial', color: '#3b82f6' },
  fully_paid: { label: 'Fully Paid', color: '#10b981' },
  invoiced: { label: 'Invoiced', color: '#8b5cf6' },
  cancelled: { label: 'Cancelled', color: '#6b7280' },
  recorded: { label: 'Recorded', color: '#f59e0b' },
  verified: { label: 'Verified', color: '#3b82f6' },
  reconciled: { label: 'Reconciled', color: '#10b981' },
  advance: { label: 'Advance', color: '#8b5cf6' },
};

export const PAYMENT_MODES = ['neft', 'rtgs', 'imps', 'upi', 'cheque', 'cash', 'other'];

// Shared input style
export const IS = {
  width: '100%', padding: '10px 14px',
  border: `1px solid ${T.border}`, borderRadius: 3,
  fontSize: 13, fontWeight: 300, outline: 'none',
  color: T.text, boxSizing: 'border-box',
  fontFamily: jost, background: '#fff',
  transition: 'border-color 0.2s',
};
export const IShi = (hi) => ({ ...IS, border: hi ? `1px solid ${T.gold}` : IS.border, background: hi ? T.dimBg : '#fff' });

// ── Formatters ────────────────────────────────────────────────────────────────
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export const fmt = (n = 0) => inr.format(n || 0);
export const fmtN = (n = 0) => num.format(n || 0);
export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const todayISO = () => new Date().toISOString().split('T')[0];

// ── Financial year ────────────────────────────────────────────────────────────
export const normalizeFY = (fy) =>
  !fy || fy === 'Unknown' || fy === 'Other'
    ? fy
    : fy.replace(/^(\d{4})-(\d{2,4})$/, (_, y, s) => `${y}-${String(s).slice(-2).padStart(2, '0')}`);

/** { fy: '2026-27', month: 'August' } for any date-ish value. */
export const fiscalOf = (dateLike) => {
  const d = dateLike ? new Date(dateLike) : new Date();
  if (Number.isNaN(d.getTime())) return { fy: 'Unknown', month: 'Unknown' };
  const y = d.getFullYear();
  const start = d.getMonth() < 3 ? y - 1 : y;
  return { fy: `${start}-${String(start + 1).slice(-2)}`, month: d.toLocaleString('en-US', { month: 'long' }) };
};
export const currentFY = () => fiscalOf(new Date()).fy;

// ── Relationships ─────────────────────────────────────────────────────────────
export const idOf = (ref) => String(ref?._id || ref || '');

/** Map<piId, payment[]> — any payment that moved a PI's balance. */
export const paymentsByPi = (payments) => {
  const map = new Map();
  for (const p of payments) {
    const id = idOf(p.proformaInvoice);
    if (!id) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(p);
  }
  return map;
};

/** Invoice → { direct payments, the PI it settles, that PI's payments }. */
export const invoiceTrail = (inv, { pis, payments }) => {
  const invId = String(inv._id);
  const matchedPI = pis.find((pi) => idOf(pi.finalInvoice) === invId) || null;
  const piId = matchedPI ? String(matchedPI._id) : null;
  const piPayments = piId ? payments.filter((p) => idOf(p.proformaInvoice) === piId) : [];
  const direct = payments.filter((p) => idOf(p.vendorInvoice) === invId && idOf(p.proformaInvoice) !== piId);
  return { direct, matchedPI, piPayments };
};

// ── Vendor matching (for names read off documents) ────────────────────────────
// Ignores spacing, punctuation and legal suffixes, then tolerates small OCR
// typos ("Marqgland Studios", "S RI GAY I HRI PRINTERS") via edit distance.
const norm = (s) => String(s || '').toLowerCase()
  .replace(/\b(pvt|private|ltd|limited|llp|co|company|the|m\/s)\b/g, '')
  .replace(/[^a-z0-9]/g, '');

const editDistance = (a, b) => {
  if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) / 3) return Infinity;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};

/** Best vendor record for a name/GSTIN read off a document, or null. */
export const matchVendor = (vendors, { name, gstin } = {}) => {
  if (gstin) {
    const byGst = vendors.find((v) => v.gstNumber && v.gstNumber.toUpperCase() === gstin.toUpperCase());
    if (byGst) return byGst;
  }
  const n = norm(name);
  if (n.length < 3) return null;
  const exact = vendors.find((v) => norm(v.companyName) === n);
  if (exact) return exact;
  const contains = vendors.filter((v) => { const c = norm(v.companyName); return c.length >= 4 && (c.includes(n) || n.includes(c)); });
  if (contains.length === 1) return contains[0];
  if (contains.length > 1) return null; // ambiguous — let the user pick
  // Closest name within ~20% edits, and clearly closer than the runner-up.
  const ranked = vendors
    .map((v) => { const c = norm(v.companyName); return { v, r: editDistance(n, c) / Math.max(n.length, c.length) }; })
    .filter((x) => x.r <= 0.2)
    .sort((x, y) => x.r - y.r);
  if (!ranked.length || (ranked[1] && ranked[1].r - ranked[0].r < 0.05)) return null;
  return ranked[0].v;
};

// ── Files ─────────────────────────────────────────────────────────────────────
export const ACCEPT_DOCS = '.pdf,image/jpeg,image/png,image/webp,image/heic';

/**
 * Shrink large photos before upload (phone cameras produce 4–8 MB images);
 * screenshots and PDFs pass through untouched. Keeps enough resolution for OCR.
 */
export const prepareFile = (file) =>
  new Promise((resolve) => {
    if (!file?.type?.startsWith('image/') || file.type === 'image/heic' || file.size < 1.5 * 1024 * 1024) return resolve(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 2200;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((blob) => resolve(blob ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file), 'image/jpeg', 0.9);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });

/** Case-insensitive "does any of these values contain q". */
export const matchesAny = (q, ...values) => {
  if (!q) return true;
  const s = q.toLowerCase();
  return values.some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(s));
};

// ── Search (one definition per record type, used by every tab and hint) ───────
export const piMatches = (p, q) => matchesAny(q,
  p.piNumber, p.vendor?.companyName, p.vendor?.gstNumber, p.status, STATUS_META[p.status]?.label,
  p.totalAmount, p.amountDue, p.notes, p.bankDetails, p.piDate ? fmtDate(p.piDate) : null,
  p.finalInvoice?.invoice_number);

export const paymentMatches = (p, q) => matchesAny(q,
  p.paymentRef, p.vendor?.companyName, p.bankRef, p.remarks, p.amount, p.paymentMode,
  p.paymentDate ? fmtDate(p.paymentDate) : null,
  p.proformaInvoice?.piNumber, p.vendorInvoice?.invoice_number, p.vendorInvoice?.vendor_name);

export const invoiceMatches = (inv, q) => matchesAny(q,
  inv.invoice_number, inv.vendor_name, inv.vendor_gst, inv.date ? fmtDate(inv.date) : null,
  inv.financialYear, inv.month, inv.total_amount, inv.notes, inv.receivedVia, inv.fileName);
