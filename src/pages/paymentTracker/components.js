/**
 * paymentTracker/components.js — presentational building blocks shared by the
 * desktop screen, the modals and the mobile flow.
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, Download, Eye, FileText, Image as ImageIcon, FolderOpen, AlertTriangle, Camera, FileUp } from 'lucide-react';
import trackerApi from './trackerApi';
import { T, jost, serif, IS, IShi, STATUS_META, fmt, ACCEPT_DOCS } from './shared';

// ── Status & progress ─────────────────────────────────────────────────────────
export function Badge({ status }) {
  const m = STATUS_META[status] || { label: status, color: T.muted };
  return (
    <span style={{ color: m.color, border: `1px solid ${m.color}55`, padding: '2px 10px', fontSize: 9, fontFamily: jost, letterSpacing: '0.18em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  );
}

export function ProgressBar({ paid, total, height = 6 }) {
  const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
  // Rounded so float drift (99.9999…) still reads as complete.
  const pctRounded = Math.round(pct);
  const color = pctRounded >= 100 ? '#10b981' : pctRounded > 0 ? '#3b82f6' : '#e5e7eb';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height, borderRadius: 99, background: '#e5e7eb', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.5s ease' }} />
      </div>
      <span style={{ fontSize: 11, color: '#6b7280', minWidth: 34 }}>{pctRounded}%</span>
    </div>
  );
}

export function SummaryRow({ total, paid, due }) {
  return (
    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
      {[['Total', fmt(total), '#0f172a'], ['Paid', fmt(paid), '#10b981'], ['Due', fmt(due), '#ef4444']].map(([l, v, c]) => (
        <div key={l} style={{ padding: '7px 10px', background: '#f8fafc', borderRadius: 8 }}>
          <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>{l}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: c }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────
/** Dialog on desktop; full-screen sheet when `fullScreen` (mobile). */
export function Modal({ title, onClose, children, wide, extraWide, fullScreen, footer }) {
  useEffect(() => {
    const handler = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const box = fullScreen
    ? { width: '100%', height: '100dvh', maxHeight: '100dvh', borderRadius: 0 }
    : { width: '100%', maxWidth: extraWide ? 1100 : wide ? 800 : 580, maxHeight: '90vh' };

  return (
    <div
      role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, background: 'rgba(14,21,32,0.75)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: fullScreen ? 0 : 24 }}
      onClick={(e) => !fullScreen && e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: '#fff', border: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', ...box }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: fullScreen ? '16px 18px 12px' : '28px 32px 20px', borderBottom: `1px solid ${T.border}`, background: '#fff', flexShrink: 0 }}>
          <div>
            <p style={{ fontFamily: jost, fontSize: 9, letterSpacing: '0.28em', textTransform: 'uppercase', color: T.muted, margin: '0 0 6px' }}>Payment Tracker</p>
            <h2 style={{ fontFamily: serif, fontSize: fullScreen ? 22 : 26, fontWeight: 300, color: T.navy, margin: 0 }}>{title}</h2>
          </div>
          <button aria-label="Close" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, fontSize: 20, lineHeight: 1, padding: 4 }}>✕</button>
        </div>
        <div style={{ padding: fullScreen ? '16px 18px' : '28px 32px', overflowY: 'auto', flex: 1 }}>{children}</div>
        {footer && (
          <div style={{ padding: fullScreen ? '12px 18px calc(12px + env(safe-area-inset-bottom))' : '16px 32px', borderTop: `1px solid ${T.border}`, background: '#fff', flexShrink: 0 }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

export function Field({ label, required, hint, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', fontFamily: jost, fontSize: 9, letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted, marginBottom: 8 }}>
        {label}
        {required && <span style={{ color: T.red }}> *</span>}
        {hint && <span style={{ textTransform: 'none', color: T.gold, marginLeft: 6, letterSpacing: 0 }}>{hint}</span>}
      </label>
      {children}
    </div>
  );
}

/** Responsive field grid: `cols` columns on desktop, one column on phones. */
export function Row({ cols = 2, compact, children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : `repeat(${cols}, 1fr)`, gap: '0 16px' }}>{children}</div>;
}

// ── Banners ───────────────────────────────────────────────────────────────────
const banner = (bg, color) => ({ padding: '10px 14px', marginBottom: 18, fontSize: 12, fontFamily: jost, background: bg, color, borderLeft: `3px solid ${color}` });

export function ErrBox({ msg }) {
  return msg ? <div role="alert" style={banner('#fef2f2', T.red)}>{msg}</div> : null;
}

export function WarnBox({ msg }) {
  return msg ? <div role="status" style={banner('#fffbeb', '#b45309')}>{msg}</div> : null;
}

export function AutoFillBanner({ count }) {
  if (!count) return null;
  return <div style={{ ...banner(T.dimBg, T.gold), borderLeftColor: T.gold }}>◈ {count} field{count > 1 ? 's' : ''} filled from the document — please verify before saving.</div>;
}

/** Only problems are shown here — a successful read is shown by AutoFillBanner. */
export function ScanBanner({ result, msg }) {
  if (!result || result === 'success') return null;
  const color = { success: T.green, partial: T.gold, error: T.red }[result];
  const bg = { success: '#f0fdf4', partial: T.dimBg, error: '#fef2f2' }[result];
  const icon = { success: '✓', partial: '⚠', error: '✕' }[result];
  return <div style={{ ...banner(bg, color), marginTop: 8, marginBottom: 0 }}>{icon} {msg}</div>;
}

export function DuplicateOverlay({ info, onRetry, onClose }) {
  if (!info) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '32px 28px', maxWidth: 420, width: '100%', textAlign: 'center', boxShadow: '0 25px 60px rgba(0,0,0,0.22)' }}>
        <div style={{ width: 60, height: 60, borderRadius: 16, background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <AlertTriangle size={30} color="#f59e0b" />
        </div>
        <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{info.title}</h3>
        <p style={{ margin: '0 0 6px', fontSize: 14, color: '#475569', lineHeight: 1.6 }}>{info.body}</p>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: '#94a3b8' }}>{info.sub}</p>
        <div style={{ display: 'flex', gap: 10 }}>
          {onRetry && <button onClick={onRetry} style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>{info.retryLabel || 'Edit'}</button>}
          <button onClick={onClose} style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function Spinner({ size = 28, color = T.gold }) {
  return <div style={{ width: size, height: size, border: `2px solid ${T.border}`, borderTop: `2px solid ${color}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />;
}

// ── Documents ─────────────────────────────────────────────────────────────────
/** Loads a proxied document once and revokes the object URL on unmount. */
function useDocumentBlob(url, mimeType, { eager = false } = {}) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const urlRef = useRef(null);

  const load = async () => {
    if (urlRef.current) return urlRef.current;
    if (!url) return null;
    if (url.startsWith('data:')) { setBlobUrl(url); return url; }
    setLoading(true); setError(null);
    try {
      const res = await trackerApi.fetchDocument(url);
      const obj = URL.createObjectURL(new Blob([res.data], { type: res.headers['content-type'] || mimeType || 'application/octet-stream' }));
      urlRef.current = obj;
      setBlobUrl(obj);
      return obj;
    } catch (e) {
      setError(e?.response?.status === 404 ? 'File not found.' : 'Could not load the document.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (eager) load();
    return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; };
  }, [url]);

  return { blobUrl, loading, error, load };
}

const isPdfDoc = (url, mimeType) => mimeType === 'application/pdf' || /\.pdf(\?|$)/i.test(url || '') || (url || '').startsWith('data:application/pdf');

export function DocLink({ url, mimeType, label = 'View', style: extraStyle }) {
  const [lightbox, setLightbox] = useState(false);
  const { blobUrl, loading, error, load } = useDocumentBlob(url, mimeType);
  if (!url) return null;

  const isPdf = isPdfDoc(url, mimeType);
  const isImage = !isPdf && (url.startsWith('data:') || mimeType?.startsWith('image/'));
  const style = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 6, background: '#eff6ff', color: '#1d4ed8', fontWeight: 700, fontSize: 11, cursor: 'pointer', border: 'none', fontFamily: jost, opacity: loading ? 0.6 : 1, ...(extraStyle || {}) };

  if (isImage) {
    return (
      <>
        <button onClick={async (e) => { e.stopPropagation(); await load(); setLightbox(true); }} disabled={loading} style={style}>
          {loading ? '…' : <><ImageIcon size={11} /> {label}</>}
        </button>
        {lightbox && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={(e) => { e.stopPropagation(); setLightbox(false); }}>
            <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
              {error ? <div style={{ color: '#fff', fontSize: 14, padding: 20 }}>{error}</div>
                : blobUrl ? <img src={blobUrl} alt="Document" style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain', borderRadius: 8 }} />
                  : <div style={{ color: '#fff', fontSize: 14, padding: 20 }}>Loading…</div>}
              <button aria-label="Close" onClick={() => setLightbox(false)} style={{ position: 'absolute', top: -12, right: -12, background: '#fff', border: 'none', borderRadius: '50%', width: 30, height: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={15} />
              </button>
              {blobUrl && (
                <a href={blobUrl} download="document" style={{ position: 'absolute', bottom: -40, left: '50%', transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 20, padding: '5px 14px', fontSize: 11, fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Download size={11} /> Download
                </a>
              )}
            </div>
          </div>
        )}
      </>
    );
  }

  const icon = isPdf ? <FileText size={11} /> : /onedrive|sharepoint|1drv\.ms/i.test(url) ? <FolderOpen size={11} /> : <Eye size={11} />;
  if (!url.startsWith('/api/')) return <a href={url} target="_blank" rel="noreferrer" style={style}>{icon} {label}</a>;
  return (
    <button disabled={loading} style={style} onClick={async (e) => { e.stopPropagation(); const b = await load(); if (b) window.open(b, '_blank', 'noopener'); }}>
      {loading ? '…' : <>{icon} {label}</>}
    </button>
  );
}

export function BlobPreview({ url, mimeType }) {
  const { blobUrl, loading, error } = useDocumentBlob(url, mimeType, { eager: true });
  return (
    <div style={{ background: '#f1f5f9', borderRadius: 16, overflow: 'hidden', minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {!url ? (
        <div style={{ textAlign: 'center', color: '#94a3b8' }}><div style={{ fontSize: 40, marginBottom: 8 }}>📄</div><div style={{ fontSize: 13, fontWeight: 600 }}>No document attached</div></div>
      ) : loading || (!blobUrl && !error) ? (
        <div style={{ textAlign: 'center', color: '#94a3b8' }}><Spinner color="#6366f1" /><div style={{ fontSize: 12, marginTop: 10 }}>Loading document…</div></div>
      ) : error ? (
        <div style={{ textAlign: 'center', color: '#ef4444', fontSize: 13, padding: 20 }}>⚠ {error}</div>
      ) : isPdfDoc(url, mimeType) ? (
        <iframe src={blobUrl} style={{ width: '100%', height: 500, border: 'none' }} title="PDF" />
      ) : (
        <div style={{ overflowY: 'auto', maxHeight: 600, width: '100%' }}><img src={blobUrl} style={{ width: '100%' }} alt="Invoice" /></div>
      )}
    </div>
  );
}

// ── Pickers ───────────────────────────────────────────────────────────────────
/**
 * Searchable dropdown — every picker in the tracker uses this, so each one has
 * the same search icon, keyboard behaviour and "type to filter" matching.
 *
 * @param {Array<{ value: string, label: string, sub?: string, keywords?: string }>} options
 */
export function SearchSelect({ options, value, onChange, highlighted, placeholder = 'Search…', clearable = true, emptyText = 'No matches', compact }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef();
  const inputRef = useRef();
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? options.filter((o) => `${o.label} ${o.sub || ''} ${o.keywords || ''}`.toLowerCase().includes(s)) : options;
    return list.slice(0, 200);
  }, [options, q]);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => { setActive(0); }, [q, open]);

  const choose = (o) => { onChange(o.value); setOpen(false); setQ(''); inputRef.current?.blur(); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && open && filtered[active]) { e.preventDefault(); choose(filtered[active]); }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); setQ(''); } // close the list, not the dialog
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{ ...IShi(highlighted), display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', ...(compact ? { fontSize: 12 } : {}) }}>
        <Search size={14} color="#94a3b8" style={{ flexShrink: 0 }} aria-hidden="true" />
        <input
          ref={inputRef}
          role="combobox" aria-expanded={open} aria-autocomplete="list"
          value={selected && !open ? selected.label : q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={selected ? selected.label : placeholder}
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', padding: compact ? '7px 0' : '9px 0', fontSize: compact ? 12 : 14, background: 'transparent', color: '#0f172a', fontFamily: 'inherit' }}
        />
        {value && clearable
          ? <span role="button" aria-label="Clear selection" onClick={(e) => { e.stopPropagation(); onChange(''); setQ(''); inputRef.current?.focus(); }} style={{ cursor: 'pointer', color: '#94a3b8', display: 'flex' }}><X size={13} /></span>
          : <span aria-hidden="true" style={{ color: '#94a3b8', fontSize: 11 }}>{open ? '▲' : '▼'}</span>}
      </div>
      {open && (
        <div role="listbox" style={{ position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, minWidth: 200, background: '#fff', border: '1.5px solid #3b82f6', borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.15)', zIndex: 500, maxHeight: 260, overflowY: 'auto' }}>
          {filtered.length === 0 && <div style={{ padding: '12px 14px', color: '#94a3b8', fontSize: 13 }}>{q ? `${emptyText} for "${q}"` : emptyText}</div>}
          {filtered.map((o, i) => (
            <div key={o.value || '__none'} role="option" aria-selected={o.value === value}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(o)}
              style={{ padding: '9px 14px', cursor: 'pointer', background: i === active ? '#f1f5f9' : o.value === value ? '#eff6ff' : '#fff', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ fontWeight: o.value === value ? 700 : 500, fontSize: 13, color: o.value === value ? '#1d4ed8' : '#0f172a' }}>{o.label}</div>
              {o.sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{o.sub}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function VendorSelect({ vendors, value, onChange, highlighted, placeholder = 'Search & select vendor…', compact }) {
  const options = useMemo(() => vendors.map((v) => ({ value: v._id, label: v.companyName, sub: v.gstNumber ? `GST: ${v.gstNumber}` : '', keywords: v.gstNumber })), [vendors]);
  return <SearchSelect options={options} value={value} onChange={onChange} highlighted={highlighted} placeholder={placeholder} emptyText="No vendors match" compact={compact} />;
}

export function SearchableList({ items, search, onSearch, selectedId, onSelect, emptyMsg, renderRow, placeholder }) {
  return (
    <>
      <div style={{ position: 'relative', marginBottom: 6 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
        <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} style={{ ...IS, paddingLeft: 32, fontSize: 13 }} />
        {search && (
          <button aria-label="Clear search" onClick={() => onSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex' }}>
            <X size={13} />
          </button>
        )}
      </div>
      <div style={{ border: '1.5px solid #e2e8f0', borderRadius: 8, maxHeight: 220, overflowY: 'auto' }}>
        {items.length === 0
          ? <div style={{ padding: '14px 12px', color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>{emptyMsg}</div>
          : items.map((item) => {
            const sel = item._id === selectedId;
            return (
              <div key={item._id} onClick={() => onSelect(item)}
                style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', background: sel ? '#eff6ff' : '#fff', borderLeft: sel ? '3px solid #3b82f6' : '3px solid transparent' }}>
                {renderRow(item, sel)}
              </div>
            );
          })}
      </div>
    </>
  );
}

/** Row renderer shared by every PI / invoice picker. */
export function DueRow({ title, subtitle, due, total, selected, accent = '#1d4ed8' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: selected ? accent : '#0f172a' }}>{title}</div>
        <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#ef4444' }}>Due: {fmt(due)}</div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>of {fmt(total)}</div>
      </div>
    </div>
  );
}

// ── Upload zone ───────────────────────────────────────────────────────────────
/**
 * Drag & drop, paste (Ctrl+V), browse — and on phones a direct camera button.
 * The paste listener reads the latest onFile through a ref, so it never acts
 * on a stale form.
 */
export function UploadZone({ label, hint, accept = ACCEPT_DOCS, onFile, onFiles, file, previewUrl, onClear, scanning, compact, children }) {
  const [drag, setDrag] = useState(false);
  const browseRef = useRef();
  const cameraRef = useRef();
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;

  useEffect(() => {
    const h = (e) => {
      const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/') || i.type === 'application/pdf');
      if (item) onFileRef.current(item.getAsFile());
    };
    window.addEventListener('paste', h);
    return () => window.removeEventListener('paste', h);
  }, []);

  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  // Several files at once → bulk mode (when the parent supports it).
  const take = (list) => {
    const files = Array.from(list || []);
    if (files.length > 1 && onFilesRef.current) onFilesRef.current(files);
    else if (files[0]) onFileRef.current(files[0]);
  };
  const pick = (e) => { const files = e.target.files; take(files); e.target.value = ''; };

  return (
    <div style={{ marginBottom: 20 }}>
      {label && (
        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {label}{hint && <span style={{ fontWeight: 400, textTransform: 'none', color: '#94a3b8', marginLeft: 6 }}>{hint}</span>}
        </label>
      )}
      <input ref={browseRef} type="file" accept={accept} multiple={!!onFiles} style={{ display: 'none' }} onChange={pick} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={pick} />
      {!file ? (
        compact ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button type="button" onClick={() => cameraRef.current?.click()} style={zoneBtn('#0f172a')}><Camera size={18} /> Take photo</button>
            <button type="button" onClick={() => browseRef.current?.click()} style={zoneBtn('#6366f1')}><FileUp size={18} /> PDF / image</button>
          </div>
        ) : (
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files); }}
            onClick={() => browseRef.current?.click()}
            style={{ border: `2px dashed ${drag ? '#3b82f6' : '#cbd5e1'}`, borderRadius: 12, padding: '26px 20px', textAlign: 'center', background: drag ? '#eff6ff' : '#f8fafc', cursor: 'pointer', transition: 'all 0.2s' }}
          >
            <div style={{ fontSize: 28, marginBottom: 6 }}>📎</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 3 }}>Drop a file, paste (Ctrl+V) or click to browse</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>PDF, JPG, PNG or WEBP · fields are read automatically{onFiles ? ' · select several files to upload in bulk' : ''}</div>
          </div>
        )
      ) : (
        <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1.5px solid #e2e8f0', background: '#f8fafc' }}>
          {previewUrl
            ? <img src={previewUrl} alt="upload preview" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }} />
            : <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ fontSize: 32 }}>📄</span><div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name || 'Document'}</div><div style={{ fontSize: 12, color: '#94a3b8' }}>{(file.size / 1024).toFixed(0)} KB</div></div></div>}
          {scanning && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.72)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <div style={{ width: 28, height: 28, border: '3px solid rgba(255,255,255,0.2)', borderTop: '3px solid #fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>Reading document…</span>
            </div>
          )}
          <button type="button" aria-label="Remove file" onClick={onClear} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff', borderRadius: '50%', width: 26, height: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={14} />
          </button>
        </div>
      )}
      {children}
    </div>
  );
}

const zoneBtn = (bg) => ({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '16px 10px', borderRadius: 12, border: 'none', background: bg, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' });

export function FormActions({ onCancel, onSubmit, disabled, saving, label, color = '#6366f1', missing = [] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
      {missing.length > 0 && !saving && <span style={{ fontSize: 12, color: '#94a3b8', flex: '1 1 200px' }}>Still needed: {missing.join(', ')}</span>}
      <button type="button" onClick={onCancel} style={{ padding: '10px 20px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#64748b', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
      <button type="button" onClick={onSubmit} disabled={disabled} style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: disabled ? '#e2e8f0' : color, color: disabled ? '#94a3b8' : '#fff', fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 14 }}>
        {saving ? 'Saving…' : label}
      </button>
    </div>
  );
}
