/**
 * @module CourierTracking
 * @description Admin view for managing shipments, shipping partners, and courier vendors.
 *
 * ROLE MODEL
 * ──────────
 * courier (Vendor)
 *   ✓ Add / import their own shipments (fills AWB, partner, status)
 *   ✗ Cannot see other vendors' rows, link orders, or manage partners
 *
 * Marqland employees (admin / sales / accounts / inventory / viewer)
 *   ✓ "Add Shipment" = lightweight dispatch entry: recipient details + assign to courier vendor.
 *       Vendor fills AWB + tracking once they collect the parcel.
 *   ✓ "Import Excel" = bulk dispatch, same lightweight fields + assign vendor.
 *   ✓ Multi-select rows → bulk "Link Order" action.
 *   ✓ Inline single-row order link still works.
 *   ✓ Full edit always available.
 *
 * DESIGN LANGUAGE
 * ───────────────
 * Matches ClientList.js:
 *   · Off-white (#faf8f5) page background, white card surfaces
 *   · Navy (#0e1520) headings · Gold (#b8975a) accents
 *   · Cormorant Garamond serif + Jost sans-serif
 *   · Thin 1-px borders · Uppercase spaced labels
 *   · Style-object-first approach (inline styles) over raw Tailwind chains
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  memo,
} from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import * as XLSX from 'xlsx';
import {
  Truck, Plus, Upload, Search, X, RefreshCw, AlertTriangle,
  Clock, Package, Settings, ExternalLink, CalendarDays,
  Loader2, Check, Trash2, MapPin, Link2, UserCheck, Eye, FileText,
} from 'lucide-react';
import { LocationSelects, COUNTRIES } from '../utils/indiaLocations';
import { usePopup } from '../components/AppPopups';
import { createLogger } from '../utils/logger';


// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const MARQLAND_ROLES = ['admin', 'sales', 'accounts', 'inventory', 'viewer'];

const MANUAL_STATUSES = [
  'Pending',
  'Booked',
  'In Transit',
  'Out for Delivery',
  'Delivered',
  'Returned',
  'Exception',
];

const COMPLETED_STATUSES = ['Delivered', 'Completed', 'Returned'];

/** Delay threshold in days before a shipment is flagged as delayed. */
const DELAY_THRESHOLD_DAYS = 4;

/** Days after completion before a shipment moves to the archive tab. */
const ARCHIVE_THRESHOLD_DAYS = 30;

/** Skeleton shimmer row count while data loads */
const SKELETON_ROW_COUNT = 7;


// ─────────────────────────────────────────────────────────────────────────────
// DESIGN-SYSTEM TOKENS  (mirrors ClientList's T object)
// ─────────────────────────────────────────────────────────────────────────────

const T = {
  // Base palette
  navy:     '#0e1520',
  gold:     '#b8975a',
  gold2:    '#d4b06a',
  offwhite: '#faf8f5',
  white:    '#ffffff',
  text:     '#1a1a1a',
  muted:    '#888888',

  // Borders
  border:   'rgba(0,0,0,0.07)',
  borderG:  'rgba(184,151,90,0.18)',   // gold-tinted border

  // Backgrounds
  dimBg:    'rgba(184,151,90,0.04)',   // subtle gold wash
  rowHover: 'rgba(0,0,0,0.015)',
  navyBg:   '#0b1623',                 // dark card (modals)
  navyBg2:  '#0a1420',                 // slightly darker header

  // Status colours — badge bg / text pairs
  statusPending:    { bg: '#f3f0eb', text: '#7a6a4a' },
  statusBooked:     { bg: '#edf5ed', text: '#4a7a52' },
  statusInTransit:  { bg: '#fdf6ea', text: '#8a6a20' },
  statusOFD:        { bg: '#fef3e2', text: '#9a6810' },
  statusDelivered:  { bg: '#e8f5ee', text: '#2a7a4a' },
  statusReturned:   { bg: '#fdeaea', text: '#8a3030' },
  statusException:  { bg: '#fdeaea', text: '#8a3030' },
};

/** Shared font families */
const jost  = '"Jost", sans-serif';
const serif = '"Cormorant Garamond", Georgia, serif';


// ─────────────────────────────────────────────────────────────────────────────
// LOGGERS — one namespaced instance per component / concern
// ─────────────────────────────────────────────────────────────────────────────

const logPartnerModal  = createLogger('ShippingPartnerModal');
const logShipmentModal = createLogger('ShipmentModal');
const logExcelModal    = createLogger('ExcelImportModal');
const logBulkModal     = createLogger('BulkOrderLinkModal');
const logOrderAssigner = createLogger('OrderAssigner');
const log              = createLogger('CourierTracking');


// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a date to a compact, locale-aware string.
 * @param {string|Date|null} d
 * @returns {string}
 */
const fmt = (d) =>
  d
    ? new Date(d).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: '2-digit',
      })
    : '—';

/**
 * Returns true if a shipment has been in transit for longer than
 * DELAY_THRESHOLD_DAYS without reaching a completed state.
 * @param {object} shipment
 * @returns {boolean}
 */
const isDelayed = (shipment) => {
  if (!shipment || COMPLETED_STATUSES.includes(shipment.status)) return false;
  const origin = shipment.shippedDate || shipment.createdAt;
  return (Date.now() - new Date(origin).getTime()) / 86_400_000 > DELAY_THRESHOLD_DAYS;
};

/**
 * Safely extract a human-readable API error message.
 * @param {unknown} err
 * @returns {string}
 */
const getApiError = (err) =>
  err?.response?.data?.message || err?.message || 'An unexpected error occurred.';

// ─────────────────────────────────────────────────────────────────────────────
// INPUT SANITIZATION
// Defense-in-depth against script / markup injection via free-text fields.
// React already escapes text when it renders (no dangerouslySetInnerHTML is
// used in this file), so a stored "<script>" would not execute as HTML here —
// but these fields are also read by other surfaces (emails, PDFs, other
// admin tools, the backend itself) that may not escape the same way, so we
// still strip markup at the point of entry rather than trust the render path.
// ─────────────────────────────────────────────────────────────────────────────

/** Max length applied to sanitized free-text fields, by field key. */
const FIELD_MAX_LENGTHS = {
  recipientName:    120,
  phone:            24,
  recipientAddress: 300,
  trackingId:       40,
  notes:            500,
  partnerName:      80,
  city:             80,
  state:            80,
};

/**
 * Strips HTML tags, inline event-handler attributes (onerror=, onclick=…),
 * and script/vbscript/data URI schemes out of a plain-text value. None of
 * the fields this is used on (names, addresses, phone, notes, tracking IDs)
 * ever legitimately need to contain markup, so anything tag-like is removed
 * outright rather than escaped. Safe to run on every keystroke and paste.
 * @param {string} value
 * @param {number} [maxLength] optional hard length cap
 * @returns {string}
 */
const sanitizeText = (value, maxLength) => {
  if (typeof value !== 'string' || !value) return value ?? '';
  let clean = value
    // Drop <script>...</script> blocks (and their contents) outright
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    // Strip any other HTML/XML-ish tags
    .replace(/<\/?[a-zA-Z!][^>]*>/g, '')
    // Neutralize any leftover angle brackets so a tag can't be reassembled
    .replace(/[<>]/g, '')
    // Strip dangerous URI schemes that could appear in pasted text
    .replace(/\b(javascript|vbscript|data):/gi, '')
    // Strip inline event-handler attribute patterns (onerror=, onclick=, …)
    .replace(/\bon\w+\s*=/gi, '');
  if (maxLength) clean = clean.slice(0, maxLength);
  return clean;
};

/**
 * Validates a user-supplied URL is safe to use as a link target — http(s)
 * only. Returns '' for javascript:/data:/vbscript: schemes, malformed
 * input, or anything else that isn't a plain web URL.
 * @param {string} value
 * @returns {string}
 */
const sanitizeUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return trimmed;
  } catch {
    // malformed URL — reject
  }
  return '';
};

/**
 * Resolve a status badge's inline style from the T token map.
 * @param {string} status
 * @returns {React.CSSProperties}
 */
const statusBadgeStyle = (status) => {
  const map = {
    Pending:            T.statusPending,
    Booked:             T.statusBooked,
    'In Transit':       T.statusInTransit,
    'Out for Delivery': T.statusOFD,
    Delivered:          T.statusDelivered,
    Completed:          T.statusDelivered,
    Returned:           T.statusReturned,
    Exception:          T.statusException,
  };
  const pair = map[status] || T.statusPending;
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: pair.bg, color: pair.text,
    border: `1px solid ${pair.text}22`,
    borderRadius: 20, padding: '3px 10px',
    fontFamily: jost, fontSize: 10, fontWeight: 700,
    letterSpacing: '0.1em', textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  };
};


// ─────────────────────────────────────────────────────────────────────────────
// SHARED SMALL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

/** Thin gold rule — used as a section divider inside modals */
const GoldRule = () => (
  <div style={{
    height: 1,
    background: `linear-gradient(to right, transparent, ${T.gold}44, transparent)`,
    margin: '4px 0',
  }} />
);

/** Uppercase spaced label — matches ClientList label style */
const Label = ({ children }) => (
  <p style={{
    fontFamily: jost, fontSize: 9, fontWeight: 400,
    letterSpacing: '0.25em', textTransform: 'uppercase',
    color: T.muted, margin: '0 0 6px',
  }}>
    {children}
  </p>
);

/** Label + field wrapper */
const Field = ({ label, children }) => (
  <div>
    <Label>{label}</Label>
    {children}
  </div>
);

/** Animated gold spinner */
const GoldSpinner = ({ size = 14 }) => (
  <Loader2 size={size} style={{ animation: 'spin 1s linear infinite', color: T.gold }} />
);

/** Common input style (dark, for modals that retain the dark shell) */
const darkInput = {
  width: '100%', padding: '8px 12px',
  background: '#0a1018',
  border: `1px solid #2a3a52`,
  borderRadius: 3,
  fontFamily: jost, fontSize: 13, fontWeight: 300,
  color: '#c8d8e8', outline: 'none',
  boxSizing: 'border-box', transition: 'border-color 0.2s',
};

/**
 * Focus-aware dark input — highlights border with gold on focus.
 */
const DarkInput = ({ style: extra = {}, ...props }) => {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...darkInput,
        borderColor: focused ? T.gold : '#2a3a52',
        boxShadow: focused ? `0 0 0 2px ${T.gold}14` : 'none',
        ...extra,
      }}
    />
  );
};

/** Focus-aware dark textarea */
const DarkTextarea = ({ style: extra = {}, ...props }) => {
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      {...props}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...darkInput,
        borderColor: focused ? T.gold : '#2a3a52',
        boxShadow: focused ? `0 0 0 2px ${T.gold}14` : 'none',
        resize: 'none',
        ...extra,
      }}
    />
  );
};

/** Focus-aware dark select */
const DarkSelect = ({ style: extra = {}, children, ...props }) => {
  const [focused, setFocused] = useState(false);
  return (
    <select
      {...props}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...darkInput,
        borderColor: focused ? T.gold : '#2a3a52',
        boxShadow: focused ? `0 0 0 2px ${T.gold}14` : 'none',
        cursor: 'pointer',
        ...extra,
      }}
    >
      {children}
    </select>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ORDER PICKER HELPERS
// Shared across every place an order needs to be searched/linked:
//   · Only "inquiry" and "ongoing" orders are ever linkable — "completed"
//     orders are excluded everywhere except the dedicated Completed tab
//     inside LinkOrderModal / BulkOrderLinkModal.
//   · Ongoing orders always list before inquiries.
// ─────────────────────────────────────────────────────────────────────────────

/** Best-effort extraction of the "order placed by" contact name. */
const getOrderPerson = (o) => o?.personName || o?.contactName || o?.contact || '';

const LINKABLE_STATUS_RANK = { ongoing: 0, inquiry: 1 };

/** Inquiry + ongoing orders only, ongoing first. Never includes completed. */
const getLinkableOrders = (orders = []) =>
  [...orders]
    .filter((o) => o.status === 'inquiry' || o.status === 'ongoing')
    .sort((a, b) => (LINKABLE_STATUS_RANK[a.status] ?? 9) - (LINKABLE_STATUS_RANK[b.status] ?? 9));

/** One year in ms, used to scope the Completed tab to the last year of orders. */
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Orders for a given picker tab: 'inquiry' | 'ongoing' | 'completed'.
 * Completed is scoped to the last 1 year (by completedAt/updatedAt/createdAt).
 */
