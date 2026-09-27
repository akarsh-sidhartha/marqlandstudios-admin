/**
 * src/pages/PendingSupplierApprovals.js
 * ─────────────────────────────────────────────────────────────────────────────
 * "Pending Approval" panel for the internal Products view. The queue holds
 * two kinds of item:
 *
 *   NEW PRODUCT     a partner's first submission — review details, images and
 *                   VIDEO (YouTube link or uploaded file, playable right here),
 *                   then set category/pricing and approve, or reject.
 *
 *   CHANGE REQUEST  a partner edited a product that is already live. Shown as
 *                   "Currently live" vs "Proposed" with every changed field
 *                   highlighted (text, price, images). For video only the
 *                   latest state is shown (a newer upload still processing
 *                   replaces the old video in the view). Nothing reaches
 *                   the catalogue — or any client quote containing the
 *                   product — until the change is approved here.
 *
 * Talks to:
 *   GET /api/admin/supplier-products/pending
 *   GET /api/admin/supplier-products/:id/video-stream?version=live|proposed
 *   PUT /api/admin/supplier-products/:id/approve          { category, subCategory, purchasePrice, sellingPrice, markupPercent }
 *   PUT /api/admin/supplier-products/:id/reject           { reason }
 *   PUT /api/admin/supplier-products/:id/approve-changes  { purchasePrice, markupPercent }
 *   PUT /api/admin/supplier-products/:id/reject-changes   { reason }
 *
 * On approval calls onApproved() so ProductList can refresh.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import {
  Clock, X, CheckCircle2, XCircle, ChevronRight, Play, Loader2, AlertCircle, Video, RefreshCw, Sparkles,
} from 'lucide-react';

const T = {
  navy: '#0e1520', gold: '#b8975a', gold2: '#d4b06a', offwhite: '#faf8f5',
  text: '#1a1a1a', muted: '#888', border: 'rgba(0,0,0,0.07)',
  borderG: 'rgba(184,151,90,0.18)', red: '#dc2626', green: '#16a34a', amber: '#d97706',
  changed: 'rgba(217,119,6,0.08)',
};
const jost = '"Jost", sans-serif';
const serif = '"Cormorant Garamond", Georgia, serif';

const inputStyle = () => ({
  width: '100%', padding: '9px 12px', border: `1px solid ${T.border}`, borderRadius: 3,
  fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.text,
  background: 'white', outline: 'none', boxSizing: 'border-box',
});
const fieldLabel = { fontFamily: jost, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' };

// Mirrors ProductList.js's pricing helper exactly.
const calculateSellingPrice = (buy, mark) => {
  const price  = parseFloat(buy  || 0);
  const markup = parseFloat(mark || 0);
  return (price + (price * markup / 100)).toFixed(0);
};

const MARKUP_OPTIONS = Array.from({ length: 20 }, (_, i) => (i + 1) * 5); // 5, 10 … 100

const getYouTubeId = (url) => {
  const patterns = [/youtu\.be\/([\w-]{6,})/, /youtube\.com\/watch\?[^#]*v=([\w-]{6,})/, /youtube\.com\/embed\/([\w-]{6,})/, /youtube\.com\/shorts\/([\w-]{6,})/];
  for (const re of patterns) { const m = String(url || '').match(re); if (m) return m[1]; }
  return null;
};

const supplierName = (row) => row.supplier?.supplierCompanyName || row.supplier?.name || 'Unknown partner';

/**
 * Trigger button — live count of everything waiting (new products + change requests).
 */
