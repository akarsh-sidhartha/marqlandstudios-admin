/**
 * src/components/OrderTracker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Order Management — full lifecycle tracker.
 *
 * Tabs:   Inquiries  →  Ongoing  →  Completed (grouped by FY / Month)
 * Portals: auto-created on inquiry save; client portal email dispatched
 *          after client/contact DB lookup (create | add-contact flows).
 * Notifications: browser push via portalNotifications; unread badge polling
 *                every 15 s.
 *
 * Visual language: mirrors ClientList.js — navy/gold/offwhite palette,
 *                  Jost + Cormorant Garamond typography, razor-thin borders.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../api';
import ClientPortalEditor from './ClientPortalEditor';
import { initNotifications, requestNotifPermission, pushNotif } from '../utils/portalNotifications';
import { createLogger } from '../utils/logger';
import CreatableSelect from 'react-select/creatable';
import {
  Plus, ArrowRight, CheckCircle, Clock, FileText, Image as ImageIcon,
  Trash2, ChevronRight, ChevronDown, X, FileSpreadsheet, Download,
  AlertTriangle, FolderOpen, Calendar, Hash, Receipt, Table as TableIcon,
  Search, Loader2, Link2, Copy, Send, Package, MapPin, UserPlus,
} from 'lucide-react';
import { usePopup } from '../components/AppPopups';

// ─────────────────────────────────────────────────────────────────────────────
// Logger
// ─────────────────────────────────────────────────────────────────────────────
const log = createLogger('OrderTracker');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const CC_EMAIL              = 'info@marqland.com';
const UNREAD_POLL_INTERVAL  = 15_000; // ms

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens — mirrors ClientList.js
// ─────────────────────────────────────────────────────────────────────────────
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
  danger:  '#dc2626',
  indigo:  '#4f46e5',
  emerald: '#059669',
};

const jost  = '"Jost", sans-serif';
const serif = '"Cormorant Garamond", Georgia, serif';

// ─────────────────────────────────────────────────────────────────────────────
// Shipment status colour map
// ─────────────────────────────────────────────────────────────────────────────
const SHIPMENT_STATUS_STYLES = {
  'Pending':          { bg: '#f1f5f9', color: '#64748b' },
  'Booked':           { bg: '#eff6ff', color: '#2563eb' },
  'In Transit':       { bg: '#fffbeb', color: '#b45309' },
  'Out for Delivery': { bg: '#fff7ed', color: '#ea580c' },
  'Delivered':        { bg: '#ecfdf5', color: '#059669' },
  'Completed':        { bg: '#ecfdf5', color: '#059669' },
  'Returned':         { bg: '#fef2f2', color: '#ef4444' },
  'Exception':        { bg: '#fef2f2', color: '#ef4444' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared micro-components
// ─────────────────────────────────────────────────────────────────────────────

/** Hairline gold accent used in section headers (mirrors ClientList) */
const GoldRule = () => (
  <div style={{ width: 32, height: 1, background: T.gold, marginBottom: 20 }} />
);

/** Label above a form field */
const FieldLabel = ({ children }) => (
  <p style={{
    fontFamily: jost, fontSize: 9, fontWeight: 400,
    letterSpacing: '0.25em', textTransform: 'uppercase',
    color: T.muted, marginBottom: 6, margin: '0 0 6px',
  }}>
    {children}
  </p>
);

/** Focused-border input — exactly as in ClientList */
const FocusInput = ({ value, onChange, placeholder, readOnly = false, style: extra = {} }) => {
  const [focused, setFocused] = useState(false);
  return (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      readOnly={readOnly}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width: '100%', padding: '10px 14px',
        background: readOnly ? T.offwhite : 'white',
        border: `1px solid ${focused ? T.gold : T.border}`,
        borderRadius: 3,
        fontFamily: jost, fontSize: 13, fontWeight: 300,
        color: T.text, outline: 'none',
        boxSizing: 'border-box',
        transition: 'border-color 0.2s',
        ...extra,
      }}
    />
  );
};

/** Gold CTA button */
const GoldBtn = ({ onClick, disabled, children, style: extra = {} }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      background: disabled ? '#e2e8f0' : T.gold,
      color: disabled ? '#94a3b8' : T.navy,
      border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
      padding: '12px 32px',
      fontFamily: jost, fontSize: 10, fontWeight: 500,
      letterSpacing: '0.22em', textTransform: 'uppercase',
      transition: 'background 0.25s',
      ...extra,
    }}
    onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = T.gold2; }}
    onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = T.gold; }}
  >
    {children}
  </button>
);

/** Ghost / muted text button */
const GhostBtn = ({ onClick, children, style: extra = {} }) => (
  <button
    onClick={onClick}
    style={{
      background: 'none', border: 'none', cursor: 'pointer',
      fontFamily: jost, fontSize: 10, fontWeight: 400,
      letterSpacing: '0.2em', textTransform: 'uppercase',
      color: T.muted, transition: 'color 0.2s',
      padding: '10px 20px',
      ...extra,
    }}
    onMouseEnter={e => e.currentTarget.style.color = T.text}
    onMouseLeave={e => e.currentTarget.style.color = T.muted}
  >
    {children}
  </button>
);

/** Inline spinning loader */
const Spinner = ({ size = 16 }) => (
  <Loader2 size={size} style={{ animation: 'spin 1s linear infinite' }} />
);

// ─────────────────────────────────────────────────────────────────────────────
// ClientCreateInlineForm
// Pre-fills company + contact from the order so the user only needs
// phone + email before saving.
// ─────────────────────────────────────────────────────────────────────────────
function ClientCreateInlineForm({ clientName, contactName, onCreated, onSkip, showToast }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    companyName: clientName || '',
    contacts: [{ name: contactName || '', phone: '', email: '' }],
  });

  const setContact = (field, value) => {
    setForm(prev => ({
      ...prev,
      contacts: [{ ...prev.contacts[0], [field]: value }],
    }));
  };

  const handleSave = async () => {
    if (!form.companyName.trim()) { showToast('error', 'Company name is required'); return; }
    log.info('Creating new client inline', { companyName: form.companyName });
    setSaving(true);
    try {
      const res = await api.post('/clients', form);
      log.info('Client created', { id: res.data._id });
      onCreated(res.data);
    } catch (err) {
      log.error('Client create failed', err.message);
      showToast('error', 'Failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '28px 32px' }}>
      <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted, marginBottom: 20 }}>
        Fill in contact details so we can send the portal link by email.
      </p>

      {/* Company name */}
      <div style={{ marginBottom: 16 }}>
        <FieldLabel>Company Name</FieldLabel>
        <FocusInput
          value={form.companyName}
          onChange={e => setForm(prev => ({ ...prev, companyName: e.target.value }))}
          placeholder="Company name"
        />
      </div>

      {/* Primary contact */}
      <div style={{ marginBottom: 24 }}>
        <FieldLabel>Primary Contact</FieldLabel>
        <div style={{
          background: T.offwhite, border: `1px solid ${T.border}`,
          padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <FocusInput
            value={form.contacts[0].name}
            onChange={e => setContact('name', e.target.value)}
            placeholder="Contact name"
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FocusInput
              value={form.contacts[0].phone}
              onChange={e => setContact('phone', e.target.value)}
              placeholder="Phone"
              style={{ fontSize: 12 }}
            />
            <FocusInput
              value={form.contacts[0].email}
              onChange={e => setContact('email', e.target.value)}
              placeholder="Email (for portal link)"
              style={{ fontSize: 12 }}
            />
          </div>
        </div>
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderTop: `1px solid ${T.border}`, paddingTop: 20,
      }}>
        <GhostBtn onClick={onSkip}>Skip — save without email</GhostBtn>
        <GoldBtn onClick={handleSave} disabled={saving || !form.companyName.trim()}>
          {saving ? 'Saving…' : 'Create Client & Send Email'}
        </GoldBtn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ContactAddInlineForm
// Adds a new contact to an existing client record.
// ─────────────────────────────────────────────────────────────────────────────
function ContactAddInlineForm({ clientId, companyName, contactName, onAdded, onSkip, showToast }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: contactName || '', phone: '', email: '' });

  const handleSave = async () => {
    if (!form.name.trim()) { showToast('error', 'Contact name is required'); return; }
    log.info('Adding contact to existing client', { clientId, contactName: form.name });
    setSaving(true);
    try {
      const res = await api.patch(`/clients/${clientId}/add-contact`, form);
      log.info('Contact added', { clientId });
      onAdded(res.data);
    } catch (err) {
      log.error('Contact add failed', err.message);
      showToast('error', 'Failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '28px 32px' }}>
      <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted, marginBottom: 20 }}>
        <strong>{companyName}</strong> is in the database but <strong>"{contactName}"</strong> is not
        listed as a contact yet. Add their details to send the portal link.
      </p>

      <div style={{
        background: T.offwhite, border: `1px solid ${T.border}`,
        padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
        marginBottom: 24,
      }}>
        <FocusInput
          value={form.name}
          onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
          placeholder="Contact name"
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <FocusInput
            value={form.phone}
            onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))}
            placeholder="Phone"
            style={{ fontSize: 12 }}
          />
          <FocusInput
            value={form.email}
            onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
            placeholder="Email (for portal link)"
            style={{ fontSize: 12 }}
          />
        </div>
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderTop: `1px solid ${T.border}`, paddingTop: 20,
      }}>
        <GhostBtn onClick={onSkip}>Skip — save without email</GhostBtn>
        <GoldBtn onClick={handleSave} disabled={saving || !form.name.trim()}>
          {saving ? 'Saving…' : 'Add Contact & Send Email'}
        </GoldBtn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LinkedShipmentsPanel
