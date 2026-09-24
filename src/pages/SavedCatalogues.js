/**
 * src/pages/SavedCatalogues.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Saved product catalogues — search, edit in the Catalogue Builder, download
 * the PDF straight from the list, delete.
 *
 * Design language mirrors ProductList.js (navy / gold / off-white, Jost +
 * Cormorant Garamond).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { createLogger } from '../utils/logger';
import { Search, RefreshCw, Trash2, Download, Plus, Pencil, Loader2, BookOpen } from 'lucide-react';
import { usePopup } from '../components/AppPopups';
import { downloadCataloguePdf, preloadPdfLibs } from '../components/CatalogueBuilder';

const log = createLogger('SavedCatalogues');

// ─── Design tokens (mirrors ProductList) ─────────────────────────────────────
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
  red:     '#dc2626',
  green:   '#16a34a',
  amber:   '#d97706',
};

const jost  = '"Jost", sans-serif';
const serif = '"Cormorant Garamond", Georgia, serif';

/** Small uppercase label (eyebrow) style. */
const eyebrow = (color = T.muted) => ({
  fontFamily: jost, fontSize: 9, fontWeight: 400,
  letterSpacing: '0.28em', textTransform: 'uppercase', color,
});

/** Gold primary button (matches "Add Product" / "Build New"). */
const goldButton = (disabled = false) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  background: disabled ? '#e5e0d6' : T.gold, color: disabled ? T.muted : T.navy,
  border: 'none', padding: '10px 20px', borderRadius: 2,
  fontFamily: jost, fontSize: 9, fontWeight: 500,
  letterSpacing: '0.2em', textTransform: 'uppercase',
  cursor: disabled ? 'not-allowed' : 'pointer', transition: 'background 0.2s',
});

/** Outlined secondary button. */
const outlineButton = (disabled = false) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  background: 'white', color: T.navy,
  border: `1px solid ${T.border}`, padding: '9px 18px', borderRadius: 2,
  fontFamily: jost, fontSize: 9, fontWeight: 400,
  letterSpacing: '0.2em', textTransform: 'uppercase',
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  transition: 'border-color 0.2s, color 0.2s',
});

const inputStyle = (extra = {}) => ({
  width: '100%', padding: '9px 12px',
  background: 'white', border: `1px solid ${T.border}`, borderRadius: 3,
  fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.text,
  outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s',
  ...extra,
});

const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

const SkeletonCard = () => (
  <div style={{ background: 'white', border: `1px solid ${T.border}`, borderRadius: 2, padding: '22px 22px 18px' }}>
    {[60, 40, 30].map(w => (
      <div key={w} style={{
        height: w === 60 ? 14 : 8, width: `${w}%`, marginBottom: 12, borderRadius: 4,
        background: 'linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)',
        backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
      }} />
    ))}
    <div style={{ height: 34, marginTop: 18, background: '#f5f3ef' }} />
  </div>
);

