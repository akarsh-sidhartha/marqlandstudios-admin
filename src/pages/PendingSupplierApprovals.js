/**
 * src/components/PendingSupplierApprovals.js
 * ─────────────────────────────────────────────────────────────────────────────
 * "Pending Supplier Approval" panel for the internal Products view.
 * Drop-in companion to ProductList.js — imports its design tokens so it looks
 * native rather than bolted on. See PRODUCTLIST_PENDING_APPROVALS_PATCH.md
 * for the two lines needed to wire it into ProductList.js itself.
 *
 * Talks to:
 *   GET /api/admin/supplier-products/pending
 *   PUT /api/admin/supplier-products/:id/approve   { category, subCategory, purchasePrice, markupPercent }
 *   PUT /api/admin/supplier-products/:id/reject     { reason }
 *
 * On successful approve, calls onApproved() so the parent ProductList can
 * refetch /products + /products/meta (the new Product is now live).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import {
  Clock, X, CheckCircle2, XCircle, ChevronRight, Play, ExternalLink, Loader2,
} from 'lucide-react';

const T = {
  navy: '#0e1520', gold: '#b8975a', gold2: '#d4b06a', offwhite: '#faf8f5',
  text: '#1a1a1a', muted: '#888', border: 'rgba(0,0,0,0.07)',
  borderG: 'rgba(184,151,90,0.18)', red: '#dc2626', green: '#16a34a',
};
const jost = '"Jost", sans-serif';
const serif = '"Cormorant Garamond", Georgia, serif';

const inputStyle = () => ({
  width: '100%', padding: '9px 12px', border: `1px solid ${T.border}`, borderRadius: 3,
  fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.text,
  background: 'white', outline: 'none', boxSizing: 'border-box',
});

// Mirrors ProductList.js's own pricing helper exactly, so the numbers here
// match what the catalogue displays once published.
const calculateSellingPrice = (buy, mark) => {
  const price  = parseFloat(buy  || 0);
  const markup = parseFloat(mark || 0);
  return (price + (price * markup / 100)).toFixed(0);
};

const MARKUP_OPTIONS = Array.from({ length: 20 }, (_, i) => (i + 1) * 5); // 5, 10, 15 ... 100

/**
 * Trigger button — shows a live pending count badge. Render this in
 * ProductList.js's action-buttons row (see patch doc).
 */
