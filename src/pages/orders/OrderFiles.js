/**
 * src/pages/orders/OrderFiles.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Files of one order, as shown in the order popup:
 *
 *   Screenshots — paste (Ctrl/⌘+V anywhere in the popup), drag & drop, or pick
 *                 several at once. Saved into the order's OneDrive folder.
 *   Quote       — the quote document uploaded at Start Project (read-only here).
 *   Attachments — any other file (Excel requirement sheets, PDFs, …).
 *
 * Previews stream through the authenticated /v2/orders/:id/files/:itemId
 * endpoint and are cached, so reopening an order doesn't re-download them.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera, Download, FileSpreadsheet, FileText, ImagePlus, Paperclip, Plus, RefreshCw, X,
} from 'lucide-react';
import ordersApi from './ordersApi';
import {
  T, jost, FieldLabel, IconBtn, Spinner, useFileUrl, forgetFile, isImageFile, isVideoFile, formatBytes,
} from './ui';

const MAX_FILES_PER_UPLOAD = 15;

/** Image files on a clipboard or drop event. */
export const imageFilesFrom = (dataTransfer) =>
  Array.from(dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));

/**
 * Calls onImages(files) when images are pasted anywhere on the page while
 * `enabled`. Runs in the capture phase so it wins over the description box's
 * own paste handler; plain-text pastes are left alone.
 */
export const usePastedImages = (onImages, enabled = true) => {
  const handler = useRef(onImages);
  handler.current = onImages;
  useEffect(() => {
    if (!enabled) return undefined;
    const onPaste = (e) => {
      const images = imageFilesFrom(e.clipboardData);
      if (!images.length) return;
      e.preventDefault();
      e.stopPropagation();
      handler.current(images);
    };
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, [enabled]);
};

const fileIcon = (file, size = 13) => {
  const t = `${file.type || ''} ${file.name || ''}`;
  if (/sheet|excel|\.xlsx?|\.csv/i.test(t)) return <FileSpreadsheet size={size} style={{ color: T.emerald }} />;
  return <FileText size={size} style={{ color: T.muted }} />;
};

// ─────────────────────────────────────────────────────────────────────────────
// Lightbox
// ─────────────────────────────────────────────────────────────────────────────
export const FileLightbox = ({ orderId, file, onClose }) => {
  const { src, loading, error } = useFileUrl(orderId, file);

  // Capture phase + stopPropagation: Escape closes only the lightbox, not the
  // order popup underneath it.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const download = () => {
    if (!src) return;
    const a = document.createElement('a');
    a.href = src; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 500,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <button
        type="button" onClick={onClose} aria-label="Close preview"
        style={{ position: 'absolute', top: 24, right: 24, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.6)' }}
      >
        <X size={28} />
      </button>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 1000, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      >
        {loading ? (
          <div style={{ color: 'rgba(255,255,255,0.5)', fontFamily: jost, fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Spinner size={14} /> Loading…
          </div>
        ) : error || !src ? (
          <div style={{ color: 'rgba(255,255,255,0.5)', fontFamily: jost, fontSize: 12 }}>Could not load this file.</div>
        ) : isImageFile(file) ? (
          <img src={src} alt={file.name} style={{ maxHeight: '80vh', maxWidth: '100%', objectFit: 'contain' }} />
        ) : isVideoFile(file) ? (
          <video src={src} controls autoPlay style={{ maxHeight: '80vh', maxWidth: '100%' }} />
        ) : /pdf/i.test(file.type || file.name) ? (
          <iframe src={src} title={file.name} style={{ width: '100%', height: '80vh', background: 'white', border: 'none' }} />
        ) : (
          <div style={{ color: 'rgba(255,255,255,0.6)', fontFamily: jost, fontSize: 13 }}>No preview for this file type — download it below.</div>
        )}
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 20 }}>
          <span style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: 'rgba(255,255,255,0.65)' }}>{file.name}</span>
          <button
            type="button" onClick={download} disabled={!src}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 20px',
              background: 'rgba(255,255,255,0.12)', color: 'white', border: 'none', cursor: src ? 'pointer' : 'not-allowed',
              fontFamily: jost, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
            }}
          >
            <Download size={13} /> Download
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Tiles
// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail sizes: compact (inside a narrow form) and gallery (the right-hand
// column of the full-screen order view).
const TILE = { compact: { w: 116, h: 88 }, gallery: { w: 220, h: 165 } };

