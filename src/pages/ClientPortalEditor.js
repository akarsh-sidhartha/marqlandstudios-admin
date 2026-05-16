import React, { useState, useEffect, useRef } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { createLogger } from '../utils/logger';
import {
  Link2, Trash2, Send, Check, X, Edit3,
  Package, MapPin, ChevronUp, ChevronDown, ChevronRight,
  ExternalLink, RefreshCw, Copy, Eye, Paperclip, Download,
  ImagePlus, Plus, Loader2, Truck, AlertTriangle, Search,
} from 'lucide-react';
import { requestNotifPermission, pushNotif, subscribeToPortalPush } from '../utils/portalNotifications';

const log = createLogger('ClientPortalEditor');

// ── Design tokens (lighter panel version — not full-navy since it's embedded) ──
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
  surface: '#ffffff',
  subtle:  '#f7f5f2',       // warm off-white for panel backgrounds
};
const jost  = '"Jost", sans-serif';
const serif = '"Cormorant Garamond", Georgia, serif';

// ── Toggle switch ─────────────────────────────────────────────────────────────
// Replaces the indigo toggle with a gold-on when active
const Toggle = ({ on, onClick }) => (
  <button
    onClick={onClick}
    style={{
      position: 'relative', display: 'inline-flex',
      height: 20, width: 36, flexShrink: 0,
      cursor: 'pointer', borderRadius: 10,
      border: 'none', padding: 0,
      background: on ? T.gold : 'rgba(0,0,0,0.12)',
      transition: 'background 0.2s',
    }}
  >
    <span style={{
      display: 'inline-block', height: 16, width: 16,
      borderRadius: '50%', background: 'white',
      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      position: 'absolute', top: 2,
      left: on ? 18 : 2,
      transition: 'left 0.2s',
    }} />
  </button>
);

/**
 * ClientPortalEditor
 * Rendered inside a `position: relative` wrapper in OrderTracker.
 * The file input MUST be a direct child of the root div — this ensures
 * position:absolute resolves correctly and .click() works in all browsers.
 */
