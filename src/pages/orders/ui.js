/**
 * src/pages/orders/ui.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Design tokens and small building blocks shared by the Order Management
 * screens (OrderTracker and its panels). Visual language mirrors ClientList:
 * navy/gold/offwhite palette, Jost + Cormorant Garamond, razor-thin borders.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import ordersApi from './ordersApi';

export const T = {
  navy:    '#0e1520',
  gold:    '#b8975a',
  gold2:   '#d4b06a',
  offwhite:'#faf8f5',
  text:    '#1a1a1a',
  muted:   '#888',
  border:  'rgba(0,0,0,0.07)',
  borderG: 'rgba(184,151,90,0.18)',
  dimBg:   'rgba(184,151,90,0.04)',
  danger:  '#dc2626',
  indigo:  '#4f46e5',
  emerald: '#059669',
};

export const jost  = '"Jost", sans-serif';
export const serif = '"Cormorant Garamond", Georgia, serif';

/** Colours for the procurement stage tones returned by /v2/orders/meta. */
export const TONES = {
  slate:   { bg: '#f1f5f9', color: '#475569' },
  blue:    { bg: '#eff6ff', color: '#2563eb' },
  indigo:  { bg: '#eef2ff', color: '#4f46e5' },
  violet:  { bg: '#f5f3ff', color: '#7c3aed' },
  amber:   { bg: '#fffbeb', color: '#b45309' },
  orange:  { bg: '#fff7ed', color: '#ea580c' },
  teal:    { bg: '#f0fdfa', color: '#0f766e' },
  emerald: { bg: '#ecfdf5', color: '#059669' },
};

export const GoldRule = () => <div style={{ width: 32, height: 1, background: T.gold, marginBottom: 20 }} />;

export const FieldLabel = ({ children, style }) => (
  <p style={{
    fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.25em',
    textTransform: 'uppercase', color: T.muted, margin: '0 0 6px', ...style,
  }}>
    {children}
  </p>
);

export const inputStyle = (focused, readOnly = false) => ({
  width: '100%', padding: '10px 14px',
  background: readOnly ? T.offwhite : 'white',
  border: `1px solid ${focused ? T.gold : T.border}`, borderRadius: 3,
  fontFamily: jost, fontSize: 13, fontWeight: 300, color: T.text,
  outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s',
});

/** Controlled input with the gold focus border. */
export const FocusInput = ({ style: extra = {}, readOnly = false, ...props }) => {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      readOnly={readOnly}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
      style={{ ...inputStyle(focused, readOnly), ...extra }}
    />
  );
};

export const GoldBtn = ({ onClick, disabled, children, style: extra = {}, type = 'button' }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    style={{
      background: disabled ? '#e2e8f0' : T.gold, color: disabled ? '#94a3b8' : T.navy,
      border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', padding: '12px 32px',
      fontFamily: jost, fontSize: 10, fontWeight: 500, letterSpacing: '0.22em',
      textTransform: 'uppercase', transition: 'background 0.25s',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      ...extra,
    }}
    onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = T.gold2; }}
    onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = T.gold; }}
  >
    {children}
  </button>
);

export const GhostBtn = ({ onClick, children, disabled, style: extra = {} }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    style={{
      background: 'none', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: jost, fontSize: 10, fontWeight: 400, letterSpacing: '0.2em',
      textTransform: 'uppercase', color: T.muted, transition: 'color 0.2s', padding: '10px 20px',
      opacity: disabled ? 0.4 : 1, ...extra,
    }}
    onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.color = T.text; }}
    onMouseLeave={(e) => { e.currentTarget.style.color = T.muted; }}
  >
    {children}
  </button>
);

/** Borderless icon button used in table rows. */
export const IconBtn = ({ onClick, title, children, color = T.muted, hover = T.gold, disabled, style }) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    disabled={disabled}
    onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
    style={{
      background: 'none', border: 'none', padding: 6, display: 'flex',
      cursor: disabled ? 'not-allowed' : 'pointer', color: disabled ? '#d1d5db' : color,
      transition: 'color 0.2s', ...style,
    }}
    onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.color = hover; }}
    onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.color = color; }}
  >
    {children}
  </button>
);

export const Spinner = ({ size = 16 }) => <Loader2 size={size} style={{ animation: 'spin 1s linear infinite' }} />;

/**
 * Centered modal: dimmed overlay, panel, optional eyebrow/title header with a
 * close button. Escape closes it unless `busy` (a save is in flight).
 */
