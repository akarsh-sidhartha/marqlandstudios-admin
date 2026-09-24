/**
 * components/CatalogueBuilder.js   (route: /builder)
 *
 *   /builder?id=<catalogueId>  — open a saved catalogue (Saved Catalogues, or
 *                                "Open" after Add to Existing on Products)
 *   /builder                   — new catalogue from the products selected on
 *                                the Products page "Build New" (handed over
 *                                through localStorage 'catalogue_selection'),
 *                                else this tab's unsaved draft, else empty
 *
 * The catalogue being edited lives in component state + the URL, never in
 * shared localStorage, so two tabs with different catalogues can't overwrite
 * each other. An unsaved new catalogue is kept in sessionStorage so a refresh
 * doesn't lose it.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Trash2, Download, ChevronLeft, Upload, GripVertical, Save, Loader2, Package } from 'lucide-react';
import api, { API_ROOT } from '../api';
import { usePopup } from './AppPopups';

// ═════════════════════════════════════════════════════════════════════════════
// CATALOGUE PAGES + PDF
// Also used by SavedCatalogues (Download PDF straight from the list):
//   CatalogueStyles / CataloguePages — the A4 catalogue layout
//   toBuilderItem                     — saved/product item → page item
//   generateCataloguePdf(el, name)    — capture the .a4-page nodes in el into a PDF
//   downloadCataloguePdf(catalogue)   — render a saved catalogue off-screen and download it
// ═════════════════════════════════════════════════════════════════════════════

const PDF_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];

const loadScript = (src) => new Promise((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) return resolve();
  const s = document.createElement('script');
  s.src = src;
  s.async = true;
  s.onload = resolve;
  s.onerror = () => reject(new Error(`Failed to load ${src}`));
  document.body.appendChild(s);
});

/** Start loading the PDF libraries early so the first download is quick. */
export const preloadPdfLibs = () => PDF_LIBS.forEach((src) => loadScript(src).catch(() => {}));

/**
 * Base64 / absolute URLs (R2, OneDrive) are used as is; legacy relative
 * /uploads/ paths are served by the API server (same rule as ProductList).
 */
export const formatImageUrl = (imgStr) => {
  if (!imgStr) return null;
  if (imgStr.startsWith('data:') || imgStr.startsWith('http')) return imgStr;
  return `${API_ROOT}${imgStr.startsWith('/') ? imgStr : `/${imgStr}`}`;
};

/**
 * Backend / ProductList item → page item. Old saved items may have no _id;
 * they get a position-based id so reloading the same catalogue gives the same ids.
 */
export const toBuilderItem = (p, index) => ({
  id:    p._id ? String(p._id) : (p.id ? String(p.id) : `item-${index}`),
  name:  p.name || '',
  desc:  p.desc || p.description || '',
  price: p.price != null ? p.price.toString().replace('₹', '').trim() : '0',
  image: p.imageUrl || p.image || null,   // stored path; resolve with formatImageUrl when displaying
});