// Read-only shipments list shown inside the Edit Order drawer.
// Full management lives in Courier Tracking.
// ─────────────────────────────────────────────────────────────────────────────
const LinkedShipmentsPanel = ({ orderId }) => {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (!orderId) return;
    log.debug('Fetching linked shipments', { orderId });
    api.get(`/shipments?orderId=${orderId}`)
      .then(res => {
        const data = Array.isArray(res.data) ? res.data : [];
        log.info('Shipments loaded', { orderId, count: data.length });
        setShipments(data);
      })
      .catch(err => {
        log.warn('Failed to load shipments', err.message);
        setShipments([]);
      })
      .finally(() => setLoading(false));
  }, [orderId]);

  const thStyle = {
    padding: '10px 14px', textAlign: 'left',
    fontFamily: jost, fontSize: 9, fontWeight: 400,
    letterSpacing: '0.22em', textTransform: 'uppercase', color: T.muted,
    borderBottom: `1px solid ${T.border}`,
  };

  return (
    <div style={{ marginTop: 8 }}>
      {/* Sub-section header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 10,
      }}>
        <p style={{
          fontFamily: jost, fontSize: 9, fontWeight: 400,
          letterSpacing: '0.28em', textTransform: 'uppercase',
          color: 'rgba(184,151,90,0.65)', margin: 0,
        }}>
          Linked Shipments
        </p>
        {shipments.length > 0 && (
          <span style={{
            fontFamily: jost, fontSize: 9, fontWeight: 400,
            letterSpacing: '0.15em', textTransform: 'uppercase', color: T.muted,
          }}>
            {shipments.length} shipment{shipments.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 16px', background: T.offwhite, border: `1px solid ${T.border}`,
          fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted,
        }}>
          <Spinner size={13} /> Loading shipments…
        </div>
      ) : shipments.length === 0 ? (
        <div style={{
          padding: '14px 16px', background: T.offwhite, border: `1px solid ${T.border}`,
          fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted,
        }}>
          No shipments linked to this order yet.
        </div>
      ) : (
        <div style={{ border: `1px solid ${T.border}`, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: T.offwhite }}>
                {['Recipient', 'City', 'Tracking ID', 'Partner', 'Status'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => {
                const statusStyle = SHIPMENT_STATUS_STYLES[s.status] || { bg: '#f1f5f9', color: '#64748b' };
                return (
                  <tr key={s._id} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ padding: '12px 14px' }}>
                      <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 500, color: T.text, margin: '0 0 2px' }}>
                        {s.recipientName}
                      </p>
                      {s.phone && (
                        <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted, margin: 0 }}>
                          {s.phone}
                        </p>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted }}>
                      {s.city || '—'}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {s.trackingId ? (
                        <span style={{
                          fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
                          color: T.indigo, background: 'rgba(79,70,229,0.06)',
                          padding: '3px 8px', letterSpacing: '0.05em',
                        }}>
                          {s.trackingId}
                        </span>
                      ) : (
                        <span style={{ color: T.muted, fontFamily: jost, fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted }}>
                      {s.shippingPartner || '—'}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{
                        fontFamily: jost, fontSize: 9, fontWeight: 500,
                        letterSpacing: '0.18em', textTransform: 'uppercase',
                        padding: '4px 10px',
                        background: statusStyle.bg,
                        color: statusStyle.color,
                      }}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the Indian FY string, e.g. "24-25" */
const getFinancialYear = (dateStr) => {
  const date   = new Date(dateStr);
  const year   = date.getFullYear();
  const month  = date.getMonth(); // 0-indexed; April = 3
  const fyStart = month >= 3 ? year : year - 1;
  return `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`;
};

const getMonthName = (dateStr) =>
  new Date(dateStr).toLocaleString('default', { month: 'long' });

/** localStorage helpers for unread-message tracking */
const getSeenCount = (orderId) =>
  parseInt(localStorage.getItem(`seen_${orderId}`) || '0', 10);
const setSeenCount = (orderId, n) =>
  localStorage.setItem(`seen_${orderId}`, String(n));

const getFileIcon = (type) => {
  if (type?.includes('image'))                          return <FileSpreadsheet size={13} style={{ color: T.gold }} />;
  if (type?.includes('sheet') || type?.includes('excel')) return <FileSpreadsheet size={13} style={{ color: T.emerald }} />;
  return <FileText size={13} style={{ color: T.muted }} />;
};

// ─────────────────────────────────────────────────────────────────────────────
// OrderRow
// ─────────────────────────────────────────────────────────────────────────────
const OrderRow = ({
  order, loading, unreadCounts, sentLinks, copiedId,
  onRowClick, onStartProject, onMarkComplete,
  onOpenPortalChat, onCopyLink, onDelete,
}) => {
  const isCompleted = order.status === 'completed';

  const ordData   = unreadCounts[order._id];
  const unread    = ordData?.unread || 0;
  const hasUnread = unread > 0;

  const slug      = order.refNumber?.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const portalUrl = `${window.location.origin}/p/${slug}`;
  const alreadySent = sentLinks[order._id];
  const justCopied  = copiedId === order._id;

  const rowHoverStyle = { transition: 'background 0.2s', cursor: 'pointer' };

  return (
    <tr
      onClick={() => onRowClick(order)}
      style={rowHoverStyle}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.015)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {/* ── Identifiers ── */}
      <td style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}` }}>
        {isCompleted ? (
          order.invoiceNumber && (
            <span style={{
              fontFamily: jost, fontSize: 9, fontWeight: 500,
              letterSpacing: '0.2em', textTransform: 'uppercase',
              background: T.emerald, color: 'white',
              padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
              <Receipt size={10} /> {order.invoiceNumber}
            </span>
          )
        ) : (
          order.refNumber ? (
            <span style={{
              fontFamily: jost, fontSize: 9, fontWeight: 500,
              letterSpacing: '0.2em', textTransform: 'uppercase',
              background: T.gold, color: 'white',
              padding: '4px 10px',
            }}>
              {order.refNumber}
            </span>
          ) : (
            <span style={{
              fontFamily: jost, fontSize: 9, fontWeight: 400,
              letterSpacing: '0.15em', color: T.muted,
              background: T.offwhite, border: `1px solid ${T.border}`,
              padding: '4px 10px',
            }}>
              #{order._id.slice(-6)}
            </span>
          )
        )}
      </td>

      {/* ── Project ── */}
      <td style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{
            marginTop: 2, padding: 6,
            background: order.orderType === 'offsite' ? 'rgba(249,115,22,0.08)' : 'rgba(79,70,229,0.08)',
            color: order.orderType === 'offsite' ? '#f97316' : T.indigo,
            flexShrink: 0,
          }}>
            {order.orderType === 'offsite' ? <MapPin size={12} /> : <Package size={12} />}
          </div>
          <div>
            <p style={{ fontFamily: jost, fontSize: 13, fontWeight: 500, color: T.text, margin: '0 0 3px' }}>
              {order.title}
            </p>
            <p style={{ fontFamily: jost, fontSize: 13, fontWeight: 400, color: T.muted, margin: '0 0 1px' }}>
              {order.clientName}
            </p>
            <p style={{ fontFamily: jost, fontSize: 13, fontWeight: 300, color: T.muted, margin: 0 }}>
              Attn: {order.orderPlacedBy || 'N/A'}
            </p>
          </div>
        </div>
      </td>

      {/* ── Description ── */}
      <td style={{ padding: '16px 20px', maxWidth: 260, borderBottom: `1px solid ${T.border}` }}>
        <div
          style={{
            fontFamily: jost, fontSize: 15, fontWeight: 300, color: T.muted,
            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', fontStyle: 'italic',
            pointerEvents: 'none',
          }}
          dangerouslySetInnerHTML={{
            __html: order.description?.replace(/<img[^>]*>/g, '[Image]') || '—',
          }}
        />
      </td>

      {/* ── Files ── */}
      <td style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}` }}>
        {order.attachments?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {order.attachments.map((file, idx) => (
              <a
                key={idx}
                href={file.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px',
                  background: 'rgba(79,70,229,0.05)',
                  border: `1px solid rgba(79,70,229,0.12)`,
                  color: T.indigo,
                  fontFamily: jost, fontSize: 10, fontWeight: 400,
                  letterSpacing: '0.08em', textDecoration: 'none',
                  maxWidth: 140, overflow: 'hidden',
                }}
              >
                <FileText size={11} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.name}
                </span>
                <Download
                  size={12}
                  style={{ flexShrink: 0, cursor: 'pointer' }}
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const url = file.downloadUrl || file['@microsoft.graph.downloadUrl'] || file.webUrl;
                    const link = document.createElement('a');
                    link.href = url;
                    link.setAttribute('download', file.name);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                />
              </a>
            ))}
          </div>
        )}
      </td>

      {/* ── Actions ── */}
      <td style={{ padding: '16px 20px', textAlign: 'right', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>

          {/* Start Project */}
          {order.status === 'inquiry' && (
            <button
              disabled={loading}
              onClick={e => { e.stopPropagation(); onStartProject(order); }}
              style={{
                fontFamily: jost, fontSize: 9, fontWeight: 500,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                padding: '6px 14px',
                background: loading ? T.offwhite : 'rgba(184,151,90,0.1)',
                border: `1px solid ${loading ? T.border : T.borderG}`,
                color: loading ? T.muted : T.gold,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {loading ? '…' : 'Start Project'}
            </button>
          )}

          {/* Mark Complete */}
          {order.status === 'ongoing' && (
            <button
              disabled={loading}
              onClick={e => { e.stopPropagation(); onMarkComplete(order); }}
              title="Mark complete"
              style={{
                background: 'none', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                color: loading ? '#d1d5db' : T.emerald, padding: 6, display: 'flex',
              }}
            >
              <CheckCircle size={17} />
            </button>
          )}

          {/* Portal chat */}
          {!isCompleted && (
            <button
              onClick={e => { e.stopPropagation(); onOpenPortalChat(order, ordData); }}
              title={hasUnread ? `${unread} new client message${unread !== 1 ? 's' : ''}` : 'Open portal chat'}
              style={{
                position: 'relative', background: 'none', border: 'none',
                cursor: 'pointer', padding: 6, display: 'flex',
                color: hasUnread ? '#7c3aed' : T.muted,
                transition: 'color 0.2s',
              }}
            >
              <Link2 size={15} />
              {hasUnread && (
                <span style={{
                  position: 'absolute', top: -2, right: -2,
                  minWidth: 15, height: 15,
                  background: '#ef4444', color: 'white',
                  fontSize: 8, fontFamily: jost, fontWeight: 700,
                  borderRadius: '50%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', padding: '0 3px',
                }}>
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
          )}

          {/* Copy/Send portal link */}
          {!isCompleted && (
            alreadySent ? (
              <div style={{ position: 'relative' }} className="group">
                <button
                  disabled
                  style={{
                    background: 'none', border: 'none', padding: 6,
                    color: '#d1d5db', cursor: 'not-allowed', display: 'flex',
                  }}
                  title="Link already sent"
                >
                  <Send size={15} />
                </button>
                {/* Hover tooltip */}
                <div style={{
                  position: 'absolute', right: 0, top: 32,
                  background: T.navy, color: 'white',
                  padding: '10px 14px', zIndex: 50,
                  minWidth: 160, display: 'none',
                }}
                  className="group-hover:!block"
                >
                  <p style={{ fontFamily: jost, fontSize: 9, letterSpacing: '0.2em', color: '#94a3b8', margin: '0 0 8px', textTransform: 'uppercase' }}>
                    Link sent
                  </p>
                  <button
                    onClick={e => { e.stopPropagation(); onCopyLink(order, portalUrl); }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontFamily: jost, fontSize: 10, color: '#a5b4fc',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {justCopied ? <CheckCircle size={11} /> : <Copy size={11} />}
                    {justCopied ? 'Copied!' : 'Copy link again'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); onCopyLink(order, portalUrl); }}
                title="Copy & send client link"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: 6, display: 'flex', color: justCopied ? T.emerald : T.muted,
                  transition: 'color 0.2s',
                }}
              >
                {justCopied ? <CheckCircle size={15} /> : <Send size={15} />}
              </button>
            )
          )}

          {/* Delete */}
          {!isCompleted && (
            <button
              disabled={loading}
              onClick={e => { e.stopPropagation(); onDelete(order); }}
              style={{
                background: 'none', border: 'none', padding: 6, display: 'flex',
                cursor: loading ? 'not-allowed' : 'pointer',
                color: loading ? '#e2e8f0' : 'rgba(220,38,38,0.5)',
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.color = '#dc2626'; }}
              onMouseLeave={e => { if (!loading) e.currentTarget.style.color = 'rgba(220,38,38,0.5)'; }}
            >
              <Trash2 size={17} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT — OrderTracker
// ─────────────────────────────────────────────────────────────────────────────
export default function OrderTracker() {

  // ── State ─────────────────────────────────────────────────────────────────
  const [orders,           setOrders]           = useState([]);
  const [activeTab,        setActiveTab]        = useState('inquiry');
  const [isModalOpen,      setIsModalOpen]      = useState(false);
  const [editOrder,        setEditOrder]        = useState(null);
  const [loading,          setLoading]          = useState(false);
  const [fetchLoading,     setFetchLoading]     = useState(true);
  const [expandedFolders,  setExpandedFolders]  = useState({});
  const [quotePrompt,      setQuotePrompt]      = useState(null);
  const [completionPrompt, setCompletionPrompt] = useState(null);
  const [searchTerm,       setSearchTerm]       = useState('');
  const [selectedClient,   setSelectedClient]   = useState('');
  const [selectedContact,  setSelectedContact]  = useState('');
  const [searchFocused,    setSearchFocused]    = useState(false);
  const [sentLinks,        setSentLinks]        = useState({});
  const [copiedId,         setCopiedId]         = useState(null);
  const [chatOrder,        setChatOrder]        = useState(null);
  const [clientCheckModal, setClientCheckModal] = useState(null);
  const [unreadCounts,     setUnreadCounts]     = useState({});

  // meta: populated from /clients, not from orders
  const [meta, setMeta] = useState({ clients: [], clientContacts: {}, clientMap: {} });

  const [formData, setFormData] = useState({
    title: '', clientName: '', orderPlacedBy: '',
    description: '', attachments: [], orderType: 'product',
  });

  const createEditorRef  = useRef(null);
  const editEditorRef    = useRef(null);
  const unreadPollTimer  = useRef(null);
  const prevClientCounts = useRef({});

  const { showToast, confirm, Toast, ConfirmDialog } = usePopup();

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchOrders = async () => {
    log.debug('Fetching orders…');
    setFetchLoading(true);
    try {
      const res = await api.get('/orders');
      if (!Array.isArray(res.data)) throw new Error('Non-array response');
      log.info('Orders loaded', { count: res.data.length });
      setOrders(res.data);
    } catch (err) {
      log.error('Failed to fetch orders', err.message);
      setOrders([]);
    } finally {
      setFetchLoading(false);
    }
  };

  const fetchClients = async () => {
    log.debug('Fetching client list for dropdowns…');
    try {
      const res  = await api.get('/clients');
      const data = Array.isArray(res.data) ? res.data : [];

      const clientMap = {};
      data.forEach(c => {
        clientMap[c.companyName] = { _id: c._id, contacts: c.contacts || [] };
      });

      const clients = data.map(c => c.companyName).sort();
      const clientContacts = {};
      data.forEach(c => {
        clientContacts[c.companyName] = (c.contacts || [])
          .map(ct => ct.name)
          .filter(Boolean)
          .sort();
      });

      log.info('Clients loaded for dropdowns', { count: clients.length });
      setMeta({ clients, clientContacts, clientMap });
    } catch (err) {
      log.warn('Could not load clients from API', err.message);
    }
  };

  // ── Unread polling ─────────────────────────────────────────────────────────
  // Keep a ref to orders so the poller always reads the latest list
  // without needing orders in its dependency array.
  const ordersRef = useRef(orders);
  useEffect(() => { ordersRef.current = orders; }, [orders]);

  const pollUnreadMessages = async () => {
    try {
      const { data: counts = {} } = await api.get('/portal/unread-counts').catch(() => ({ data: {} }));

      const badges = {};
      Object.entries(counts).forEach(([orderId, data]) => {
        const total  = data.clientCount || 0;
        const seen   = getSeenCount(orderId);
        const unread = Math.max(0, total - seen);
        badges[orderId] = { ...data, unread };

        const prev = prevClientCounts.current[orderId] || 0;
        if (total > prev && prev > 0) {
          const order = ordersRef.current.find(o => o._id === orderId);
          const label = order?.clientName || 'A client';
          pushNotif(
            `${label} sent a message`,
            data.lastClientMessage || 'New message in portal',
            '/orders',
            `portal-client-${orderId}`
          );
        }
        prevClientCounts.current[orderId] = total;
      });

      setUnreadCounts(badges);
    } catch (err) {
      log.warn('Unread poll failed', err.message);
    }
  };

  // ── Bootstrap — runs once on mount ────────────────────────────────────────
  // All three functions are plain declarations above this effect,
  // so there is no TDZ issue. The empty dep array is intentional:
  // we want mount-only behaviour; the functions are stable references
  // within this render scope.
  useEffect(() => {
    initNotifications();
    fetchOrders();
    fetchClients();
    pollUnreadMessages();
    unreadPollTimer.current = setInterval(pollUnreadMessages, UNREAD_POLL_INTERVAL);
    return () => clearInterval(unreadPollTimer.current);
  }, []);

  // ── Derived data ───────────────────────────────────────────────────────────
  const filteredOrders = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return (orders || []).filter(order => {
      if (order.status !== activeTab) return false;
      if (selectedClient  && order.clientName    !== selectedClient)  return false;
      if (selectedContact && order.orderPlacedBy !== selectedContact) return false;
      if (!searchTerm) return true;
      const haystack = [
        order.clientName, order.title, order.refNumber, order._id,
        order.orderPlacedBy, order.invoiceNumber, order.description,
      ].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [orders, activeTab, searchTerm, selectedClient, selectedContact]);

  const groupedCompleted = useMemo(() => {
    const term = searchTerm.toLowerCase();
    const completed = orders.filter(o => {
      if (o.status !== 'completed') return false;
      if (!searchTerm) return true;
      return (
        o.clientName?.toLowerCase().includes(term) ||
        o.title?.toLowerCase().includes(term) ||
        o.invoiceNumber?.toLowerCase().includes(term)
      );
    });
    const hierarchy = {};
    completed.forEach(order => {
      const date  = order.completedAt || order.updatedAt || new Date().toISOString();
      const fy    = getFinancialYear(date);
      const month = getMonthName(date);
      if (!hierarchy[fy])        hierarchy[fy] = {};
      if (!hierarchy[fy][month]) hierarchy[fy][month] = [];
      hierarchy[fy][month].push(order);
    });
    return hierarchy;
  }, [orders, searchTerm]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const sendPortalEmail = async ({ slug, clientEmail, contactName, clientName, orderRef, title, portalUrl }) => {
    log.debug('Sending portal email', { clientEmail, orderRef });
    await api.post('/portal/send-email', {
      slug, clientEmail, contactName, clientName, orderRef, title, portalUrl,
      cc: CC_EMAIL,
    });
  };

  const saveOrder = async (e) => {
    e.preventDefault();
    log.info('Submitting new inquiry', { title: formData.title, client: formData.clientName });
    setLoading(true);

    const richDescription = createEditorRef.current
      ? createEditorRef.current.innerHTML
      : formData.description;

    const financialYear = getFinancialYear(new Date().toISOString());
    const fyOrders      = orders.filter(o => o.refNumber?.startsWith('INQ-' + financialYear));
    const lastNumbers   = fyOrders
      .map(o => parseInt(o.refNumber.split('-').pop(), 10))
      .filter(n => !isNaN(n));
    const nextNumber  = lastNumbers.length > 0 ? Math.max(...lastNumbers) + 1 : 1;
    const generatedRef = `INQ-${financialYear}-${String(nextNumber).padStart(3, '0')}`;

    const payload = {
      ...formData,
      refNumber: generatedRef,
      description: richDescription,
      status: 'inquiry',
    };

    try {
      const res = await api.post('/orders', payload);
      if (res.status === 201 || res.status === 200) {
        setIsModalOpen(false);
        setFormData({ title: '', clientName: '', orderPlacedBy: '', description: '', attachments: [], orderType: 'product' });
        fetchOrders();
        log.info('Inquiry created', { ref: generatedRef });

        // Create portal to get the real server-generated slug
        const savedOrder = res.data;
        let portalSlug   = generatedRef.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        let portalUrl    = `${window.location.origin}/p/${portalSlug}`;

        try {
          const portalRes = await api.post('/portal', {
            orderId:    savedOrder._id,
            type:       payload.orderType || 'product',
            orderRef:   generatedRef,
            clientName: payload.clientName,
            title:      payload.title,
          });
          if (portalRes.data?.slug) {
            portalSlug = portalRes.data.slug;
            portalUrl  = `${window.location.origin}/p/${portalSlug}`;
            log.info('Portal created', { slug: portalSlug });
          }
        } catch (portalErr) {
          if (portalErr.response?.status === 409 && portalErr.response.data?.portal?.slug) {
            portalSlug = portalErr.response.data.portal.slug;
            portalUrl  = `${window.location.origin}/p/${portalSlug}`;
            log.info('Portal already existed', { slug: portalSlug });
          } else {
            log.warn('Portal creation failed — slug may be wrong', portalErr.message);
          }
        }

        // Client/contact lookup → determine email-send scenario
        try {
          const lookup = await api.get('/clients/lookup', { params: { name: payload.clientName } });

          if (lookup.data.found && lookup.data.client) {
            const existingClient = lookup.data.client;
            const contactName    = payload.orderPlacedBy?.trim() || '';
            const matchedContact = existingClient.contacts?.find(
              ct => ct.name?.toLowerCase() === contactName.toLowerCase()
            );

            if (matchedContact?.email) {
              // Scenario A: client + contact both exist with email
              try {
                await sendPortalEmail({
                  slug: portalSlug, clientEmail: matchedContact.email,
                  contactName: matchedContact.name, clientName: existingClient.companyName,
                  orderRef: generatedRef, title: payload.title, portalUrl,
                });
                log.info('Portal email sent', { email: matchedContact.email });
              } catch (emailErr) {
                log.warn('Email send failed (non-fatal)', emailErr.message);
              }
            } else {
              // Scenarios B & C: contact exists without email OR brand-new contact
              setClientCheckModal({
                mode:        'add-contact',
                clientId:    existingClient._id,
                companyName: existingClient.companyName,
                contactName, orderRef: generatedRef,
                title: payload.title, portalSlug, portalUrl,
              });
            }
          } else {
            // Scenario D: client not in DB
            setClientCheckModal({
              mode: 'create', clientName: payload.clientName,
              contactName: payload.orderPlacedBy?.trim() || '',
              orderRef: generatedRef, title: payload.title, portalSlug, portalUrl,
            });
          }
        } catch (lookupErr) {
          log.warn('Client lookup failed', lookupErr.message);
          setClientCheckModal({
            mode: 'create', clientName: payload.clientName,
            contactName: payload.orderPlacedBy?.trim() || '',
            orderRef: generatedRef, title: payload.title, portalSlug,
            portalUrl: `${window.location.origin}/p/${portalSlug}`,
          });
        }
      }
    } catch (err) {
      log.error('Save order failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateOrder = async (id, payload) => {
    log.info('Updating order', { id });
    setLoading(true);
    const finalPayload = { ...payload };
    if (editEditorRef.current && id === editOrder?._id) {
      finalPayload.description = editEditorRef.current.innerHTML;
    }
    try {
      await api.patch(`/orders/${id}`, finalPayload);
      setEditOrder(null);
      fetchOrders();
      log.info('Order updated', { id });
    } catch (err) {
      log.error('Update order failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteOrder = async (order) => {
    const ok = await confirm({
      title:        'Delete Order',
      message:      `"${order.title}" and its portal will be permanently removed.`,
      confirmLabel: 'Delete',
      variant:      'danger',
    });
    if (!ok) return;
    log.info('Deleting order', { id: order._id, title: order.title });
    try {
      await api.delete(`/orders/${order._id}`);
      try {
        const portalRes = await api.get(`/portal/order/${order._id}`);
        if (portalRes.data?.slug) await api.delete(`/portal/${portalRes.data.slug}`);
      } catch { /* portal may not exist */ }
      showToast('success', `"${order.title}" deleted`);
      fetchOrders();
    } catch (err) {
      log.error('Delete order failed', err.message);
      showToast('error', err.response?.data?.message || err.message);
    }
  };

  // ── UI helpers ─────────────────────────────────────────────────────────────
  const deleteMetaItem = (type, value, parentClient = null) => {
    setMeta(prev => {
      if (type === 'clients') {
        const newContacts = { ...prev.clientContacts };
        const newMap      = { ...prev.clientMap };
        delete newContacts[value];
        delete newMap[value];
        return { ...prev, clients: prev.clients.filter(i => i !== value), clientContacts: newContacts, clientMap: newMap };
      }
      return {
        ...prev,
        clientContacts: {
          ...prev.clientContacts,
          [parentClient]: prev.clientContacts[parentClient].filter(i => i !== value),
        },
      };
    });
  };

  const toggleFolder = (path) => setExpandedFolders(prev => ({ ...prev, [path]: !prev[path] }));

  const handleFileUpload = (e, isEdit = false) => {
    Array.from(e.target.files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const attachment = { name: file.name, base64: ev.target.result, isNew: true };
        if (isEdit) {
          setEditOrder(prev => ({ ...prev, attachments: [...(prev.attachments || []), attachment] }));
        } else {
          setFormData(prev => ({ ...prev, attachments: [...(prev.attachments || []), attachment] }));
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handlePaste = (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of Object.values(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault();
        const blob   = item.getAsFile();
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = `<img src="${ev.target.result}" style="max-width:100%;border-radius:4px;margin:10px 0;" />`;
          document.execCommand('insertHTML', false, img);
        };
        reader.readAsDataURL(blob);
      }
    }
  };

  const loadOrderAttachments = async (order) => {
    setEditOrder(order);
    try {
      const res = await api.get(`/orders/${order._id}/attachments`);
      if (Array.isArray(res.data)) {
        setEditOrder(prev =>
          prev?._id === order._id ? { ...prev, attachments: res.data } : prev
        );
      }
    } catch (err) {
      log.warn('Attachment refresh failed (non-fatal)', err.message);
    }
  };

  const handleOpenPortalChat = async (order, ordData) => {
    await requestNotifPermission();
    const total = ordData?.clientCount || 0;
    setSeenCount(order._id, total);
    setUnreadCounts(prev => ({
      ...prev,
      [order._id]: { ...(prev[order._id] || {}), unread: 0 },
    }));
    setChatOrder(order);
  };

  const handleCopyLink = (order, portalUrl) => {
    navigator.clipboard.writeText(portalUrl);
    setSentLinks(prev => ({ ...prev, [order._id]: true }));
    setCopiedId(order._id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ── Shared row props ───────────────────────────────────────────────────────
  const rowProps = {
    loading, unreadCounts, sentLinks, copiedId,
    onRowClick:       loadOrderAttachments,
    onStartProject:   (order) => setQuotePrompt(order),
    onMarkComplete:   (order) => setCompletionPrompt(order),
    onOpenPortalChat: handleOpenPortalChat,
    onCopyLink:       handleCopyLink,
    onDelete:         deleteOrder,
  };

  // ── Column-header style (matches ClientList th) ────────────────────────────
  const thStyle = {
    padding: '12px 20px', textAlign: 'left',
    fontFamily: jost, fontSize: 9, fontWeight: 400,
    letterSpacing: '0.25em', textTransform: 'uppercase',
    color: T.muted, borderBottom: `1px solid ${T.border}`,
    background: T.offwhite,
  };

  // ── Tab config ─────────────────────────────────────────────────────────────
  const TABS = [
    { id: 'inquiry',   label: 'Inquiries',       icon: Clock },
    { id: 'ongoing',   label: 'Ongoing',          icon: ArrowRight },
    { id: 'completed', label: 'Completed Orders', icon: Calendar },
  ];

  // ── CustomCreatableSelect (local) ──────────────────────────────────────────
  const CustomCreatableSelect = ({ label, options, value, onChange, onDelete, isDisabled }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
            {context === 'menu' && (
              <button
                onClick={e => { e.stopPropagation(); onDelete(option.value); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, padding: 2 }}
              >
                <X size={11} />
              </button>
            )}
          </div>
        )}
        styles={{
          control: base => ({
            ...base, border: `1px solid ${T.border}`, borderRadius: 3,
            padding: '2px 4px', background: 'white', fontSize: 13, fontFamily: jost,
            boxShadow: 'none', '&:hover': { borderColor: T.gold },
          }),
          option: (base, { isFocused }) => ({
            ...base, fontFamily: jost, fontSize: 12,
            background: isFocused ? T.dimBg : 'white',
            color: T.text,
          }),
        }}
      />
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: T.offwhite, fontFamily: jost, padding: '56px 48px' }}>

      <Toast />
      <ConfirmDialog />

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 40 }}>
        <GoldRule />
        <p style={{
          fontSize: 9, fontWeight: 400, letterSpacing: '0.3em',
          textTransform: 'uppercase', color: T.muted, marginBottom: 10,
        }}>
          Operations
        </p>
        <h1 style={{
          fontFamily: serif, fontSize: 40, fontWeight: 300,
          color: T.navy, lineHeight: 1.05, margin: '0 0 24px',
        }}>
          Order <em style={{ color: T.gold }}>Management.</em>
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
              placeholder="Search orders, clients, references…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              style={{
                width: '100%', padding: '10px 36px 10px 36px',
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
                  border: 'none', cursor: 'pointer', color: T.muted,
                  display: 'flex', padding: 0,
                }}
              >✕</button>
            )}
          </div>

          {/* Client filter */}
          <select
            value={selectedClient}
            onChange={e => { setSelectedClient(e.target.value); setSelectedContact(''); }}
            style={{
              padding: '10px 14px', background: 'white',
              border: `1px solid ${T.border}`, borderRadius: 3,
              fontFamily: jost, fontSize: 12, fontWeight: 300,
              color: T.text, outline: 'none', cursor: 'pointer',
            }}
          >
            <option value="">All Clients</option>
            {meta.clients.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Contact filter */}
          <select
            value={selectedContact}
            onChange={e => setSelectedContact(e.target.value)}
            style={{
              padding: '10px 14px', background: 'white',
              border: `1px solid ${T.border}`, borderRadius: 3,
              fontFamily: jost, fontSize: 12, fontWeight: 300,
              color: T.text, outline: 'none', cursor: 'pointer',
            }}
          >
            <option value="">All Contacts</option>
            {(selectedClient
              ? (meta.clientContacts[selectedClient] || [])
              : Array.from(new Set(Object.values(meta.clientContacts).flat()))
            ).map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Reset filters */}
          {(searchTerm || selectedClient || selectedContact) && (
            <button
              onClick={() => { setSearchTerm(''); setSelectedClient(''); setSelectedContact(''); }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: T.muted, display: 'flex', padding: 6,
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = T.gold}
              onMouseLeave={e => e.currentTarget.style.color = T.muted}
              title="Reset Filters"
            >
              <X size={17} />
            </button>
          )}

          {/* New inquiry CTA */}
          <GoldBtn onClick={() => setIsModalOpen(true)} style={{ marginLeft: 'auto', flexShrink: 0 }}>
            + New Inquiry
          </GoldBtn>
        </div>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 2, marginBottom: 24,
        borderBottom: `1px solid ${T.border}`,
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '10px 22px',
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: jost, fontSize: 9, fontWeight: 400,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              color: activeTab === tab.id ? T.gold : T.muted,
              borderBottom: activeTab === tab.id ? `2px solid ${T.gold}` : '2px solid transparent',
              marginBottom: -1,
              transition: 'color 0.2s, border-color 0.2s',
            }}
          >
            <tab.icon size={13} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Table container ──────────────────────────────────────────────── */}
      <div style={{ background: 'white', border: `1px solid ${T.border}`, overflow: 'hidden' }}>

        {fetchLoading ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 14, padding: '80px 0',
          }}>
            <Spinner size={36} />
            <p style={{
              fontFamily: jost, fontSize: 9, fontWeight: 400,
              letterSpacing: '0.3em', textTransform: 'uppercase', color: T.muted,
            }}>
              Fetching Orders…
            </p>
          </div>
        ) : activeTab !== 'completed' ? (

          /* ── Inquiries / Ongoing table ── */
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
              {filteredOrders.map(order => (
                <OrderRow key={order._id} order={order} {...rowProps} />
              ))}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: '64px 0', textAlign: 'center' }}>
                    <p style={{
                      fontFamily: jost, fontSize: 12, fontWeight: 300,
                      letterSpacing: '0.1em', color: T.muted,
                    }}>
                      No matches found{searchTerm ? ` for "${searchTerm}"` : ''}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

        ) : (

          /* ── Completed orders — FY / Month hierarchy ── */
          <div style={{ padding: '24px' }}>
            {Object.entries(groupedCompleted).length === 0 && (
              <p style={{
                textAlign: 'center', padding: '64px 0',
                fontFamily: jost, fontSize: 12, fontWeight: 300,
                letterSpacing: '0.1em', color: T.muted,
              }}>
                No completed records found
              </p>
            )}

            {Object.entries(groupedCompleted).map(([fy, months]) => (
              <div key={fy} style={{ marginBottom: 12 }}>
                {/* FY row */}
                <button
                  onClick={() => toggleFolder(fy)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '14px 18px', background: T.offwhite,
                    border: `1px solid ${T.border}`, cursor: 'pointer',
                    fontFamily: jost, fontSize: 10, fontWeight: 500,
                    letterSpacing: '0.2em', textTransform: 'uppercase', color: T.text,
                    textAlign: 'left',
                  }}
                >
                  <FolderOpen size={15} style={{ color: T.gold }} />
                  {fy}
                  {expandedFolders[fy]
                    ? <ChevronDown size={14} style={{ marginLeft: 'auto', color: T.muted }} />
                    : <ChevronRight size={14} style={{ marginLeft: 'auto', color: T.muted }} />}
                </button>

                {expandedFolders[fy] && (
                  <div style={{ marginLeft: 24, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {Object.entries(months).map(([month, items]) => (
                      <div key={month}>
                        {/* Month row */}
                        <button
                          onClick={() => toggleFolder(`${fy}-${month}`)}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                            padding: '10px 14px', background: 'white',
                            border: `1px solid ${T.border}`, cursor: 'pointer',
                            fontFamily: jost, fontSize: 9, fontWeight: 400,
                            letterSpacing: '0.22em', textTransform: 'uppercase', color: T.muted,
                            textAlign: 'left',
                          }}
                        >
                          <Calendar size={12} />
                          {month} ({items.length})
                        </button>

                        {expandedFolders[`${fy}-${month}`] && (
                          <div style={{
                            border: `1px solid ${T.border}`,
                            borderTop: 'none',
                            overflow: 'hidden',
                            marginBottom: 8,
                          }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <tbody>
                                {items.map(order => (
                                  <OrderRow key={order._id} order={order} {...rowProps} />
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Row count footer (mirrors ClientList) */}
        {!fetchLoading && activeTab !== 'completed' && (
          <div style={{
            borderTop: `1px solid ${T.border}`,
            padding: '10px 20px',
            fontFamily: jost, fontSize: 10, fontWeight: 300,
            letterSpacing: '0.12em', color: T.muted, textAlign: 'right',
          }}>
            {filteredOrders.length} of {orders.filter(o => o.status === activeTab).length} records
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          EDIT ORDER MODAL
      ════════════════════════════════════════════════════════════════════ */}
      {editOrder && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(14,21,32,0.78)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, zIndex: 50,
        }}>
          <div style={{
            background: 'white', border: `1px solid ${T.border}`,
            width: '100%', maxWidth: 720,
            maxHeight: '92vh', overflowY: 'auto',
            padding: '40px 40px 32px',
          }}>
            {/* Header */}
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
                  Update Record
                </p>
                <h2 style={{ fontFamily: serif, fontSize: 28, fontWeight: 300, color: T.navy, margin: 0 }}>
                  Record Details
                </h2>
              </div>
              <button
                disabled={loading}
                onClick={() => setEditOrder(null)}
                style={{
                  background: 'none', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                  color: T.muted, fontSize: 20, lineHeight: 1, padding: 4,
                  opacity: loading ? 0.3 : 1,
                }}
              >
                ✕
              </button>
            </div>

            {loading ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 14, padding: '80px 0',
              }}>
                <Spinner size={40} />
                <div style={{ textAlign: 'center' }}>
                  <p style={{
                    fontFamily: jost, fontSize: 10, fontWeight: 500,
                    letterSpacing: '0.22em', textTransform: 'uppercase', color: T.text,
                  }}>
                    Updating Record…
                  </p>
                  <p style={{
                    fontFamily: jost, fontSize: 9, fontWeight: 300,
                    letterSpacing: '0.12em', color: T.muted, marginTop: 4,
                  }}>
                    Syncing changes to database
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <div>
                    <FieldLabel>Project Title</FieldLabel>
                    <FocusInput
                      value={editOrder.title || ''}
                      onChange={e => setEditOrder({ ...editOrder, title: e.target.value })}
                      placeholder="Project Title"
                    />
                  </div>
                  <div>
                    <FieldLabel>Client Name</FieldLabel>
                    <FocusInput
                      value={editOrder.clientName || ''}
                      onChange={e => setEditOrder({ ...editOrder, clientName: e.target.value })}
                      placeholder="Client Name"
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <div>
                    <FieldLabel>{activeTab === 'ongoing' ? 'Quote Number' : 'Ref Number'}</FieldLabel>
                    <FocusInput value={editOrder.refNumber || ''} readOnly />
                  </div>
                  <div>
                    <FieldLabel>Order Placed By</FieldLabel>
                    <FocusInput
                      value={editOrder.orderPlacedBy || ''}
                      onChange={e => setEditOrder({ ...editOrder, orderPlacedBy: e.target.value })}
                      placeholder="N/A"
                    />
                  </div>
                </div>

                {/* Rich text notes */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: 8,
                  }}>
                    <FieldLabel>Project Notes</FieldLabel>
                    <div style={{ display: 'flex', gap: 8, color: T.muted }}>
                      <ImageIcon size={12} /> <TableIcon size={12} />
                    </div>
                  </div>
                  <div
                    ref={editEditorRef}
                    contentEditable
                    onPaste={handlePaste}
                    dangerouslySetInnerHTML={{ __html: editOrder.description || '' }}
                    style={{
                      width: '100%', minHeight: 400,
                      padding: '16px 18px',
                      background: T.offwhite, border: `1px solid ${T.border}`,
                      fontFamily: jost, fontSize: 13, fontWeight: 300,
                      outline: 'none', boxSizing: 'border-box',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      overflowY: 'auto',
                      transition: 'border-color 0.2s',
                    }}
                    onFocus={e => e.currentTarget.style.borderColor = T.gold}
                    onBlur={e => e.currentTarget.style.borderColor = T.border}
                  />
                </div>

                {/* Attachments */}
                <div style={{ marginBottom: 20 }}>
                  <FieldLabel>Attachments</FieldLabel>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {editOrder.attachments?.map((file, idx) => (
                      <div key={idx} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '5px 12px',
                        background: 'rgba(79,70,229,0.05)',
                        border: `1px solid rgba(79,70,229,0.12)`,
                        fontFamily: jost, fontSize: 10, color: T.indigo,
                      }}>
                        <FileText size={11} />
                        <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {file.name}
                        </span>
                        <Download size={12} style={{ cursor: 'pointer' }} onClick={e => {
                          const url = file.downloadUrl || file['@microsoft.graph.downloadUrl'] || file.webUrl;
                          const a = document.createElement('a');
                          a.href = url; a.setAttribute('download', file.name);
                          document.body.appendChild(a); a.click(); document.body.removeChild(a);
                        }} />
                        <X size={12} style={{ cursor: 'pointer', color: T.danger }} onClick={() =>
                          setEditOrder({ ...editOrder, attachments: editOrder.attachments.filter((_, i) => i !== idx) })
                        } />
                      </div>
                    ))}
                    <label style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 38, height: 38, cursor: 'pointer',
                      background: T.dimBg, border: `1px solid ${T.borderG}`, color: T.gold,
                    }}>
                      <Plus size={15} />
                      <input type="file" multiple style={{ display: 'none' }} onChange={e => handleFileUpload(e, true)} />
                    </label>
                  </div>
                </div>

                {/* Linked shipments — product orders only */}
                {editOrder.orderType !== 'offsite' && (
                  <div style={{ marginBottom: 20 }}>
                    <LinkedShipmentsPanel orderId={editOrder._id} />
                  </div>
                )}

                {/* Footer actions */}
                <div style={{
                  display: 'flex', justifyContent: 'flex-end', gap: 14,
                  borderTop: `1px solid ${T.border}`, paddingTop: 24,
                }}>
                  <GhostBtn onClick={() => setEditOrder(null)}>Cancel</GhostBtn>
                  <GoldBtn
                    onClick={() => updateOrder(editOrder._id, editOrder)}
                    disabled={loading}
                  >
                    {loading ? 'Saving…' : 'Update Database'}
                  </GoldBtn>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          NEW INQUIRY MODAL
      ════════════════════════════════════════════════════════════════════ */}
      {isModalOpen && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(14,21,32,0.75)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, zIndex: 50,
        }}>
          <div style={{
            background: 'white', border: `1px solid ${T.border}`,
            width: '100%', maxWidth: 620,
            maxHeight: '90vh', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              padding: '32px 36px 20px',
              borderBottom: `1px solid ${T.border}`,
            }}>
              <div>
                <p style={{
                  fontFamily: jost, fontSize: 9, fontWeight: 400,
                  letterSpacing: '0.28em', textTransform: 'uppercase',
                  color: T.muted, marginBottom: 6,
                }}>
                  New Registration
                </p>
                <h2 style={{ fontFamily: serif, fontSize: 28, fontWeight: 300, color: T.navy, margin: 0 }}>
                  Create Inquiry
                </h2>
                <p style={{
                  fontFamily: jost, fontSize: 9, fontWeight: 300,
                  color: T.muted, marginTop: 6, letterSpacing: '0.12em',
                }}>
                  Paste screenshots and tables directly into the notes field.
                </p>
              </div>
              <button
                disabled={loading}
                onClick={() => setIsModalOpen(false)}
                style={{
                  background: 'none', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                  color: T.muted, fontSize: 20, lineHeight: 1, padding: 4,
                  opacity: loading ? 0.3 : 1,
                }}
              >
                ✕
              </button>
            </div>

            {loading ? (
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 14, padding: '60px 0',
              }}>
                <Spinner size={36} />
                <p style={{
                  fontFamily: jost, fontSize: 9, fontWeight: 400,
                  letterSpacing: '0.28em', textTransform: 'uppercase', color: T.muted,
                }}>
                  Submitting Inquiry…
                </p>
              </div>
            ) : (
              <form
                onSubmit={saveOrder}
                style={{ padding: '28px 36px 32px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}
              >
                {/* Project title */}
                <div>
                  <FieldLabel>Project Title</FieldLabel>
                  <FocusInput
                    value={formData.title}
                    onChange={e => setFormData({ ...formData, title: e.target.value })}
                    placeholder="Project title"
                  />
                </div>

                {/* Order type toggle */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {[
                    { v: 'product', label: '🎁 Product Gifting' },
                    { v: 'offsite', label: '🏨 Offsite' },
                  ].map(({ v, label }) => (
                    <button
                      type="button"
                      key={v}
                      onClick={() => setFormData({ ...formData, orderType: v })}
                      style={{
                        padding: '12px 0', cursor: 'pointer',
                        fontFamily: jost, fontSize: 9, fontWeight: 400,
                        letterSpacing: '0.2em', textTransform: 'uppercase',
                        background: formData.orderType === v ? T.dimBg : 'white',
                        border: `1px solid ${formData.orderType === v ? T.gold : T.border}`,
                        color: formData.orderType === v ? T.gold : T.muted,
                        transition: 'all 0.2s',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Client + Contact */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <CustomCreatableSelect
                    label="Client Company"
                    options={meta.clients.map(c => ({ label: c, value: c }))}
                    value={formData.clientName ? { label: formData.clientName, value: formData.clientName } : null}
                    onChange={v => setFormData({ ...formData, clientName: v?.value || '', orderPlacedBy: '' })}
                    onDelete={val => deleteMetaItem('clients', val)}
                  />
                  <CustomCreatableSelect
                    label="Contact Person"
                    isDisabled={!formData.clientName}
                    options={(meta.clientContacts[formData.clientName] || []).map(c => ({ label: c, value: c }))}
                    value={formData.orderPlacedBy ? { label: formData.orderPlacedBy, value: formData.orderPlacedBy } : null}
                    onChange={v => setFormData({ ...formData, orderPlacedBy: v?.value || '' })}
                    onDelete={val => deleteMetaItem('contacts', val, formData.clientName)}
                  />
                </div>

                {/* Requirements (rich text) */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <FieldLabel>Requirements</FieldLabel>
                    <div style={{ display: 'flex', gap: 8, color: T.muted }}>
                      <ImageIcon size={12} /> <TableIcon size={12} />
                    </div>
                  </div>
                  <div
                    ref={createEditorRef}
                    contentEditable
                    onPaste={handlePaste}
                    onInput={e => setFormData({ ...formData, description: e.currentTarget.innerHTML })}
                    style={{
                      width: '100%', minHeight: 220, padding: '14px 16px',
                      background: T.offwhite, border: `1px solid ${T.border}`,
                      fontFamily: jost, fontSize: 13, fontWeight: 300, color: T.text,
                      outline: 'none', boxSizing: 'border-box',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      transition: 'border-color 0.2s',
                    }}
                    data-placeholder="Describe project details… paste images or Excel tables here."
                    onFocus={e => e.currentTarget.style.borderColor = T.gold}
                    onBlur={e => e.currentTarget.style.borderColor = T.border}
                  />
                </div>

                {/* Attachments */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '14px 16px',
                  background: T.offwhite, border: `1px dashed ${T.border}`,
                }}>
                  <label style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    padding: '8px 18px', cursor: 'pointer',
                    background: 'white', border: `1px solid ${T.border}`,
                    fontFamily: jost, fontSize: 9, fontWeight: 400,
                    letterSpacing: '0.18em', textTransform: 'uppercase', color: T.muted,
                  }}>
                    <Plus size={12} /> Attach Files
                    <input type="file" multiple style={{ display: 'none' }} onChange={e => handleFileUpload(e, false)} />
                  </label>
                  <span style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted }}>
                    {formData.attachments.length} file{formData.attachments.length !== 1 ? 's' : ''} attached
                  </span>
                </div>

                {/* Submit */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: `1px solid ${T.border}`, paddingTop: 20 }}>
                  <GoldBtn style={{ padding: '13px 48px' }}>
                    Submit Inquiry
                  </GoldBtn>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          QUOTE PROMPT
      ════════════════════════════════════════════════════════════════════ */}
      {quotePrompt && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(14,21,32,0.82)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 100,
        }}>
          <div style={{
            background: 'white', border: `1px solid ${T.border}`,
            padding: '40px', width: '100%', maxWidth: 380,
          }}>
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{
                width: 44, height: 44, background: 'rgba(79,70,229,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 14px', color: T.indigo,
              }}>
                <Hash size={22} />
              </div>
              <h3 style={{ fontFamily: serif, fontSize: 26, fontWeight: 300, color: T.navy, margin: '0 0 8px' }}>
                Finalize Quote
              </h3>
              <p style={{
                fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.18em', textTransform: 'uppercase', color: T.muted,
              }}>
                Assign a reference number to move to production
              </p>
            </div>

            <FocusInput
              id="refInput"
              placeholder="e.g. Q-2024-001"
              value=""
              onChange={() => {}}
              style={{ textAlign: 'center', fontWeight: 500, textTransform: 'uppercase', marginBottom: 20 }}
            />

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <GhostBtn onClick={() => setQuotePrompt(null)} style={{ flex: 1, textAlign: 'center', padding: '12px 0' }}>
                Cancel
              </GhostBtn>
              <GoldBtn
                onClick={() => {
                  const val = document.getElementById('refInput')?.value?.trim();
                  if (val) { updateOrder(quotePrompt._id, { status: 'ongoing', refNumber: val }); setQuotePrompt(null); }
                }}
                style={{ flex: 1, textAlign: 'center' }}
              >
                Confirm & Start
              </GoldBtn>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          COMPLETION PROMPT
      ════════════════════════════════════════════════════════════════════ */}
      {completionPrompt && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(14,21,32,0.82)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 100,
        }}>
          <div style={{
            background: 'white', border: `1px solid ${T.border}`,
            padding: '40px', width: '100%', maxWidth: 380,
          }}>
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{
                width: 44, height: 44, background: 'rgba(5,150,105,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 14px', color: T.emerald,
              }}>
                <Receipt size={22} />
              </div>
              <h3 style={{ fontFamily: serif, fontSize: 26, fontWeight: 300, color: T.navy, margin: '0 0 8px' }}>
                Completed Order
              </h3>
              <p style={{
                fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.18em', textTransform: 'uppercase', color: T.muted,
              }}>
                Enter final invoice number before closing
              </p>
            </div>

            <FocusInput
              id="invoiceInput"
              placeholder="e.g. INV-10293"
              value=""
              onChange={() => {}}
              style={{ textAlign: 'center', fontWeight: 500, textTransform: 'uppercase', marginBottom: 20 }}
            />

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <GhostBtn onClick={() => setCompletionPrompt(null)} style={{ flex: 1, textAlign: 'center', padding: '12px 0' }}>
                Cancel
              </GhostBtn>
              <GoldBtn
                onClick={() => {
                  const val = document.getElementById('invoiceInput')?.value?.trim();
                  if (val) {
                    updateOrder(completionPrompt._id, {
                      status: 'completed', invoiceNumber: val,
                      completedAt: new Date().toISOString(),
                    });
                    setCompletionPrompt(null);
                  }
                }}
                style={{ flex: 1, textAlign: 'center' }}
              >
                Save
              </GoldBtn>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          CLIENT CHECK MODAL
          mode: 'create'      — client not in DB
          mode: 'add-contact' — client exists, contact is new
      ════════════════════════════════════════════════════════════════════ */}
      {clientCheckModal && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(14,21,32,0.78)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, zIndex: 300,
        }}>
          <div style={{
            background: 'white', border: `1px solid ${T.border}`,
            width: '100%', maxWidth: 520, overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '20px 28px', background: 'rgba(184,151,90,0.05)',
              borderBottom: `1px solid ${T.borderG}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 36, height: 36,
                  background: 'rgba(184,151,90,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: T.gold, fontSize: 18,
                }}>
                  {clientCheckModal.mode === 'create' ? '⚠️' : <UserPlus size={16} style={{ color: T.gold }} />}
                </div>
                <div>
                  <p style={{
                    fontFamily: jost, fontSize: 12, fontWeight: 500, color: T.text, margin: '0 0 3px',
                  }}>
                    {clientCheckModal.mode === 'create' ? 'Client Not in Database' : 'New Contact Person'}
                  </p>
                  <p style={{
                    fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.gold, margin: 0,
                  }}>
                    {clientCheckModal.mode === 'create'
                      ? `"${clientCheckModal.clientName}" has no client record yet.`
                      : `"${clientCheckModal.contactName}" is not listed under ${clientCheckModal.companyName}.`
                    }
                  </p>
                </div>
              </div>
              <button
                onClick={() => setClientCheckModal(null)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: T.muted, fontSize: 18, lineHeight: 1, padding: 4,
                }}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            {clientCheckModal.mode === 'create' ? (
              <ClientCreateInlineForm
                clientName={clientCheckModal.clientName}
                contactName={clientCheckModal.contactName}
                showToast={showToast}
                onCreated={async (newClient) => {
                  setClientCheckModal(null);
                  await fetchClients();
                  const emailContact = newClient.contacts?.find(ct => ct.email?.includes('@'));
                  if (emailContact?.email) {
                    try {
                      await sendPortalEmail({
                        slug:        clientCheckModal.portalSlug,
                        clientEmail: emailContact.email,
                        contactName: newClient.contacts?.[0]?.name || emailContact.name || '',
                        clientName:  newClient.companyName,
                        orderRef:    clientCheckModal.orderRef,
                        title:       clientCheckModal.title,
                        portalUrl:   clientCheckModal.portalUrl,
                      });
                      showToast('success', `Portal link sent to ${emailContact.email}`);
                    } catch (err) {
                      showToast('error', 'Client created but email failed: ' + err.message);
                    }
                  } else {
                    showToast('warning', 'Client created. Add an email address to send the portal link.');
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
                  setClientCheckModal(null);
                  await fetchClients();
                  const newContact = updatedClient.contacts?.find(
                    ct => ct.name?.toLowerCase() === clientCheckModal.contactName?.toLowerCase()
                  );
                  if (newContact?.email) {
                    try {
                      await sendPortalEmail({
                        slug:        clientCheckModal.portalSlug,
                        clientEmail: newContact.email,
                        contactName: newContact.name,
                        clientName:  updatedClient.companyName,
                        orderRef:    clientCheckModal.orderRef,
                        title:       clientCheckModal.title,
                        portalUrl:   clientCheckModal.portalUrl,
                      });
                      showToast('success', `Contact added & portal link sent to ${newContact.email}`);
                    } catch (err) {
                      showToast('error', 'Contact added but email failed: ' + err.message);
                    }
                  } else {
                    showToast('warning', 'Contact added. No email provided — portal link not sent.');
                  }
                }}
                onSkip={() => setClientCheckModal(null)}
              />
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          CLIENT PORTAL EDITOR DRAWER
      ════════════════════════════════════════════════════════════════════ */}
      {chatOrder && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(14,21,32,0.55)', backdropFilter: 'blur(4px)',
          }}
          onClick={e => { if (e.target === e.currentTarget) setChatOrder(null); }}
        >
          <div style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: '100%', maxWidth: 480,
            background: 'white', display: 'flex', flexDirection: 'column',
            animation: 'slideInRight 0.25s ease',
          }}>
            <style>{`@keyframes slideInRight{from{transform:translateX(100%)}to{transform:none}}`}</style>
            <ClientPortalEditor order={chatOrder} onClose={() => setChatOrder(null)} />
          </div>
        </div>
      )}

      {/* ── Custom scrollbar CSS ─────────────────────────────────────────── */}
      <style>{`
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(184,151,90,0.25); border-radius: 10px; }
        [contentEditable]:empty:before { content: attr(data-placeholder); color: #aaa; }
        [contentEditable] table { border-collapse: collapse; width: 100%; margin: 8px 0; border: 1px solid rgba(0,0,0,0.07); font-size: 12px; }
        [contentEditable] td, [contentEditable] th { border: 1px solid rgba(0,0,0,0.07); padding: 6px 10px; }
        [contentEditable] th { background: #faf8f5; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}