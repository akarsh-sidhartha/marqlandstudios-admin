import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../api';
import { createLogger } from '../utils/logger';
import { SkeletonList } from '../components/PageLoader';
import {
  Download, Plus, Search, ChevronDown, ChevronRight,
  Paperclip, FileText, Image as ImageIcon, Video, X, Building2,
} from 'lucide-react';
import { INDIA_STATES, CITIES_BY_STATE, SearchableSelect } from '../utils/indiaLocations';

const log = createLogger('VendorList');

// ── Design tokens (mirrors ClientList) ────────────────────────────────────────
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
  danger:  'rgba(220,38,38,0.6)',
  dangerHover: '#dc2626',
};
const jost  = '"Jost", sans-serif';
const serif = '"Cormorant Garamond", Georgia, serif';

// ── Reusable focus-aware input ────────────────────────────────────────────────
const inputStyle = (focused) => ({
  width: '100%', padding: '10px 14px',
  background: 'white',
  border: `1px solid ${focused ? T.gold : T.border}`,
  borderRadius: 3,
  fontFamily: jost, fontSize: 13, fontWeight: 300,
  color: T.text, outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.2s',
});

const FocusInput = ({ value, onChange, placeholder, type = 'text', style: extra = {} }) => {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{ ...inputStyle(focused), ...extra }}
    />
  );
};

const FocusTextarea = ({ value, onChange, placeholder, rows = 3 }) => {
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...inputStyle(focused),
        resize: 'vertical',
        minHeight: 80,
      }}
    />
  );
};