/**
 * One file as a thumbnail tile. Images show their picture; anything else
 * (PDF, Excel…) shows a large file-type icon, so every file is equally easy
 * to spot and open.
 */
const FileTile = ({ orderId, file, onOpen, onDelete, deleting, size = TILE.compact }) => {
  const image = isImageFile(file);
  const { src, loading } = useFileUrl(orderId, file, image);
  const canOpen = Boolean(file.itemId);
  return (
    <div style={{ position: 'relative', width: size.w, flexShrink: 0 }}>
      <button
        type="button" onClick={() => canOpen && onOpen(file)} title={file.name}
        style={{
          width: size.w, height: size.h, padding: 0, border: `1px solid ${T.border}`, background: T.offwhite,
          cursor: canOpen ? 'pointer' : 'default', overflow: 'hidden',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        {image && loading ? (
          <div style={{ width: '100%', height: '100%', background: 'linear-gradient(90deg,#eee 25%,#f5f5f5 50%,#eee 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.2s infinite' }} />
        ) : image && src ? (
          <img src={src} alt={file.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : image ? (
          <Camera size={size.w > 150 ? 32 : 18} style={{ color: T.muted }} />
        ) : (
          <>
            {fileIcon(file, size.w > 150 ? 40 : 22)}
            <span style={{ fontFamily: jost, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: T.muted }}>
              {(file.name?.split('.').pop() || 'file').slice(0, 5)}
            </span>
          </>
        )}
      </button>
      <p style={{ fontFamily: jost, fontSize: size.w > 150 ? 11 : 9, color: T.text, margin: '6px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {file.name}
      </p>
      {file.size ? <p style={{ fontFamily: jost, fontSize: 9, color: T.muted, margin: '2px 0 0' }}>{formatBytes(file.size)}</p> : null}
      {onDelete && canOpen && (
      <button
        type="button" aria-label={`Delete ${file.name}`} title="Delete" disabled={deleting}
        onClick={() => onDelete(file)}
        style={{
          position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%',
          border: 'none', background: 'rgba(14,21,32,0.7)', color: 'white', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {deleting ? <Spinner size={11} /> : <X size={12} />}
      </button>
      )}
    </div>
  );
};

export const FileChip = ({ file, onOpen, onRemove, removing }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
    <button
      type="button" onClick={() => onOpen?.(file)} title={file.name}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', cursor: onOpen ? 'pointer' : 'default',
        background: 'rgba(79,70,229,0.05)', border: '1px solid rgba(79,70,229,0.12)',
        fontFamily: jost, fontSize: 11, color: T.indigo, maxWidth: 240,
      }}
    >
      {isImageFile(file) ? <Camera size={13} style={{ color: T.gold }} /> : fileIcon(file)}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
      {file.size ? <span style={{ color: T.muted, fontSize: 9, whiteSpace: 'nowrap', flexShrink: 0 }}>{formatBytes(file.size)}</span> : null}
    </button>
    {onRemove && (
      <IconBtn title={`Remove ${file.name}`} onClick={() => onRemove(file)} color={T.danger} hover={T.danger} disabled={removing}>
        {removing ? <Spinner size={11} /> : <X size={12} />}
      </IconBtn>
    )}
  </div>
);

const SectionHead = ({ icon: Icon, label, count, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
    <FieldLabel style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
      <Icon size={11} /> {label}{count ? ` (${count})` : ''}
    </FieldLabel>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{children}</div>
  </div>
);

const smallBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', cursor: 'pointer',
  background: 'white', border: `1px solid ${T.borderG}`, color: T.gold,
  fontFamily: jost, fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase',
};

const PickButton = ({ label, icon: Icon, accept, onFiles, disabled }) => (
  <label style={{ ...smallBtn, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
    <Icon size={12} /> {label}
    <input
      type="file" multiple accept={accept} disabled={disabled} style={{ display: 'none' }}
      onChange={(e) => { const files = Array.from(e.target.files || []); e.target.value = ''; if (files.length) onFiles(files); }}
    />
  </label>
);

// ─────────────────────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string}   orderId
 * @param {Array}    initialFiles  — stored metadata from the list (shown until the live listing arrives)
 * @param {Function} showToast     — from usePopup()
 * @param {Function} confirm       — from usePopup()
 * @param {Function} onChange      — (files) => void, so the row's Files column stays current
 */
export default function OrderFiles({ orderId, initialFiles = [], showToast, confirm, onChange, variant = 'compact' }) {
  const gallery = variant === 'gallery';
  const size = gallery ? TILE.gallery : TILE.compact;
  const [files, setFiles] = useState(initialFiles);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(null); // { category, progress }
  const [removing, setRemoving] = useState(null);   // itemId
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null);

  const changed = useRef(onChange);
  changed.current = onChange;
  const commit = useCallback((next) => { setFiles(next); changed.current?.(next); }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { files: live } = await ordersApi.listFiles(orderId);
      commit(live);
    } catch (err) {
      showToast?.('error', `Couldn't load files: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [orderId, commit, showToast]);

  useEffect(() => { refresh(); }, [refresh]);

  const upload = useCallback(async (picked, category) => {
    if (!picked.length || uploading) return;
    const batch = picked.slice(0, MAX_FILES_PER_UPLOAD);
    if (picked.length > MAX_FILES_PER_UPLOAD) showToast?.('warning', `Uploading the first ${MAX_FILES_PER_UPLOAD} files — add the rest afterwards.`);
    setUploading({ category, progress: 0 });
    try {
      const { files: saved, failed } = await ordersApi.uploadFiles(orderId, batch, category, (progress) => setUploading({ category, progress }));
      setFiles((prev) => { const next = [...prev, ...saved]; changed.current?.(next); return next; });
      if (failed.length) showToast?.('warning', `${failed.length} file(s) failed: ${failed.map((f) => f.name).join(', ')}`);
      else showToast?.('success', `${saved.length} ${category === 'screenshot' ? 'screenshot' : 'file'}${saved.length !== 1 ? 's' : ''} saved to the order folder`);
    } catch (err) {
      showToast?.('error', err.message);
    } finally {
      setUploading(null);
    }
  }, [orderId, uploading, showToast]);

  usePastedImages((images) => upload(images, 'screenshot'));

  const remove = async (file) => {
    const ok = await confirm?.({
      title: 'Delete file', message: `"${file.name}" will be removed from the order folder.`, confirmLabel: 'Delete', variant: 'danger',
    });
    if (!ok) return;
    setRemoving(file.itemId);
    try {
      await ordersApi.removeFile(orderId, file.itemId);
      forgetFile(file.itemId);
      setFiles((prev) => { const next = prev.filter((f) => f.itemId !== file.itemId); changed.current?.(next); return next; });
    } catch (err) {
      showToast?.('error', err.message);
    } finally {
      setRemoving(null);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer?.files || []);
    if (!dropped.length) return;
    const images = dropped.filter((f) => f.type.startsWith('image/'));
    const others = dropped.filter((f) => !f.type.startsWith('image/'));
    if (images.length) upload(images, 'screenshot');
    else if (others.length) upload(others, 'attachment');
  };

  const screenshots = files.filter((f) => f.category === 'screenshot');
  const quotes = files.filter((f) => f.category === 'quote');
  const attachments = files.filter((f) => !['screenshot', 'quote'].includes(f.category));
  const busy = Boolean(uploading);

  return (
    <div
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
      onDrop={onDrop}
      style={{
        border: `1px ${dragOver ? 'solid' : 'dashed'} ${dragOver ? T.gold : T.border}`,
        background: dragOver ? T.dimBg : 'transparent', padding: gallery ? '20px 22px' : '16px 18px', transition: 'all 0.15s',
        minHeight: gallery ? '100%' : undefined, boxSizing: 'border-box',
      }}
    >
      {/* Screenshots */}
      <SectionHead icon={Camera} label="Screenshots" count={screenshots.length}>
        {loading && <Spinner size={12} />}
        <IconBtn title="Refresh from OneDrive" onClick={refresh} disabled={loading || busy}><RefreshCw size={12} /></IconBtn>
        <PickButton label="Add screenshots" icon={ImagePlus} accept="image/*" disabled={busy} onFiles={(f) => upload(f, 'screenshot')} />
      </SectionHead>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: gallery ? 18 : 12, marginBottom: 6 }}>
        {screenshots.map((f) => (
          <FileTile key={f.itemId || f.name} size={size} orderId={orderId} file={f} onOpen={setPreview} onDelete={remove} deleting={removing === f.itemId} />
        ))}
        {uploading?.category === 'screenshot' && (
          <div style={{ width: size.w, height: size.h, border: `1px dashed ${T.borderG}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: T.gold, fontFamily: jost, fontSize: 10 }}>
            <Spinner size={16} /> {uploading.progress}%
          </div>
        )}
        {gallery && !screenshots.length && !loading && uploading?.category !== 'screenshot' && (
          <div style={{ width: '100%', padding: '28px 0', textAlign: 'center', fontFamily: jost, fontSize: 12, color: T.muted, background: T.offwhite }}>
            No screenshots yet — paste one with Ctrl/⌘+V.
          </div>
        )}
      </div>
      <p style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted, margin: '0 0 18px' }}>
        Paste with Ctrl/⌘+V, drop images here, or pick several at once. Saved to the inquiry's OneDrive folder.
      </p>

      {/* Quote */}
      {quotes.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <SectionHead icon={FileText} label="Quote" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: gallery ? 18 : 8 }}>
            {quotes.map((f) => (gallery
              ? <FileTile key={f.itemId || f.name} size={size} orderId={orderId} file={f} onOpen={setPreview} />
              : <FileChip key={f.itemId || f.name} file={f} onOpen={f.itemId ? setPreview : null} />))}
          </div>
        </div>
      )}

      {/* Attachments */}
      <SectionHead icon={Paperclip} label="Attachments" count={attachments.length}>
        <PickButton label="Attach files" icon={Plus} disabled={busy} onFiles={(f) => upload(f, 'attachment')} />
      </SectionHead>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: gallery ? 18 : 8, alignItems: gallery ? 'flex-start' : 'center' }}>
        {attachments.map((f) => (gallery
          ? <FileTile key={f.itemId || f.name} size={size} orderId={orderId} file={f} onOpen={setPreview} onDelete={remove} deleting={removing === f.itemId} />
          : <FileChip key={f.itemId || f.name} file={f} onOpen={f.itemId ? setPreview : null} onRemove={f.itemId ? remove : null} removing={removing === f.itemId} />
        ))}
        {!attachments.length && !loading && <span style={{ fontFamily: jost, fontSize: 11, color: T.muted }}>No attachments yet.</span>}
        {uploading?.category === 'attachment' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: jost, fontSize: 11, color: T.gold }}>
            <Spinner size={12} /> Uploading… {uploading.progress}%
          </span>
        )}
      </div>

      {preview && <FileLightbox orderId={orderId} file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
