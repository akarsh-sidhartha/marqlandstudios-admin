import React, { useState, useEffect, useRef } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import {
  Link2, Trash2, Send, Check, X, Edit3,
  Package, MapPin, ChevronUp, ChevronDown, ChevronRight,
  ExternalLink, RefreshCw, Copy, Eye, Paperclip, Download,
  ImagePlus, Plus, Loader2, Truck, AlertTriangle, Search,
  Layers, RotateCcw, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { requestNotifPermission, pushNotif, subscribeToPortalPush } from '../utils/portalNotifications';

/**
 * ClientPortalEditor — Marqland Design System
 * Navy (#0e1520) · Gold (#b8975a) · Cormorant Garamond + Jost
 * Rendered inside a `position: relative` wrapper in OrderTracker.
 * Includes integrated Dynamic Combo Creator (Combos tab).
 */

const CLIENT_BASE_URL = import.meta.env.VITE_CLIENT_URL?.replace(/\/$/, '') || 'https://www.marqlandstudios.com';

// ─── Design tokens ─────────────────────────────────────────────────────────
const T = {
  navy:    '#0e1520',
  gold:    '#b8975a',
  gold2:   '#d4b06a',
  goldGrad:'linear-gradient(135deg,#d4b06a,#b8975a)',
  offwhite:'#faf8f5',
  contHi:  '#f2efe9',
  text:    '#1a1a1a',
  muted:   '#888888',
  sub:     'rgba(26,26,26,0.45)',
  border:  'rgba(0,0,0,0.07)',
  borderG: 'rgba(184,151,90,0.2)',
  dimBg:   'rgba(184,151,90,0.05)',
  red:     '#dc2626',
  green:   '#16a34a',
  amber:   '#d97706',
};
const jost  = '"Jost", sans-serif';
const serif = '"Cormorant Garamond", Georgia, serif';
const INR   = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const fmtT  = d => new Date(d).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:true });