export const CatalogueStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,400&family=Montserrat:wght@400;700&display=swap');
    .a4-page { width: 210mm; height: 297mm; background: white; margin: 0 auto 30px; position: relative; box-sizing: border-box; overflow: hidden; }
    .border-wrapper { position: absolute; top: 15mm; left: 15mm; right: 15mm; bottom: 15mm; border: 1px solid #C5A059; pointer-events: none; }
    .content-inner { padding: 20mm 15mm; height: 100%; width: 100%; box-sizing: border-box; }
    /* Full-size, unscaled copy of the pages that html2canvas captures. */
    .catalogue-pdf-root { position: fixed; top: 0; left: -10000px; width: 210mm; z-index: -100; }
    .catalogue-pdf-root .a4-page { margin: 0; box-shadow: none; }
  `}</style>
);

// Descriptions are shown in full. The image shrinks for long descriptions so
// the text fits its quarter page; only extremely long text is shortened.
// (CSS line-clamp is not used: html2canvas renders it clipped mid-line.)
const MAX_DESC_CHARS = 700;
const pdfDescription = (desc = '') => {
  const text = String(desc).trim();
  return text.length > MAX_DESC_CHARS ? `${text.slice(0, MAX_DESC_CHARS).replace(/\s+\S*$/, '')}…` : text;
};
const imageHeight = (desc = '') => {
  const len = String(desc).length;
  if (len > 450) return 110;
  if (len > 250) return 140;
  return 180;
};

/** Cover page, product pages (4 per page), contact page. */
export const CataloguePages = ({ clientName, subtitle, items }) => {
  const pages = [];

  // COVER PAGE
  pages.push(
    <div key="cover" className="a4-page shadow-2xl">
      <div className="border-wrapper">
        <div className="content-inner flex flex-col items-center justify-center h-full text-center">
          <div className="text-[#C5A059] tracking-[0.4em] uppercase text-[10px] font-bold mb-12">By Marqland Studios</div>
          <h1 className="font-serif text-6xl mb-8 leading-tight text-gray-900">{clientName || "Client Name"}</h1>
          <div className="w-16 h-[2px] bg-[#C5A059] mb-8"></div>
          <h2 className="font-serif text-3xl text-gray-400 italic font-light">{subtitle || "Project Catalogue"}</h2>
          <div className="absolute bottom-10 left-0 right-0 text-center text-[10px] text-gray-400 font-bold tracking-[0.4em] uppercase">Celebrate Teams. Delight Clients.</div>
        </div>
      </div>
    </div>
  );

  // PRODUCT PAGES (4 items per page)
  for (let i = 0; i < items.length; i += 4) {
    const pageItems = items.slice(i, i + 4);
    pages.push(
      <div key={`page-${i}`} className="a4-page shadow-2xl">
        <div className="border-wrapper">
          <div className="content-inner h-full flex flex-col !pt-[10mm] !pb-[10mm]">
            <div className="flex justify-between border-b border-[#C5A059] pb-2 mb-4">
              <span className="text-[#C5A059] tracking-[0.3em] uppercase text-[10px] font-bold">Marqland</span>
              <span className="font-serif italic text-gray-400 font-bold text-xs">Page {Math.floor(i/4) + 1}</span>
            </div>
            <div className="grid grid-cols-2 grid-rows-2 gap-x-8 gap-y-8 flex-1">
              {pageItems.map(item => (
                <div key={item.id} className="flex flex-col items-center text-center min-h-0 overflow-hidden">
                  <div className="w-full flex items-center justify-center mb-3 overflow-hidden bg-gray-50/50 rounded-lg" style={{ height: imageHeight(item.desc), flexShrink: 0 }}>
                    {item.image
                      ? <img src={formatImageUrl(item.image)} data-pdf-src={item.image} className="max-h-full max-w-full object-contain mix-blend-multiply" alt="" />
                      : <Package size={40} className="text-gray-200" />}
                  </div>
                  <h4 className="font-serif text-lg font-bold text-gray-900 leading-tight mb-1">{item.name}</h4>
                  <p className="text-gray-500 text-[11px] italic px-2 mb-1 leading-snug" style={{ whiteSpace: 'pre-line' }}>{pdfDescription(item.desc)}</p>
                  <p className="text-[#C5A059] font-sans font-bold text-[12px] tracking-widest">₹{item.price}</p>
                </div>
              ))}
            </div>
            <div className="text-center mt-auto pb-1 border-t border-gray-100 pt-3">
              <span className="text-[9px] text-gray-300 font-bold uppercase tracking-[0.3em]">© Marqland Design Studio</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // CONTACT PAGE
  pages.push(
    <div key="contact" className="a4-page shadow-2xl">
      <div className="border-wrapper">
        <div className="content-inner flex flex-col items-center justify-center h-full text-center px-12">
          <div className="mb-10 text-[#C5A059] font-serif">
            <h3 className="text-2xl mb-2">Connect With Us</h3>
            <h2 className="text-4xl leading-tight">Inquiries & Further Information</h2>
          </div>
          <p className="font-serif text-xl italic text-gray-600 mb-12 leading-relaxed">
            For bespoke inquiries and detailed specifications, our design team is at your disposal.
            We invite you to connect with us to explore how we can elevate your vision.
          </p>
          <div className="space-y-6 mb-16 text-gray-800">
             <p className="text-sm"><span className="text-[#C5A059] block font-bold text-[10px] uppercase tracking-widest mb-1">Email</span><b>info@marqland.com</b></p>
             <p className="text-sm"><span className="text-[#C5A059] block font-bold text-[10px] uppercase tracking-widest mb-1">Phone</span><b>+91 9980069897 | +91 9886521187</b></p>
          </div>
          <div className="border border-[#C5A059] p-2 bg-white inline-block mb-4 shadow-sm">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://www.instagram.com/marqland" alt="QR" className="w-24 h-24" />
          </div>
          <br/><span className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">@marqland</span>
        </div>
      </div>
    </div>
  );
  return <>{pages}</>;
};

const safeFileName = (name) => `${(name || 'Marqland').trim().replace(/[\\/:*?"<>|]+/g, '') || 'Marqland'}_Catalogue.pdf`;

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

// Resolves once the image has loaded or failed (never hangs on a broken image).
const waitForImage = (img) => (img.complete
  ? Promise.resolve()
  : new Promise(res => { img.onload = res; img.onerror = res; }));

/**
 * html2canvas can't draw images from another origin without CORS headers
 * (R2, or the API host when it differs from the admin host), so product
 * images are fetched through the API (/catalogues/image) and embedded as
 * data URLs before capturing. On failure the original image is kept.
 */
const embedProductImages = async (root) => {
  const cache = new Map();
  const imgs = Array.from(root.querySelectorAll('img[data-pdf-src]'))
    .filter(img => !img.getAttribute('data-pdf-src').startsWith('data:'));
  const queue = [...imgs];
  const worker = async () => {
    while (queue.length) {
      const img = queue.shift();
      const src = img.getAttribute('data-pdf-src');
      try {
        if (!cache.has(src)) {
          cache.set(src, api.get('/catalogues/image', { params: { src }, responseType: 'blob', timeout: 30000 })
            .then(res => blobToDataUrl(res.data)));
        }
        img.src = await cache.get(src);
        await img.decode().catch(() => {});
      } catch (err) {
        console.warn('Catalogue PDF: could not embed image', src, err?.message);
      }
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
};

/** Capture every .a4-page inside `root` and save them as one A4 PDF. */
export const generateCataloguePdf = async (root, name) => {
  await Promise.all(PDF_LIBS.map(loadScript));
  if (document.fonts?.ready) await document.fonts.ready;
  await embedProductImages(root);
  await Promise.all(Array.from(root.querySelectorAll('img')).map(waitForImage));

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pages = root.querySelectorAll('.a4-page');
  for (let i = 0; i < pages.length; i++) {
    const canvas = await window.html2canvas(pages[i], {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });
    if (i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
  }
  pdf.save(safeFileName(name));
};

/**
 * Download a saved catalogue ({ name, subtitle, items }) without opening the
 * builder: render its pages off-screen, capture them, then clean up.
 */
export const downloadCataloguePdf = async (catalogue) => {
  const host = document.createElement('div');
  host.className = 'catalogue-pdf-root';
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(
      <>
        <CatalogueStyles />
        <CataloguePages
          clientName={catalogue.name}
          subtitle={catalogue.subtitle}
          items={(catalogue.items || []).map(toBuilderItem)}
        />
      </>
    );
    // Let React commit the pages before capturing them.
    await new Promise(res => requestAnimationFrame(() => setTimeout(res, 50)));
    await generateCataloguePdf(host, catalogue.name);
  } finally {
    root.unmount();
    host.remove();
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// BUILDER
// ═════════════════════════════════════════════════════════════════════════════

const SELECTION_KEY = 'catalogue_selection';      // written by ProductList "Build New"
const DRAFT_KEY     = 'catalogue_builder_draft';  // sessionStorage, per tab

const newKey = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Builder item → backend item. */
const toApiItem = (item) => ({
  _id:         String(item.id),
  name:        item.name,
  description: item.desc || '',
  price:       item.price,
  imageUrl:    item.image || '',
});

const readJson = (storage, key) => {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const CatalogueBuilder = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast, confirm, Toast, ConfirmDialog } = usePopup();
  const catalogueId = searchParams.get('id');

  const [clientName, setClientName] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [items, setItems] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);   // version of the saved catalogue we loaded
  const [customProduct, setCustomProduct] = useState({ name: '', desc: '', price: '', image: null });
  const [draggedItemIndex, setDraggedItemIndex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [hydrated, setHydrated] = useState(false);    // new/draft state restored; safe to write the draft
  const printRef = useRef(null);
  const loadedIdRef = useRef(null);
  const baseIdsRef = useRef(new Set());               // item ids in the last loaded/saved version

  // Preload the PDF libraries so the first download is quick.
  useEffect(() => {
    preloadPdfLibs();
  }, []);

  // ── Load ────────────────────────────────────────────────────────────────────
  const loadCatalogue = useCallback(async (id) => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get(`/catalogues/${id}`);
      setClientName(data.name || '');
      setSubtitle(data.subtitle || '');
      const loaded = (data.items || []).map(toBuilderItem);
      setItems(loaded);
      baseIdsRef.current = new Set(loaded.map(i => i.id));
      setUpdatedAt(data.updatedAt || null);
      setDirty(false);
      loadedIdRef.current = id;
    } catch (err) {
      setLoadError(err.response?.status === 404
        ? 'This catalogue no longer exists.'
        : 'Could not load the catalogue. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Older Saved Catalogues page (Edit button) hands the catalogue over via
    // localStorage 'current_catalogue_id' — load it by id instead.
    const legacyId = localStorage.getItem('current_catalogue_id');
    if (!catalogueId && legacyId && legacyId !== 'undefined' && !localStorage.getItem(SELECTION_KEY)) {
      localStorage.removeItem('current_catalogue_id');
      setSearchParams({ id: legacyId }, { replace: true });
      return;
    }

    // Old builder kept the open catalogue in shared localStorage; drop it.
    ['current_catalogue_id', 'current_catalogue_name', 'current_catalogue_subtitle', 'current_catalogue_items']
      .forEach((k) => localStorage.removeItem(k));

    if (catalogueId) {
      // Skip the reload when the id was just set by our own first save.
      if (loadedIdRef.current !== catalogueId) loadCatalogue(catalogueId);
      return;
    }

    // A fresh selection from the Products page becomes this tab's draft
    // straight away, so it survives a refresh (and React's dev double-mount).
    const selection = readJson(localStorage, SELECTION_KEY);
    localStorage.removeItem(SELECTION_KEY);
    let draft = readJson(sessionStorage, DRAFT_KEY) || {};
    if (Array.isArray(selection) && selection.length) {
      draft = { clientName: '', subtitle: '', items: selection.map(toBuilderItem) };
      try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* quota */ }
    }

    const draftItems = Array.isArray(draft.items) ? draft.items : [];
    setClientName(draft.clientName || '');
    setSubtitle(draft.subtitle || '');
    setItems(draftItems);
    setDirty(draftItems.length > 0);
    setHydrated(true);
  }, [catalogueId, loadCatalogue, setSearchParams]);

  // Keep an unsaved new catalogue across refreshes (this tab only).
  useEffect(() => {
    if (catalogueId || !hydrated) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ clientName, subtitle, items }));
    } catch {
      // Quota exceeded (large custom images) — the draft just won't survive a refresh.
    }
  }, [catalogueId, hydrated, clientName, subtitle, items]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // ── Edits ───────────────────────────────────────────────────────────────────
  const updateItems = (next) => { setItems(next); setDirty(true); };

  const handlePriceChange = (id, newPrice) => {
    updateItems(items.map(item => (item.id === id ? { ...item, price: newPrice } : item)));
  };

  const onDragStart = (index) => setDraggedItemIndex(index);

  const onDragOver = (e, index) => {
    e.preventDefault();
    if (draggedItemIndex === null || draggedItemIndex === index) return;
    const newItems = [...items];
    const draggedItem = newItems[draggedItemIndex];
    newItems.splice(draggedItemIndex, 1);
    newItems.splice(index, 0, draggedItem);
    setDraggedItemIndex(index);
    updateItems(newItems);
  };

  const onDragEnd = () => setDraggedItemIndex(null);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setCustomProduct(prev => ({ ...prev, image: reader.result }));
      reader.readAsDataURL(file);
    }
  };

  const addManualProduct = () => {
    if (!customProduct.name || !customProduct.price) return showToast('error', 'Enter name and price');
    updateItems([...items, { id: newKey('custom'), ...customProduct }]);
    setCustomProduct({ name: '', desc: '', price: '', image: null });
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const saveCatalogue = async (itemsToSave = items, expectedUpdatedAt = updatedAt) => {
    const name = clientName.trim();
    if (!name) return showToast('error', 'Enter a client name before saving');

    setSaving(true);
    try {
      const payload = { name, subtitle, items: itemsToSave.map(toApiItem) };
      if (catalogueId) {
        payload.id = catalogueId;
        if (expectedUpdatedAt) payload.expectedUpdatedAt = expectedUpdatedAt;
      }
      const { data } = await api.post('/catalogues', payload);

      setUpdatedAt(data.updatedAt || null);
      setDirty(false);
      baseIdsRef.current = new Set(itemsToSave.map(i => String(i.id)));
      if (!catalogueId && data._id) {
        loadedIdRef.current = data._id;
        sessionStorage.removeItem(DRAFT_KEY);
        setSearchParams({ id: data._id }, { replace: true });
      }
      showToast('success', 'Catalogue saved');
    } catch (err) {
      if (err.response?.status === 409) return await handleConflict();
      showToast('error', `Save failed: ${err.response?.data?.message || err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Someone changed the catalogue since we opened it (usually products added
  // from the Products page). Keep our edits and append only the items that are
  // new on the server — not ones we removed here.
  const handleConflict = async () => {
    const ok = await confirm({
      title:        'Catalogue changed elsewhere',
      message:      'This catalogue was updated since you opened it (e.g. products added from the Products page). ' +
                    'Keep your changes, add the newly added products to the end, and save?',
      confirmLabel: 'Merge & Save',
      cancelLabel:  'Cancel',
    });
    if (!ok) return;
    try {
      const { data: latest } = await api.get(`/catalogues/${catalogueId}`);
      const have = new Set(items.map(i => String(i.id)));
      const incoming = (latest.items || []).map(toBuilderItem)
        .filter(i => !have.has(i.id) && !baseIdsRef.current.has(i.id));
      const merged = [...items, ...incoming];
      setItems(merged);
      await saveCatalogue(merged, latest.updatedAt);
    } catch (err) {
      showToast('error', `Merge failed: ${err.response?.data?.message || err.message}`);
    }
  };

  // ── PDF ─────────────────────────────────────────────────────────────────────
  const handleDownloadPdf = async () => {
    if (!items.length) return showToast('error', 'Add at least one product first');
    setGenerating(true);
    try {
      await generateCataloguePdf(printRef.current, clientName);
    } catch (err) {
      console.error('PDF generation error:', err);
      showToast('error', 'Could not generate the PDF. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 size={32} className="animate-spin text-[#C5A059]" />
        <p className="mt-4 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Loading catalogue...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-xl mx-auto p-10 text-center">
        <div className="bg-red-50 border border-red-100 rounded-3xl p-8">
          <p className="text-gray-600 text-sm mb-6">{loadError}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => navigate('/savedcatalogues')} className="px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-widest bg-white border border-gray-200 text-gray-500">Saved Catalogues</button>
            <button onClick={() => loadCatalogue(catalogueId)} className="px-6 py-3 rounded-2xl font-black uppercase text-xs tracking-widest bg-indigo-600 text-white">Retry</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-gray-100 min-h-screen">
      <Toast />
      <ConfirmDialog />
      <CatalogueStyles />

      <div id="screen-ui" className="flex h-screen overflow-hidden">
        {/* SIDEBAR PANEL */}
        <div className="w-[420px] bg-white border-r p-6 overflow-y-auto flex flex-col shadow-2xl z-20">
          <div className="flex justify-between items-center mb-6">
            <button onClick={() => navigate('/savedcatalogues')} className="text-[10px] font-bold text-gray-400 flex items-center gap-2 uppercase tracking-tighter hover:text-[#C5A059] transition-colors">
              <ChevronLeft size={14}/> Saved Catalogues
            </button>
            <button
              onClick={() => saveCatalogue()}
              disabled={saving}
              className="flex items-center gap-2 bg-green-50 text-green-700 px-3 py-1.5 rounded-lg font-black text-[10px] uppercase tracking-widest hover:bg-green-600 hover:text-white transition-all shadow-sm disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
              {catalogueId ? (dirty ? 'Save Changes' : 'Saved') : 'Save Catalogue'}
            </button>
          </div>

          <h1 className="font-serif text-2xl text-[#C5A059] text-center mb-8 uppercase tracking-widest">Catalogue Studio</h1>

          <div className="space-y-8 flex-1">
             <div className="space-y-3">
                <label className="text-[9px] font-bold uppercase text-gray-400 tracking-[0.2em]">1. Branding</label>
                <input className="w-full border p-3 rounded text-sm outline-none focus:border-[#C5A059]" placeholder="Client Name" value={clientName} onChange={e => { setClientName(e.target.value); setDirty(true); }} />
                <input className="w-full border p-3 rounded text-sm outline-none focus:border-[#C5A059]" placeholder="Subtitle" value={subtitle} onChange={e => { setSubtitle(e.target.value); setDirty(true); }} />
             </div>

             <div className="space-y-4 border-t pt-6">
                <label className="text-[10px] font-bold uppercase text-[#C5A059] tracking-[0.1em]">2. Add Custom Product</label>
                <input type="file" accept="image/*" id="manual-upload" className="hidden" onChange={handleImageUpload} />
                <label htmlFor="manual-upload" className="cursor-pointer block w-full h-32 border-2 border-dashed border-gray-100 rounded-xl bg-gray-50/50 flex flex-col items-center justify-center gap-2 overflow-hidden">
                    {customProduct.image ? <img src={customProduct.image} className="h-full w-full object-contain p-2" alt="" /> : <Upload size={20} className="text-[#C5A059]" />}
                </label>
                <input className="w-full border p-3 rounded text-sm outline-none" placeholder="Product Name" value={customProduct.name} onChange={e => setCustomProduct({...customProduct, name: e.target.value})} />
                <textarea className="w-full border p-3 rounded text-sm outline-none resize-none h-20" placeholder="Product Description" value={customProduct.desc} onChange={e => setCustomProduct({...customProduct, desc: e.target.value})} />
                <input className="w-full border p-3 rounded text-sm outline-none" placeholder="Price" value={customProduct.price} onChange={e => setCustomProduct({...customProduct, price: e.target.value})} />
                <button onClick={addManualProduct} className="w-full bg-[#1A1A1A] text-white py-3 rounded font-bold text-[10px] uppercase tracking-[0.2em] hover:bg-black transition-colors">Add Product</button>
             </div>

             <div className="space-y-3 border-t pt-6 pb-24">
                <label className="text-[9px] font-bold uppercase text-gray-400 tracking-[0.2em]">3. Manage Items ({items.length})</label>
                {!items.length && (
                  <p className="text-[11px] text-gray-400 italic">
                    No products yet. Select products on the Products page and use Build New or Add to Existing, or add a custom product above.
                  </p>
                )}
                <div className="space-y-2">
                  {items.map((item, index) => (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={() => onDragStart(index)}
                      onDragOver={(e) => onDragOver(e, index)}
                      onDragEnd={onDragEnd}
                      className={`bg-gray-50 p-3 rounded border flex items-center gap-3 cursor-move transition-all ${draggedItemIndex === index ? 'opacity-30 scale-95 shadow-inner' : 'opacity-100 shadow-sm'}`}
                    >
                      <GripVertical size={16} className="text-gray-300" />
                      {item.image
                        ? <img src={formatImageUrl(item.image)} className="w-10 h-10 object-cover rounded bg-white border" alt="" />
                        : <div className="w-10 h-10 rounded bg-white border flex items-center justify-center"><Package size={14} className="text-gray-300" /></div>}
                      <div className="flex-1 overflow-hidden">
                         <p className="text-[10px] font-bold truncate text-gray-700">{item.name}</p>
                         <div className="flex items-center gap-1">
                            <span className="text-[10px] text-[#C5A059] font-bold">₹</span>
                            <input
                              className="w-full bg-transparent border-b border-transparent hover:border-gray-200 focus:border-[#C5A059] text-[10px] text-[#C5A059] font-bold outline-none"
                              value={item.price}
                              onChange={(e) => handlePriceChange(item.id, e.target.value)}
                            />
                         </div>
                      </div>
                      <button onClick={() => updateItems(items.filter(i => i.id !== item.id))} className="text-gray-300 hover:text-red-500 transition-colors">
                        <Trash2 size={16}/>
                      </button>
                    </div>
                  ))}
                </div>
             </div>
          </div>

          <button onClick={handleDownloadPdf} disabled={generating} className="sticky bottom-0 bg-[#C5A059] text-white py-4 rounded font-serif text-xl flex items-center justify-center gap-3 hover:bg-[#b08d4a] transition-all shadow-xl mt-4 z-30 disabled:opacity-70">
            {generating ? <><Loader2 size={22} className="animate-spin"/> Generating PDF...</> : <><Download size={22}/> Download PDF</>}
          </button>
        </div>

        {/* PREVIEW VIEWPORT */}
        <div className="flex-1 overflow-y-auto p-12 bg-gray-300">
            <div className="max-w-[210mm] mx-auto scale-90 origin-top">
              <CataloguePages clientName={clientName} subtitle={subtitle} items={items} />
            </div>
        </div>
      </div>

      {/* OFF-SCREEN PDF SOURCE */}
      <div className="catalogue-pdf-root" ref={printRef} aria-hidden="true">
        <CataloguePages clientName={clientName} subtitle={subtitle} items={items} />
      </div>
    </div>
  );
};

export default CatalogueBuilder;
