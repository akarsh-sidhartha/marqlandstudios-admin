/**
 * src/components/ProductList.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Product catalogue — browse, filter, add, edit, delete.
 * Supports AI studio image processing, PDF import, multi-image gallery,
 * catalogue building, and portal integration.
 *
 * Design language mirrors ClientList.js (navy / gold / off-white, Jost +
 * Cormorant Garamond). All async operations are instrumented via logger.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api';
import { createLogger } from '../utils/logger';
import {
  Plus, Check, FolderPlus, X, Search, Trash2, Pencil,
  RotateCcw, Info, CheckSquare, Square, Sparkles, FileText, Download,
  ImageIcon, AlertCircle, CheckCircle2, Loader2, Star,
  ChevronLeft, ChevronRight, Play, ExternalLink,
} from 'lucide-react';
import usePortalItems from '../hooks/usePortalItems';
import ProductFormModal from './products/ProductFormModal';
import useCatalogue from './products/useCatalogue';
import {
  T, jost, serif, inputStyle, FieldLabel, PromptSelector, ProductVideo, hasProductVideo, SearchableSelect,
} from './products/productUi';
import v2 from '../lib/apiV2';
import { usePopup } from '../components/AppPopups';
import { API_ROOT } from '../api';
import PendingSupplierApprovals, { PendingApprovalsButton } from './PendingSupplierApprovals'; // NEW — Supplier Portal

// ─── Logger ──────────────────────────────────────────────────────────────────
const log = createLogger('ProductList');


// ─────────────────────────────────────────────────────────────────────────────
// Skeleton row — reusable loading placeholder (mirrors SkeletonList)
// ─────────────────────────────────────────────────────────────────────────────
const loadMoreBtn = {
  background: 'white', border: `1px solid ${T.borderG}`, color: T.gold, padding: '7px 18px', borderRadius: 2,
  fontFamily: jost, fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer',
};

const SkeletonCard = () => (
  <div style={{
    background: 'white',
    border: `1px solid ${T.border}`,
    borderRadius: 2,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  }}>
    {/* image area */}
    <div style={{
      height: 128,
      background: 'linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }} />
    {/* text lines */}
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[80, 55, 40].map(w => (
        <div key={w} style={{
          height: 8, width: `${w}%`,
          background: 'linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.4s infinite',
          borderRadius: 4,
        }} />
      ))}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Product card image with shimmer skeleton until loaded
// ─────────────────────────────────────────────────────────────────────────────
const ProductImage = ({ p, getAssetUrl, onPreview }) => {
  const [loaded, setLoaded]             = useState(false);
  const [index, setIndex]               = useState(0);
  const [hovered, setHovered]           = useState(false);
  const [playingVideo, setPlayingVideo] = useState(false);

  // Primary image + any additional angles saved via the Image Gallery
  const images      = [p.imageUrl, ...(p.additionalImages || [])].filter(Boolean);
  const hasMultiple = images.length > 1;
  const hasVideo    = hasProductVideo(p);
  const currentUrl  = images[index] || null;

  const goPrev = (e) => {
    e.stopPropagation();
    setPlayingVideo(false);
    setLoaded(images.length <= 1 ? loaded : false);
    setIndex(i => (i - 1 + images.length) % images.length);
  };
  const goNext = (e) => {
    e.stopPropagation();
    setPlayingVideo(false);
    setLoaded(images.length <= 1 ? loaded : false);
    setIndex(i => (i + 1) % images.length);
  };
  const openVideo  = (e) => { e.stopPropagation(); setPlayingVideo(true); };
  const closeVideo = (e) => { e.stopPropagation(); setPlayingVideo(false); };

  const navBtnStyle = (side) => ({
    position: 'absolute',
    top: '50%',
    [side]: 5,
    transform: 'translateY(-50%)',
    width: 22, height: 22,
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(255,255,255,0.6)',
    color: T.navy,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer',
    opacity: hovered ? 0.95 : 0.4,
    transition: 'opacity 0.2s, background 0.2s',
    zIndex: 15, padding: 0,
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  });

  return (
    <div
      onClick={playingVideo ? undefined : onPreview}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 128,
        background: T.offwhite,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
        cursor: playingVideo ? 'default' : 'zoom-in',
      }}
    >
      {playingVideo && hasVideo ? (
        // ── Inline video playback ──
        <ProductVideo p={p} fit="cover" />
      ) : (
        <>
          {/* Shimmer buffer shown until image resolves */}
          {!loaded && currentUrl && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.4s infinite',
            }} />
          )}

          {currentUrl ? (
            <img
              key={currentUrl}
              src={getAssetUrl(currentUrl)}
              alt={p.name}
              onLoad={() => setLoaded(true)}
              style={{
                width: '100%', height: '100%',
                objectFit: 'cover',
                transition: 'transform 0.3s ease, opacity 0.3s ease',
                opacity: loaded ? 1 : 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.07)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: T.border }}>
              <ImageIcon size={24} />
              <span style={{ fontFamily: jost, fontSize: 9, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: T.muted }}>
                No Image
              </span>
            </div>
          )}

          {/* Hover overlay */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0)',
            transition: 'background 0.2s',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.10)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0)'; }}
          >
            <Info size={20} style={{ color: 'white', opacity: 0 }} />
          </div>

          {/* Left / right carousel arrows — subtle, only when >1 image */}
          {hasMultiple && (
            <>
              <button
                onClick={goPrev}
                title="Previous image"
                aria-label="Previous image"
                style={navBtnStyle('left')}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.92)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.6)'; }}
              >
                <ChevronLeft size={13} />
              </button>
              <button
                onClick={goNext}
                title="Next image"
                aria-label="Next image"
                style={navBtnStyle('right')}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.92)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.6)'; }}
              >
                <ChevronRight size={13} />
              </button>

              {/* Subtle position counter */}
              <span style={{
                position: 'absolute', left: 6, bottom: 6, zIndex: 15,
                fontFamily: jost, fontSize: 8, fontWeight: 500,
                color: 'white', background: 'rgba(0,0,0,0.45)',
                padding: '1px 5px', borderRadius: 8,
                opacity: hovered ? 0.9 : 0.55,
                transition: 'opacity 0.2s',
              }}>
                {index + 1}/{images.length}
              </span>
            </>
          )}

          {/* Video play button — subtle, only when a video is attached */}
          {hasVideo && (
            <button
              onClick={openVideo}
              title="Play video"
              aria-label="Play video"
              style={{
                position: 'absolute', top: '50%', left: '50%', zIndex: 15,
                transform: 'translate(-50%, -50%)',
                width: 34, height: 34, borderRadius: '50%',
                border: 'none', background: 'rgba(14,21,32,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
                opacity: hovered ? 0.95 : 0.55,
                transition: 'opacity 0.2s, background 0.2s',
                padding: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(14,21,32,0.8)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(14,21,32,0.55)'; }}
            >
              <Play size={14} fill="white" style={{ color: 'white', marginLeft: 1 }} />
            </button>
          )}
        </>
      )}

      {/* Close control while video is playing */}
      {playingVideo && (
        <button
          onClick={closeVideo}
          title="Close video"
          aria-label="Close video"
          style={{
            position: 'absolute', top: 6, left: 6, zIndex: 20,
            width: 20, height: 20, borderRadius: '50%',
            border: 'none', background: 'rgba(0,0,0,0.55)',
            color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0,
          }}
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Preview modal media — same carousel + video-play behaviour as ProductImage,
// scaled up for the large fullscreen preview.
// ─────────────────────────────────────────────────────────────────────────────
const ProductPreviewMedia = ({ p, getAssetUrl }) => {
  const [index, setIndex]               = useState(0);
  const [playingVideo, setPlayingVideo] = useState(false);

  const images      = [p.imageUrl, ...(p.additionalImages || [])].filter(Boolean);
  const hasMultiple = images.length > 1;
  const hasVideo    = hasProductVideo(p);
  const currentUrl  = images[index] || null;

  const goPrev = (e) => { e.stopPropagation(); setPlayingVideo(false); setIndex(i => (i - 1 + images.length) % images.length); };
  const goNext = (e) => { e.stopPropagation(); setPlayingVideo(false); setIndex(i => (i + 1) % images.length); };
  const openVideo  = (e) => { e.stopPropagation(); setPlayingVideo(true); };
  const closeVideo = (e) => { e.stopPropagation(); setPlayingVideo(false); };

  const navBtnStyle = (side) => ({
    position: 'absolute', top: '50%', [side]: 14, transform: 'translateY(-50%)',
    width: 36, height: 36, borderRadius: '50%', border: 'none',
    background: 'rgba(255,255,255,0.7)', color: T.navy,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', zIndex: 15, padding: 0,
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
    opacity: 0.65, transition: 'opacity 0.2s, background 0.2s',
  });

  return (
    <>
      {playingVideo && hasVideo ? (
        <ProductVideo p={p} fit="contain" />
      ) : (
        <>
          {currentUrl
            ? <img
                key={currentUrl}
                src={getAssetUrl(currentUrl)}
                alt={p.name}
                style={{ width: '100%', height: '100%', objectFit: 'contain', maxHeight: '62vh' }}
                onError={e => { e.target.onerror = null; e.target.src = 'https://via.placeholder.com/600x600?text=No+Image'; }}
              />
            : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.border }}><ImageIcon size={64} /></div>
          }

          {/* Left / right carousel arrows — subtle, only when >1 image */}
          {hasMultiple && (
            <>
              <button
                onClick={goPrev}
                title="Previous image"
                aria-label="Previous image"
                style={navBtnStyle('left')}
                onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = 'rgba(255,255,255,0.95)'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = 0.65; e.currentTarget.style.background = 'rgba(255,255,255,0.7)'; }}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={goNext}
                title="Next image"
                aria-label="Next image"
                style={navBtnStyle('right')}
                onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = 'rgba(255,255,255,0.95)'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = 0.65; e.currentTarget.style.background = 'rgba(255,255,255,0.7)'; }}
              >
                <ChevronRight size={18} />
              </button>

              {/* Subtle position counter */}
              <span style={{
                position: 'absolute', left: 14, bottom: 14, zIndex: 15,
                fontFamily: jost, fontSize: 10, fontWeight: 500, color: 'white',
                background: 'rgba(0,0,0,0.5)', padding: '3px 9px', borderRadius: 10,
              }}>
                {index + 1} / {images.length}
              </span>
            </>
          )}

          {/* Video play button — subtle, only when a video is attached */}
          {hasVideo && (
            <button
              onClick={openVideo}
              title="Play video"
              aria-label="Play video"
              style={{
                position: 'absolute', top: '50%', left: '50%', zIndex: 15,
                transform: 'translate(-50%, -50%)',
                width: 56, height: 56, borderRadius: '50%',
                border: 'none', background: 'rgba(14,21,32,0.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', opacity: 0.8, transition: 'opacity 0.2s, background 0.2s',
                padding: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = 'rgba(14,21,32,0.85)'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = 0.8; e.currentTarget.style.background = 'rgba(14,21,32,0.6)'; }}
            >
              <Play size={22} fill="white" style={{ color: 'white', marginLeft: 2 }} />
            </button>
          )}
        </>
      )}

      {/* Close control while video is playing — top-left, so it never collides
          with the modal's own close (X) button at top-right */}
      {playingVideo && (
        <button
          onClick={closeVideo}
          title="Close video"
          aria-label="Close video"
          style={{
            position: 'absolute', top: 12, left: 12, zIndex: 20,
            width: 28, height: 28, borderRadius: '50%',
            border: 'none', background: 'rgba(0,0,0,0.55)', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0,
          }}
        >
          <X size={14} />
        </button>
      )}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Add to Existing Catalogue (selection bar → "Add to Existing")
