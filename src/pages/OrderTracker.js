/**
 * src/pages/OrderTracker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Order Management — full lifecycle tracker.
 *
 * Tabs:   Inquiries  →  Ongoing  →  Completed (grouped by FY / Month)
 * Popups: order details + screenshots/files + procurement (orders/OrderDetailModal),
 *         Start Project with optional quote upload (orders/StartProjectModal),
 *         timeline, linked shipments, portal chat.
 * Portals: auto-created server-side on inquiry save; the client portal e-mail
 *          is dispatched after a client/contact lookup (create | add-contact).
 * Notifications: browser push via portalNotifications; unread badge polling
 *                every 15 s while the tab is visible.
 *
 * Data flow: one GET /v2/orders on load (portal slug and shipment counts are
 * joined in server-side). Every mutation returns the updated order, which is
 * merged into local state — the full list is never re-fetched after a save.
 * All order calls go through orders/ordersApi.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';
import {
  ArrowRight, Calendar, CheckCircle, ChevronDown, ChevronRight, ClipboardList, Clock, Copy, FolderOpen,
  Hash, History, ImagePlus, Link2, MapPin, Package, Paperclip, Plus, Receipt, Search, Send, Settings,
  Trash2, Truck, UserPlus, X,
} from 'lucide-react';
import api from '../api';
import ClientPortalEditor from './ClientPortalEditor';
import OrderTimeline from './OrderTimeline';
import MessageTemplateManager from './MessageTemplateManager';
import { initNotifications, requestNotifPermission, pushNotif } from '../utils/portalNotifications';
import { createLogger } from '../utils/logger';
import { usePopup } from '../components/AppPopups';
import ordersApi from './orders/ordersApi';
import OrderDetailModal from './orders/OrderDetailModal';
import StartProjectModal from './orders/StartProjectModal';
import LinkedShipmentsPanel from './orders/LinkedShipmentsPanel';
import { ClientCreateInlineForm, ContactAddInlineForm } from './orders/ClientContactForms';
import { FileChip, FileLightbox, usePastedImages } from './orders/OrderFiles';
import {
  T, jost, serif, GoldRule, FieldLabel, FocusInput, GoldBtn, GhostBtn, IconBtn, Modal, Spinner,
} from './orders/ui';

const log = createLogger('OrderTracker');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const CC_EMAIL             = 'info@marqland.com';
const UNREAD_POLL_INTERVAL = 15_000; // ms
const ROW_FILE_CHIPS       = 3;      // files shown inline in a row before "+N"

// Portal links sent to clients always point to the public website, not to
// whatever domain this admin panel runs on. Matches CLIENT_URL in the backend.
// (CRA exposes REACT_APP_* via process.env — import.meta.env doesn't exist here.)
const CLIENT_BASE_URL = process.env.REACT_APP_CLIENT_URL?.replace(/\/$/, '') || 'https://www.marqlandstudios.com';
const portalUrlFor = (slug) => (slug ? `${CLIENT_BASE_URL}/p/${slug}` : null);

const EMPTY_FORM = { title: '', clientName: '', orderPlacedBy: '', orderType: 'product' };

const TABS = [
  { id: 'inquiry',   label: 'Inquiries',        icon: Clock },
  { id: 'ongoing',   label: 'Ongoing',          icon: ArrowRight },
  { id: 'completed', label: 'Completed Orders', icon: Calendar },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the Indian FY string, e.g. "24-25" */