const ClientPortalEditor = ({ order, onClose }) => {
  const { user }                    = useAuth();
  const [portal, setPortal]         = useState(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [tab, setTab]               = useState('items');
  const [msg, setMsg]               = useState('');
  const [chatFiles, setChatFiles]   = useState([]);
  const [sendingMsg, setSendingMsg] = useState(false);
  const [copied, setCopied]         = useState(false);
  const [editNote, setEditNote]     = useState(false);
  const [noteText, setNoteText]     = useState('');
  const [collapsed, setCollapsed]   = useState({});
  const [shipments, setShipments]   = useState([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(false);
  const [shipmentSearch, setShipmentSearch] = useState('');
  const [syncingOffsite, setSyncingOffsite] = useState(false);
  const chatEndRef         = useRef(null);
  const chatFileRef        = useRef(null);
  const pollTimer          = useRef(null);
  const prevClientMsgCount = useRef(0);

  // ── Custom item form state ──────────────────────────────────────────────────
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customForm, setCustomForm]         = useState({ name:'', description:'', price:'' });
  const [customImage, setCustomImage]       = useState(null);
  const [customPreview, setCustomPreview]   = useState(null);
  const [savingCustom, setSavingCustom]     = useState(false);
  const customImageRef                      = useRef(null);

  const resetCustomForm = () => {
    setShowCustomForm(false);
    setCustomForm({ name:'', description:'', price:'' });
    setCustomImage(null);
    setCustomPreview(null);
  };

  const handleCustomImagePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCustomImage(file);
    const reader = new FileReader();
    reader.onload = ev => setCustomPreview(ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleAddCustomItem = async () => {
    if (!customForm.name.trim() || !portal) return;
    setSavingCustom(true);
    log.debug('Adding custom item', { name: customForm.name });
    try {
      let imageUrl = '';
      if (customImage) {
        const fd = new FormData();
        fd.append('image', customImage);
        const up = await api.post('/products/upload-temp-image', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        imageUrl = up.data?.imageUrl || '';
      }
      const newItem = {
        productId:'', name:customForm.name.trim(),
        description:customForm.description.trim(),
        imageUrl, price:customForm.price !== '' ? Number(customForm.price) : 0,
        category:'Custom', subCategory:'', note:'', order:0,
      };
      const existing = portal.productItems || [];
      await api.put(`/portal/${portal.slug}/items`, { productItems: [...existing, newItem] });
      await loadPortal(true);
      resetCustomForm();
      log.info('Custom item added');
    } catch (err) {
      log.error('Add custom item failed', err.message);
      alert('Failed: ' + (err.response?.data?.message || err.message));
    } finally { setSavingCustom(false); }
  };

  const fallbackSlug = order.refNumber?.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const portalUrl = portal?.slug
    ? `${window.location.origin}/p/${portal.slug}`
    : `${window.location.origin}/p/${fallbackSlug}`;

  useEffect(() => {
    requestNotifPermission();
    loadPortal();
    pollTimer.current = setInterval(() => loadPortal(true), 12000);
    return () => clearInterval(pollTimer.current);
  }, [order._id]);
  useEffect(() => {
    if (tab === 'chat') chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [portal?.messages, tab]);
  useEffect(() => {
    if (tab === 'shipments' && portal?.type === 'product' && order._id) loadShipments();
  }, [tab, order._id]);

  const loadShipments = async () => {
    setShipmentsLoading(true);
    log.debug('Loading shipments for order', order._id);
    try {
      const res = await api.get(`/shipments?orderId=${order._id}`);
      setShipments(Array.isArray(res.data) ? res.data : []);
      log.info('Shipments loaded', { count: res.data.length });
    } catch (err) {
      log.error('Shipments load failed', err.message);
      setShipments([]);
    } finally { setShipmentsLoading(false); }
  };

  const loadPortal = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res  = await api.get(`/portal/order/${order._id}`);
      const data = res.data;

      if (silent) {
        const clientMsgs = (data.messages || []).filter(m => m.sender === 'client');
        if (prevClientMsgCount.current > 0 && clientMsgs.length > prevClientMsgCount.current) {
          const newest      = clientMsgs[clientMsgs.length - 1];
          const preview     = newest.text
            ? newest.text.slice(0, 60) + (newest.text.length > 60 ? '…' : '')
            : newest.attachments?.length ? `📎 ${newest.attachments[0].name}` : 'New message';
          const senderLabel = newest.senderName || data.clientName || 'Client';
          pushNotif(`${senderLabel} sent a message`, preview, `portal-client-msg-${data.slug}`);
          log.info('New client message', { sender: senderLabel });
        }
        prevClientMsgCount.current = (data.messages || []).filter(m => m.sender === 'client').length;
      } else {
        prevClientMsgCount.current = (data.messages || []).filter(m => m.sender === 'client').length;
        log.debug('Portal loaded', { slug: data.slug, type: data.type });
      }

      setPortal(data);
      setNoteText(data.teamNote || '');
    } catch (err) {
      if (err.response?.status === 404) await createPortal();
      else log.error('loadPortal failed', err.message);
    } finally { if (!silent) setLoading(false); }
  };

  const createPortal = async () => {
    log.info('Creating portal for order', order._id);
    const res = await api.post('/portal', {
      orderId:     order._id,
      type:        order.orderType || 'product',
      orderRef:    order.refNumber || order._id.slice(-8),
      clientName:  order.clientName,
      clientEmail: order.clientEmail || '',
      title:       order.title,
    });
    setPortal(res.data);
    setNoteText('');
  };

  const removeItem = async (itemId) => {
    if (!portal) return;
    const key = portal.type === 'product' ? 'productItems' : 'offsiteItems';
    await saveItems(portal[key].filter(i => i._id !== itemId));
  };

  const moveItem = async (itemId, dir) => {
    if (!portal) return;
    const key = portal.type === 'product' ? 'productItems' : 'offsiteItems';
    const arr = [...portal[key]];
    const idx = arr.findIndex(i => i._id === itemId);
    if (dir === 'up'   && idx > 0)             [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]];
    if (dir === 'down' && idx < arr.length - 1)[arr[idx], arr[idx+1]] = [arr[idx+1], arr[idx]];
    await saveItems(arr);
  };

  const saveItems = async (items) => {
    setSaving(true);
    try {
      const key = portal.type === 'product' ? 'productItems' : 'offsiteItems';
      const res = await api.put(`/portal/${portal.slug}/items`, { [key]: items });
      setPortal(res.data);
    } finally { setSaving(false); }
  };

  const sendMessage = async () => {
    if ((!msg.trim() && chatFiles.length === 0) || sendingMsg) return;
    const perm = await requestNotifPermission();
    if (perm === 'granted') subscribeToPortalPush(fetch);
    setSendingMsg(true);
    log.debug('Sending chat message');
    try {
      const fd = new FormData();
      fd.append('text', msg.trim());
      fd.append('senderName', user?.name || 'Marqland Team');
      chatFiles.forEach(f => fd.append('files', f));
      await api.post(`/portal/${portal.slug}/message/team`, fd);
      setMsg(''); setChatFiles([]);
      await loadPortal();
      log.info('Message sent');
    } finally { setSendingMsg(false); }
  };

  const syncOffsite = async () => {
    if (!portal || syncingOffsite) return;
    setSyncingOffsite(true);
    log.debug('Syncing offsite items');
    try {
      const res = await api.post(`/portal/${portal.slug}/sync-offsite`);
      setPortal(res.data.portal || res.data);
      log.info('Offsite sync complete');
    } catch (err) {
      log.error('sync-offsite failed', err.message);
    } finally { setSyncingOffsite(false); }
  };

  const saveMeta = async () => {
    setSaving(true);
    try {
      const res = await api.put(`/portal/${portal.slug}/meta`, { teamNote: noteText });
      setPortal(res.data);
      setEditNote(false);
    } finally { setSaving(false); }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(portalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fmtT = d => new Date(d).toLocaleString('en-IN', {
    day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:true
  });

  const toggleCollapse = (cat) => setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }));

  // ── Loading state ───────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flex: 1, padding: '72px 0', flexDirection: 'column', gap: 14,
    }}>
      <div style={{
        width: 28, height: 28,
        border: '1px solid rgba(184,151,90,0.2)',
        borderTop: `1px solid ${T.gold}`,
        borderRadius: '50%',
        animation: 'ms-spin 1.1s linear infinite',
      }} />
      <style>{`@keyframes ms-spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }`}</style>
      <span style={{ fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted }}>
        Loading portal…
      </span>
    </div>
  );

  if (!portal) return null;

  const items       = portal.type === 'product' ? portal.productItems : portal.offsiteItems;
  const isCompleted = portal.status === 'completed';

  // ── Shared small-input style ────────────────────────────────────────────────
  const si = {
    border: `1px solid ${T.border}`, background: 'white', borderRadius: 3,
    fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.text,
    outline: 'none', padding: '7px 10px', width: '100%',
    boxSizing: 'border-box', transition: 'border-color 0.2s',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', fontFamily: jost }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 18px',
        borderBottom: `1px solid ${T.border}`,
        background: T.navy,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Gold rule accent */}
          <div style={{ width: 3, height: 28, background: T.gold, flexShrink: 0 }} />
          <div>
            <div style={{
              fontFamily: serif, fontSize: 15, fontWeight: 300,
              color: 'white', letterSpacing: '0.04em',
            }}>
              Client <em style={{ color: T.gold }}>Portal</em>
            </div>
            <div style={{
              fontFamily: jost, fontSize: 9, fontWeight: 400,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              color: 'rgba(184,151,90,0.55)', marginTop: 2,
            }}>
              {portal.type === 'product' ? 'Product' : 'Offsite'} · {portal.orderRef}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isCompleted && (
            <span style={{
              fontFamily: jost, fontSize: 9, fontWeight: 400,
              letterSpacing: '0.2em', textTransform: 'uppercase',
              padding: '3px 10px',
              background: 'rgba(76,175,125,0.15)', color: '#4caf7d',
              border: '1px solid rgba(76,175,125,0.3)',
            }}>
              Completed
            </span>
          )}
          {portal.viewCount > 0 && (
            <span style={{
              fontFamily: jost, fontSize: 9, fontWeight: 300,
              color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em',
            }}>
              👁 {portal.viewCount}
            </span>
          )}
          {/* Copy link */}
          <button
            onClick={copyLink}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px',
              background: copied ? 'rgba(76,175,125,0.15)' : 'rgba(255,255,255,0.07)',
              border: `1px solid ${copied ? 'rgba(76,175,125,0.3)' : 'rgba(255,255,255,0.12)'}`,
              cursor: 'pointer',
              fontFamily: jost, fontSize: 9, fontWeight: 400,
              letterSpacing: '0.18em', textTransform: 'uppercase',
              color: copied ? '#4caf7d' : 'rgba(255,255,255,0.55)',
              transition: 'all 0.2s',
            }}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          {/* Preview */}
          <a
            href={portalUrl} target="_blank" rel="noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 14px',
              background: T.gold, color: T.navy,
              border: 'none',
              fontFamily: jost, fontSize: 9, fontWeight: 500,
              letterSpacing: '0.18em', textTransform: 'uppercase',
              textDecoration: 'none', transition: 'background 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = T.gold2}
            onMouseLeave={e => e.currentTarget.style.background = T.gold}
          >
            <Eye size={11} /> Preview
          </a>
          {/* Close */}
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.3)', padding: 4, display: 'flex',
              transition: 'color 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', borderBottom: `1px solid ${T.border}`,
        flexShrink: 0, background: T.subtle,
      }}>
        {[
          { k:'items',     l:`Options (${items.length})`,                         show: true },
          { k:'selected',  l:`Selected (${(portal.shortlistedIds||[]).length})`,  show: portal.type !== 'offsite' },
          { k:'shipments', l:'Shipments',                                          show: portal.type === 'product' },
          { k:'chat',      l:`Chat (${portal.messages.length})`,                  show: true },
        ].filter(t => t.show).map(t => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            style={{
              flex: 1, padding: '11px 0',
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: jost, fontSize: 9, fontWeight: 400,
              letterSpacing: '0.2em', textTransform: 'uppercase',
              color: tab === t.k ? T.gold : T.muted,
              borderBottom: `2px solid ${tab === t.k ? T.gold : 'transparent'}`,
              marginBottom: -1,
              transition: 'color 0.2s, border-color 0.2s',
            }}
          >
            {t.l}
          </button>
        ))}
      </div>

      {/* ── Tab content ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* ══ ITEMS TAB ══ */}
        {tab === 'items' && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Intro note */}
            <div style={{
              background: T.dimBg, border: `1px solid ${T.borderG}`,
              padding: '12px 14px',
            }}>
              {editNote ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    rows={3}
                    placeholder="Write an intro note for the client…"
                    style={{
                      ...si, resize: 'none',
                      border: `1px solid ${T.gold}`,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={saveMeta} disabled={saving} style={{
                      background: T.gold, color: T.navy, border: 'none',
                      padding: '7px 16px', cursor: 'pointer',
                      fontFamily: jost, fontSize: 9, fontWeight: 400,
                      letterSpacing: '0.18em', textTransform: 'uppercase',
                      opacity: saving ? 0.5 : 1,
                    }}>
                      Save
                    </button>
                    <button onClick={() => setEditNote(false)} style={{
                      background: 'transparent', color: T.muted,
                      border: `1px solid ${T.border}`, padding: '7px 14px',
                      cursor: 'pointer', fontFamily: jost, fontSize: 9,
                      letterSpacing: '0.15em', textTransform: 'uppercase',
                    }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.text, flex: 1, lineHeight: 1.6, margin: 0 }}>
                    {noteText || <span style={{ color: T.muted, fontStyle: 'italic' }}>Add an intro note for the client…</span>}
                  </p>
                  <button onClick={() => setEditNote(true)} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: T.muted, flexShrink: 0, display: 'flex',
                    transition: 'color 0.2s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.color = T.gold}
                    onMouseLeave={e => e.currentTarget.style.color = T.muted}
                  >
                    <Edit3 size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Items */}
            {items.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 0' }}>
                <Package size={28} style={{ color: 'rgba(0,0,0,0.1)', margin: '0 auto 10px', display: 'block' }} />
                <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted }}>No items added yet</p>
                <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: 'rgba(0,0,0,0.3)', marginTop: 4 }}>
                  Go to {portal.type === 'product' ? 'Products' : 'Properties'} → select → "Add to Portal"
                </p>
              </div>
            ) : portal.type === 'product' ? (
              (() => {
                const groupMap = new Map();
                items.forEach((item, originalIdx) => {
                  const cat = item.category || 'Uncategorised';
                  if (!groupMap.has(cat)) groupMap.set(cat, []);
                  groupMap.get(cat).push({ item, originalIdx });
                });
                return Array.from(groupMap.entries()).map(([cat, entries]) => {
                  const isOpen = !collapsed[cat];
                  return (
                    <div key={cat} style={{ border: `1px solid ${T.border}`, overflow: 'hidden' }}>
                      <button
                        onClick={() => toggleCollapse(cat)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center',
                          justifyContent: 'space-between', padding: '9px 12px',
                          background: T.subtle, border: 'none', cursor: 'pointer',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = T.dimBg}
                        onMouseLeave={e => e.currentTarget.style.background = T.subtle}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{
                            fontFamily: jost, fontSize: 9, fontWeight: 400,
                            letterSpacing: '0.25em', textTransform: 'uppercase', color: T.gold,
                          }}>
                            {cat}
                          </span>
                          <span style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted }}>
                            {entries.length} item{entries.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {isOpen
                          ? <ChevronDown  size={12} style={{ color: T.muted }} />
                          : <ChevronRight size={12} style={{ color: T.muted }} />}
                      </button>
                      {isOpen && (
                        <div style={{ borderTop: `1px solid ${T.border}` }}>
                          {entries.map(({ item, originalIdx: idx }) => (
                            <div key={item._id} style={{
                              display: 'flex', gap: 12, alignItems: 'flex-start',
                              padding: 12, borderBottom: `1px solid ${T.border}`,
                              transition: 'background 0.15s',
                            }}
                              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.015)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                              <div style={{
                                width: 44, height: 44, flexShrink: 0, overflow: 'hidden',
                                background: 'rgba(0,0,0,0.06)',
                              }}>
                                {item.imageUrl
                                  ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Package size={14} style={{ color: T.muted }} /></div>
                                }
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontFamily: jost, fontSize: 12, fontWeight: 400, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                                <div style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted, marginTop: 2 }}>₹{Number(item.price||0).toLocaleString('en-IN')}</div>
                                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                                  {(item.additionalImages||[]).length > 0 && (
                                    <span style={{
                                      fontFamily: jost, fontSize: 9, fontWeight: 400,
                                      letterSpacing: '0.12em', textTransform: 'uppercase',
                                      padding: '2px 7px', background: 'rgba(155,100,200,0.1)',
                                      color: '#9b64c8', border: '1px solid rgba(155,100,200,0.2)',
                                    }}>
                                      +{item.additionalImages.length} photos
                                    </span>
                                  )}
                                  {item.videoUrl && (
                                    <span style={{
                                      fontFamily: jost, fontSize: 9, fontWeight: 400,
                                      letterSpacing: '0.12em', textTransform: 'uppercase',
                                      padding: '2px 7px', background: 'rgba(220,80,100,0.08)',
                                      color: '#c84060', border: '1px solid rgba(220,80,100,0.2)',
                                    }}>
                                      video
                                    </span>
                                  )}
                                </div>
                                {item.note && <div style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.gold, marginTop: 4, fontStyle: 'italic' }}>{item.note}</div>}
                              </div>
                              {/* Move + remove controls */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {[
                                  { icon: ChevronUp, action: () => moveItem(item._id, 'up'), disabled: idx === 0 },
                                  { icon: ChevronDown, action: () => moveItem(item._id, 'down'), disabled: idx === items.length - 1 },
                                  { icon: Trash2, action: () => removeItem(item._id), disabled: false, danger: true },
                                ].map(({ icon: Icon, action, disabled, danger }) => (
                                  <button
                                    key={Icon.displayName || Icon.name}
                                    onClick={action}
                                    disabled={disabled}
                                    style={{
                                      background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer',
                                      color: T.muted, opacity: disabled ? 0.2 : 1, padding: 3, display: 'flex',
                                      transition: 'color 0.15s',
                                    }}
                                    onMouseEnter={e => { if (!disabled) e.currentTarget.style.color = danger ? '#dc2626' : T.gold; }}
                                    onMouseLeave={e => { e.currentTarget.style.color = T.muted; }}
                                  >
                                    <Icon size={12} />
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                });
              })()
            ) : (
              // ── Offsite items ────────────────────────────────────────────────
              (() => {
                const STD_ADDONS = [
                  { priceKey:'djCost',         label:'DJ'                },
                  { priceKey:'licenseFeeDJ',   label:'DJ Licence'        },
                  { priceKey:'cocktailSnacks', label:'Cocktails & Snacks' },
                  { priceKey:'banquetHall',    label:'Banquet Hall'      },
                ];
                const NIGHT_ROOMS = [
                  { key:'single', label:'Single', priceKey:'singlePrice' },
                  { key:'double', label:'Double', priceKey:'doublePrice' },
                  { key:'triple', label:'Triple', priceKey:'triplePrice' },
                  { key:'quad',   label:'Quad',   priceKey:'quadPrice'   },
                ];
                const calcState = portal.calculatorState || {};
                const saveCalcState = async (newState) => {
                  try {
                    await api.put(`/portal/${portal.slug}/calculator`, { calculatorState: newState });
                    setPortal(p => ({ ...p, calculatorState: newState }));
                  } catch (e) { log.error('calc save failed', e.message); }
                };
                const getItemState = (itemId) => calcState[itemId] || {};
                const setRoomCount = async (itemId, roomKey, val) => {
                  const count = Math.max(0, Number(val) || 0);
                  const cur   = getItemState(itemId);
                  await saveCalcState({ ...calcState, [itemId]: { ...cur, [roomKey]: count } });
                };
                const setGuests = async (itemId, val) => {
                  const guests = Math.max(0, Number(val) || 0);
                  const cur    = getItemState(itemId);
                  await saveCalcState({ ...calcState, [itemId]: { ...cur, pax: guests } });
                };
                const toggleRoomDisabled = async (itemId, roomKey) => {
                  const cur      = getItemState(itemId);
                  const disabled = cur.disabledRooms || {};
                  await saveCalcState({ ...calcState, [itemId]: { ...cur, disabledRooms: { ...disabled, [roomKey]: !disabled[roomKey] } } });
                };
                const toggleCatRoomDisabled = async (itemId, catId, roomKey) => {
                  const cur          = getItemState(itemId);
                  const disabled     = cur.disabledRooms || {};
                  const compositeKey = `cat_${catId}_${roomKey}`;
                  await saveCalcState({ ...calcState, [itemId]: { ...cur, disabledRooms: { ...disabled, [compositeKey]: !disabled[compositeKey] } } });
                };
                const setCatRoomCount = async (itemId, catId, roomKey, val) => {
                  const count        = Math.max(0, Number(val) || 0);
                  const cur          = getItemState(itemId);
                  const compositeKey = `cat_${catId}_${roomKey}`;
                  await saveCalcState({ ...calcState, [itemId]: { ...cur, [compositeKey]: count } });
                };
                const toggleAddonDisabled = async (itemId, addonKey) => {
                  const cur      = getItemState(itemId);
                  const disabled = cur.disabledAddons || {};
                  await saveCalcState({ ...calcState, [itemId]: { ...cur, disabledAddons: { ...disabled, [addonKey]: !disabled[addonKey] } } });
                };

                return (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                      <button onClick={syncOffsite} disabled={syncingOffsite} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '6px 14px', background: T.dimBg, color: T.gold,
                        border: `1px solid ${T.borderG}`, cursor: 'pointer',
                        fontFamily: jost, fontSize: 9, fontWeight: 400,
                        letterSpacing: '0.18em', textTransform: 'uppercase',
                        opacity: syncingOffsite ? 0.5 : 1, transition: 'all 0.2s',
                      }}>
                        {syncingOffsite ? <><Loader2 size={10} style={{ animation: 'ms-spin 1s linear infinite' }} /> Syncing…</> : <><RefreshCw size={10} /> Sync room categories</>}
                      </button>
                    </div>
                    {items.map((item, idx) => {
                      const isDayOut      = item.type !== 'Night Stay';
                      const stdVisible    = STD_ADDONS.filter(a => (item[a.priceKey]||0) > 0);
                      const adhocVisible  = (item.adhocAddons||[]).filter(a => (a.sellingPrice||0) > 0);
                      const hasAddons     = stdVisible.length > 0 || adhocVisible.length > 0;
                      const nightRooms    = isDayOut ? [] : NIGHT_ROOMS.filter(r => (item[r.priceKey]||0) > 0);
                      const itemState     = getItemState(item._id);
                      const disabledMap   = itemState.disabledAddons || {};
                      const disabledRooms = itemState.disabledRooms || {};

                      return (
                        <div key={item._id} style={{ border: `1px solid ${T.border}`, overflow: 'hidden', marginBottom: 8 }}>
                          {/* Item header row */}
                          <div style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                            <div style={{ width: 44, height: 44, overflow: 'hidden', flexShrink: 0, background: 'rgba(0,0,0,0.06)' }}>
                              {item.imageUrl
                                ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <div style={{ width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center' }}><MapPin size={14} style={{ color: T.muted }} /></div>
                              }
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: jost, fontSize: 12, fontWeight: 400, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                              <div style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted, marginTop: 2 }}>
                                {item.location}
                                {item.doublePrice > 0 && ` · ₹${Number(item.doublePrice).toLocaleString('en-IN')}/double`}
                                {item.dayPackages?.length > 0 && ` · ${item.dayPackages.length} pkg${item.dayPackages.length !== 1?'s':''}`}
                              </div>
                              {item.note && <div style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.gold, marginTop: 3, fontStyle: 'italic' }}>{item.note}</div>}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {[
                                { icon: ChevronUp, action: () => moveItem(item._id,'up'), disabled: idx === 0 },
                                { icon: ChevronDown, action: () => moveItem(item._id,'down'), disabled: idx === items.length-1 },
                                { icon: Trash2, action: () => removeItem(item._id), disabled: false, danger: true },
                              ].map(({ icon: Icon, action, disabled, danger }) => (
                                <button key={Icon.name} onClick={action} disabled={disabled} style={{
                                  background:'none',border:'none',cursor:disabled?'default':'pointer',
                                  color:T.muted,opacity:disabled?0.2:1,padding:3,display:'flex',transition:'color 0.15s',
                                }}
                                  onMouseEnter={e => { if(!disabled) e.currentTarget.style.color = danger?'#dc2626':T.gold; }}
                                  onMouseLeave={e => { e.currentTarget.style.color = T.muted; }}
                                >
                                  <Icon size={12} />
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Calculator pre-set panel */}
                          <div style={{ borderTop: `1px solid ${T.border}`, background: T.subtle, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {/* Day outing: pax */}
                            {isDayOut && (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                <span style={{ fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.22em', textTransform: 'uppercase', color: T.muted }}>Guest Count</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {['-','+'].map((lbl, li) => (
                                    <button key={lbl} onClick={() => setGuests(item._id, Math.max(0,(Number(itemState.pax)||0)+(li?1:-1)))}
                                      style={{ width:24,height:24,border:`1px solid ${T.border}`,background:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:T.muted,transition:'border-color 0.15s,color 0.15s' }}
                                      onMouseEnter={e=>{e.currentTarget.style.borderColor=T.gold;e.currentTarget.style.color=T.gold;}}
                                      onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.muted;}}
                                    >{lbl}</button>
                                  ))}
                                  <input type="number" min="0" value={itemState.pax??''} placeholder="0"
                                    onChange={e => setGuests(item._id, e.target.value)}
                                    style={{ width:52,textAlign:'center',border:`1px solid ${T.border}`,background:'white',padding:'4px 6px',fontFamily:jost,fontSize:12,fontWeight:400,color:T.text,outline:'none',transition:'border-color 0.15s' }}
                                    onFocus={e=>e.target.style.borderColor=T.gold} onBlur={e=>e.target.style.borderColor=T.border}
                                  />
                                  <span style={{ fontFamily:jost,fontSize:9,fontWeight:300,color:T.muted }}>guests</span>
                                </div>
                              </div>
                            )}

                            {/* Night stay: room counts */}
                            {!isDayOut && nightRooms.length > 0 && (
                              <div>
                                <div style={{ fontFamily:jost,fontSize:9,fontWeight:400,letterSpacing:'0.22em',textTransform:'uppercase',color:T.muted,marginBottom:8 }}>
                                  Room Count <span style={{ fontWeight:300,textTransform:'none',letterSpacing:0,fontSize:10 }}>— toggle off to hide room type</span>
                                </div>
                                <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
                                  {nightRooms.map(r => {
                                    const isOff    = !!disabledRooms[r.key];
                                    const roomCount = itemState[r.key] ?? '';
                                    return (
                                      <div key={r.key} style={{ display:'flex',alignItems:'center',gap:8 }}>
                                        <Toggle on={!isOff} onClick={() => toggleRoomDisabled(item._id, r.key)} />
                                        <span style={{ fontFamily:jost,fontSize:11,fontWeight:300,width:44,flexShrink:0,color:isOff?T.muted:T.text,opacity:isOff?0.4:1 }}>{r.label}</span>
                                        <span style={{ fontFamily:jost,fontSize:10,fontWeight:300,color:T.muted,flex:1 }}>₹{Number(item[r.priceKey]).toLocaleString('en-IN')}/night</span>
                                        {!isOff && (
                                          <div style={{ display:'flex',alignItems:'center',gap:5,flexShrink:0 }}>
                                            {['-','+'].map((lbl,li)=>(
                                              <button key={lbl} onClick={()=>setRoomCount(item._id,r.key,Math.max(0,(Number(roomCount)||0)+(li?1:-1)))}
                                                style={{ width:20,height:20,border:`1px solid ${T.border}`,background:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:T.muted }}>{lbl}</button>
                                            ))}
                                            <input type="number" min="0" value={roomCount} placeholder="0"
                                              onChange={e=>setRoomCount(item._id,r.key,e.target.value)}
                                              style={{ width:40,textAlign:'center',border:`1px solid ${T.border}`,background:'white',padding:'3px 4px',fontFamily:jost,fontSize:11,fontWeight:400,color:T.text,outline:'none' }}
                                              onFocus={e=>e.target.style.borderColor=T.gold} onBlur={e=>e.target.style.borderColor=T.border}
                                            />
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Room categories */}
                            {!isDayOut && (item.roomCategories||[]).length > 0 && (
                              <div>
                                <div style={{ fontFamily:jost,fontSize:9,fontWeight:400,letterSpacing:'0.22em',textTransform:'uppercase',color:T.muted,marginBottom:8 }}>
                                  Room Categories
                                </div>
                                {(item.roomCategories||[]).map(cat => {
                                  const catRooms = [
                                    { key:'single',label:'Single',price:cat.singlePrice },
                                    { key:'double',label:'Double',price:cat.doublePrice },
                                    { key:'triple',label:'Triple',price:cat.triplePrice },
                                  ].filter(r=>r.price>0);
                                  if (catRooms.length === 0) return null;
                                  const catId         = cat._id || cat.name;
                                  const catDisabledKey = `cat_${catId}`;
                                  const isCatOff       = !!disabledRooms[catDisabledKey];
                                  return (
                                    <div key={catId} style={{ border:`1px solid ${T.border}`,marginBottom:8,overflow:'hidden' }}>
                                      <div style={{ display:'flex',alignItems:'center',gap:8,padding:'8px 10px',background:T.subtle }}>
                                        <Toggle on={!isCatOff} onClick={() => toggleRoomDisabled(item._id, catDisabledKey)} />
                                        <span style={{ fontFamily:jost,fontSize:9,fontWeight:400,letterSpacing:'0.18em',textTransform:'uppercase',color:isCatOff?T.muted:T.gold }}>{cat.name}</span>
                                      </div>
                                      {!isCatOff && (
                                        <div style={{ padding:'8px 10px',display:'flex',flexDirection:'column',gap:6 }}>
                                          {catRooms.map(r=>{
                                            const ck    = `cat_${catId}_${r.key}`;
                                            const isOff = !!disabledRooms[ck];
                                            const cnt   = itemState[ck]??'';
                                            return (
                                              <div key={r.key} style={{ display:'flex',alignItems:'center',gap:8 }}>
                                                <Toggle on={!isOff} onClick={() => toggleCatRoomDisabled(item._id,catId,r.key)} />
                                                <span style={{ fontFamily:jost,fontSize:11,fontWeight:300,width:44,color:isOff?T.muted:T.text,opacity:isOff?0.4:1 }}>{r.label}</span>
                                                <span style={{ fontFamily:jost,fontSize:10,fontWeight:300,color:T.muted,flex:1 }}>₹{Number(r.price).toLocaleString('en-IN')}/night</span>
                                                {!isOff && (
                                                  <div style={{ display:'flex',alignItems:'center',gap:4 }}>
                                                    {['-','+'].map((lbl,li)=>(
                                                      <button key={lbl} onClick={()=>setCatRoomCount(item._id,catId,r.key,Math.max(0,(Number(cnt)||0)+(li?1:-1)))}
                                                        style={{ width:18,height:18,border:`1px solid ${T.border}`,background:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:T.muted }}>{lbl}</button>
                                                    ))}
                                                    <input type="number" min="0" value={cnt} placeholder="0"
                                                      onChange={e=>setCatRoomCount(item._id,catId,r.key,e.target.value)}
                                                      style={{ width:36,textAlign:'center',border:`1px solid ${T.border}`,background:'white',padding:'2px 4px',fontFamily:jost,fontSize:10,color:T.text,outline:'none' }}
                                                    />
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Addon toggles */}
                            {hasAddons && (
                              <div>
                                <div style={{ fontFamily:jost,fontSize:9,fontWeight:400,letterSpacing:'0.22em',textTransform:'uppercase',color:T.muted,marginBottom:6 }}>
                                  Addon Visibility
                                </div>
                                <div style={{ display:'flex',flexDirection:'column',gap:6 }}>
                                  {stdVisible.map(a=>{
                                    const isDisabled = !!disabledMap[a.priceKey];
                                    return (
                                      <div key={a.priceKey} style={{ display:'flex',alignItems:'center',gap:8 }}>
                                        <Toggle on={!isDisabled} onClick={() => toggleAddonDisabled(item._id,a.priceKey)} />
                                        <span style={{ fontFamily:jost,fontSize:11,fontWeight:300,flex:1,color:isDisabled?T.muted:T.text,textDecoration:isDisabled?'line-through':'none',opacity:isDisabled?0.5:1 }}>
                                          {a.label}
                                          <span style={{ fontWeight:300,color:T.muted,marginLeft:6,fontSize:10 }}>· ₹{Number(item[a.priceKey]).toLocaleString('en-IN')}</span>
                                        </span>
                                      </div>
                                    );
                                  })}
                                  {adhocVisible.map((a,ai)=>{
                                    const key        = `adhoc_${ai}`;
                                    const isDisabled = !!disabledMap[key];
                                    return (
                                      <div key={ai} style={{ display:'flex',alignItems:'center',gap:8 }}>
                                        <Toggle on={!isDisabled} onClick={() => toggleAddonDisabled(item._id,key)} />
                                        <span style={{ fontFamily:jost,fontSize:11,fontWeight:300,flex:1,color:isDisabled?T.muted:T.text,textDecoration:isDisabled?'line-through':'none',opacity:isDisabled?0.5:1 }}>
                                          {a.name}
                                          <span style={{ fontWeight:300,color:T.muted,marginLeft:6,fontSize:10 }}>· ₹{Number(a.sellingPrice).toLocaleString('en-IN')}</span>
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            )}

            {/* ── Custom item form — product portals only ── */}
            {portal.type === 'product' && (
              <div style={{ border: `1px dashed ${T.borderG}`, overflow: 'hidden' }}>
                {!showCustomForm ? (
                  <button
                    onClick={() => setShowCustomForm(true)}
                    style={{
                      width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                      padding:'12px 0', background:'none', border:'none', cursor:'pointer',
                      fontFamily:jost, fontSize:9, fontWeight:400, letterSpacing:'0.2em', textTransform:'uppercase',
                      color:T.muted, transition:'color 0.2s, background 0.2s',
                    }}
                    onMouseEnter={e=>{e.currentTarget.style.background=T.dimBg;e.currentTarget.style.color=T.gold;}}
                    onMouseLeave={e=>{e.currentTarget.style.background='none';e.currentTarget.style.color=T.muted;}}
                  >
                    <ImagePlus size={12} /> Add Discussion / Custom Item
                  </button>
                ) : (
                  <div>
                    <div style={{
                      display:'flex', alignItems:'center', justifyContent:'space-between',
                      padding:'8px 12px', background:T.dimBg, borderBottom:`1px solid ${T.borderG}`,
                    }}>
                      <span style={{ fontFamily:jost,fontSize:9,fontWeight:400,letterSpacing:'0.25em',textTransform:'uppercase',color:T.gold }}>
                        Custom Item
                      </span>
                      <button onClick={resetCustomForm} style={{ background:'none',border:'none',cursor:'pointer',color:T.muted,display:'flex',transition:'color 0.2s' }}
                        onMouseEnter={e=>e.currentTarget.style.color=T.gold} onMouseLeave={e=>e.currentTarget.style.color=T.muted}>
                        <X size={12} />
                      </button>
                    </div>
                    <div style={{ padding:12, display:'flex',flexDirection:'column',gap:10 }}>
                      {/* Image + name */}
                      <div style={{ display:'flex',alignItems:'flex-start',gap:10 }}>
                        <div onClick={() => customImageRef.current?.click()} style={{
                          width:52,height:52,flexShrink:0,border:`1px dashed ${T.borderG}`,
                          display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',overflow:'hidden',
                          transition:'border-color 0.2s',
                        }}
                          onMouseEnter={e=>e.currentTarget.style.borderColor=T.gold}
                          onMouseLeave={e=>e.currentTarget.style.borderColor=T.borderG}
                        >
                          {customPreview
                            ? <img src={customPreview} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }} />
                            : <ImagePlus size={14} style={{ color:T.muted }} />}
                        </div>
                        <input ref={customImageRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handleCustomImagePick} />
                        <input type="text" placeholder="Product name *" value={customForm.name}
                          onChange={e=>setCustomForm(p=>({...p,name:e.target.value}))}
                          style={{ ...si, flex:1 }}
                          onFocus={e=>e.target.style.borderColor=T.gold} onBlur={e=>e.target.style.borderColor=T.border}
                        />
                      </div>
                      <textarea placeholder="Description (optional)" value={customForm.description}
                        onChange={e=>setCustomForm(p=>({...p,description:e.target.value}))}
                        rows={2} style={{ ...si,resize:'none' }}
                        onFocus={e=>e.target.style.borderColor=T.gold} onBlur={e=>e.target.style.borderColor=T.border}
                      />
                      <div style={{ display:'flex',alignItems:'center',gap:8 }}>
                        <span style={{ fontFamily:jost,fontSize:12,fontWeight:300,color:T.muted }}>₹</span>
                        <input type="number" min="0" placeholder="Price (optional)" value={customForm.price}
                          onChange={e=>setCustomForm(p=>({...p,price:e.target.value}))}
                          style={{ ...si,flex:1 }}
                          onFocus={e=>e.target.style.borderColor=T.gold} onBlur={e=>e.target.style.borderColor=T.border}
                        />
                      </div>
                      <button onClick={handleAddCustomItem} disabled={savingCustom || !customForm.name.trim()} style={{
                        width:'100%', display:'flex',alignItems:'center',justifyContent:'center',gap:8,
                        padding:'10px 0',
                        background: (savingCustom||!customForm.name.trim()) ? 'rgba(184,151,90,0.4)' : T.gold,
                        color:T.navy, border:'none', cursor:(savingCustom||!customForm.name.trim())?'not-allowed':'pointer',
                        fontFamily:jost,fontSize:9,fontWeight:500,letterSpacing:'0.22em',textTransform:'uppercase',
                        transition:'background 0.2s',
                      }}>
                        {savingCustom ? <><Loader2 size={10} style={{ animation:'ms-spin 1s linear infinite' }} /> Adding…</> : <><Plus size={10} /> Add to Portal</>}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ textAlign:'center', paddingBottom:8 }}>
              <p style={{ fontFamily:jost,fontSize:9,fontWeight:300,letterSpacing:'0.18em',color:'rgba(0,0,0,0.25)',textTransform:'uppercase' }}>
                Add items → {portal.type==='product'?'Products page':'Property List'} → select → "Add to Portal"
              </p>
            </div>
          </div>
        )}

        {/* ══ CHAT TAB ══ */}
        {tab === 'chat' && (
          <div style={{ display:'flex',flexDirection:'column',minHeight:400 }}>
            <div style={{ flex:1,overflowY:'auto',padding:'14px 14px 4px',display:'flex',flexDirection:'column',gap:10 }}>
              {portal.messages.length === 0 && (
                <div style={{ textAlign:'center',padding:'40px 0',fontFamily:jost,fontSize:12,fontWeight:300,color:T.muted }}>
                  No messages yet. Start the conversation.
                </div>
              )}
              {portal.messages.map(m => {
                const isTeam = m.sender === 'team';
                return (
                  <div key={m._id} style={{ display:'flex',gap:10,flexDirection:isTeam?'row-reverse':'row' }}>
                    {/* Avatar */}
                    <div style={{
                      width:26,height:26,flexShrink:0,alignSelf:'flex-end',marginBottom:2,
                      background: isTeam ? T.navy : 'rgba(184,151,90,0.12)',
                      display:'flex',alignItems:'center',justifyContent:'center',
                    }}>
                      <span style={{ fontFamily:jost,fontSize:9,fontWeight:500,color:isTeam?T.gold:'#8a6010',letterSpacing:'0.04em' }}>
                        {(m.senderName||'T').slice(0,2).toUpperCase()}
                      </span>
                    </div>
                    <div style={{ maxWidth:'78%',display:'flex',flexDirection:'column',alignItems:isTeam?'flex-end':'flex-start' }}>
                      <div style={{ fontFamily:jost,fontSize:9,fontWeight:300,color:T.muted,marginBottom:3,textAlign:isTeam?'right':'left' }}>
                        {m.senderName} · {fmtT(m.createdAt)}
                      </div>
                      <div style={{
                        padding:'10px 12px',
                        background: isTeam ? T.navy : T.subtle,
                        borderTopRightRadius: isTeam ? 0 : 8,
                        borderTopLeftRadius:  isTeam ? 8 : 0,
                        borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
                      }}>
                        {m.text && (
                          <div style={{ fontFamily:jost,fontSize:12,fontWeight:300,lineHeight:1.6,color:isTeam?'rgba(255,255,255,0.85)':T.text }}>
                            {m.text}
                          </div>
                        )}
                        {(m.attachments||[]).map((att,i) => (
                          <a key={i} href={att.url} target="_blank" rel="noreferrer"
                            onClick={async e => {
                              e.preventDefault();
                              try {
                                const res  = await fetch(att.url);
                                const blob = await res.blob();
                                const url  = URL.createObjectURL(blob);
                                const a    = document.createElement('a');
                                a.href = url; a.download = att.name;
                                document.body.appendChild(a); a.click();
                                document.body.removeChild(a); URL.revokeObjectURL(url);
                              } catch { window.open(att.url,'_blank'); }
                            }}
                            style={{
                              display:'flex',alignItems:'center',gap:6,marginTop:6,padding:'6px 10px',
                              background: isTeam?'rgba(255,255,255,0.08)':'white',
                              border:`1px solid ${isTeam?'rgba(255,255,255,0.1)':T.border}`,
                              textDecoration:'none',cursor:'pointer',transition:'background 0.15s',
                            }}
                          >
                            <Paperclip size={10} style={{ flexShrink:0, color:isTeam?'rgba(255,255,255,0.5)':T.muted }} />
                            <span style={{ fontFamily:jost,fontSize:10,fontWeight:300,color:isTeam?'rgba(255,255,255,0.7)':T.muted,maxWidth:110,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{att.name}</span>
                            <Download size={10} style={{ flexShrink:0,marginLeft:'auto',color:isTeam?'rgba(255,255,255,0.5)':T.muted }} />
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {/* File previews */}
            {chatFiles.length > 0 && (
              <div style={{ display:'flex',flexWrap:'wrap',gap:6,padding:'8px 14px' }}>
                {chatFiles.map((f,i) => (
                  <div key={i} style={{
                    display:'flex',alignItems:'center',gap:5,
                    background:T.dimBg, border:`1px solid ${T.borderG}`,
                    padding:'4px 8px',
                  }}>
                    <Paperclip size={10} style={{ color:T.gold }} />
                    <span style={{ fontFamily:jost,fontSize:10,fontWeight:300,color:T.gold,maxWidth:80,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{f.name}</span>
                    <button onClick={() => setChatFiles(chatFiles.filter((_,idx)=>idx!==i))}
                      style={{ background:'none',border:'none',cursor:'pointer',color:T.muted,display:'flex',padding:0 }}>
                      <X size={9} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Message input */}
            <div style={{ padding:'10px 12px',borderTop:`1px solid ${T.border}`,flexShrink:0 }}>
              <div style={{ display:'flex',gap:8,alignItems:'flex-end' }}>
                <div style={{ flex:1,background:T.subtle,border:`1px solid ${T.border}`,transition:'border-color 0.2s' }}
                  onFocusCapture={e => e.currentTarget.style.borderColor = T.gold}
                  onBlurCapture={e => e.currentTarget.style.borderColor = T.border}
                >
                  <textarea value={msg} onChange={e => setMsg(e.target.value)}
                    onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();} }}
                    placeholder={`Message as ${user?.name||'Team'}… (Enter to send)`}
                    rows={2}
                    style={{ width:'100%',background:'transparent',padding:'10px 12px 4px',fontFamily:jost,fontSize:12,fontWeight:300,color:T.text,outline:'none',resize:'none',border:'none',boxSizing:'border-box' }}
                  />
                  <div style={{ padding:'4px 12px 8px',display:'flex',alignItems:'center',gap:8,borderTop:`1px solid ${T.border}`,marginTop:2 }}>
                    <button type="button" onClick={() => chatFileRef.current?.click()}
                      style={{ background:'none',border:'none',cursor:'pointer',display:'flex',alignItems:'center',gap:5,fontFamily:jost,fontSize:9,fontWeight:400,letterSpacing:'0.15em',textTransform:'uppercase',color:T.muted,transition:'color 0.2s' }}
                      onMouseEnter={e=>e.currentTarget.style.color=T.gold}
                      onMouseLeave={e=>e.currentTarget.style.color=T.muted}
                    >
                      <Paperclip size={11} /> Attach
                    </button>
                    <span style={{ fontFamily:jost,fontSize:9,fontWeight:300,color:'rgba(0,0,0,0.2)' }}>Max 5 files</span>
                  </div>
                </div>
                <button onClick={sendMessage} disabled={sendingMsg||(!msg.trim()&&chatFiles.length===0)}
                  style={{
                    width:38,height:38,flexShrink:0,marginBottom:2,
                    background:T.gold, border:'none', cursor:'pointer',
                    display:'flex',alignItems:'center',justifyContent:'center',
                    opacity:(sendingMsg||(!msg.trim()&&chatFiles.length===0))?0.4:1,
                    transition:'background 0.2s',
                  }}
                  onMouseEnter={e=>e.currentTarget.style.background=T.gold2}
                  onMouseLeave={e=>e.currentTarget.style.background=T.gold}
                >
                  {sendingMsg ? <RefreshCw size={13} style={{ animation:'ms-spin 1s linear infinite', color:T.navy }} /> : <Send size={13} style={{ color:T.navy }} />}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══ SHIPMENTS TAB ══ */}
        {tab === 'shipments' && (() => {
          const DELAYED_STATUSES = new Set(['Returned','Exception']);
          const STATUS_COLORS = {
            'Pending':          { bg:'rgba(0,0,0,0.05)',         color:T.muted },
            'Booked':           { bg:'rgba(74,144,196,0.1)',      color:'#3a6090' },
            'In Transit':       { bg:'rgba(196,154,32,0.1)',      color:'#8a6010' },
            'Out for Delivery': { bg:'rgba(220,120,40,0.1)',      color:'#8a5010' },
            'Delivered':        { bg:'rgba(76,175,125,0.1)',      color:'#3a7a5a' },
            'Completed':        { bg:'rgba(76,175,125,0.1)',      color:'#3a7a5a' },
            'Returned':         { bg:'rgba(220,38,38,0.08)',      color:'#b02020' },
            'Exception':        { bg:'rgba(220,38,38,0.08)',      color:'#b02020' },
          };
          const q        = shipmentSearch.toLowerCase().trim();
          const filtered = shipments.filter(s =>
            !q ||
            (s.recipientName||'').toLowerCase().includes(q) ||
            (s.trackingId||'').toLowerCase().includes(q) ||
            (s.city||'').toLowerCase().includes(q) ||
            (s.shippingPartner||'').toLowerCase().includes(q) ||
            (s.status||'').toLowerCase().includes(q)
          );
          const statusGroups = {};
          filtered.forEach(s => { const st = s.status||'Pending'; if(!statusGroups[st])statusGroups[st]=[]; statusGroups[st].push(s); });
          const STATUS_ORDER = ['Exception','Returned','In Transit','Out for Delivery','Booked','Pending','Delivered','Completed'];
          const sortedStatuses = Object.keys(statusGroups).sort((a,b)=>(STATUS_ORDER.indexOf(a)===-1?99:STATUS_ORDER.indexOf(a))-(STATUS_ORDER.indexOf(b)===-1?99:STATUS_ORDER.indexOf(b)));

          return (
            <div style={{ display:'flex',flexDirection:'column',height:'100%' }}>
              {/* Search */}
              <div style={{ padding:'14px 14px 10px',flexShrink:0 }}>
                <div style={{ display:'flex',gap:8 }}>
                  <div style={{ flex:1,display:'flex',alignItems:'center',gap:8,border:`1px solid ${T.border}`,background:'white',padding:'8px 12px',transition:'border-color 0.2s' }}
                    onFocusCapture={e=>e.currentTarget.style.borderColor=T.gold}
                    onBlurCapture={e=>e.currentTarget.style.borderColor=T.border}
                  >
                    <Search size={12} style={{ color:T.muted,flexShrink:0 }} />
                    <input value={shipmentSearch} onChange={e=>setShipmentSearch(e.target.value)}
                      placeholder="Search recipient, city, tracking ID, partner…"
                      style={{ flex:1,background:'transparent',border:'none',outline:'none',fontFamily:jost,fontSize:11,fontWeight:300,color:T.text }}
                    />
                    {shipmentSearch && (
                      <button onClick={()=>setShipmentSearch('')} style={{ background:'none',border:'none',cursor:'pointer',color:T.muted,display:'flex' }}><X size={11}/></button>
                    )}
                  </div>
                  <button onClick={loadShipments} disabled={shipmentsLoading} style={{
                    background:'white',border:`1px solid ${T.border}`,padding:'8px 10px',cursor:'pointer',display:'flex',alignItems:'center',
                    color:T.muted,opacity:shipmentsLoading?0.4:1,transition:'border-color 0.2s,color 0.2s',
                  }}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=T.gold;e.currentTarget.style.color=T.gold;}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.muted;}}
                  >
                    <RefreshCw size={12} style={{ animation:shipmentsLoading?'ms-spin 1s linear infinite':undefined }} />
                  </button>
                </div>
                <div style={{ display:'flex',gap:12,marginTop:8,flexWrap:'wrap' }}>
                  <span style={{ fontFamily:jost,fontSize:9,fontWeight:400,letterSpacing:'0.2em',textTransform:'uppercase',color:T.muted }}>
                    {shipments.length} shipment{shipments.length!==1?'s':''}
                  </span>
                  {shipments.filter(s=>DELAYED_STATUSES.has(s.status)).length > 0 && (
                    <span style={{ display:'flex',alignItems:'center',gap:4,fontFamily:jost,fontSize:9,fontWeight:400,letterSpacing:'0.15em',textTransform:'uppercase',color:'#dc2626' }}>
                      <AlertTriangle size={9} /> {shipments.filter(s=>DELAYED_STATUSES.has(s.status)).length} delayed
                    </span>
                  )}
                </div>
              </div>

              <div style={{ flex:1,overflowY:'auto',padding:'0 14px 14px' }}>
                {shipmentsLoading ? (
                  <div style={{ display:'flex',alignItems:'center',justifyContent:'center',padding:'56px 0',gap:10 }}>
                    <div style={{ width:18,height:18,border:`1px solid ${T.borderG}`,borderTop:`1px solid ${T.gold}`,borderRadius:'50%',animation:'ms-spin 1s linear infinite' }} />
                    <span style={{ fontFamily:jost,fontSize:11,fontWeight:300,color:T.muted }}>Loading shipments…</span>
                  </div>
                ) : filtered.length === 0 ? (
                  <div style={{ textAlign:'center',padding:'56px 0' }}>
                    <div style={{ fontSize:28,marginBottom:10 }}>📦</div>
                    <p style={{ fontFamily:jost,fontSize:12,fontWeight:300,color:T.muted }}>
                      {shipments.length===0?'No shipments linked to this order yet.':'No results match your search.'}
                    </p>
                    <p style={{ fontFamily:jost,fontSize:11,fontWeight:300,color:'rgba(0,0,0,0.25)',marginTop:4 }}>
                      {shipments.length===0?'Link shipments from the Courier Tracking page.':'Try a different search term.'}
                    </p>
                  </div>
                ) : (
                  <div style={{ display:'flex',flexDirection:'column',gap:20 }}>
                    {sortedStatuses.map(status => {
                      const sc = STATUS_COLORS[status] || STATUS_COLORS['Pending'];
                      return (
                        <div key={status}>
                          <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:8 }}>
                            <span style={{ fontFamily:jost,fontSize:9,fontWeight:400,letterSpacing:'0.18em',textTransform:'uppercase',padding:'3px 10px',background:sc.bg,color:sc.color }}>
                              {status}
                            </span>
                            <span style={{ fontFamily:jost,fontSize:9,fontWeight:300,color:T.muted }}>{statusGroups[status].length}</span>
                            {DELAYED_STATUSES.has(status) && <AlertTriangle size={10} style={{ color:'#dc2626' }} />}
                          </div>
                          <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
                            {statusGroups[status].map(s => {
                              const isDelayed = DELAYED_STATUSES.has(s.status);
                              return (
                                <div key={s._id} style={{
                                  border: `1px solid ${isDelayed?'rgba(220,38,38,0.2)':T.border}`,
                                  background: isDelayed?'rgba(220,38,38,0.02)':'white',
                                  padding:12,
                                }}>
                                  <div style={{ display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8 }}>
                                    <div style={{ display:'flex',alignItems:'flex-start',gap:10,minWidth:0 }}>
                                      <div style={{ width:26,height:26,flexShrink:0,background:isDelayed?'rgba(220,38,38,0.1)':'rgba(0,0,0,0.05)',display:'flex',alignItems:'center',justifyContent:'center',marginTop:1 }}>
                                        <Truck size={11} style={{ color:isDelayed?'#dc2626':T.muted }} />
                                      </div>
                                      <div style={{ minWidth:0 }}>
                                        <div style={{ display:'flex',alignItems:'center',gap:6,flexWrap:'wrap' }}>
                                          <span style={{ fontFamily:jost,fontSize:12,fontWeight:400,color:T.text }}>{s.recipientName||'—'}</span>
                                          {isDelayed && (
                                            <span style={{ fontFamily:jost,fontSize:9,fontWeight:400,letterSpacing:'0.15em',textTransform:'uppercase',padding:'2px 7px',background:'rgba(220,38,38,0.1)',color:'#dc2626',display:'flex',alignItems:'center',gap:3 }}>
                                              <AlertTriangle size={8} /> Delayed
                                            </span>
                                          )}
                                        </div>
                                        {s.phone && <div style={{ fontFamily:jost,fontSize:10,fontWeight:300,color:T.muted,marginTop:2 }}>{s.phone}</div>}
                                        <div style={{ display:'flex',gap:10,marginTop:4,flexWrap:'wrap' }}>
                                          {s.city && <span style={{ fontFamily:jost,fontSize:10,fontWeight:300,color:T.muted,display:'flex',alignItems:'center',gap:4 }}><MapPin size={9} style={{ color:T.muted }} />{s.city}</span>}
                                          {s.shippingPartner && <span style={{ fontFamily:jost,fontSize:10,fontWeight:300,color:T.muted }}>{s.shippingPartner}</span>}
                                        </div>
                                      </div>
                                    </div>
                                    <div style={{ flexShrink:0,textAlign:'right' }}>
                                      {s.trackingId ? (
                                        <span style={{ fontFamily:'monospace',fontSize:10,fontWeight:500,color:T.gold,background:T.dimBg,border:`1px solid ${T.borderG}`,padding:'2px 8px' }}>
                                          {s.trackingId}
                                        </span>
                                      ) : (
                                        <span style={{ fontFamily:jost,fontSize:10,fontWeight:300,color:'rgba(0,0,0,0.2)' }}>No tracking ID</span>
                                      )}
                                      {s.deliveryDate && (
                                        <div style={{ fontFamily:jost,fontSize:9,fontWeight:300,color:T.muted,marginTop:4 }}>
                                          ETA {new Date(s.deliveryDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  {s.notes && (
                                    <div style={{ marginTop:8,paddingTop:8,borderTop:`1px solid ${T.border}`,fontFamily:jost,fontSize:10,fontWeight:300,color:T.muted,fontStyle:'italic' }}>
                                      {s.notes}
                                    </div>
                                  )}
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

        {/* ══ SELECTED TAB ══ */}
        {tab === 'selected' && (() => {
          const allItems      = portal.type==='product'?(portal.productItems||[]):(portal.offsiteItems||[]);
          const shortlistedIds = new Set(portal.shortlistedIds||[]);
          const sel           = allItems.filter(i=>shortlistedIds.has(String(i._id)));
          return (
            <div style={{ padding:'14px 14px',display:'flex',flexDirection:'column',gap:12 }}>
              <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between' }}>
                <p style={{ fontFamily:jost,fontSize:9,fontWeight:400,letterSpacing:'0.25em',textTransform:'uppercase',color:T.muted,margin:0 }}>
                  Client's shortlist · {sel.length} item{sel.length!==1?'s':''}
                </p>
                {portal.lastViewedAt && (
                  <p style={{ fontFamily:jost,fontSize:10,fontWeight:300,color:T.muted,margin:0 }}>
                    Last viewed {new Date(portal.lastViewedAt).toLocaleDateString('en-IN')}
                  </p>
                )}
              </div>

              {sel.length === 0 ? (
                <div style={{ textAlign:'center',padding:'48px 0' }}>
                  <div style={{ fontSize:26,marginBottom:10 }}>🤍</div>
                  <p style={{ fontFamily:jost,fontSize:12,fontWeight:300,color:T.muted }}>No items shortlisted yet</p>
                  <p style={{ fontFamily:jost,fontSize:11,fontWeight:300,color:'rgba(0,0,0,0.25)',marginTop:4 }}>The client hasn't ♡'d any items yet.</p>
                </div>
              ) : (
                <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
                  {sel.map(item => (
                    <div key={item._id} style={{
                      display:'flex',gap:12,alignItems:'center',padding:10,
                      background:T.dimBg, border:`1px solid ${T.borderG}`,
                    }}>
                      <div style={{ width:38,height:38,overflow:'hidden',flexShrink:0,background:'rgba(0,0,0,0.06)' }}>
                        {item.imageUrl
                          ? <img src={item.imageUrl} alt={item.name} style={{ width:'100%',height:'100%',objectFit:'cover' }} />
                          : <div style={{ width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center' }}>
                              {portal.type==='product'?<Package size={12} style={{ color:T.muted }} />:<MapPin size={12} style={{ color:T.muted }} />}
                            </div>
                        }
                      </div>
                      <div style={{ flex:1,minWidth:0 }}>
                        <div style={{ fontFamily:jost,fontSize:12,fontWeight:400,color:T.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{item.name}</div>
                        <div style={{ fontFamily:jost,fontSize:10,fontWeight:300,color:T.muted,marginTop:2 }}>
                          {portal.type==='product'
                            ? `₹${Number(item.price||0).toLocaleString('en-IN')}${item.category?` · ${item.category}`:''}`
                            : `${item.location||''}${item.doublePrice>0?` · ₹${Number(item.doublePrice).toLocaleString('en-IN')}/double`:''}`
                          }
                        </div>
                      </div>
                      <span style={{ color:T.gold,flexShrink:0,fontSize:14 }}>♥</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Analytics strip */}
              <div style={{ paddingTop:12,borderTop:`1px solid ${T.border}`,display:'flex',alignItems:'center',gap:16,flexWrap:'wrap' }}>
                <div style={{ fontFamily:jost,fontSize:10,fontWeight:300,color:T.muted }}>
                  <span style={{ fontWeight:400 }}>Views:</span> {portal.viewCount||0}
                </div>
                <div style={{ fontFamily:jost,fontSize:10,fontWeight:300,color:T.muted }}>
                  <span style={{ fontWeight:400 }}>Last seen:</span>{' '}
                  {portal.lastViewedAt?new Date(portal.lastViewedAt).toLocaleDateString('en-IN'):'Never'}
                </div>
                <a href={portalUrl} target="_blank" rel="noreferrer"
                  style={{ marginLeft:'auto',display:'flex',alignItems:'center',gap:5,fontFamily:jost,fontSize:9,fontWeight:400,letterSpacing:'0.15em',textTransform:'uppercase',color:T.gold,textDecoration:'none',transition:'color 0.2s' }}
                  onMouseEnter={e=>e.currentTarget.style.color=T.gold2}
                  onMouseLeave={e=>e.currentTarget.style.color=T.gold}
                >
                  <ExternalLink size={10} /> Open link
                </a>
              </div>
            </div>
          );
        })()}

      </div>

      {/* ── Hidden file input (MUST stay direct child of root) ──────────────── */}
      <input
        ref={chatFileRef}
        type="file"
        multiple
        style={{ position:'absolute',top:-200,left:-200,width:1,height:1,opacity:0 }}
        onChange={e => {
          const picked = Array.from(e.target.files||[]);
          if (picked.length>0) setChatFiles(prev=>[...prev,...picked].slice(0,5));
          e.target.value='';
        }}
      />

    </div>
  );
};

export default ClientPortalEditor;