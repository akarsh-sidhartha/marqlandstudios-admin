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

import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api';
import { createLogger } from '../utils/logger';
import {
  Plus, Check, FolderPlus, X, ChevronDown, Search, Trash2, Pencil,
  RotateCcw, Info, CheckSquare, Square, Sparkles, FileText, Download,
  ImageIcon, AlertCircle, CheckCircle2, Loader2, Star, Images,
  ChevronLeft, ChevronRight, Play,
} from 'lucide-react';
import usePortalItems from '../hooks/usePortalItems';
import ProductImageGallery from './ProductImageGallery';
import { usePopup } from '../components/AppPopups';
import { API_ROOT } from '../api';
import PendingSupplierApprovals, { PendingApprovalsButton } from './PendingSupplierApprovals'; // NEW — Supplier Portal

// ─── Logger ──────────────────────────────────────────────────────────────────
const log = createLogger('ProductList');

// ─── Design tokens (mirrors ClientList) ──────────────────────────────────────
const T = {
  navy:    '#0e1520',
  gold:    '#b8975a',
  gold2:   '#d4b06a',
  offwhite:'#faf8f5',
  text:    '#1a1a1a',
  muted:   '#888',
  border:  'rgba(0,0,0,0.07)',
  borderG: 'rgba(184,151,90,0.18)',
  dimBg:   'rgba(184,151,90,0.04)',
  indigo:  '#4f46e5',
  indigoBg:'rgba(79,70,229,0.06)',
  purple:  '#7c3aed',
  purpleBg:'rgba(124,58,237,0.06)',
  red:     '#dc2626',
  green:   '#16a34a',
  amber:   '#d97706',
};

const jost  = '"Jost", sans-serif';
const serif = '"Cormorant Garamond", Georgia, serif';