const getFinancialYear = (dateStr) => {
  const date = new Date(dateStr);
  const fyStart = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`;
};

const getMonthName = (dateStr) => new Date(dateStr).toLocaleString('default', { month: 'long' });

/** localStorage helpers for unread-message tracking */
const getSeenCount = (orderId) => {
  try { return parseInt(localStorage.getItem(`seen_${orderId}`) || '0', 10); } catch { return 0; }
};
const setSeenCount = (orderId, n) => {
  try { localStorage.setItem(`seen_${orderId}`, String(n)); } catch { /* storage unavailable */ }
};

/** Text-only preview of a description (notes may carry basic formatting). */
const plainText = (html) => (html || '').replace(/<\/?(br|div|p)\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

const matchesFilters = (order, { term, client, contact }) => {
  if (client && order.clientName !== client) return false;
  if (contact && order.orderPlacedBy !== contact) return false;
  if (!term) return true;
  return [order.clientName, order.title, order.refNumber, order.quoteNumber, order.invoiceNumber, order.orderPlacedBy, plainText(order.description)]
    .join(' ').toLowerCase().includes(term);
};

const selectStyle = {
  padding: '10px 14px', background: 'white', border: `1px solid ${T.border}`, borderRadius: 3,
  fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.text, outline: 'none', cursor: 'pointer',
};

// ─────────────────────────────────────────────────────────────────────────────
// FilterSelect — searchable dropdown with a search icon, for the toolbar's
// client / contact filters. `options` is [{ value, count }].
// ─────────────────────────────────────────────────────────────────────────────
const FilterSelect = ({ placeholder, options, value, onChange, width = 230 }) => (
  <div style={{ position: 'relative', width }}>
    <Search size={13} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.muted, zIndex: 1, pointerEvents: 'none' }} />
    <Select
      isClearable
      placeholder={placeholder}
      noOptionsMessage={() => 'No matches in this tab'}
      options={options.map((o) => ({ value: o.value, label: o.value, count: o.count }))}
      value={value ? { value, label: value } : null}
      onChange={(opt) => onChange(opt?.value || '')}
      formatOptionLabel={(opt, { context }) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{opt.label}</span>
          {context === 'menu' && opt.count != null && <span style={{ color: T.muted }}>{opt.count}</span>}
        </div>
      )}
      styles={{
        control: (base, { isFocused }) => ({
          ...base, minHeight: 40, paddingLeft: 26, borderRadius: 3, boxShadow: 'none', background: 'white',
          border: `1px solid ${isFocused ? T.gold : T.border}`, fontFamily: jost, fontSize: 12, '&:hover': { borderColor: T.gold },
        }),
        placeholder: (base) => ({ ...base, color: T.text, fontWeight: 300 }),
        menu: (base) => ({ ...base, zIndex: 20 }),
        option: (base, { isFocused, isSelected }) => ({
          ...base, fontFamily: jost, fontSize: 12, color: T.text,
          background: isSelected ? 'rgba(184,151,90,0.14)' : isFocused ? T.dimBg : 'white',
        }),
      }}
    />
  </div>
);

/** [{ value, count }] of the distinct non-empty values of `key`, alphabetical. */
const countBy = (orders, key) => {
  const counts = new Map();
  orders.forEach((o) => { const v = (o[key] || '').trim(); if (v) counts.set(v, (counts.get(v) || 0) + 1); });
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value));
};

// ─────────────────────────────────────────────────────────────────────────────
// CustomCreatableSelect — defined at module level so it isn't re-created (and
// its menu/focus state reset) on every render of the tracker.
// ─────────────────────────────────────────────────────────────────────────────
const CustomCreatableSelect = ({ label, options, value, onChange, onDelete, isDisabled }) => (
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    <FieldLabel>{label}</FieldLabel>
    <CreatableSelect
      isClearable
      isDisabled={isDisabled}
      options={options}
      value={value}
      onChange={onChange}
      formatOptionLabel={(option, { context }) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{option.label}</span>
          {context === 'menu' && onDelete && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(option.value); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, padding: 2 }}
              title="Hide from this list"
            >
              <X size={11} />
            </button>
          )}
        </div>
      )}
      styles={{
        control: (base) => ({
          ...base, border: `1px solid ${T.border}`, borderRadius: 3, padding: '2px 4px', background: 'white',
          fontSize: 13, fontFamily: jost, boxShadow: 'none', '&:hover': { borderColor: T.gold },
        }),
        option: (base, { isFocused }) => ({ ...base, fontFamily: jost, fontSize: 12, background: isFocused ? T.dimBg : 'white', color: T.text }),
      }}
    />
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// OrderRow
// ─────────────────────────────────────────────────────────────────────────────
const IdBadge = ({ color, icon: Icon, children }) => (
  <span style={{
    fontFamily: jost, fontSize: 9, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase',
    background: color, color: 'white', padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: 4,
  }}>
    {Icon && <Icon size={9} />} {children}
  </span>
);

const OrderRow = React.memo(({ order, busy, unread, linkSent, justCopied, handlers }) => {
  const { procurement = {}, attachments = [] } = order;
  const hasUnread = unread > 0;
  const cellStyle = { padding: '16px 20px', borderBottom: `1px solid ${T.border}` };

  return (
    <tr
      onClick={() => handlers.open(order)}
      style={{ transition: 'background 0.2s', cursor: 'pointer' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.015)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {/* Identifiers */}
      <td style={cellStyle}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          {order.refNumber && <IdBadge color={T.gold}>{order.refNumber}</IdBadge>}
          {order.quoteNumber && <><ChevronRight size={10} style={{ color: T.muted }} /><IdBadge color={T.indigo} icon={Hash}>{order.quoteNumber}</IdBadge></>}
          {order.invoiceNumber && <><ChevronRight size={10} style={{ color: T.muted }} /><IdBadge color={T.emerald} icon={Receipt}>{order.invoiceNumber}</IdBadge></>}
          {!order.refNumber && !order.quoteNumber && !order.invoiceNumber && (
            <span style={{ fontFamily: jost, fontSize: 9, color: T.muted, background: T.offwhite, border: `1px solid ${T.border}`, padding: '4px 10px' }}>
              #{order._id.slice(-6)}
            </span>
          )}
        </div>
      </td>

      {/* Project */}
      <td style={cellStyle}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{
            marginTop: 2, padding: 6, flexShrink: 0,
            background: order.orderType === 'offsite' ? 'rgba(249,115,22,0.08)' : 'rgba(79,70,229,0.08)',
            color: order.orderType === 'offsite' ? '#f97316' : T.indigo,
          }}>
            {order.orderType === 'offsite' ? <MapPin size={12} /> : <Package size={12} />}
          </div>
          <div>
            <p style={{ fontFamily: jost, fontSize: 13, fontWeight: 500, color: T.text, margin: '0 0 3px' }}>{order.title}</p>
            <p style={{ fontFamily: jost, fontSize: 13, color: T.muted, margin: '0 0 1px' }}>{order.clientName}</p>
            <p style={{ fontFamily: jost, fontSize: 13, fontWeight: 300, color: T.muted, margin: 0 }}>Attn: {order.orderPlacedBy || 'N/A'}</p>
          </div>
        </div>
      </td>

      {/* Description + procurement progress */}
      <td style={{ ...cellStyle, maxWidth: 280 }}>
        <div style={{
          fontFamily: jost, fontSize: 14, fontWeight: 300, color: T.muted, fontStyle: 'italic',
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {plainText(order.description) || '—'}
        </div>
        {procurement.total > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handlers.open(order, 'procurement'); }}
            title="Open procurement tracking"
            style={{
              marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', cursor: 'pointer',
              border: `1px solid ${procurement.ready === procurement.total ? 'rgba(5,150,105,0.3)' : T.borderG}`,
              background: procurement.ready === procurement.total ? '#ecfdf5' : T.dimBg,
              color: procurement.ready === procurement.total ? T.emerald : T.gold,
              fontFamily: jost, fontSize: 10, fontStyle: 'normal',
            }}
          >
            <ClipboardList size={11} /> {procurement.ready}/{procurement.total} ready
          </button>
        )}
      </td>

      {/* Files — names only; previews download on demand, not on list load */}
      <td style={cellStyle} onClick={(e) => e.stopPropagation()}>
        {attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {attachments.slice(0, ROW_FILE_CHIPS).map((file, idx) => (
              <FileChip key={file.itemId || `${file.name}-${idx}`} file={file} onOpen={file.itemId ? (f) => handlers.openFile(order, f) : () => handlers.open(order)} />
            ))}
            {attachments.length > ROW_FILE_CHIPS && (
              <button type="button" onClick={() => handlers.open(order)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: jost, fontSize: 10, color: T.muted }}>
                +{attachments.length - ROW_FILE_CHIPS} more
              </button>
            )}
          </div>
        )}
      </td>

      {/* Actions */}
      <td style={{ ...cellStyle, textAlign: 'right' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
          <IconBtn title={order.timelineCount ? `Timeline (${order.timelineCount})` : 'Timeline'} onClick={() => handlers.openTimeline(order)}>
            <History size={15} />
          </IconBtn>

          {order.shipmentCount > 0 && (
            <IconBtn title={`Linked shipments (${order.shipmentCount})`} onClick={() => handlers.openShipments(order)}>
              <Truck size={15} />
            </IconBtn>
          )}

          {order.status === 'inquiry' && (
            <button
              type="button"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); handlers.startProject(order); }}
              style={{
                fontFamily: jost, fontSize: 9, fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase',
                padding: '6px 14px', background: busy ? T.offwhite : 'rgba(184,151,90,0.1)',
                border: `1px solid ${busy ? T.border : T.borderG}`, color: busy ? T.muted : T.gold,
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? '…' : 'Start Project'}
            </button>
          )}

          {order.status === 'ongoing' && (
            <IconBtn title="Mark complete" onClick={() => handlers.complete(order)} disabled={busy} color={T.emerald} hover={T.emerald}>
              <CheckCircle size={17} />
            </IconBtn>
          )}

          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handlers.openChat(order); }}
            title={hasUnread ? `${unread} new client message${unread !== 1 ? 's' : ''}` : 'Open portal chat'}
            style={{
              position: 'relative', background: 'none', border: 'none', cursor: 'pointer', padding: 6, display: 'flex',
              color: hasUnread ? '#7c3aed' : T.muted,
            }}
          >
            <Link2 size={15} />
            {hasUnread && (
              <span style={{
                position: 'absolute', top: -2, right: -2, minWidth: 15, height: 15, background: '#ef4444', color: 'white',
                fontSize: 8, fontFamily: jost, fontWeight: 700, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
              }}>
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          <IconBtn
            title={!order.portalSlug ? 'No client portal for this order' : 'Copy & open client portal link'}
            onClick={() => handlers.copyLink(order)}
            disabled={!order.portalSlug}
            color={justCopied ? T.emerald : linkSent ? '#c4b5fd' : T.muted}
          >
            {justCopied ? <CheckCircle size={15} /> : linkSent ? <Copy size={15} /> : <Send size={15} />}
          </IconBtn>

          {order.status !== 'completed' && (
            <IconBtn title="Delete order" onClick={() => handlers.remove(order)} disabled={busy} color="rgba(220,38,38,0.5)" hover="#dc2626">
              <Trash2 size={17} />
            </IconBtn>
          )}
        </div>
      </td>
    </tr>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT — OrderTracker
// ─────────────────────────────────────────────────────────────────────────────
export default function OrderTracker() {
  const { showToast, confirm, Toast, ConfirmDialog } = usePopup();

  // ── State ─────────────────────────────────────────────────────────────────
  const [orders,           setOrders]           = useState([]);
  const [fetchLoading,     setFetchLoading]     = useState(true);
  const [fetchError,       setFetchError]       = useState(null);
  const [statuses,         setStatuses]         = useState([]);   // procurement stages
  const [busyIds,          setBusyIds]          = useState({});   // orderId -> true while a row action runs
  const [activeTab,        setActiveTab]        = useState('inquiry');
  const [expandedFolders,  setExpandedFolders]  = useState({});
  const [searchTerm,       setSearchTerm]       = useState('');
  const [selectedClient,   setSelectedClient]   = useState('');
  const [selectedContact,  setSelectedContact]  = useState('');
  const [searchFocused,    setSearchFocused]    = useState(false);
  const [sentLinks,        setSentLinks]        = useState({});
  const [copiedId,         setCopiedId]         = useState(null);
  const [unreadCounts,     setUnreadCounts]     = useState({});
  const [meta,             setMeta]             = useState({ clients: [], clientContacts: {} });

  // Popups — each holds the order it is open for (ids for the detail popup,
  // so it always reads the latest row from `orders`).
  const [detail,           setDetail]           = useState(null); // { id, tab }
  const [startOrder,       setStartOrder]       = useState(null);
  const [completeOrder,    setCompleteOrder]    = useState(null);
  const [invoiceNumber,    setInvoiceNumber]    = useState('');
  const [timelineOrder,    setTimelineOrder]    = useState(null);
  const [shipmentsOrder,   setShipmentsOrder]   = useState(null);
  const [chatOrder,        setChatOrder]        = useState(null);
  const [lightbox,         setLightbox]         = useState(null); // { orderId, file }
  const [templateMgrOpen,  setTemplateMgrOpen]  = useState(false);
  const [clientCheckModal, setClientCheckModal] = useState(null);

  // New inquiry form — files are staged locally and uploaded once the order exists.
  const [isModalOpen,      setIsModalOpen]      = useState(false);
  const [creating,         setCreating]         = useState(false);
  const [formData,         setFormData]         = useState(EMPTY_FORM);
  const [stagedFiles,      setStagedFiles]      = useState({ screenshot: [], attachment: [] });
  const createEditorRef = useRef(null);

  const prevClientCounts = useRef({});
  const ordersRef = useRef(orders);
  useEffect(() => { ordersRef.current = orders; }, [orders]);

  // ── Local state helpers ────────────────────────────────────────────────────
  const patchOrder = useCallback((id, patch) => {
    setOrders((prev) => prev.map((o) => (o._id === id ? { ...o, ...patch } : o)));
  }, []);
  const setBusy = (id, on) => setBusyIds((prev) => {
    const { [id]: _, ...rest } = prev;
    return on ? { ...rest, [id]: true } : rest;
  });

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    setFetchLoading(true);
    setFetchError(null);
    try {
      const list = await ordersApi.list();
      log.info('Orders loaded', { count: list.length });
      setOrders(list);
    } catch (err) {
      log.error('Failed to fetch orders', err.message);
      setFetchError(err.message);
    } finally {
      setFetchLoading(false);
    }
  }, []);

  const fetchClients = useCallback(async () => {
    try {
      const res = await api.get('/clients');
      const data = Array.isArray(res.data) ? res.data : [];
      const clientContacts = {};
      data.forEach((c) => {
        clientContacts[c.companyName] = (c.contacts || []).map((ct) => ct.name).filter(Boolean).sort();
      });
      setMeta({ clients: data.map((c) => c.companyName).sort(), clientContacts });
    } catch (err) {
      log.warn('Could not load clients from API', err.message);
    }
  }, []);

  const pollUnreadMessages = useCallback(async () => {
    try {
      const { data: counts = {} } = await api.get('/portal/unread-counts');
      const badges = {};
      Object.entries(counts).forEach(([orderId, data]) => {
        const total = data.clientCount || 0;
        badges[orderId] = Math.max(0, total - getSeenCount(orderId));

        const prev = prevClientCounts.current[orderId] || 0;
        if (total > prev && prev > 0) {
          const order = ordersRef.current.find((o) => o._id === orderId);
          pushNotif(`${order?.clientName || 'A client'} sent a message`, data.lastClientMessage || 'New message in portal', '/orders', `portal-client-${orderId}`);
        }
        prevClientCounts.current[orderId] = total;
      });
      setUnreadCounts(badges);
    } catch (err) {
      log.warn('Unread poll failed', err.message);
    }
  }, []);

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    initNotifications();
    fetchOrders();
    fetchClients();
    ordersApi.meta().then((m) => setStatuses(m.procurementStatuses)).catch((err) => log.warn('Meta load failed', err.message));
  }, [fetchOrders, fetchClients]);

  // Unread polling runs only while the tab is visible — no background traffic
  // from a forgotten tab — and catches up immediately when it's shown again.
  useEffect(() => {
    let timer = null;
    const start = () => { if (!timer) { pollUnreadMessages(); timer = setInterval(pollUnreadMessages, UNREAD_POLL_INTERVAL); } };
    const stop = () => { clearInterval(timer); timer = null; };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [pollUnreadMessages]);

  // ── Derived data ───────────────────────────────────────────────────────────
  const filters = useMemo(() => ({ term: searchTerm.trim().toLowerCase(), client: selectedClient, contact: selectedContact }), [searchTerm, selectedClient, selectedContact]);

  const tabCounts = useMemo(() => orders.reduce((acc, o) => ({ ...acc, [o.status]: (acc[o.status] || 0) + 1 }), {}), [orders]);

  const filteredOrders = useMemo(
    () => orders.filter((o) => o.status === activeTab && matchesFilters(o, filters)),
    [orders, activeTab, filters],
  );

  const groupedCompleted = useMemo(() => {
    const hierarchy = {};
    orders.filter((o) => o.status === 'completed' && matchesFilters(o, filters)).forEach((order) => {
      const date = order.completedAt || order.updatedAt || new Date().toISOString();
      const fy = getFinancialYear(date);
      const month = getMonthName(date);
      ((hierarchy[fy] ||= {})[month] ||= []).push(order);
    });
    return hierarchy;
  }, [orders, filters]);

  // Filter dropdowns list only the clients / contacts that have orders in the
  // current tab (Inquiries, Ongoing or Completed); contacts narrow to the
  // selected client. Counts are shown next to each name.
  const tabOrders = useMemo(() => orders.filter((o) => o.status === activeTab), [orders, activeTab]);
  const clientOptions = useMemo(() => countBy(tabOrders, 'clientName'), [tabOrders]);
  const contactOptions = useMemo(
    () => countBy(selectedClient ? tabOrders.filter((o) => o.clientName === selectedClient) : tabOrders, 'orderPlacedBy'),
    [tabOrders, selectedClient],
  );

  // Switching tab drops a client/contact filter that has no orders there.
  useEffect(() => {
    if (selectedClient && !clientOptions.some((o) => o.value === selectedClient)) setSelectedClient('');
  }, [clientOptions, selectedClient]);
  useEffect(() => {
    if (selectedContact && !contactOptions.some((o) => o.value === selectedContact)) setSelectedContact('');
  }, [contactOptions, selectedContact]);

  const detailOrder = detail ? orders.find((o) => o._id === detail.id) : null;
  const onDetailChange = useCallback((patch) => { if (detail?.id) patchOrder(detail.id, patch); }, [detail?.id, patchOrder]);

  // ── Portal e-mail after create ─────────────────────────────────────────────
  const sendPortalEmail = ({ slug, clientEmail, contactName, clientName, orderRef, title }) =>
    api.post('/portal/send-email', { slug, clientEmail, contactName, clientName, orderRef, title, cc: CC_EMAIL });

  const offerPortalEmail = async (order) => {
    const base = { orderRef: order.refNumber, title: order.title, portalSlug: order.portalSlug };
    const contactName = order.orderPlacedBy?.trim() || '';
    if (!order.portalSlug) return;
    try {
      const { data } = await api.get('/clients/lookup', { params: { name: order.clientName } });
      if (!data.found || !data.client) {
        setClientCheckModal({ ...base, mode: 'create', clientName: order.clientName, contactName });
        return;
      }
      const contact = data.client.contacts?.find((ct) => ct.name?.toLowerCase() === contactName.toLowerCase());
      if (!contact?.email) {
        setClientCheckModal({ ...base, mode: 'add-contact', clientId: data.client._id, companyName: data.client.companyName, contactName });
        return;
      }
      await sendPortalEmail({
        slug: order.portalSlug, clientEmail: contact.email, contactName: contact.name,
        clientName: data.client.companyName, orderRef: order.refNumber, title: order.title,
      });
      setSentLinks((prev) => ({ ...prev, [order._id]: true }));
      showToast('success', `Portal link sent to ${contact.email}`);
    } catch (err) {
      log.warn('Client lookup / portal e-mail failed', err.message);
      showToast('warning', 'Inquiry saved, but the portal e-mail could not be sent.');
    }
  };

  // ── Create ─────────────────────────────────────────────────────────────────
  const stageFiles = (category, files) => setStagedFiles((prev) => ({ ...prev, [category]: [...prev[category], ...files] }));
  const unstageFile = (category, idx) => setStagedFiles((prev) => ({ ...prev, [category]: prev[category].filter((_, i) => i !== idx) }));
  usePastedImages((images) => stageFiles('screenshot', images), isModalOpen && !creating);

  const closeCreate = () => {
    setIsModalOpen(false);
    setFormData(EMPTY_FORM);
    setStagedFiles({ screenshot: [], attachment: [] });
  };

  const saveOrder = async (e) => {
    e.preventDefault();
    if (!formData.clientName || !formData.orderPlacedBy) { showToast('error', 'Pick a client and a contact person.'); return; }
    setCreating(true);
    try {
      const order = await ordersApi.create({ ...formData, description: createEditorRef.current?.innerHTML || '' });
      setOrders((prev) => [order, ...prev]);
      setActiveTab('inquiry');
      const staged = stagedFiles;
      closeCreate();
      showToast('success', `Inquiry ${order.refNumber} created`);
      log.info('Inquiry created', { ref: order.refNumber });

      // Files go straight into the new order's OneDrive folder.
      const uploads = Object.entries(staged).filter(([, files]) => files.length);
      if (uploads.length) {
        setBusy(order._id, true);
        Promise.allSettled(uploads.map(([category, files]) => ordersApi.uploadFiles(order._id, files, category)))
          .then((results) => {
            const saved = results.flatMap((r) => (r.status === 'fulfilled' ? r.value.files : []));
            if (saved.length) setOrders((prev) => prev.map((o) => (o._id === order._id ? { ...o, attachments: [...(o.attachments || []), ...saved] } : o)));
            const failed = results.filter((r) => r.status === 'rejected');
            if (failed.length) showToast('error', `Some files didn't upload: ${failed[0].reason.message}. Open the order to retry.`);
          })
          .finally(() => setBusy(order._id, false));
      }
      offerPortalEmail(order);
    } catch (err) {
      log.error('Save order failed', err.message);
      showToast('error', err.message);
    } finally {
      setCreating(false);
    }
  };

  // ── Row actions ────────────────────────────────────────────────────────────
  const submitComplete = async () => {
    const value = invoiceNumber.trim();
    if (!value || !completeOrder) return;
    const order = completeOrder;
    setCompleteOrder(null);
    setBusy(order._id, true);
    try {
      const updated = await ordersApi.complete(order._id, value);
      patchOrder(order._id, updated);
      showToast('success', `${order.title || order.refNumber} marked complete`);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setBusy(order._id, false);
    }
  };

  const deleteOrder = async (order) => {
    const ok = await confirm({
      title: 'Delete Order', message: `"${order.title || order.refNumber}" and its portal will be permanently removed.`,
      confirmLabel: 'Delete', variant: 'danger',
    });
    if (!ok) return;
    setBusy(order._id, true);
    try {
      await ordersApi.remove(order._id); // the server also removes the portal and the OneDrive folder
      setOrders((prev) => prev.filter((o) => o._id !== order._id));
      showToast('success', `"${order.title || order.refNumber}" deleted`);
    } catch (err) {
      log.error('Delete order failed', err.message);
      showToast('error', err.message);
      setBusy(order._id, false);
    }
  };

  const openTimeline = async (order) => {
    setTimelineOrder({ ...order, timeline: null });
    try {
      const full = await ordersApi.get(order._id);
      setTimelineOrder((cur) => (cur?._id === order._id ? full : cur));
    } catch (err) {
      showToast('error', err.message);
      setTimelineOrder(null);
    }
  };

  const openChat = async (order) => {
    await requestNotifPermission();
    const total = (unreadCounts[order._id] || 0) + getSeenCount(order._id);
    setSeenCount(order._id, total);
    setUnreadCounts((prev) => ({ ...prev, [order._id]: 0 }));
    setChatOrder(order);
  };

  /**
   * Copies the client portal link AND opens it in a new tab. The clipboard
   * write is started before window.open (while this page still has focus —
   * browsers refuse clipboard writes from a background tab), and window.open
   * runs synchronously inside the click so it isn't treated as a popup.
   */
  const copyLink = (order) => {
    const url = portalUrlFor(order.portalSlug);
    if (!url) return;
    const copied = navigator.clipboard?.writeText(url) ?? Promise.reject(new Error('Clipboard unavailable'));
    window.open(url, '_blank', 'noopener,noreferrer');
    setSentLinks((prev) => ({ ...prev, [order._id]: true }));
    copied
      .then(() => {
        setCopiedId(order._id);
        setTimeout(() => setCopiedId((id) => (id === order._id ? null : id)), 2000);
        showToast('success', 'Client link copied and opened in a new tab');
      })
      .catch(() => showToast('warning', 'Opened the client link — copying to the clipboard was blocked by the browser.'));
  };

  // Stable handler bag so memoised rows don't re-render on unrelated state changes.
  const handlersRef = useRef({});
  handlersRef.current = {
    open: (order, tab = 'details') => setDetail({ id: order._id, tab }),
    openFile: (order, file) => setLightbox({ orderId: order._id, file }),
    openTimeline,
    openShipments: setShipmentsOrder,
    startProject: setStartOrder,
    complete: (order) => { setInvoiceNumber(''); setCompleteOrder(order); },
    openChat,
    copyLink,
    remove: deleteOrder,
  };
  const handlers = useMemo(() => new Proxy({}, { get: (_, key) => (...args) => handlersRef.current[key](...args) }), []);

  const renderRow = (order) => (
    <OrderRow
      key={order._id}
      order={order}
      busy={Boolean(busyIds[order._id])}
      unread={unreadCounts[order._id] || 0}
      linkSent={Boolean(sentLinks[order._id])}
      justCopied={copiedId === order._id}
      handlers={handlers}
    />
  );

  const thStyle = {
    padding: '12px 20px', textAlign: 'left', fontFamily: jost, fontSize: 9, fontWeight: 400,
    letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted,
    borderBottom: `1px solid ${T.border}`, background: T.offwhite,
  };

  const hideMetaItem = (type, value, parentClient) => setMeta((prev) => (type === 'clients'
    ? { ...prev, clients: prev.clients.filter((c) => c !== value) }
    : { ...prev, clientContacts: { ...prev.clientContacts, [parentClient]: (prev.clientContacts[parentClient] || []).filter((c) => c !== value) } }));

  const emptyMessage = (what) => (
    <p style={{ textAlign: 'center', padding: '64px 0', margin: 0, fontFamily: jost, fontSize: 12, fontWeight: 300, letterSpacing: '0.1em', color: T.muted }}>
      {what}{searchTerm ? ` for "${searchTerm}"` : ''}
    </p>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: T.offwhite, fontFamily: jost, padding: '56px 48px' }}>
      <Toast />
      <ConfirmDialog />

      {/* ── Page header ── */}
      <div style={{ marginBottom: 40 }}>
        <GoldRule />
        <p style={{ fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: T.muted, marginBottom: 10 }}>Operations</p>
        <h1 style={{ fontFamily: serif, fontSize: 40, fontWeight: 300, color: T.navy, lineHeight: 1.05, margin: '0 0 24px' }}>
          Order <em style={{ color: T.gold }}>Management.</em>
        </h1>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 420 }}>
            <Search size={13} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: T.muted, pointerEvents: 'none' }} />
            <input
              type="text"
              placeholder="Search orders, clients, references…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              style={{
                width: '100%', padding: '10px 36px', background: 'white', border: `1px solid ${searchFocused ? T.gold : T.border}`,
                borderRadius: 3, fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.text, outline: 'none', boxSizing: 'border-box',
              }}
            />
            {searchTerm && (
              <button type="button" aria-label="Clear search" onClick={() => setSearchTerm('')}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: T.muted, display: 'flex', padding: 0 }}>
                <X size={13} />
              </button>
            )}
          </div>

          <FilterSelect
            placeholder="All Clients"
            options={clientOptions}
            value={selectedClient}
            onChange={(v) => { setSelectedClient(v); setSelectedContact(''); }}
          />

          <FilterSelect
            placeholder="All Contacts"
            options={contactOptions}
            value={selectedContact}
            onChange={setSelectedContact}
          />

          <button
            type="button"
            onClick={() => setTemplateMgrOpen(true)}
            title="Manage timeline statement templates"
            style={{ ...selectStyle, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 400 }}
          >
            <Settings size={13} /> Statements
          </button>

          {(searchTerm || selectedClient || selectedContact) && (
            <IconBtn title="Reset filters" onClick={() => { setSearchTerm(''); setSelectedClient(''); setSelectedContact(''); }}>
              <X size={17} />
            </IconBtn>
          )}

          <GoldBtn onClick={() => setIsModalOpen(true)} style={{ marginLeft: 'auto', flexShrink: 0 }}>+ New Inquiry</GoldBtn>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: `1px solid ${T.border}` }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 22px', background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: jost, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase',
              color: activeTab === tab.id ? T.gold : T.muted,
              borderBottom: activeTab === tab.id ? `2px solid ${T.gold}` : '2px solid transparent', marginBottom: -1,
            }}
          >
            <tab.icon size={13} /> {tab.label}
            {tabCounts[tab.id] ? <span style={{ color: T.muted, letterSpacing: 0 }}>({tabCounts[tab.id]})</span> : null}
          </button>
        ))}
      </div>

      {/* ── Table ── */}
      <div style={{ background: 'white', border: `1px solid ${T.border}`, overflow: 'hidden' }}>
        {fetchLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '80px 0' }}>
            <Spinner size={36} />
            <p style={{ fontFamily: jost, fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: T.muted }}>Fetching Orders…</p>
          </div>
        ) : fetchError ? (
          <div style={{ textAlign: 'center', padding: '64px 0' }}>
            <p style={{ fontFamily: jost, fontSize: 12, color: T.danger, margin: '0 0 16px' }}>Couldn't load orders: {fetchError}</p>
            <GoldBtn onClick={fetchOrders}>Retry</GoldBtn>
          </div>
        ) : activeTab !== 'completed' ? (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Identifiers</th>
                  <th style={thStyle}>Project</th>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Files</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map(renderRow)}
                {filteredOrders.length === 0 && <tr><td colSpan={5}>{emptyMessage('No matches found')}</td></tr>}
              </tbody>
            </table>
            <div style={{ borderTop: `1px solid ${T.border}`, padding: '10px 20px', fontFamily: jost, fontSize: 10, fontWeight: 300, letterSpacing: '0.12em', color: T.muted, textAlign: 'right' }}>
              {filteredOrders.length} of {tabCounts[activeTab] || 0} records
            </div>
          </>
        ) : (
          <div style={{ padding: 24 }}>
            {Object.keys(groupedCompleted).length === 0 && emptyMessage('No completed records found')}
            {Object.entries(groupedCompleted).map(([fy, months]) => (
              <div key={fy} style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  onClick={() => setExpandedFolders((p) => ({ ...p, [fy]: !p[fy] }))}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', background: T.offwhite,
                    border: `1px solid ${T.border}`, cursor: 'pointer', fontFamily: jost, fontSize: 10, fontWeight: 500,
                    letterSpacing: '0.2em', textTransform: 'uppercase', color: T.text, textAlign: 'left',
                  }}
                >
                  <FolderOpen size={15} style={{ color: T.gold }} /> {fy}
                  {expandedFolders[fy] ? <ChevronDown size={14} style={{ marginLeft: 'auto', color: T.muted }} /> : <ChevronRight size={14} style={{ marginLeft: 'auto', color: T.muted }} />}
                </button>
                {expandedFolders[fy] && (
                  <div style={{ marginLeft: 24, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {Object.entries(months).map(([month, items]) => {
                      const key = `${fy}-${month}`;
                      return (
                        <div key={month}>
                          <button
                            type="button"
                            onClick={() => setExpandedFolders((p) => ({ ...p, [key]: !p[key] }))}
                            style={{
                              width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'white',
                              border: `1px solid ${T.border}`, cursor: 'pointer', fontFamily: jost, fontSize: 9,
                              letterSpacing: '0.22em', textTransform: 'uppercase', color: T.muted, textAlign: 'left',
                            }}
                          >
                            <Calendar size={12} /> {month} ({items.length})
                          </button>
                          {expandedFolders[key] && (
                            <div style={{ border: `1px solid ${T.border}`, borderTop: 'none', marginBottom: 8 }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>{items.map(renderRow)}</tbody></table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ══ Order detail popup (details, screenshots & files, procurement) ══ */}
      {detailOrder && (
        <OrderDetailModal
          key={detailOrder._id}
          order={detailOrder}
          initialTab={detail.tab}
          statuses={statuses}
          onClose={() => setDetail(null)}
          onChange={onDetailChange}
          showToast={showToast}
          confirm={confirm}
        />
      )}

      {/* ══ Start Project — quote number + optional quote upload ══ */}
      {startOrder && (
        <StartProjectModal
          order={startOrder}
          onClose={() => setStartOrder(null)}
          onStarted={(updated) => {
            patchOrder(updated._id, updated);
            setStartOrder(null);
          }}
          showToast={showToast}
        />
      )}

      {/* ══ Completion prompt ══ */}
      {completeOrder && (
        <Modal onClose={() => setCompleteOrder(null)} width={400} zIndex={100} padding="40px">
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ width: 44, height: 44, background: 'rgba(5,150,105,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', color: T.emerald }}>
              <Receipt size={22} />
            </div>
            <h3 style={{ fontFamily: serif, fontSize: 26, fontWeight: 300, color: T.navy, margin: '0 0 8px' }}>Completed Order</h3>
            <p style={{ fontFamily: jost, fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: T.muted, margin: 0 }}>
              Enter final invoice number before closing
            </p>
          </div>
          <FocusInput
            autoFocus
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') submitComplete(); }}
            placeholder="e.g. INV-26-27/0094"
            style={{ textAlign: 'center', fontWeight: 500, marginBottom: 20 }}
          />
          <div style={{ display: 'flex', gap: 12 }}>
            <GhostBtn onClick={() => setCompleteOrder(null)} style={{ flex: 1 }}>Cancel</GhostBtn>
            <GoldBtn onClick={submitComplete} disabled={!invoiceNumber.trim()} style={{ flex: 1 }}>Save</GoldBtn>
          </div>
        </Modal>
      )}

      {/* ══ Timeline ══ */}
      {timelineOrder && (
        <Modal fullScreen onClose={() => setTimelineOrder(null)} eyebrow={`Timeline · ${timelineOrder.refNumber || `#${timelineOrder._id.slice(-6)}`}`} title={timelineOrder.title || timelineOrder.clientName}>
          <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 32px' }}>
          {timelineOrder.timeline === null ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40, color: T.muted }}><Spinner size={20} /></div>
          ) : (
            <OrderTimeline
              order={timelineOrder}
              onPosted={(event) => {
                setTimelineOrder((prev) => (prev ? { ...prev, timeline: [...(prev.timeline || []), event] } : prev));
                setOrders((prev) => prev.map((o) => (o._id === timelineOrder._id ? { ...o, timelineCount: (o.timelineCount || 0) + 1 } : o)));
              }}
            />
          )}
          </div>
        </Modal>
      )}

      {/* ══ Linked shipments — full screen, with filters ══ */}
      {shipmentsOrder && (
        <Modal
          fullScreen
          onClose={() => setShipmentsOrder(null)}
          eyebrow={`Linked Shipments · ${shipmentsOrder.refNumber || `#${shipmentsOrder._id.slice(-6)}`}`}
          title={shipmentsOrder.title || shipmentsOrder.clientName}
        >
          <div style={{ padding: '24px 32px' }}>
            <LinkedShipmentsPanel orderId={shipmentsOrder._id} />
          </div>
        </Modal>
      )}

      <MessageTemplateManager isOpen={templateMgrOpen} onClose={() => setTemplateMgrOpen(false)} />

      {/* ══ New inquiry ══ */}
      {isModalOpen && (
        <Modal onClose={closeCreate} busy={creating} width={640} eyebrow="New Registration" title="Create Inquiry">
          {creating ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '60px 0' }}>
              <Spinner size={36} />
              <p style={{ fontFamily: jost, fontSize: 9, letterSpacing: '0.28em', textTransform: 'uppercase', color: T.muted }}>Submitting Inquiry…</p>
            </div>
          ) : (
            <form onSubmit={saveOrder} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <FieldLabel>Project Title</FieldLabel>
                <FocusInput value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} placeholder="Project title" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[{ v: 'product', label: '🎁 Product Gifting' }, { v: 'offsite', label: '🏨 Offsite' }].map(({ v, label }) => (
                  <button
                    type="button"
                    key={v}
                    onClick={() => setFormData({ ...formData, orderType: v })}
                    style={{
                      padding: '12px 0', cursor: 'pointer', fontFamily: jost, fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
                      background: formData.orderType === v ? T.dimBg : 'white',
                      border: `1px solid ${formData.orderType === v ? T.gold : T.border}`,
                      color: formData.orderType === v ? T.gold : T.muted,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <CustomCreatableSelect
                  label="Client Company *"
                  options={meta.clients.map((c) => ({ label: c, value: c }))}
                  value={formData.clientName ? { label: formData.clientName, value: formData.clientName } : null}
                  onChange={(v) => setFormData({ ...formData, clientName: v?.value || '', orderPlacedBy: '' })}
                  onDelete={(val) => hideMetaItem('clients', val)}
                />
                <CustomCreatableSelect
                  label="Contact Person *"
                  isDisabled={!formData.clientName}
                  options={(meta.clientContacts[formData.clientName] || []).map((c) => ({ label: c, value: c }))}
                  value={formData.orderPlacedBy ? { label: formData.orderPlacedBy, value: formData.orderPlacedBy } : null}
                  onChange={(v) => setFormData({ ...formData, orderPlacedBy: v?.value || '' })}
                  onDelete={(val) => hideMetaItem('contacts', val, formData.clientName)}
                />
              </div>

              <div>
                <FieldLabel>Requirements</FieldLabel>
                <div
                  ref={createEditorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onPaste={(e) => { const text = e.clipboardData?.getData('text/plain'); e.preventDefault(); if (text) document.execCommand('insertText', false, text); }}
                  onDrop={(e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); stageFiles(e.dataTransfer.files[0].type.startsWith('image/') ? 'screenshot' : 'attachment', Array.from(e.dataTransfer.files)); } }}
                  data-placeholder="Describe project details… paste screenshots with Ctrl/⌘+V."
                  style={{
                    width: '100%', minHeight: 180, padding: '14px 16px', background: T.offwhite, border: `1px solid ${T.border}`,
                    fontFamily: jost, fontSize: 13, fontWeight: 300, color: T.text, outline: 'none', boxSizing: 'border-box',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = T.gold; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = T.border; }}
                />
              </div>

              {/* Staged files — uploaded into the new order's folder once it's saved */}
              <div style={{ padding: '14px 16px', background: T.offwhite, border: `1px dashed ${T.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {[
                    { category: 'screenshot', label: 'Add Screenshots', icon: ImagePlus, accept: 'image/*' },
                    { category: 'attachment', label: 'Attach Files', icon: Paperclip },
                  ].map(({ category, label, icon: Icon, accept }) => (
                    <label key={category} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', cursor: 'pointer', background: 'white',
                      border: `1px solid ${T.border}`, fontFamily: jost, fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: T.muted,
                    }}>
                      <Icon size={12} /> {label}
                      <input type="file" multiple accept={accept} style={{ display: 'none' }}
                        onChange={(e) => { const files = Array.from(e.target.files || []); e.target.value = ''; stageFiles(category, files); }} />
                    </label>
                  ))}
                </div>
                {['screenshot', 'attachment'].flatMap((category) => stagedFiles[category].map((f, idx) => (
                  <div key={`${category}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: jost, fontSize: 11, color: T.text }}>
                    {category === 'screenshot' ? <ImagePlus size={12} style={{ color: T.gold }} /> : <Paperclip size={12} style={{ color: T.muted }} />}
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name || 'Pasted screenshot'}</span>
                    <IconBtn title="Remove" onClick={() => unstageFile(category, idx)} color={T.danger} hover={T.danger}><X size={12} /></IconBtn>
                  </div>
                )))}
                <p style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted, margin: 0 }}>
                  Screenshots can be pasted anywhere in this form (Ctrl/⌘+V). Files are saved to the inquiry's OneDrive folder.
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: `1px solid ${T.border}`, paddingTop: 20 }}>
                <GoldBtn type="submit" disabled={!formData.clientName || !formData.orderPlacedBy} style={{ padding: '13px 48px' }}>
                  <Plus size={13} /> Submit Inquiry
                </GoldBtn>
              </div>
            </form>
          )}
        </Modal>
      )}

      {/* ══ Client check — client or contact missing an e-mail ══ */}
      {clientCheckModal && (
        <Modal onClose={() => setClientCheckModal(null)} width={520} zIndex={300} padding="0">
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 28px',
            background: 'rgba(184,151,90,0.05)', borderBottom: `1px solid ${T.borderG}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 36, height: 36, background: 'rgba(184,151,90,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.gold }}>
                <UserPlus size={16} />
              </div>
              <div>
                <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 500, color: T.text, margin: '0 0 3px' }}>
                  {clientCheckModal.mode === 'create' ? 'Client Not in Database' : 'New Contact Person'}
                </p>
                <p style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.gold, margin: 0 }}>
                  {clientCheckModal.mode === 'create'
                    ? `"${clientCheckModal.clientName}" has no client record yet.`
                    : `"${clientCheckModal.contactName}" has no e-mail under ${clientCheckModal.companyName}.`}
                </p>
              </div>
            </div>
            <IconBtn title="Close" onClick={() => setClientCheckModal(null)}><X size={18} /></IconBtn>
          </div>

          {clientCheckModal.mode === 'create' ? (
            <ClientCreateInlineForm
              clientName={clientCheckModal.clientName}
              contactName={clientCheckModal.contactName}
              showToast={showToast}
              onCreated={async (newClient) => {
                const ctx = clientCheckModal;
                setClientCheckModal(null);
                fetchClients();
                const emailContact = newClient.contacts?.find((ct) => ct.email?.includes('@'));
                if (!emailContact) { showToast('warning', 'Client created. Add an email address to send the portal link.'); return; }
                try {
                  await sendPortalEmail({
                    slug: ctx.portalSlug, clientEmail: emailContact.email, contactName: emailContact.name || '',
                    clientName: newClient.companyName, orderRef: ctx.orderRef, title: ctx.title,
                  });
                  showToast('success', `Portal link sent to ${emailContact.email}`);
                } catch (err) {
                  showToast('error', `Client created but email failed: ${err.message}`);
                }
              }}
              onSkip={() => setClientCheckModal(null)}
            />
          ) : (
            <ContactAddInlineForm
              clientId={clientCheckModal.clientId}
              companyName={clientCheckModal.companyName}
              contactName={clientCheckModal.contactName}
              showToast={showToast}
              onAdded={async (updatedClient) => {
                const ctx = clientCheckModal;
                setClientCheckModal(null);
                fetchClients();
                const contact = updatedClient.contacts?.find((ct) => ct.name?.toLowerCase() === ctx.contactName?.toLowerCase());
                if (!contact?.email) { showToast('warning', 'Contact added. No email provided — portal link not sent.'); return; }
                try {
                  await sendPortalEmail({
                    slug: ctx.portalSlug, clientEmail: contact.email, contactName: contact.name,
                    clientName: updatedClient.companyName, orderRef: ctx.orderRef, title: ctx.title,
                  });
                  showToast('success', `Contact added & portal link sent to ${contact.email}`);
                } catch (err) {
                  showToast('error', `Contact added but email failed: ${err.message}`);
                }
              }}
              onSkip={() => setClientCheckModal(null)}
            />
          )}
        </Modal>
      )}

      {/* ══ Client portal editor drawer ══ */}
      {chatOrder && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(14,21,32,0.55)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setChatOrder(null); }}
        >
          <div style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 480,
            background: 'white', display: 'flex', flexDirection: 'column', animation: 'slideInRight 0.25s ease',
          }}>
            <ClientPortalEditor order={chatOrder} onClose={() => setChatOrder(null)} />
          </div>
        </div>
      )}

      {lightbox && <FileLightbox orderId={lightbox.orderId} file={lightbox.file} onClose={() => setLightbox(null)} />}

      <style>{`
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(184,151,90,0.25); border-radius: 10px; }
        [contentEditable]:empty:before { content: attr(data-placeholder); color: #aaa; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes shimmer { to { background-position: -200% 0; } }
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: none; } }
      `}</style>
    </div>
  );
}