// ─── Micro-components ──────────────────────────────────────────────────────
const Label = ({ children, style }) => (
  <div style={{ fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.26em', textTransform: 'uppercase', color: T.muted, ...style }}>
    {children}
  </div>
);

const SectionHead = ({ children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
    <div style={{ width: 2, height: 13, background: T.gold, borderRadius: 2, flexShrink: 0 }} />
    <Label>{children}</Label>
  </div>
);

const Toggle = ({ on, onToggle }) => (
  <button onClick={onToggle}
    style={{ position: 'relative', display: 'inline-flex', width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', flexShrink: 0, background: on ? T.gold : 'rgba(0,0,0,0.12)', transition: 'background .2s', padding: 0 }}>
    <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.25)', transition: 'left .2s' }} />
  </button>
);

// ─── Budget tolerance helper ───────────────────────────────────────────────
function budgetToleranceLabel(B) {
  const n = Number(B);
  if (!n || n <= 0) return null;
  if (n <= 500)  return `${INR(Math.round(n * 0.9))} – ${INR(Math.round(n * 1.1))}  (±10%)`;
  if (n <= 1000) return `${INR(Math.round(n * 0.9))} – ${INR(n)}  (−10% to 0%)`;
  if (n <= 5000) return `${INR(n - 500)} – ${INR(n + 500)}  (±₹500)`;
  return `${INR(n - 1000)} – ${INR(n + 1000)}  (±₹1,000)`;
}

// ──────────────────────────────────────────────────────────────────────────
const ClientPortalEditor = ({ order, onClose }) => {
  const { user } = useAuth();

  // ── Core state ─────────────────────────────────────────────────────────
  const [portal, setPortal]           = useState(null);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [tab, setTab]                 = useState('items');
  const [msg, setMsg]                 = useState('');
  const [chatFiles, setChatFiles]     = useState([]);
  const [sendingMsg, setSendingMsg]   = useState(false);
  const [copied, setCopied]           = useState(false);
  const [editNote, setEditNote]       = useState(false);
  const [noteText, setNoteText]       = useState('');
  const [collapsed, setCollapsed]     = useState({});
  const [shipments, setShipments]     = useState([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(false);
  const [shipmentSearch, setShipmentSearch]     = useState('');
  const [syncingOffsite, setSyncingOffsite]     = useState(false);
  const chatEndRef         = useRef(null);
  const chatFileRef        = useRef(null);
  const customImageRef     = useRef(null);
  const pollTimer          = useRef(null);
  const prevClientMsgCount = useRef(0);

  // ── Price override ─────────────────────────────────────────────────────
  const [priceEdits, setPriceEdits] = useState({});
  const startPriceEdit  = (id, p) => setPriceEdits(s => ({ ...s, [id]: { editing: true, value: String(p ?? '') } }));
  const cancelPriceEdit = (id)    => setPriceEdits(s => { const n = { ...s }; delete n[id]; return n; });
  const savePriceOverride = async (itemId) => {
    const raw = priceEdits[itemId]?.value ?? '';
    const price = raw === '' ? null : Number(raw);
    if (price !== null && isNaN(price)) return;
    const calcState = portal.calculatorState || {};
    const cur = calcState[itemId] || {};
    const newState = { ...calcState, [itemId]: { ...cur, priceOverride: price === null ? undefined : price } };
    if (price === null) delete newState[itemId].priceOverride;
    try { await api.put(`/portal/${portal.slug}/calculator`, { calculatorState: newState }); setPortal(p => ({ ...p, calculatorState: newState })); } catch (e) { console.error(e); }
    cancelPriceEdit(itemId);
  };

  // ── Custom offsite add-ons ─────────────────────────────────────────────
  const [addonForms, setAddonForms] = useState({});
  const openAddonForm  = (id) => setAddonForms(p => ({ ...p, [id]: { show: true, name: '', price: '', pricingType: 'flat' } }));
  const closeAddonForm = (id) => setAddonForms(p => { const n = { ...p }; delete n[id]; return n; });
  const saveCustomAddon = async (itemId) => {
    const form = addonForms[itemId]; if (!form?.name?.trim()) return;
    const price = form.price !== '' ? Number(form.price) : 0;
    const calcState = portal.calculatorState || {}; const cur = calcState[itemId] || {};
    const newState = { ...calcState, [itemId]: { ...cur, portalCustomAddons: [...(cur.portalCustomAddons || []), { name: form.name.trim(), price, pricingType: form.pricingType || 'flat' }] } };
    try { await api.put(`/portal/${portal.slug}/calculator`, { calculatorState: newState }); setPortal(p => ({ ...p, calculatorState: newState })); } catch (e) { console.error(e); }
    closeAddonForm(itemId);
  };
  const removeCustomAddon = async (itemId, addonIdx) => {
    const calcState = portal.calculatorState || {}; const cur = calcState[itemId] || {};
    const updated = (cur.portalCustomAddons || []).filter((_, i) => i !== addonIdx);
    const newState = { ...calcState, [itemId]: { ...cur, portalCustomAddons: updated } };
    try { await api.put(`/portal/${portal.slug}/calculator`, { calculatorState: newState }); setPortal(p => ({ ...p, calculatorState: newState })); } catch (e) { console.error(e); }
  };

  // ── Custom product item ────────────────────────────────────────────────
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customForm, setCustomForm]         = useState({ name:'', description:'', price:'' });
  const [customImage, setCustomImage]       = useState(null);
  const [customPreview, setCustomPreview]   = useState(null);
  const [savingCustom, setSavingCustom]     = useState(false);
  const resetCustomForm = () => { setShowCustomForm(false); setCustomForm({ name:'', description:'', price:'' }); setCustomImage(null); setCustomPreview(null); };
  const handleCustomImagePick = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setCustomImage(file);
    const r = new FileReader(); r.onload = ev => setCustomPreview(ev.target.result); r.readAsDataURL(file);
    e.target.value = '';
  };
  const handleAddCustomItem = async () => {
    if (!customForm.name.trim() || !portal) return;
    setSavingCustom(true);
    try {
      let imageUrl = '';
      if (customImage) { const fd = new FormData(); fd.append('image', customImage); const up = await api.post('/products/upload-temp-image', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); imageUrl = up.data?.imageUrl || ''; }
      const newItem = { productId:'', name: customForm.name.trim(), description: customForm.description.trim(), imageUrl, price: customForm.price !== '' ? Number(customForm.price) : 0, category:'Custom', subCategory:'', note:'', order:0 };
      await api.put(`/portal/${portal.slug}/items`, { productItems: [...(portal.productItems || []), newItem] });
      await loadPortal(true); resetCustomForm();
    } catch (err) { alert('Failed: ' + (err.response?.data?.message || err.message)); } finally { setSavingCustom(false); }
  };

  // ── Combo Creator state ────────────────────────────────────────────────
  const [comboBudget, setComboBudget]           = useState('');
  const [comboOpen, setComboOpen]               = useState(false); // collapsible panel in Options tab
  const [comboSelCats, setComboSelCats]         = useState([]);
  const [comboSelSubs, setComboSelSubs]         = useState([]);
  const [comboMaxResults, setComboMaxResults]   = useState(20);
  const [comboGenerating, setComboGenerating]   = useState(false);
  const [comboError, setComboError]             = useState('');
  const [comboResults, setComboResults]         = useState([]);
  const [allCombos, setAllCombos]               = useState([]);
  const [combosLoading, setCombosLoading]       = useState(false);
  const [comboDeletingId, setComboDeletingId]   = useState(null);
  const [attachingComboId, setAttachingComboId] = useState(null);
  const [comboSearch, setComboSearch]           = useState('');
  const [productMeta, setProductMeta]           = useState({ categories: [], subCategories: {} });

  const loadAllCombos = async () => {
    setCombosLoading(true);
    try { const res = await api.get('/combos'); setAllCombos(Array.isArray(res.data) ? res.data : []); }
    catch (e) { console.error('load combos failed', e); } finally { setCombosLoading(false); }
  };
  const loadProductMeta = async () => {
    try { const res = await api.get('/products/meta'); setProductMeta(res.data || { categories: [], subCategories: {} }); }
    catch (e) { console.error('load meta failed', e); }
  };
  const generateCombos = async () => {
    const B = Number(comboBudget);
    if (!B || B <= 0) { setComboError('Enter a valid budget greater than 0'); return; }
    setComboGenerating(true); setComboError(''); setComboResults([]);
    try {
      const res = await api.post('/combos/generate', { budget: B, categories: comboSelCats, subCategories: comboSelSubs, maxResults: comboMaxResults });
      const combos = res.data.combos || [];
      setComboResults(combos);
      setAllCombos(prev => [...combos, ...prev.filter(c => !combos.find(nc => nc._id === c._id))]);
      if (!combos.length) setComboError('No valid combinations found. Try adjusting the budget or broadening category selection.');
    } catch (e) { setComboError(e.response?.data?.message || e.message); } finally { setComboGenerating(false); }
  };
  const deleteCombo = async (id) => {
    setComboDeletingId(id);
    try { await api.delete(`/combos/${id}`); setAllCombos(prev => prev.filter(c => c._id !== id)); setComboResults(prev => prev.filter(c => c._id !== id)); }
    catch (e) { console.error('delete combo failed', e); } finally { setComboDeletingId(null); }
  };
  const attachCombo = async (combo) => {
    if (!portal) return; setAttachingComboId(combo._id);
    try {
      const existing = portal.comboItems || [];
      if (existing.some(c => String(c.comboId) === String(combo._id))) return;
      const newComboItem = {
        comboId: String(combo._id), label: combo.label || '', totalPrice: combo.totalPrice || 0, collageImageUrl: combo.collageImageUrl || '',
        items: (combo.items || []).map((item, i) => ({ productId: String(item.productId || ''), name: item.name, description: item.description || '', imageUrl: item.imageUrl || '', additionalImages: item.additionalImages || [], videoUrl: item.videoUrl || '', price: item.price || 0, category: item.category || '', subCategory: item.subCategory || '', order: i })),
        note: '', order: existing.length,
      };
      await api.put(`/portal/${portal.slug}/combo-items`, { comboItems: [...existing, newComboItem] });
      await loadPortal(true);
    } catch (e) { console.error('attach combo failed', e); } finally { setAttachingComboId(null); }
  };
  const detachCombo = async (comboItemId) => {
    if (!portal) return;
    const updated = (portal.comboItems || []).filter(c => String(c._id) !== String(comboItemId));
    try { await api.put(`/portal/${portal.slug}/combo-items`, { comboItems: updated }); await loadPortal(true); }
    catch (e) { console.error('detach combo failed', e); }
  };
  const toggleComboCat = (cat) => setComboSelCats(p => p.includes(cat) ? p.filter(c => c !== cat) : [...p, cat]);
  const toggleComboSub = (sc)  => setComboSelSubs(p => p.includes(sc)  ? p.filter(s => s !== sc)  : [...p, sc]);

  // ── URLs ───────────────────────────────────────────────────────────────
  const fallbackSlug = order.refNumber?.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const portalUrl = portal?.slug ? `${CLIENT_BASE_URL}/p/${portal.slug}` : `${CLIENT_BASE_URL}/p/${fallbackSlug}`;

  // ── Data loading ───────────────────────────────────────────────────────
  useEffect(() => {
    requestNotifPermission(); loadPortal();
    pollTimer.current = setInterval(() => loadPortal(true), 12000);
    return () => clearInterval(pollTimer.current);
  }, [order._id]);
  useEffect(() => { if (tab === 'chat') chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [portal?.messages, tab]);
  useEffect(() => { if (tab === 'shipments' && portal?.type === 'product' && order._id) loadShipments(); }, [tab, order._id]);
  useEffect(() => { if (comboOpen && portal?.type === 'product') { loadAllCombos(); loadProductMeta(); } }, [comboOpen]);

  const loadShipments = async () => {
    setShipmentsLoading(true);
    try { const res = await api.get(`/shipments?orderId=${order._id}`); setShipments(Array.isArray(res.data) ? res.data : []); }
    catch { setShipments([]); } finally { setShipmentsLoading(false); }
  };

  const loadPortal = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.get(`/portal/order/${order._id}`);
      const data = res.data;
      if (silent) {
        const clientMsgs = (data.messages || []).filter(m => m.sender === 'client');
        if (prevClientMsgCount.current > 0 && clientMsgs.length > prevClientMsgCount.current) {
          const newest = clientMsgs[clientMsgs.length - 1];
          const preview = newest.text ? newest.text.slice(0, 60) + (newest.text.length > 60 ? '…' : '') : newest.attachments?.length ? `📎 ${newest.attachments[0].name}` : 'New message';
          pushNotif(`${newest.senderName || data.clientName || 'Client'} sent a message`, preview, `portal-client-msg-${data.slug}`);
        }
        prevClientMsgCount.current = (data.messages || []).filter(m => m.sender === 'client').length;
      } else {
        prevClientMsgCount.current = (data.messages || []).filter(m => m.sender === 'client').length;
      }
      setPortal(data); setNoteText(data.teamNote || '');
    } catch (err) { if (err.response?.status === 404) await createPortal(); } finally { if (!silent) setLoading(false); }
  };

  const createPortal = async () => {
    const res = await api.post('/portal', { orderId: order._id, type: order.orderType || 'product', orderRef: order.refNumber || order._id.slice(-8), clientName: order.clientName, clientEmail: order.clientEmail || '', title: order.title });
    setPortal(res.data); setNoteText('');
  };

  const removeItem = async (itemId) => { if (!portal) return; const key = portal.type === 'product' ? 'productItems' : 'offsiteItems'; await saveItems(portal[key].filter(i => i._id !== itemId)); };
  const moveItem = async (itemId, dir) => {
    if (!portal) return;
    const key = portal.type === 'product' ? 'productItems' : 'offsiteItems';
    const arr = [...portal[key]]; const idx = arr.findIndex(i => i._id === itemId);
    if (dir === 'up' && idx > 0) [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]];
    if (dir === 'down' && idx < arr.length - 1) [arr[idx], arr[idx+1]] = [arr[idx+1], arr[idx]];
    await saveItems(arr);
  };
  const saveItems = async (items) => {
    setSaving(true);
    try { const key = portal.type === 'product' ? 'productItems' : 'offsiteItems'; const res = await api.put(`/portal/${portal.slug}/items`, { [key]: items }); setPortal(res.data); } finally { setSaving(false); }
  };
  const sendMessage = async () => {
    if ((!msg.trim() && chatFiles.length === 0) || sendingMsg) return;
    const perm = await requestNotifPermission(); if (perm === 'granted') subscribeToPortalPush(fetch);
    setSendingMsg(true);
    try {
      const fd = new FormData(); fd.append('text', msg.trim()); fd.append('senderName', user?.name || 'Marqland Team'); chatFiles.forEach(f => fd.append('files', f));
      await api.post(`/portal/${portal.slug}/message/team`, fd); setMsg(''); setChatFiles([]); await loadPortal();
    } finally { setSendingMsg(false); }
  };
  const syncOffsite = async () => {
    if (!portal || syncingOffsite) return; setSyncingOffsite(true);
    try { const res = await api.post(`/portal/${portal.slug}/sync-offsite`); setPortal(res.data.portal || res.data); }
    catch (err) { console.error('sync-offsite failed:', err); } finally { setSyncingOffsite(false); }
  };
  const saveMeta = async () => {
    setSaving(true);
    try { const res = await api.put(`/portal/${portal.slug}/meta`, { teamNote: noteText }); setPortal(res.data); setEditNote(false); } finally { setSaving(false); }
  };
  const copyLink = () => { navigator.clipboard.writeText(portalUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const toggleCollapse = (cat) => setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }));

  // ── Guards ─────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '60px 0', background: T.offwhite }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 30, height: 30, border: '2px solid rgba(184,151,90,0.2)', borderTopColor: T.gold, borderRadius: '50%', animation: 'pe-spin .8s linear infinite', margin: '0 auto 10px' }} />
        <Label>Loading portal…</Label>
      </div>
    </div>
  );
  if (!portal) return null;

  const items       = portal.type === 'product' ? portal.productItems : portal.offsiteItems;
  const isCompleted = portal.status === 'completed';
  const comboCount  = (portal.comboItems || []).length;

  // ── Shared inline styles ───────────────────────────────────────────────
  const inputSt = { fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.text, border: `1px solid ${T.border}`, background: '#fff', outline: 'none', padding: '8px 11px', width: '100%', boxSizing: 'border-box' };
  const btnGold = { display: 'inline-flex', alignItems: 'center', gap: 6, background: T.gold, color: T.navy, border: 'none', cursor: 'pointer', fontFamily: jost, fontSize: 9, fontWeight: 500, letterSpacing: '0.24em', textTransform: 'uppercase', padding: '9px 18px', transition: 'background .2s' };
  const btnGhost = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', color: T.muted, border: `1px solid ${T.border}`, cursor: 'pointer', fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '8px 14px', transition: 'all .2s' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: T.offwhite, fontFamily: jost }}>
      <style>{`
        @keyframes pe-spin { to { transform: rotate(360deg); } }
        @keyframes pe-fadein { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
        .pe-card { background:#fff; border:1px solid rgba(0,0,0,0.07); transition:box-shadow .2s; }
        .pe-card:hover { box-shadow:0 4px 20px rgba(0,0,0,0.07); }
        .pe-input:focus { border-color:${T.gold}!important; }
        .pe-tab-active { border-bottom:2px solid ${T.gold}!important; color:${T.gold}!important; }
        .pe-tab-idle { border-bottom:2px solid transparent!important; color:${T.sub}; }
        .pe-tab-idle:hover { color:${T.text}; }
        .pe-btn-gold:hover { background:${T.gold2}!important; }
        .pe-btn-ghost:hover { border-color:${T.gold}!important; color:${T.gold}!important; }
        .pe-item-actions { opacity:0; transition:opacity .15s; }
        .pe-item-row:hover .pe-item-actions { opacity:1!important; }
        .pe-item-row { transition:background .15s; }
        .pe-item-row:hover { background:${T.contHi}; }
        ::-webkit-scrollbar { width:3px; }
        ::-webkit-scrollbar-thumb { background:rgba(184,151,90,0.3); border-radius:10px; }
      `}</style>

      {/* ══ HEADER ══════════════════════════════════════════════════════ */}
      <div style={{ background: T.navy, padding: '14px 18px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{ width: 32, height: 32, background: T.goldGrad, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Link2 size={14} style={{ color: T.navy }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: serif, fontSize: 14, fontWeight: 300, color: '#fff', lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {portal.clientName || order.clientName || 'Client Portal'}
              </div>
              <div style={{ fontFamily: jost, fontSize: 8, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.2em', textTransform: 'uppercase', marginTop: 2 }}>
                {portal.type === 'product' ? 'Product Gifting' : 'Offsite'} · {portal.orderRef}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {isCompleted && <span style={{ fontFamily: jost, fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)', padding: '2px 8px' }}>Completed</span>}
            {portal.viewCount > 0 && <span style={{ fontFamily: jost, fontSize: 9, color: 'rgba(255,255,255,0.28)' }}>👁 {portal.viewCount}</span>}
            <button onClick={copyLink} className="pe-btn-ghost"
              style={{ ...btnGhost, color: copied ? '#4ade80' : 'rgba(255,255,255,0.4)', borderColor: copied ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.12)', padding: '6px 10px' }}>
              {copied ? <Check size={10} /> : <Copy size={10} />}
              <span style={{ fontFamily: jost, fontSize: 8, letterSpacing: '0.18em' }}>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <a href={portalUrl} target="_blank" rel="noreferrer" style={{ ...btnGold, textDecoration: 'none', padding: '6px 12px' }} className="pe-btn-gold">
              <Eye size={10} /> Preview
            </a>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.28)', padding: 3, display: 'flex' }}><X size={15} /></button>
          </div>
        </div>
      </div>

      {/* ══ TAB BAR ═════════════════════════════════════════════════════ */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${T.border}`, display: 'flex', flexShrink: 0, overflowX: 'auto' }}>
        {[
          { k:'items',     l:'Options',    b: items.length,                               show: true },
          { k:'selected',  l:'Shortlist',  b: (portal.shortlistedIds||[]).length || null, show: portal.type !== 'offsite' },
          { k:'shipments', l:'Shipments',  b: null,                                       show: portal.type === 'product' },
          { k:'chat',      l:'Messages',   b: portal.messages.length || null,             show: true },
        ].filter(t => t.show).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={tab === t.k ? 'pe-tab-active' : 'pe-tab-idle'}
            style={{ flex: 1, padding: '12px 6px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: jost, fontSize: 8, fontWeight: 400, letterSpacing: '0.22em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, transition: 'color .15s', whiteSpace: 'nowrap' }}>
            {t.l}
            {t.b != null && (
              <span style={{ fontFamily: jost, fontSize: 7, background: tab === t.k ? 'rgba(184,151,90,0.12)' : 'rgba(0,0,0,0.05)', color: tab === t.k ? T.gold : T.sub, padding: '1px 5px', letterSpacing: '0.04em' }}>{t.b}</span>
            )}
          </button>
        ))}
      </div>

      {/* ══ TAB CONTENT ═════════════════════════════════════════════════ */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* ── ITEMS ──────────────────────────────────────────────────── */}
        {tab === 'items' && (
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Team note */}
            <div style={{ background: T.dimBg, border: `1px solid ${T.borderG}`, padding: '11px 13px' }}>
              {editNote ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <textarea value={noteText} onChange={e => setNoteText(e.target.value)} style={{ ...inputSt, resize: 'none', lineHeight: 1.6 }} rows={3} placeholder="Write an intro note for the client…" className="pe-input" />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={saveMeta} disabled={saving} style={btnGold} className="pe-btn-gold">Save</button>
                    <button onClick={() => setEditNote(false)} style={btnGhost} className="pe-btn-ghost">Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <p style={{ fontFamily: jost, fontSize: 11, color: noteText ? T.text : T.muted, lineHeight: 1.6, flex: 1, fontStyle: noteText ? 'normal' : 'italic', margin: 0 }}>{noteText || 'Add an intro note for the client…'}</p>
                  <button onClick={() => setEditNote(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.gold, padding: 2, display: 'flex' }}><Edit3 size={12} /></button>
                </div>
              )}
            </div>

            {/* Items list */}
            {items.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: T.muted }}>
                <Package size={24} style={{ opacity: 0.18, display: 'block', margin: '0 auto 10px' }} />
                <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 300, color: T.text, marginBottom: 5 }}>No items added yet</div>
                <div style={{ fontFamily: jost, fontSize: 10, color: T.muted }}>Go to {portal.type === 'product' ? 'Products' : 'Properties'} → "Add to Portal"</div>
              </div>
            ) : portal.type === 'product' ? (
              (() => {
                const groupMap = new Map();
                items.forEach((item, originalIdx) => { const cat = item.category || 'Uncategorised'; if (!groupMap.has(cat)) groupMap.set(cat, []); groupMap.get(cat).push({ item, originalIdx }); });
                return Array.from(groupMap.entries()).map(([cat, entries]) => {
                  const isOpen = !collapsed[cat];
                  return (
                    <div key={cat} className="pe-card" style={{ overflow: 'hidden' }}>
                      <button onClick={() => toggleCollapse(cat)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 13px', background: T.offwhite, border: 'none', cursor: 'pointer', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <div style={{ width: 2, height: 11, background: T.gold, borderRadius: 2, flexShrink: 0 }} />
                          <Label>{cat}</Label>
                          <span style={{ fontFamily: jost, fontSize: 9, color: T.muted }}>{entries.length}</span>
                        </div>
                        {isOpen ? <ChevronDown size={11} style={{ color: T.muted }} /> : <ChevronRight size={11} style={{ color: T.muted }} />}
                      </button>
                      {isOpen && entries.map(({ item, originalIdx: idx }) => (
                        <div key={item._id} className="pe-item-row" style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '9px 13px', borderTop: `1px solid ${T.border}` }}>
                          <div style={{ width: 40, height: 40, background: T.offwhite, overflow: 'hidden', flexShrink: 0, border: `1px solid ${T.border}` }}>
                            {item.imageUrl ? <img src={item.imageUrl} alt={item.name} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} /> : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center' }}><Package size={13} style={{ color: T.border }} /></div>}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: jost, fontSize: 11, fontWeight: 500, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                            {(() => {
                              const calcState = portal.calculatorState || {}; const override = calcState[item._id]?.priceOverride; const editing = priceEdits[item._id]; const basePrice = Number(item.price || 0); const displayPrice = override != null ? Number(override) : basePrice;
                              if (editing) return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                                  <span style={{ fontFamily: jost, fontSize: 10, color: T.muted }}>₹</span>
                                  <input type="number" min="0" autoFocus value={editing.value} onChange={e => setPriceEdits(p => ({ ...p, [item._id]: { ...p[item._id], value: e.target.value } }))} onKeyDown={e => { if (e.key === 'Enter') savePriceOverride(item._id); if (e.key === 'Escape') cancelPriceEdit(item._id); }} style={{ ...inputSt, width: 72, padding: '3px 6px', fontSize: 11 }} className="pe-input" />
                                  <button onClick={() => savePriceOverride(item._id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.green, display: 'flex' }}><Check size={11} /></button>
                                  <button onClick={() => cancelPriceEdit(item._id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, display: 'flex' }}><X size={11} /></button>
                                </div>
                              );
                              return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                                  <span style={{ fontFamily: jost, fontSize: 10, color: override != null ? T.amber : T.muted, fontWeight: 500 }}>{INR(displayPrice)}</span>
                                  {override != null && <span style={{ fontFamily: jost, fontSize: 9, color: T.muted, textDecoration: 'line-through' }}>{INR(basePrice)}</span>}
                                  <button onClick={() => startPriceEdit(item._id, displayPrice)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, display: 'flex' }} title="Override price"><Edit3 size={10} /></button>
                                  {override != null && <button onClick={async () => { const cs = portal.calculatorState||{}; const cur = { ...(cs[item._id]||{}) }; delete cur.priceOverride; const ns={...cs,[item._id]:cur}; try { await api.put(`/portal/${portal.slug}/calculator`,{calculatorState:ns}); setPortal(p=>({...p,calculatorState:ns})); } catch(e){console.error(e);} }} style={{ fontFamily: jost, fontSize: 9, color: T.amber, background: 'none', border: 'none', cursor: 'pointer' }}>reset</button>}
                                </div>
                              );
                            })()}
                            <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                              {(item.additionalImages||[]).length > 0 && <span style={{ fontFamily: jost, fontSize: 7, background: 'rgba(124,58,237,0.08)', color: '#7c3aed', padding: '2px 5px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>+{item.additionalImages.length} photos</span>}
                              {item.videoUrl && <span style={{ fontFamily: jost, fontSize: 7, background: 'rgba(220,38,38,0.06)', color: '#dc2626', padding: '2px 5px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>🎬 video</span>}
                              {item.note && <span style={{ fontFamily: jost, fontSize: 9, color: T.gold, fontStyle: 'italic' }}>{item.note}</span>}
                            </div>
                          </div>
                          <div className="pe-item-actions" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <button onClick={() => moveItem(item._id, 'up')} disabled={idx === 0} style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: T.muted, padding: 3, opacity: idx === 0 ? 0.2 : 1, display: 'flex' }}><ChevronUp size={12} /></button>
                            <button onClick={() => moveItem(item._id, 'down')} disabled={idx === items.length - 1} style={{ background: 'none', border: 'none', cursor: idx === items.length - 1 ? 'default' : 'pointer', color: T.muted, padding: 3, opacity: idx === items.length - 1 ? 0.2 : 1, display: 'flex' }}><ChevronDown size={12} /></button>
                            <button onClick={() => removeItem(item._id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, padding: 3, display: 'flex', transition: 'color .15s' }} onMouseEnter={e => e.currentTarget.style.color=T.red} onMouseLeave={e => e.currentTarget.style.color=T.muted}><Trash2 size={12} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                });
              })()
            ) : (
              /* ── Offsite items ── */
              (() => {
                const STD_ADDONS = [{ priceKey:'djCost', label:'DJ' }, { priceKey:'licenseFeeDJ', label:'DJ Licence' }, { priceKey:'cocktailSnacks', label:'Cocktails & Snacks' }, { priceKey:'banquetHall', label:'Banquet Hall' }];
                const NIGHT_ROOMS = [{ key:'single', label:'Single', priceKey:'singlePrice' }, { key:'double', label:'Double', priceKey:'doublePrice' }, { key:'triple', label:'Triple', priceKey:'triplePrice' }, { key:'quad', label:'Quad', priceKey:'quadPrice' }];
                const calcState = portal.calculatorState || {};
                const saveCalcState = async (newState) => { try { await api.put(`/portal/${portal.slug}/calculator`, { calculatorState: newState }); setPortal(p => ({ ...p, calculatorState: newState })); } catch (e) { console.error(e); } };
                const getItemState = (id) => calcState[id] || {};
                const setRoomCount = async (id, key, val) => { const cur = getItemState(id); await saveCalcState({ ...calcState, [id]: { ...cur, [key]: Math.max(0, Number(val)||0) } }); };
                const setGuests = async (id, val) => { const cur = getItemState(id); await saveCalcState({ ...calcState, [id]: { ...cur, pax: Math.max(0, Number(val)||0) } }); };
                const toggleRoomDisabled = async (id, rk) => { const cur = getItemState(id); const d = cur.disabledRooms||{}; await saveCalcState({ ...calcState, [id]: { ...cur, disabledRooms: { ...d, [rk]: !d[rk] } } }); };
                const toggleCatRoomDisabled = async (id, catId, rk) => { const cur = getItemState(id); const d = cur.disabledRooms||{}; const ck = `cat_${catId}_${rk}`; await saveCalcState({ ...calcState, [id]: { ...cur, disabledRooms: { ...d, [ck]: !d[ck] } } }); };
                const setCatRoomCount = async (id, catId, rk, val) => { const cur = getItemState(id); const ck = `cat_${catId}_${rk}`; await saveCalcState({ ...calcState, [id]: { ...cur, [ck]: Math.max(0, Number(val)||0) } }); };
                const toggleAddonDisabled = async (id, ak) => { const cur = getItemState(id); const d = cur.disabledAddons||{}; await saveCalcState({ ...calcState, [id]: { ...cur, disabledAddons: { ...d, [ak]: !d[ak] } } }); };
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button onClick={syncOffsite} disabled={syncingOffsite} style={btnGhost} className="pe-btn-ghost">
                        {syncingOffsite ? <><Loader2 size={10} style={{ animation: 'pe-spin .7s linear infinite' }} /> Syncing…</> : <><RefreshCw size={10} /> Sync rooms</>}
                      </button>
                    </div>
                    {items.map((item, idx) => {
                      const isDayOut = item.type !== 'Night Stay';
                      const stdVisible = STD_ADDONS.filter(a => (item[a.priceKey]||0) > 0);
                      const adhocVisible = (item.adhocAddons||[]).filter(a => (a.sellingPrice||0) > 0);
                      const nightRooms = isDayOut ? [] : NIGHT_ROOMS.filter(r => (item[r.priceKey]||0) > 0);
                      const itemState = getItemState(item._id);
                      const disabledMap = itemState.disabledAddons || {};
                      const disabledRooms = itemState.disabledRooms || {};
                      return (
                        <div key={item._id} className="pe-card" style={{ overflow: 'hidden' }}>
                          <div className="pe-item-row" style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '9px 13px' }}>
                            <div style={{ width: 40, height: 40, background: T.offwhite, overflow: 'hidden', flexShrink: 0, border: `1px solid ${T.border}` }}>
                              {item.imageUrl ? <img src={item.imageUrl} alt={item.name} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} /> : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center' }}><MapPin size={13} style={{ color: T.border }} /></div>}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: jost, fontSize: 11, fontWeight: 500, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                              <div style={{ fontFamily: jost, fontSize: 10, color: T.muted, marginTop: 2 }}>{item.location}{item.doublePrice>0?` · ${INR(item.doublePrice)}/double`:''}{item.dayPackages?.length?` · ${item.dayPackages.length} pkgs`:''}</div>
                              {item.note && <div style={{ fontFamily: jost, fontSize: 9, color: T.gold, fontStyle: 'italic', marginTop: 2 }}>{item.note}</div>}
                            </div>
                            <div className="pe-item-actions" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <button onClick={() => moveItem(item._id,'up')} disabled={idx===0} style={{ background:'none', border:'none', cursor:idx===0?'default':'pointer', color:T.muted, padding:3, opacity:idx===0?0.2:1, display:'flex' }}><ChevronUp size={12}/></button>
                              <button onClick={() => moveItem(item._id,'down')} disabled={idx===items.length-1} style={{ background:'none', border:'none', cursor:idx===items.length-1?'default':'pointer', color:T.muted, padding:3, opacity:idx===items.length-1?0.2:1, display:'flex' }}><ChevronDown size={12}/></button>
                              <button onClick={() => removeItem(item._id)} style={{ background:'none', border:'none', cursor:'pointer', color:T.muted, padding:3, display:'flex', transition:'color .15s' }} onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.muted}><Trash2 size={12}/></button>
                            </div>
                          </div>
                          <div style={{ borderTop: `1px solid ${T.border}`, background: T.offwhite, padding: '10px 13px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                            {isDayOut && (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Label>Guests</Label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                  <button onClick={() => setGuests(item._id, Math.max(0,(Number(itemState.pax)||0)-1))} style={{ width:20, height:20, border:`1px solid ${T.border}`, background:'#fff', cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
                                  <input type="number" min="0" value={itemState.pax??''} placeholder="0" onChange={e=>setGuests(item._id,e.target.value)} style={{ ...inputSt, width:46, textAlign:'center', padding:'3px 0' }} className="pe-input" />
                                  <button onClick={() => setGuests(item._id, (Number(itemState.pax)||0)+1)} style={{ width:20, height:20, border:`1px solid ${T.border}`, background:'#fff', cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
                                  <span style={{ fontFamily:jost, fontSize:9, color:T.muted }}>guests</span>
                                </div>
                              </div>
                            )}
                            {!isDayOut && nightRooms.length > 0 && (
                              <div>
                                <Label style={{ marginBottom: 6 }}>Room Count</Label>
                                {nightRooms.map(r => {
                                  const isOff = !!disabledRooms[r.key]; const rc = itemState[r.key]??'';
                                  return (
                                    <div key={r.key} style={{ display:'flex', alignItems:'center', gap:7, marginBottom:5 }}>
                                      <Toggle on={!isOff} onToggle={() => toggleRoomDisabled(item._id, r.key)} />
                                      <span style={{ fontFamily:jost, fontSize:10, color:isOff?T.muted:T.text, width:40, flexShrink:0 }}>{r.label}</span>
                                      <span style={{ fontFamily:jost, fontSize:9, color:T.muted, flex:1 }}>{INR(item[r.priceKey])}/night</span>
                                      {!isOff && <div style={{ display:'flex', alignItems:'center', gap:3 }}>
                                        <button onClick={() => setRoomCount(item._id,r.key,Math.max(0,(Number(rc)||0)-1))} style={{ width:17, height:17, border:`1px solid ${T.border}`, background:'#fff', cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
                                        <input type="number" min="0" value={rc} placeholder="0" onChange={e=>setRoomCount(item._id,r.key,e.target.value)} style={{ ...inputSt, width:40, textAlign:'center', padding:'2px 0' }} className="pe-input" />
                                        <button onClick={() => setRoomCount(item._id,r.key,(Number(rc)||0)+1)} style={{ width:17, height:17, border:`1px solid ${T.border}`, background:'#fff', cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
                                        <span style={{ fontFamily:jost, fontSize:8, color:T.muted }}>rooms</span>
                                      </div>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {!isDayOut && (item.roomCategories||[]).length > 0 && (
                              <div>
                                <Label style={{ marginBottom: 6 }}>Room Categories</Label>
                                {(item.roomCategories||[]).map(cat => {
                                  const catRooms = [{ key:'single', label:'Single', price:cat.singlePrice }, { key:'double', label:'Double', price:cat.doublePrice }, { key:'triple', label:'Triple', price:cat.triplePrice }].filter(r => r.price > 0);
                                  if (!catRooms.length) return null;
                                  const catId = cat._id||cat.name; const ck = `cat_${catId}`; const isCatOff = !!disabledRooms[ck];
                                  return (
                                    <div key={catId} style={{ border:`1px solid ${T.border}`, marginBottom:5, overflow:'hidden' }}>
                                      <div style={{ display:'flex', alignItems:'center', gap:7, padding:'6px 9px', background:T.offwhite }}>
                                        <Toggle on={!isCatOff} onToggle={() => toggleRoomDisabled(item._id, ck)} />
                                        <span style={{ fontFamily:jost, fontSize:9, color:isCatOff?T.muted:T.gold, fontWeight:500, letterSpacing:'0.1em', textTransform:'uppercase' }}>{cat.name}</span>
                                      </div>
                                      {!isCatOff && <div style={{ padding:'5px 9px', display:'flex', flexDirection:'column', gap:4 }}>
                                        {catRooms.map(r => {
                                          const compKey = `cat_${catId}_${r.key}`; const isOff = !!disabledRooms[compKey]; const rc = itemState[compKey]??'';
                                          return (
                                            <div key={r.key} style={{ display:'flex', alignItems:'center', gap:7 }}>
                                              <Toggle on={!isOff} onToggle={() => toggleCatRoomDisabled(item._id,catId,r.key)} />
                                              <span style={{ fontFamily:jost, fontSize:10, color:isOff?T.muted:T.text, width:40, flexShrink:0 }}>{r.label}</span>
                                              <span style={{ fontFamily:jost, fontSize:9, color:T.muted, flex:1 }}>{INR(r.price)}/night</span>
                                              {!isOff && <div style={{ display:'flex', alignItems:'center', gap:3 }}>
                                                <button onClick={() => setCatRoomCount(item._id,catId,r.key,Math.max(0,(Number(rc)||0)-1))} style={{ width:17, height:17, border:`1px solid ${T.border}`, background:'#fff', cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
                                                <input type="number" min="0" value={rc} placeholder="0" onChange={e=>setCatRoomCount(item._id,catId,r.key,e.target.value)} style={{ ...inputSt, width:40, textAlign:'center', padding:'2px 0' }} className="pe-input" />
                                                <button onClick={() => setCatRoomCount(item._id,catId,r.key,(Number(rc)||0)+1)} style={{ width:17, height:17, border:`1px solid ${T.border}`, background:'#fff', cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
                                                <span style={{ fontFamily:jost, fontSize:8, color:T.muted }}>rooms</span>
                                              </div>}
                                            </div>
                                          );
                                        })}
                                      </div>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {(stdVisible.length > 0 || adhocVisible.length > 0) && (
                              <div>
                                <Label style={{ marginBottom: 6 }}>Add-on Visibility</Label>
                                {[...stdVisible.map(a => ({ key:a.priceKey, label:a.label, price:item[a.priceKey] })), ...adhocVisible.map((a,ai) => ({ key:`adhoc_${ai}`, label:a.name, price:a.sellingPrice }))].map(a => {
                                  const isDisabled = !!disabledMap[a.key];
                                  return (
                                    <div key={a.key} style={{ display:'flex', alignItems:'center', gap:7, marginBottom:4 }}>
                                      <Toggle on={!isDisabled} onToggle={() => toggleAddonDisabled(item._id, a.key)} />
                                      <span style={{ fontFamily:jost, fontSize:10, color:isDisabled?T.muted:T.text, flex:1, textDecoration:isDisabled?'line-through':'none' }}>
                                        {a.label} <span style={{ color:T.muted, textDecoration:'none' }}>· {INR(a.price)}</span>
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {(() => {
                              const customAddons = itemState.portalCustomAddons || []; const addonForm = addonForms[item._id];
                              return (
                                <div>
                                  <Label style={{ marginBottom: 5 }}>Custom Add-ons</Label>
                                  {customAddons.map((ca,ci) => (
                                    <div key={ci} style={{ display:'flex', alignItems:'center', gap:7, padding:'5px 9px', background:T.dimBg, border:`1px solid ${T.borderG}`, marginBottom:3 }}>
                                      <div style={{ flex:1, minWidth:0 }}>
                                        <span style={{ fontFamily:jost, fontSize:10, color:T.text }}>{ca.name}</span>
                                        <span style={{ fontFamily:jost, fontSize:9, color:T.muted, marginLeft:5 }}>{INR(ca.price)} · {ca.pricingType==='per_person'?'per person':'flat'}</span>
                                      </div>
                                      <button onClick={() => removeCustomAddon(item._id,ci)} style={{ background:'none', border:'none', cursor:'pointer', color:T.muted, display:'flex', transition:'color .15s' }} onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.muted}><Trash2 size={10}/></button>
                                    </div>
                                  ))}
                                  {addonForm ? (
                                    <div style={{ border:`1px solid ${T.borderG}`, padding:9, display:'flex', flexDirection:'column', gap:5 }}>
                                      <input type="text" autoFocus placeholder="Add-on name *" value={addonForm.name} onChange={e=>setAddonForms(p=>({...p,[item._id]:{...p[item._id],name:e.target.value}}))} style={inputSt} className="pe-input" />
                                      <div style={{ display:'flex', gap:5, alignItems:'center' }}>
                                        <span style={{ fontFamily:jost, fontSize:10, color:T.muted }}>₹</span>
                                        <input type="number" min="0" placeholder="Price" value={addonForm.price} onChange={e=>setAddonForms(p=>({...p,[item._id]:{...p[item._id],price:e.target.value}}))} style={{ ...inputSt, flex:1 }} className="pe-input" />
                                        <div style={{ display:'flex', border:`1px solid ${T.border}`, overflow:'hidden', flexShrink:0 }}>
                                          {[{v:'flat',l:'Flat'},{v:'per_person',l:'/person'}].map(opt => (
                                            <button key={opt.v} onClick={() => setAddonForms(p=>({...p,[item._id]:{...p[item._id],pricingType:opt.v}}))} style={{ padding:'5px 7px', background:addonForm.pricingType===opt.v?T.gold:'#fff', color:addonForm.pricingType===opt.v?T.navy:T.muted, border:'none', cursor:'pointer', fontFamily:jost, fontSize:8, transition:'all .15s' }}>{opt.l}</button>
                                          ))}
                                        </div>
                                      </div>
                                      <div style={{ display:'flex', gap:5 }}>
                                        <button onClick={() => saveCustomAddon(item._id)} disabled={!addonForm.name?.trim()} style={{ ...btnGold, flex:1, justifyContent:'center', opacity:!addonForm.name?.trim()?0.4:1 }} className="pe-btn-gold"><Check size={10}/> Save</button>
                                        <button onClick={() => closeAddonForm(item._id)} style={{ ...btnGhost, padding:'7px 10px' }} className="pe-btn-ghost"><X size={10}/></button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button onClick={() => openAddonForm(item._id)} style={{ width:'100%', padding:'6px 0', background:'none', border:`1px dashed ${T.border}`, cursor:'pointer', fontFamily:jost, fontSize:8, color:T.muted, letterSpacing:'0.2em', textTransform:'uppercase', display:'flex', alignItems:'center', justifyContent:'center', gap:4, transition:'all .15s' }} onMouseEnter={e=>{e.currentTarget.style.borderColor=T.gold;e.currentTarget.style.color=T.gold;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.muted;}}>
                                      <Plus size={10}/> Add Custom Add-on
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            )}

            {/* Custom product item */}
            {portal.type === 'product' && (
              <div style={{ border:`1px dashed ${T.border}`, overflow:'hidden' }}>
                {!showCustomForm ? (
                  <button onClick={() => setShowCustomForm(true)} style={{ width:'100%', padding:'11px 0', background:'none', border:'none', cursor:'pointer', fontFamily:jost, fontSize:8, color:T.muted, letterSpacing:'0.22em', textTransform:'uppercase', display:'flex', alignItems:'center', justifyContent:'center', gap:5, transition:'all .15s' }} onMouseEnter={e=>{e.currentTarget.style.background=T.dimBg;e.currentTarget.style.color=T.gold;}} onMouseLeave={e=>{e.currentTarget.style.background='none';e.currentTarget.style.color=T.muted;}}>
                    <ImagePlus size={12}/> Add Custom Item
                  </button>
                ) : (
                  <div>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 13px', background:T.dimBg, borderBottom:`1px solid ${T.borderG}` }}>
                      <Label style={{ color:T.gold }}>Custom Item</Label>
                      <button onClick={resetCustomForm} style={{ background:'none', border:'none', cursor:'pointer', color:T.muted, display:'flex' }}><X size={12}/></button>
                    </div>
                    <div style={{ padding:13, display:'flex', flexDirection:'column', gap:7 }}>
                      <div style={{ display:'flex', gap:9, alignItems:'flex-start' }}>
                        <div onClick={() => customImageRef.current?.click()} style={{ width:48, height:48, border:`1px dashed ${T.border}`, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', overflow:'hidden', flexShrink:0, background:T.offwhite, transition:'border-color .15s' }} onMouseEnter={e=>e.currentTarget.style.borderColor=T.gold} onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
                          {customPreview ? <img src={customPreview} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/> : <ImagePlus size={14} style={{ color:T.border }}/>}
                        </div>
                        <input type="text" placeholder="Product name *" value={customForm.name} onChange={e=>setCustomForm(p=>({...p,name:e.target.value}))} style={{ ...inputSt, flex:1 }} className="pe-input"/>
                      </div>
                      <textarea placeholder="Description (optional)" value={customForm.description} onChange={e=>setCustomForm(p=>({...p,description:e.target.value}))} rows={2} style={{ ...inputSt, resize:'none', lineHeight:1.5 }} className="pe-input"/>
                      <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                        <span style={{ fontFamily:jost, fontSize:10, color:T.muted }}>₹</span>
                        <input type="number" min="0" placeholder="Price (optional)" value={customForm.price} onChange={e=>setCustomForm(p=>({...p,price:e.target.value}))} style={{ ...inputSt, flex:1 }} className="pe-input"/>
                      </div>
                      <button onClick={handleAddCustomItem} disabled={savingCustom||!customForm.name.trim()} style={{ ...btnGold, justifyContent:'center', opacity:(savingCustom||!customForm.name.trim())?0.4:1 }} className="pe-btn-gold">
                        {savingCustom?<><Loader2 size={10} style={{ animation:'pe-spin .7s linear infinite' }}/> Adding…</>:<><Plus size={10}/> Add to Portal</>}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div style={{ textAlign:'center', paddingBottom:6 }}>
              <span style={{ fontFamily:jost, fontSize:8, color:T.muted, letterSpacing:'0.12em' }}>Add items via {portal.type==='product'?'Products':'Properties'} → "Add to Portal"</span>
            </div>

            {/* ── COMBO CREATOR — collapsible section, product portals only ── */}
            {portal.type === 'product' && (
              <div style={{ border: `1px solid ${comboOpen ? T.borderG : T.border}`, transition: 'border-color .2s' }}>
                {/* Header — click to expand/collapse */}
                <button
                  onClick={() => setComboOpen(p => !p)}
                  style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'11px 14px', background: comboOpen ? T.dimBg : T.offwhite, border:'none', cursor:'pointer', transition:'background .2s' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <Layers size={12} style={{ color: comboOpen ? T.gold : T.muted }} />
                    <span style={{ fontFamily:jost, fontSize:9, fontWeight:400, letterSpacing:'0.22em', textTransform:'uppercase', color: comboOpen ? T.gold : T.muted }}>
                      Combo Creator
                    </span>
                    {comboCount > 0 && (
                      <span style={{ fontFamily:jost, fontSize:7, background:'rgba(184,151,90,0.12)', color:T.gold, padding:'1px 6px', letterSpacing:'0.05em' }}>
                        {comboCount} attached
                      </span>
                    )}
                  </div>
                  <ChevronDown size={12} style={{ color:T.muted, transform: comboOpen ? 'rotate(180deg)' : 'none', transition:'transform .2s' }} />
                </button>

                {/* Expanded body */}
                {comboOpen && (
                  <div style={{ padding:14, borderTop:`1px solid ${T.borderG}`, display:'flex', flexDirection:'column', gap:14 }}>

                    <p style={{ fontFamily:jost, fontSize:10, color:T.muted, lineHeight:1.65, margin:0 }}>
                      Generate product bundles for this order's budget. Clients see them in the <strong style={{ color:T.text }}>Combo tab</strong> of their portal.
                    </p>

                    {/* Attached combos */}
                    {(portal.comboItems||[]).length > 0 && (
                      <div>
                        <SectionHead>Attached ({(portal.comboItems||[]).length})</SectionHead>
                        <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                          {(portal.comboItems||[]).map(c => (
                            <div key={c._id} className="pe-card" style={{ display:'flex', gap:9, alignItems:'center', padding:'9px 13px' }}>
                              <div style={{ display:'flex', gap:3, flexShrink:0 }}>
                                {(c.items||[]).slice(0,4).map((item,i) => (
                                  <div key={i} style={{ width:28, height:28, background:T.offwhite, overflow:'hidden', border:`1px solid ${T.border}` }}>
                                    {item.imageUrl && <img src={item.imageUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>}
                                  </div>
                                ))}
                                {(c.items||[]).length > 4 && <div style={{ width:28, height:28, background:T.offwhite, border:`1px solid ${T.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:jost, fontSize:8, color:T.muted }}>+{(c.items||[]).length-4}</div>}
                              </div>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontFamily:jost, fontSize:11, fontWeight:500, color:T.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.label||`${INR(c.totalPrice)} Bundle`}</div>
                                <div style={{ fontFamily:jost, fontSize:9, color:T.muted, marginTop:2 }}>{(c.items||[]).length} items · {INR(c.totalPrice)}</div>
                              </div>
                              <button onClick={() => detachCombo(c._id)} style={{ background:'none', border:'none', cursor:'pointer', color:T.muted, padding:3, display:'flex', transition:'color .15s' }} onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.muted}><Trash2 size={12}/></button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Generate form */}
                    <div style={{ background:T.dimBg, border:`1px solid ${T.borderG}`, padding:13 }}>
                      <SectionHead>Generate New Combos</SectionHead>
                      <div style={{ display:'flex', gap:8, alignItems:'flex-end', marginBottom:10 }}>
                        <div style={{ flex:1 }}>
                          <Label style={{ marginBottom:4 }}>Target Budget (₹)</Label>
                          <input type="number" min="0" value={comboBudget} onChange={e=>{setComboBudget(e.target.value);setComboError('');}} placeholder="e.g. 1000" style={inputSt} className="pe-input"/>
                          {budgetToleranceLabel(comboBudget) && <div style={{ fontFamily:jost, fontSize:9, color:T.gold, marginTop:3 }}>Range: {budgetToleranceLabel(comboBudget)}</div>}
                        </div>
                        <div style={{ width:60 }}>
                          <Label style={{ marginBottom:4 }}>Max</Label>
                          <input type="number" min="1" max="50" value={comboMaxResults} onChange={e=>setComboMaxResults(Number(e.target.value)||20)} style={{ ...inputSt, textAlign:'center' }} className="pe-input"/>
                        </div>
                      </div>

                      {productMeta.categories.length > 0 && (
                        <div style={{ marginBottom:8 }}>
                          <Label style={{ marginBottom:5 }}>Categories <span style={{ textTransform:'none', letterSpacing:0, fontWeight:300 }}>— blank = all</span></Label>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                            {productMeta.categories.map(cat => {
                              const active = comboSelCats.includes(cat);
                              return <button key={cat} onClick={() => toggleComboCat(cat)} style={{ padding:'3px 9px', border:`1px solid ${active?T.gold:T.border}`, background:active?T.dimBg:'#fff', color:active?T.gold:T.muted, fontFamily:jost, fontSize:8, letterSpacing:'0.12em', cursor:'pointer', transition:'all .15s' }} onMouseEnter={e=>{if(!active){e.currentTarget.style.borderColor=T.gold;e.currentTarget.style.color=T.gold;}}} onMouseLeave={e=>{if(!active){e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.muted;}}}>{cat}</button>;
                            })}
                          </div>
                        </div>
                      )}

                      {(() => {
                        const subs = comboSelCats.length ? [...new Set(comboSelCats.flatMap(c => productMeta.subCategories?.[c]||[]))] : [...new Set(Object.values(productMeta.subCategories||{}).flat())];
                        if (!subs.length) return null;
                        return (
                          <div style={{ marginBottom:10 }}>
                            <Label style={{ marginBottom:5 }}>Subcategories <span style={{ textTransform:'none', letterSpacing:0, fontWeight:300 }}>— 1 per subcat per combo</span></Label>
                            <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                              {subs.map(sc => {
                                const active = comboSelSubs.includes(sc);
                                return <button key={sc} onClick={() => toggleComboSub(sc)} style={{ padding:'2px 7px', border:`1px solid ${active?T.gold:T.border}`, background:active?T.dimBg:T.offwhite, color:active?T.gold:T.muted, fontFamily:jost, fontSize:7, letterSpacing:'0.1em', cursor:'pointer', transition:'all .15s' }} onMouseEnter={e=>{if(!active){e.currentTarget.style.borderColor=T.gold;e.currentTarget.style.color=T.gold;}}} onMouseLeave={e=>{if(!active){e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.muted;}}}>{sc}</button>;
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {comboError && (
                        <div style={{ display:'flex', gap:6, padding:'7px 10px', background:'rgba(220,38,38,0.05)', border:'1px solid rgba(220,38,38,0.12)', marginBottom:8 }}>
                          <AlertCircle size={11} style={{ color:T.red, flexShrink:0, marginTop:1 }}/>
                          <span style={{ fontFamily:jost, fontSize:10, color:T.red }}>{comboError}</span>
                        </div>
                      )}

                      <button onClick={generateCombos} disabled={comboGenerating||!comboBudget} style={{ ...btnGold, opacity:(comboGenerating||!comboBudget)?0.45:1, cursor:(comboGenerating||!comboBudget)?'not-allowed':'pointer' }} className="pe-btn-gold">
                        {comboGenerating?<><Loader2 size={10} style={{ animation:'pe-spin .7s linear infinite' }}/> Generating…</>:<><Layers size={10}/> Generate Combos</>}
                      </button>
                      {comboResults.length > 0 && (
                        <div style={{ marginTop:7, display:'flex', alignItems:'center', gap:5 }}>
                          <CheckCircle2 size={11} style={{ color:T.green }}/>
                          <span style={{ fontFamily:jost, fontSize:9, color:T.green }}>{comboResults.length} combo{comboResults.length!==1?'s':''} generated and saved</span>
                        </div>
                      )}
                    </div>

                    {/* All saved combos */}
                    <div>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                        <SectionHead>All Saved Combos ({allCombos.length})</SectionHead>
                        <button onClick={loadAllCombos} disabled={combosLoading} style={{ background:'none', border:'none', cursor:'pointer', color:T.muted, display:'flex', alignItems:'center', gap:3, fontFamily:jost, fontSize:8 }}>
                          <RotateCcw size={9} style={combosLoading?{ animation:'pe-spin .7s linear infinite' }:{}} /> Refresh
                        </button>
                      </div>
                      <div style={{ position:'relative', marginBottom:8 }}>
                        <Search size={10} style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:T.muted, pointerEvents:'none' }}/>
                        <input value={comboSearch} onChange={e=>setComboSearch(e.target.value)} placeholder="Filter combos…" style={{ ...inputSt, paddingLeft:27 }} className="pe-input"/>
                        {comboSearch && <button onClick={() => setComboSearch('')} style={{ position:'absolute', right:7, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:T.muted, display:'flex' }}><X size={10}/></button>}
                      </div>

                      {combosLoading && !allCombos.length ? (
                        <div style={{ textAlign:'center', padding:'20px 0', color:T.muted }}>
                          <Loader2 size={16} style={{ animation:'pe-spin .7s linear infinite', display:'block', margin:'0 auto 5px' }}/>
                          <span style={{ fontFamily:jost, fontSize:10 }}>Loading…</span>
                        </div>
                      ) : allCombos.length === 0 ? (
                        <div style={{ textAlign:'center', padding:'16px 0' }}>
                          <div style={{ fontSize:18, marginBottom:5 }}>✦</div>
                          <div style={{ fontFamily:jost, fontSize:10, color:T.muted }}>No combos yet — use the generator above.</div>
                        </div>
                      ) : (
                        <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                          {allCombos.filter(c => {
                            if (!comboSearch.trim()) return true;
                            const q = comboSearch.toLowerCase();
                            return (c.label||'').toLowerCase().includes(q) || (c.categories||[]).some(cat => cat.toLowerCase().includes(q)) || String(c.totalPrice).includes(q);
                          }).map(c => {
                            const alreadyAttached = (portal.comboItems||[]).some(pc => String(pc.comboId)===String(c._id));
                            const isFresh = comboResults.some(r => r._id===c._id);
                            return (
                              <div key={c._id} className="pe-card" style={{ display:'flex', gap:8, alignItems:'center', padding:'9px 12px', background:isFresh?'rgba(22,163,74,0.03)':'#fff', borderColor:isFresh?'rgba(22,163,74,0.18)':T.border, animation:isFresh?'pe-fadein .3s ease both':'none' }}>
                                <div style={{ display:'flex', gap:2, flexShrink:0 }}>
                                  {(c.items||[]).slice(0,4).map((item,i) => (
                                    <div key={i} style={{ width:26, height:26, background:T.offwhite, overflow:'hidden', border:`1px solid ${T.border}` }}>
                                      {item.imageUrl && <img src={item.imageUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>}
                                    </div>
                                  ))}
                                  {(c.items||[]).length > 4 && <div style={{ width:26, height:26, background:T.offwhite, border:`1px solid ${T.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:jost, fontSize:7, color:T.muted }}>+{(c.items||[]).length-4}</div>}
                                </div>
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ fontFamily:jost, fontSize:10, fontWeight:500, color:T.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.label||`${INR(c.totalPrice)} Bundle`}</div>
                                  <div style={{ fontFamily:jost, fontSize:8, color:T.muted, marginTop:1 }}>{(c.items||[]).length} items · {INR(c.totalPrice)} · target {INR(c.budget)}</div>
                                  <div style={{ display:'flex', gap:2, marginTop:2, flexWrap:'wrap' }}>
                                    {(c.items||[]).map((item,i) => <span key={i} style={{ fontFamily:jost, fontSize:6, background:T.offwhite, border:`1px solid ${T.border}`, color:T.muted, padding:'1px 4px', maxWidth:55, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', letterSpacing:'0.05em', textTransform:'uppercase' }}>{item.subCategory||item.name}</span>)}
                                  </div>
                                </div>
                                <div style={{ display:'flex', gap:4, alignItems:'center', flexShrink:0 }}>
                                  {alreadyAttached ? (
                                    <span style={{ fontFamily:jost, fontSize:7, color:T.green, letterSpacing:'0.14em', textTransform:'uppercase', display:'flex', alignItems:'center', gap:2 }}><Check size={9}/> Added</span>
                                  ) : (
                                    <button onClick={() => attachCombo(c)} disabled={attachingComboId===c._id} style={{ ...btnGold, padding:'5px 10px', opacity:attachingComboId===c._id?0.5:1, fontSize:8 }} className="pe-btn-gold">
                                      {attachingComboId===c._id?<Loader2 size={9} style={{ animation:'pe-spin .7s linear infinite' }}/>:<Plus size={9}/>} Add
                                    </button>
                                  )}
                                  <button onClick={() => deleteCombo(c._id)} disabled={comboDeletingId===c._id} style={{ background:'none', border:'none', cursor:'pointer', color:T.muted, padding:3, display:'flex', transition:'color .15s' }} onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.muted}>
                                    {comboDeletingId===c._id?<Loader2 size={10} style={{ animation:'pe-spin .7s linear infinite' }}/>:<Trash2 size={11}/>}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── SHORTLIST ───────────────────────────────────────────────── */}
        {tab === 'selected' && (() => {
          const allItems = portal.type==='product'?(portal.productItems||[]):(portal.offsiteItems||[]);
          const shortlistedIds = new Set(portal.shortlistedIds||[]);
          const sel = allItems.filter(i => shortlistedIds.has(String(i._id)));
          const selCombos = (portal.comboItems||[]).filter(c => shortlistedIds.has(String(c._id)));
          const totalSel = sel.length + selCombos.length;
          return (
            <div style={{ padding:14, display:'flex', flexDirection:'column', gap:10 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                  <div style={{ width:2, height:13, background:T.gold, borderRadius:2 }}/>
                  <span style={{ fontFamily:serif, fontSize:14, fontWeight:300, color:T.text, fontStyle:'italic' }}>{totalSel} item{totalSel!==1?'s':''} shortlisted</span>
                </div>
                {portal.lastViewedAt && <span style={{ fontFamily:jost, fontSize:8, color:T.muted }}>Last viewed {new Date(portal.lastViewedAt).toLocaleDateString('en-IN')}</span>}
              </div>
              {totalSel===0 ? (
                <div style={{ textAlign:'center', padding:'36px 0', color:T.muted }}>
                  <div style={{ fontSize:24, marginBottom:7 }}>🤍</div>
                  <div style={{ fontFamily:jost, fontSize:10 }}>No items shortlisted yet</div>
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  {selCombos.length > 0 && (
                    <>
                      {sel.length > 0 && <Label style={{ marginBottom:1 }}>Bundles</Label>}
                      {selCombos.map(c => (
                        <div key={c._id} className="pe-card" style={{ display:'flex', gap:8, alignItems:'center', padding:'9px 12px', background:T.dimBg, borderColor:T.borderG }}>
                          <div style={{ display:'flex', gap:2, flexShrink:0 }}>
                            {(c.items||[]).slice(0,3).map((item,i) => <div key={i} style={{ width:28, height:28, background:T.offwhite, overflow:'hidden', border:`1px solid ${T.border}` }}>{item.imageUrl&&<img src={item.imageUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>}</div>)}
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontFamily:jost, fontSize:11, fontWeight:500, color:T.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.label||`${INR(c.totalPrice)} Bundle`}</div>
                            <div style={{ fontFamily:jost, fontSize:9, color:T.muted, marginTop:1 }}>{(c.items||[]).length} items · {INR(c.totalPrice)}</div>
                          </div>
                          <span style={{ color:T.gold, fontSize:13 }}>♥</span>
                        </div>
                      ))}
                    </>
                  )}
                  {sel.length > 0 && (
                    <>
                      {selCombos.length > 0 && <Label style={{ marginTop:3, marginBottom:1 }}>Individual Items</Label>}
                      {sel.map(item => (
                        <div key={item._id} className="pe-card" style={{ display:'flex', gap:8, alignItems:'center', padding:'9px 12px', background:T.dimBg, borderColor:T.borderG }}>
                          <div style={{ width:32, height:32, background:T.offwhite, overflow:'hidden', flexShrink:0, border:`1px solid ${T.border}` }}>
                            {item.imageUrl?<img src={item.imageUrl} alt={item.name} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>:<div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center' }}>{portal.type==='product'?<Package size={12} style={{ color:T.border }}/>:<MapPin size={12} style={{ color:T.border }}/>}</div>}
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontFamily:jost, fontSize:11, fontWeight:500, color:T.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.name}</div>
                            <div style={{ fontFamily:jost, fontSize:9, color:T.muted, marginTop:1 }}>
                              {portal.type==='product'?(() => { const ov=portal.calculatorState?.[item._id]?.priceOverride; const p=ov!=null?Number(ov):Number(item.price||0); return `${INR(p)}${ov!=null?' (overridden)':''}${item.category?` · ${item.category}`:''}`; })():`${item.location||''}${item.doublePrice>0?` · ${INR(item.doublePrice)}/double`:''}`}
                            </div>
                          </div>
                          <span style={{ color:T.gold, fontSize:13 }}>♥</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
              <div style={{ marginTop:4, paddingTop:10, borderTop:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
                <span style={{ fontFamily:jost, fontSize:9, color:T.muted }}><strong style={{ color:T.text }}>Views:</strong> {portal.viewCount||0}</span>
                <span style={{ fontFamily:jost, fontSize:9, color:T.muted }}><strong style={{ color:T.text }}>Last seen:</strong> {portal.lastViewedAt?new Date(portal.lastViewedAt).toLocaleDateString('en-IN'):'Never'}</span>
                <a href={portalUrl} target="_blank" rel="noreferrer" style={{ marginLeft:'auto', fontFamily:jost, fontSize:8, color:T.gold, letterSpacing:'0.14em', display:'flex', alignItems:'center', gap:3, textDecoration:'none' }}><ExternalLink size={10}/> Open portal</a>
              </div>
            </div>
          );
        })()}

        {/* ── SHIPMENTS ───────────────────────────────────────────────── */}
        {tab === 'shipments' && (() => {
          const DELAYED = new Set(['Returned','Exception']);
          const STATUS_COLORS = { 'Pending':{bg:'rgba(0,0,0,0.04)',color:T.muted}, 'Booked':{bg:'rgba(79,70,229,0.06)',color:'#4f46e5'}, 'In Transit':{bg:'rgba(217,119,6,0.08)',color:T.amber}, 'Out for Delivery':{bg:'rgba(234,88,12,0.08)',color:'#ea580c'}, 'Delivered':{bg:'rgba(22,163,74,0.07)',color:T.green}, 'Completed':{bg:'rgba(22,163,74,0.07)',color:T.green}, 'Returned':{bg:'rgba(220,38,38,0.07)',color:T.red}, 'Exception':{bg:'rgba(220,38,38,0.07)',color:T.red} };
          const q = shipmentSearch.toLowerCase().trim();
          const filtered = shipments.filter(s => !q||(s.recipientName||'').toLowerCase().includes(q)||(s.trackingId||'').toLowerCase().includes(q)||(s.city||'').toLowerCase().includes(q)||(s.shippingPartner||'').toLowerCase().includes(q)||(s.status||'').toLowerCase().includes(q));
          const STATUS_ORDER = ['Exception','Returned','In Transit','Out for Delivery','Booked','Pending','Delivered','Completed'];
          const statusGroups = {};
          filtered.forEach(s => { const st=s.status||'Pending'; if(!statusGroups[st])statusGroups[st]=[]; statusGroups[st].push(s); });
          const sortedStatuses = Object.keys(statusGroups).sort((a,b)=>(STATUS_ORDER.indexOf(a)===-1?99:STATUS_ORDER.indexOf(a))-(STATUS_ORDER.indexOf(b)===-1?99:STATUS_ORDER.indexOf(b)));
          return (
            <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
              <div style={{ padding:'12px 14px 9px', flexShrink:0, borderBottom:`1px solid ${T.border}` }}>
                <div style={{ display:'flex', gap:7 }}>
                  <div style={{ position:'relative', flex:1 }}>
                    <Search size={10} style={{ position:'absolute', left:8, top:'50%', transform:'translateY(-50%)', color:T.muted, pointerEvents:'none' }}/>
                    <input value={shipmentSearch} onChange={e=>setShipmentSearch(e.target.value)} placeholder="Search recipient, tracking ID…" style={{ ...inputSt, paddingLeft:26 }} className="pe-input"/>
                  </div>
                  <button onClick={loadShipments} disabled={shipmentsLoading} style={{ ...btnGhost, padding:'0 9px' }} className="pe-btn-ghost">
                    <RefreshCw size={11} style={shipmentsLoading?{ animation:'pe-spin .7s linear infinite' }:{}}/>
                  </button>
                </div>
                <div style={{ display:'flex', gap:12, marginTop:6 }}>
                  <span style={{ fontFamily:jost, fontSize:8, color:T.muted, letterSpacing:'0.1em' }}>{shipments.length} shipment{shipments.length!==1?'s':''}</span>
                  {shipments.filter(s=>DELAYED.has(s.status)).length>0 && <span style={{ fontFamily:jost, fontSize:8, color:T.red, display:'flex', alignItems:'center', gap:2 }}><AlertTriangle size={9}/> {shipments.filter(s=>DELAYED.has(s.status)).length} delayed</span>}
                </div>
              </div>
              <div style={{ flex:1, overflowY:'auto', padding:14 }}>
                {shipmentsLoading ? (
                  <div style={{ textAlign:'center', padding:'36px 0', color:T.muted }}>
                    <Loader2 size={16} style={{ animation:'pe-spin .7s linear infinite', display:'block', margin:'0 auto 7px' }}/>
                    <span style={{ fontFamily:jost, fontSize:10 }}>Loading…</span>
                  </div>
                ) : filtered.length===0 ? (
                  <div style={{ textAlign:'center', padding:'36px 0' }}>
                    <div style={{ fontSize:24, marginBottom:7 }}>📦</div>
                    <div style={{ fontFamily:jost, fontSize:10, color:T.muted }}>{shipments.length===0?'No shipments linked yet.':'No results match your search.'}</div>
                  </div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                    {sortedStatuses.map(status => {
                      const chip = STATUS_COLORS[status]||{ bg:'rgba(0,0,0,0.04)', color:T.muted };
                      return (
                        <div key={status}>
                          <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:5 }}>
                            <span style={{ fontFamily:jost, fontSize:7, fontWeight:500, letterSpacing:'0.16em', textTransform:'uppercase', padding:'2px 7px', background:chip.bg, color:chip.color }}>{status}</span>
                            <span style={{ fontFamily:jost, fontSize:8, color:T.muted }}>{statusGroups[status].length}</span>
                          </div>
                          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                            {statusGroups[status].map(s => {
                              const isDelayed = DELAYED.has(s.status);
                              return (
                                <div key={s._id} className="pe-card" style={{ padding:'9px 12px', background:isDelayed?'rgba(220,38,38,0.03)':'#fff', borderColor:isDelayed?'rgba(220,38,38,0.15)':T.border }}>
                                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:7 }}>
                                    <div style={{ display:'flex', alignItems:'flex-start', gap:8, minWidth:0 }}>
                                      <div style={{ width:24, height:24, background:isDelayed?'rgba(220,38,38,0.08)':T.offwhite, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                        <Truck size={11} style={{ color:isDelayed?T.red:T.muted }}/>
                                      </div>
                                      <div style={{ minWidth:0 }}>
                                        <div style={{ fontFamily:jost, fontSize:11, fontWeight:500, color:T.text }}>{s.recipientName||'—'}</div>
                                        {s.phone && <div style={{ fontFamily:jost, fontSize:9, color:T.muted, marginTop:1 }}>{s.phone}</div>}
                                        <div style={{ display:'flex', gap:7, marginTop:2, flexWrap:'wrap' }}>
                                          {s.city && <span style={{ fontFamily:jost, fontSize:8, color:T.muted, display:'flex', alignItems:'center', gap:2 }}><MapPin size={7}/>{s.city}</span>}
                                          {s.shippingPartner && <span style={{ fontFamily:jost, fontSize:8, color:T.muted }}>{s.shippingPartner}</span>}
                                        </div>
                                      </div>
                                    </div>
                                    <div style={{ flexShrink:0, textAlign:'right' }}>
                                      {s.trackingId ? <span style={{ fontFamily:jost, fontSize:9, fontWeight:500, color:T.gold, background:T.dimBg, padding:'2px 6px' }}>{s.trackingId}</span> : <span style={{ fontFamily:jost, fontSize:8, color:T.muted }}>No tracking ID</span>}
                                      {s.deliveryDate && <div style={{ fontFamily:jost, fontSize:8, color:T.muted, marginTop:2 }}>ETA {new Date(s.deliveryDate).toLocaleDateString('en-IN',{ day:'2-digit', month:'short' })}</div>}
                                    </div>
                                  </div>
                                  {s.notes && <div style={{ fontFamily:jost, fontSize:9, color:T.muted, fontStyle:'italic', marginTop:6, paddingTop:6, borderTop:`1px solid ${T.border}` }}>{s.notes}</div>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── CHAT ───────────────────────────────────────────────────── */}
        {tab === 'chat' && (
          <div style={{ display:'flex', flexDirection:'column', minHeight:400, height:'100%' }}>
            <div style={{ flex:1, overflowY:'auto', padding:'12px 14px', display:'flex', flexDirection:'column', gap:9 }}>
              {portal.messages.length===0 && <div style={{ textAlign:'center', padding:'28px 0', fontFamily:jost, fontSize:10, color:T.muted }}>No messages yet. Start the conversation.</div>}
              {portal.messages.map(m => {
                const isTeam = m.sender==='team';
                return (
                  <div key={m._id} style={{ display:'flex', gap:7, flexDirection:isTeam?'row-reverse':'row' }}>
                    <div style={{ width:24, height:24, background:isTeam?T.navy:T.offwhite, border:`1px solid ${isTeam?T.navy:T.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:jost, fontSize:8, fontWeight:700, color:isTeam?T.gold:T.muted, flexShrink:0, alignSelf:'flex-end', marginBottom:1 }}>
                      {(m.senderName||'T').slice(0,2).toUpperCase()}
                    </div>
                    <div style={{ maxWidth:'78%', display:'flex', flexDirection:'column', alignItems:isTeam?'flex-end':'flex-start' }}>
                      <div style={{ fontFamily:jost, fontSize:7, color:T.muted, marginBottom:3, letterSpacing:'0.08em' }}>{m.senderName} · {fmtT(m.createdAt)}</div>
                      <div style={{ background:isTeam?T.navy:'#fff', border:`1px solid ${isTeam?'transparent':T.border}`, padding:'8px 11px' }}>
                        {m.text && <div style={{ fontFamily:jost, fontSize:11, color:isTeam?'rgba(255,255,255,0.85)':T.text, lineHeight:1.6 }}>{m.text}</div>}
                        {(m.attachments||[]).map((att,i) => (
                          <a key={i} href={att.url} target="_blank" rel="noreferrer"
                            onClick={async e => { e.preventDefault(); try { const res=await fetch(att.url); const blob=await res.blob(); const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u; a.download=att.name; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u); } catch { window.open(att.url,'_blank'); } }}
                            style={{ display:'inline-flex', alignItems:'center', gap:4, marginTop:5, padding:'4px 8px', background:'rgba(184,151,90,0.07)', border:`1px solid rgba(184,151,90,0.18)`, cursor:'pointer', textDecoration:'none', transition:'background .15s', color:isTeam?'rgba(255,255,255,0.5)':T.muted }}>
                            <Paperclip size={9}/><span style={{ fontFamily:jost, fontSize:9, maxWidth:100, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{att.name}</span><Download size={9} style={{ marginLeft:'auto' }}/>
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef}/>
            </div>
            {chatFiles.length > 0 && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:4, padding:'6px 14px', borderTop:`1px solid ${T.border}` }}>
                {chatFiles.map((f,i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:4, background:T.dimBg, border:`1px solid ${T.borderG}`, padding:'2px 7px' }}>
                    <Paperclip size={9} style={{ color:T.gold }}/>
                    <span style={{ fontFamily:jost, fontSize:9, color:T.text, maxWidth:72, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
                    <button onClick={() => setChatFiles(chatFiles.filter((_,idx)=>idx!==i))} style={{ background:'none', border:'none', cursor:'pointer', color:T.muted, display:'flex' }}><X size={9}/></button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ padding:'9px 12px', borderTop:`1px solid ${T.border}`, flexShrink:0, display:'flex', gap:7, alignItems:'flex-end' }}>
              <div style={{ flex:1, border:`1px solid ${T.border}`, background:'#fff', transition:'border-color .15s' }} onFocusCapture={e=>e.currentTarget.style.borderColor=T.gold} onBlurCapture={e=>e.currentTarget.style.borderColor=T.border}>
                <textarea value={msg} onChange={e=>setMsg(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();} }} placeholder={`Message as ${user?.name||'Marqland Team'}…`} rows={2}
                  style={{ width:'100%', background:'none', border:'none', outline:'none', padding:'8px 11px', fontFamily:jost, fontSize:11, color:T.text, lineHeight:1.5, resize:'none', boxSizing:'border-box' }}/>
                <div style={{ padding:'4px 11px 8px', display:'flex', alignItems:'center', gap:5, borderTop:`1px solid ${T.border}` }}>
                  <button type="button" onClick={() => chatFileRef.current?.click()} style={{ background:'none', border:'none', cursor:'pointer', color:T.muted, display:'flex', alignItems:'center', gap:3, fontFamily:jost, fontSize:8, letterSpacing:'0.12em', transition:'color .15s' }} onMouseEnter={e=>e.currentTarget.style.color=T.gold} onMouseLeave={e=>e.currentTarget.style.color=T.muted}>
                    <Paperclip size={11}/> Attach
                  </button>
                  <span style={{ fontFamily:jost, fontSize:8, color:T.muted }}>Max 5 files</span>
                </div>
              </div>
              <button onClick={sendMessage} disabled={sendingMsg||(!msg.trim()&&chatFiles.length===0)}
                style={{ width:34, height:34, background:(sendingMsg||(!msg.trim()&&chatFiles.length===0))?T.offwhite:T.navy, border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'background .2s' }}>
                {sendingMsg ? <Loader2 size={13} style={{ animation:'pe-spin .7s linear infinite', color:T.muted }}/> : <Send size={13} style={{ color:(msg.trim()||chatFiles.length)?T.gold:T.muted }}/>}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Hidden file inputs ─────────────────────────────────────── */}
      <input ref={chatFileRef} type="file" multiple style={{ position:'absolute', top:-200, left:-200, width:1, height:1, opacity:0 }}
        onChange={e=>{ const p=Array.from(e.target.files||[]); if(p.length)setChatFiles(prev=>[...prev,...p].slice(0,5)); e.target.value=''; }}/>
      <input ref={customImageRef} type="file" accept="image/*" style={{ position:'absolute', top:-200, left:-202, width:1, height:1, opacity:0 }} onChange={handleCustomImagePick}/>
    </div>
  );
};

export default ClientPortalEditor;