export const PendingApprovalsButton = ({ onClick }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    const load = () => api.get('/admin/supplier-products/pending')
      .then(res => { if (mounted) setCount(res.data.length); })
      .catch(() => {});
    load();
    const interval = setInterval(load, 60000); // light polling — refreshed properly on modal close too
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  return (
    <button
      onClick={onClick}
      title="Review supplier submissions"
      style={{
        position: 'relative',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: 'transparent', border: `1px solid ${T.border}`,
        padding: '9px 16px', borderRadius: 2,
        fontFamily: jost, fontSize: 10, fontWeight: 400,
        letterSpacing: '0.18em', textTransform: 'uppercase',
        color: T.muted, cursor: 'pointer', transition: 'all 0.2s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = T.gold; e.currentTarget.style.color = T.gold; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.muted; }}
    >
      <Clock size={13} /> Pending Approval
      {count > 0 && (
        <span style={{
          position: 'absolute', top: -7, right: -7,
          background: T.red, color: 'white', fontSize: 9, fontWeight: 600,
          borderRadius: '50%', minWidth: 17, height: 17,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {count}
        </span>
      )}
    </button>
  );
};

/**
 * Full panel — list + review modal. Render conditionally when open.
 *
 * Props:
 *   meta        - the same { categories, subCategories } object ProductList already fetches
 *   onClose     - close the panel
 *   onApproved  - called after a successful approve, so ProductList can refetch /products
 */
const PendingSupplierApprovals = ({ meta, onClose, onApproved }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(null); // the row being reviewed
  const [lightboxImage, setLightboxImage] = useState(null); // NEW — full-res thumbnail preview
  const [reviewForm, setReviewForm] = useState({ category: '', subCategory: '', purchasePrice: '', markupPercent: 10 });
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/supplier-products/pending');
      setRows(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load pending submissions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openReview = (row) => {
    setReviewing(row);
    setRejecting(false);
    setRejectReason('');
    setReviewForm({
      category: '', subCategory: '', markupPercent: 10,
      // The supplier's suggested "Selling Price" becomes the starting
      // Purchase Price here — no separate Selling Price field needed in
      // this form; the final selling price is purchasePrice + markup below.
      purchasePrice: row.sellingPrice ? String(row.sellingPrice) : '',
    });
    setError('');
  };

  const closeReview = () => setReviewing(null);

  const submitApprove = async () => {
    if (!reviewForm.category.trim()) { setError('Category is required.'); return; }
    if (reviewForm.purchasePrice === '' || Number(reviewForm.purchasePrice) <= 0) {
      setError('A valid purchase price is required.'); return;
    }
    setSaving(true);
    setError('');
    try {
      await api.put(`/admin/supplier-products/${reviewing._id}/approve`, {
        category: reviewForm.category.trim(),
        subCategory: reviewForm.subCategory.trim(),
        purchasePrice: Number(reviewForm.purchasePrice),
        sellingPrice: Number(calculateSellingPrice(reviewForm.purchasePrice, reviewForm.markupPercent)),
        markupPercent: Number(reviewForm.markupPercent) || 10,
      });
      setReviewing(null);
      await load();
      onApproved?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Approval failed.');
    } finally {
      setSaving(false);
    }
  };

  const submitReject = async () => {
    if (!rejectReason.trim()) { setError('Please provide a reason for rejection.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.put(`/admin/supplier-products/${reviewing._id}/reject`, { reason: rejectReason.trim() });
      setReviewing(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Rejection failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(14,21,32,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div className="animate-modal-up" style={{
        background: T.offwhite, width: '100%', maxWidth: 980, maxHeight: '88vh',
        borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.25)',
      }}>
        {/* Header */}
        <div style={{
          padding: '24px 32px', borderBottom: `1px solid ${T.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white',
        }}>
          <div>
            <p style={{ fontFamily: jost, fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: T.muted, marginBottom: 6 }}>
              Supplier Portal
            </p>
            <h2 style={{ fontFamily: serif, fontSize: 26, fontWeight: 300, color: T.navy, margin: 0 }}>
              Pending <em style={{ color: T.gold }}>Approvals.</em>
            </h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted }}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {loading ? (
            <p style={{ fontFamily: jost, color: T.muted, textAlign: 'center', padding: 40 }}>
              <Loader2 size={16} className="animate-spin" style={{ marginRight: 8, verticalAlign: 'middle' }} />
              Loading submissions…
            </p>
          ) : rows.length === 0 ? (
            <p style={{ fontFamily: jost, color: T.muted, textAlign: 'center', padding: 40 }}>
              No pending supplier submissions right now.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rows.map(row => (
                <div
                  key={row._id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openReview(row)}
                  onKeyDown={e => { if (e.key === 'Enter') openReview(row); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 16, width: '100%', textAlign: 'left',
                    background: 'white', border: `1px solid ${T.border}`, borderRadius: 3,
                    padding: 14, cursor: 'pointer', transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = T.borderG; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}
                >
                  {/* NEW — thumbnail opens a full-res lightbox instead of the review modal */}
                  <img
                    src={row.imageUrl}
                    alt=""
                    onClick={e => { e.stopPropagation(); setLightboxImage(row.imageUrl); }}
                    style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 2, flexShrink: 0, cursor: 'zoom-in' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: jost, fontSize: 13, fontWeight: 500, color: T.text, margin: 0 }}>{row.name}</p>
                    <p style={{ fontFamily: jost, fontSize: 11, color: T.muted, margin: '2px 0 0' }}>
                      {row.brand} · Submitted by {row.supplier?.supplierCompanyName || row.supplier?.name || 'Unknown supplier'}
                    </p>
                  </div>
                  {row.additionalImages?.length > 0 && (
                    <span style={{ fontFamily: jost, fontSize: 10, color: T.muted }}>+{row.additionalImages.length} images</span>
                  )}
                  <ChevronRight size={16} color={T.muted} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Review sub-modal ── */}
      {reviewing && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 310, background: 'rgba(14,21,32,0.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div className="animate-modal-up" style={{
            background: 'white', width: '100%', maxWidth: 720, maxHeight: '88vh', overflowY: 'auto',
            borderRadius: 4, padding: 32, boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <h3 style={{ fontFamily: serif, fontSize: 22, fontWeight: 300, color: T.navy, margin: 0 }}>{reviewing.name}</h3>
                <p style={{ fontFamily: jost, fontSize: 11, color: T.muted, marginTop: 4 }}>
                  {reviewing.brand} · from {reviewing.supplier?.supplierCompanyName || reviewing.supplier?.name} ({reviewing.supplier?.email})
                </p>
              </div>
              <button onClick={closeReview} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted }}><X size={18} /></button>
            </div>

            {/* Images — click to open full-res lightbox */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <img src={reviewing.imageUrl} alt="" onClick={() => setLightboxImage(reviewing.imageUrl)}
                style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 3, border: `2px solid ${T.gold}`, cursor: 'zoom-in' }} />
              {(reviewing.additionalImages || []).map((src, i) => (
                <img key={i} src={src} alt="" onClick={() => setLightboxImage(src)}
                  style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 3, border: `1px solid ${T.border}`, cursor: 'zoom-in' }} />
              ))}
            </div>

            <p style={{ fontFamily: jost, fontSize: 12, color: T.text, lineHeight: 1.7, marginBottom: 16, whiteSpace: 'pre-wrap' }}>
              {reviewing.description}
            </p>

            {/* Video */}
            {(reviewing.videoUrl || reviewing.videoOneDrivePath) && (
              <div style={{ marginBottom: 20, padding: '10px 14px', background: T.offwhite, borderRadius: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Play size={14} color={T.gold} />
                {reviewing.videoUrl ? (
                  <a href={reviewing.videoUrl} target="_blank" rel="noreferrer" style={{ fontFamily: jost, fontSize: 12, color: T.navy }}>
                    {reviewing.videoUrl}
                  </a>
                ) : (
                  <span style={{ fontFamily: jost, fontSize: 12, color: T.muted }}>
                    Video on OneDrive: {reviewing.videoOneDrivePath} <ExternalLink size={11} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
                  </span>
                )}
              </div>
            )}

            {error && (
              <p style={{ fontFamily: jost, fontSize: 12, color: T.red, marginBottom: 12 }}>{error}</p>
            )}

            {!rejecting ? (
              <>
                {/* Category / subcategory / pricing */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontFamily: jost, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Category *</label>
                    <input
                      list="pending-approval-categories"
                      style={inputStyle()}
                      value={reviewForm.category}
                      onChange={e => setReviewForm(f => ({ ...f, category: e.target.value }))}
                      placeholder="Select or type a category"
                    />
                    <datalist id="pending-approval-categories">
                      {(meta?.categories || []).map(c => <option key={c} value={c} />)}
                    </datalist>
                  </div>
                  <div>
                    <label style={{ fontFamily: jost, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Sub-category</label>
                    <input
                      list="pending-approval-subcategories"
                      style={inputStyle()}
                      value={reviewForm.subCategory}
                      onChange={e => setReviewForm(f => ({ ...f, subCategory: e.target.value }))}
                      placeholder="Optional"
                    />
                    <datalist id="pending-approval-subcategories">
                      {(meta?.subCategories?.[reviewForm.category] || []).map(s => <option key={s} value={s} />)}
                    </datalist>
                  </div>
                  <div>
                    <label style={{ fontFamily: jost, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Purchase Price (₹) *</label>
                    <input type="number" style={inputStyle()} value={reviewForm.purchasePrice}
                      onChange={e => setReviewForm(f => ({ ...f, purchasePrice: e.target.value }))} placeholder="0" />
                  </div>
                  <div>
                    <label style={{ fontFamily: jost, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Markup %</label>
                    <select style={inputStyle()} value={reviewForm.markupPercent}
                      onChange={e => setReviewForm(f => ({ ...f, markupPercent: e.target.value }))}>
                      {MARKUP_OPTIONS.map(m => <option key={m} value={m}>{m}%</option>)}
                    </select>
                  </div>
                </div>

                {reviewForm.purchasePrice !== '' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.offwhite, padding: '10px 14px', marginBottom: 12, borderRadius: 3 }}>
                    <span style={{ fontFamily: jost, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Final Selling Price</span>
                    <span style={{ fontFamily: jost, fontSize: 16, fontWeight: 600, color: T.navy }}>
                      ₹{calculateSellingPrice(reviewForm.purchasePrice, reviewForm.markupPercent)}
                    </span>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                  <button onClick={submitApprove} disabled={saving} style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    background: T.gold, color: T.navy, border: 'none', padding: '12px 20px', borderRadius: 2,
                    fontFamily: jost, fontSize: 11, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer',
                  }}>
                    <CheckCircle2 size={15} /> {saving ? 'Publishing…' : 'Approve & Publish'}
                  </button>
                  <button onClick={() => setRejecting(true)} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'transparent', color: T.red, border: `1px solid ${T.red}`, padding: '12px 20px', borderRadius: 2,
                    fontFamily: jost, fontSize: 11, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer',
                  }}>
                    <XCircle size={15} /> Reject
                  </button>
                </div>
              </>
            ) : (
              <>
                <label style={{ fontFamily: jost, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Reason for rejection *</label>
                <textarea
                  rows={3}
                  style={{ ...inputStyle(), marginTop: 6, resize: 'none' }}
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="Let the supplier know what needs fixing before resubmitting…"
                />
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <button onClick={submitReject} disabled={saving} style={{
                    flex: 1, background: T.red, color: 'white', border: 'none', padding: '12px 20px', borderRadius: 2,
                    fontFamily: jost, fontSize: 11, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer',
                  }}>
                    {saving ? 'Sending…' : 'Confirm Rejection'}
                  </button>
                  <button onClick={() => setRejecting(false)} style={{
                    background: 'transparent', border: `1px solid ${T.border}`, color: T.muted, padding: '12px 20px', borderRadius: 2,
                    fontFamily: jost, fontSize: 11, cursor: 'pointer',
                  }}>
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* NEW — full-res thumbnail lightbox */}
      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, cursor: 'zoom-out',
          }}
        >
          <button
            onClick={() => setLightboxImage(null)}
            style={{ position: 'absolute', top: 24, right: 24, background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}
          >
            <X size={28} />
          </button>
          <img
            src={lightboxImage}
            alt=""
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
          />
        </div>
      )}
    </div>
  );
};

export default PendingSupplierApprovals;