// ─── Video URL helpers (mirrors ProductImageGallery.js) ──────────────────────
const getYouTubeId = (url) => {
  if (!url) return null;
  const patterns = [
    /youtu\.be\/([^?&]+)/,
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtube\.com\/embed\/([^?&]+)/,
    /youtube\.com\/shorts\/([^?&]+)/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
};
const isYouTube = (url) => Boolean(getYouTubeId(url));

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton row — reusable loading placeholder (mirrors SkeletonList)
// ─────────────────────────────────────────────────────────────────────────────
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
  const hasVideo    = Boolean(p.videoUrl);
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
        isYouTube(p.videoUrl) ? (
          <iframe
            src={`https://www.youtube.com/embed/${getYouTubeId(p.videoUrl)}?autoplay=1&rel=0`}
            title={p.name}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        ) : (
          <video
            src={p.videoUrl}
            controls
            autoPlay
            style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000' }}
          />
        )
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
  const hasVideo    = Boolean(p.videoUrl);
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
        isYouTube(p.videoUrl) ? (
          <iframe
            src={`https://www.youtube.com/embed/${getYouTubeId(p.videoUrl)}?autoplay=1&rel=0`}
            title={p.name}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        ) : (
          <video
            src={p.videoUrl}
            controls
            autoPlay
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
          />
        )
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
// Custom Creatable Select
// ─────────────────────────────────────────────────────────────────────────────
const CustomCreatableSelect = ({ options, value, onChange, placeholder, isDisabled, label }) => {
  const [isOpen, setIsOpen]       = useState(false);
  const [inputValue, setInputValue] = useState('');
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (val) => {
    onChange({ value: val, label: val });
    setIsOpen(false);
    setInputValue('');
  };

  const handleCreate = () => {
    if (inputValue.trim()) {
      onChange({ value: inputValue, label: inputValue });
      setIsOpen(false);
      setInputValue('');
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <label style={{
        display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400,
        letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted, marginBottom: 6,
      }}>
        {label}
      </label>
      <div
        onClick={() => !isDisabled && setIsOpen(!isOpen)}
        style={{
          width: '100%', padding: '9px 12px',
          background: isDisabled ? T.offwhite : 'white',
          border: `1px solid ${T.border}`,
          borderRadius: 3,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          opacity: isDisabled ? 0.55 : 1,
          fontFamily: jost, fontSize: 13, fontWeight: 300, color: T.text,
          boxSizing: 'border-box',
          transition: 'border-color 0.2s',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value ? value.label : (placeholder || 'Select…')}
        </span>
        <ChevronDown size={13} style={{
          color: T.muted, flexShrink: 0, marginLeft: 6,
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s',
        }} />
      </div>

      {isOpen && (
        <div style={{
          position: 'absolute', zIndex: 150, width: '100%', marginTop: 4,
          background: 'white', border: `1px solid ${T.border}`,
          boxShadow: '0 8px 32px rgba(0,0,0,0.10)',
          maxHeight: 240, overflowY: 'auto',
        }}>
          <div style={{ padding: 8, borderBottom: `1px solid ${T.border}`, position: 'sticky', top: 0, background: 'white' }}>
            <input
              autoFocus
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="Search or type new…"
              style={{
                width: '100%', padding: '7px 10px',
                border: `1px solid ${T.border}`, borderRadius: 2,
                fontFamily: jost, fontSize: 12, fontWeight: 300,
                color: T.text, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          {options
            .filter(o => o.label.toLowerCase().includes(inputValue.toLowerCase()))
            .map((opt, idx) => (
              <div
                key={idx}
                onClick={() => handleSelect(opt.value)}
                style={{ padding: '9px 12px', fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.text, cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.background = T.dimBg; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                {opt.label}
              </div>
            ))}
          {inputValue && !options.some(o => o.label.toLowerCase() === inputValue.toLowerCase()) && (
            <div
              onClick={handleCreate}
              style={{
                padding: '9px 12px', borderTop: `1px solid ${T.border}`,
                fontFamily: jost, fontSize: 12, fontWeight: 500, color: T.gold, cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = T.dimBg; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              Create "{inputValue}"
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Prompt Selector (within Add Product modal)
// ─────────────────────────────────────────────────────────────────────────────
const PromptSelector = ({ prompts, category, selectedId, onSelect, customText, onCustom, onOpenManager }) => {
  const filtered = prompts.filter(p => !category || p.category === category || p.category === 'All');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {filtered.length > 0 && (
        <div>
          <label style={{
            display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400,
            letterSpacing: '0.25em', textTransform: 'uppercase', color: T.purple, marginBottom: 6,
          }}>
            Studio Prompt
          </label>
          <select
            value={selectedId}
            onChange={e => { onSelect(e.target.value); onCustom(''); }}
            style={{
              width: '100%', padding: '8px 10px',
              border: `1px solid ${T.borderG}`, borderRadius: 3,
              fontFamily: jost, fontSize: 12, fontWeight: 300,
              color: T.text, background: 'white', outline: 'none',
            }}
          >
            <option value="">— use category default —</option>
            {filtered.map(p => (
              <option key={p._id} value={p._id}>{p.name}{p.isDefault ? ' ★' : ''}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label style={{
          display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400,
          letterSpacing: '0.25em', textTransform: 'uppercase', color: T.purple, marginBottom: 6,
        }}>
          Custom Prompt Override
        </label>
        <textarea
          rows={2}
          value={customText}
          onChange={e => { onCustom(e.target.value); onSelect(''); }}
          placeholder="Optional — leave blank to use saved prompt above…"
          style={{
            width: '100%', padding: '8px 10px',
            border: `1px solid ${T.borderG}`, borderRadius: 3,
            fontFamily: jost, fontSize: 12, fontWeight: 300,
            color: T.text, background: 'white',
            resize: 'none', outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {onOpenManager && (
        <button
          type="button"
          onClick={onOpenManager}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontFamily: jost, fontSize: 9, fontWeight: 400,
            letterSpacing: '0.25em', textTransform: 'uppercase',
            color: T.purple, padding: 0,
          }}
        >
          <Sparkles size={9} /> Manage Studio Prompts
        </button>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared field label
// ─────────────────────────────────────────────────────────────────────────────
const FieldLabel = ({ children }) => (
  <label style={{
    display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400,
    letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted, marginBottom: 6,
  }}>
    {children}
  </label>
);

// ─────────────────────────────────────────────────────────────────────────────
// Shared input style helper
// ─────────────────────────────────────────────────────────────────────────────
const inputStyle = (focused = false, extra = {}) => ({
  width: '100%', padding: '9px 12px',
  background: 'white',
  border: `1px solid ${focused ? T.gold : T.border}`,
  borderRadius: 3,
  fontFamily: jost, fontSize: 13, fontWeight: 300,
  color: T.text, outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.2s',
  ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const ProductList = () => {

  // ── Data ────────────────────────────────────────────────────────────────────
  const [products, setProducts]       = useState([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [meta, setMeta]               = useState({ brands: [], categories: [], subCategories: {} });
  const [availableSubCats, setAvailableSubCats] = useState([]);
  // All categories start collapsed on load
  const [collapsedCategories, setCollapsedCategories] = useState(() => {
    // Will be overwritten once groupedProducts is known; start as "all collapsed" sentinel
    return { __allCollapsed: true };
  });

  // Per-category sort: { [cat]: 'asc' | 'desc' | 'price-asc' | 'price-desc' | '' }
  const [categorySort, setCategorySort] = useState({});
  // Per-category price range: { [cat]: { min: '', max: '' } }
  const [categoryPriceFilter, setCategoryPriceFilter] = useState({});
  const [selectedProducts, setSelectedProducts]     = useState([]);
  const [previewProduct, setPreviewProduct]         = useState(null);

  // ── Filters ─────────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState({
    brand: '', category: '', subCategory: '', minPrice: '', maxPrice: '', searchTerm: '',
  });

  // ── Add / Edit Product modal ─────────────────────────────────────────────────
  const [showModal, setShowModal]           = useState(false);
  const [isEditing, setIsEditing]           = useState(false);
  const [currentId, setCurrentId]           = useState(null);
  const [isSaving, setIsSaving]             = useState(false);
  const [formData, setFormData] = useState({
    brand: '', category: '', subCategory: '', name: '',
    description: '', purchasePrice: '', sellingPrice: '', markupPercent: 30,
  });

  // ── Image & AI processing ────────────────────────────────────────────────────
  const [imageFile, setImageFile]               = useState(null);
  const imageFileRef                            = useRef(null);   // module-level stable ref — survives all re-renders
  const [imagePreviewUrl, setImagePreviewUrl]   = useState(null);
  const [processImage, setProcessImage]         = useState(true);
  const [selectedPromptId, setPromptId]         = useState('');
  const [customPromptText, setCustomPrompt]     = useState('');
  const [savedPrompts, setSavedPrompts]         = useState([]);
  const [aiProcessing, setAiProcessing]         = useState(false);
  const [aiError, setAiError]                   = useState(null);
  const [generatedImageUrl, setGeneratedImageUrl] = useState(null);
  const [useGeneratedImage, setUseGeneratedImage] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);

  // ── Studio Prompts Manager ───────────────────────────────────────────────────
  const [showPromptManager, setShowPromptManager] = useState(false);
  const [promptForm, setPromptForm]   = useState({ name: '', category: '', prompt: '', isDefault: false });
  const [editingPromptId, setEditingPromptId]   = useState(null);
  const [promptSaving, setPromptSaving]         = useState(false);

  // ── Catalogue modal ──────────────────────────────────────────────────────────
  const [showCatalogueModal, setShowCatalogueModal]   = useState(false);
  const [savedCatalogues, setSavedCatalogues]         = useState([]);
  const [isUpdatingCatalogue, setIsUpdatingCatalogue] = useState(false);

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

  // ── Image Gallery & Video modal ──────────────────────────────────────────────
  const [galleryProduct, setGalleryProduct] = useState(null);

  // ── Pending Supplier Approvals panel (NEW) ───────────────────────────────────
  const [showPendingApprovals, setShowPendingApprovals] = useState(false);

  // ── Client visit mode (hides cost/markup from view) ──────────────────────────
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

  //const getAssetUrl = (p) => p;
  const getAssetUrl = (p) => {
    if (!p) return '';
    if (p.startsWith('http')) return p;   // R2 / OneDrive — already absolute
    return `${API_ROOT}${p}`;             // legacy local /uploads/ path
  };

  // ─── Data fetching ──────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    log.debug('Fetching products and meta…');
    setIsLoading(true);
    try {
      const [pRes, mRes] = await Promise.all([
        api.get('/products'),
        api.get('/products/meta'),
      ]);
      const metaData = mRes.data || { brands: [], categories: [], subCategories: {} };
      // Normalise legacy subCategoryMap field
      if (metaData.subCategoryMap && !metaData.subCategories) {
        metaData.subCategories = metaData.subCategoryMap;
      }
      const fetchedProducts = pRes.data || [];
      setProducts(fetchedProducts);
      setMeta(metaData);
      // Collapse all categories by default on initial load
      const cats = [...new Set(fetchedProducts.map(p => p.category || 'Uncategorized'))];
      setCollapsedCategories(prev => {
        if (prev.__allCollapsed) {
          return cats.reduce((acc, c) => ({ ...acc, [c]: true }), {});
        }
        return prev;
      });
      log.info('Products loaded', { count: fetchedProducts.length });
    } catch (err) {
      log.error('Failed to fetch products', err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  useEffect(() => {
    fetchData();
    fetchPrompts();
  }, [fetchData, fetchPrompts]);

  // ─── Reset helpers ──────────────────────────────────────────────────────────
  const resetFilters = () =>
    setFilters({ brand: '', category: '', subCategory: '', minPrice: '', maxPrice: '', searchTerm: '' });

  const resetForm = () => {
    imageFileRef.current = null;          // clear ref in sync with state
    setFormData({ brand: '', category: '', subCategory: '', name: '', description: '', purchasePrice: '', sellingPrice: '', markupPercent: 30 });
    setImageFile(null);
    setImagePreviewUrl(null);
    setIsEditing(false);
    setCurrentId(null);
    setAvailableSubCats([]);
    setProcessImage(true);
    setPromptId('');
    setCustomPrompt('');
    setGeneratedImageUrl(null);
    setUseGeneratedImage(false);
    setAiProcessing(false);
    setAiError(null);
  };

  const resetPromptManager = () => {
    setEditingPromptId(null);
    setPromptForm({ name: '', category: '', prompt: '', isDefault: false });
  };

  // ─── Image file selection ────────────────────────────────────────────────────
  const handleImageFileChange = (file) => {
    // Store in ref immediately — survives re-renders caused by other formData changes
    imageFileRef.current = file instanceof File ? file : null;
    setImageFile(file instanceof File ? file : null);
    setGeneratedImageUrl(null);
    setUseGeneratedImage(false);
    setAiError(null);
    setImagePreviewUrl(file && file instanceof File ? URL.createObjectURL(file) : null);
    log.debug('handleImageFileChange', { name: file?.name ?? 'none', isFile: file instanceof File });
  };

  // ─── AI: generate studio image ───────────────────────────────────────────────
  const handleGenerateStudio = async () => {
    if (!imageFile) return;
    log.info('Generating studio image…', { category: formData.category });
    setAiProcessing(true);
    setAiError(null);
    setGeneratedImageUrl(null);
    setUseGeneratedImage(false);
    try {
      const fd = new FormData();
      fd.append('image', imageFile);
      if (selectedPromptId)  fd.append('promptId',   selectedPromptId);
      if (customPromptText)  fd.append('promptText',  customPromptText);
      if (formData.category) fd.append('category',    formData.category);
      const res = await api.post('/image-processing/preview', fd);
      setGeneratedImageUrl(res.data.imageDataUrl);
      setUseGeneratedImage(true);
      log.info('Studio image generated successfully');
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'AI processing failed';
      log.error('Studio generation failed', msg);
      setAiError(msg);
    } finally {
      setAiProcessing(false);
    }
  };

  // ─── Save product ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    log.info(isEditing ? 'Updating product' : 'Creating product', { name: formData.name });
    setIsSaving(true);
    try {
      const data = new FormData();
      data.append('brand',         formData.brand);
      data.append('category',      formData.category);
      data.append('subCategory',   formData.subCategory || '');
      data.append('name',          formData.name);
      data.append('description',   formData.description);
      data.append('purchasePrice', formData.purchasePrice);
      data.append('sellingPrice',  calculateSellingPrice(formData.purchasePrice, formData.markupPercent));
      data.append('markupPercent', formData.markupPercent);

      // Read from ref — written synchronously in handleImageFileChange, survives re-renders
      const currentFile = imageFileRef.current;
      log.debug('handleSave — file check', {
        file: currentFile ? `${currentFile.name} (${currentFile.size}b)` : 'none',
        isFile: currentFile instanceof File,
      });

      if (currentFile instanceof File) {
        if (useGeneratedImage && generatedImageUrl) {
          // Convert base64 data URL → Blob → File; skip back-end re-processing
          const res     = await fetch(generatedImageUrl);
          const blob    = await res.blob();
          const genFile = new File([blob], 'studio-processed.webp', { type: 'image/webp' });
          data.append('image', genFile);
          data.append('processImage', 'false');
        } else {
          data.append('image', currentFile);
          data.append('processImage', (processImage && !generatedImageUrl) ? 'true' : 'false');
          if (selectedPromptId) data.append('promptId',   selectedPromptId);
          if (customPromptText) data.append('promptText', customPromptText);
        }
      } else if (currentFile !== null) {
        // Warn if something other than null ended up in the ref (e.g. stale object)
        log.warn('handleSave — imageFileRef is not a File, skipping image append', { type: typeof currentFile });
      }

      if (isEditing) {
        await api.put(`/products/${currentId}`, data);
        showToast('success', `"${formData.name}" updated successfully`);
        log.info('Product updated', { id: currentId });
      } else {
        await api.post('/products', data);
        showToast('success', `"${formData.name}" added to catalogue`);
        log.info('Product created', { name: formData.name });
      }

      setShowModal(false);
      resetForm();
      fetchData();
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to save product';
      log.error('Save product failed', msg);
      showToast('error', msg);
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Delete product ──────────────────────────────────────────────────────────
  // NEW — deletion now requires a reason, since it may cascade a notification
  // back to the partner who originally submitted this product.
  const [deletingProduct, setDeletingProduct] = useState(null); // { id, name } | null
  const [deleteReason, setDeleteReason] = useState('');
  const [deletingInProgress, setDeletingInProgress] = useState(false);

  const handleDelete = (id, productName) => {
    setDeletingProduct({ id, name: productName });
    setDeleteReason('');
  };

  const confirmDeleteWithReason = async () => {
    if (!deleteReason.trim()) {
      showToast('warning', 'Please enter a reason for deleting this product.');
      return;
    }
    const { id, name: productName } = deletingProduct;
    setDeletingInProgress(true);
    log.info('Deleting product', { id, name: productName, reason: deleteReason });
    try {
      await api.delete(`/products/${id}`, { data: { reason: deleteReason.trim() } });
      setSelectedProducts(prev => prev.filter(p => p._id !== id));
      showToast('success', `"${productName}" deleted`);
      setDeletingProduct(null);
      fetchData();
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to delete product';
      log.error('Delete product failed', msg);
      showToast('error', msg);
    } finally {
      setDeletingInProgress(false);
    }
  };

  // ─── Edit product ────────────────────────────────────────────────────────────
  const handleEditClick = (p) => {
    log.debug('Opening edit modal', { id: p._id, name: p.name });
    setIsEditing(true);
    setCurrentId(p._id);
    setFormData({
      brand:         p.brand         || '',
      category:      p.category      || '',
      subCategory:   p.subCategory   || '',
      name:          p.name          || '',
      description:   p.description   || '',
      purchasePrice: p.purchasePrice || '',
      sellingPrice:  p.sellingPrice  || '',
      markupPercent: p.markupPercent || 30,
    });
    const subCats = (meta.subCategories && p.category && meta.subCategories[p.category]) || [];
    setAvailableSubCats(subCats.map(s => ({ label: s, value: s })));
    setShowModal(true);
  };

  // ─── Category change ─────────────────────────────────────────────────────────
  const handleCategoryChange = (v) => {
    const selectedCat = v?.value || '';
    setFormData(prev => ({ ...prev, category: selectedCat, subCategory: '' }));
    const subCats = (meta.subCategories && meta.subCategories[selectedCat]) || [];
    setAvailableSubCats(subCats.map(s => ({ label: s, value: s })));
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
  const handleOpenBuilder = () => {
    log.debug('Opening catalogue builder', { itemCount: selectedProducts.length });
    const data = selectedProducts.map(p => ({
      _id: p._id, name: p.name, imageUrl: p.imageUrl,
      description: p.description, price: p.price,
    }));
    localStorage.setItem('catalogue_selection', JSON.stringify(data));
    window.open('/builder', '_blank');
  };

  const openAddToExistingModal = async () => {
    setShowCatalogueModal(true);
    try {
      const res = await api.get('/catalogues');
      setSavedCatalogues(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      log.warn('Failed to load catalogues', err.message);
      setSavedCatalogues([]);
    }
  };

  const appendToCatalogue = async (targetCat) => {
    if (!targetCat || isUpdatingCatalogue) return;
    log.info('Appending to catalogue', { catalogueId: targetCat._id, items: selectedProducts.length });
    setIsUpdatingCatalogue(true);
    try {
      const newItems = selectedProducts.map(p => ({
        name: p.name || 'Unnamed', description: p.description || '',
        price: p.price || 0, imageUrl: p.imageUrl || '',
      }));
      await api.post('/catalogues', {
        id:       targetCat._id,
        name:     targetCat.name,
        subtitle: targetCat.subtitle,
        items:    [...(targetCat.items || []), ...newItems],
      });
      setSelectedProducts([]);
      setShowCatalogueModal(false);
    } catch (err) {
      log.error('Failed to update catalogue', err.message);
    } finally {
      setIsUpdatingCatalogue(false);
    }
  };

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
      fetchData();
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

  // ─── Duplicate product detection ────────────────────────────────────────────
  // Checks name similarity against products with the same brand+category+subCategory.
  // Runs purely against the already-fetched `products` array — no extra API call.
  const duplicateMatches = React.useMemo(() => {
    if (isEditing) return [];                         // skip check when editing
    const name = formData.name.trim().toLowerCase();
    if (name.length < 2) return [];                   // don\'t fire on 1 char

    const brand    = formData.brand.trim().toLowerCase();
    const category = formData.category.trim().toLowerCase();
    const subCat   = formData.subCategory.trim().toLowerCase();

    return products.filter(p => {
      // Must share brand + category (subCategory optional — match if either is blank)
      const sameBrand  = !brand    || (p.brand    || '').toLowerCase() === brand;
      const sameCat    = !category || (p.category || '').toLowerCase() === category;
      const sameSubCat = !subCat   || !(p.subCategory) || (p.subCategory || '').toLowerCase() === subCat;
      if (!sameBrand || !sameCat || !sameSubCat) return false;

      const existing = (p.name || '').toLowerCase();
      // Flag if the existing name contains the typed name or vice-versa
      return existing.includes(name) || name.includes(existing);
    });
  }, [formData.name, formData.brand, formData.category, formData.subCategory, products, isEditing]);

    // ─── Filtering & grouping ────────────────────────────────────────────────────
  const filteredProducts = products.filter(p => {
    const sPrice = parseFloat(calculateSellingPrice(p.purchasePrice, p.markupPercent));
    const min    = filters.minPrice === '' ? 0        : parseFloat(filters.minPrice);
    const max    = filters.maxPrice === '' ? Infinity : parseFloat(filters.maxPrice);
    const s      = filters.searchTerm.toLowerCase();
    return (
      (p.name?.toLowerCase().includes(s) || p.brand?.toLowerCase().includes(s) || p.category?.toLowerCase().includes(s)) &&
      (filters.brand       === '' || p.brand       === filters.brand) &&
      (filters.category    === '' || p.category    === filters.category) &&
      (filters.subCategory === '' || p.subCategory === filters.subCategory) &&
      sPrice >= min && sPrice <= max
    );
  });

  const groupedProducts = filteredProducts.reduce((acc, p) => {
    const cat = p.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});

  const setCatSort = (cat, val) => setCategorySort(prev => ({ ...prev, [cat]: val }));
  const setCatPrice = (cat, key, val) =>
    setCategoryPriceFilter(prev => ({ ...prev, [cat]: { ...(prev[cat] || {}), [key]: val } }));
  const resetCatFilters = (cat) => {
    setCategorySort(prev => ({ ...prev, [cat]: '' }));
    setCategoryPriceFilter(prev => ({ ...prev, [cat]: { min: '', max: '' } }));
  };

  const applyCatFiltersAndSort = (cat, prods) => {
    const priceF = categoryPriceFilter[cat] || {};
    const min = priceF.min === '' || priceF.min === undefined ? 0 : parseFloat(priceF.min);
    const max = priceF.max === '' || priceF.max === undefined ? Infinity : parseFloat(priceF.max);
    let result = prods.filter(p => {
      const sp = parseFloat(calculateSellingPrice(p.purchasePrice, p.markupPercent));
      return sp >= min && sp <= max;
    });
    const sort = categorySort[cat] || '';
    if (sort === 'asc')        result = [...result].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (sort === 'desc')       result = [...result].sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    if (sort === 'price-asc')  result = [...result].sort((a, b) => parseFloat(calculateSellingPrice(a.purchasePrice, a.markupPercent)) - parseFloat(calculateSellingPrice(b.purchasePrice, b.markupPercent)));
    if (sort === 'price-desc') result = [...result].sort((a, b) => parseFloat(calculateSellingPrice(b.purchasePrice, b.markupPercent)) - parseFloat(calculateSellingPrice(a.purchasePrice, a.markupPercent)));
    return result;
  };

  const toggleCategory = (cat) =>
    setCollapsedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));

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

          {/* Filter selects */}
          {[
            { key: 'brand',       opts: meta.brands,              placeholder: 'All Brands' },
            { key: 'category',    opts: meta.categories,          placeholder: 'All Categories' },
          ].map(({ key, opts, placeholder }) => (
            <select
              key={key}
              value={filters[key]}
              onChange={e => {
                const val = e.target.value;
                setFilters(f => key === 'category'
                  ? { ...f, category: val, subCategory: '' }
                  : { ...f, [key]: val }
                );
              }}
              style={{
                padding: '9px 12px', border: `1px solid ${T.border}`, borderRadius: 3,
                fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.text,
                background: 'white', outline: 'none', cursor: 'pointer', minWidth: 120,
              }}
            >
              <option value="">{placeholder}</option>
              {opts.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ))}

          {/* Sub-category */}
          <select
            disabled={!filters.category}
            value={filters.subCategory}
            onChange={e => setFilters(f => ({ ...f, subCategory: e.target.value }))}
            style={{
              padding: '9px 12px', border: `1px solid ${T.border}`, borderRadius: 3,
              fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.text,
              background: 'white', outline: 'none', cursor: filters.category ? 'pointer' : 'not-allowed',
              opacity: filters.category ? 1 : 0.45, minWidth: 120,
            }}
          >
            <option value="">All Sub Cats</option>
            {filters.category && (meta.subCategories?.[filters.category] || []).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

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
              onClick={() => { resetForm(); setShowModal(true); }}
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

            {/* Client Mode toggle — hides cost/markup during client visits */}
            <button
              onClick={toggleClientMode}
              title={clientMode ? 'Client Mode ON — click to show cost & markup' : 'Client Mode OFF — click to hide cost & markup'}
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
        {isLoading ? (
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
        ) : Object.keys(groupedProducts).length === 0 ? (
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
          Object.keys(groupedProducts).sort().map(category => {
            const isCollapsed = collapsedCategories[category];
            const catProducts = applyCatFiltersAndSort(category, groupedProducts[category]);
            const allCatProducts = groupedProducts[category];
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
                        transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s', display: 'inline-block',
                      }}>▼</span>
                      <h2 style={{
                        fontFamily: jost, fontSize: 10, fontWeight: 400,
                        letterSpacing: '0.28em', textTransform: 'uppercase',
                        color: T.muted, margin: 0,
                      }}>
                        {category} <span style={{ color: T.gold }}>({allCatProducts.length})</span>
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
                    <select
                      value={catSortVal}
                      onChange={e => setCatSort(category, e.target.value)}
                      title="Sort products in this category"
                      style={{
                        padding: '4px 8px',
                        border: `1px solid ${catSortVal ? T.gold : T.border}`,
                        borderRadius: 2,
                        fontFamily: jost, fontSize: 9, fontWeight: 400,
                        color: catSortVal ? T.gold : T.muted,
                        background: 'white', outline: 'none', cursor: 'pointer',
                        letterSpacing: '0.12em',
                      }}
                    >
                      <option value="">Sort</option>
                      <option value="asc">Name A → Z</option>
                      <option value="desc">Name Z → A</option>
                      <option value="price-asc">Price ↑</option>
                      <option value="price-desc">Price ↓</option>
                    </select>

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

                {!isCollapsed && (
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

                          <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                            <div>
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
                                  { icon: <Images size={12} />, color: T.purple, action: () => setGalleryProduct(p), title: 'Image Gallery' },
                                  { icon: <Pencil size={12} />, color: T.indigo, action: () => handleEditClick(p),   title: 'Edit' },
                                  { icon: <Trash2 size={12} />, color: T.red,    action: () => handleDelete(p._id, p.name), title: 'Delete' },
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
              </div>
            );
          })
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
          {filteredProducts.length} of {products.length} product{products.length !== 1 ? 's' : ''}
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
      {showCatalogueModal && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(14,21,32,0.75)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, zIndex: 200,
        }}>
          <div className="animate-modal-up" style={{
            background: 'white', border: `1px solid ${T.border}`,
            width: '100%', maxWidth: 460,
          }}>
            <div style={{
              padding: '24px 28px', borderBottom: `1px solid ${T.border}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <p style={{ fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.28em', textTransform: 'uppercase', color: T.muted, margin: '0 0 4px' }}>
                  Appending {selectedProducts.length} items
                </p>
                <h2 style={{ fontFamily: serif, fontSize: 26, fontWeight: 300, color: T.navy, margin: 0 }}>
                  Select Catalogue
                </h2>
              </div>
              <button onClick={() => setShowCatalogueModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, fontSize: 18, padding: 4 }}>✕</button>
            </div>

            <div style={{ maxHeight: 360, overflowY: 'auto', padding: '8px 0' }}>
              {savedCatalogues.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center' }}>
                  <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted }}>No saved catalogues found.</p>
                </div>
              ) : savedCatalogues.map(cat => (
                <button
                  key={cat._id}
                  disabled={isUpdatingCatalogue}
                  onClick={() => appendToCatalogue(cat)}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: '16px 24px', background: 'none', border: 'none',
                    borderBottom: `1px solid ${T.border}`,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    cursor: isUpdatingCatalogue ? 'not-allowed' : 'pointer',
                    opacity: isUpdatingCatalogue ? 0.5 : 1,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (!isUpdatingCatalogue) e.currentTarget.style.background = T.dimBg; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                >
                  <div>
                    <span style={{ display: 'block', fontFamily: jost, fontSize: 13, fontWeight: 500, color: T.text }}>{cat.name}</span>
                    <span style={{ display: 'block', fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted, marginTop: 2 }}>
                      {(cat.items || []).length} current items
                    </span>
                  </div>
                  <Plus size={16} style={{ color: T.gold, flexShrink: 0 }} />
                </button>
              ))}
            </div>

            <div style={{ padding: '16px 24px', borderTop: `1px solid ${T.border}`, textAlign: 'right' }}>
              <button
                onClick={() => setShowCatalogueModal(false)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: jost, fontSize: 10, fontWeight: 400,
                  letterSpacing: '0.2em', textTransform: 'uppercase', color: T.muted,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          ADD / EDIT PRODUCT MODAL
      ════════════════════════════════════════════════════════════════════════ */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(14,21,32,0.75)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, zIndex: 110,
        }}>
          <div className="animate-modal-up" style={{
            background: 'white', border: `1px solid ${T.border}`,
            padding: '36px 36px 28px',
            width: '100%', maxWidth: 600,
            maxHeight: '92vh', overflowY: 'auto',
          }}>

            {/* Modal header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              marginBottom: 32, paddingBottom: 20, borderBottom: `1px solid ${T.border}`,
            }}>
              <div>
                <p style={{ fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.28em', textTransform: 'uppercase', color: T.muted, marginBottom: 6 }}>
                  {isEditing ? 'Update Record' : 'New Entry'}
                </p>
                <h2 style={{ fontFamily: serif, fontSize: 28, fontWeight: 300, color: T.navy, margin: 0 }}>
                  {isEditing ? 'Edit Product' : 'Add Product'}
                </h2>
              </div>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, fontSize: 20, lineHeight: 1, padding: 4, transition: 'color 0.2s' }}
                onMouseEnter={e => { e.currentTarget.style.color = T.text; }}
                onMouseLeave={e => { e.currentTarget.style.color = T.muted; }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Brand / Category */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <CustomCreatableSelect label="Brand" isDisabled={isEditing}
                  options={meta.brands.map(b => ({ label: b, value: b }))}
                  value={formData.brand ? { label: formData.brand, value: formData.brand } : null}
                  onChange={v => setFormData(f => ({ ...f, brand: v?.value || '' }))} />
                <CustomCreatableSelect label="Category" isDisabled={isEditing}
                  options={meta.categories.map(c => ({ label: c, value: c }))}
                  value={formData.category ? { label: formData.category, value: formData.category } : null}
                  onChange={handleCategoryChange} />
              </div>

              {/* Sub Category / Name */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <CustomCreatableSelect label="Sub Category"
                  isDisabled={isEditing || !formData.category}
                  options={availableSubCats}
                  value={formData.subCategory ? { label: formData.subCategory, value: formData.subCategory } : null}
                  onChange={v => setFormData(f => ({ ...f, subCategory: v?.value || '' }))} />
                <div>
                  <FieldLabel>Name</FieldLabel>
                  <input
                    value={formData.name}
                    onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                    style={inputStyle()}
                    onFocus={e => { e.currentTarget.style.borderColor = T.gold; }}
                    onBlur={e => { e.currentTarget.style.borderColor = T.border; }}
                  />
                  {/* Duplicate warning */}
                  {duplicateMatches.length > 0 && (
                    <div style={{
                      marginTop: 6, padding: '8px 10px',
                      background: '#fffbeb', border: '1px solid rgba(217,119,6,0.3)',
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}>
                      <span style={{ fontFamily: jost, fontSize: 9, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', color: T.amber, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <AlertCircle size={10} /> Similar product{duplicateMatches.length > 1 ? 's' : ''} already exist{duplicateMatches.length === 1 ? 's' : ''}
                      </span>
                      {duplicateMatches.map(m => (
                        <span key={m._id} style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.text, paddingLeft: 15 }}>
                          • {m.brand} — {m.name}
                          {m.subCategory ? <span style={{ color: T.muted }}> ({m.subCategory})</span> : null}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Description */}
              <div>
                <FieldLabel>Description</FieldLabel>
                <textarea
                  rows={3}
                  value={formData.description}
                  onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                  style={{ ...inputStyle(), resize: 'none', height: 72 }}
                  onFocus={e => { e.currentTarget.style.borderColor = T.gold; }}
                  onBlur={e => { e.currentTarget.style.borderColor = T.border; }}
                />
              </div>

              {/* Cost Price / Image */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <FieldLabel>Cost Price (₹)</FieldLabel>
                  <input
                    type="number"
                    className="no-spinner"
                    value={formData.purchasePrice}
                    onChange={e => setFormData(f => ({ ...f, purchasePrice: e.target.value }))}
                    style={inputStyle()}
                    onFocus={e => { e.currentTarget.style.borderColor = T.gold; }}
                    onBlur={e => { e.currentTarget.style.borderColor = T.border; }}
                  />
                </div>
                <div>
                  <FieldLabel>Image</FieldLabel>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => handleImageFileChange(e.target.files[0])}
                    style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.text, marginTop: 2, width: '100%' }}
                  />
                  {isEditing && (
                    <p style={{ fontFamily: jost, fontSize: 9, fontWeight: 300, color: T.indigo, marginTop: 4, fontStyle: 'italic' }}>
                      Leave empty to keep current image
                    </p>
                  )}
                </div>
              </div>

              {/* ── Studio AI section ── */}
              {imageFile && (
                <div style={{
                  background: T.purpleBg, border: `1px solid ${T.borderG}`,
                  padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14,
                }}>
                  {/* Toggle */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={processImage}
                      onChange={e => {
                        setProcessImage(e.target.checked);
                        if (!e.target.checked) { setGeneratedImageUrl(null); setUseGeneratedImage(false); setAiError(null); }
                      }}
                      style={{ accentColor: T.purple, width: 14, height: 14 }}
                    />
                    <span style={{ fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.25em', textTransform: 'uppercase', color: T.purple, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Sparkles size={10} /> Studio AI Processing (Gemini)
                    </span>
                  </label>

                  {processImage && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <PromptSelector
                        prompts={savedPrompts} category={formData.category}
                        selectedId={selectedPromptId} onSelect={setPromptId}
                        customText={customPromptText} onCustom={setCustomPrompt}
                        onOpenManager={() => { setShowModal(false); resetPromptManager(); setShowPromptManager(true); }}
                      />

                      {/* Generate button */}
                      <button
                        type="button"
                        onClick={handleGenerateStudio}
                        disabled={aiProcessing}
                        style={{
                          width: '100%', padding: '11px 0',
                          background: aiProcessing ? 'rgba(124,58,237,0.4)' : T.purple,
                          border: 'none', color: 'white',
                          fontFamily: jost, fontSize: 9, fontWeight: 400,
                          letterSpacing: '0.22em', textTransform: 'uppercase',
                          cursor: aiProcessing ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                          transition: 'background 0.2s',
                        }}
                      >
                        {aiProcessing
                          ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Generating with Gemini…</>
                          : <><Sparkles size={13} /> Generate Studio Image</>}
                      </button>

                      {/* AI processing buffer — spinner shown above covers this; error surfaced below */}
                      {aiError && (
                        <div style={{
                          display: 'flex', alignItems: 'flex-start', gap: 8,
                          background: '#fef2f2', border: '1px solid #fecaca',
                          padding: '10px 12px',
                        }}>
                          <AlertCircle size={13} style={{ color: T.red, marginTop: 1, flexShrink: 0 }} />
                          <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 400, color: T.red, margin: 0 }}>{aiError}</p>
                        </div>
                      )}

                      {/* Before / After comparison */}
                      {generatedImageUrl && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            {[
                              { src: imagePreviewUrl,   label: 'Original',   active: !useGeneratedImage, onPick: () => setUseGeneratedImage(false) },
                              { src: generatedImageUrl, label: 'AI Studio',  active:  useGeneratedImage, onPick: () => setUseGeneratedImage(true)  },
                            ].map(({ src, label, active, onPick }) => (
                              <div
                                key={label}
                                onClick={onPick}
                                style={{
                                  cursor: 'pointer', overflow: 'hidden',
                                  border: `2px solid ${active ? T.gold : T.border}`,
                                  opacity: active ? 1 : 0.65,
                                  transition: 'all 0.2s',
                                }}
                              >
                                <img src={src} alt={label} style={{ width: '100%', height: 88, objectFit: 'cover', display: 'block' }} />
                                <div style={{
                                  padding: '5px 0', textAlign: 'center',
                                  background: active ? T.gold : T.offwhite,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                                }}>
                                  {active && <CheckCircle2 size={9} style={{ color: active ? T.navy : T.muted }} />}
                                  <span style={{ fontFamily: jost, fontSize: 8, fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', color: active ? T.navy : T.muted }}>
                                    {label}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowCompareModal(true)}
                            style={{
                              width: '100%', padding: '8px 0',
                              background: 'none',
                              border: `1px solid ${T.borderG}`,
                              fontFamily: jost, fontSize: 8, fontWeight: 400,
                              letterSpacing: '0.2em', textTransform: 'uppercase',
                              color: T.purple, cursor: 'pointer', display: 'flex',
                              alignItems: 'center', justifyContent: 'center', gap: 5,
                              transition: 'background 0.2s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = T.purpleBg; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                          >
                            <ImageIcon size={10} /> Compare Full Size
                          </button>
                          <p style={{ fontFamily: jost, fontSize: 9, fontWeight: 300, color: T.purple, textAlign: 'center', margin: 0 }}>
                            {useGeneratedImage ? '✨ AI Studio image will be saved' : '📷 Original image will be saved'}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Margin / Selling price */}
              <div style={{ background: T.indigoBg, border: `1px solid rgba(79,70,229,0.10)`, padding: '20px 22px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'center' }}>
                  <div>
                    <FieldLabel>Margin (%)</FieldLabel>
                    <select
                      value={formData.markupPercent}
                      onChange={e => setFormData(f => ({ ...f, markupPercent: parseInt(e.target.value) }))}
                      style={{ ...inputStyle(), background: 'white' }}
                    >
                      {[10, 15, 20, 25, 30, 35, 40, 45, 50].map(m => (
                        <option key={m} value={m}>{m}%</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted, marginBottom: 4 }}>
                      Final Selling Price
                    </span>
                    <span style={{ fontFamily: serif, fontSize: 36, fontWeight: 600, color: T.green }}>
                      ₹{calculateSellingPrice(formData.purchasePrice, formData.markupPercent)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Save buffer — button shows spinner while request is in flight */}
            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: 14,
              borderTop: `1px solid ${T.border}`, marginTop: 28, paddingTop: 24,
            }}>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: jost, fontSize: 10, fontWeight: 400,
                  letterSpacing: '0.2em', textTransform: 'uppercase',
                  color: T.muted, padding: '10px 20px', transition: 'color 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = T.text; }}
                onMouseLeave={e => { e.currentTarget.style.color = T.muted; }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                style={{
                  background: isSaving ? T.gold2 : T.gold,
                  color: T.navy,
                  border: 'none', padding: '12px 36px',
                  fontFamily: jost, fontSize: 10, fontWeight: 500,
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                  transition: 'background 0.25s',
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  opacity: isSaving ? 0.75 : 1,
                }}
                onMouseEnter={e => { if (!isSaving) e.currentTarget.style.background = T.gold2; }}
                onMouseLeave={e => { if (!isSaving) e.currentTarget.style.background = T.gold; }}
              >
                {isSaving
                  ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />{isEditing ? 'Updating…' : 'Saving…'}</>
                  : (isEditing ? 'Update Product' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
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
          FULLSCREEN AI COMPARE LIGHTBOX
      ════════════════════════════════════════════════════════════════════════ */}
      {showCompareModal && generatedImageUrl && (
        <div
          onClick={() => setShowCompareModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.96)', zIndex: 300, display: 'flex', flexDirection: 'column' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', flexShrink: 0 }}
          >
            <p style={{ fontFamily: jost, fontSize: 10, fontWeight: 400, letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', margin: 0 }}>
              Compare — Click an image to select it
            </p>
            <button onClick={() => setShowCompareModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', fontSize: 20, transition: 'color 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'white'; }} onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}>
              ✕
            </button>
          </div>

          <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flex: 1, gap: 12, padding: '0 24px 20px', overflow: 'hidden' }}>
            {[
              { src: imagePreviewUrl,   label: 'Original',  active: !useGeneratedImage, onPick: () => { setUseGeneratedImage(false); setShowCompareModal(false); } },
              { src: generatedImageUrl, label: 'AI Studio', active:  useGeneratedImage, onPick: () => { setUseGeneratedImage(true);  setShowCompareModal(false); } },
            ].map(({ src, label, active, onPick }) => (
              <div
                key={label}
                onClick={onPick}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  border: `3px solid ${active ? T.gold : 'rgba(255,255,255,0.07)'}`,
                  cursor: 'pointer', overflow: 'hidden',
                  boxShadow: active ? `0 0 32px ${T.gold}40` : 'none',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
              >
                <div style={{ flex: 1, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  <img src={src} alt={label} style={{ maxWidth: '100%', maxHeight: 'calc(90vh - 130px)', objectFit: 'contain' }} />
                </div>
                <div style={{
                  padding: '10px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  background: active ? T.gold : 'rgba(255,255,255,0.04)',
                }}>
                  {active && <CheckCircle2 size={14} style={{ color: active ? T.navy : 'rgba(255,255,255,0.4)' }} />}
                  <span style={{ fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.25em', textTransform: 'uppercase', color: active ? T.navy : 'rgba(255,255,255,0.35)' }}>
                    {label}
                  </span>
                  {active && <span style={{ fontFamily: jost, fontSize: 9, fontWeight: 300, color: T.navy, opacity: 0.7 }}>— will be saved</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          IMAGE GALLERY & VIDEO MODAL
      ════════════════════════════════════════════════════════════════════════ */}
      {galleryProduct && (
        <ProductImageGallery
          product={galleryProduct}
          onClose={() => setGalleryProduct(null)}
          onSaved={fetchData}
        />
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          PENDING SUPPLIER APPROVALS (NEW)
      ════════════════════════════════════════════════════════════════════════ */}
      {showPendingApprovals && (
        <PendingSupplierApprovals
          meta={meta}
          onClose={() => setShowPendingApprovals(false)}
          onApproved={fetchData}
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
              This permanently removes the product from the catalogue. If it was submitted by a Partner,
              your reason below will be shown to them in their portal.
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