export const PendingApprovalsButton = ({ onClick }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    const load = () => api.get('/admin/supplier-products/pending')
      .then(res => { if (mounted) setCount(res.data.length); })
      .catch(() => {});
    load();
    const interval = setInterval(load, 60000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  return (
    <button
      onClick={onClick}
      title="Review partner submissions and changes"
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

// ─────────────────────────────────────────────────────────────────────────────
// Video preview — YouTube / brand link inline, or an uploaded (OneDrive) file
// played through a short-lived URL fetched on demand.
// ─────────────────────────────────────────────────────────────────────────────
const ReviewVideo = ({ rowId, video, version = 'proposed', compact = false }) => {
  const [playing, setPlaying] = useState(false);
  const [streamUrl, setStreamUrl] = useState(null);
  const [error, setError] = useState('');

  const source = video?.source || '';
  const processing = video?.upload?.status === 'processing';
  const failed = video?.upload?.status === 'failed';

  useEffect(() => {
    if (!playing || source !== 'upload') return undefined;
    let cancelled = false;
    setError('');
    api.get(`/admin/supplier-products/${rowId}/video-stream`, { params: { version }, timeout: 12000 })
      .then(res => { if (!cancelled) setStreamUrl(res.data.url); })
      .catch(err => { if (!cancelled) setError(err.response?.data?.message || 'Video unavailable.'); });
    return () => { cancelled = true; };
  }, [playing, source, rowId, version]);

  const box = { marginTop: 8, padding: compact ? '8px 10px' : '10px 14px', background: T.offwhite, borderRadius: 3 };

  // Only the LATEST video is shown. If the partner has a newer upload still
  // processing, that replaces whatever video was there before.
  if (processing) {
    return (
      <div style={box}>
        <span style={{ fontFamily: jost, fontSize: 12, color: T.amber, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Loader2 size={13} className="animate-spin" />
          The partner is uploading a new video{video?.upload?.fileName ? ` (${video.upload.fileName})` : ''} — it will appear here once processed.
        </span>
      </div>
    );
  }

  if (!source) {
    return (
      <div style={box}>
        <span style={{ fontFamily: jost, fontSize: 12, color: T.muted }}>No video</span>
      </div>
    );
  }

  const ytId = source === 'link' ? getYouTubeId(video.url) : null;
  const label = source === 'upload'
    ? `Uploaded video · ${video.fileName || 'video file'}`
    : ytId ? 'YouTube video' : 'Video link';

  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {source === 'upload' ? <Video size={14} color={T.gold} /> : <Play size={14} color={T.gold} />}
        <span style={{ fontFamily: jost, fontSize: 12, color: T.text }}>{label}</span>
        {source === 'link' && !ytId && (
          <a href={video.url} target="_blank" rel="noreferrer" style={{ fontFamily: jost, fontSize: 11, color: T.navy, wordBreak: 'break-all' }}>{video.url}</a>
        )}
        {(ytId || source === 'upload') && !playing && (
          <button onClick={() => setPlaying(true)} style={{
            marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, background: T.navy, color: 'white', border: 'none',
            padding: '5px 12px', borderRadius: 2, fontFamily: jost, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer',
          }}>
            <Play size={10} fill="white" /> Play
          </button>
        )}
      </div>
      {failed && <p style={{ fontFamily: jost, fontSize: 11, color: T.red, margin: '6px 0 0' }}>The partner's latest video upload failed.</p>}

      {playing && (
        <div style={{ marginTop: 10, aspectRatio: '16 / 9', background: '#000', maxWidth: compact ? '100%' : 560 }}>
          {ytId ? (
            <iframe title="Video" src={`https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0`} allowFullScreen
              allow="autoplay; encrypted-media; picture-in-picture" style={{ width: '100%', height: '100%', border: 'none' }} />
          ) : streamUrl ? (
            <video src={streamUrl} controls autoPlay playsInline style={{ width: '100%', height: '100%', background: '#000' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'rgba(255,255,255,0.7)', fontFamily: jost, fontSize: 11 }}>
              {error ? <><AlertCircle size={14} /> {error}</> : <><Loader2 size={14} className="animate-spin" /> Loading video…</>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ImageStrip = ({ main, extra = [], onZoom, size = 80, highlight = false }) => (
  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
    {[main, ...extra].filter(Boolean).map((src, i) => (
      <img key={`${src}-${i}`} src={src} alt="" onClick={() => onZoom(src)}
        style={{ width: size, height: size, objectFit: 'cover', borderRadius: 3, cursor: 'zoom-in', border: i === 0 ? `2px solid ${T.gold}` : `1px solid ${T.border}`, outline: highlight ? `2px solid ${T.amber}` : 'none', outlineOffset: 2 }} />
    ))}
  </div>
);

const videoSignature = (v) => (v?.source ? `${v.source}:${v.url || v.fileName || ''}` : '');

// One row of the live-vs-proposed comparison.
const CompareRow = ({ label, live, proposed, changed }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr', gap: 12, padding: '10px 12px', borderTop: `1px solid ${T.border}`, background: changed ? T.changed : 'transparent' }}>
    <span style={{ ...fieldLabel, paddingTop: 2 }}>
      {label}{changed && <span style={{ display: 'block', color: T.amber, fontSize: 8, marginTop: 3 }}>● Changed</span>}
    </span>
    <div style={{ fontFamily: jost, fontSize: 12, color: changed ? T.muted : T.text, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{live}</div>
    <div style={{ fontFamily: jost, fontSize: 12, color: T.text, fontWeight: changed ? 500 : 300, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{proposed}</div>
  </div>
);

/**
 * Full panel — list + review modal. Render conditionally when open.
 *
 * Props:
 *   meta        - { categories, subCategories } from ProductList
 *   onClose     - close the panel
 *   onApproved  - called after any approval so ProductList can refresh
 */
const PendingSupplierApprovals = ({ meta, onClose, onApproved }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [reviewing, setReviewing] = useState(null);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [reviewForm, setReviewForm] = useState({ category: '', subCategory: '', purchasePrice: '', markupPercent: 10 });
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const res = await api.get('/admin/supplier-products/pending');
      setRows(res.data);
    } catch (err) {
      setListError(err.response?.data?.message || 'Failed to load pending submissions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openReview = (row) => {
    setReviewing(row);
    setRejecting(false);
    setRejectReason('');
    setError('');
    if (row.kind === 'update') {
      setReviewForm({
        category: row.live?.category || '', subCategory: row.live?.subCategory || '',
        // The partner's proposed price becomes the new purchase price; markup stays as set.
        purchasePrice: row.proposed?.sellingPrice ? String(row.proposed.sellingPrice) : String(row.live?.purchasePrice || ''),
        markupPercent: 30, // default for change requests; adjust before approving if needed
      });
    } else {
      setReviewForm({
        category: '', subCategory: '', markupPercent: 10,
        // The partner's suggested price is the starting purchase price.
        purchasePrice: row.sellingPrice ? String(row.sellingPrice) : '',
      });
    }
  };

  const closeReview = () => setReviewing(null);
  const isUpdate = reviewing?.kind === 'update';

  const submitApprove = async () => {
    if (!isUpdate && !reviewForm.category.trim()) { setError('Category is required.'); return; }
    if (reviewForm.purchasePrice === '' || Number(reviewForm.purchasePrice) <= 0) {
      setError('A valid purchase price is required.'); return;
    }
    setSaving(true);
    setError('');
    try {
      if (isUpdate) {
        await api.put(`/admin/supplier-products/${reviewing._id}/approve-changes`, {
          purchasePrice: Number(reviewForm.purchasePrice),
          markupPercent: Number(reviewForm.markupPercent) || 10,
        });
      } else {
        await api.put(`/admin/supplier-products/${reviewing._id}/approve`, {
          category: reviewForm.category.trim(),
          subCategory: reviewForm.subCategory.trim(),
          purchasePrice: Number(reviewForm.purchasePrice),
          sellingPrice: Number(calculateSellingPrice(reviewForm.purchasePrice, reviewForm.markupPercent)),
          markupPercent: Number(reviewForm.markupPercent) || 10,
        });
      }
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
    if (!rejectReason.trim()) { setError('Please provide a reason.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.put(`/admin/supplier-products/${reviewing._id}/${isUpdate ? 'reject-changes' : 'reject'}`, { reason: rejectReason.trim() });
      setReviewing(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Rejection failed.');
    } finally {
      setSaving(false);
    }
  };

  const newCount = rows.filter(r => r.kind !== 'update').length;
  const updateCount = rows.length - newCount;

  // ── Comparison data for change requests ────────────────────────────────────
  const live = reviewing?.live || {};
  const proposed = reviewing?.proposed || {};
  const liveImages = [live.imageUrl, ...(live.additionalImages || [])].filter(Boolean);
  const proposedImages = [proposed.imageUrl, ...(proposed.additionalImages || [])].filter(Boolean);
  const imagesChanged = JSON.stringify(liveImages) !== JSON.stringify(proposedImages);
  const videoChanged = videoSignature(live.video) !== videoSignature(proposed.video) || proposed.video?.upload?.status === 'processing';

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
              Partner Portal · {newCount} new · {updateCount} change request{updateCount === 1 ? '' : 's'}
            </p>
            <h2 style={{ fontFamily: serif, fontSize: 26, fontWeight: 300, color: T.navy, margin: 0 }}>
              Pending <em style={{ color: T.gold }}>Approvals.</em>
            </h2>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={load} title="Refresh" style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted }}><RefreshCw size={16} /></button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted }}><X size={20} /></button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {loading ? (
            <p style={{ fontFamily: jost, color: T.muted, textAlign: 'center', padding: 40 }}>
              <Loader2 size={16} className="animate-spin" style={{ marginRight: 8, verticalAlign: 'middle' }} />
              Loading submissions…
            </p>
          ) : listError ? (
            <p style={{ fontFamily: jost, color: T.red, textAlign: 'center', padding: 40 }}>
              {listError} <button onClick={load} style={{ marginLeft: 8, background: 'none', border: `1px solid ${T.red}`, color: T.red, padding: '3px 10px', cursor: 'pointer' }}>Retry</button>
            </p>
          ) : rows.length === 0 ? (
            <p style={{ fontFamily: jost, color: T.muted, textAlign: 'center', padding: 40 }}>
              Nothing waiting for approval right now.
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
                  <img
                    src={row.imageUrl}
                    alt=""
                    onClick={e => { e.stopPropagation(); setLightboxImage(row.imageUrl); }}
                    style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 2, flexShrink: 0, cursor: 'zoom-in' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{
                        fontFamily: jost, fontSize: 8, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase',
                        padding: '2px 7px', borderRadius: 2,
                        background: row.kind === 'update' ? 'rgba(217,119,6,0.1)' : 'rgba(22,163,74,0.1)',
                        color: row.kind === 'update' ? T.amber : T.green,
                      }}>
                        {row.kind === 'update' ? 'Change to live product' : 'New product'}
                      </span>
                      <p style={{ fontFamily: jost, fontSize: 13, fontWeight: 500, color: T.text, margin: 0 }}>{row.name}</p>
                    </div>
                    <p style={{ fontFamily: jost, fontSize: 11, color: T.muted, margin: '3px 0 0' }}>
                      {row.brand} · {supplierName(row)}
                    </p>
                  </div>
                  {row.video?.source && (
                    <span title={row.video.source === 'upload' ? 'Uploaded video' : 'YouTube / video link'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: jost, fontSize: 10, color: T.muted }}>
                      {row.video.source === 'upload' ? <Video size={12} /> : <Play size={12} />} Video
                    </span>
                  )}
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
            background: 'white', width: '100%', maxWidth: isUpdate ? 900 : 720, maxHeight: '90vh', overflowY: 'auto',
            borderRadius: 4, padding: 32, boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <p style={{ fontFamily: jost, fontSize: 9, letterSpacing: '0.25em', textTransform: 'uppercase', color: isUpdate ? T.amber : T.green, margin: '0 0 6px' }}>
                  {isUpdate ? 'Change request · product is live' : 'New product submission'}
                </p>
                <h3 style={{ fontFamily: serif, fontSize: 22, fontWeight: 300, color: T.navy, margin: 0 }}>{reviewing.name}</h3>
                <p style={{ fontFamily: jost, fontSize: 11, color: T.muted, marginTop: 4 }}>
                  {reviewing.brand} · from {supplierName(reviewing)} ({reviewing.supplier?.email})
                  {reviewing.revisionSubmittedAt && ` · submitted ${new Date(reviewing.revisionSubmittedAt).toLocaleString()}`}
                </p>
              </div>
              <button onClick={closeReview} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted }}><X size={18} /></button>
            </div>

            {isUpdate ? (
              <>
                <p style={{ fontFamily: jost, fontSize: 12, color: T.text, background: T.changed, border: '1px solid rgba(217,119,6,0.25)', padding: '10px 12px', margin: '0 0 16px', display: 'flex', gap: 8 }}>
                  <Sparkles size={14} color={T.amber} style={{ flexShrink: 0, marginTop: 1 }} />
                  The live product and every client quote that contains it keep showing the current version until you approve these changes.
                </p>

                <div style={{ border: `1px solid ${T.border}`, borderRadius: 3, marginBottom: 20 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr', gap: 12, padding: '10px 12px', background: T.offwhite }}>
                    <span />
                    <span style={fieldLabel}>Currently live</span>
                    <span style={{ ...fieldLabel, color: T.navy }}>Proposed by partner</span>
                  </div>
                  <CompareRow label="Brand" live={live.brand} proposed={proposed.brand} changed={live.brand !== proposed.brand} />
                  <CompareRow label="Name" live={live.name} proposed={proposed.name} changed={live.name !== proposed.name} />
                  <CompareRow label="Description" live={live.description} proposed={proposed.description} changed={(live.description || '') !== (proposed.description || '')} />
                  <CompareRow
                    label="Partner price"
                    live={`₹${live.purchasePrice ?? '—'}`}
                    proposed={`₹${proposed.sellingPrice ?? '—'}`}
                    changed={Number(live.purchasePrice) !== Number(proposed.sellingPrice)}
                  />
                  <CompareRow
                    label="Images"
                    live={<ImageStrip main={live.imageUrl} extra={live.additionalImages} onZoom={setLightboxImage} size={56} />}
                    proposed={<ImageStrip main={proposed.imageUrl} extra={proposed.additionalImages} onZoom={setLightboxImage} size={56} highlight={imagesChanged} />}
                    changed={imagesChanged}
                  />
                  {/* Video — only the latest state is shown (no side-by-side of old uploads). */}
                  <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 12, padding: '10px 12px', borderTop: `1px solid ${T.border}`, background: videoChanged ? T.changed : 'transparent' }}>
                    <span style={{ ...fieldLabel, paddingTop: 2 }}>
                      Video{videoChanged && <span style={{ display: 'block', color: T.amber, fontSize: 8, marginTop: 3 }}>● Changed</span>}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <ReviewVideo rowId={reviewing._id} video={proposed.video} version="proposed" />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: 16 }}>
                  <ImageStrip main={reviewing.imageUrl} extra={reviewing.additionalImages} onZoom={setLightboxImage} size={90} />
                </div>
                <p style={{ fontFamily: jost, fontSize: 12, color: T.text, lineHeight: 1.7, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
                  {reviewing.description}
                </p>
                <div style={{ marginBottom: 20 }}>
                  <span style={fieldLabel}>Product video</span>
                  <ReviewVideo rowId={reviewing._id} video={reviewing.video} version="proposed" />
                </div>
              </>
            )}

            {error && (
              <p style={{ fontFamily: jost, fontSize: 12, color: T.red, marginBottom: 12 }}>{error}</p>
            )}

            {!rejecting ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  {!isUpdate && (
                    <>
                      <div>
                        <label style={fieldLabel}>Category *</label>
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
                        <label style={fieldLabel}>Sub-category</label>
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
                    </>
                  )}
                  <div>
                    <label style={fieldLabel}>Purchase Price (₹) *</label>
                    <input type="number" style={inputStyle()} value={reviewForm.purchasePrice}
                      onChange={e => setReviewForm(f => ({ ...f, purchasePrice: e.target.value }))} placeholder="0" />
                  </div>
                  <div>
                    <label style={fieldLabel}>Markup %</label>
                    <select style={inputStyle()} value={reviewForm.markupPercent}
                      onChange={e => setReviewForm(f => ({ ...f, markupPercent: e.target.value }))}>
                      {[...new Set([...MARKUP_OPTIONS, Number(reviewForm.markupPercent) || 10])].sort((a, b) => a - b)
                        .map(m => <option key={m} value={m}>{m}%</option>)}
                    </select>
                  </div>
                </div>

                {reviewForm.purchasePrice !== '' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.offwhite, padding: '10px 14px', marginBottom: 12, borderRadius: 3 }}>
                    <span style={fieldLabel}>
                      Final Selling Price{isUpdate && live.sellingPrice ? ` (now ₹${live.sellingPrice})` : ''}
                    </span>
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
                    <CheckCircle2 size={15} /> {saving ? 'Publishing…' : isUpdate ? 'Approve & Publish Changes' : 'Approve & Publish'}
                  </button>
                  <button onClick={() => setRejecting(true)} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'transparent', color: T.red, border: `1px solid ${T.red}`, padding: '12px 20px', borderRadius: 2,
                    fontFamily: jost, fontSize: 11, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer',
                  }}>
                    <XCircle size={15} /> {isUpdate ? 'Reject Changes' : 'Reject'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <label style={fieldLabel}>{isUpdate ? 'Why are these changes rejected? *' : 'Reason for rejection *'}</label>
                <textarea
                  rows={3}
                  style={{ ...inputStyle(), marginTop: 6, resize: 'none' }}
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder={isUpdate
                    ? 'The live product stays as it is. Tell the partner what to fix before resubmitting…'
                    : 'Let the partner know what needs fixing before resubmitting…'}
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

      {/* Full-res image lightbox */}
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
