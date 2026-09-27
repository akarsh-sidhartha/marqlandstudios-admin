/**
 * src/pages/products/ProductFormModal.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One popup to add OR edit a catalogue product, including all of its media.
 * Replaces the old two-step flow (save product → reopen ProductImageGallery
 * to add angles / video).
 *
 *   Details   brand, category, sub-category, name, description, cost, margin
 *   Images    add several at once; reorder, set primary, remove. Each image
 *             uploads the moment it's picked (parallel, with per-image
 *             progress) so Save only sends a small JSON body.
 *             "Find images online" searches Google Images and imports the
 *             picks as a background job — they drop into the grid when done.
 *   Video     None · YouTube / video link · Upload a file (≤500 MB).
 *             An uploaded file is sent in resumable chunks AFTER the product
 *             is saved, in the background task tray, then pushed to OneDrive:
 *               development|website / products / {Product folder}
 *   Studio AI unchanged behaviour for a newly picked primary image — preview
 *             now, or "process after save" (queued background job).
 *
 * Non-blocking: Save closes the popup as soon as the product record is
 * stored; long work (video upload, OneDrive, AI) continues in the tray.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X, Loader2, AlertCircle, Sparkles, Star, Trash2, ChevronLeft, ChevronRight, Plus,
  Search, Download, Youtube, UploadCloud, Ban, CheckCircle2, ImageIcon, Film, Link2,
} from 'lucide-react';
import api from '../../api';
import v2, { newIdempotencyKey } from '../../lib/apiV2';
import { trackJob } from '../../lib/taskStore';
import { startVideoUpload, validateVideoFile, VIDEO_ACCEPT } from '../../lib/chunkedUpload';
import { createLogger } from '../../utils/logger';
import {
  T, jost, serif, getYouTubeId, CustomCreatableSelect, PromptSelector, FieldLabel, inputStyle,
} from './productUi';

const log = createLogger('ProductFormModal');

const MAX_IMAGES = 20;
const IMAGE_UPLOAD_CONCURRENCY = 3;
const MARGINS = [10, 15, 20, 25, 30, 35, 40, 45, 50];

const calcSellingPrice = (buy, mark) => {
  const price = parseFloat(buy || 0);
  const markup = parseFloat(mark || 0);
  return (price + (price * markup) / 100).toFixed(0);
};

let localSeq = 0;
const localId = () => `img_${Date.now().toString(36)}_${(localSeq += 1)}`;

const emptyForm = { brand: '', category: '', subCategory: '', name: '', description: '', purchasePrice: '', markupPercent: 30 };

// Small promise pool so picking 15 photos doesn't open 15 uploads at once.
const createPool = (limit) => {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || !queue.length) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active -= 1; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
};

const sectionTitle = (icon, text, extra) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
    {icon}
    <span style={{ fontFamily: jost, fontSize: 9, fontWeight: 500, letterSpacing: '0.28em', textTransform: 'uppercase', color: T.navy }}>{text}</span>
    <div style={{ flex: 1, height: 1, background: T.border }} />
    {extra}
  </div>
);

const pillBtn = (active, color = T.gold) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
  border: `1px solid ${active ? color : T.border}`, background: active ? `${color}14` : 'white',
  color: active ? color : T.muted, fontFamily: jost, fontSize: 10, letterSpacing: '0.14em',
  textTransform: 'uppercase', cursor: 'pointer', borderRadius: 2, transition: 'all 0.15s',
});

const ProductFormModal = ({
  productId, meta, savedPrompts = [], onClose, onSaved, onMediaProcessed, onOpenPromptManager, showToast,
}) => {
  const isEditing = Boolean(productId);
  const [loading, setLoading] = useState(isEditing);
  const [loadError, setLoadError] = useState('');
  const [product, setProduct] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveStage, setSaveStage] = useState('');
  const idempotencyKey = useRef(newIdempotencyKey());
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // ── Images ─────────────────────────────────────────────────────────────────
  // { id, key, url, preview, file, status: 'ready'|'uploading'|'error', progress, error, isNew }
  const [images, setImages] = useState([]);
  const uploads = useRef(new Map()); // id -> Promise
  const pool = useRef(createPool(IMAGE_UPLOAD_CONCURRENCY));
  const fileInput = useRef(null);

  const patchImage = (id, patch) => setImages((list) => list.map((img) => (img.id === id ? { ...img, ...patch } : img)));

  const stageFile = useCallback((id, file) => {
    const promise = pool.current(async () => {
      const fd = new FormData();
      fd.append('image', file);
      const { data } = await v2.post('/v2/media/images', fd, {
        timeout: 45_000,
        retries: 2,
        onUploadProgress: (e) => e.total && mounted.current && patchImage(id, { progress: Math.round((e.loaded / e.total) * 100) }),
      });
      return data;
    }).then((data) => {
      if (mounted.current) patchImage(id, { key: data.key, url: data.url, status: 'ready', progress: 100, error: '' });
      return data;
    }).catch((err) => {
      if (mounted.current) patchImage(id, { status: 'error', error: err.message });
      throw err;
    }).finally(() => uploads.current.delete(id));
    uploads.current.set(id, promise);
    promise.catch(() => {}); // handled via status
  }, []);

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    const room = MAX_IMAGES - images.length;
    if (!files.length) return;
    if (files.length > room) showToast?.('warning', `A product can have ${MAX_IMAGES} images — only the first ${Math.max(0, room)} were added.`);
    const added = files.slice(0, Math.max(0, room)).map((file) => ({
      id: localId(), key: '', url: '', preview: URL.createObjectURL(file), file, status: 'uploading', progress: 0, error: '', isNew: true,
    }));
    setImages((list) => [...list, ...added]);
    added.forEach((img) => stageFile(img.id, img.file));
    setErrors((e) => ({ ...e, images: '' }));
  };

  const retryImage = (img) => { patchImage(img.id, { status: 'uploading', progress: 0, error: '' }); stageFile(img.id, img.file); };
  const removeImage = (id) => setImages((list) => list.filter((img) => img.id !== id));
  const moveImage = (id, delta) => setImages((list) => {
    const i = list.findIndex((img) => img.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const makePrimary = (id) => setImages((list) => {
    const img = list.find((x) => x.id === id);
    return img ? [img, ...list.filter((x) => x.id !== id)] : list;
  });

  // Revoke object URLs on unmount.
  const previewsRef = useRef([]);
  previewsRef.current = images.map((i) => i.preview).filter(Boolean);
  useEffect(() => () => previewsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);

  // ── Video ──────────────────────────────────────────────────────────────────
  // mode: 'keep' (edit, unchanged) | 'none' | 'link' | 'upload'
  const [videoMode, setVideoMode] = useState('none');
  const [videoLink, setVideoLink] = useState('');
  const [videoFile, setVideoFile] = useState(null);
  const [videoError, setVideoError] = useState('');

  // ── Studio AI (primary image) ─────────────────────────────────────────────
  const [processImage, setProcessImage] = useState(false);
  const [promptId, setPromptId] = useState('');
  const [promptText, setPromptText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiPreview, setAiPreview] = useState(null);

  // ── Online image search ──────────────────────────────────────────────────
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [searchError, setSearchError] = useState('');
  const [importing, setImporting] = useState(0); // number of running import jobs

  // ── Duplicate warning ────────────────────────────────────────────────────
  const [duplicates, setDuplicates] = useState([]);

  // ── Load product for editing ───────────────────────────────────────────────
  useEffect(() => {
    if (!isEditing) return undefined;
    const controller = new AbortController();
    v2.get(`/v2/products/${productId}`, { signal: controller.signal })
      .then(({ data }) => {
        setProduct(data);
        setForm({
          brand: data.brand || '', category: data.category || '', subCategory: data.subCategory || '',
          name: data.name || '', description: data.description || '',
          purchasePrice: data.purchasePrice ?? '', markupPercent: data.markupPercent || 30,
        });
        const existing = [
          { url: data.imageUrl, key: data.imageKey },
          ...(data.additionalImages || []).map((url, i) => ({ url, key: data.additionalImageKeys?.[i] || '' })),
        ].filter((i) => i.url).map((i) => ({ id: localId(), ...i, preview: '', status: 'ready', progress: 100, error: '', isNew: false }));
        setImages(existing);
        setVideoMode(data.video?.source ? 'keep' : 'none');
        setVideoLink(data.video?.source === 'link' ? data.video.url : '');
        setQuery(`${data.brand || ''} ${data.name || ''}`.trim());
        setLoading(false);
      })
      .catch((err) => { if (err.code !== 'CANCELLED') { setLoadError(err.message); setLoading(false); } });
    return () => controller.abort();
  }, [isEditing, productId]);

  // Debounced server-side "similar product" check (new products only).
  useEffect(() => {
    if (isEditing || form.name.trim().length < 2) { setDuplicates([]); return undefined; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      v2.get('/v2/products/duplicates', {
        params: { name: form.name.trim(), brand: form.brand || undefined, category: form.category || undefined, subCategory: form.subCategory || undefined },
        signal: controller.signal, retries: 0,
      }).then(({ data }) => setDuplicates(data)).catch(() => {});
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [isEditing, form.name, form.brand, form.category, form.subCategory]);

  // Escape closes (unless mid-save).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

  const subCategoryOptions = useMemo(
    () => ((meta.subCategories && form.category && meta.subCategories[form.category]) || []).map((s) => ({ label: s, value: s })),
    [meta.subCategories, form.category]
  );

  const primary = images[0];
  const primaryIsNewFile = Boolean(primary?.isNew && primary?.file);

  // ── Studio AI preview (existing endpoint) ─────────────────────────────────
  const generateStudio = async () => {
    if (!primaryIsNewFile) return;
    setAiBusy(true); setAiError(''); setAiPreview(null);
    try {
      const fd = new FormData();
      fd.append('image', primary.file);
      if (promptId) fd.append('promptId', promptId);
      if (promptText) fd.append('promptText', promptText);
      if (form.category) fd.append('category', form.category);
      const res = await api.post('/image-processing/preview', fd, { timeout: 120_000 });
      if (mounted.current) setAiPreview(res.data.imageDataUrl);
    } catch (err) {
      if (mounted.current) setAiError(err.response?.data?.message || err.message || 'AI processing failed');
    } finally {
      if (mounted.current) setAiBusy(false);
    }
  };

  // Use the AI version as the primary image: stage it like any picked file.
  const useAiPreview = async () => {
    const blob = await fetch(aiPreview).then((r) => r.blob());
    const file = new File([blob], 'studio-processed.webp', { type: 'image/webp' });
    const img = { id: localId(), key: '', url: '', preview: aiPreview, file, status: 'uploading', progress: 0, error: '', isNew: true, isAi: true };
    setImages((list) => [img, ...list]);
    stageFile(img.id, file);
    setAiPreview(null);
    setProcessImage(false);
  };

  // ── Online image search + import job ─────────────────────────────────────
  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true); setSearchError(''); setResults([]); setPicked(new Set());
    try {
      const { data } = await v2.post('/v2/media/image-search', { query: query.trim() }, { retries: 1 });
      setResults(data);
      if (!data.length) setSearchError('No images found — try a different search.');
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const importPicked = async () => {
    const urls = [...picked].map((i) => results[i].url);
    if (!urls.length) return;
    try {
      const { data } = await v2.post('/v2/media/image-imports', { urls }, { idempotencyKey: newIdempotencyKey() });
      setImporting((n) => n + 1);
      setPicked(new Set());
      trackJob(data.job, {
        title: `Importing ${urls.length} image${urls.length > 1 ? 's' : ''}${form.name ? ` · ${form.name}` : ''}`,
        onComplete: (result) => {
          if (!mounted.current) return;
          setImporting((n) => Math.max(0, n - 1));
          const saved = result?.saved || [];
          setImages((list) => [
            ...list,
            ...saved.slice(0, Math.max(0, MAX_IMAGES - list.length)).map((s) => ({
              id: localId(), key: s.key, url: s.url, preview: '', status: 'ready', progress: 100, error: '', isNew: true,
            })),
          ]);
          if (result?.failed?.length) showToast?.('warning', `${result.failed.length} image(s) could not be downloaded.`);
        },
        onFailed: () => { if (mounted.current) setImporting((n) => Math.max(0, n - 1)); },
      });
      showToast?.('info', 'Importing images in the background — they will appear here when ready.');
    } catch (err) {
      setSearchError(err.message);
    }
  };

  // ── Validation + save ─────────────────────────────────────────────────────
  const validate = () => {
    const e = {};
    if (!form.brand.trim()) e.brand = 'Brand is required.';
    if (!form.category.trim()) e.category = 'Category is required.';
    if (!form.name.trim()) e.name = 'Name is required.';
    if (form.purchasePrice === '' || Number(form.purchasePrice) < 0) e.purchasePrice = 'Cost price is required.';
    if (!images.length) e.images = 'Add at least one image.';
    if (images.some((i) => i.status === 'error')) e.images = 'Some images failed to upload — retry or remove them.';
    if (videoMode === 'link') {
      const url = videoLink.trim();
      if (!url) e.video = 'Paste a YouTube or video link.';
      else if (!/^https?:\/\//i.test(url) && !/^(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) e.video = 'Enter a full link starting with https://';
    }
    if (videoMode === 'upload') {
      const msg = validateVideoFile(videoFile);
      if (msg) e.video = msg;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const videoPayload = () => {
    if (videoMode === 'keep') return undefined;
    if (videoMode === 'none') return isEditing ? { source: 'none' } : undefined;
    if (videoMode === 'link') {
      const url = videoLink.trim();
      return { source: 'link', url: /^https?:\/\//i.test(url) ? url : `https://${url}` };
    }
    return { source: 'upload' }; // file follows via chunked upload after save
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (uploads.current.size) {
        setSaveStage(`Finishing ${uploads.current.size} image upload${uploads.current.size > 1 ? 's' : ''}…`);
        await Promise.allSettled([...uploads.current.values()]);
      }
      // Re-read the latest image state after uploads settled.
      const latest = await new Promise((resolve) => setImages((list) => { resolve(list); return list; }));
      if (latest.some((i) => i.status !== 'ready')) {
        setErrors((e) => ({ ...e, images: 'Some images failed to upload — retry or remove them.' }));
        return;
      }
      setSaveStage(isEditing ? 'Updating…' : 'Saving…');

      const body = {
        brand: form.brand.trim(),
        category: form.category.trim(),
        subCategory: (form.subCategory || '').trim(),
        name: form.name.trim(),
        description: form.description,
        purchasePrice: Number(form.purchasePrice),
        markupPercent: Number(form.markupPercent),
        images: latest.map((i) => ({ key: i.key || '', url: i.url })),
        processImage: Boolean(processImage && latest[0]?.isNew && !latest[0]?.isAi),
        ...(processImage && promptId ? { promptId } : {}),
        ...(processImage && promptText ? { promptText } : {}),
      };
      const video = videoPayload();
      if (video) body.video = video;

      const { data: saved, meta: resMeta } = isEditing
        ? await v2.patch(`/v2/products/${productId}`, body, { idempotencyKey: idempotencyKey.current })
        : await v2.post('/v2/products', body, { idempotencyKey: idempotencyKey.current });

      // Long-running follow-ups continue in the task tray.
      (resMeta.jobs || []).forEach((job) => trackJob(job, { onComplete: () => onMediaProcessed?.(saved._id) }));
      if (videoMode === 'upload' && videoFile) {
        startVideoUpload({
          file: videoFile,
          purpose: 'product-video',
          targetId: saved._id,
          title: `Video · ${saved.name}`,
          onDone: () => onMediaProcessed?.(saved._id),
        });
      }

      log.info(isEditing ? 'Product updated' : 'Product created', { id: saved._id });
      showToast?.('success', isEditing ? `"${saved.name}" updated` : `"${saved.name}" added to catalogue`);
      onSaved?.(saved, { previous: product });
      onClose();
    } catch (err) {
      log.error('Save product failed', err.message);
      if (err.details?.length) {
        const fieldErrors = {};
        err.details.forEach((d) => { fieldErrors[d.field.split('.')[0]] = d.message; });
        setErrors(fieldErrors);
      }
      showToast?.('error', err.message);
    } finally {
      if (mounted.current) { setSaving(false); setSaveStage(''); }
    }
  };

  const setField = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setErrors((e) => ({ ...e, [key]: '' })); };
  const fieldError = (key) => errors[key] && (
    <p style={{ fontFamily: jost, fontSize: 10, color: T.red, margin: '5px 0 0' }}>{errors[key]}</p>
  );

  const pendingUploads = images.filter((i) => i.status === 'uploading').length;
  const currentVideo = product?.video;
  const youTubeId = videoMode === 'link' ? getYouTubeId(videoLink) : null;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(14,21,32,0.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 110,
    }}>
      <div className="animate-modal-up" style={{
        background: 'white', border: `1px solid ${T.border}`, width: '100%', maxWidth: 760,
        maxHeight: '94vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '26px 32px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
          <div>
            <p style={{ fontFamily: jost, fontSize: 9, letterSpacing: '0.28em', textTransform: 'uppercase', color: T.muted, margin: '0 0 6px' }}>
              {isEditing ? 'Update Record' : 'New Entry'}
            </p>
            <h2 style={{ fontFamily: serif, fontSize: 28, fontWeight: 300, color: T.navy, margin: 0 }}>
              {isEditing ? 'Edit Product' : 'Add Product'}
            </h2>
          </div>
          <button onClick={onClose} disabled={saving} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          {loading ? (
            <div style={{ padding: '60px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, color: T.muted, fontFamily: jost, fontSize: 12 }}>
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading product…
            </div>
          ) : loadError ? (
            <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: jost, fontSize: 12, color: T.red }}>
              <AlertCircle size={18} style={{ display: 'block', margin: '0 auto 8px' }} />{loadError}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>

              {/* ── Details ── */}
              <div>
                {sectionTitle(<ImageIcon size={12} style={{ color: T.gold }} />, 'Details')}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <CustomCreatableSelect label="Brand"
                        options={meta.brands.map((b) => ({ label: b, value: b }))}
                        value={form.brand ? { label: form.brand, value: form.brand } : null}
                        onChange={(v) => setField('brand', v?.value || '')} />
                      {fieldError('brand')}
                    </div>
                    <div>
                      <CustomCreatableSelect label="Category"
                        options={meta.categories.map((c) => ({ label: c, value: c }))}
                        value={form.category ? { label: form.category, value: form.category } : null}
                        onChange={(v) => { setField('category', v?.value || ''); setField('subCategory', ''); }} />
                      {fieldError('category')}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <CustomCreatableSelect label="Sub Category" isDisabled={!form.category}
                      options={subCategoryOptions}
                      value={form.subCategory ? { label: form.subCategory, value: form.subCategory } : null}
                      onChange={(v) => setField('subCategory', v?.value || '')} />
                    <div>
                      <FieldLabel>Name</FieldLabel>
                      <input value={form.name} onChange={(e) => setField('name', e.target.value)} style={inputStyle(false, errors.name ? { borderColor: T.red } : {})} />
                      {fieldError('name')}
                      {duplicates.length > 0 && (
                        <div style={{ marginTop: 6, padding: '8px 10px', background: '#fffbeb', border: '1px solid rgba(217,119,6,0.3)' }}>
                          <span style={{ fontFamily: jost, fontSize: 9, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', color: T.amber, display: 'flex', alignItems: 'center', gap: 5 }}>
                            <AlertCircle size={10} /> Similar product{duplicates.length > 1 ? 's' : ''} already exist{duplicates.length === 1 ? 's' : ''}
                          </span>
                          {duplicates.map((m) => (
                            <span key={m._id} style={{ display: 'block', fontFamily: jost, fontSize: 10, color: T.text, paddingLeft: 15 }}>
                              • {m.brand} — {m.name}{m.subCategory ? <span style={{ color: T.muted }}> ({m.subCategory})</span> : null}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Description</FieldLabel>
                    <textarea rows={3} value={form.description} onChange={(e) => setField('description', e.target.value)} style={{ ...inputStyle(), resize: 'vertical', minHeight: 72 }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 16, alignItems: 'end', background: T.indigoBg, border: '1px solid rgba(79,70,229,0.10)', padding: '16px 18px' }}>
                    <div>
                      <FieldLabel>Cost Price (₹)</FieldLabel>
                      <input type="number" min="0" className="no-spinner" value={form.purchasePrice}
                        onChange={(e) => setField('purchasePrice', e.target.value)} style={inputStyle(false, errors.purchasePrice ? { borderColor: T.red } : {})} />
                      {fieldError('purchasePrice')}
                    </div>
                    <div>
                      <FieldLabel>Margin (%)</FieldLabel>
                      <select value={form.markupPercent} onChange={(e) => setField('markupPercent', parseInt(e.target.value, 10))} style={{ ...inputStyle(), background: 'white' }}>
                        {[...new Set([...MARGINS, Number(form.markupPercent) || 30])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m}%</option>)}
                      </select>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ display: 'block', fontFamily: jost, fontSize: 9, letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted, marginBottom: 2 }}>Selling Price</span>
                      <span style={{ fontFamily: serif, fontSize: 30, fontWeight: 600, color: T.green }}>₹{calcSellingPrice(form.purchasePrice, form.markupPercent)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Images ── */}
              <div>
                {sectionTitle(
                  <ImageIcon size={12} style={{ color: T.gold }} />,
                  `Images (${images.length}/${MAX_IMAGES})`,
                  <button type="button" onClick={() => setShowSearch((s) => !s)} style={{ ...pillBtn(showSearch, T.indigo), padding: '5px 10px', fontSize: 9 }}>
                    <Search size={11} /> Find images online
                  </button>
                )}
                <p style={{ fontFamily: jost, fontSize: 10, color: T.muted, margin: '-4px 0 12px' }}>
                  The first image is the primary image shown everywhere. Use the arrows to reorder or ★ to make an image primary.
                </p>

                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 10 }}
                >
                  {images.map((img, idx) => (
                    <div key={img.id} style={{ position: 'relative', aspectRatio: '1 / 1', border: `${idx === 0 ? 2 : 1}px solid ${idx === 0 ? T.gold : T.border}`, background: T.offwhite, overflow: 'hidden' }}>
                      <img src={img.preview || img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: img.status === 'ready' ? 1 : 0.55 }} />
                      {idx === 0 && (
                        <span style={{ position: 'absolute', top: 5, left: 5, background: T.gold, color: T.navy, fontFamily: jost, fontSize: 7.5, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Star size={8} fill="currentColor" /> Primary
                        </span>
                      )}
                      {img.status === 'uploading' && (
                        <div style={{ position: 'absolute', left: 6, right: 6, bottom: 6, height: 3, background: 'rgba(0,0,0,0.1)' }}>
                          <div style={{ width: `${Math.max(5, img.progress)}%`, height: '100%', background: T.gold, transition: 'width 0.2s' }} />
                        </div>
                      )}
                      {img.status === 'error' && (
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(220,38,38,0.12)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          <AlertCircle size={16} style={{ color: T.red }} />
                          <button type="button" onClick={() => retryImage(img)} style={{ background: 'white', border: `1px solid ${T.red}`, color: T.red, fontFamily: jost, fontSize: 9, padding: '2px 8px', cursor: 'pointer' }}>Retry</button>
                        </div>
                      )}
                      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'space-between', padding: 3, background: 'linear-gradient(to top, rgba(0,0,0,0.55), transparent)' }}>
                        <div style={{ display: 'flex' }}>
                          <button type="button" title="Move left" disabled={idx === 0} onClick={() => moveImage(img.id, -1)} style={iconBtn}><ChevronLeft size={12} /></button>
                          <button type="button" title="Move right" disabled={idx === images.length - 1} onClick={() => moveImage(img.id, 1)} style={iconBtn}><ChevronRight size={12} /></button>
                          {idx !== 0 && <button type="button" title="Make primary" onClick={() => makePrimary(img.id)} style={iconBtn}><Star size={11} /></button>}
                        </div>
                        <button type="button" title="Remove" onClick={() => removeImage(img.id)} style={iconBtn}><Trash2 size={11} /></button>
                      </div>
                    </div>
                  ))}

                  {images.length < MAX_IMAGES && (
                    <button type="button" onClick={() => fileInput.current?.click()} style={{
                      aspectRatio: '1 / 1', border: `1.5px dashed ${errors.images ? T.red : T.borderG}`, background: T.dimBg,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, cursor: 'pointer', color: T.gold,
                    }}>
                      <Plus size={18} />
                      <span style={{ fontFamily: jost, fontSize: 8.5, letterSpacing: '0.18em', textTransform: 'uppercase' }}>Add images</span>
                      <span style={{ fontFamily: jost, fontSize: 8, color: T.muted }}>or drop here</span>
                    </button>
                  )}
                  {importing > 0 && (
                    <div style={{ aspectRatio: '1 / 1', border: `1px dashed ${T.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, color: T.indigo }}>
                      <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                      <span style={{ fontFamily: jost, fontSize: 8.5, textAlign: 'center', padding: '0 6px' }}>Importing…</span>
                    </div>
                  )}
                </div>
                <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                {fieldError('images')}

                {/* Find images online */}
                {showSearch && (
                  <div style={{ marginTop: 14, padding: 14, border: `1px solid ${T.border}`, background: '#fcfcfd' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                        placeholder="e.g. Fantech MK855 mechanical keyboard" style={inputStyle()} />
                      <button type="button" onClick={runSearch} disabled={searching || !query.trim()} style={{ ...pillBtn(true, T.indigo), flexShrink: 0 }}>
                        {searching ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={12} />} Search
                      </button>
                    </div>
                    {searchError && <p style={{ fontFamily: jost, fontSize: 11, color: T.red, margin: '8px 0 0' }}>{searchError}</p>}
                    {results.length > 0 && (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 6, marginTop: 12, maxHeight: 260, overflowY: 'auto' }}>
                          {results.map((r, i) => {
                            const on = picked.has(i);
                            return (
                              <button type="button" key={r.url} title={r.source || r.title}
                                onClick={() => setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                                style={{ position: 'relative', aspectRatio: '1 / 1', padding: 0, border: `2px solid ${on ? T.indigo : 'transparent'}`, cursor: 'pointer', background: T.offwhite, overflow: 'hidden' }}>
                                <img src={r.thumbnail} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                {on && <CheckCircle2 size={14} style={{ position: 'absolute', top: 4, right: 4, color: 'white', background: T.indigo, borderRadius: '50%' }} />}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                          <span style={{ fontFamily: jost, fontSize: 10, color: T.muted }}>{picked.size} selected · imports run in the background</span>
                          <button type="button" onClick={importPicked} disabled={!picked.size} style={{ ...pillBtn(picked.size > 0, T.indigo), opacity: picked.size ? 1 : 0.5 }}>
                            <Download size={12} /> Import {picked.size || ''}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Studio AI — only for a newly picked primary image */}
                {primaryIsNewFile && !primary.isAi && (
                  <div style={{ marginTop: 14, background: T.purpleBg, border: `1px solid ${T.borderG}`, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={processImage} onChange={(e) => { setProcessImage(e.target.checked); setAiPreview(null); setAiError(''); }} style={{ accentColor: T.purple }} />
                      <span style={{ fontFamily: jost, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: T.purple, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Sparkles size={10} /> Studio AI for the primary image (Gemini)
                      </span>
                    </label>
                    {processImage && (
                      <>
                        <PromptSelector prompts={savedPrompts} category={form.category} selectedId={promptId} onSelect={setPromptId}
                          customText={promptText} onCustom={setPromptText} onOpenManager={onOpenPromptManager} />
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button type="button" onClick={generateStudio} disabled={aiBusy} style={{ ...pillBtn(true, T.purple) }}>
                            {aiBusy ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</> : <><Sparkles size={12} /> Preview now</>}
                          </button>
                          <span style={{ fontFamily: jost, fontSize: 10, color: T.purple }}>…or just save — it will be processed in the background.</span>
                        </div>
                        {aiError && <p style={{ fontFamily: jost, fontSize: 11, color: T.red, margin: 0 }}>{aiError}</p>}
                        {aiPreview && (
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                            <img src={aiPreview} alt="AI studio" style={{ width: 110, height: 110, objectFit: 'cover', border: `2px solid ${T.gold}` }} />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              <button type="button" onClick={useAiPreview} style={pillBtn(true)}><CheckCircle2 size={12} /> Use AI version as primary</button>
                              <button type="button" onClick={() => setAiPreview(null)} style={pillBtn(false)}>Discard</button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* ── Video ── */}
              <div>
                {sectionTitle(<Film size={12} style={{ color: T.gold }} />, 'Product Video')}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  {isEditing && currentVideo?.source && (
                    <button type="button" onClick={() => { setVideoMode('keep'); setErrors((e) => ({ ...e, video: '' })); }} style={pillBtn(videoMode === 'keep')}>
                      <CheckCircle2 size={12} /> Keep current
                    </button>
                  )}
                  <button type="button" onClick={() => { setVideoMode('none'); setErrors((e) => ({ ...e, video: '' })); }} style={pillBtn(videoMode === 'none', T.muted)}>
                    <Ban size={12} /> No video
                  </button>
                  <button type="button" onClick={() => setVideoMode('link')} style={pillBtn(videoMode === 'link', T.red)}>
                    <Youtube size={12} /> YouTube / link
                  </button>
                  <button type="button" onClick={() => setVideoMode('upload')} style={pillBtn(videoMode === 'upload', T.indigo)}>
                    <UploadCloud size={12} /> Upload file
                  </button>
                </div>

                {videoMode === 'keep' && currentVideo && (
                  <p style={{ fontFamily: jost, fontSize: 11, color: T.text, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {currentVideo.source === 'upload' ? <Film size={12} style={{ color: T.indigo }} /> : <Link2 size={12} style={{ color: T.red }} />}
                    {currentVideo.source === 'upload' ? `Uploaded file: ${currentVideo.fileName || 'video'}` : currentVideo.url}
                  </p>
                )}
                {currentVideo?.upload?.status === 'processing' && (
                  <p style={{ fontFamily: jost, fontSize: 10, color: T.amber, margin: '6px 0 0', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> A new video ({currentVideo.upload.fileName}) is still being sent to OneDrive.
                  </p>
                )}
                {currentVideo?.upload?.status === 'failed' && (
                  <p style={{ fontFamily: jost, fontSize: 10, color: T.red, margin: '6px 0 0' }}>
                    The last video upload failed: {currentVideo.upload.error}
                  </p>
                )}

                {videoMode === 'link' && (
                  <div>
                    <input value={videoLink} onChange={(e) => { setVideoLink(e.target.value); setErrors((er) => ({ ...er, video: '' })); }}
                      placeholder="https://youtube.com/watch?v=…  ·  youtu.be/…  ·  brand video URL" style={inputStyle()} />
                    {youTubeId && (
                      <div style={{ marginTop: 10, aspectRatio: '16 / 9', maxWidth: 360, background: '#000' }}>
                        <iframe src={`https://www.youtube.com/embed/${youTubeId}?rel=0`} title="Preview" allowFullScreen
                          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" style={{ width: '100%', height: '100%', border: 'none' }} />
                      </div>
                    )}
                  </div>
                )}

                {videoMode === 'upload' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', border: `1.5px dashed ${errors.video ? T.red : T.borderG}`, cursor: 'pointer', background: T.dimBg }}>
                    <UploadCloud size={22} style={{ color: T.indigo, flexShrink: 0 }} />
                    <span style={{ fontFamily: jost, fontSize: 12, color: T.text }}>
                      {videoFile ? `${videoFile.name} · ${(videoFile.size / 1048576).toFixed(1)} MB` : 'Choose a video (MP4, MOV, WEBM · up to 500 MB)'}
                      <span style={{ display: 'block', fontSize: 10, color: T.muted, marginTop: 2 }}>
                        Uploads in the background after you save — saved to OneDrive › products › {form.name || 'product'}.
                      </span>
                    </span>
                    <input type="file" accept={VIDEO_ACCEPT} hidden onChange={(e) => {
                      const f = e.target.files[0] || null;
                      setVideoFile(f);
                      setVideoError(f ? validateVideoFile(f) : '');
                      setErrors((er) => ({ ...er, video: '' }));
                    }} />
                  </label>
                )}
                {(errors.video || videoError) && <p style={{ fontFamily: jost, fontSize: 10, color: T.red, margin: '6px 0 0' }}>{errors.video || videoError}</p>}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 32px', borderTop: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          <span style={{ flex: 1, fontFamily: jost, fontSize: 10, color: T.muted }}>
            {saving ? saveStage : pendingUploads ? `Uploading ${pendingUploads} image${pendingUploads > 1 ? 's' : ''}… you can keep editing.` : ''}
          </span>
          <button onClick={onClose} disabled={saving} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: jost, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: T.muted, padding: '10px 16px' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || loading || Boolean(loadError)} style={{
            background: T.gold, color: T.navy, border: 'none', padding: '12px 32px', fontFamily: jost, fontSize: 10, fontWeight: 500,
            letterSpacing: '0.22em', textTransform: 'uppercase', cursor: saving ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, opacity: saving ? 0.75 : 1,
          }}>
            {saving ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> {isEditing ? 'Updating' : 'Saving'}</> : (isEditing ? 'Update Product' : 'Save Product')}
          </button>
        </div>
      </div>
    </div>
  );
};

const iconBtn = {
  background: 'rgba(0,0,0,0.35)', border: 'none', color: 'white', width: 20, height: 20, marginRight: 2,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, borderRadius: 2,
};

export default ProductFormModal;