// Pick a saved catalogue and append the selected products. Uses the light
// /catalogues/summary list and the server-side /catalogues/:id/items/add
// route, so it never downloads or re-sends every catalogue's items. Products
// already in a catalogue are skipped.
// ─────────────────────────────────────────────────────────────────────────────
/** Small uppercase label (eyebrow) style. */
const catEyebrow = (color = T.muted) => ({
  fontFamily: jost, fontSize: 9, fontWeight: 400,
  letterSpacing: '0.28em', textTransform: 'uppercase', color,
});

/** Gold primary button (matches "Add Product" / "Build New"). */
const catGoldButton = (disabled = false) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  background: disabled ? '#e5e0d6' : T.gold, color: disabled ? T.muted : T.navy,
  border: 'none', padding: '10px 20px', borderRadius: 2,
  fontFamily: jost, fontSize: 9, fontWeight: 500,
  letterSpacing: '0.2em', textTransform: 'uppercase',
  cursor: disabled ? 'not-allowed' : 'pointer', transition: 'background 0.2s',
});

/** Outlined secondary button. */
const catOutlineButton = (disabled = false) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  background: 'white', color: T.navy,
  border: `1px solid ${T.border}`, padding: '9px 18px', borderRadius: 2,
  fontFamily: jost, fontSize: 9, fontWeight: 400,
  letterSpacing: '0.2em', textTransform: 'uppercase',
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  transition: 'border-color 0.2s, color 0.2s',
});