export const Modal = ({
  open = true, onClose, eyebrow, title, children, width = 640, zIndex = 50, busy = false, padding = '36px 40px 32px',
  fullScreen = false, headerExtra = null,
}) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  // Stop the page behind a full-screen view from scrolling.
  useEffect(() => {
    if (!open || !fullScreen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open, fullScreen]);

  if (!open) return null;

  if (fullScreen) {
    return (
      <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex, background: 'white', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 20, padding: '18px 32px',
          borderBottom: `1px solid ${T.border}`, background: T.offwhite, flexShrink: 0,
        }}>
          <div style={{ minWidth: 0 }}>
            {eyebrow && (
              <p style={{ fontFamily: jost, fontSize: 9, letterSpacing: '0.28em', textTransform: 'uppercase', color: T.muted, margin: '0 0 4px' }}>
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 style={{ fontFamily: serif, fontSize: 28, fontWeight: 300, color: T.navy, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {title}
              </h2>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>{headerExtra}</div>
          <IconBtn title="Close (Esc)" onClick={onClose} disabled={busy} hover={T.text}><X size={24} /></IconBtn>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{children}</div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(14,21,32,0.78)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex,
      }}
    >
      <div style={{
        background: 'white', border: `1px solid ${T.border}`, width: '100%', maxWidth: width,
        maxHeight: '92vh', overflowY: 'auto', padding, boxSizing: 'border-box',
      }}>
        {(eyebrow || title) && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            marginBottom: 24, paddingBottom: 18, borderBottom: `1px solid ${T.border}`,
          }}>
            <div>
              {eyebrow && (
                <p style={{ fontFamily: jost, fontSize: 9, letterSpacing: '0.28em', textTransform: 'uppercase', color: T.muted, margin: '0 0 6px' }}>
                  {eyebrow}
                </p>
              )}
              {title && <h2 style={{ fontFamily: serif, fontSize: 26, fontWeight: 300, color: T.navy, margin: 0 }}>{title}</h2>}
            </div>
            <IconBtn title="Close" onClick={onClose} disabled={busy} hover={T.text}><X size={20} /></IconBtn>
          </div>
        )}
        {children}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated file previews
// ─────────────────────────────────────────────────────────────────────────────

// Object URLs of already-downloaded files, so reopening an order (or the
// lightbox after a thumbnail) never downloads the same bytes twice.
const BLOB_CACHE_MAX = 60;
const blobCache = new Map(); // itemId -> Promise<objectUrl>

const cachedObjectUrl = (orderId, itemId) => {
  if (blobCache.has(itemId)) {
    const hit = blobCache.get(itemId);
    blobCache.delete(itemId);
    blobCache.set(itemId, hit); // refresh LRU position
    return hit;
  }
  const p = ordersApi.fileBlob(orderId, itemId).then((blob) => URL.createObjectURL(blob));
  p.catch(() => blobCache.delete(itemId));
  blobCache.set(itemId, p);
  if (blobCache.size > BLOB_CACHE_MAX) {
    const [oldest, oldP] = blobCache.entries().next().value;
    blobCache.delete(oldest);
    oldP.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  }
  return p;
};

export const forgetFile = (itemId) => {
  const p = blobCache.get(itemId);
  blobCache.delete(itemId);
  p?.then((u) => URL.revokeObjectURL(u)).catch(() => {});
};

/** { src, loading, error } for an uploaded order file; idle when `enabled` is false. */
export const useFileUrl = (orderId, file, enabled = true) => {
  const itemId = file?.itemId;
  const [state, setState] = useState({ src: null, loading: Boolean(enabled && itemId), error: false });
  useEffect(() => {
    if (!enabled || !itemId || !orderId) { setState({ src: null, loading: false, error: false }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: false }));
    cachedObjectUrl(orderId, itemId)
      .then((src) => alive && setState({ src, loading: false, error: false }))
      .catch(() => alive && setState({ src: null, loading: false, error: true }));
    return () => { alive = false; };
  }, [orderId, itemId, enabled]);
  return state;
};

export const isImageFile = (file) =>
  file?.type?.startsWith('image/') || file?.mimeType?.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(file?.name || '');

export const isVideoFile = (file) =>
  file?.type?.startsWith('video/') || /\.(mp4|mov|webm|mpeg|3gp|avi|mkv)$/i.test(file?.name || '');

export const formatBytes = (n) => {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

/** Keeps only digits and one decimal point — quantities are typed, never nudged with arrows. */
export const numericOnly = (v) => String(v ?? '').replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');

export const formatMoney = (n) =>
  n === null || n === undefined || n === '' ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
