/**
 * src/pages/products/productUi.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Design tokens and small form primitives shared by the product catalogue
 * (ProductList.js) and the Add/Edit Product modal (ProductFormModal.js),
 * plus <ProductVideo /> — one player for every kind of product video
 * (YouTube, brand link, or a file uploaded to OneDrive).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Loader2, AlertCircle, ChevronDown, Search, Check } from 'lucide-react';
import v2 from '../../lib/apiV2';

// ─── Design tokens (mirrors ClientList) ──────────────────────────────────────
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
  indigo:  '#4f46e5',
  indigoBg:'rgba(79,70,229,0.06)',
  purple:  '#7c3aed',
  purpleBg:'rgba(124,58,237,0.06)',
  red:     '#dc2626',
  green:   '#16a34a',
  amber:   '#d97706',
};

export const jost  = '"Jost", sans-serif';
export const serif = '"Cormorant Garamond", Georgia, serif';

// ─── Video URL helpers ──────────────────────
export const getYouTubeId = (url) => {
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
export const isYouTube = (url) => Boolean(getYouTubeId(url));

// ─────────────────────────────────────────────────────────────────────────────
// Custom Creatable Select
// ─────────────────────────────────────────────────────────────────────────────
export const CustomCreatableSelect = ({ options, value, onChange, placeholder, isDisabled, label }) => {
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
export const PromptSelector = ({ prompts, category, selectedId, onSelect, customText, onCustom, onOpenManager }) => {
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
export const FieldLabel = ({ children }) => (
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
export const inputStyle = (focused = false, extra = {}) => ({
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
// ProductVideo — plays a product's video whatever its source:
//   link   → YouTube embed, or a <video> for a direct brand URL
//   upload → OneDrive file; a fresh short-lived URL is fetched right before
//            playing (they expire after ~1h, so they're never cached here)
// ─────────────────────────────────────────────────────────────────────────────
export const productVideoSource = (p) =>
  p?.video?.source || (p?.videoUrl ? 'link' : '');

export const hasProductVideo = (p) => Boolean(productVideoSource(p));

export const ProductVideo = ({ p, fit = 'contain', autoPlay = true }) => {
  const source = productVideoSource(p);
  const linkUrl = p?.video?.url || p?.videoUrl || '';
  const [streamUrl, setStreamUrl] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (source !== 'upload' || !p?._id) return undefined;
    const controller = new AbortController();
    setStreamUrl(null);
    setError('');
    v2.get(`/v2/products/${p._id}/video-stream`, { signal: controller.signal })
      .then(({ data }) => setStreamUrl(data.url))
      .catch((err) => { if (err.code !== 'CANCELLED') setError(err.message); });
    return () => controller.abort();
  }, [source, p?._id]);

  const frame = { width: '100%', height: '100%', border: 'none', background: '#000' };

  if (source === 'link' && getYouTubeId(linkUrl)) {
    return (
      <iframe
        src={`https://www.youtube.com/embed/${getYouTubeId(linkUrl)}?${autoPlay ? 'autoplay=1&' : ''}rel=0`}
        title={p.name}
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        style={frame}
      />
    );
  }
  const src = source === 'link' ? linkUrl : streamUrl;
  if (src) return <video src={src} controls autoPlay={autoPlay} playsInline style={{ ...frame, objectFit: fit }} />;

  return (
    <div style={{ ...frame, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'rgba(255,255,255,0.7)', fontFamily: jost, fontSize: 11 }}>
      {error
        ? <><AlertCircle size={14} /> {error}</>
        : <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading video…</>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SearchableSelect — drop-in replacement for the product list's <select>
// filters. Opens a small panel with a search box on top of the options, so
// long lists (brands, categories) can be narrowed by typing.
//   ↑/↓ move · Enter picks · Esc closes · click outside closes
//
//   <SearchableSelect value={filters.brand} onChange={v => …}
//     options={brands.map(b => ({ value: b, label: b }))} emptyLabel="All Brands" />
// ─────────────────────────────────────────────────────────────────────────────
export const SearchableSelect = ({
  value, onChange, options = [], emptyLabel = 'All', disabled = false,
  minWidth = 130, size = 'md', searchPlaceholder = 'Search…', title,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const sm = size === 'sm';

  const all = emptyLabel !== null ? [{ value: '', label: emptyLabel }, ...options] : options;
  const q = query.trim().toLowerCase();
  const visible = q ? all.filter((o) => o.value !== '' && String(o.label).toLowerCase().includes(q)) : all;
  const current = all.find((o) => o.value === value);
  const active = Boolean(value);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => { setCursor(0); }, [query, open]);

  const pick = (opt) => { onChange(opt.value); setOpen(false); setQuery(''); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(visible.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (visible[cursor]) pick(visible[cursor]); }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', minWidth }} title={title}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: sm ? '4px 8px' : '9px 12px', background: 'white',
          border: `1px solid ${active ? T.gold : T.border}`, borderRadius: sm ? 2 : 3,
          fontFamily: jost, fontSize: sm ? 9 : 11, fontWeight: sm ? 400 : 300,
          letterSpacing: sm ? '0.12em' : 0, color: active ? (sm ? T.gold : T.text) : (sm ? T.muted : T.text),
          cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1, textAlign: 'left',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current ? current.label : emptyLabel}</span>
        <ChevronDown size={sm ? 10 : 12} style={{ flexShrink: 0, color: T.muted, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 60, minWidth: '100%', width: 'max-content', maxWidth: 320,
          background: 'white', border: `1px solid ${T.borderG}`, boxShadow: '0 10px 30px rgba(14,21,32,0.12)',
        }}>
          <div style={{ position: 'relative', padding: 8, borderBottom: `1px solid ${T.border}` }}>
            <Search size={12} style={{ position: 'absolute', left: 17, top: '50%', transform: 'translateY(-50%)', color: T.muted }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              style={{ ...inputStyle(), padding: '7px 10px 7px 28px', fontSize: 12 }}
            />
          </div>
          <div role="listbox" style={{ maxHeight: 260, overflowY: 'auto', padding: '4px 0' }}>
            {visible.length === 0 && (
              <p style={{ fontFamily: jost, fontSize: 11, color: T.muted, padding: '10px 14px', margin: 0 }}>No matches for “{query}”</p>
            )}
            {visible.map((opt, i) => {
              const selected = opt.value === value;
              return (
                <div
                  key={opt.value || '__all'}
                  role="option"
                  aria-selected={selected}
                  onMouseDown={(e) => { e.preventDefault(); pick(opt); }}
                  onMouseEnter={() => setCursor(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', cursor: 'pointer',
                    fontFamily: jost, fontSize: 12, fontWeight: selected ? 500 : 300,
                    color: opt.value === '' ? T.muted : T.text,
                    background: i === cursor ? T.dimBg : 'transparent',
                  }}
                >
                  <Check size={11} style={{ color: T.gold, opacity: selected ? 1 : 0, flexShrink: 0 }} />
                  <span style={{ whiteSpace: 'nowrap' }}>{opt.label}</span>
                  {opt.count !== undefined && <span style={{ marginLeft: 'auto', paddingLeft: 12, fontSize: 10, color: T.muted }}>{opt.count}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