const AddToCatalogueModal = ({ items, onClose, onAdded }) => {
  const [catalogues, setCatalogues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [addingId, setAddingId] = useState(null);
  const [result, setResult] = useState(null);   // { catalogue, added, skipped }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/catalogues/summary');
      setCatalogues(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError('Could not load saved catalogues.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return catalogues;
    return catalogues.filter(c =>
      c.name?.toLowerCase().includes(term) || c.subtitle?.toLowerCase().includes(term));
  }, [catalogues, search]);

  const selectedIds = useMemo(() => items.map(p => String(p._id)), [items]);

  const addTo = async (cat) => {
    if (addingId) return;
    setAddingId(cat._id);
    setError(null);
    try {
      const payload = items.map(p => ({
        _id: p._id, name: p.name, description: p.description || '',
        price: p.price ?? 0, imageUrl: p.imageUrl || '',
      }));
      const { data } = await api.post(`/catalogues/${cat._id}/items/add`, { items: payload });
      setResult({ catalogue: cat, added: data.added, skipped: data.skipped });
      if (data.added > 0) onAdded?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not add products. Please try again.');
    } finally {
      setAddingId(null);
    }
  };

  const openBuilder = (id) => window.open(`/builder?id=${id}`, '_blank');

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(14,21,32,0.75)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, zIndex: 200,
      }}
    >
      <div
        className="animate-modal-up"
        onClick={e => e.stopPropagation()}
        style={{ background: 'white', border: `1px solid ${T.border}`, width: '100%', maxWidth: 460 }}
      >
        {/* Header */}
        <div style={{
          padding: '24px 28px', borderBottom: `1px solid ${T.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <p style={{ ...catEyebrow(), margin: '0 0 4px' }}>
              {items.length} selected {items.length === 1 ? 'product' : 'products'}
            </p>
            <h2 style={{ fontFamily: serif, fontSize: 26, fontWeight: 300, color: T.navy, margin: 0 }}>
              Add to <em style={{ color: T.gold }}>Catalogue.</em>
            </h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, fontSize: 18, padding: 4 }}>✕</button>
        </div>

        {result ? (
          /* ── Success ─────────────────────────────────────────────────────── */
          <div style={{ padding: '36px 28px 28px', textAlign: 'center' }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', margin: '0 auto 16px',
              border: `1px solid ${T.borderG}`, background: T.dimBg, color: T.gold,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Check size={22} />
            </div>
            <h3 style={{ fontFamily: serif, fontSize: 24, fontWeight: 400, color: T.navy, margin: 0 }}>
              {result.catalogue.name}
            </h3>
            <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted, margin: '8px 0 0' }}>
              {result.added > 0 ? `${result.added} added` : 'Nothing new added'}
              {result.skipped > 0 && ` · ${result.skipped} already in this catalogue`}
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
              <button onClick={onClose} style={{ ...catOutlineButton(), flex: 1 }}>Done</button>
              <button
                onClick={() => { openBuilder(result.catalogue._id); onClose(); }}
                style={{ ...catGoldButton(), flex: 1 }}
                onMouseEnter={e => { e.currentTarget.style.background = T.gold2; }}
                onMouseLeave={e => { e.currentTarget.style.background = T.gold; }}
              >
                Open &amp; Download <ExternalLink size={12} />
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Search */}
            <div style={{ padding: '16px 24px 8px' }}>
              <div style={{ position: 'relative' }}>
                <Search size={13} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.muted, pointerEvents: 'none' }} />
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search catalogues…"
                  style={inputStyle(false, { fontSize: 12, paddingLeft: 34 })}
                  onFocus={e => { e.currentTarget.style.borderColor = T.gold; }}
                  onBlur={e => { e.currentTarget.style.borderColor = T.border; }}
                />
              </div>
              {error && (
                <p style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '10px 0 0', fontFamily: jost, fontSize: 11, color: T.red }}>
                  <AlertCircle size={12} /> {error}
                  {!catalogues.length && (
                    <button onClick={load} style={{ background: 'none', border: 'none', color: T.red, textDecoration: 'underline', cursor: 'pointer', fontFamily: jost, fontSize: 11 }}>Retry</button>
                  )}
                </p>
              )}
            </div>

            {/* List */}
            <div style={{ maxHeight: 360, overflowY: 'auto', padding: '4px 0 8px' }}>
              {loading ? (
                <div style={{ padding: '40px 0', display: 'flex', justifyContent: 'center' }}>
                  <Loader2 size={22} className="animate-spin" style={{ color: T.gold }} />
                </div>
              ) : !filtered.length ? (
                <div style={{ padding: '40px 24px', textAlign: 'center' }}>
                  <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted, margin: 0 }}>
                    {search ? 'No matching catalogues.' : 'No saved catalogues yet — use Build New to create one.'}
                  </p>
                </div>
              ) : filtered.map(cat => {
                const inCat = new Set((cat.itemIds || []).map(String));
                const already = selectedIds.filter(id => inCat.has(id)).length;
                const toAdd = items.length - already;
                const busy = addingId === cat._id;
                const disabled = Boolean(addingId) || toAdd === 0;
                return (
                  <div
                    key={cat._id}
                    style={{
                      padding: '14px 24px', borderBottom: `1px solid ${T.border}`,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = T.dimBg; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontFamily: jost, fontSize: 13, fontWeight: 500, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {cat.name}
                      </span>
                      {cat.subtitle && (
                        <span style={{ display: 'block', fontFamily: serif, fontStyle: 'italic', fontSize: 13, color: T.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {cat.subtitle}
                        </span>
                      )}
                      <span style={{ display: 'block', fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted, marginTop: 2 }}>
                        {cat.itemCount || 0} items
                        {already > 0 && <span style={{ color: T.amber }}> · {already} already added</span>}
                      </span>
                    </div>
                    <button
                      disabled={disabled}
                      onClick={() => addTo(cat)}
                      style={{ ...catGoldButton(disabled && !busy), flexShrink: 0, padding: '8px 14px' }}
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : toAdd === 0 ? <Check size={12} /> : <Plus size={12} />}
                      {toAdd === 0 ? 'All added' : `Add ${toAdd}`}
                    </button>
                  </div>
                );
              })}
            </div>

            <div style={{ padding: '16px 24px', borderTop: `1px solid ${T.border}`, textAlign: 'right' }}>
              <button
                onClick={onClose}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: jost, fontSize: 10, fontWeight: 400,
                  letterSpacing: '0.2em', textTransform: 'uppercase', color: T.muted,
                }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const ProductList = () => {

  // ── Data (loaded per category — see products/useCatalogue.js) ──────────────
  // All categories start collapsed; a category's products are fetched the
  // first time it is expanded.
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const isCollapsed = (cat) => collapsedCategories[cat] !== false;

  // Per-category sort: { [cat]: 'asc' | 'desc' | 'price-asc' | 'price-desc' | '' }
  const [categorySort, setCategorySort] = useState({});
  // Per-category price range: { [cat]: { min: '', max: '' } }
  const [categoryPriceFilter, setCategoryPriceFilter] = useState({});
  const [selectedProducts, setSelectedProducts]     = useState([]);
  const [previewProduct, setPreviewProduct]         = useState(null);

  // ── Filters ─────────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState({
    brand: '', category: '', subCategory: '', minPrice: '', maxPrice: '', searchTerm: '', source: '',
  });

  const {
    summary, summaryLoading, summaryError, meta, buckets, loadCategory, filterMode,
    search, loadMoreSearch, refresh, patchProduct, removeProduct, reloadSummary,
  } = useCatalogue({ filters, categorySort, categoryPriceFilter });
  const isLoading = summaryLoading;

  // ── Add / Edit Product modal (images + video live inside it) ────────────────
  // null = closed · { id: null } = add · { id } = edit
  const [productModal, setProductModal] = useState(null);
  const [savedPrompts, setSavedPrompts] = useState([]);

  // ── Studio Prompts Manager ───────────────────────────────────────────────────
  const [showPromptManager, setShowPromptManager] = useState(false);
  const [promptForm, setPromptForm]   = useState({ name: '', category: '', prompt: '', isDefault: false });
  const [editingPromptId, setEditingPromptId]   = useState(null);
  const [promptSaving, setPromptSaving]         = useState(false);

  // ── Catalogue modal ──────────────────────────────────────────────────────────
  const [catalogueModalItems, setCatalogueModalItems] = useState(null); // "Add to Existing" snapshot

  // ── PDF Import modal ─────────────────────────────────────────────────────────
  const [showPdfModal, setShowPdfModal]       = useState(false);
  const [pdfFile, setPdfFile]                 = useState(null);
  const [pdfCategory, setPdfCategory]         = useState('');
  const [pdfBrand, setPdfBrand]               = useState('');
  const [pdfLoading, setPdfLoading]           = useState(false);
  const [pdfResult, setPdfResult]             = useState(null);
  const [pdfPromptId, setPdfPromptId]         = useState('');
  const [pdfCustomPrompt, setPdfCustomPrompt] = useState('');
  const [pdfProgress, setPdfProgress]         = useState(null);

  // ── PDF Extract modal (no AI) ────────────────────────────────────────────────
  const [showExtractModal, setShowExtractModal] = useState(false);
  const [extractFile, setExtractFile]           = useState(null);
  const [extractLoading, setExtractLoading]     = useState(false);

  // ── Pending Supplier Approvals panel (NEW) ───────────────────────────────────
  const [showPendingApprovals, setShowPendingApprovals] = useState(false);

  // ── Client visit mode (hides cost, markup and partner names from view) ───────
  // Persisted in localStorage so the setting survives navigation away and back.
  const [clientMode, setClientMode] = useState(
    () => localStorage.getItem('productList_clientMode') === 'true'
  );
  const toggleClientMode = () =>
    setClientMode(prev => {
      const next = !prev;
      localStorage.setItem('productList_clientMode', String(next));
      return next;
    });

  // ── Popups (toast + confirm from AppPopups) ──────────────────────────────────
  const { showToast, confirm, Toast, ConfirmDialog } = usePopup();

  // ── Portal ───────────────────────────────────────────────────────────────────
  const { addToPortal, PortalModal } = usePortalItems('product');

  const getAssetUrl = (p) => {
    if (!p) return '';
    if (p.startsWith('http')) return p;   // R2 / OneDrive — already absolute
    return `${API_ROOT}${p}`;             // legacy local /uploads/ path
  };

  // ─── Data fetching ──────────────────────────────────────────────────────────
  const fetchPrompts = useCallback(async () => {
    log.debug('Fetching studio prompts…');
    try {
      const res = await api.get('/image-processing/prompts');
      setSavedPrompts(res.data);
      log.debug('Prompts loaded', { count: res.data.length });
    } catch (err) {
      log.warn('Could not load studio prompts', err.message);
    }
  }, []);

  useEffect(() => { fetchPrompts(); }, [fetchPrompts]);

  // Selecting a category in the filter bar opens it straight away.
  useEffect(() => {
    if (!filters.category) return;
    setCollapsedCategories(prev => ({ ...prev, [filters.category]: false }));
    if (!buckets[filters.category]?.page) loadCategory(filters.category);
  }, [filters.category]);

  // ─── Reset helpers ──────────────────────────────────────────────────────────
  const resetFilters = () =>
    setFilters({ brand: '', category: '', subCategory: '', minPrice: '', maxPrice: '', searchTerm: '', source: '' });

  const resetPromptManager = () => {
    setEditingPromptId(null);
    setPromptForm({ name: '', category: '', prompt: '', isDefault: false });
  };

  // ─── Product modal callbacks ──────────────────────────────────────────────────
  const handleProductSaved = (saved, { previous } = {}) => {
    refresh([saved.category, previous?.category]);
    setSelectedProducts(prev => prev.map(sp => (sp._id === saved._id ? productToSelection(saved) : sp)));
  };

  // A background job (video → OneDrive, Studio AI) finished — refresh that card.
  const handleMediaProcessed = async (id) => {
    try {
      const { data } = await v2.get(`/v2/products/${id}`);
      patchProduct(data);
    } catch (err) {
      log.warn('Could not refresh product after background job', err.message);
    }
  };

  // ─── Delete product ──────────────────────────────────────────────────────────
  // NEW — deletion now requires a reason, since it may cascade a notification
  // back to the partner who originally submitted this product.
  const [deletingProduct, setDeletingProduct] = useState(null); // { id, name } | null
  const [deleteReason, setDeleteReason] = useState('');
  const [deletingInProgress, setDeletingInProgress] = useState(false);

  // Partner products need a reason (it's shown to the partner in their
  // portal). Marqland's own products just get a simple confirmation.
  const handleDelete = async (p) => {
    if (p.fromPartner) {
      setDeletingProduct({ id: p._id, name: p.name });
      setDeleteReason('');
      return;
    }
    const ok = await confirm({
      title: `Delete "${p.name}"?`,
      message: 'This permanently removes the product from the catalogue.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (ok) deleteProductById(p._id, p.name);
  };

  const deleteProductById = async (id, productName, reason = '') => {
    setDeletingInProgress(true);
    log.info('Deleting product', { id, name: productName, reason });
    try {
      await v2.delete(`/v2/products/${id}`, { data: reason ? { reason } : {} });
      setSelectedProducts(prev => prev.filter(p => p._id !== id));
      removeProduct(id);
      showToast('success', `"${productName}" deleted`);
      setDeletingProduct(null);
    } catch (err) {
      log.error('Delete product failed', err.message);
      showToast('error', err.message || 'Failed to delete product');
    } finally {
      setDeletingInProgress(false);
    }
  };

  const confirmDeleteWithReason = async () => {
    if (!deleteReason.trim()) {
      showToast('warning', 'Please enter a reason for deleting this product.');
      return;
    }
    await deleteProductById(deletingProduct.id, deletingProduct.name, deleteReason.trim());
  };

  // ─── Pricing helper ──────────────────────────────────────────────────────────
  const calculateSellingPrice = (buy, mark) => {
    const price  = parseFloat(buy  || 0);
    const markup = parseFloat(mark || 0);
    return (price + (price * markup / 100)).toFixed(0);
  };

  // ─── Selection helpers ───────────────────────────────────────────────────────
  const productToSelection = (p) => ({
    _id:         p._id,
    name:        p.name,
    imageUrl:    p.imageUrl,
    description: p.description,
    category:    p.category    || '',
    subCategory: p.subCategory || '',
    price:       calculateSellingPrice(p.purchasePrice, p.markupPercent),
  });

  const toggleProductSelection = (product) => {
    const isSelected = selectedProducts.some(p => p._id === product._id);
    if (isSelected) {
      setSelectedProducts(prev => prev.filter(p => p._id !== product._id));
    } else {
      setSelectedProducts(prev => [...prev, productToSelection(product)]);
    }
  };

  const selectAllInCategory = (catProducts) => {
    const allSelected = catProducts.every(p => selectedProducts.some(sp => sp._id === p._id));
    if (allSelected) {
      const ids = new Set(catProducts.map(p => p._id));
      setSelectedProducts(prev => prev.filter(sp => !ids.has(sp._id)));
    } else {
      setSelectedProducts(prev => {
        const existing = new Set(prev.map(p => p._id));
        const toAdd = catProducts.filter(p => !existing.has(p._id)).map(productToSelection);
        return [...prev, ...toAdd];
      });
    }
  };

  // ─── Catalogue helpers ───────────────────────────────────────────────────────
  // "Build New": hand the selection to the Catalogue Builder in a new tab
  // (it reads and removes 'catalogue_selection' on load).
  const handleOpenBuilder = () => {
    log.debug('Opening catalogue builder', { itemCount: selectedProducts.length });
    const data = selectedProducts.map(p => ({
      _id: p._id, name: p.name, imageUrl: p.imageUrl,
      description: p.description, price: p.price,
    }));
    try {
      localStorage.setItem('catalogue_selection', JSON.stringify(data));
    } catch (err) {
      log.warn('Could not store catalogue selection', err.message);
      return showToast('error', 'Could not pass the selection to the builder. Try fewer products.');
    }
    const tab = window.open('/builder', '_blank');
    if (!tab) {
      localStorage.removeItem('catalogue_selection');
      showToast('error', 'Please allow pop-ups for this site to open the builder.');
    }
  };

  // "Add to Existing": AddToCatalogueModal appends on the server and skips
  // products already in the chosen catalogue.
  const openAddToExistingModal = () => setCatalogueModalItems(selectedProducts);

  // ─── Prompt management ───────────────────────────────────────────────────────
  const savePrompt = async () => {
    if (!promptForm.name || !promptForm.category || !promptForm.prompt) {
      return alert('Name, category and prompt are all required');
    }
    log.info(editingPromptId ? 'Updating prompt' : 'Creating prompt', { name: promptForm.name });
    setPromptSaving(true);
    try {
      if (editingPromptId) {
        await api.put(`/image-processing/prompts/${editingPromptId}`, promptForm);
      } else {
        await api.post('/image-processing/prompts', promptForm);
      }
      await fetchPrompts();
      resetPromptManager();
    } catch (err) {
      log.error('Failed to save prompt', err.message);
      alert('Failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setPromptSaving(false);
    }
  };

  const deletePrompt = async (id) => {
    if (!window.confirm('Delete this prompt?')) return;
    log.info('Deleting prompt', { id });
    try {
      await api.delete(`/image-processing/prompts/${id}`);
      await fetchPrompts();
    } catch (err) {
      log.error('Failed to delete prompt', err.message);
      alert('Delete failed: ' + err.message);
    }
  };

  const setDefaultPrompt = async (id) => {
    log.debug('Setting default prompt', { id });
    try {
      await api.patch(`/image-processing/prompts/${id}/default`);
      await fetchPrompts();
    } catch (err) {
      log.error('Failed to set default prompt', err.message);
      alert('Failed: ' + err.message);
    }
  };

  // ─── PDF import (AI processing) ──────────────────────────────────────────────
  const handlePdfImport = async () => {
    if (!pdfFile) return alert('Please select a PDF file');
    if (!pdfCategory || !pdfBrand) return alert('Category and brand are required');
    log.info('Starting PDF import', { category: pdfCategory, brand: pdfBrand });
    setPdfLoading(true);
    setPdfResult(null);
    setPdfProgress(null);
    try {
      const fd = new FormData();
      fd.append('pdf',      pdfFile);
      fd.append('category', pdfCategory);
      fd.append('brand',    pdfBrand);
      if (pdfPromptId)     fd.append('promptId',   pdfPromptId);
      if (pdfCustomPrompt) fd.append('promptText', pdfCustomPrompt);
      const res = await api.post('/image-processing/pdf/same-category', fd, { timeout: 600_000 }); // 10 min — AI processing each image
      const count = res.data.productIds?.length || 0;
      setPdfResult({ count });
      log.info('PDF import complete', { count });
      refresh([pdfCategory]);
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      log.error('PDF import failed', msg);
      alert('PDF import failed: ' + msg);
    } finally {
      setPdfLoading(false);
      setPdfProgress(null);
    }
  };

  // ─── PDF extract raw images (no AI) ─────────────────────────────────────────
  const handleExtractImages = async () => {
    if (!extractFile) return alert('Please select a PDF file');
    log.info('Extracting images from PDF', { filename: extractFile.name });
    setExtractLoading(true);
    try {
      const fd = new FormData();
      fd.append('pdf', extractFile);
      const res = await api.post('/image-processing/pdf/extract', fd, { responseType: 'arraybuffer', timeout: 600_000 }); // 10 min — large PDFs need time

      const contentType = res.headers['content-type'] || '';
      if (!contentType.includes('application/zip')) {
        let msg = 'Extraction failed — server did not return a ZIP file';
        try { msg = JSON.parse(new TextDecoder().decode(res.data)).message || msg; } catch {}
        throw new Error(msg);
      }

      const blob = new Blob([res.data], { type: 'application/zip' });
      const url  = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href  = url;
      link.download = `pdf-images-${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => window.URL.revokeObjectURL(url), 10_000);

      log.info('PDF image extraction complete');
      setShowExtractModal(false);
      setExtractFile(null);
    } catch (err) {
      let msg = err.message;
      if (err.response?.data instanceof ArrayBuffer) {
        try { msg = JSON.parse(new TextDecoder().decode(err.response.data)).message || msg; } catch {}
      }
      log.error('PDF extraction failed', msg);
      alert('Extraction failed: ' + msg);
    } finally {
      setExtractLoading(false);
    }
  };

  // ─── Grouping ────────────────────────────────────────────────────────────────
  // Filter mode: one server-side search, grouped by category for display.
  // Browse mode: categories come from the summary; each one's products are
  // fetched (and sorted/price-filtered by the server) when it's expanded.
  const searchGroups = React.useMemo(() => {
    if (!filterMode) return {};
    return search.items.reduce((acc, p) => {
      const cat = p.category || 'Uncategorized';
      (acc[cat] = acc[cat] || []).push(p);
      return acc;
    }, {});
  }, [filterMode, search.items]);

  const categoryRows = filterMode
    ? Object.keys(searchGroups).sort().map(category => ({ category, count: searchGroups[category].length }))
    : summary.categories
        .filter(c => !filters.category || c.category === filters.category)
        .map(c => ({ category: c.category, count: c.count }));

  const productsFor = (category) => (filterMode ? searchGroups[category] || [] : buckets[category]?.items || []);
  const loadedCount = filterMode ? search.items.length : Object.values(buckets).reduce((n, b) => n + b.items.length, 0);

  const setCatSort = (cat, val) => setCategorySort(prev => ({ ...prev, [cat]: val }));
  const setCatPrice = (cat, key, val) =>
    setCategoryPriceFilter(prev => ({ ...prev, [cat]: { ...(prev[cat] || {}), [key]: val } }));
  const resetCatFilters = (cat) => {
    setCategorySort(prev => ({ ...prev, [cat]: '' }));
    setCategoryPriceFilter(prev => ({ ...prev, [cat]: { min: '', max: '' } }));
  };

  const toggleCategory = (cat) => {
    if (filterMode) {
      setCollapsedCategories(prev => ({ ...prev, [cat]: prev[cat] !== true }));
      return;
    }
    const opening = isCollapsed(cat);
    setCollapsedCategories(prev => ({ ...prev, [cat]: !opening }));
    if (opening && !filterMode && !buckets[cat]?.page) loadCategory(cat);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: T.offwhite, fontFamily: jost, padding: '56px 48px' }}>

      <Toast />
      <ConfirmDialog />

      {/* ── Shimmer keyframe ──────────────────────────────────────────────────── */}
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes modal-up {
          0%   { transform: translateY(16px); opacity: 0; }
          100% { transform: translateY(0);    opacity: 1; }
        }
        .animate-modal-up { animation: modal-up 0.28s cubic-bezier(0.16,1,0.3,1) forwards; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .no-spinner::-webkit-outer-spin-button,
        .no-spinner::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .no-spinner { -moz-appearance: textfield; }
      `}</style>

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ width: 32, height: 1, background: T.gold, marginBottom: 20 }} />
        <p style={{
          fontSize: 9, fontWeight: 400, letterSpacing: '0.3em',
          textTransform: 'uppercase', color: T.muted, marginBottom: 10,
        }}>
          Inventory
        </p>
        <h1 style={{
          fontFamily: serif, fontSize: 40, fontWeight: 300,
          color: T.navy, lineHeight: 1.05, margin: '0 0 28px',
        }}>
          Product <em style={{ color: T.gold }}>Catalogue.</em>
        </h1>

        {/* Controls row */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>

          {/* Search */}
          <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 380 }}>
            <Search size={13} style={{
              position: 'absolute', left: 12, top: '50%',
              transform: 'translateY(-50%)', color: T.muted, pointerEvents: 'none',
            }} />
            <input
              type="text"
              placeholder="Search by name, brand or category…"
              value={filters.searchTerm}
              onChange={e => setFilters(f => ({ ...f, searchTerm: e.target.value }))}
              style={{ ...inputStyle(), paddingLeft: 34, paddingRight: filters.searchTerm ? 30 : 12 }}
            />
            {filters.searchTerm && (
              <button
                onClick={() => setFilters(f => ({ ...f, searchTerm: '' }))}
                style={{
                  position: 'absolute', right: 10, top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: T.muted, display: 'flex', padding: 0,
                }}
              >✕</button>
            )}
          </div>

          {/* Filter dropdowns — each one has its own search box */}
          <SearchableSelect
            value={filters.brand}
            onChange={val => setFilters(f => ({ ...f, brand: val }))}
            options={meta.brands.map(b => ({ value: b, label: b }))}
            emptyLabel="All Brands"
            searchPlaceholder="Search brands…"
          />
          <SearchableSelect
            value={filters.category}
            onChange={val => setFilters(f => ({ ...f, category: val, subCategory: '' }))}
            options={summary.categories.map(c => ({ value: c.category, label: c.category, count: c.count }))}
            emptyLabel="All Categories"
            searchPlaceholder="Search categories…"
          />
          <SearchableSelect
            value={filters.subCategory}
            disabled={!filters.category}
            onChange={val => setFilters(f => ({ ...f, subCategory: val }))}
            options={(summary.categories.find(c => c.category === filters.category)?.subCategories || [])
              .map(sc => ({ value: sc.name, label: sc.name, count: sc.count }))}
            emptyLabel="All Sub Cats"
            searchPlaceholder="Search sub-categories…"
            title={filters.category ? undefined : 'Pick a category first'}
          />
          {/* NEW — who added the product */}
          <SearchableSelect
            value={filters.source}
            onChange={val => setFilters(f => ({ ...f, source: val }))}
            options={[
              { value: 'partner', label: 'Added by Partners' },
              { value: 'marqland', label: 'Added by Marqland' },
            ]}
            emptyLabel="All Sources"
            searchPlaceholder="Search…"
            minWidth={150}
          />

          {/* Price range */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'white', border: `1px solid ${T.border}`,
            borderRadius: 3, padding: '8px 12px',
          }}>
            <span style={{ fontFamily: jost, fontSize: 10, fontWeight: 400, color: T.muted }}>₹</span>
            {['minPrice', 'maxPrice'].map((key, idx) => (
              <React.Fragment key={key}>
                {idx > 0 && <span style={{ color: T.border }}>–</span>}
                <input
                  type="number"
                  placeholder={idx === 0 ? 'Min' : 'Max'}
                  value={filters[key]}
                  onChange={e => setFilters(f => ({ ...f, [key]: e.target.value }))}
                  style={{
                    width: 52, background: 'transparent', border: 'none',
                    fontFamily: jost, fontSize: 11, fontWeight: 300,
                    color: T.text, outline: 'none',
                  }}
                />
              </React.Fragment>
            ))}
          </div>

          {/* Reset filters */}
          <button
            onClick={resetFilters}
            title="Reset Filters"
            style={{
              background: 'none', border: `1px solid ${T.border}`, borderRadius: 3,
              padding: '9px 10px', cursor: 'pointer', color: T.muted,
              display: 'flex', alignItems: 'center', transition: 'color 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = T.gold; e.currentTarget.style.borderColor = T.borderG; }}
            onMouseLeave={e => { e.currentTarget.style.color = T.muted; e.currentTarget.style.borderColor = T.border; }}
          >
            <RotateCcw size={13} />
          </button>

          {/* Action buttons (right-aligned) */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Add Product */}
            <button
              onClick={() => setProductModal({ id: null })}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                background: T.gold, color: T.navy,
                border: 'none', padding: '10px 22px', borderRadius: 2,
                fontFamily: jost, fontSize: 10, fontWeight: 500,
                letterSpacing: '0.22em', textTransform: 'uppercase',
                cursor: 'pointer', transition: 'background 0.25s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = T.gold2; }}
              onMouseLeave={e => { e.currentTarget.style.background = T.gold; }}
            >
              <Plus size={13} /> Add Product
            </button>

            {/* Extract PDF Images */}
            <button
              onClick={() => { setExtractFile(null); setShowExtractModal(true); }}
              title="Extract Images from PDF"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'transparent', border: `1px solid ${T.border}`,
                padding: '9px 16px', borderRadius: 2,
                fontFamily: jost, fontSize: 10, fontWeight: 400,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                color: T.muted, cursor: 'pointer', transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = T.amber;
                e.currentTarget.style.color = T.amber;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = T.border;
                e.currentTarget.style.color = T.muted;
              }}
            >
              <Download size={13} /> Extract PDF
            </button>

            {/* Import from PDF (AI) */}
            <button
              onClick={() => { setPdfFile(null); setPdfResult(null); setPdfProgress(null); setShowPdfModal(true); }}
              title="Import from PDF (AI Studio)"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'transparent', border: `1px solid ${T.border}`,
                padding: '9px 16px', borderRadius: 2,
                fontFamily: jost, fontSize: 10, fontWeight: 400,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                color: T.muted, cursor: 'pointer', transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = T.purple;
                e.currentTarget.style.color = T.purple;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = T.border;
                e.currentTarget.style.color = T.muted;
              }}
            >
              <FileText size={13} /> Import PDF
            </button>

            {/* Pending Supplier Approvals (NEW) */}
            <PendingApprovalsButton onClick={() => setShowPendingApprovals(true)} />

            {/* Studio Prompts Manager */}
            <button
              onClick={() => { resetPromptManager(); setShowPromptManager(true); }}
              title="Manage Studio Prompts"
              style={{
                display: 'inline-flex', alignItems: 'center',
                background: 'transparent', border: `1px solid ${T.border}`,
                padding: '9px 10px', borderRadius: 2,
                color: T.muted, cursor: 'pointer', transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = T.purple;
                e.currentTarget.style.color = T.purple;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = T.border;
                e.currentTarget.style.color = T.muted;
              }}
            >
              <Sparkles size={14} />
            </button>

            {/* Client Mode toggle — hides cost, markup and partner names during client visits */}
            <button
              onClick={toggleClientMode}
              title={clientMode ? 'Client Mode ON — click to show cost, markup & partner names' : 'Client Mode OFF — click to hide cost, markup & partner names'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: clientMode ? T.navy : 'transparent',
                border: `1px solid ${clientMode ? T.navy : T.border}`,
                padding: '9px 14px', borderRadius: 2,
                fontFamily: jost, fontSize: 10, fontWeight: 400,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                color: clientMode ? T.offwhite : T.muted,
                cursor: 'pointer', transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                if (!clientMode) {
                  e.currentTarget.style.borderColor = T.navy;
                  e.currentTarget.style.color = T.navy;
                }
              }}
              onMouseLeave={e => {
                if (!clientMode) {
                  e.currentTarget.style.borderColor = T.border;
                  e.currentTarget.style.color = T.muted;
                }
              }}
            >
              {clientMode ? <CheckSquare size={13} /> : <Square size={13} />}
              Client Mode
            </button>
          </div>
        </div>
      </div>

      {/* ── Product grid ─────────────────────────────────────────────────────── */}
      <div>
        {summaryError && !isLoading && (
          <div style={{ padding: '14px 18px', marginBottom: 24, border: '1px solid #fecaca', background: '#fef2f2', display: 'flex', alignItems: 'center', gap: 10, fontFamily: jost, fontSize: 12, color: T.red }}>
            <AlertCircle size={14} /> {summaryError}
            <button onClick={reloadSummary} style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${T.red}`, color: T.red, padding: '4px 12px', cursor: 'pointer', fontFamily: jost, fontSize: 10 }}>Retry</button>
          </div>
        )}
        {filterMode && search.error && (
          <div style={{ padding: '14px 18px', marginBottom: 24, border: '1px solid #fecaca', background: '#fef2f2', fontFamily: jost, fontSize: 12, color: T.red }}>{search.error}</div>
        )}
        {(isLoading || (filterMode && search.loading && search.page === 0)) ? (
          // ── Loading skeleton buffer ────────────────────────────────────────
          <div>
            {[1, 2].map(groupIdx => (
              <div key={groupIdx} style={{ marginBottom: 40 }}>
                {/* Category header skeleton */}
                <div style={{
                  height: 12, width: 140,
                  background: 'linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.4s infinite',
                  borderRadius: 4, marginBottom: 16,
                }} />
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: 16,
                }}>
                  {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
                </div>
              </div>
            ))}
          </div>
        ) : categoryRows.length === 0 ? (
          <div style={{ padding: '80px 0', textAlign: 'center' }}>
            <ImageIcon size={32} style={{ color: 'rgba(0,0,0,0.10)', margin: '0 auto 12px', display: 'block' }} />
            <p style={{
              fontFamily: jost, fontSize: 12, fontWeight: 300,
              letterSpacing: '0.12em', color: T.muted,
            }}>
              No products found
            </p>
          </div>
        ) : (
          categoryRows.map(({ category, count }) => {
            const collapsed = filterMode ? collapsedCategories[category] === true : isCollapsed(category);
            const catProducts = productsFor(category);
            const bucket = filterMode ? null : (buckets[category] || { items: [], page: 0, hasMore: false, loading: false, error: '' });
            const allSelected = catProducts.length > 0 && catProducts.every(p => selectedProducts.some(sp => sp._id === p._id));
            const catPriceF = categoryPriceFilter[category] || {};
            const catSortVal = categorySort[category] || '';
            const hasCatFilters = catSortVal || catPriceF.min || catPriceF.max;

            return (
              <div key={category} style={{ marginBottom: 40 }}>

                {/* Category header */}
                <div style={{ marginBottom: 16 }}>
                  {/* Row 1: chevron + title + select all + line */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
                    <div
                      onClick={() => toggleCategory(category)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                    >
                      <span style={{
                        color: T.muted, fontSize: 10,
                        transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s', display: 'inline-block',
                      }}>▼</span>
                      <h2 style={{
                        fontFamily: jost, fontSize: 10, fontWeight: 400,
                        letterSpacing: '0.28em', textTransform: 'uppercase',
                        color: T.muted, margin: 0,
                      }}>
                        {category} <span style={{ color: T.gold }}>({count})</span>
                      </h2>
                    </div>

                    <button
                      onClick={() => selectAllInCategory(catProducts)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        background: allSelected ? T.gold : 'transparent',
                        border: `1px solid ${allSelected ? T.gold : T.borderG}`,
                        padding: '4px 12px', borderRadius: 2,
                        fontFamily: jost, fontSize: 9, fontWeight: 400,
                        letterSpacing: '0.18em', textTransform: 'uppercase',
                        color: allSelected ? T.navy : T.gold,
                        cursor: 'pointer', transition: 'all 0.2s',
                      }}
                    >
                      {allSelected ? <CheckSquare size={11} /> : <Square size={11} />}
                      {allSelected ? 'All Selected' : 'Select All'}
                    </button>

                    {/* ── Per-category sort ── */}
                    <SearchableSelect
                      size="sm"
                      minWidth={96}
                      value={catSortVal}
                      onChange={val => setCatSort(category, val)}
                      title="Sort products in this category"
                      emptyLabel="Sort"
                      searchPlaceholder="Search sort options…"
                      options={[
                        { value: 'asc', label: 'Name A → Z' },
                        { value: 'desc', label: 'Name Z → A' },
                        { value: 'price-asc', label: 'Price ↑' },
                        { value: 'price-desc', label: 'Price ↓' },
                      ]}
                    />

                    {/* ── Per-category price range ── */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      background: 'white',
                      border: `1px solid ${(catPriceF.min || catPriceF.max) ? T.gold : T.border}`,
                      borderRadius: 2, padding: '3px 8px',
                    }}>
                      <span style={{ fontFamily: jost, fontSize: 9, color: T.muted }}>₹</span>
                      <input
                        type="number"
                        placeholder="Min"
                        value={catPriceF.min || ''}
                        onChange={e => setCatPrice(category, 'min', e.target.value)}
                        style={{
                          width: 44, background: 'transparent', border: 'none',
                          fontFamily: jost, fontSize: 9, fontWeight: 300,
                          color: T.text, outline: 'none',
                        }}
                      />
                      <span style={{ color: T.border, fontSize: 9 }}>–</span>
                      <input
                        type="number"
                        placeholder="Max"
                        value={catPriceF.max || ''}
                        onChange={e => setCatPrice(category, 'max', e.target.value)}
                        style={{
                          width: 44, background: 'transparent', border: 'none',
                          fontFamily: jost, fontSize: 9, fontWeight: 300,
                          color: T.text, outline: 'none',
                        }}
                      />
                    </div>

                    {/* ── Reset cat filters ── */}
                    {hasCatFilters && (
                      <button
                        onClick={() => resetCatFilters(category)}
                        title="Reset category filters"
                        style={{
                          background: 'none', border: `1px solid ${T.border}`, borderRadius: 2,
                          padding: '4px 6px', cursor: 'pointer', color: T.muted,
                          display: 'flex', alignItems: 'center', transition: 'color 0.2s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = T.gold; e.currentTarget.style.borderColor = T.borderG; }}
                        onMouseLeave={e => { e.currentTarget.style.color = T.muted; e.currentTarget.style.borderColor = T.border; }}
                      >
                        <RotateCcw size={10} />
                      </button>
                    )}

                    <div style={{ flex: 1, height: 1, background: T.border }} />
                  </div>
                </div>

                {!collapsed && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: 16,
                  }}>
                    {catProducts.map(p => {
                      const isSelected = selectedProducts.some(sp => sp._id === p._id);
                      return (
                        <div
                          key={p._id}
                          style={{
                            background: 'white',
                            border: `1px solid ${isSelected ? T.gold : T.border}`,
                            borderRadius: 2,
                            overflow: 'hidden',
                            display: 'flex', flexDirection: 'column',
                            position: 'relative',
                            transition: 'border-color 0.2s, box-shadow 0.2s',
                            boxShadow: isSelected ? `0 0 0 2px ${T.gold}30` : 'none',
                          }}
                        >
                          {/* Selection toggle */}
                          <div
                            onClick={() => toggleProductSelection(p)}
                            style={{
                              position: 'absolute', top: 8, right: 8, zIndex: 20,
                              width: 20, height: 20, borderRadius: '50%',
                              border: `2px solid ${isSelected ? T.gold : 'rgba(255,255,255,0.8)'}`,
                              background: isSelected ? T.gold : 'rgba(255,255,255,0.8)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', transition: 'all 0.2s',
                            }}
                          >
                            <Check size={11} strokeWidth={3} style={{ color: isSelected ? T.navy : 'transparent' }} />
                          </div>

                          <ProductImage p={p} getAssetUrl={getAssetUrl} onPreview={() => setPreviewProduct(p)} />

                          {/* Background video upload state (OneDrive job) */}
                          {['processing', 'failed'].includes(p.video?.upload?.status) && (
                            <span
                              title={p.video.upload.status === 'failed' ? p.video.upload.error : `Uploading ${p.video.upload.fileName}`}
                              style={{
                                position: 'absolute', top: 8, left: 8, zIndex: 20,
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                background: p.video.upload.status === 'failed' ? T.red : 'rgba(14,21,32,0.75)',
                                color: 'white', fontFamily: jost, fontSize: 7.5, letterSpacing: '0.14em',
                                textTransform: 'uppercase', padding: '3px 7px', borderRadius: 2,
                              }}
                            >
                              {p.video.upload.status === 'failed'
                                ? <><AlertCircle size={9} /> Video failed</>
                                : <><Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> Video processing</>}
                            </span>
                          )}

                          <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                            <div>
                              {/* Partner + partner name — internal info, hidden in Client Mode */}
                              {p.fromPartner && !clientMode && (
                                <span title={p.partnerName ? `Added by ${p.partnerName}` : 'Added by a Partner'} style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', marginBottom: 6, padding: '2px 7px',
                                  border: `1px solid ${T.borderG}`, background: T.dimBg, color: T.gold,
                                  fontFamily: jost, fontSize: 7.5, fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase',
                                  overflow: 'hidden', whiteSpace: 'nowrap',
                                }}>
                                  Partner
                                  {p.partnerName && (
                                    <span style={{ color: T.text, fontWeight: 400, letterSpacing: '0.06em', textTransform: 'none', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      · {p.partnerName}
                                    </span>
                                  )}
                                </span>
                              )}
                              <h3 style={{
                                fontFamily: jost, fontSize: 11, fontWeight: 500,
                                color: T.text, lineHeight: 1.4, marginBottom: 8,
                                overflow: 'hidden', display: '-webkit-box',
                                WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                              }}>
                                <span style={{ color: T.gold, fontWeight: 600, marginRight: 4 }}>{p.brand}</span>
                                {p.name}
                              </h3>

                              {/* Cost / Markup — hidden in client mode */}
                              {!clientMode && (
                                <div style={{
                                  display: 'flex', justifyContent: 'space-between',
                                  background: T.offwhite, border: `1px solid ${T.border}`,
                                  padding: '6px 8px', marginBottom: 8,
                                }}>
                                  <div>
                                    <span style={{ display: 'block', fontFamily: jost, fontSize: 7, fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', color: T.muted }}>Cost</span>
                                    <span style={{ fontFamily: jost, fontSize: 11, fontWeight: 400, color: T.text }}>₹{p.purchasePrice}</span>
                                  </div>
                                  <div style={{ textAlign: 'right' }}>
                                    <span style={{ display: 'block', fontFamily: jost, fontSize: 7, fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', color: T.muted }}>Markup</span>
                                    <span style={{ fontFamily: jost, fontSize: 11, fontWeight: 500, color: T.indigo }}>+{p.markupPercent}%</span>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Sale price + actions */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                              <div>
                                <span style={{ display: 'block', fontFamily: jost, fontSize: 7, fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', color: T.muted }}>Sale Price</span>
                                <span style={{ fontFamily: serif, fontSize: 16, fontWeight: 600, color: T.green }}>
                                  ₹{calculateSellingPrice(p.purchasePrice, p.markupPercent)}
                                </span>
                              </div>

                              <div style={{ display: 'flex', gap: 2 }}>
                                {[
                                  { icon: <Pencil size={12} />, color: T.indigo, action: () => setProductModal({ id: p._id }), title: 'Edit (details, images & video)' },
                                  { icon: <Trash2 size={12} />, color: T.red,    action: () => handleDelete(p), title: 'Delete' },
                                ].map(({ icon, color, action, title }) => (
                                  <button
                                    key={title}
                                    onClick={action}
                                    title={title}
                                    style={{
                                      background: 'none', border: 'none', cursor: 'pointer',
                                      padding: '5px 6px', borderRadius: 2,
                                      color: T.muted, transition: 'background 0.15s, color 0.15s',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = `${color}15`; e.currentTarget.style.color = color; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = T.muted; }}
                                  >
                                    {icon}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Per-category paging state (browse mode) */}
                {!collapsed && bucket && (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: catProducts.length ? 16 : 0 }}>
                    {bucket.loading && (
                      catProducts.length
                        ? <span style={{ fontFamily: jost, fontSize: 10, color: T.muted, display: 'flex', alignItems: 'center', gap: 6 }}><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</span>
                        : <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
                            {Array.from({ length: Math.min(5, count || 5) }).map((_, i) => <SkeletonCard key={i} />)}
                          </div>
                    )}
                    {bucket.error && (
                      <span style={{ fontFamily: jost, fontSize: 11, color: T.red, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <AlertCircle size={12} /> {bucket.error}
                        <button onClick={() => loadCategory(category, { reset: !bucket.page })} style={loadMoreBtn}>Retry</button>
                      </span>
                    )}
                    {!bucket.loading && !bucket.error && bucket.hasMore && (
                      <button onClick={() => loadCategory(category)} style={loadMoreBtn}>
                        Load more · {catProducts.length} of {bucket.total}
                      </button>
                    )}
                    {!bucket.loading && !bucket.error && bucket.page > 0 && catProducts.length === 0 && (
                      <span style={{ fontFamily: jost, fontSize: 11, color: T.muted }}>No products match this category's price range.</span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Search mode paging */}
        {filterMode && !isLoading && search.hasMore && (
          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <button onClick={loadMoreSearch} disabled={search.loading} style={loadMoreBtn}>
              {search.loading ? 'Loading…' : `Load more results · ${search.items.length} of ${search.total}`}
            </button>
          </div>
        )}
      </div>

      {/* ── Footer row count ─────────────────────────────────────────────────── */}
      {!isLoading && (
        <div style={{
          borderTop: `1px solid ${T.border}`, marginTop: 16,
          padding: '10px 0',
          fontFamily: jost, fontSize: 10, fontWeight: 300,
          letterSpacing: '0.12em', color: T.muted, textAlign: 'right',
        }}>
          {filterMode
            ? `${search.total} matching product${search.total !== 1 ? 's' : ''}`
            : `${summary.total} product${summary.total !== 1 ? 's' : ''} in ${summary.categories.length} categories · ${loadedCount} loaded`}
        </div>
      )}

      {/* ── Selection bar (floating) ──────────────────────────────────────────── */}
      {selectedProducts.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
          zIndex: 100,
          background: T.navy,
          border: `1px solid rgba(255,255,255,0.08)`,
          padding: '16px 28px',
          display: 'flex', alignItems: 'center', gap: 24,
          boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
        }}>
          <div style={{ borderRight: `1px solid rgba(255,255,255,0.10)`, paddingRight: 24 }}>
            <span style={{ display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.25em', textTransform: 'uppercase', color: T.gold }}>Selection</span>
            <span style={{ fontFamily: serif, fontSize: 20, fontWeight: 300, color: 'white' }}>{selectedProducts.length} Items</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => setSelectedProducts([])}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.2em', textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.4)', transition: 'color 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = T.red; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
            >
              Deselect All
            </button>
            <button
              onClick={openAddToExistingModal}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                background: 'rgba(255,255,255,0.07)',
                border: `1px solid rgba(255,255,255,0.15)`,
                padding: '9px 18px', borderRadius: 2,
                fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                color: 'white', cursor: 'pointer',
              }}
            >
              <FolderPlus size={13} style={{ color: T.gold }} /> Add to Existing
            </button>
            <button
              onClick={handleOpenBuilder}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                background: T.gold, color: T.navy,
                border: 'none', padding: '10px 22px', borderRadius: 2,
                fontFamily: jost, fontSize: 9, fontWeight: 500,
                letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = T.gold2; }}
              onMouseLeave={e => { e.currentTarget.style.background = T.gold; }}
            >
              <Plus size={13} /> Build New
            </button>
            <button
              onClick={() => addToPortal(selectedProducts)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                background: 'transparent',
                border: `1px solid ${T.borderG}`,
                padding: '9px 18px', borderRadius: 2,
                fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                color: T.gold, cursor: 'pointer',
              }}
            >
              Add to Portal
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          PRODUCT PREVIEW MODAL
      ════════════════════════════════════════════════════════════════════════ */}
      {previewProduct && (
        <div
          onClick={() => setPreviewProduct(null)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(14,21,32,0.85)', backdropFilter: 'blur(6px)',
            zIndex: 250, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="animate-modal-up"
            style={{
              background: 'white', border: `1px solid ${T.border}`,
              width: '100%', maxWidth: 600,
              maxHeight: '90vh', overflowY: 'auto',
              display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Image */}
            <div style={{ position: 'relative', background: T.offwhite, minHeight: '55vh', maxHeight: '62vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ProductPreviewMedia key={previewProduct._id} p={previewProduct} getAssetUrl={getAssetUrl} />
              <button
                onClick={() => setPreviewProduct(null)}
                style={{
                  position: 'absolute', top: 12, right: 12,
                  background: 'white', border: `1px solid ${T.border}`,
                  padding: '6px 8px', borderRadius: 2, cursor: 'pointer',
                  color: T.muted, display: 'flex', transition: 'color 0.2s',
                  zIndex: 20,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = T.text; }}
                onMouseLeave={e => { e.currentTarget.style.color = T.muted; }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Details */}
            <div style={{ padding: '24px 28px', borderTop: `1px solid ${T.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{
                    display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400,
                    letterSpacing: '0.3em', textTransform: 'uppercase', color: T.gold, marginBottom: 4,
                  }}>
                    {previewProduct.brand}
                  </span>
                  <h2 style={{
                    fontFamily: serif, fontSize: 26, fontWeight: 300,
                    color: T.navy, margin: '0 0 6px',
                    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  }}>
                    {previewProduct.name}
                  </h2>
                  {previewProduct.description && (
                    <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted, margin: 0, lineHeight: 1.6 }}>
                      {previewProduct.description}
                    </p>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{ display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted, marginBottom: 4 }}>
                    Selling Price
                  </span>
                  <span style={{ fontFamily: serif, fontSize: 28, fontWeight: 600, color: T.green }}>
                    ₹{calculateSellingPrice(previewProduct.purchasePrice, previewProduct.markupPercent)}
                  </span>
                </div>
              </div>

              <button
                onClick={() => { toggleProductSelection(previewProduct); setPreviewProduct(null); }}
                style={{
                  marginTop: 20, width: '100%', padding: '12px 0',
                  background: selectedProducts.some(p => p._id === previewProduct._id) ? 'transparent' : T.gold,
                  border: `1px solid ${selectedProducts.some(p => p._id === previewProduct._id) ? T.border : T.gold}`,
                  color:   selectedProducts.some(p => p._id === previewProduct._id) ? T.muted : T.navy,
                  fontFamily: jost, fontSize: 10, fontWeight: 500,
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  cursor: 'pointer', transition: 'all 0.2s',
                }}
              >
                {selectedProducts.some(p => p._id === previewProduct._id) ? 'Remove from Selection' : 'Select Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          CATALOGUE MODAL
      ════════════════════════════════════════════════════════════════════════ */}
      {catalogueModalItems && (
        <AddToCatalogueModal
          items={catalogueModalItems}
          onClose={() => setCatalogueModalItems(null)}
          onAdded={() => setSelectedProducts([])}
        />
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          ADD / EDIT PRODUCT MODAL — details, images and video in one place
      ════════════════════════════════════════════════════════════════════════ */}
      {productModal && (
        <ProductFormModal
          key={productModal.id || 'new'}
          productId={productModal.id}
          meta={meta}
          savedPrompts={savedPrompts}
          showToast={showToast}
          onClose={() => setProductModal(null)}
          onSaved={handleProductSaved}
          onMediaProcessed={handleMediaProcessed}
          onOpenPromptManager={() => { resetPromptManager(); setShowPromptManager(true); }}
        />
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          STUDIO PROMPTS MANAGER MODAL
      ════════════════════════════════════════════════════════════════════════ */}
      {showPromptManager && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(14,21,32,0.80)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, zIndex: 130,
        }}>
          <div className="animate-modal-up" style={{
            background: 'white', border: `1px solid ${T.border}`,
            width: '100%', maxWidth: 620,
            maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{
              padding: '24px 28px', borderBottom: `1px solid ${T.border}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
            }}>
              <h2 style={{ fontFamily: serif, fontSize: 26, fontWeight: 300, color: T.navy, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={16} style={{ color: T.purple }} /> Studio Prompts
              </h2>
              <button onClick={() => { setShowPromptManager(false); resetPromptManager(); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, fontSize: 18, padding: 4, transition: 'color 0.2s' }}
                onMouseEnter={e => { e.currentTarget.style.color = T.text; }}
                onMouseLeave={e => { e.currentTarget.style.color = T.muted; }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 28, display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Add / Edit form */}
              <div style={{ background: T.purpleBg, border: `1px solid ${T.borderG}`, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p style={{ fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.28em', textTransform: 'uppercase', color: T.purple, margin: 0 }}>
                  {editingPromptId ? '✏️ Edit Prompt' : '＋ New Prompt'}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <FieldLabel>Name</FieldLabel>
                    <input value={promptForm.name} onChange={e => setPromptForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Dark Studio" style={inputStyle()} onFocus={e => { e.currentTarget.style.borderColor = T.gold; }} onBlur={e => { e.currentTarget.style.borderColor = T.border; }} />
                  </div>
                  <div>
                    <FieldLabel>Category</FieldLabel>
                    <select value={promptForm.category} onChange={e => setPromptForm(f => ({ ...f, category: e.target.value }))} style={{ ...inputStyle(), background: 'white' }}>
                      <option value="">Select…</option>
                      <option value="All">All Categories</option>
                      {meta.categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <FieldLabel>Prompt</FieldLabel>
                  <textarea rows={4} value={promptForm.prompt} onChange={e => setPromptForm(f => ({ ...f, prompt: e.target.value }))} placeholder="Act as a high-end commercial photographer…" style={{ ...inputStyle(), resize: 'none', height: 90 }} onFocus={e => { e.currentTarget.style.borderColor = T.gold; }} onBlur={e => { e.currentTarget.style.borderColor = T.border; }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                    <input type="checkbox" checked={promptForm.isDefault} onChange={e => setPromptForm(f => ({ ...f, isDefault: e.target.checked }))} style={{ accentColor: T.purple, width: 13, height: 13 }} />
                    <span style={{ fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', color: T.purple }}>Set as default for category</span>
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {editingPromptId && (
                      <button onClick={resetPromptManager} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.18em', textTransform: 'uppercase', color: T.muted, padding: '8px 14px' }}>Cancel</button>
                    )}
                    {/* Save prompt buffer */}
                    <button
                      onClick={savePrompt}
                      disabled={promptSaving}
                      style={{
                        background: promptSaving ? T.gold2 : T.gold, color: T.navy,
                        border: 'none', padding: '9px 22px',
                        fontFamily: jost, fontSize: 9, fontWeight: 500,
                        letterSpacing: '0.2em', textTransform: 'uppercase',
                        cursor: promptSaving ? 'not-allowed' : 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        opacity: promptSaving ? 0.7 : 1,
                      }}
                    >
                      {promptSaving ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : (editingPromptId ? 'Update' : 'Save Prompt')}
                    </button>
                  </div>
                </div>
              </div>

              {/* Prompts list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.28em', textTransform: 'uppercase', color: T.muted, margin: 0 }}>
                  Saved Prompts ({savedPrompts.length})
                </p>
                {savedPrompts.length === 0 && (
                  <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted, fontStyle: 'italic' }}>No prompts saved yet.</p>
                )}
                {savedPrompts.map(p => (
                  <div key={p._id} style={{
                    background: 'white', border: `1px solid ${T.border}`,
                    padding: '14px 16px', display: 'flex', gap: 12,
                    transition: 'border-color 0.2s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = T.borderG; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                        <span style={{ fontFamily: jost, fontSize: 13, fontWeight: 500, color: T.text }}>{p.name}</span>
                        <span style={{ fontFamily: jost, fontSize: 8, fontWeight: 400, letterSpacing: '0.18em', textTransform: 'uppercase', color: T.purple, border: `1px solid ${T.borderG}`, padding: '2px 8px' }}>{p.category}</span>
                        {p.isDefault && <span style={{ fontFamily: jost, fontSize: 8, fontWeight: 400, letterSpacing: '0.18em', textTransform: 'uppercase', color: T.amber, border: '1px solid rgba(217,119,6,0.2)', padding: '2px 8px' }}>★ Default</span>}
                      </div>
                      <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {p.prompt}
                      </p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                      {!p.isDefault && (
                        <button onClick={() => setDefaultPrompt(p._id)} title="Set as default" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '5px 6px', color: T.muted, transition: 'color 0.15s' }}
                          onMouseEnter={e => { e.currentTarget.style.color = T.amber; }} onMouseLeave={e => { e.currentTarget.style.color = T.muted; }}>
                          <Star size={13} />
                        </button>
                      )}
                      <button onClick={() => { setEditingPromptId(p._id); setPromptForm({ name: p.name, category: p.category, prompt: p.prompt, isDefault: p.isDefault }); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '5px 6px', color: T.muted, transition: 'color 0.15s' }}
                        onMouseEnter={e => { e.currentTarget.style.color = T.indigo; }} onMouseLeave={e => { e.currentTarget.style.color = T.muted; }}>
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => deletePrompt(p._id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '5px 6px', color: T.muted, transition: 'color 0.15s' }}
                        onMouseEnter={e => { e.currentTarget.style.color = T.red; }} onMouseLeave={e => { e.currentTarget.style.color = T.muted; }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          PDF IMPORT MODAL (AI process + save)
      ════════════════════════════════════════════════════════════════════════ */}
      {showPdfModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,21,32,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 120 }}>
          <div className="animate-modal-up" style={{ background: 'white', border: `1px solid ${T.border}`, width: '100%', maxWidth: 480, padding: '32px 32px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, paddingBottom: 16, borderBottom: `1px solid ${T.border}` }}>
              <h2 style={{ fontFamily: serif, fontSize: 26, fontWeight: 300, color: T.navy, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={16} style={{ color: T.purple }} /> Import from PDF
              </h2>
              <button onClick={() => setShowPdfModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, fontSize: 18 }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted, lineHeight: 1.7, background: T.purpleBg, border: `1px solid ${T.borderG}`, padding: '12px 14px', margin: 0 }}>
                Upload a PDF of the <strong>same category</strong>. Each image will be processed by Gemini AI into a studio-quality shot and saved as a draft product.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {[
                  { label: 'Category', key: 'pdfCategory', value: pdfCategory, setter: setPdfCategory, opts: meta.categories },
                  { label: 'Brand',    key: 'pdfBrand',    value: pdfBrand,    setter: setPdfBrand,    opts: meta.brands },
                ].map(({ label, key, value, setter, opts }) => (
                  <div key={key}>
                    <FieldLabel>{label}</FieldLabel>
                    <select value={value} onChange={e => setter(e.target.value)} style={{ ...inputStyle(), background: 'white' }}>
                      <option value="">Select…</option>
                      {opts.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              <PromptSelector
                prompts={savedPrompts} category={pdfCategory}
                selectedId={pdfPromptId} onSelect={setPdfPromptId}
                customText={pdfCustomPrompt} onCustom={setPdfCustomPrompt}
                onOpenManager={() => { setShowPdfModal(false); resetPromptManager(); setShowPromptManager(true); }}
              />

              <div>
                <FieldLabel>PDF File</FieldLabel>
                <input type="file" accept="application/pdf" onChange={e => setPdfFile(e.target.files[0])} style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.text, width: '100%' }} />
                {pdfFile && <p style={{ fontFamily: jost, fontSize: 9, fontWeight: 300, color: T.purple, marginTop: 4 }}>{pdfFile.name}</p>}
              </div>

              {/* PDF processing buffer */}
              {pdfLoading && pdfProgress && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#eff6ff', border: '1px solid #bfdbfe', padding: '10px 12px' }}>
                  <Loader2 size={13} style={{ color: '#3b82f6', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                  <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 400, color: '#2563eb', margin: 0 }}>{pdfProgress}</p>
                </div>
              )}
              {pdfLoading && !pdfProgress && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.purpleBg, border: `1px solid ${T.borderG}`, padding: '10px 12px' }}>
                  <Loader2 size={13} style={{ color: T.purple, animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                  <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 400, color: T.purple, margin: 0 }}>Processing with Gemini AI…</p>
                </div>
              )}

              {pdfResult && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f0fdf4', border: '1px solid #86efac', padding: '10px 12px' }}>
                  <CheckCircle2 size={15} style={{ color: T.green, flexShrink: 0 }} />
                  <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 500, color: T.green, margin: 0 }}>
                    {pdfResult.count} draft products created — find them in the catalogue with "Import" in the name
                  </p>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, borderTop: `1px solid ${T.border}`, marginTop: 24, paddingTop: 20 }}>
              <button onClick={() => setShowPdfModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: jost, fontSize: 10, fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', color: T.muted, padding: '10px 18px' }}>Close</button>
              <button
                onClick={handlePdfImport}
                disabled={pdfLoading || !pdfFile}
                style={{
                  background: (pdfLoading || !pdfFile) ? T.gold2 : T.gold, color: T.navy,
                  border: 'none', padding: '11px 28px',
                  fontFamily: jost, fontSize: 10, fontWeight: 500,
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  cursor: (pdfLoading || !pdfFile) ? 'not-allowed' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  opacity: (pdfLoading || !pdfFile) ? 0.65 : 1,
                }}
              >
                {pdfLoading
                  ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Processing…</>
                  : <><Sparkles size={13} /> Process & Save Products</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          EXTRACT PDF IMAGES MODAL (raw download, no AI)
      ════════════════════════════════════════════════════════════════════════ */}
      {showExtractModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,21,32,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 120 }}>
          <div className="animate-modal-up" style={{ background: 'white', border: `1px solid ${T.border}`, width: '100%', maxWidth: 440, padding: '32px 32px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${T.border}` }}>
              <h2 style={{ fontFamily: serif, fontSize: 26, fontWeight: 300, color: T.navy, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Download size={16} style={{ color: T.amber }} /> Extract PDF Images
              </h2>
              <button onClick={() => { if (!extractLoading) { setShowExtractModal(false); setExtractFile(null); } }} disabled={extractLoading} style={{ background: 'none', border: 'none', cursor: extractLoading ? 'not-allowed' : 'pointer', color: T.muted, fontSize: 18, opacity: extractLoading ? 0.3 : 1 }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted, lineHeight: 1.7, background: '#fffbeb', border: '1px solid rgba(217,119,6,0.2)', padding: '12px 14px', margin: 0 }}>
                Extract all embedded images from a PDF as a <strong>ZIP file</strong> — no AI processing. Use this to download raw product images, then upload them individually via <em>Add Product</em>.
              </p>
              <div>
                <FieldLabel>PDF File</FieldLabel>
                <input type="file" accept="application/pdf" onChange={e => setExtractFile(e.target.files[0])} disabled={extractLoading} style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.text, width: '100%' }} />
                {extractFile && <p style={{ fontFamily: jost, fontSize: 9, fontWeight: 300, color: T.amber, marginTop: 4 }}>{extractFile.name}</p>}
              </div>

              {/* Extraction buffer */}
              {extractLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fffbeb', border: '1px solid rgba(217,119,6,0.25)', padding: '10px 12px' }}>
                  <Loader2 size={13} style={{ color: T.amber, animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                  <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 400, color: T.amber, margin: 0 }}>Extracting images — this may take a moment for large PDFs…</p>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, borderTop: `1px solid ${T.border}`, marginTop: 24, paddingTop: 20 }}>
              <button onClick={() => { if (!extractLoading) { setShowExtractModal(false); setExtractFile(null); } }} disabled={extractLoading} style={{ background: 'none', border: 'none', cursor: extractLoading ? 'not-allowed' : 'pointer', fontFamily: jost, fontSize: 10, fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', color: T.muted, padding: '10px 18px', opacity: extractLoading ? 0.3 : 1 }}>Cancel</button>
              <button
                onClick={handleExtractImages}
                disabled={extractLoading || !extractFile}
                style={{
                  background: (extractLoading || !extractFile) ? 'rgba(217,119,6,0.4)' : T.amber,
                  color: 'white', border: 'none', padding: '11px 28px',
                  fontFamily: jost, fontSize: 10, fontWeight: 500,
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  cursor: (extractLoading || !extractFile) ? 'not-allowed' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  opacity: (extractLoading || !extractFile) ? 0.65 : 1,
                }}
              >
                {extractLoading
                  ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Extracting…</>
                  : <><Download size={13} /> Download ZIP</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          PENDING SUPPLIER APPROVALS (NEW)
      ════════════════════════════════════════════════════════════════════════ */}
      {showPendingApprovals && (
        <PendingSupplierApprovals
          meta={meta}
          onClose={() => setShowPendingApprovals(false)}
          onApproved={() => refresh()}
        />
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          DELETE PRODUCT — requires a reason (NEW). If the product originated
          from a Partner submission, this reason is emailed/shown back to them.
      ════════════════════════════════════════════════════════════════════════ */}
      {deletingProduct && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(14,21,32,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{
            background: 'white', width: '100%', maxWidth: 460, padding: 32, borderRadius: 4,
            boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
          }}>
            <h3 style={{ fontFamily: serif, fontSize: 22, fontWeight: 300, color: T.navy, marginBottom: 8 }}>
              Delete "{deletingProduct.name}"?
            </h3>
            <p style={{ fontFamily: jost, fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 16 }}>
              This product was added by a Partner. It will be removed from the catalogue and your
              reason below will be shown to the Partner in their portal.
            </p>
            <textarea
              rows={3}
              value={deleteReason}
              onChange={e => setDeleteReason(e.target.value)}
              placeholder="e.g. Discontinued by manufacturer, duplicate listing, quality concerns…"
              style={{
                width: '100%', border: `1px solid ${T.border}`, borderRadius: 3, padding: '10px 12px',
                fontFamily: jost, fontSize: 12, resize: 'none', outline: 'none', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeletingProduct(null)} style={{
                background: 'transparent', border: `1px solid ${T.border}`, color: T.muted, padding: '10px 20px',
                borderRadius: 2, fontFamily: jost, fontSize: 11, cursor: 'pointer',
              }}>
                Cancel
              </button>
              <button onClick={confirmDeleteWithReason} disabled={deletingInProgress} style={{
                background: T.red, color: 'white', border: 'none', padding: '10px 20px', borderRadius: 2,
                fontFamily: jost, fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
              }}>
                {deletingInProgress ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <PortalModal />
    </div>
  );
};

export default ProductList;