const getOrdersForTab = (orders = [], tab) => {
  if (tab === 'completed') {
    const cutoff = Date.now() - ONE_YEAR_MS;
    return orders.filter((o) => {
      if (o.status !== 'completed') return false;
      const ts = new Date(o.completedAt || o.updatedAt || o.createdAt || 0).getTime();
      return Number.isFinite(ts) && ts >= cutoff;
    });
  }
  return orders.filter((o) => o.status === tab);
};

/** "<ref/number> - <client> - <order placed by>" row label. */
const formatOrderLabel = (o) => {
  const person = getOrderPerson(o);
  return `${o.refNumber || o._id.slice(-6)} - ${o.clientName || 'Unknown client'}${person ? ` - ${person}` : ''}`;
};

/**
 * Searchable, typeahead order picker — a drop-in replacement for a plain
 * <select> when choosing an order to link. Only lists inquiry/ongoing
 * orders (ongoing first); completed orders are never selectable here.
 */
const OrderSearchSelect = ({
  orders, value, onChange,
  placeholder = '— Link order (assign later) —',
  style: extra = {},
}) => {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setTerm('');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const linkable = getLinkableOrders(orders);
  const filtered = term
    ? linkable.filter((o) => {
        const blob = [o.refNumber, o.clientName, getOrderPerson(o)].filter(Boolean).join(' ').toLowerCase();
        return blob.includes(term.toLowerCase());
      })
    : linkable;

  const selected = orders.find((o) => o._id === value);

  const pick = (id) => {
    onChange(id);
    setOpen(false);
    setTerm('');
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', ...extra }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...darkInput,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', textAlign: 'left',
          borderColor: open ? T.gold : '#2a3a52',
          boxShadow: open ? `0 0 0 2px ${T.gold}14` : 'none',
        }}
      >
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: selected ? '#c8d8e8' : '#4a6080',
        }}>
          {selected ? formatOrderLabel(selected) : placeholder}
        </span>
        <Search size={12} style={{ color: '#4a6080', flexShrink: 0, marginLeft: 8 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: 4,
          background: T.navyBg2, border: `1px solid ${T.gold}44`, borderRadius: 3,
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)', overflow: 'hidden',
        }}>
          <div style={{ padding: 8, borderBottom: '1px solid #1e2d40' }}>
            <input
              autoFocus
              type="text"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search client, order placed by, ref…"
              style={{ ...darkInput, padding: '6px 10px', fontSize: 12 }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            <button
              type="button"
              onClick={() => pick('')}
              style={{
                width: '100%', textAlign: 'left', padding: '8px 12px',
                background: !value ? `${T.gold}0a` : 'none', border: 'none',
                borderBottom: '1px solid #1e2d40', cursor: 'pointer',
                fontFamily: jost, fontSize: 12, fontWeight: 500, color: '#4a6080',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#0d1c2c'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = !value ? `${T.gold}0a` : 'none'; }}
            >
              {placeholder}
            </button>
            {filtered.length === 0 ? (
              <div style={{ padding: '16px 12px', textAlign: 'center' }}>
                <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: '#3d5070', margin: 0 }}>
                  No matching orders
                </p>
              </div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o._id}
                  type="button"
                  onClick={() => pick(o._id)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '8px 12px',
                    background: value === o._id ? `${T.gold}0a` : 'none', border: 'none',
                    borderBottom: '1px solid #1e2d40', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#0d1c2c'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = value === o._id ? `${T.gold}0a` : 'none'; }}
                >
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: o.status === 'ongoing' ? '#6ab07a' : '#6a9abf',
                  }} />
                  <span style={{
                    fontFamily: jost, fontSize: 12, fontWeight: 500, color: '#c8d8e8',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {formatOrderLabel(o)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// SKELETON LOADER — shown while the shipments table is fetching
// ─────────────────────────────────────────────────────────────────────────────

/** Single animated shimmer row */
const SkeletonRow = ({ cols }) => (
  <tr style={{ borderBottom: `1px solid ${T.border}` }}>
    {Array.from({ length: cols }).map((_, i) => (
      <td key={i} style={{ padding: '14px 16px' }}>
        <div style={{
          height: 11, borderRadius: 3,
          background: 'linear-gradient(90deg, #e8e4dc 25%, #f0ece4 50%, #e8e4dc 75%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.4s ease-in-out infinite',
          width: i === 0 ? '60%' : i === cols - 1 ? '40%' : '80%',
        }} />
      </td>
    ))}
    <style>{`
      @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      @keyframes spin { to { transform: rotate(360deg); } }
    `}</style>
  </tr>
);

/**
 * Full-table skeleton — mirrors the real column count.
 * @param {{ isMarqland: boolean }} props
 */
const TableSkeleton = ({ isMarqland }) => {
  // Date | Recipient | Address | Tracking | Status | [Order] | Actions
  const cols = isMarqland ? 7 : 6;
  log.debug('Rendering TableSkeleton', { cols, isMarqland });

  return (
    <div style={{ background: T.white, border: `1px solid ${T.border}`, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${T.border}`, background: T.offwhite }}>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i} style={{ padding: '12px 16px' }}>
                <div style={{
                  height: 8, borderRadius: 2, background: '#e0dbd2', width: 56,
                }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
            <SkeletonRow key={i} cols={cols} />
          ))}
        </tbody>
      </table>
    </div>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// MODAL SHELL — shared wrapper for all modals
// ─────────────────────────────────────────────────────────────────────────────

const ModalShell = ({ onClose, icon: Icon, title, subtitle, maxWidth = 520, children, footer }) => (
  <div style={{
    position: 'fixed', inset: 0, zIndex: 200,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    background: 'rgba(14,21,32,0.80)', backdropFilter: 'blur(6px)',
  }}>
    <div style={{
      width: '100%', maxWidth,
      background: T.navyBg,
      border: `1px solid #2a3a52`,
      borderRadius: 2, boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      display: 'flex', flexDirection: 'column', maxHeight: '92vh', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 24px', borderBottom: '1px solid #1e2d40',
        background: T.navyBg2, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {Icon && <Icon size={14} style={{ color: T.gold }} />}
          <div>
            <p style={{
              fontFamily: jost, fontSize: 9, fontWeight: 400,
              letterSpacing: '0.28em', textTransform: 'uppercase',
              color: `${T.gold}99`, margin: 0,
            }}>{subtitle}</p>
            <h2 style={{
              fontFamily: serif, fontSize: 18, fontWeight: 400,
              color: '#d4c4a0', margin: 0, letterSpacing: '0.06em',
            }}>{title}</h2>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#4a6080', fontSize: 18, lineHeight: 1, padding: 4,
            transition: 'color 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = T.gold}
          onMouseLeave={e => e.currentTarget.style.color = '#4a6080'}
        >✕</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {children}
      </div>

      {/* Footer */}
      {footer && (
        <div style={{
          padding: '16px 24px', borderTop: '1px solid #1e2d40',
          background: T.navyBg2, flexShrink: 0,
          display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center',
        }}>
          {footer}
        </div>
      )}
    </div>
  </div>
);

/** Gold primary action button (dark modals) */
const GoldBtn = ({ children, disabled, onClick, style: extra = {} }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '10px 24px',
      background: disabled ? `${T.gold}33` : `${T.gold}1a`,
      border: `1px solid ${disabled ? `${T.gold}33` : `${T.gold}99`}`,
      borderRadius: 2, cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: jost, fontSize: 10, fontWeight: 600,
      letterSpacing: '0.18em', textTransform: 'uppercase',
      color: disabled ? `${T.gold}55` : T.gold,
      transition: 'background 0.2s, border-color 0.2s',
      ...extra,
    }}
    onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = `${T.gold}30`; }}
    onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = `${T.gold}1a`; }}
  >
    {children}
  </button>
);

/** Ghost cancel button (dark modals) */
const CancelBtn = ({ children = 'Cancel', onClick }) => (
  <button
    onClick={onClick}
    style={{
      background: 'none', border: 'none', cursor: 'pointer',
      fontFamily: jost, fontSize: 10, fontWeight: 400,
      letterSpacing: '0.2em', textTransform: 'uppercase',
      color: '#4a6080', padding: '10px 16px', transition: 'color 0.2s',
    }}
    onMouseEnter={e => e.currentTarget.style.color = '#8fa3c0'}
    onMouseLeave={e => e.currentTarget.style.color = '#4a6080'}
  >
    {children}
  </button>
);


// ─────────────────────────────────────────────────────────────────────────────
// SHIPPING PARTNER MANAGER MODAL
// ─────────────────────────────────────────────────────────────────────────────

const ShippingPartnerModal = ({ onClose, partners, onSaved, showToast, confirm }) => {
  const [list, setList]     = useState(partners);
  const [form, setForm]     = useState({ name: '', trackingUrl: '' });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const resetForm = () => {
    setEditId(null);
    setForm({ name: '', trackingUrl: '' });
    logPartnerModal.debug('Form reset');
  };

  const save = async () => {
    if (!form.name.trim()) {
      logPartnerModal.warn('Save attempted with empty name');
      return;
    }
    // Reject anything that isn't a plain http(s) URL — blocks javascript:/data:/vbscript: payloads
    if (form.trackingUrl.trim() && !sanitizeUrl(form.trackingUrl)) {
      logPartnerModal.warn('Save blocked: unsafe or malformed tracking URL', { trackingUrl: form.trackingUrl });
      showToast('error', 'Tracking URL must be a valid http:// or https:// link');
      return;
    }
    setSaving(true);
    logPartnerModal.info(editId ? 'Updating partner' : 'Creating partner', { editId, name: form.name });
    try {
      if (editId) {
        const res = await api.put(`/shipping-partners/${editId}`, form);
        setList((prev) => prev.map((p) => (p._id === editId ? res.data : p)));
        logPartnerModal.info('Partner updated', { id: editId });
      } else {
        const res = await api.post('/shipping-partners', form);
        setList((prev) => [...prev, res.data]);
        logPartnerModal.info('Partner created', { id: res.data._id });
      }
      resetForm();
      onSaved();
      showToast('success', editId ? 'Partner updated' : 'Partner added');
    } catch (err) {
      logPartnerModal.error('Save failed', err);
      showToast('error', getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Delete Partner',
      message: 'This shipping partner will be removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;

    logPartnerModal.info('Deleting partner', { id });
    try {
      await api.delete(`/shipping-partners/${id}`);
      setList((prev) => prev.filter((p) => p._id !== id));
      onSaved();
      showToast('success', 'Partner deleted');
      logPartnerModal.info('Partner deleted', { id });
    } catch (err) {
      logPartnerModal.error('Delete failed', err);
      showToast('error', getApiError(err));
    }
  };

  return (
    <ModalShell
      onClose={onClose}
      icon={Settings}
      subtitle="Configuration"
      title="Shipping Partners"
      maxWidth={480}
      footer={
        <>
          {editId && <CancelBtn onClick={resetForm} children="Discard" />}
          <GoldBtn onClick={save} disabled={saving || !form.name.trim()}>
            {saving && <GoldSpinner size={11} />}
            {editId ? 'Update Partner' : 'Add Partner'}
          </GoldBtn>
        </>
      }
    >
      <div style={{ padding: '16px 24px 0' }}>
        {/* Info banner */}
        <div style={{
          padding: '10px 14px', marginBottom: 16,
          background: '#1a2a1e', border: '1px solid #2a4a32', borderRadius: 2,
          fontFamily: jost, fontSize: 11, color: '#7aaa88', lineHeight: 1.5,
        }}>
          Tracking via <strong style={{ color: '#9acc9a' }}>trackcourier.io</strong>.
          Add a partner name and their public tracking URL.
        </div>
      </div>

      {/* Partner list */}
      <div style={{
        maxHeight: 220, overflowY: 'auto',
        padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {list.length === 0 && (
          <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: '#3d5070', textAlign: 'center', padding: '24px 0' }}>
            No partners yet.
          </p>
        )}
        {list.map((partner) => (
          <div key={partner._id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px', background: T.navyBg2, border: '1px solid #1e2d40', borderRadius: 2,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontFamily: jost, fontSize: 13, fontWeight: 500, color: '#c8d8e8', margin: 0 }}>
                {partner.name}
              </p>
              {sanitizeUrl(partner.trackingUrl)
                ? (
                  <a
                    href={sanitizeUrl(partner.trackingUrl)} target="_blank" rel="noopener noreferrer"
                    style={{
                      fontFamily: jost, fontSize: 10, color: `${T.gold}99`,
                      display: 'flex', alignItems: 'center', gap: 3,
                      textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      marginTop: 2, transition: 'color 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = T.gold}
                    onMouseLeave={e => e.currentTarget.style.color = `${T.gold}99`}
                  >
                    <ExternalLink size={9} /> {partner.trackingUrl}
                  </a>
                )
                : <span style={{ fontFamily: jost, fontSize: 10, color: '#3d5070' }}>No tracking URL</span>
              }
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button
                onClick={() => {
                  setEditId(partner._id);
                  setForm({ name: partner.name, trackingUrl: partner.trackingUrl || '' });
                  logPartnerModal.debug('Edit mode activated', { id: partner._id });
                }}
                style={{
                  background: 'none', border: `1px solid #2a3a52`, borderRadius: 2,
                  cursor: 'pointer', padding: '4px 10px',
                  fontFamily: jost, fontSize: 9, fontWeight: 400,
                  letterSpacing: '0.2em', textTransform: 'uppercase',
                  color: '#8fa3c0', transition: 'border-color 0.2s, color 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = T.gold; e.currentTarget.style.color = T.gold; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a3a52'; e.currentTarget.style.color = '#8fa3c0'; }}
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(partner._id)}
                aria-label={`Delete ${partner.name}`}
                style={{
                  background: 'none', border: '1px solid #3a1818', borderRadius: 2,
                  cursor: 'pointer', padding: '4px 8px',
                  color: '#c97070', transition: 'background 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#2a1010'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <GoldRule />

      {/* Add / Edit form */}
      <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{
          fontFamily: jost, fontSize: 9, fontWeight: 400,
          letterSpacing: '0.28em', textTransform: 'uppercase',
          color: `${T.gold}66`, margin: 0,
        }}>
          {editId ? 'Edit' : 'Add'} Partner
        </p>
        <Field label="Name *">
          <DarkInput
            value={form.name}
            onChange={(e) => setField('name', sanitizeText(e.target.value, FIELD_MAX_LENGTHS.partnerName))}
            placeholder="e.g. Blue Dart, DTDC"
            maxLength={FIELD_MAX_LENGTHS.partnerName}
          />
        </Field>
        <Field label="Public Tracking URL (optional)">
          <DarkInput
            value={form.trackingUrl}
            onChange={(e) => setField('trackingUrl', e.target.value.replace(/[<>]/g, ''))}
            placeholder="https://..."
          />
        </Field>
      </div>
    </ModalShell>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// ADD / EDIT SHIPMENT MODAL
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_SHIPMENT_FORM = (shipment, showOrderLink) => ({
  shippedDate:        shipment?.shippedDate ? shipment.shippedDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
  recipientName:      shipment?.recipientName    || '',
  recipientAddress:   shipment?.recipientAddress || '',
  country:            shipment?.country          || 'India',
  city:               shipment?.city             || '',
  state:              shipment?.state            || '',
  phone:              shipment?.phone            || '',
  trackingId:         shipment?.trackingId       || '',
  shippingPartner:    shipment?.shippingPartner  || '',
  status:             shipment?.status           || 'Pending',
  orderId:            shipment?.orderId          || '',
  // Unlinked defaults to "Link order" (not Ad-hoc) — ad-hoc is only ever
  // set via an explicit "Mark as Ad-hoc" action elsewhere.
  isAdhoc:            showOrderLink ? (shipment?.isAdhoc ?? false) : true,
  notes:              shipment?.notes            || '',
  assignedVendorId:   shipment?.vendorId         || '',
  assignedVendorName: shipment?.vendorName       || '',
});

const ShipmentModal = ({ shipment, orders, partners, vendors, showOrderLink, onSave, onClose, showToast }) => {
  const isEdit = !!shipment?._id;
  const [form, setForm]     = useState(() => EMPTY_SHIPMENT_FORM(shipment, showOrderLink));
  const [saving, setSaving] = useState(false);

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const validate = () => {
    if (!form.recipientName.trim()) {
      logShipmentModal.warn('Validation failed: missing recipient name');
      showToast('error', 'Recipient name is required');
      return false;
    }
    if (!form.shippedDate) {
      logShipmentModal.warn('Validation failed: missing shipped date');
      showToast('error', 'Shipped date is required');
      return false;
    }
    return true;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    logShipmentModal.info(isEdit ? 'Updating shipment' : 'Creating shipment', { id: shipment?._id });
    try {
      await onSave({
        ...form,
        orderId:    form.orderId            || null,
        vendorId:   form.assignedVendorId   || null,
        vendorName: form.assignedVendorName || '',
      });
      logShipmentModal.info(isEdit ? 'Shipment update submitted' : 'Shipment creation submitted');
    } finally {
      setSaving(false);
    }
  };

  const sectionLabel = (text) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 14px' }}>
      <p style={{
        fontFamily: jost, fontSize: 9, fontWeight: 400,
        letterSpacing: '0.28em', textTransform: 'uppercase',
        color: `${T.gold}66`, margin: 0, whiteSpace: 'nowrap',
      }}>{text}</p>
      <div style={{ flex: 1, height: 1, background: `${T.gold}22` }} />
    </div>
  );

  return (
    <ModalShell
      onClose={onClose}
      icon={Package}
      subtitle={isEdit ? 'Update Record' : 'New Entry'}
      title={isEdit ? 'Edit Shipment' : 'Add Shipment'}
      maxWidth={600}
      footer={
        <>
          <CancelBtn onClick={onClose} />
          <GoldBtn onClick={submit} disabled={saving}>
            {saving && <GoldSpinner size={11} />}
            {isEdit ? 'Update' : 'Save Shipment'}
          </GoldBtn>
        </>
      }
    >
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Context banner — Marqland only */}
        {showOrderLink && !isEdit && (
          <div style={{
            padding: '10px 14px',
            background: '#1a2a1e', border: '1px solid #2a4a32', borderRadius: 2,
            fontFamily: jost, fontSize: 11, color: '#7aaa88', lineHeight: 1.5,
          }}>
            <strong style={{ color: '#9acc9a' }}>Dispatching a parcel?</strong>{' '}
            Fill recipient details and assign to a courier vendor.
            The vendor will add AWB and tracking info once they collect the parcel.
          </div>
        )}

        {/* Date + Order */}
        <div style={{ display: 'grid', gridTemplateColumns: showOrderLink ? '1fr 1fr' : '1fr', gap: 16 }}>
          <Field label="Shipped Date *">
            <DarkInput
              type="date"
              value={form.shippedDate}
              onChange={(e) => setField('shippedDate', e.target.value)}
            />
          </Field>
          {showOrderLink && (
            <Field label="Linked Order (optional)">
              <OrderSearchSelect
                orders={orders}
                value={form.orderId}
                onChange={(id) => {
                  setField('orderId', id);
                  // Leaving it unlinked just means "not linked yet" — it
                  // still shows as "Link order", never auto-marked Ad-hoc.
                  setField('isAdhoc', false);
                }}
              />
            </Field>
          )}
        </div>

        {/* Recipient */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Recipient Name *">
            <DarkInput
              value={form.recipientName}
              onChange={(e) => setField('recipientName', sanitizeText(e.target.value, FIELD_MAX_LENGTHS.recipientName))}
              placeholder="Full name"
              maxLength={FIELD_MAX_LENGTHS.recipientName}
            />
          </Field>
          <Field label="Phone">
            <DarkInput
              value={form.phone}
              onChange={(e) => setField('phone', sanitizeText(e.target.value, FIELD_MAX_LENGTHS.phone))}
              placeholder="Mobile number"
              maxLength={FIELD_MAX_LENGTHS.phone}
            />
          </Field>
        </div>

        <Field label="Delivery Address">
          <DarkTextarea
            value={form.recipientAddress}
            onChange={(e) => setField('recipientAddress', sanitizeText(e.target.value, FIELD_MAX_LENGTHS.recipientAddress))}
            rows={2}
            placeholder="Full delivery address"
            maxLength={FIELD_MAX_LENGTHS.recipientAddress}
          />
        </Field>

        <LocationSelects
          country={form.country}  onCountryChange={(v) => setField('country', v)}
          state={form.state}      onStateChange={(v) => setField('state', v)}
          city={form.city}        onCityChange={(v) => setField('city', v)}
          showCountry
        />

        {/* Courier vendor — Marqland only */}
        {showOrderLink && vendors.length > 0 && (
          <Field label="Assign to Courier Vendor">
            <DarkSelect
              value={form.assignedVendorId}
              onChange={(e) => {
                const vendor = vendors.find((v) => v._id === e.target.value);
                setField('assignedVendorId',   e.target.value);
                setField('assignedVendorName', vendor?.name || vendor?.email || '');
                logShipmentModal.debug('Vendor assigned', { vendorId: e.target.value });
              }}
            >
              <option value="">— Unassigned (to be determined) —</option>
              {vendors.map((v) => (
                <option key={v._id} value={v._id}>{v.name || v.email}</option>
              ))}
            </DarkSelect>
            <p style={{ fontFamily: jost, fontSize: 10, color: '#3d5070', margin: '4px 0 0' }}>
              Assigned vendor will see this shipment and fill AWB + tracking details.
            </p>
          </Field>
        )}

        {/* Courier details section */}
        {sectionLabel(showOrderLink ? 'Courier Details — vendor fills after collection' : 'Courier Details')}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Tracking / AWB">
            <DarkInput
              value={form.trackingId}
              onChange={(e) => setField('trackingId', sanitizeText(e.target.value, FIELD_MAX_LENGTHS.trackingId))}
              placeholder="AWB / Tracking number"
              style={{ fontFamily: 'monospace' }}
              maxLength={FIELD_MAX_LENGTHS.trackingId}
            />
          </Field>
          <Field label="Shipping Partner">
            <DarkSelect
              value={form.shippingPartner}
              onChange={(e) => setField('shippingPartner', e.target.value)}
            >
              <option value="">— Select Partner —</option>
              {partners.map((p) => <option key={p._id} value={p.name}>{p.name}</option>)}
            </DarkSelect>
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Status">
            <DarkSelect
              value={form.status}
              onChange={(e) => setField('status', e.target.value)}
            >
              {MANUAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </DarkSelect>
          </Field>
          <Field label="Notes">
            <DarkInput
              value={form.notes}
              onChange={(e) => setField('notes', sanitizeText(e.target.value, FIELD_MAX_LENGTHS.notes))}
              placeholder="Optional note"
              maxLength={FIELD_MAX_LENGTHS.notes}
            />
          </Field>
        </div>

      </div>
    </ModalShell>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// EXCEL IMPORT MODAL
// ─────────────────────────────────────────────────────────────────────────────

const EXCEL_COLUMN_KEYWORDS = {
  name:    ['name'],
  address: ['address'],
  city:    ['location', 'city'],
  state:   ['state'],
  phone:   ['contact', 'phone'],
};

/** Map a header array to column indexes for known fields. */
const buildColumnIndexMap = (headers) => {
  const idx = (keywords) =>
    headers.findIndex((h) => keywords.some((k) => h.includes(k)));
  return {
    nameIdx:  idx(EXCEL_COLUMN_KEYWORDS.name),
    addrIdx:  idx(EXCEL_COLUMN_KEYWORDS.address),
    cityIdx:  idx(EXCEL_COLUMN_KEYWORDS.city),
    stateIdx: idx(EXCEL_COLUMN_KEYWORDS.state),
    phoneIdx: idx(EXCEL_COLUMN_KEYWORDS.phone),
  };
};

const ExcelImportModal = ({ orders, partners, vendors, showOrderLink, onImported, onClose }) => {
  const [rows, setRows]                         = useState([]);
  const [saving, setSaving]                     = useState(false);
  const [error, setError]                       = useState('');
  const [linkedOrderId, setLinkedOrderId]       = useState('');
  const [assignedVendorId, setAssignedVendorId] = useState('');
  const fileRef = useRef(null);

  const parseExcel = (file) => {
    setError('');
    logExcelModal.info('Parsing Excel file', { name: file.name, size: file.size });

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb  = XLSX.read(e.target.result, { type: 'array' });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        let headerIdx = 0;
        for (let i = 0; i < Math.min(raw.length, 5); i++) {
          if (raw[i].map((c) => String(c).toLowerCase()).some((c) => c.includes('name') || c.includes('contact'))) {
            headerIdx = i;
            break;
          }
        }

        const headers  = raw[headerIdx].map((h) => String(h).trim().toLowerCase());
        const dataRows = raw.slice(headerIdx + 1).filter((r) => r.some((c) => c !== ''));
        const colMap   = buildColumnIndexMap(headers);
        const vendor   = vendors.find((v) => v._id === assignedVendorId);

        const parsed = dataRows
          .map((r) => ({
            shippedDate:      new Date().toISOString().slice(0, 10),
            recipientName:    colMap.nameIdx  >= 0 ? sanitizeText(String(r[colMap.nameIdx]  || '').trim(), FIELD_MAX_LENGTHS.recipientName)    : '',
            recipientAddress: colMap.addrIdx  >= 0 ? sanitizeText(String(r[colMap.addrIdx]  || '').trim(), FIELD_MAX_LENGTHS.recipientAddress) : '',
            city:             colMap.cityIdx  >= 0 ? sanitizeText(String(r[colMap.cityIdx]  || '').trim(), FIELD_MAX_LENGTHS.city)             : '',
            state:            colMap.stateIdx >= 0 ? sanitizeText(String(r[colMap.stateIdx] || '').trim(), FIELD_MAX_LENGTHS.state)            : '',
            country:          'India',
            phone:            colMap.phoneIdx >= 0 ? sanitizeText(String(r[colMap.phoneIdx] || '').trim(), FIELD_MAX_LENGTHS.phone)             : '',
            trackingId:       '',
            shippingPartner:  '',
            status:           'Pending',
            notes:            '',
            orderId:          linkedOrderId    || null,
            // Not yet linked ≠ ad-hoc; unlinked rows show "Link order" until
            // someone explicitly marks them ad-hoc.
            isAdhoc:          false,
            vendorId:         assignedVendorId || null,
            vendorName:       vendor ? (vendor.name || vendor.email) : '',
          }))
          .filter((r) => r.recipientName);

        logExcelModal.info('Excel parsed', { total: dataRows.length, valid: parsed.length });
        setRows(parsed);
      } catch (err) {
        logExcelModal.error('Parse failed', err);
        setError('Could not parse Excel: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const updateRow = (idx, key, val) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: val } : r)));

  const applyVendorToAll = (vendorId) => {
    const vendor = vendors.find((v) => v._id === vendorId);
    setAssignedVendorId(vendorId);
    logExcelModal.debug('Applying vendor to all rows', { vendorId, rowCount: rows.length });
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        vendorId:   vendorId || null,
        vendorName: vendor ? (vendor.name || vendor.email) : '',
      }))
    );
  };

  const saveAll = async () => {
    if (!rows.length) return;
    setSaving(true);
    logExcelModal.info('Bulk saving shipments', { count: rows.length });
    try {
      await api.post('/shipments/bulk', {
        shipments: rows.map((r) => ({ ...r, orderId: r.orderId || null })),
      });
      logExcelModal.info('Bulk save succeeded');
      onImported();
    } catch (err) {
      logExcelModal.error('Bulk save failed', err);
      setError(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const cellInput = {
    border: '1px solid #1e2d40', borderRadius: 2, padding: '5px 8px',
    fontSize: 12, outline: 'none', background: '#0a1018',
    color: '#c8d8e8', fontFamily: jost, transition: 'border-color 0.15s',
    width: '100%', boxSizing: 'border-box',
  };

  return (
    <ModalShell
      onClose={onClose}
      icon={Upload}
      subtitle="Bulk Dispatch"
      title="Import Shipments from Excel"
      maxWidth={1100}
      footer={
        <>
          <CancelBtn onClick={onClose} />
          <GoldBtn onClick={saveAll} disabled={saving || !rows.length}>
            {saving && <GoldSpinner size={11} />}
            Save {rows.length} Shipment{rows.length !== 1 ? 's' : ''}
          </GoldBtn>
        </>
      }
    >
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        padding: '12px 24px', borderBottom: '1px solid #1e2d40', background: T.navyBg2,
      }}>
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 18px',
          background: `${T.gold}1a`, border: `1px solid ${T.gold}99`,
          borderRadius: 2, cursor: 'pointer',
          fontFamily: jost, fontSize: 10, fontWeight: 600,
          letterSpacing: '0.18em', textTransform: 'uppercase', color: T.gold,
          transition: 'background 0.2s',
        }}
          onMouseEnter={e => e.currentTarget.style.background = `${T.gold}30`}
          onMouseLeave={e => e.currentTarget.style.background = `${T.gold}1a`}
        >
          <Upload size={12} /> Choose File
          <input
            ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files[0]) parseExcel(e.target.files[0]); }}
          />
        </label>

        {rows.length > 0 && (
          <span style={{ fontFamily: jost, fontSize: 11, fontWeight: 600, color: T.gold }}>
            {rows.length} rows loaded
          </span>
        )}

        {showOrderLink && vendors.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserCheck size={13} style={{ color: '#4a6080' }} />
            <span style={{
              fontFamily: jost, fontSize: 9, fontWeight: 400,
              letterSpacing: '0.2em', textTransform: 'uppercase', color: `${T.gold}66`,
            }}>Assign all to:</span>
            <DarkSelect
              value={assignedVendorId}
              onChange={(e) => applyVendorToAll(e.target.value)}
              style={{ minWidth: 160, padding: '6px 10px' }}
            >
              <option value="">— Vendor unassigned —</option>
              {vendors.map((v) => <option key={v._id} value={v._id}>{v.name || v.email}</option>)}
            </DarkSelect>
          </div>
        )}

        {showOrderLink && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link2 size={13} style={{ color: '#4a6080' }} />
            <span style={{
              fontFamily: jost, fontSize: 9, fontWeight: 400,
              letterSpacing: '0.2em', textTransform: 'uppercase', color: `${T.gold}66`,
            }}>Link all to:</span>
            <OrderSearchSelect
              orders={orders}
              value={linkedOrderId}
              onChange={(id) => {
                setLinkedOrderId(id);
                setRows((prev) => prev.map((row) => ({ ...row, orderId: id || null, isAdhoc: false })));
                logExcelModal.debug('Linked order applied to all rows', { orderId: id });
              }}
              style={{ minWidth: 260 }}
            />
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          margin: '12px 24px 0', padding: '10px 14px',
          background: '#2a1010', border: '1px solid #5a2020', borderRadius: 2,
          fontFamily: jost, fontSize: 12, fontWeight: 600, color: '#c97070',
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Preview table */}
      {rows.length > 0 ? (
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px' }}>
            <thead>
              <tr>
                {(showOrderLink
                  ? ['Date', 'Recipient', 'Address', 'Country', 'City', 'State', 'Phone', 'Vendor', 'AWB', 'Partner', 'Status', '']
                  : ['Date', 'Recipient', 'Address', 'Country', 'City', 'State', 'Phone', 'AWB', 'Partner', 'Status', '']
                ).map((h) => (
                  <th key={h} style={{
                    padding: '4px 8px', textAlign: 'left', whiteSpace: 'nowrap',
                    fontFamily: jost, fontSize: 9, fontWeight: 400,
                    letterSpacing: '0.2em', textTransform: 'uppercase', color: `${T.gold}66`,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ background: T.navyBg2 }}>
                  {[
                    <input type="date" value={r.shippedDate} onChange={(e) => updateRow(i, 'shippedDate', e.target.value)} style={{ ...cellInput, width: 130 }} />,
                    <input value={r.recipientName} onChange={(e) => updateRow(i, 'recipientName', sanitizeText(e.target.value, FIELD_MAX_LENGTHS.recipientName))} maxLength={FIELD_MAX_LENGTHS.recipientName} style={{ ...cellInput, width: 130 }} />,
                    <input value={r.recipientAddress} onChange={(e) => updateRow(i, 'recipientAddress', sanitizeText(e.target.value, FIELD_MAX_LENGTHS.recipientAddress))} maxLength={FIELD_MAX_LENGTHS.recipientAddress} style={{ ...cellInput, width: 150 }} />,
                    <select value={r.country} onChange={(e) => updateRow(i, 'country', e.target.value)} style={{ ...cellInput, width: 100, cursor: 'pointer' }}>
                      {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>,
                    <input value={r.city} onChange={(e) => updateRow(i, 'city', sanitizeText(e.target.value, FIELD_MAX_LENGTHS.city))} maxLength={FIELD_MAX_LENGTHS.city} style={{ ...cellInput, width: 100 }} />,
                    <input value={r.state} onChange={(e) => updateRow(i, 'state', sanitizeText(e.target.value, FIELD_MAX_LENGTHS.state))} maxLength={FIELD_MAX_LENGTHS.state} style={{ ...cellInput, width: 100 }} />,
                    <input value={r.phone} onChange={(e) => updateRow(i, 'phone', sanitizeText(e.target.value, FIELD_MAX_LENGTHS.phone))} maxLength={FIELD_MAX_LENGTHS.phone} style={{ ...cellInput, width: 115 }} />,
                    ...(showOrderLink ? [
                      <select value={r.vendorId || ''} onChange={(e) => { const v = vendors.find((v) => v._id === e.target.value); updateRow(i, 'vendorId', e.target.value || null); updateRow(i, 'vendorName', v ? (v.name || v.email) : ''); }} style={{ ...cellInput, width: 130, cursor: 'pointer' }}>
                        <option value="">— unassigned —</option>
                        {vendors.map((v) => <option key={v._id} value={v._id}>{v.name || v.email}</option>)}
                      </select>,
                    ] : []),
                    <input value={r.trackingId} onChange={(e) => updateRow(i, 'trackingId', sanitizeText(e.target.value, FIELD_MAX_LENGTHS.trackingId))} maxLength={FIELD_MAX_LENGTHS.trackingId} placeholder="AWB #" style={{ ...cellInput, width: 115, fontFamily: 'monospace' }} />,
                    <select value={r.shippingPartner} onChange={(e) => updateRow(i, 'shippingPartner', e.target.value)} style={{ ...cellInput, width: 115, cursor: 'pointer' }}>
                      <option value="">— Select —</option>
                      {partners.map((p) => <option key={p._id} value={p.name}>{p.name}</option>)}
                    </select>,
                    <select value={r.status} onChange={(e) => updateRow(i, 'status', e.target.value)} style={{ ...cellInput, width: 130, cursor: 'pointer' }}>
                      {MANUAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>,
                  ].map((cell, ci) => (
                    <td key={ci} style={{ padding: '2px 4px' }}>{cell}</td>
                  ))}
                  <td style={{ padding: '2px 4px' }}>
                    <button
                      onClick={() => { logExcelModal.debug('Row removed', { index: i }); setRows((prev) => prev.filter((_, j) => j !== i)); }}
                      aria-label="Remove row"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4a6080', padding: 4, transition: 'color 0.2s' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#c97070'}
                      onMouseLeave={e => e.currentTarget.style.color = '#4a6080'}
                    >
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '64px 0', color: '#3d5070',
        }}>
          <Upload size={36} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p style={{ fontFamily: jost, fontSize: 13, fontWeight: 400, color: '#4a6080', margin: '0 0 4px' }}>
            Upload an Excel file to preview rows
          </p>
          <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: '#3d5070', margin: 0 }}>
            Columns auto-detected: Name, Address, Location/City, State, Contact/Phone
          </p>
        </div>
      )}
    </ModalShell>
  );
};


/**
 * Tab bar for order-picker modals — Inquiries / Ongoing / Completed
 * (Completed is scoped to the last 1 year via getOrdersForTab).
 */
const ORDER_PICKER_TABS = [
  { key: 'inquiry',   label: 'Inquiries' },
  { key: 'ongoing',   label: 'Ongoing' },
  { key: 'completed', label: 'Completed' },
];

const OrderPickerTabs = ({ tab, onChange, counts = {} }) => (
  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
    {ORDER_PICKER_TABS.map((t) => {
      const isActive = tab === t.key;
      return (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 3,
            border: `1px solid ${isActive ? `${T.gold}66` : '#1e2d40'}`,
            background: isActive ? `${T.gold}14` : 'transparent',
            cursor: 'pointer',
            fontFamily: jost, fontSize: 9, fontWeight: isActive ? 600 : 400,
            letterSpacing: '0.15em', textTransform: 'uppercase',
            color: isActive ? T.gold : '#4a6080',
            transition: 'all 0.2s',
          }}
        >
          {t.label}
          {typeof counts[t.key] === 'number' && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
              background: isActive ? `${T.gold}22` : '#0a1018',
              color: isActive ? T.gold : '#4a6080',
              border: `1px solid ${isActive ? `${T.gold}33` : '#1e2d40'}`,
            }}>{counts[t.key]}</span>
          )}
        </button>
      );
    })}
  </div>
);


// ─────────────────────────────────────────────────────────────────────────────
// BULK ORDER LINK MODAL
// ─────────────────────────────────────────────────────────────────────────────

const BulkOrderLinkModal = ({ selectedIds, orders, onDone, onClose, showToast }) => {
  const [orderId, setOrderId]           = useState('');
  const [tab, setTab]                   = useState('ongoing');
  const [search, setSearch]             = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterPerson, setFilterPerson] = useState('');
  const [saving, setSaving]             = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  // Orders scoped to the active tab (Inquiries / Ongoing / Completed-last-year)
  const tabOrders = getOrdersForTab(orders, tab);

  const tabCounts = {
    inquiry:   getOrdersForTab(orders, 'inquiry').length,
    ongoing:   getOrdersForTab(orders, 'ongoing').length,
    completed: getOrdersForTab(orders, 'completed').length,
  };

  // Client selected → every person linked to that client (within this tab) shows up here.
  const clientNames = [...new Set(tabOrders.map((o) => o.clientName).filter(Boolean))].sort();
  const personNames = [...new Set(
    tabOrders
      .filter((o) => !filterClient || o.clientName === filterClient)
      .map((o) => getOrderPerson(o))
      .filter(Boolean)
  )].sort();

  const filtered = tabOrders.filter((o) => {
    if (filterClient && o.clientName !== filterClient) return false;
    const person = getOrderPerson(o);
    if (filterPerson && person !== filterPerson) return false;
    if (search) {
      const term = search.toLowerCase();
      const blob = [o.refNumber, o.clientName, person, o.title].join(' ').toLowerCase();
      if (!blob.includes(term)) return false;
    }
    return true;
  });

  const switchTab = (nextTab) => {
    setTab(nextTab);
    setFilterClient('');
    setFilterPerson('');
  };

  const apply = async () => {
    setSaving(true);
    logBulkModal.info('Linking order to shipments', { orderId, count: selectedIds.length });
    try {
      const order = orders.find((o) => o._id === orderId);
      await Promise.all(
        selectedIds.map((id) =>
          api.put(`/shipments/${id}`, {
            orderId:  orderId || null,
            orderRef: order?.refNumber || '',
            isAdhoc:  !orderId,
          })
        )
      );
      showToast('success', `${selectedIds.length} shipment${selectedIds.length !== 1 ? 's' : ''} linked`);
      logBulkModal.info('Bulk link succeeded', { count: selectedIds.length });
      onDone();
    } catch (err) {
      logBulkModal.error('Bulk link failed', err);
      showToast('error', getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const statusBadge = (status) => {
    const map = {
      inquiry:   { bg: '#1a2a3e', color: '#6a9abf', label: 'Inquiry' },
      ongoing:   { bg: '#1a2e1a', color: '#6ab07a', label: 'Ongoing' },
      completed: { bg: '#2a2a2a', color: '#9a9a9a', label: 'Completed' },
    };
    const s = map[status] || map.inquiry;
    return (
      <span style={{
        fontFamily: jost, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
        textTransform: 'uppercase', background: s.bg, color: s.color,
        border: `1px solid ${s.color}44`, borderRadius: 10, padding: '2px 8px',
      }}>{s.label}</span>
    );
  };

  return (
    <ModalShell
      onClose={onClose}
      icon={Link2}
      subtitle="Bulk Action"
      title="Link Order"
      maxWidth={600}
      footer={
        <>
          <CancelBtn onClick={onClose} />
          <GoldBtn onClick={apply} disabled={saving || !orderId}>
            {saving && <GoldSpinner size={11} />}
            Apply to {selectedIds.length} row{selectedIds.length !== 1 ? 's' : ''}
          </GoldBtn>
        </>
      }
    >
      <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: '#4a6080', margin: 0 }}>
          Linking{' '}
          <strong style={{ color: '#c8d8e8', fontWeight: 600 }}>{selectedIds.length}</strong>{' '}
          selected shipment{selectedIds.length !== 1 ? 's' : ''} to an order.
        </p>

        {/* Inquiries / Ongoing / Completed tabs */}
        <OrderPickerTabs tab={tab} onChange={switchTab} counts={tabCounts} />

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
            <Search size={12} style={{
              position: 'absolute', left: 10, top: '50%',
              transform: 'translateY(-50%)', color: '#4a6080', pointerEvents: 'none',
            }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search orders…"
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              style={{
                ...darkInput, paddingLeft: 30,
                borderColor: searchFocused ? T.gold : '#2a3a52',
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#4a6080', padding: 0, display: 'flex' }}>
                <X size={12} />
              </button>
            )}
          </div>
          <DarkSelect value={filterClient} onChange={(e) => { setFilterClient(e.target.value); setFilterPerson(''); }} style={{ minWidth: 140 }}>
            <option value="">All Clients</option>
            {clientNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </DarkSelect>
          <DarkSelect value={filterPerson} onChange={(e) => setFilterPerson(e.target.value)} style={{ minWidth: 140 }}>
            <option value="">All Persons</option>
            {personNames.map((p) => <option key={p} value={p}>{p}</option>)}
          </DarkSelect>
        </div>

        <p style={{ fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', color: `${T.gold}66`, margin: 0 }}>
          {filtered.length} order{filtered.length !== 1 ? 's' : ''} · {tab === 'completed' ? 'completed, last 1 year' : tab}
        </p>
      </div>

      {/* Order list */}
      <div style={{ maxHeight: 280, overflowY: 'auto', borderTop: '1px solid #1e2d40' }}>
        {/* Ad-hoc option */}
        <button
          onClick={() => setOrderId('')}
          style={{
            width: '100%', textAlign: 'left', padding: '10px 24px',
            background: orderId === '' ? `${T.gold}0a` : 'none',
            border: 'none', borderBottom: '1px solid #1e2d40',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#0d1c2c'; }}
          onMouseLeave={e => { e.currentTarget.style.background = orderId === '' ? `${T.gold}0a` : 'none'; }}
        >
          {orderId === '' && <Check size={12} style={{ color: T.gold, flexShrink: 0 }} />}
          <span style={{ fontFamily: jost, fontSize: 11, fontWeight: 600, color: '#4a6080', marginLeft: orderId === '' ? 0 : 22 }}>
            — Mark as Ad-hoc (no order)
          </span>
        </button>

        {filtered.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center' }}>
            <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: '#3d5070', margin: 0 }}>No matching orders</p>
          </div>
        ) : (
          filtered.map((o) => {
            const person = getOrderPerson(o);
            const isSelected = orderId === o._id;
            return (
              <button
                key={o._id}
                onClick={() => setOrderId(o._id)}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 24px',
                  background: isSelected ? `${T.gold}0a` : 'none',
                  border: 'none', borderBottom: '1px solid #1e2d40',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#0d1c2c'; }}
                onMouseLeave={e => { e.currentTarget.style.background = isSelected ? `${T.gold}0a` : 'none'; }}
              >
                {isSelected
                  ? <Check size={12} style={{ color: T.gold, flexShrink: 0 }} />
                  : <div style={{ width: 12, flexShrink: 0 }} />
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: T.gold, background: `${T.gold}14`, border: `1px solid ${T.gold}33`, borderRadius: 2, padding: '1px 6px' }}>
                      {o.refNumber || o._id.slice(-6)}
                    </span>
                    {statusBadge(o.status)}
                  </div>
                  <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 500, color: '#c8d8e8', margin: 0 }}>
                    {o.clientName}
                    {person && <span style={{ color: '#4a6080', fontWeight: 300 }}> - {person}</span>}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </ModalShell>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// LINK ORDER MODAL — full-screen searchable modal with client/person filters
// Only shows inquiry + ongoing orders
// ─────────────────────────────────────────────────────────────────────────────

const LinkOrderModal = ({ shipmentId, shipmentRecipient, orders, onAssigned, onClose, showToast }) => {
  const [tab, setTab]               = useState('ongoing');
  const [search, setSearch]         = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterPerson, setFilterPerson] = useState('');
  const [saving, setSaving]         = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  // Orders scoped to the active tab (Inquiries / Ongoing / Completed-last-year)
  const tabOrders = getOrdersForTab(orders, tab);

  const tabCounts = {
    inquiry:   getOrdersForTab(orders, 'inquiry').length,
    ongoing:   getOrdersForTab(orders, 'ongoing').length,
    completed: getOrdersForTab(orders, 'completed').length,
  };

  // Client selected → every person linked to that client (within this tab) shows up here.
  const clientNames = [...new Set(tabOrders.map((o) => o.clientName).filter(Boolean))].sort();
  const personNames = [...new Set(
    tabOrders
      .filter((o) => !filterClient || o.clientName === filterClient)
      .map((o) => getOrderPerson(o))
      .filter(Boolean)
  )].sort();

  const filtered = tabOrders.filter((o) => {
    if (filterClient && o.clientName !== filterClient) return false;
    const person = getOrderPerson(o);
    if (filterPerson && person !== filterPerson) return false;
    if (search) {
      const term = search.toLowerCase();
      const blob = [o.refNumber, o.clientName, person, o.title, o.status].join(' ').toLowerCase();
      if (!blob.includes(term)) return false;
    }
    return true;
  });

  const switchTab = (nextTab) => {
    setTab(nextTab);
    setFilterClient('');
    setFilterPerson('');
  };

  const assign = async (orderId) => {
    setSaving(true);
    logOrderAssigner.info('Assigning order to shipment', { shipmentId, orderId });
    try {
      const order = orders.find((o) => o._id === orderId);
      await api.put(`/shipments/${shipmentId}`, {
        orderId:  orderId || null,
        orderRef: order?.refNumber || '',
        isAdhoc:  !orderId,
      });
      logOrderAssigner.info('Assignment succeeded', { shipmentId, orderId });
      showToast('success', orderId ? 'Order linked' : 'Marked as ad-hoc');
      onAssigned();
      onClose();
    } catch (err) {
      logOrderAssigner.error('Assignment failed', err);
      showToast('error', getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const statusBadge = (status) => {
    const map = {
      inquiry:   { bg: '#1a2a3e', color: '#6a9abf', label: 'Inquiry' },
      ongoing:   { bg: '#1a2e1a', color: '#6ab07a', label: 'Ongoing' },
      completed: { bg: '#2a2a2a', color: '#9a9a9a', label: 'Completed' },
    };
    const s = map[status] || map.inquiry;
    return (
      <span style={{
        fontFamily: jost, fontSize: 9, fontWeight: 700,
        letterSpacing: '0.1em', textTransform: 'uppercase',
        background: s.bg, color: s.color,
        border: `1px solid ${s.color}44`,
        borderRadius: 10, padding: '2px 8px',
      }}>{s.label}</span>
    );
  };

  return (
    <ModalShell
      onClose={onClose}
      icon={Link2}
      subtitle="Assign to Order"
      title="Link Order"
      maxWidth={660}
      footer={
        <>
          <button
            onClick={() => assign('')}
            disabled={saving}
            style={{
              background: 'none', border: `1px solid #2a3a52`, borderRadius: 2,
              cursor: saving ? 'not-allowed' : 'pointer', padding: '9px 18px',
              fontFamily: jost, fontSize: 10, fontWeight: 400,
              letterSpacing: '0.18em', textTransform: 'uppercase',
              color: '#4a6080', transition: 'border-color 0.2s, color 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#4a6080'; e.currentTarget.style.color = '#8fa3c0'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a3a52'; e.currentTarget.style.color = '#4a6080'; }}
          >
            Mark as Ad-hoc
          </button>
          <CancelBtn onClick={onClose} />
        </>
      }
    >
      <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Recipient context */}
        {shipmentRecipient && (
          <div style={{
            padding: '8px 12px', background: '#0a1018', border: '1px solid #1e2d40', borderRadius: 2,
            fontFamily: jost, fontSize: 11, color: '#4a6080',
          }}>
            Linking shipment for <strong style={{ color: '#8fa3c0' }}>{shipmentRecipient}</strong>
          </div>
        )}

        {/* Inquiries / Ongoing / Completed tabs */}
        <OrderPickerTabs tab={tab} onChange={switchTab} counts={tabCounts} />

        {/* Filters row */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {/* Search */}
          <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
            <Search size={12} style={{
              position: 'absolute', left: 10, top: '50%',
              transform: 'translateY(-50%)', color: '#4a6080', pointerEvents: 'none',
            }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search orders…"
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              style={{
                ...darkInput,
                paddingLeft: 30,
                borderColor: searchFocused ? T.gold : '#2a3a52',
                boxShadow: searchFocused ? `0 0 0 2px ${T.gold}14` : 'none',
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#4a6080', padding: 0, display: 'flex',
                }}
              ><X size={12} /></button>
            )}
          </div>

          {/* Client filter — selecting a client narrows the Person filter to
              only the people linked to that client */}
          <DarkSelect
            value={filterClient}
            onChange={(e) => { setFilterClient(e.target.value); setFilterPerson(''); }}
            style={{ minWidth: 150 }}
          >
            <option value="">All Clients</option>
            {clientNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </DarkSelect>

          {/* Person filter */}
          <DarkSelect
            value={filterPerson}
            onChange={(e) => setFilterPerson(e.target.value)}
            style={{ minWidth: 150 }}
          >
            <option value="">All Persons</option>
            {personNames.map((p) => <option key={p} value={p}>{p}</option>)}
          </DarkSelect>
        </div>

        {/* Results count */}
        <p style={{
          fontFamily: jost, fontSize: 9, fontWeight: 400,
          letterSpacing: '0.2em', textTransform: 'uppercase',
          color: `${T.gold}66`, margin: 0,
        }}>
          {filtered.length} order{filtered.length !== 1 ? 's' : ''} · {tab === 'completed' ? 'completed, last 1 year' : tab}
        </p>
      </div>

      {/* Order list */}
      <div style={{ maxHeight: 320, overflowY: 'auto', borderTop: '1px solid #1e2d40' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '32px 24px', textAlign: 'center' }}>
            <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: '#3d5070', margin: 0 }}>
              No matching orders
            </p>
          </div>
        ) : (
          filtered.map((o) => {
            const person = getOrderPerson(o);
            return (
              <button
                key={o._id}
                onClick={() => !saving && assign(o._id)}
                disabled={saving}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '12px 24px',
                  background: 'none', border: 'none', borderBottom: '1px solid #1e2d40',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}
                onMouseEnter={e => { if (!saving) e.currentTarget.style.background = '#0d1c2c'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{
                      fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: T.gold,
                      background: `${T.gold}14`, border: `1px solid ${T.gold}33`,
                      borderRadius: 2, padding: '1px 6px',
                    }}>
                      {o.refNumber || o._id.slice(-6)}
                    </span>
                    {statusBadge(o.status)}
                  </div>
                  <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 500, color: '#c8d8e8', margin: 0, lineHeight: 1.3 }}>
                    {o.clientName}
                    {person && <span style={{ color: '#4a6080', fontWeight: 300 }}> - {person}</span>}
                  </p>
                  {o.title && (
                    <p style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: '#3d5070', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.title}
                    </p>
                  )}
                </div>
                <div style={{ flexShrink: 0, color: '#2a3a52' }}>
                  {saving ? <GoldSpinner size={13} /> : <Link2 size={13} />}
                </div>
              </button>
            );
          })
        )}
      </div>
    </ModalShell>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// INLINE SINGLE-ROW ORDER ASSIGNER — triggers the LinkOrderModal
// ─────────────────────────────────────────────────────────────────────────────

const OrderAssigner = ({ shipmentId, shipmentRecipient, orders, onAssigned, showToast }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: `${T.gold}18`, border: `1px solid ${T.gold}44`,
          borderRadius: 2, cursor: 'pointer', padding: '3px 8px',
          fontFamily: jost, fontSize: 9, fontWeight: 600,
          letterSpacing: '0.15em', textTransform: 'uppercase', color: `${T.gold}cc`,
          transition: 'background 0.2s, border-color 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = `${T.gold}28`; e.currentTarget.style.borderColor = `${T.gold}88`; }}
        onMouseLeave={e => { e.currentTarget.style.background = `${T.gold}18`; e.currentTarget.style.borderColor = `${T.gold}44`; }}
      >
        <Link2 size={9} /> Link Order
      </button>

      {open && (
        <LinkOrderModal
          shipmentId={shipmentId}
          shipmentRecipient={shipmentRecipient}
          orders={orders}
          onAssigned={onAssigned}
          onClose={() => setOpen(false)}
          showToast={showToast}
        />
      )}
    </>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// SHIPMENT ROW  (memo'd to prevent unnecessary re-renders on filter change)
// ─────────────────────────────────────────────────────────────────────────────

const ShipmentRow = memo(({
  shipment, partners, orders, isMarqland,
  selected, onSelect, onEdit, onDelete, onAssigned, showToast,
}) => {
  const delayed    = isDelayed(shipment);
  const partnerObj = partners.find((p) => p.name === shipment.shippingPartner);
  const hasNotes   = !!shipment.notes?.trim();
  const [showNotes, setShowNotes] = useState(false);
  const [hovered, setHovered]     = useState(false);

  // Row background priority: selected > delayed > hover > default
  let rowBg = 'transparent';
  if (selected)       rowBg = T.dimBg;
  else if (delayed)   rowBg = 'rgba(184,151,90,0.06)';
  else if (hovered)   rowBg = T.rowHover;

  // Inline action button style
  const actionBtn = (danger = false) => ({
    background: 'none', border: 'none', cursor: 'pointer',
    padding: '5px 6px', borderRadius: 2, transition: 'color 0.2s, background 0.2s',
    color: danger ? 'rgba(220,38,38,0.5)' : T.muted,
    display: 'inline-flex', alignItems: 'center',
  });

  return (
    <tr
      style={{ borderBottom: `1px solid ${T.border}`, background: rowBg, transition: 'background 0.15s', cursor: 'default' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Checkbox */}
      {isMarqland && (
        <td style={{ padding: '12px 10px 12px 16px', verticalAlign: 'middle' }}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelect}
            aria-label={`Select shipment for ${shipment.recipientName}`}
            style={{ width: 13, height: 13, cursor: 'pointer', accentColor: T.gold }}
          />
        </td>
      )}

      {/* Date */}
      <td style={{ padding: '12px 16px', verticalAlign: 'top' }}>
        <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted, margin: 0, whiteSpace: 'nowrap' }}>
          {fmt(shipment.shippedDate)}
        </p>
        {delayed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 3 }}>
            <AlertTriangle size={9} style={{ color: T.gold2 }} />
            <span style={{
              fontFamily: jost, fontSize: 9, fontWeight: 700,
              letterSpacing: '0.1em', textTransform: 'uppercase', color: T.gold2,
            }}>Delayed</span>
          </div>
        )}
      </td>

      {/* Recipient */}
      <td style={{ padding: '12px 16px', verticalAlign: 'top' }}>
        <p style={{ fontFamily: serif, fontSize: 14, fontWeight: 500, color: T.text, margin: 0, lineHeight: 1.2 }}>
          {shipment.recipientName}
        </p>
        {shipment.phone && (
          <p style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted, margin: '2px 0 0' }}>
            {shipment.phone}
          </p>
        )}
        {isMarqland && shipment.vendorName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 3 }}>
            <UserCheck size={9} style={{ color: `${T.gold}99` }} />
            <span style={{
              fontFamily: jost, fontSize: 9, fontWeight: 600,
              color: `${T.gold}99`, letterSpacing: '0.05em',
            }}>{shipment.vendorName}</span>
          </div>
        )}
      </td>

      {/* Address / City — includes country */}
      <td style={{ padding: '12px 16px', verticalAlign: 'top', maxWidth: 200 }}>
        <p style={{
          fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted, margin: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={shipment.recipientAddress}>
          {shipment.recipientAddress || '—'}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
          <MapPin size={9} style={{ color: T.muted, opacity: 0.5 }} />
          <span style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: '#aaa' }}>
            {[shipment.city, shipment.state, shipment.country].filter(Boolean).join(', ') || '—'}
          </span>
        </div>
      </td>

      {/* Tracking ID — partner name shown below */}
      <td style={{ padding: '12px 16px', verticalAlign: 'top' }}>
        {shipment.trackingId ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: T.gold,
                background: `${T.gold}14`, border: `1px solid ${T.gold}33`,
                borderRadius: 2, padding: '2px 7px',
              }}>
                {shipment.trackingId}
              </span>
              {sanitizeUrl(partnerObj?.trackingUrl) && (
                <a
                  href={sanitizeUrl(partnerObj.trackingUrl)}
                  target="_blank" rel="noopener noreferrer"
                  title={`Open ${partnerObj.name} portal — copy tracking number: ${shipment.trackingId}`}
                  style={{ color: T.muted, display: 'flex', transition: 'color 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.color = T.gold}
                  onMouseLeave={e => e.currentTarget.style.color = T.muted}
                >
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
            {shipment.shippingPartner && (
              <p style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: '#6a7a8a', margin: '4px 0 0' }}>
                {shipment.shippingPartner}
              </p>
            )}
          </div>
        ) : (
          <span style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: '#bbb', fontStyle: 'italic' }}>
            {isMarqland ? 'Pending from vendor' : '—'}
          </span>
        )}
      </td>

      {/* Status */}
      <td style={{ padding: '12px 16px', verticalAlign: 'top' }}>
        <span style={statusBadgeStyle(shipment.status)}>
          {['Delivered', 'Completed'].includes(shipment.status)
            ? <Check size={9} strokeWidth={3} />
            : <Clock size={9} />}
          {shipment.status}
        </span>
        {shipment.lastTrackedAt && (
          <p style={{ fontFamily: jost, fontSize: 9, fontWeight: 300, color: '#aaa', margin: '3px 0 0' }}>
            Updated {fmt(shipment.lastTrackedAt)}
          </p>
        )}
      </td>

      {/* Order — Marqland only */}
      {isMarqland && (
        <td style={{ padding: '12px 16px', verticalAlign: 'top' }}>
          {shipment.orderId
            ? (
              <span style={{ fontFamily: jost, fontSize: 11, fontWeight: 600, color: T.text }}>
                {shipment.orderRef || '—'}
              </span>
            )
            : shipment.isAdhoc
              ? (
                <span style={{
                  fontFamily: jost, fontSize: 9, fontWeight: 600,
                  background: T.offwhite, color: T.muted,
                  border: `1px solid ${T.border}`, borderRadius: 2, padding: '2px 7px',
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                }}>
                  Ad-hoc
                </span>
              )
              : (
                <OrderAssigner
                  shipmentId={shipment._id}
                  shipmentRecipient={shipment.recipientName}
                  orders={orders}
                  onAssigned={onAssigned}
                  showToast={showToast}
                />
              )
          }
        </td>
      )}

      {/* Actions */}
      <td style={{ padding: '12px 16px', verticalAlign: 'top' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>

          {/* Notes popover */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => hasNotes && setShowNotes((v) => !v)}
              title={hasNotes ? 'View notes' : 'No notes'}
              aria-label={hasNotes ? 'View notes' : 'No notes'}
              style={{
                ...actionBtn(),
                color: hasNotes ? T.muted : '#ccc',
                cursor: hasNotes ? 'pointer' : 'default',
              }}
              onMouseEnter={e => { if (hasNotes) e.currentTarget.style.color = T.gold; }}
              onMouseLeave={e => { e.currentTarget.style.color = hasNotes ? T.muted : '#ccc'; }}
            >
              <Eye size={13} />
            </button>

            {showNotes && hasNotes && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowNotes(false)} />
                <div style={{
                  position: 'absolute', zIndex: 50, right: 0, bottom: 30,
                  width: 260, background: T.navyBg, border: '1px solid #2a3a52',
                  borderRadius: 2, boxShadow: '0 12px 40px rgba(0,0,0,0.5)', overflow: 'hidden',
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', borderBottom: '1px solid #1e2d40', background: T.navyBg2,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <FileText size={10} style={{ color: `${T.gold}99` }} />
                      <span style={{
                        fontFamily: jost, fontSize: 9, fontWeight: 600,
                        letterSpacing: '0.2em', textTransform: 'uppercase', color: `${T.gold}66`,
                      }}>Notes</span>
                    </div>
                    <button
                      onClick={() => setShowNotes(false)}
                      aria-label="Close notes"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3d5070', padding: 2 }}
                      onMouseEnter={e => e.currentTarget.style.color = '#4a6080'}
                      onMouseLeave={e => e.currentTarget.style.color = '#3d5070'}
                    ><X size={12} /></button>
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <p style={{
                      fontFamily: jost, fontSize: 12, fontWeight: 300, color: '#8fa3c0',
                      lineHeight: 1.5, whiteSpace: 'pre-wrap', margin: 0,
                    }}>{shipment.notes}</p>
                  </div>
                  <div style={{ padding: '8px 12px', borderTop: '1px solid #1e2d40', background: T.navyBg2 }}>
                    <p style={{ fontFamily: jost, fontSize: 10, fontWeight: 600, color: '#4a6080', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {shipment.recipientName}
                    </p>
                    <p style={{ fontFamily: jost, fontSize: 9, fontWeight: 300, color: '#3d5070', margin: 0 }}>
                      {fmt(shipment.shippedDate)} · {shipment.status}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => onEdit(shipment)}
            title="Edit shipment"
            style={actionBtn()}
            onMouseEnter={e => { e.currentTarget.style.color = T.gold; e.currentTarget.style.background = `${T.gold}14`; }}
            onMouseLeave={e => { e.currentTarget.style.color = T.muted; e.currentTarget.style.background = 'none'; }}
          >
            <Settings size={13} />
          </button>

          <button
            onClick={() => onDelete(shipment._id)}
            title="Delete shipment"
            style={actionBtn(true)}
            onMouseEnter={e => { e.currentTarget.style.color = '#dc2626'; e.currentTarget.style.background = 'rgba(220,38,38,0.06)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(220,38,38,0.5)'; e.currentTarget.style.background = 'none'; }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
});

ShipmentRow.displayName = 'ShipmentRow';


// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function CourierTracking() {
  const { user } = useAuth();
  const isMarqland = MARQLAND_ROLES.includes(user?.role);
  const isAdmin    = user?.role === 'admin';

  const { showToast, confirm, Toast, ConfirmDialog } = usePopup();

  // ── UI state ─────────────────────────────────────────────────────────────
  const [tab, setTab]               = useState('active');
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── Data state ────────────────────────────────────────────────────────────
  const [shipments, setShipments] = useState([]);
  const [orders, setOrders]       = useState([]);
  const [partners, setPartners]   = useState([]);
  const [couriers, setCouriers]   = useState([]);   // courier-role users for vendor assignment

  // ── Filter state ──────────────────────────────────────────────────────────
  const [search, setSearch]               = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [filterCity, setFilterCity]       = useState('');
  const [filterState, setFilterState]     = useState('');
  const [filterVendor, setFilterVendor]   = useState('');
  const [filterPartner, setFilterPartner] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo]     = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  // ── Multi-select state ────────────────────────────────────────────────────
  const [selected, setSelected]         = useState(new Set());
  const [showBulkLink, setShowBulkLink] = useState(false);

  // ── Modal state ───────────────────────────────────────────────────────────
  const [showAddModal, setShowAddModal]         = useState(false);
  const [editShipment, setEditShipment]         = useState(null);
  const [showImport, setShowImport]             = useState(false);
  const [showPartnerModal, setShowPartnerModal] = useState(false);


  // ── Data fetching ─────────────────────────────────────────────────────────

  /**
   * Fetches all data required for the page.
   * `toast` is accepted as a parameter so this callback's dependency array
   * only needs `isMarqland` — avoiding a re-bind every render cycle while
   * keeping the exhaustive-deps rule satisfied without a disable comment.
   */
  const load = useCallback(async (toast = showToast) => {
    log.info('Loading page data', { isMarqland, role: user?.role });
    setLoading(true);
    try {
      const requests = [api.get('/shipments'), api.get('/shipping-partners')];
      if (isMarqland) {
        requests.push(api.get('/orders'));
        requests.push(api.get('/auth/users'));
      }

      log.debug('Dispatching parallel API requests', { count: requests.length });
      const [sRes, pRes, oRes, uRes] = await Promise.all(requests);

      const shipmentsData = Array.isArray(sRes.data) ? sRes.data : [];
      const partnersData  = Array.isArray(pRes.data)  ? pRes.data  : [];

      setShipments(shipmentsData);
      setPartners(partnersData);
      log.info('Shipments and partners loaded', {
        shipments: shipmentsData.length,
        partners:  partnersData.length,
      });

      if (isMarqland && oRes) {
        const ordersData = Array.isArray(oRes.data) ? oRes.data : [];
        setOrders(ordersData);
        log.info('Orders loaded', { count: ordersData.length });
      }

      if (isMarqland && uRes) {
        const allUsers     = Array.isArray(uRes.data) ? uRes.data : [];
        const courierUsers = allUsers.filter((u) => u.role === 'courier');
        setCouriers(courierUsers);
        log.info('Courier vendors loaded', { count: courierUsers.length });
      }
    } catch (err) {
      log.error('Failed to load page data', err);
      toast('error', 'Failed to load shipments. Please refresh the page.');
    } finally {
      setLoading(false);
      log.debug('Load cycle complete');
    }
  }, [isMarqland]); // showToast is intentionally passed as a param — it is stable across renders

  useEffect(() => {
    log.debug('Component mounted — initiating first load');
    load();
  }, [load]);


  // ── Shipment actions ──────────────────────────────────────────────────────

  const triggerRefresh = async () => {
    setRefreshing(true);
    log.info('Triggering tracking status refresh');
    try {
      await api.post('/shipments/refresh-status');
      await load();
      showToast('success', 'Tracking statuses refreshed');
      log.info('Status refresh complete');
    } catch (err) {
      log.error('Status refresh failed', err);
      showToast('error', 'Refresh failed: ' + getApiError(err));
    } finally {
      setRefreshing(false);
    }
  };

  const saveShipment = async (form) => {
    try {
      const enriched = { ...form };
      if (enriched.orderId) {
        const order = orders.find((o) => o._id === enriched.orderId);
        enriched.orderRef = order?.refNumber || '';
        log.debug('Order ref resolved', { orderId: enriched.orderId, orderRef: enriched.orderRef });
      }

      if (editShipment?._id) {
        log.info('Updating shipment', { id: editShipment._id });
        await api.put(`/shipments/${editShipment._id}`, enriched);
        showToast('success', 'Shipment updated');
        log.info('Shipment updated successfully', { id: editShipment._id });
      } else {
        log.info('Creating new shipment', { recipient: form.recipientName });
        await api.post('/shipments', enriched);
        showToast('success', 'Shipment added');
        log.info('Shipment created successfully');
      }

      setShowAddModal(false);
      setEditShipment(null);
      load();
    } catch (err) {
      log.error('Save shipment failed', err);
      showToast('error', getApiError(err));
    }
  };

  const deleteShipment = async (id) => {
    const ok = await confirm({
      title: 'Delete Shipment',
      message: 'This shipment record will be permanently removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) {
      log.debug('Delete cancelled by user', { id });
      return;
    }

    log.info('Deleting shipment', { id });
    try {
      await api.delete(`/shipments/${id}`);
      showToast('success', 'Shipment deleted');
      log.info('Shipment deleted successfully', { id });
      load();
    } catch (err) {
      log.error('Delete failed', { id, err });
      showToast('error', getApiError(err));
    }
  };


  // ── Derived filter options ────────────────────────────────────────────────

  const filterOptions = {
    countries: [...new Set(shipments.map((s) => s.country).filter(Boolean))].sort(),
    cities:    [...new Set(shipments.map((s) => s.city).filter(Boolean))].sort(),
    states:    [...new Set(shipments.map((s) => s.state).filter(Boolean))].sort(),
    vendors:   [...new Set(shipments.map((s) => s.vendorName).filter(Boolean))].sort(),
  };

  const hasFilters = !!(
    search || filterCountry || filterCity || filterState ||
    filterVendor || filterPartner || filterDateFrom || filterDateTo
  );

  const resetFilters = () => {
    log.debug('Resetting all filters');
    setSearch('');
    setFilterCountry('');
    setFilterCity('');
    setFilterState('');
    setFilterVendor('');
    setFilterPartner('');
    setFilterDateFrom('');
    setFilterDateTo('');
  };


  // ── Filtering & sorting ───────────────────────────────────────────────────

  /**
   * Returns true if a completed shipment has aged past ARCHIVE_THRESHOLD_DAYS
   * (measured from lastTrackedAt or updatedAt or shippedDate).
   */
  const isArchived = (s) => {
    if (!COMPLETED_STATUSES.includes(s.status)) return false;
    const anchor = s.lastTrackedAt || s.updatedAt || s.shippedDate || s.createdAt;
    return (Date.now() - new Date(anchor).getTime()) / 86_400_000 > ARCHIVE_THRESHOLD_DAYS;
  };

  const filtered = shipments.filter((s) => {
    if (tab === 'active'    &&  COMPLETED_STATUSES.includes(s.status)) return false;
    if (tab === 'completed' && (!COMPLETED_STATUSES.includes(s.status) || isArchived(s))) return false;
    if (tab === 'archive'   && !isArchived(s)) return false;
    if (filterCountry && s.country !== filterCountry) return false;
    if (filterCity    && s.city?.toLowerCase()  !== filterCity.toLowerCase())  return false;
    if (filterState   && s.state?.toLowerCase() !== filterState.toLowerCase()) return false;
    if (filterPartner && s.shippingPartner !== filterPartner) return false;
    if (filterVendor  && s.vendorName      !== filterVendor)  return false;
    if (filterDateFrom && new Date(s.shippedDate || s.createdAt) < new Date(filterDateFrom)) return false;
    if (filterDateTo   && new Date(s.shippedDate || s.createdAt) > new Date(filterDateTo + 'T23:59:59')) return false;
    if (search) {
      const term = search.toLowerCase();
      const blob = [
        s.recipientName, s.city, s.state, s.country,
        s.trackingId, s.shippingPartner, s.phone, s.orderRef, s.vendorName,
      ].join(' ').toLowerCase();
      if (!blob.includes(term)) return false;
    }
    return true;
  });

  const sorted = tab === 'active'
    ? [...filtered].sort((a, b) => Number(isDelayed(b)) - Number(isDelayed(a)))
    : filtered;

  const delayedCount   = filtered.filter(isDelayed).length;
  const activeCount    = shipments.filter((s) => !COMPLETED_STATUSES.includes(s.status)).length;
  const completedCount = shipments.filter((s) =>  COMPLETED_STATUSES.includes(s.status) && !isArchived(s)).length;
  const archiveCount   = shipments.filter(isArchived).length;


  // ── Selection helpers ─────────────────────────────────────────────────────

  const allFilteredIds = sorted.map((s) => s._id);
  const allSelected    = allFilteredIds.length > 0 && allFilteredIds.every((id) => selected.has(id));
  const selectedCount  = [...selected].filter((id) => allFilteredIds.includes(id)).length;

  const toggleRow = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      log.debug('Row selection toggled', { id, selected: next.has(id) });
      return next;
    });

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(allFilteredIds));
    log.debug('Select-all toggled', { allSelected, count: allFilteredIds.length });
  };
  const clearSelect = () => { setSelected(new Set()); log.debug('Selection cleared'); };


  // ── Shared filter select style ────────────────────────────────────────────
  const filterSelectStyle = {
    border: `1px solid ${T.border}`, borderRadius: 3, padding: '8px 12px',
    fontFamily: jost, fontSize: 12, fontWeight: 300,
    color: T.text, background: T.white, outline: 'none',
    cursor: 'pointer', transition: 'border-color 0.2s',
  };


  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100vh', background: T.offwhite,
      fontFamily: jost, padding: '56px 48px',
    }}>
      <Toast />
      <ConfirmDialog />

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 40 }}>
        {/* Gold rule */}
        <div style={{ width: 32, height: 1, background: T.gold, marginBottom: 20 }} />

        <p style={{
          fontSize: 9, fontWeight: 400, letterSpacing: '0.3em',
          textTransform: 'uppercase', color: T.muted, marginBottom: 10,
        }}>
          Logistics
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
          <div>
            <h1 style={{
              fontFamily: serif, fontSize: 40, fontWeight: 300,
              color: T.navy, lineHeight: 1.05, margin: '0 0 8px',
            }}>
              Courier <em style={{ color: T.gold }}>Tracking.</em>
            </h1>
            <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted, margin: 0, letterSpacing: '0.08em' }}>
              {shipments.length} total shipment{shipments.length !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {isAdmin && (
              <button
                onClick={() => { log.debug('Opening shipping partner modal'); setShowPartnerModal(true); }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'transparent', color: T.muted,
                  border: `1px solid ${T.border}`, padding: '10px 18px',
                  fontFamily: jost, fontSize: 10, fontWeight: 400,
                  letterSpacing: '0.18em', textTransform: 'uppercase',
                  cursor: 'pointer', borderRadius: 2, transition: 'border-color 0.2s, color 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = T.gold; e.currentTarget.style.color = T.gold; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.muted; }}
              >
                <Settings size={13} /> Shipping Partners
              </button>
            )}
            <button
              onClick={triggerRefresh}
              disabled={refreshing}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'transparent', color: T.muted,
                border: `1px solid ${T.border}`, padding: '10px 18px',
                fontFamily: jost, fontSize: 10, fontWeight: 400,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                cursor: refreshing ? 'not-allowed' : 'pointer',
                opacity: refreshing ? 0.5 : 1,
                borderRadius: 2, transition: 'border-color 0.2s, color 0.2s',
              }}
              onMouseEnter={e => { if (!refreshing) { e.currentTarget.style.borderColor = T.gold; e.currentTarget.style.color = T.gold; }}}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.muted; }}
            >
              <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              onClick={() => { log.debug('Opening Excel import modal'); setShowImport(true); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'transparent', color: T.muted,
                border: `1px solid ${T.border}`, padding: '10px 18px',
                fontFamily: jost, fontSize: 10, fontWeight: 400,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                cursor: 'pointer', borderRadius: 2, transition: 'border-color 0.2s, color 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.gold; e.currentTarget.style.color = T.gold; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.muted; }}
            >
              <Upload size={13} /> Import Excel
            </button>
            <button
              onClick={() => {
                log.debug('Opening add shipment modal');
                setEditShipment(null);
                setShowAddModal(true);
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: T.gold, color: T.navy,
                border: 'none', padding: '11px 24px',
                fontFamily: jost, fontSize: 10, fontWeight: 500,
                letterSpacing: '0.22em', textTransform: 'uppercase',
                cursor: 'pointer', borderRadius: 2, transition: 'background 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = T.gold2}
              onMouseLeave={e => e.currentTarget.style.background = T.gold}
            >
              <Plus size={13} /> Add Shipment
            </button>
          </div>
        </div>

        {/* Full-width gold rule */}
        <div style={{ height: 1, background: `linear-gradient(to right, ${T.gold}55, ${T.gold}99, ${T.gold}55)` }} />
      </div>

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>

        {/* Search */}
        <div style={{ position: 'relative', width: 220 }}>
          <Search size={12} style={{
            position: 'absolute', left: 11, top: '50%',
            transform: 'translateY(-50%)', color: T.muted, pointerEvents: 'none',
          }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search shipments…"
            aria-label="Search shipments"
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            style={{
              width: '100%', padding: '9px 32px 9px 32px',
              background: T.white,
              border: `1px solid ${searchFocused ? T.gold : T.border}`,
              borderRadius: 3, fontFamily: jost, fontSize: 12, fontWeight: 300,
              color: T.text, outline: 'none',
              boxSizing: 'border-box', transition: 'border-color 0.2s',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer',
                color: T.muted, display: 'flex', padding: 0, transition: 'color 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = T.text}
              onMouseLeave={e => e.currentTarget.style.color = T.muted}
            >✕</button>
          )}
        </div>

        {/* Date range */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          border: `1px solid ${T.border}`, borderRadius: 3, padding: '8px 12px',
          background: T.white,
        }}>
          <CalendarDays size={11} style={{ color: T.muted, flexShrink: 0 }} />
          <input
            type="date" value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            aria-label="Filter from date"
            style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.text, background: 'transparent', border: 'none', outline: 'none', width: 118 }}
          />
          <span style={{ color: T.muted, fontSize: 12 }}>—</span>
          <input
            type="date" value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            aria-label="Filter to date"
            style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.text, background: 'transparent', border: 'none', outline: 'none', width: 118 }}
          />
        </div>

        {/* Country / State / City selects */}
        {[
          { value: filterCountry, onChange: setFilterCountry, placeholder: 'All Countries', options: filterOptions.countries },
          { value: filterState,   onChange: setFilterState,   placeholder: 'All States',    options: filterOptions.states },
          { value: filterCity,    onChange: setFilterCity,    placeholder: 'All Cities',    options: filterOptions.cities },
        ].map(({ value, onChange, placeholder, options }) => (
          <select key={placeholder} value={value} onChange={(e) => onChange(e.target.value)} style={filterSelectStyle}>
            <option value="">{placeholder}</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}

        {isMarqland && (
          <>
            <select value={filterVendor} onChange={(e) => setFilterVendor(e.target.value)} style={filterSelectStyle}>
              <option value="">All Vendors</option>
              {filterOptions.vendors.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={filterPartner} onChange={(e) => setFilterPartner(e.target.value)} style={filterSelectStyle}>
              <option value="">All Partners</option>
              {partners.map((p) => <option key={p._id} value={p.name}>{p.name}</option>)}
            </select>
          </>
        )}

        {hasFilters && (
          <button
            onClick={resetFilters}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'none', border: `1px solid ${T.border}`, borderRadius: 3,
              cursor: 'pointer', padding: '8px 14px',
              fontFamily: jost, fontSize: 10, fontWeight: 400,
              letterSpacing: '0.18em', textTransform: 'uppercase',
              color: T.muted, transition: 'border-color 0.2s, color 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#dc2626'; e.currentTarget.style.color = '#dc2626'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.muted; }}
          >
            <X size={10} /> Reset
          </button>
        )}
      </div>

      {/* ── Tab bar + bulk action ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { key: 'active',    label: 'Shipping & Shipped', count: activeCount    },
          { key: 'completed', label: 'Completed',          count: completedCount },
          { key: 'archive',   label: 'Archive',            count: archiveCount   },
        ].map((t) => {
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                clearSelect();
                log.debug('Tab changed', { tab: t.key });
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '9px 18px', borderRadius: 3,
                border: `1px solid ${isActive ? `${T.gold}66` : T.border}`,
                background: isActive ? `${T.gold}0e` : 'transparent',
                cursor: 'pointer',
                fontFamily: jost, fontSize: 10, fontWeight: isActive ? 600 : 400,
                letterSpacing: '0.15em', textTransform: 'uppercase',
                color: isActive ? T.gold : T.muted,
                transition: 'all 0.2s',
              }}
            >
              {t.label}
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                background: isActive ? `${T.gold}22` : T.offwhite,
                color: isActive ? T.gold : T.muted,
                border: `1px solid ${isActive ? `${T.gold}33` : T.border}`,
              }}>
                {t.count}
              </span>
            </button>
          );
        })}

        {tab === 'active' && delayedCount > 0 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontFamily: jost, fontSize: 9, fontWeight: 700,
            letterSpacing: '0.12em', textTransform: 'uppercase', color: T.gold2,
            background: `${T.gold}14`, border: `1px solid ${T.gold}44`,
            borderRadius: 3, padding: '6px 12px',
          }}>
            <AlertTriangle size={10} /> {delayedCount} delayed
          </span>
        )}

        {/* Bulk action strip — slides in when rows are ticked */}
        {isMarqland && selectedCount > 0 && (
          <div style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10,
            border: `1px solid ${T.gold}55`, background: `${T.gold}0a`,
            borderRadius: 3, padding: '8px 16px',
          }}>
            <span style={{ fontFamily: jost, fontSize: 11, fontWeight: 600, color: T.gold }}>
              {selectedCount} selected
            </span>
            <button
              onClick={() => { log.debug('Opening bulk link modal', { count: selectedCount }); setShowBulkLink(true); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: `${T.gold}1a`, border: `1px solid ${T.gold}66`,
                borderRadius: 2, cursor: 'pointer', padding: '5px 12px',
                fontFamily: jost, fontSize: 9, fontWeight: 600,
                letterSpacing: '0.15em', textTransform: 'uppercase', color: T.gold,
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = `${T.gold}30`}
              onMouseLeave={e => e.currentTarget.style.background = `${T.gold}1a`}
            >
              <Link2 size={11} /> Link Order
            </button>
            <button
              onClick={clearSelect}
              aria-label="Clear selection"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: `${T.gold}66`, padding: 2, transition: 'color 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = T.gold}
              onMouseLeave={e => e.currentTarget.style.color = `${T.gold}66`}
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>

      {/* ── Shipments table ────────────────────────────────────────────────── */}
      {loading ? (
        <TableSkeleton isMarqland={isMarqland} />
      ) : sorted.length === 0 ? (
        <div style={{ background: T.white, border: `1px solid ${T.border}`, padding: '80px 0', textAlign: 'center' }}>
          <Truck size={32} style={{ color: `${T.gold}44`, margin: '0 auto 12px', display: 'block' }} />
          <p style={{ fontFamily: serif, fontSize: 20, fontWeight: 300, color: T.navy, margin: '0 0 4px' }}>
            {hasFilters ? 'No shipments match your filters' : tab === 'active' ? 'No active shipments' : tab === 'archive' ? 'No archived shipments' : 'No completed shipments'}
          </p>
          <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted, margin: 0 }}>
            {hasFilters ? 'Try adjusting the filters above.' : tab === 'archive' ? 'Completed shipments older than 30 days will appear here.' : 'Add your first shipment to get started.'}
          </p>
        </div>
      ) : (
        <div style={{ background: T.white, border: `1px solid ${T.border}`, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}`, background: T.offwhite }}>
                  {isMarqland && (
                    <th style={{ width: 44, padding: '12px 10px 12px 16px' }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all visible shipments"
                        style={{ width: 13, height: 13, cursor: 'pointer', accentColor: T.gold }}
                      />
                    </th>
                  )}
                  {['Date', 'Recipient', 'Address / City',
                    'Tracking ID', 'Status',
                    ...(isMarqland ? ['Order'] : []),
                    'Actions',
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '12px 16px', textAlign: h === 'Actions' ? 'right' : 'left',
                        fontFamily: jost, fontSize: 9, fontWeight: 400,
                        letterSpacing: '0.25em', textTransform: 'uppercase',
                        color: T.muted, whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <ShipmentRow
                    key={s._id}
                    shipment={s}
                    partners={partners}
                    orders={orders}
                    isMarqland={isMarqland}
                    selected={selected.has(s._id)}
                    onSelect={() => toggleRow(s._id)}
                    onEdit={(shipment) => {
                      log.debug('Edit shipment opened', { id: shipment._id });
                      setEditShipment(shipment);
                      setShowAddModal(true);
                    }}
                    onDelete={deleteShipment}
                    onAssigned={load}
                    showToast={showToast}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Row count footer — mirrors ClientList */}
          <div style={{
            borderTop: `1px solid ${T.border}`, padding: '10px 18px',
            fontFamily: jost, fontSize: 10, fontWeight: 300,
            letterSpacing: '0.12em', color: T.muted, textAlign: 'right',
          }}>
            {sorted.length} of {shipments.length} shipment{shipments.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {showPartnerModal && (
        <ShippingPartnerModal
          partners={partners}
          onSaved={load}
          onClose={() => { log.debug('Closing shipping partner modal'); setShowPartnerModal(false); }}
          showToast={showToast}
          confirm={confirm}
        />
      )}
      {showAddModal && (
        <ShipmentModal
          shipment={editShipment}
          orders={orders}
          partners={partners}
          vendors={couriers}
          showOrderLink={isMarqland}
          onSave={saveShipment}
          onClose={() => {
            log.debug('Closing shipment modal');
            setShowAddModal(false);
            setEditShipment(null);
          }}
          showToast={showToast}
        />
      )}
      {showImport && (
        <ExcelImportModal
          orders={orders}
          partners={partners}
          vendors={couriers}
          showOrderLink={isMarqland}
          onImported={() => { setShowImport(false); load(); }}
          onClose={() => { log.debug('Closing Excel import modal'); setShowImport(false); }}
        />
      )}
      {showBulkLink && (
        <BulkOrderLinkModal
          selectedIds={[...selected].filter((id) => allFilteredIds.includes(id))}
          orders={orders}
          onDone={() => { setShowBulkLink(false); clearSelect(); load(); }}
          onClose={() => { log.debug('Closing bulk link modal'); setShowBulkLink(false); }}
          showToast={showToast}
        />
      )}

      {/* Keyframe definitions (hoisted out of SkeletonRow for performance) */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}