const SavedCatalogues = () => {
  const [catalogues, setCatalogues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [downloadingId, setDownloadingId] = useState(null);
  const navigate = useNavigate();
  const { showToast, confirm, Toast, ConfirmDialog } = usePopup();

  useEffect(() => { preloadPdfLibs(); }, []);

  const fetchCatalogues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Light list (no item content) — the builder / PDF load items per catalogue.
      const res = await api.get('/catalogues/summary');
      setCatalogues(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      log.error('Failed to load catalogues', err.message);
      setError('Could not reach the server. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCatalogues(); }, [fetchCatalogues]);

  const handleOpen = (cat) => navigate(`/builder?id=${cat._id}`);

  // Download the saved version straight from the list (no need to open the builder).
  const handleDownload = async (cat) => {
    if (downloadingId) return;
    setDownloadingId(cat._id);
    try {
      const { data } = await api.get(`/catalogues/${cat._id}`);
      if (!data.items?.length) {
        showToast('warning', 'This catalogue has no products yet.');
        return;
      }
      await downloadCataloguePdf(data);
    } catch (err) {
      log.error('Catalogue PDF failed', err.message);
      showToast('error', 'Could not generate the PDF. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (cat) => {
    const ok = await confirm({
      title:        'Delete Catalogue',
      message:      `"${cat.name}" will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel:  'Cancel',
      variant:      'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/catalogues/${cat._id}`);
      setCatalogues(prev => prev.filter(c => c._id !== cat._id));
      showToast('success', `"${cat.name}" deleted`);
    } catch (err) {
      log.error('Delete failed', err.message);
      showToast('error', 'Delete failed. Check server connection.');
    }
  };

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return catalogues;
    return catalogues.filter(c =>
      c.name?.toLowerCase().includes(term) || c.subtitle?.toLowerCase().includes(term));
  }, [catalogues, searchTerm]);

  return (
    <div style={{ minHeight: '100vh', background: T.offwhite, fontFamily: jost, padding: '56px 48px' }}>
      <Toast />
      <ConfirmDialog />
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ width: 32, height: 1, background: T.gold, marginBottom: 20 }} />
        <p style={{ ...eyebrow(), letterSpacing: '0.3em', marginBottom: 10 }}>Gifting</p>
        <h1 style={{ fontFamily: serif, fontSize: 40, fontWeight: 300, color: T.navy, lineHeight: 1.05, margin: '0 0 28px' }}>
          Saved <em style={{ color: T.gold }}>Catalogues.</em>
        </h1>

        {/* Controls row */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 380 }}>
            <Search size={13} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.muted, pointerEvents: 'none' }} />
            <input
              type="text"
              placeholder="Search by client or subtitle…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={inputStyle({ fontSize: 13, paddingLeft: 34, paddingRight: searchTerm ? 30 : 12 })}
              onFocus={e => { e.currentTarget.style.borderColor = T.gold; }}
              onBlur={e => { e.currentTarget.style.borderColor = T.border; }}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: T.muted, display: 'flex', padding: 0 }}
              >✕</button>
            )}
          </div>

          <button
            onClick={fetchCatalogues}
            title="Refresh"
            style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 3, padding: '9px 10px', cursor: 'pointer', color: T.muted, display: 'flex', alignItems: 'center', transition: 'color 0.2s' }}
            onMouseEnter={e => { e.currentTarget.style.color = T.gold; e.currentTarget.style.borderColor = T.borderG; }}
            onMouseLeave={e => { e.currentTarget.style.color = T.muted; e.currentTarget.style.borderColor = T.border; }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>

          <span style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted }}>
            {!loading && `${filtered.length} of ${catalogues.length}`}
          </span>

          <div style={{ marginLeft: 'auto' }}>
            <button
              onClick={() => navigate('/builder')}
              title="Start a catalogue with custom products (or select products on the Products page and use Build New)"
              style={{ ...goldButton(), fontSize: 10, letterSpacing: '0.22em', padding: '10px 22px' }}
              onMouseEnter={e => { e.currentTarget.style.background = T.gold2; }}
              onMouseLeave={e => { e.currentTarget.style.background = T.gold; }}
            >
              <Plus size={13} /> New Catalogue
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      {error ? (
        <div style={{ background: 'white', border: `1px solid ${T.border}`, padding: '48px 24px', textAlign: 'center' }}>
          <h3 style={{ fontFamily: serif, fontSize: 26, fontWeight: 300, color: T.navy, margin: '0 0 8px' }}>Server not reachable</h3>
          <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted, margin: '0 0 20px' }}>{error}</p>
          <button onClick={fetchCatalogues} style={goldButton()}>Retry</button>
        </div>
      ) : loading && !catalogues.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
          {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : !filtered.length ? (
        <div style={{ background: 'white', border: `1px dashed ${T.borderG}`, padding: '64px 24px', textAlign: 'center' }}>
          <BookOpen size={26} style={{ color: T.gold, marginBottom: 12 }} />
          <h3 style={{ fontFamily: serif, fontSize: 26, fontWeight: 300, color: T.navy, margin: '0 0 8px' }}>
            {searchTerm ? 'No matches found' : 'No catalogues yet'}
          </h3>
          <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted, margin: 0 }}>
            {searchTerm
              ? <button onClick={() => setSearchTerm('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.gold, fontFamily: jost, fontSize: 12 }}>Clear search</button>
              : <>Select products on the Products page and use <b style={{ fontWeight: 500 }}>Build New</b>.</>}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
          {filtered.map(cat => {
            const busy = downloadingId === cat._id;
            return (
              <div
                key={cat._id}
                style={{
                  background: 'white', border: `1px solid ${T.border}`, borderRadius: 2,
                  padding: '22px 22px 18px', display: 'flex', flexDirection: 'column',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = T.borderG; e.currentTarget.style.boxShadow = '0 8px 30px rgba(14,21,32,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ fontFamily: serif, fontSize: 24, fontWeight: 400, color: T.navy, margin: 0, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {cat.name}
                    </h3>
                    <p style={{ fontFamily: serif, fontStyle: 'italic', fontSize: 14, color: T.muted, margin: '2px 0 0', minHeight: 18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {cat.subtitle || ' '}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(cat)}
                    title="Delete catalogue"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c8c8c8', padding: 4, display: 'flex', transition: 'color 0.2s' }}
                    onMouseEnter={e => { e.currentTarget.style.color = T.red; }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#c8c8c8'; }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 18px' }}>
                  <span style={{ ...eyebrow(T.gold), fontSize: 8, padding: '4px 8px', border: `1px solid ${T.borderG}`, background: T.dimBg }}>
                    {cat.itemCount || 0} Products
                  </span>
                  <span style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted }}>
                    Updated {formatDate(cat.updatedAt || cat.createdAt)}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                  <button
                    onClick={() => handleOpen(cat)}
                    style={{ ...outlineButton(), flex: 1 }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = T.gold; e.currentTarget.style.color = T.gold; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.navy; }}
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  <button
                    onClick={() => handleDownload(cat)}
                    disabled={Boolean(downloadingId)}
                    style={{ ...goldButton(Boolean(downloadingId) && !busy), flex: 1 }}
                    onMouseEnter={e => { if (!downloadingId) e.currentTarget.style.background = T.gold2; }}
                    onMouseLeave={e => { if (!downloadingId) e.currentTarget.style.background = T.gold; }}
                  >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                    {busy ? 'Preparing…' : 'Download PDF'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SavedCatalogues;
