/**
 * src/pages/orders/LinkedShipmentsPanel.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Read-only list of the shipments linked to an order (full management lives
 * in Courier Tracking), with filters for state, city and shipment status and
 * a search over recipient name / phone / tracking ID.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import api from '../../api';
import { createLogger } from '../../utils/logger';
import { T, jost, Spinner } from './ui';

const log = createLogger('OrderTracker');

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
// LinkedShipmentsPanel
// Read-only shipments list shown inside the Edit Order drawer.
// Full management lives in Courier Tracking.
// ─────────────────────────────────────────────────────────────────────────────
const uniqueSorted = (values) => [...new Set(values.map((v) => (v || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

const filterSelect = {
  padding: '9px 12px', background: 'white', border: `1px solid ${T.border}`, borderRadius: 3,
  fontFamily: jost, fontSize: 12, color: T.text, outline: 'none', cursor: 'pointer', minWidth: 150,
};

const EMPTY_FILTERS = { q: '', state: '', city: '', status: '' };

const LinkedShipmentsPanel = ({ orderId }) => {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filters, setFilters]     = useState(EMPTY_FILTERS);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value, ...(k === 'state' ? { city: '' } : {}) }));

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

  // Filter options come from the shipments themselves, so only values that
  // actually occur are offered; cities narrow to the chosen state.
  const states   = useMemo(() => uniqueSorted(shipments.map((s) => s.state)), [shipments]);
  const cities   = useMemo(() => uniqueSorted(shipments.filter((s) => !filters.state || s.state === filters.state).map((s) => s.city)), [shipments, filters.state]);
  const statuses = useMemo(() => uniqueSorted(shipments.map((s) => s.status)), [shipments]);

  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return shipments.filter((s) => (
      (!filters.state || s.state === filters.state)
      && (!filters.city || s.city === filters.city)
      && (!filters.status || s.status === filters.status)
      && (!q || [s.recipientName, s.phone, s.trackingId].filter(Boolean).join(' ').toLowerCase().includes(q))
    ));
  }, [shipments, filters]);

  const filtered = Object.values(filters).some(Boolean);

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
            {filtered ? `${visible.length} of ` : ''}{shipments.length} shipment{shipments.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Filters */}
      {shipments.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
            <Search size={13} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.muted, pointerEvents: 'none' }} />
            <input
              value={filters.q}
              onChange={set('q')}
              placeholder="Search recipient name, phone, tracking ID…"
              style={{ ...filterSelect, width: '100%', paddingLeft: 32, boxSizing: 'border-box', cursor: 'text' }}
            />
          </div>
          <select value={filters.state} onChange={set('state')} style={filterSelect} aria-label="State">
            <option value="">All states</option>
            {states.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={filters.city} onChange={set('city')} style={filterSelect} aria-label="City">
            <option value="">All cities</option>
            {cities.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={filters.status} onChange={set('status')} style={filterSelect} aria-label="Shipment status">
            <option value="">All statuses</option>
            {statuses.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          {filtered && (
            <button
              type="button" onClick={() => setFilters(EMPTY_FILTERS)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', fontFamily: jost, fontSize: 11, color: T.muted }}
            >
              <X size={13} /> Clear
            </button>
          )}
        </div>
      )}

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
      ) : visible.length === 0 ? (
        <div style={{
          padding: '14px 16px', background: T.offwhite, border: `1px solid ${T.border}`,
          fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted,
        }}>
          No shipments match these filters.
        </div>
      ) : (
        <div style={{ border: `1px solid ${T.border}`, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: T.offwhite }}>
                {['Recipient', 'City', 'State', 'Tracking ID', 'Partner', 'Status'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => {
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
                    <td style={{ padding: '12px 14px', fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted }}>
                      {s.state || '—'}
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

export default LinkedShipmentsPanel;