// ── Sub Category autocomplete input ──────────────────────────────────────────
// Renders a plain text input; when the user types, shows a dropdown of
// previously-used sub categories that match. Clicking a suggestion fills
// the field. Pressing Escape or clicking outside closes the dropdown.
const SubCategoryInput = ({ value, onChange, suggestions = [], placeholder }) => {
  const [focused,  setFocused]  = useState(false);
  const [open,     setOpen]     = useState(false);
  const containerRef            = useRef(null);

  // Filter suggestions: match typed text (case-insensitive), exclude exact match
  const filtered = useMemo(() => {
    if (!value.trim()) return suggestions;
    const q = value.toLowerCase();
    return suggestions.filter(s => s.toLowerCase().includes(q) && s.toLowerCase() !== q);
  }, [value, suggestions]);

  const showDropdown = open && filtered.length > 0;

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (s) => {
    onChange(s);
    setOpen(false);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { setFocused(true); setOpen(true); }}
        onBlur={() => setFocused(false)}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
        placeholder={placeholder}
        style={inputStyle(focused)}
      />
      {showDropdown && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'white',
          border: `1px solid ${T.borderG}`,
          boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
          zIndex: 400,
          maxHeight: 180,
          overflowY: 'auto',
        }}>
          {filtered.map((s, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={e => { e.preventDefault(); handleSelect(s); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '9px 14px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.text,
                borderBottom: i < filtered.length - 1 ? `1px solid ${T.border}` : 'none',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = T.dimBg}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtSize = (bytes = 0) =>
  bytes < 1_048_576
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1_048_576).toFixed(1)} MB`;

const mediaIcon = (mimeType = '') => {
  if (mimeType.startsWith('image/')) return <ImageIcon size={13} style={{ color: '#4f46e5', flexShrink: 0 }} />;
  if (mimeType.startsWith('video/')) return <Video     size={13} style={{ color: '#7c3aed', flexShrink: 0 }} />;
  return                                     <FileText  size={13} style={{ color: T.gold,   flexShrink: 0 }} />;
};

// ── Spinner ───────────────────────────────────────────────────────────────────
const Spinner = () => (
  <div style={{
    width: 14, height: 14,
    border: `2px solid ${T.borderG}`,
    borderTopColor: T.gold,
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
    flexShrink: 0,
  }} />
);

// ── VendorList ────────────────────────────────────────────────────────────────
const VendorList = () => {
  const [vendors,       setVendors]       = useState([]);
  const [isLoading,     setIsLoading]     = useState(true);
  const [isSaving,      setIsSaving]      = useState(false);
  const [isScanning,    setIsScanning]    = useState(false);
  const [searchTerm,    setSearchTerm]    = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [expandedRows,  setExpandedRows]  = useState([]);
  const [showModal,     setShowModal]     = useState(false);
  const [isEditing,     setIsEditing]     = useState(false);
  const [currentId,     setCurrentId]     = useState(null);
  const [highlightId,   setHighlightId]   = useState(null);   // briefly highlight a vendor row
  const [sortOrder,     setSortOrder]     = useState('asc');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterState,    setFilterState]    = useState('');

  // Card scanner
  const [cardImages,    setCardImages]    = useState({ front: null, back: null });

  // Media attachments
  const [newMediaFiles, setNewMediaFiles] = useState([]);
  const [keepMediaIds,  setKeepMediaIds]  = useState([]);
  const [lightboxMedia, setLightboxMedia] = useState(null);

  const [formData, setFormData] = useState({
    companyName:      '',
    state:            '',
    city:             '',
    category:         '',
    subCategory:      '',
    suppliedProducts: '',
    contacts: [{ name: '', phone: '', email: '' }],
  });

  useEffect(() => { fetchVendors(); }, []);

  // ── Data fetching ─────────────────────────────────────────────────────────
  const fetchVendors = async () => {
    log.debug('Fetching vendors…');
    setIsLoading(true);
    try {
      const res = await api.get('/vendors');
      log.info('Vendors loaded', { count: res.data.length });
      setVendors(res.data);
    } catch (err) {
      log.error('Failed to fetch vendors', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Derived data ──────────────────────────────────────────────────────────
  // Collect all non-empty sub categories saved across vendors, deduplicated and sorted
  const knownSubCategories = useMemo(() => {
    const set = new Set(
      vendors
        .map(v => v.subCategory?.trim())
        .filter(Boolean)
    );
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [vendors]);

  // ── Duplicate vendor detection ────────────────────────────────────────────
  // Only active when adding a new vendor (not editing).
  // Returns vendors whose name is "close" to what's being typed:
  //   • exact substring match (fastest, catches most cases), OR
  //   • token overlap: ≥1 significant word in common (ignores Pvt/Ltd/etc.)
  const duplicateMatches = useMemo(() => {
    if (isEditing) return [];
    const raw = formData.companyName.trim();
    if (raw.length < 3) return [];

    const NOISE = /^(pvt|ltd|llp|inc|corp|co|and|&|the|a|of|enterprises?|solutions?|services?|india|group)$/i;
    const tokens = (str) =>
      str.toLowerCase().split(/[\s,.()/\-]+/).filter(w => w.length > 1 && !NOISE.test(w));

    const inputLow    = raw.toLowerCase();
    const inputTokens = tokens(raw);

    return vendors.filter(v => {
      const nameLow    = v.companyName?.toLowerCase() ?? '';
      const nameTokens = tokens(v.companyName ?? '');

      // Substring match
      if (nameLow.includes(inputLow) || inputLow.includes(nameLow)) return true;

      // Token overlap — at least one meaningful word in common
      if (inputTokens.length > 0 && nameTokens.length > 0) {
        return inputTokens.some(t => nameTokens.includes(t));
      }
      return false;
    });
  }, [formData.companyName, vendors, isEditing]);

  const filteredVendors = useMemo(() => {
    const s = searchTerm.toLowerCase();
    return vendors
      .filter(v => {
        const matchesSearch =
          v.companyName?.toLowerCase().includes(s) ||
          v.suppliedProducts?.toLowerCase().includes(s) ||
          v.contacts?.some(c => c.name?.toLowerCase().includes(s));
        const matchesCat   = !filterCategory || v.category === filterCategory;
        const matchesState = !filterState    || v.state    === filterState;
        return matchesSearch && matchesCat && matchesState;
      })
      .sort((a, b) => {
        const na = a.companyName?.toLowerCase() ?? '';
        const nb = b.companyName?.toLowerCase() ?? '';
        return sortOrder === 'asc' ? na.localeCompare(nb) : nb.localeCompare(na);
      });
  }, [vendors, searchTerm, filterCategory, filterState, sortOrder]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const toggleSort = () => setSortOrder(p => (p === 'asc' ? 'desc' : 'asc'));
  const toggleRow  = (id) =>
    setExpandedRows(p => p.includes(id) ? p.filter(r => r !== id) : [...p, id]);

  const handleResetFilters = () => {
    setSearchTerm('');
    setFilterCategory('');
    setFilterState('');
    log.debug('Filters reset');
  };

  const handleContactChange = (index, field, value) => {
    const updated = [...formData.contacts];
    updated[index] = { ...updated[index], [field]: value };
    setFormData({ ...formData, contacts: updated });
  };

  const handleAddContact = () =>
    setFormData({ ...formData, contacts: [...formData.contacts, { name: '', phone: '', email: '' }] });

  const handleRemoveContact = (index) => {
    const updated = formData.contacts.filter((_, i) => i !== index);
    setFormData({ ...formData, contacts: updated.length > 0 ? updated : [{ name: '', phone: '', email: '' }] });
  };

  const handleCardCapture = (side, e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setCardImages(prev => ({ ...prev, [side]: reader.result }));
    reader.readAsDataURL(file);
  };

  const handleScanCard = async () => {
    log.debug('Scanning business card…');
    setIsScanning(true);
    try {
      // Build a combined prompt with whichever sides are available
      const imagesToScan = [];
      if (cardImages.front) imagesToScan.push({ side: 'front', data: cardImages.front });
      if (cardImages.back)  imagesToScan.push({ side: 'back',  data: cardImages.back  });

      // Use the first available image as primary; fall back gracefully
      const primaryImage = cardImages.front || cardImages.back;
      const res = await api.post('/vendors/scan-card', {
        image:    primaryImage,
        backImage: cardImages.back || null,
        mimeType: 'image/jpeg',
      });
      const data = res.data;
      setFormData(prev => ({
        ...prev,
        companyName: data.company_name || data.vendor_name || prev.companyName,
        contacts: [{
          name:  data.name  || data.person_name  || '',
          phone: data.phone || data.phone_number || '',
          email: data.email || data.email_address || '',
        }],
      }));

      // Convert scanned card image(s) to File objects and add as attachments
      const cardFiles = [];
      for (const { side, data: dataUrl } of imagesToScan) {
        const res2 = await fetch(dataUrl);
        const blob = await res2.blob();
        const ext  = blob.type === 'image/png' ? 'png' : 'jpg';
        cardFiles.push(new File([blob], `business-card-${side}.${ext}`, { type: blob.type }));
      }
      if (cardFiles.length > 0) {
        setNewMediaFiles(prev => [...prev, ...cardFiles]);
      }

      if (data._provider && data._provider !== 'gemini') {
        log.info('Card scanned via fallback provider', { provider: data._provider });
      } else {
        log.info('Card scanned successfully');
      }
    } catch (err) {
      log.error('Card scan failed', err.message);
      alert('Card scan failed. Please fill in the details manually.');
    } finally {
      setIsScanning(false);
    }
  };

  // Jump to a vendor in the list: close modal, set search to the company name,
  // scroll to that row and flash a highlight for 2 seconds.
  const handleJumpToVendor = (vendor) => {
    resetForm();
    setShowModal(false);
    setSearchTerm(vendor.companyName);
    setHighlightId(vendor._id);
    setTimeout(() => {
      const el = document.getElementById(`vendor-row-${vendor._id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    setTimeout(() => setHighlightId(null), 2500);
  };

  const handleDeleteMedia = async (vendorId, mediaId, e) => {
    e.stopPropagation();
    if (!window.confirm('Remove this file?')) return;
    log.info('Deleting media', { vendorId, mediaId });
    try {
      await api.delete(`/vendors/${vendorId}/media/${mediaId}`);
      setKeepMediaIds(prev => prev.filter(id => id !== mediaId));
      fetchVendors();
    } catch (err) {
      log.error('Media delete failed', err.message);
      alert('Failed to delete file.');
    }
  };

  const handleEdit = (v, e) => {
    e.stopPropagation();
    log.debug('Opening edit modal', { id: v._id, name: v.companyName });
    setIsEditing(true);
    setCurrentId(v._id);
    setFormData({
      companyName:      v.companyName,
      state:            v.state            || '',
      city:             v.city             || '',
      category:         v.category         || '',
      subCategory:      v.subCategory      || '',
      suppliedProducts: v.suppliedProducts || '',
      contacts: v.contacts?.length > 0 ? [...v.contacts] : [{ name: '', phone: '', email: '' }],
    });
    setKeepMediaIds((v.media || []).map(m => m._id));
    setNewMediaFiles([]);
    setShowModal(true);
  };

  const handleDelete = async (id, name, e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${name}"?`)) return;
    log.info('Deleting vendor', { id, name });
    try {
      await api.delete(`/vendors/${id}`);
      fetchVendors();
    } catch (err) {
      log.error('Delete failed', err.message);
      alert('Failed to delete vendor.');
    }
  };

  const handleSave = async () => {
    log.info(isEditing ? 'Updating vendor' : 'Creating vendor', { name: formData.companyName });
    setIsSaving(true);
    try {
      const fd = new FormData();
      fd.append('companyName',      formData.companyName);
      fd.append('state',            formData.state);
      fd.append('city',             formData.city);
      fd.append('category',         formData.category);
      fd.append('subCategory',      formData.subCategory || '');
      fd.append('suppliedProducts', formData.suppliedProducts);
      fd.append('contacts',         JSON.stringify(formData.contacts));
      if (isEditing) fd.append('keepMediaIds', keepMediaIds.join(','));
      newMediaFiles.forEach(f => fd.append('mediaFiles', f));

      if (isEditing) {
        await api.put(`/vendors/${currentId}`, fd);
      } else {
        await api.post('/vendors', fd);
      }
      log.info('Vendor saved successfully');
      setShowModal(false);
      resetForm();
      fetchVendors();
    } catch (err) {
      log.error('Save failed', err.response?.data?.message || err.message);
      alert('Error saving vendor: ' + (err.response?.data?.message || err.message));
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setFormData({ companyName: '', state: '', city: '', category: '', subCategory: '', suppliedProducts: '', contacts: [{ name: '', phone: '', email: '' }] });
    setCardImages({ front: null, back: null });
    setIsEditing(false);
    setCurrentId(null);
    setNewMediaFiles([]);
    setKeepMediaIds([]);
  };

  const exportToExcel = () => {
    log.debug('Exporting vendors to CSV');
    const headers = ['Vendor Name', 'State', 'Category', 'Products', 'Contact Name', 'Phone', 'Email'];
    const rows = filteredVendors.flatMap(v =>
      v.contacts.map(c => [v.companyName, v.state, v.category, v.suppliedProducts, c.name, c.phone, c.email])
    );
    const csv = 'data:text/csv;charset=utf-8,' +
      [headers, ...rows].map(r => r.map(val => `"${val || ''}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = encodeURI(csv);
    a.download = `Vendor_List_${new Date().toLocaleDateString()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: T.offwhite, fontFamily: jost, padding: '56px 48px' }}>

      {/* Spin keyframe injected once */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Page header ────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ width: 32, height: 1, background: T.gold, marginBottom: 20 }} />
        <p style={{
          fontSize: 9, fontWeight: 400, letterSpacing: '0.3em',
          textTransform: 'uppercase', color: T.muted, marginBottom: 10,
        }}>
          Procurement
        </p>
        <h1 style={{
          fontFamily: serif, fontSize: 40, fontWeight: 300,
          color: T.navy, lineHeight: 1.05, margin: '0 0 24px',
        }}>
          Vendor <em style={{ color: T.gold }}>Management.</em>
        </h1>

        {/* Controls row */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>

          {/* Search */}
          <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 420 }}>
            <Search size={13} style={{
              position: 'absolute', left: 13, top: '50%',
              transform: 'translateY(-50%)', color: T.muted, pointerEvents: 'none',
            }} />
            <input
              type="text"
              placeholder="Search by company, product or contact…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              style={{
                width: '100%', padding: '10px 36px',
                background: 'white',
                border: `1px solid ${searchFocused ? T.gold : T.border}`,
                borderRadius: 3,
                fontFamily: jost, fontSize: 12, fontWeight: 300,
                color: T.text, outline: 'none',
                boxSizing: 'border-box', transition: 'border-color 0.2s',
              }}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                style={{
                  position: 'absolute', right: 12, top: '50%',
                  transform: 'translateY(-50%)', background: 'none',
                  border: 'none', cursor: 'pointer', color: T.muted, padding: 0,
                }}
              >✕</button>
            )}
          </div>

          {/* Category filter */}
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            style={{
              padding: '10px 14px', background: 'white',
              border: `1px solid ${T.border}`, borderRadius: 3,
              fontFamily: jost, fontSize: 11, fontWeight: 300,
              color: filterCategory ? T.text : T.muted,
              outline: 'none', cursor: 'pointer',
            }}
          >
            <option value="">All Categories</option>
            <option value="Gifting">Gifting</option>
            <option value="Travel">Travel</option>
          </select>

          {/* State filter */}
          <select
            value={filterState}
            onChange={e => setFilterState(e.target.value)}
            style={{
              padding: '10px 14px', background: 'white',
              border: `1px solid ${T.border}`, borderRadius: 3,
              fontFamily: jost, fontSize: 11, fontWeight: 300,
              color: filterState ? T.text : T.muted,
              outline: 'none', cursor: 'pointer',
            }}
          >
            <option value="">All States</option>
            {INDIA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Reset filters */}
          {(searchTerm || filterCategory || filterState) && (
            <button
              onClick={handleResetFilters}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.2em', textTransform: 'uppercase',
                color: T.danger, transition: 'color 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = T.dangerHover}
              onMouseLeave={e => e.currentTarget.style.color = T.danger}
            >
              Reset
            </button>
          )}

          {/* Add vendor */}
          <button
            onClick={() => { resetForm(); setShowModal(true); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: T.gold, color: T.navy,
              border: 'none', padding: '11px 28px',
              fontFamily: jost, fontSize: 10, fontWeight: 500,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              cursor: 'pointer', transition: 'background 0.25s', flexShrink: 0,
            }}
            onMouseEnter={e => e.currentTarget.style.background = T.gold2}
            onMouseLeave={e => e.currentTarget.style.background = T.gold}
          >
            <Plus size={12} /> Add Vendor
          </button>

          {/* Export */}
          <button
            onClick={exportToExcel}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'transparent', color: T.muted,
              border: `1px solid ${T.border}`, padding: '10px 20px',
              fontFamily: jost, fontSize: 10, fontWeight: 400,
              letterSpacing: '0.2em', textTransform: 'uppercase',
              cursor: 'pointer', transition: 'border-color 0.25s, color 0.25s', flexShrink: 0,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = T.gold;
              e.currentTarget.style.color = T.gold;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = T.border;
              e.currentTarget.style.color = T.muted;
            }}
          >
            <Download size={13} /> Export
          </button>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div style={{ background: 'white', border: `1px solid ${T.border}`, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.border}`, background: T.offwhite }}>
              <th style={{ width: 44, padding: '12px 16px' }} />
              <th
                onClick={toggleSort}
                style={{
                  padding: '12px 16px', textAlign: 'left',
                  fontFamily: jost, fontSize: 9, fontWeight: 400,
                  letterSpacing: '0.25em', textTransform: 'uppercase',
                  color: T.muted, cursor: 'pointer', userSelect: 'none',
                  transition: 'color 0.2s', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => e.currentTarget.style.color = T.gold}
                onMouseLeave={e => e.currentTarget.style.color = T.muted}
              >
                Company {sortOrder === 'asc' ? '↑' : '↓'}
              </th>
              <th style={{
                padding: '12px 16px', textAlign: 'left',
                fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted,
              }}>
                Category / State
              </th>
              <th style={{
                padding: '12px 16px', textAlign: 'left',
                fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted,
              }}>
                Primary Contact
              </th>
              <th style={{
                padding: '12px 16px', textAlign: 'right',
                fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted,
              }}>
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <SkeletonList rows={8} cols={5} />
            ) : filteredVendors.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '64px 0', textAlign: 'center' }}>
                  <Building2 size={28} style={{ color: 'rgba(0,0,0,0.12)', margin: '0 auto 12px', display: 'block' }} />
                  <p style={{
                    fontFamily: jost, fontSize: 12, fontWeight: 300,
                    letterSpacing: '0.1em', color: T.muted,
                  }}>
                    No vendors found
                  </p>
                </td>
              </tr>
            ) : filteredVendors.map(v => {
              const isExpanded = expandedRows.includes(v._id);
              return (
                <React.Fragment key={v._id}>
                  {/* ── Row ── */}
                  <tr
                    id={`vendor-row-${v._id}`}
                    onClick={() => toggleRow(v._id)}
                    style={{
                      cursor: 'pointer',
                      borderBottom: `1px solid ${T.border}`,
                      background: highlightId === v._id
                        ? '#fffbeb'
                        : isExpanded ? T.dimBg : 'transparent',
                      outline: highlightId === v._id ? '2px solid #f59e0b' : 'none',
                      outlineOffset: -2,
                      transition: 'background 0.4s, outline 0.4s',
                    }}
                    onMouseEnter={e => { if (!isExpanded && highlightId !== v._id) e.currentTarget.style.background = 'rgba(0,0,0,0.015)'; }}
                    onMouseLeave={e => { if (!isExpanded && highlightId !== v._id) e.currentTarget.style.background = isExpanded ? T.dimBg : 'transparent'; }}
                  >
                    {/* Expand chevron */}
                    <td style={{ padding: '14px 16px', textAlign: 'center', width: 44 }}>
                      {isExpanded
                        ? <ChevronDown  size={13} style={{ color: T.gold }} />
                        : <ChevronRight size={13} style={{ color: T.muted }} />}
                    </td>

                    {/* Company name */}
                    <td style={{
                      padding: '14px 16px',
                      fontFamily: jost, fontSize: 12, fontWeight: 500,
                      letterSpacing: '0.06em', textTransform: 'uppercase', color: T.text,
                    }}>
                      {v.companyName}
                      {v.media?.length > 0 && (
                        <span style={{
                          marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontFamily: jost, fontSize: 9, fontWeight: 400,
                          letterSpacing: '0.12em', textTransform: 'uppercase',
                          color: T.gold, border: `1px solid ${T.borderG}`, padding: '2px 6px',
                        }}>
                          <Paperclip size={9} /> {v.media.length}
                        </span>
                      )}
                    </td>

                    {/* Category / State */}
                    <td style={{ padding: '14px 16px' }}>
                      {v.category && (
                        <span style={{
                          display: 'inline-block', marginBottom: 2,
                          fontFamily: jost, fontSize: 10, fontWeight: 400,
                          letterSpacing: '0.15em', textTransform: 'uppercase',
                          color: T.gold, border: `1px solid ${T.borderG}`, padding: '2px 8px',
                        }}>
                          {v.category}
                        </span>
                      )}
                      {v.state && (
                        <p style={{
                          fontFamily: jost, fontSize: 12, fontWeight: 300,
                          color: T.text, margin: 0,
                        }}>
                          {v.state}{v.city ? `, ${v.city}` : ''}
                        </p>
                      )}
                    </td>

                    {/* Primary contact */}
                    <td style={{
                      padding: '14px 16px',
                      fontFamily: jost, fontSize: 15, fontWeight: 300, color: T.text,
                    }}>
                      {v.contacts?.[0]?.name || '—'}
                      {v.contacts?.length > 1 && (
                        <span style={{
                          marginLeft: 8,
                          fontFamily: jost, fontSize: 9, fontWeight: 400,
                          letterSpacing: '0.15em', textTransform: 'uppercase',
                          color: T.gold, border: `1px solid ${T.borderG}`, padding: '2px 7px',
                        }}>
                          +{v.contacts.length - 1}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <button
                        onClick={e => handleEdit(v, e)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          fontFamily: jost, fontSize: 12, fontWeight: 400,
                          letterSpacing: '0.2em', textTransform: 'uppercase',
                          color: T.gold, marginRight: 20, transition: 'color 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = T.gold2}
                        onMouseLeave={e => e.currentTarget.style.color = T.gold}
                      >
                        Edit
                      </button>
                      <button
                        onClick={e => handleDelete(v._id, v.companyName, e)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          fontFamily: jost, fontSize: 12, fontWeight: 400,
                          letterSpacing: '0.2em', textTransform: 'uppercase',
                          color: T.danger, transition: 'color 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = T.dangerHover}
                        onMouseLeave={e => e.currentTarget.style.color = T.danger}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>

                  {/* ── Expanded detail ── */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={5} style={{
                        padding: '24px 24px 24px 48px',
                        borderBottom: `1px solid ${T.border}`,
                        background: T.dimBg,
                      }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>

                          {/* Products */}
                          <div>
                            <p style={{
                              fontFamily: jost, fontSize: 9, fontWeight: 400,
                              letterSpacing: '0.28em', textTransform: 'uppercase',
                              color: 'rgba(184,151,90,0.6)', marginBottom: 10,
                            }}>
                              Products Supplied
                            </p>
                            <p style={{
                              fontFamily: jost, fontSize: 12, fontWeight: 300,
                              color: T.text, background: 'white',
                              border: `1px solid ${T.border}`, padding: '12px 14px',
                              fontStyle: 'italic', margin: 0,
                            }}>
                              {v.suppliedProducts || 'N/A'}
                            </p>
                          </div>

                          {/* Contacts */}
                          <div>
                            <p style={{
                              fontFamily: jost, fontSize: 9, fontWeight: 400,
                              letterSpacing: '0.28em', textTransform: 'uppercase',
                              color: 'rgba(184,151,90,0.6)', marginBottom: 10,
                            }}>
                              Contact Directory
                            </p>
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                              gap: 10,
                            }}>
                              {v.contacts?.length > 0 ? v.contacts.map((c, i) => (
                                <div key={i} style={{
                                  background: 'white', border: `1px solid ${T.border}`,
                                  padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4,
                                }}>
                                  <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 500, color: T.gold, margin: 0 }}>
                                    {c.name || '—'}
                                  </p>
                                  <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted, margin: 0 }}>
                                    {c.phone || 'No phone'}
                                  </p>
                                  <p style={{
                                    fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted,
                                    margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  }}>
                                    {c.email || 'No email'}
                                  </p>
                                </div>
                              )) : (
                                <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted }}>
                                  No contacts listed.
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Media */}
                          {v.media?.length > 0 && (
                            <div style={{ gridColumn: '1 / -1' }}>
                              <p style={{
                                fontFamily: jost, fontSize: 9, fontWeight: 400,
                                letterSpacing: '0.28em', textTransform: 'uppercase',
                                color: 'rgba(184,151,90,0.6)', marginBottom: 10,
                                display: 'flex', alignItems: 'center', gap: 6,
                              }}>
                                <Paperclip size={10} /> Attached Files ({v.media.length})
                              </p>
                              <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                                gap: 10,
                              }}>
                                {v.media.map(m => {
                                  const isImg = m.mimeType?.startsWith('image/');
                                  const isVid = m.mimeType?.startsWith('video/');
                                  return (
                                    <div
                                      key={m._id}
                                      style={{
                                        background: 'white', border: `1px solid ${T.border}`,
                                        overflow: 'hidden', cursor: 'pointer',
                                        transition: 'box-shadow 0.2s',
                                      }}
                                      onClick={() => setLightboxMedia({ url: m.url, mimeType: m.mimeType, name: m.name })}
                                      onMouseEnter={e => e.currentTarget.style.boxShadow = `0 4px 12px rgba(184,151,90,0.15)`}
                                      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                                    >
                                      {/* Thumbnail */}
                                      <div style={{
                                        height: 100, background: T.offwhite,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        overflow: 'hidden',
                                      }}>
                                        {isImg ? (
                                          <img src={m.url} alt={m.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : isVid ? (
                                          <div style={{ textAlign: 'center', color: '#7c3aed' }}>
                                            <Video size={28} />
                                            <p style={{ fontFamily: jost, fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', marginTop: 4 }}>Video</p>
                                          </div>
                                        ) : (
                                          <div style={{ textAlign: 'center', color: T.gold }}>
                                            <FileText size={28} />
                                            <p style={{ fontFamily: jost, fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', marginTop: 4 }}>
                                              {m.name.split('.').pop()?.toUpperCase()}
                                            </p>
                                          </div>
                                        )}
                                      </div>
                                      {/* Meta */}
                                      <div style={{ padding: '8px 10px' }}>
                                        <p style={{
                                          fontFamily: jost, fontSize: 10, fontWeight: 500,
                                          color: T.text, margin: 0,
                                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}>
                                          {m.name}
                                        </p>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                          <p style={{ fontFamily: jost, fontSize: 9, fontWeight: 300, color: T.muted, margin: 0 }}>
                                            {fmtSize(m.size)}
                                          </p>
                                          <a
                                            href={m.url}
                                            download={m.name}
                                            onClick={e => e.stopPropagation()}
                                            style={{ color: T.gold, display: 'flex' }}
                                          >
                                            <Download size={11} />
                                          </a>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>

        {/* Footer count */}
        {!isLoading && (
          <div style={{
            borderTop: `1px solid ${T.border}`, padding: '10px 18px',
            fontFamily: jost, fontSize: 10, fontWeight: 300,
            letterSpacing: '0.12em', color: T.muted, textAlign: 'right',
          }}>
            {filteredVendors.length} of {vendors.length} vendor{vendors.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* ── Add / Edit Modal ────────────────────────────────────────────── */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(14,21,32,0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, zIndex: 50,
        }}>
          <div style={{
            background: 'white', border: `1px solid ${T.border}`,
            padding: '36px 36px 0',
            width: '100%', maxWidth: 680,
            maxHeight: '90vh', overflowY: 'auto',
          }}>
            {/* Modal header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              marginBottom: 32, paddingBottom: 20, borderBottom: `1px solid ${T.border}`,
            }}>
              <div>
                <p style={{
                  fontFamily: jost, fontSize: 9, fontWeight: 400,
                  letterSpacing: '0.28em', textTransform: 'uppercase',
                  color: T.muted, marginBottom: 6,
                }}>
                  {isEditing ? 'Update Record' : 'New Registration'}
                </p>
                <h2 style={{ fontFamily: serif, fontSize: 28, fontWeight: 300, color: T.navy, margin: 0 }}>
                  {isEditing ? 'Edit Vendor' : 'Add Vendor'}
                </h2>
              </div>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: T.muted, fontSize: 20, lineHeight: 1, padding: 4, transition: 'color 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = T.text}
                onMouseLeave={e => e.currentTarget.style.color = T.muted}
              >
                ✕
              </button>
            </div>

            {/* ── AI Card Scanner ── */}
            <div style={{
              background: T.dimBg, border: `1px dashed ${T.borderG}`,
              padding: 20, marginBottom: 28,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <p style={{
                  fontFamily: jost, fontSize: 9, fontWeight: 400,
                  letterSpacing: '0.28em', textTransform: 'uppercase', color: T.gold, margin: 0,
                }}>
                  AI Card Scanner
                </p>
                {isScanning && <Spinner />}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {['front', 'back'].map(side => (
                  <label key={side} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', height: 100,
                    background: 'white', border: `1px solid ${T.border}`,
                    cursor: 'pointer', transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = T.gold}
                  onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
                  >
                    {cardImages[side] ? (
                      <img src={cardImages[side]} alt={side} style={{ height: '100%', width: '100%', objectFit: 'cover' }} />
                    ) : (
                      <>
                        <span style={{ fontSize: 20 }}>📷</span>
                        <p style={{
                          fontFamily: jost, fontSize: 9, fontWeight: 400,
                          letterSpacing: '0.2em', textTransform: 'uppercase',
                          color: T.muted, marginTop: 6, marginBottom: 0,
                        }}>
                          Scan {side}
                        </p>
                      </>
                    )}
                    <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                      onChange={e => handleCardCapture(side, e)} />
                  </label>
                ))}
              </div>
              {(cardImages.front || cardImages.back) && (
                <button
                  onClick={handleScanCard}
                  disabled={isScanning}
                  style={{
                    width: '100%', marginTop: 12, padding: '11px 0',
                    background: isScanning ? T.borderG : T.gold,
                    color: T.navy, border: 'none', cursor: isScanning ? 'not-allowed' : 'pointer',
                    fontFamily: jost, fontSize: 10, fontWeight: 500,
                    letterSpacing: '0.22em', textTransform: 'uppercase',
                    transition: 'background 0.25s',
                  }}
                >
                  {isScanning ? 'Extracting…' : '✨ Auto-Fill Fields'}
                </button>
              )}
            </div>

            {/* ── Core fields ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
              <div>
                <label style={{
                  display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400,
                  letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted, marginBottom: 8,
                }}>
                  Company Name
                </label>
                <FocusInput
                  value={formData.companyName}
                  onChange={e => setFormData({ ...formData, companyName: e.target.value })}
                  placeholder="Company name"
                />
              </div>
              <div>
                <label style={{
                  display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400,
                  letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted, marginBottom: 8,
                }}>
                  Category
                </label>
                <select
                  value={formData.category}
                  onChange={e => setFormData({ ...formData, category: e.target.value })}
                  style={{
                    ...inputStyle(false), appearance: 'none',
                    cursor: 'pointer', color: formData.category ? T.text : T.muted,
                  }}
                >
                  <option value="">Select category…</option>
                  <option value="Gifting">Gifting</option>
                  <option value="Travel">Travel</option>
                  <option value="Events">Events</option>
                </select>
              </div>
            </div>

            {/* ── Duplicate vendor warning ── */}
            {!isEditing && duplicateMatches.length > 0 && (
              <div style={{
                marginBottom: 20,
                background: '#fffbeb',
                border: '1px solid #f59e0b',
                padding: '12px 14px',
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                {/* Warning icon */}
                <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>⚠️</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    margin: '0 0 8px', fontFamily: jost, fontSize: 11, fontWeight: 500,
                    color: '#92400e', letterSpacing: '0.02em',
                  }}>
                    {duplicateMatches.length === 1
                      ? 'A similar vendor may already exist'
                      : `${duplicateMatches.length} similar vendors may already exist`}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {duplicateMatches.map(v => (
                      <div key={v._id} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 8,
                      }}>
                        <span style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: '#78350f', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v.companyName}
                          {v.state ? <span style={{ color: '#a16207', marginLeft: 6 }}>· {v.state}</span> : null}
                          {v.category ? <span style={{ color: '#a16207', marginLeft: 6 }}>· {v.category}</span> : null}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleJumpToVendor(v)}
                          style={{
                            flexShrink: 0,
                            background: 'none', border: '1px solid #f59e0b',
                            color: '#92400e', cursor: 'pointer',
                            fontFamily: jost, fontSize: 9, fontWeight: 500,
                            letterSpacing: '0.15em', textTransform: 'uppercase',
                            padding: '3px 10px',
                            whiteSpace: 'nowrap',
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = '#fef3c7'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >
                          View
                        </button>
                      </div>
                    ))}
                  </div>
                  <p style={{ margin: '8px 0 0', fontFamily: jost, fontSize: 10, fontWeight: 300, color: '#a16207' }}>
                    You can still proceed if this is a different vendor.
                  </p>
                </div>
              </div>
            )}

            {/* Sub Category */}
            <div style={{ marginBottom: 20 }}>
              <label style={{
                display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted, marginBottom: 8,
              }}>
                Sub Category
                <span style={{ marginLeft: 8, fontWeight: 300, textTransform: 'none', letterSpacing: 0, color: T.muted, fontSize: 9 }}>
                  (optional)
                </span>
              </label>
              <SubCategoryInput
                value={formData.subCategory}
                onChange={val => setFormData({ ...formData, subCategory: val })}
                suggestions={knownSubCategories}
                placeholder="Type sub category…"
              />
            </div>

            {/* State */}
            <div style={{ marginBottom: 20 }}>
              <label style={{
                display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted, marginBottom: 8,
              }}>
                State / Region
              </label>
              <SearchableSelect
                value={formData.state}
                onChange={s => setFormData({ ...formData, state: s, city: '' })}
                options={INDIA_STATES}
                placeholder="Select state…"
              />
            </div>

            {/* City */}
            <div style={{ marginBottom: 20 }}>
              <label style={{
                display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted, marginBottom: 8,
              }}>
                City
                {!formData.state && (
                  <span style={{ marginLeft: 8, fontWeight: 300, textTransform: 'none', letterSpacing: 0, fontSize: 9 }}>
                    — select a state first
                  </span>
                )}
              </label>
              <SearchableSelect
                value={formData.city}
                onChange={city => setFormData({ ...formData, city })}
                options={formData.state ? (CITIES_BY_STATE[formData.state] || []) : []}
                placeholder={formData.state ? 'Select city…' : 'Select state first…'}
                disabled={!formData.state}
              />
            </div>

            {/* Products */}
            <div style={{ marginBottom: 20 }}>
              <label style={{
                display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted, marginBottom: 8,
              }}>
                Products Supplied
              </label>
              <FocusTextarea
                value={formData.suppliedProducts}
                onChange={e => setFormData({ ...formData, suppliedProducts: e.target.value })}
                placeholder="List products or services supplied…"
              />
            </div>

            {/* ── Contacts ── */}
            <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 24, marginBottom: 24 }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', marginBottom: 16,
              }}>
                <p style={{
                  fontFamily: jost, fontSize: 9, fontWeight: 400,
                  letterSpacing: '0.28em', textTransform: 'uppercase',
                  color: 'rgba(184,151,90,0.65)', margin: 0,
                }}>
                  Points of Contact
                </p>
                <button
                  onClick={handleAddContact}
                  style={{
                    background: 'none', border: `1px solid ${T.borderG}`,
                    cursor: 'pointer', padding: '5px 14px',
                    fontFamily: jost, fontSize: 9, fontWeight: 400,
                    letterSpacing: '0.2em', textTransform: 'uppercase',
                    color: T.gold, transition: 'background 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = T.dimBg}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  + Add Person
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {formData.contacts.map((c, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 10, alignItems: 'center',
                    padding: '14px 16px', background: T.offwhite, border: `1px solid ${T.border}`,
                  }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, flex: 1 }}>
                      {['name', 'phone', 'email'].map(field => (
                        <FocusInput
                          key={field}
                          value={c[field]}
                          onChange={e => handleContactChange(i, field, e.target.value)}
                          placeholder={field.charAt(0).toUpperCase() + field.slice(1)}
                          style={{ fontSize: 12 }}
                        />
                      ))}
                    </div>
                    <button
                      onClick={() => handleRemoveContact(i)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: T.muted, fontSize: 16, lineHeight: 1, flexShrink: 0, transition: 'color 0.2s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = T.dangerHover}
                      onMouseLeave={e => e.currentTarget.style.color = T.muted}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Media attachments ── */}
            <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 24, marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <p style={{
                  fontFamily: jost, fontSize: 9, fontWeight: 400,
                  letterSpacing: '0.28em', textTransform: 'uppercase',
                  color: 'rgba(184,151,90,0.65)', margin: 0,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <Paperclip size={10} /> Attachments
                  <span style={{ fontWeight: 300, color: T.muted, textTransform: 'none', letterSpacing: 0 }}>
                    · images, documents, video
                  </span>
                </p>
                <label style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: T.gold, color: T.navy, border: 'none',
                  padding: '6px 16px', cursor: 'pointer',
                  fontFamily: jost, fontSize: 9, fontWeight: 500,
                  letterSpacing: '0.2em', textTransform: 'uppercase',
                  transition: 'background 0.25s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.gold2}
                onMouseLeave={e => e.currentTarget.style.background = T.gold}
                >
                  <Plus size={10} /> Add Files
                  <input type="file" multiple style={{ display: 'none' }}
                    accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx"
                    onChange={e => setNewMediaFiles(prev => [...prev, ...Array.from(e.target.files)])} />
                </label>
              </div>

              {/* Existing media (edit mode) */}
              {isEditing && (() => {
                const editingVendor = vendors.find(v => v._id === currentId);
                const existingMedia = (editingVendor?.media || []).filter(m => keepMediaIds.includes(m._id));
                return existingMedia.length > 0 ? (
                  <div style={{ marginBottom: 12 }}>
                    <p style={{
                      fontFamily: jost, fontSize: 9, fontWeight: 400,
                      letterSpacing: '0.2em', textTransform: 'uppercase',
                      color: T.muted, marginBottom: 8,
                    }}>
                      Existing Files
                    </p>
                    {existingMedia.map(m => (
                      <div key={m._id} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: 'white', border: `1px solid ${T.border}`,
                        padding: '10px 14px', marginBottom: 6,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          {mediaIcon(m.mimeType)}
                          <div style={{ minWidth: 0 }}>
                            <p style={{
                              fontFamily: jost, fontSize: 11, fontWeight: 500, color: T.text,
                              margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {m.name}
                            </p>
                            <p style={{ fontFamily: jost, fontSize: 9, fontWeight: 300, color: T.muted, margin: 0 }}>
                              {fmtSize(m.size)}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={e => handleDeleteMedia(currentId, m._id, e)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.danger, display: 'flex' }}
                          onMouseEnter={e => e.currentTarget.style.color = T.dangerHover}
                          onMouseLeave={e => e.currentTarget.style.color = T.danger}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null;
              })()}

              {/* Staged new files */}
              {newMediaFiles.length > 0 && (
                <div>
                  <p style={{
                    fontFamily: jost, fontSize: 9, fontWeight: 400,
                    letterSpacing: '0.2em', textTransform: 'uppercase',
                    color: T.gold, marginBottom: 8,
                  }}>
                    New Files ({newMediaFiles.length})
                  </p>
                  {newMediaFiles.map((f, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: T.dimBg, border: `1px solid ${T.borderG}`,
                      padding: '10px 14px', marginBottom: 6,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        {mediaIcon(f.type)}
                        <div style={{ minWidth: 0 }}>
                          <p style={{
                            fontFamily: jost, fontSize: 11, fontWeight: 500, color: T.gold,
                            margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {f.name}
                          </p>
                          <p style={{ fontFamily: jost, fontSize: 9, fontWeight: 300, color: T.muted, margin: 0 }}>
                            {fmtSize(f.size)}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => setNewMediaFiles(prev => prev.filter((_, j) => j !== i))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.danger, display: 'flex' }}
                        onMouseEnter={e => e.currentTarget.style.color = T.dangerHover}
                        onMouseLeave={e => e.currentTarget.style.color = T.danger}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {newMediaFiles.length === 0 && !(isEditing && vendors.find(v => v._id === currentId)?.media?.length) && (
                <p style={{
                  fontFamily: jost, fontSize: 11, fontWeight: 300,
                  color: 'rgba(0,0,0,0.2)', textAlign: 'center', padding: '12px 0',
                }}>
                  No files attached yet
                </p>
              )}
            </div>

            {/* Modal footer */}
            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: 14,
              borderTop: `1px solid ${T.border}`,
              padding: '20px 0 28px',
              position: 'sticky', bottom: 0,
              background: 'white',
            }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: jost, fontSize: 10, fontWeight: 400,
                  letterSpacing: '0.2em', textTransform: 'uppercase',
                  color: T.muted, padding: '10px 20px', transition: 'color 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = T.text}
                onMouseLeave={e => e.currentTarget.style.color = T.muted}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 10,
                  background: isSaving ? T.borderG : T.gold,
                  color: T.navy, border: 'none', padding: '12px 36px',
                  fontFamily: jost, fontSize: 10, fontWeight: 500,
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  cursor: isSaving ? 'not-allowed' : 'pointer', transition: 'background 0.25s',
                }}
                onMouseEnter={e => { if (!isSaving) e.currentTarget.style.background = T.gold2; }}
                onMouseLeave={e => { if (!isSaving) e.currentTarget.style.background = T.gold; }}
              >
                {isSaving && <Spinner />}
                {isSaving ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Media Lightbox ──────────────────────────────────────────────── */}
      {lightboxMedia && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
            zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
          onClick={() => setLightboxMedia(null)}
        >
          <button
            style={{
              position: 'absolute', top: 24, right: 24,
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.5)', transition: 'color 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'white'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
          >
            <X size={28} />
          </button>
          <div
            style={{ maxWidth: 900, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
            onClick={e => e.stopPropagation()}
          >
            {lightboxMedia.mimeType?.startsWith('image/') ? (
              <img src={lightboxMedia.url} alt={lightboxMedia.name}
                style={{ maxHeight: '80vh', maxWidth: '100%', objectFit: 'contain', borderRadius: 2 }} />
            ) : lightboxMedia.mimeType?.startsWith('video/') ? (
              <video src={lightboxMedia.url} controls autoPlay
                style={{ maxHeight: '80vh', maxWidth: '100%', borderRadius: 2 }} />
            ) : (
              <iframe src={lightboxMedia.url} title={lightboxMedia.name}
                style={{ width: '100%', height: '80vh', borderRadius: 2, background: 'white', border: 'none' }} />
            )}
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 20 }}>
              <span style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: 'rgba(255,255,255,0.6)' }}>
                {lightboxMedia.name}
              </span>
              <a
                href={lightboxMedia.url}
                download={lightboxMedia.name}
                onClick={e => e.stopPropagation()}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 20px', background: 'rgba(255,255,255,0.1)',
                  color: 'white', textDecoration: 'none',
                  fontFamily: jost, fontSize: 10, fontWeight: 400,
                  letterSpacing: '0.2em', textTransform: 'uppercase',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              >
                <Download size={13} /> Download
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorList;