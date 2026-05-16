import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { createLogger } from '../utils/logger';
import { SectionLoader } from '../components/PageLoader';
import {
  Activity, Search, Filter, RefreshCw, Trash2,
  ChevronLeft, ChevronRight, CheckCircle, XCircle,
  Shield, Package, Users, CreditCard, Globe, Settings,
  LogIn, AlertTriangle, Download, Truck, Archive,
} from 'lucide-react';

const log = createLogger('ActivityLogView');

// ── Design tokens ─────────────────────────────────────────────────────────────
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
  navyDim: 'rgba(14,21,32,0.04)',
};
const jost  = '"Jost", sans-serif';
const serif = '"Cormorant Garamond", Georgia, serif';

// ── Category config ───────────────────────────────────────────────────────────
const CATEGORIES = [
  { key: '',          label: 'All',       icon: Activity,  color: T.gold },
  { key: 'auth',      label: 'Auth',      icon: LogIn,     color: '#4caf7d' },
  { key: 'admin',     label: 'Admin',     icon: Shield,    color: '#9c7cc7' },
  { key: 'orders',    label: 'Orders',    icon: Package,   color: '#c49a20' },
  { key: 'clients',   label: 'Clients',   icon: Users,     color: '#4a90c4' },
  { key: 'products',  label: 'Products',  icon: Package,   color: '#c46090' },
  { key: 'vendors',   label: 'Vendors',   icon: Users,     color: '#3aacbc' },
  { key: 'inventory', label: 'Inventory', icon: Archive,   color: '#3a8cbc' },
  { key: 'sourcing',  label: 'Sourcing',  icon: Settings,  color: '#a87cca' },
  { key: 'logistics', label: 'Logistics', icon: Truck,     color: '#7a8a9a' },
  { key: 'portal',    label: 'Portal',    icon: Globe,     color: '#c47a30' },
  { key: 'finance',   label: 'Finance',   icon: CreditCard,color: '#7cac4a' },
  { key: 'general',   label: 'General',   icon: Activity,  color: T.muted  },
];

const STATUS_FILTER = [
  { key: '',      label: 'All'     },
  { key: 'true',  label: 'Success' },
  { key: 'false', label: 'Failed'  },
];

const catConfig = (key) => CATEGORIES.find(c => c.key === key) || CATEGORIES[0];

const ACTION_LABELS = {
  LOGIN:'Logged in',LOGOUT:'Logged out',REGISTER:'Registered account',
  INVITE_REGISTER:'Registered via invite',FORGOT_PASSWORD:'Requested password reset',
  RESET_PASSWORD:'Reset password',APPROVE_USER:'Approved user',CHANGE_ROLE:'Changed user role',
  SUSPEND_USER:'Suspended user',REACTIVATE_USER:'Reactivated user',DELETE_USER:'Deleted user',
  UPDATE_ROUTES:'Updated route access',SEND_INVITE:'Sent invite',
  CREATE_ORDER:'Created order',UPDATE_ORDER:'Updated order',DELETE_ORDER:'Deleted order',PATCH_ORDER:'Updated order',
  CREATE_CLIENT:'Added client',UPDATE_CLIENT:'Updated client',DELETE_CLIENT:'Deleted client',
  CREATE_PRODUCT:'Added product',UPDATE_PRODUCT:'Updated product',DELETE_PRODUCT:'Deleted product',
  CREATE_TRENDING:'Added trending product',UPDATE_TRENDING:'Updated trending product',DELETE_TRENDING:'Deleted trending product',
  CREATE_VENDOR:'Added vendor',UPDATE_VENDOR:'Updated vendor',DELETE_VENDOR:'Deleted vendor',
  CREATE_CATALOGUE:'Created catalogue',UPDATE_CATALOGUE:'Updated catalogue',DELETE_CATALOGUE:'Deleted catalogue',
  CREATE_PROPERTY:'Created property',UPDATE_PROPERTY:'Updated property',DELETE_PROPERTY:'Deleted property',
  CREATE_OFFSITE:'Created offsite catalogue',UPDATE_OFFSITE:'Updated offsite catalogue',DELETE_OFFSITE:'Deleted offsite catalogue',
  CREATE_CHALLAN:'Created challan',UPDATE_CHALLAN:'Updated challan',DELETE_CHALLAN:'Deleted challan',
  CREATE_INQUIRY:'Created inquiry',UPDATE_INQUIRY:'Updated inquiry',DELETE_INQUIRY:'Deleted inquiry',PATCH_INQUIRY:'Updated inquiry status',
  CREATE_SHIPMENT:'Created shipment',UPDATE_SHIPMENT:'Updated shipment',DELETE_SHIPMENT:'Deleted shipment',PATCH_SHIPMENT:'Updated shipment status',
  CREATE_SHIPPING_PARTNER:'Added shipping partner',UPDATE_SHIPPING_PARTNER:'Updated shipping partner',DELETE_SHIPPING_PARTNER:'Deleted shipping partner',
  CREATE_PORTAL:'Created portal',SEND_PORTAL_MSG:'Sent portal message',UPDATE_PORTAL_ITEMS:'Updated portal items',DELETE_PORTAL:'Deleted portal',PATCH_PORTAL:'Updated portal',
  PAYMENT_ACTION:'Payment tracker action',UPDATE_PAYMENT:'Updated payment record',DELETE_PAYMENT:'Deleted payment record',PATCH_PAYMENT:'Updated payment status',
  IMAGE_PROCESS:'Image processing task',
};
const actionLabel = (action) => ACTION_LABELS[action] || action?.replace(/_/g,' ')?.toLowerCase() || '—';

const fmtDate      = d => new Date(d).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true });
const fmtDateShort = d => new Date(d).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:true });

// ── Role badge — gold-tinted on white ─────────────────────────────────────────
const RoleBadge = ({ role }) => {
  const map = {
    admin:     { bg: 'rgba(184,151,90,0.12)', color: T.gold },
    accounts:  { bg: 'rgba(76,175,125,0.12)', color: '#3a8a5a' },
    sales:     { bg: 'rgba(196,154,32,0.12)', color: '#8a6a10' },
    inventory: { bg: 'rgba(74,144,196,0.12)', color: '#2a6090' },
    courier:   { bg: 'rgba(150,150,170,0.12)', color: '#6a6a8a' },
    viewer:    { bg: 'rgba(0,0,0,0.05)',       color: T.muted  },
  };
  if (!role) return null;
  const style = map[role] || map.viewer;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      background: style.bg,
      border: '1px solid ' + style.color.replace(')', ',0.3)').replace('rgb', 'rgba'),
      fontFamily: jost, fontSize: 9, fontWeight: 400,
      letterSpacing: '0.2em', textTransform: 'uppercase',
      color: style.color, borderRadius: 2,
    }}>
      {role}
    </span>
  );
};

// ── Stat card ─────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, sub, color = T.gold, icon: Icon }) => (
  <div style={{
    background: 'white', border: `1px solid ${T.border}`,
    padding: '22px 24px', display: 'flex', alignItems: 'center', gap: 18,
  }}>
    <div style={{
      width: 42, height: 42, flexShrink: 0,
      border: `1px solid ${T.borderG}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: T.dimBg,
    }}>
      <Icon size={18} style={{ color }} />
    </div>
    <div>
      <div style={{
        fontFamily: serif, fontSize: 30, fontWeight: 300,
        color: T.navy, lineHeight: 1,
      }}>
        {value}
      </div>
      <div style={{
        fontFamily: jost, fontSize: 9, fontWeight: 400,
        letterSpacing: '0.22em', textTransform: 'uppercase',
        color: T.muted, marginTop: 4,
      }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted, marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  </div>
);

// ── HTTP method badge ─────────────────────────────────────────────────────────
const MethodBadge = ({ method }) => {
  const map = {
    POST:   { bg: 'rgba(76,175,125,0.10)', color: '#3a7a5a' },
    PUT:    { bg: 'rgba(196,154,32,0.10)', color: '#8a6010' },
    PATCH:  { bg: 'rgba(196,154,32,0.10)', color: '#8a6010' },
    DELETE: { bg: 'rgba(220,38,38,0.08)', color: '#b02020' },
    GET:    { bg: 'rgba(0,0,0,0.05)',      color: T.muted   },
  };
  const s = map[method] || map.GET;
  return (
    <span style={{
      fontFamily: jost, fontSize: 9, fontWeight: 500,
      letterSpacing: '0.15em', textTransform: 'uppercase',
      padding: '2px 7px',
      background: s.bg, color: s.color,
      display: 'inline-block',
    }}>
      {method}
    </span>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
const ActivityLogView = () => {
  const { authFetch } = useAuth();

  const [logs,      setLogs]      = useState([]);
  const [total,     setTotal]     = useState(0);
  const [pages,     setPages]     = useState(1);
  const [loading,   setLoading]   = useState(true);
  const [stats,     setStats]     = useState(null);

  const [search,    setSearch]    = useState('');
  const [category,  setCategory]  = useState('');
  const [success,   setSuccess]   = useState('');
  const [page,      setPage]      = useState(1);
  const [from,      setFrom]      = useState('');
  const [to,        setTo]        = useState('');

  const [purging,   setPurging]   = useState(false);
  const [purgeMsg,  setPurgeMsg]  = useState('');
  const [activeTab, setActiveTab] = useState('logs');
  const [searchFocused, setSearchFocused] = useState(false);

  const fetchLogs = useCallback(async () => {
    log.debug('Fetching logs', { page, search, category, success, from, to });
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 50 });
      if (search)   params.set('search',   search);
      if (category) params.set('category', category);
      if (success)  params.set('success',  success);
      if (from)     params.set('from',     from);
      if (to)       params.set('to',       to + 'T23:59:59');

      const res  = await authFetch(`/api/logs?${params}`);
      const data = await res.json();
      log.info('Logs loaded', { count: data.logs?.length, total: data.total });
      setLogs(data.logs  || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (err) {
      log.error('Failed to fetch logs', err.message);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, category, success, from, to]);

  const fetchStats = useCallback(async () => {
    log.debug('Fetching log stats');
    try {
      const res  = await authFetch('/api/logs/stats');
      const data = await res.json();
      log.info('Stats loaded');
      setStats(data);
    } catch (err) {
      log.warn('Stats fetch failed silently', err.message);
    }
  }, []);

  useEffect(() => { fetchLogs();  }, [fetchLogs]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { setPage(1);   }, [search, category, success, from, to]);

  const purge = async (days) => {
    if (!window.confirm(`Delete all logs older than ${days} days?`)) return;
    log.info('Purging logs older than', days, 'days');
    setPurging(true);
    try {
      const res  = await authFetch(`/api/logs/purge?days=${days}`, { method: 'DELETE' });
      const data = await res.json();
      log.info('Purge complete', data.message);
      setPurgeMsg(data.message);
      fetchLogs(); fetchStats();
      setTimeout(() => setPurgeMsg(''), 4000);
    } finally { setPurging(false); }
  };

  const exportCSV = () => {
    log.debug('Exporting logs CSV', { count: logs.length });
    const headers = ['Time','User','Email','Role','Category','Action','Summary','Status','Duration(ms)','IP'];
    const rows = logs.map(l => [fmtDate(l.createdAt),l.userName,l.userEmail,l.userRole,l.category,l.action,l.summary,l.status,l.duration,l.ip]);
    const csv  = [headers,...rows].map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `activity_log_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  // ── Shared input focus styles ───────────────────────────────────────────────
  const dateInputStyle = {
    padding: '9px 12px', background: 'white',
    border: `1px solid ${T.border}`,
    fontFamily: jost, fontSize: 11, fontWeight: 300,
    color: T.text, outline: 'none',
    transition: 'border-color 0.2s',
  };

  return (
    <div style={{ minHeight: '100vh', background: T.offwhite, fontFamily: jost, padding: '56px 48px' }}>

      {/* ── Page header ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ width: 32, height: 1, background: T.gold, marginBottom: 20 }} />
        <p style={{
          fontSize: 9, fontWeight: 400, letterSpacing: '0.3em',
          textTransform: 'uppercase', color: T.muted, marginBottom: 10,
        }}>
          Admin
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
          <div>
            <h1 style={{
              fontFamily: serif, fontSize: 40, fontWeight: 300,
              color: T.navy, lineHeight: 1.05, margin: '0 0 6px',
            }}>
              Activity <em style={{ color: T.gold }}>Logs.</em>
            </h1>
            <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted, letterSpacing: '0.08em' }}>
              {total.toLocaleString()} total entries
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={exportCSV}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'transparent', color: T.muted,
                border: `1px solid ${T.border}`, padding: '9px 18px',
                fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.2em', textTransform: 'uppercase',
                cursor: 'pointer', transition: 'border-color 0.2s, color 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.gold; e.currentTarget.style.color = T.gold; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.muted; }}
            >
              <Download size={12} /> Export CSV
            </button>
            <button
              onClick={() => { fetchLogs(); fetchStats(); }}
              style={{
                background: 'transparent', border: `1px solid ${T.border}`,
                padding: '9px 12px', cursor: 'pointer', color: T.muted,
                display: 'flex', alignItems: 'center',
                transition: 'border-color 0.2s, color 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.gold; e.currentTarget.style.color = T.gold; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.muted; }}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${T.border}` }}>
          {[{ k: 'logs', l: 'Log Feed' }, { k: 'stats', l: 'Stats & Summary' }].map(t => (
            <button
              key={t.k}
              onClick={() => setActiveTab(t.k)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '11px 24px',
                fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.22em', textTransform: 'uppercase',
                color: activeTab === t.k ? T.gold : T.muted,
                borderBottom: `2px solid ${activeTab === t.k ? T.gold : 'transparent'}`,
                marginBottom: -1,
                transition: 'color 0.2s, border-color 0.2s',
              }}
            >
              {t.l}
            </button>
          ))}
        </div>
      </div>

      {/* ══════════════════ STATS TAB ══════════════════ */}
      {activeTab === 'stats' && stats && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 16 }}>
            <StatCard label="Actions (7d)"  value={stats.totalLast7}  icon={Activity}      color={T.gold}     />
            <StatCard label="Failed (7d)"   value={stats.failedLast7} icon={AlertTriangle} color="#dc2626"    />
            <StatCard label="Top category"  value={stats.byCategory?.[0]?._id || '—'} icon={Filter} color={T.gold} />
            <StatCard label="Active users"  value={stats.byUser?.length || 0} icon={Users} color="#4caf7d" />
          </div>

          {/* By category + Most active users */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div style={{ background: 'white', border: `1px solid ${T.border}`, padding: '22px 24px' }}>
              <p style={{
                fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.28em', textTransform: 'uppercase',
                color: 'rgba(184,151,90,0.6)', marginBottom: 20,
              }}>
                Actions by Category (7d)
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(stats.byCategory || []).map(c => {
                  const cfg = catConfig(c._id);
                  const pct = stats.totalLast7 > 0 ? Math.round((c.count / stats.totalLast7) * 100) : 0;
                  return (
                    <div key={c._id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <cfg.icon size={12} style={{ color: cfg.color, flexShrink: 0 }} />
                      <div style={{
                        fontFamily: jost, fontSize: 11, fontWeight: 400,
                        color: T.text, width: 76, textTransform: 'capitalize',
                      }}>
                        {c._id || 'general'}
                      </div>
                      <div style={{ flex: 1, height: 2, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                        <div style={{ height: 2, background: cfg.color, width: `${pct}%`, transition: 'width 0.4s' }} />
                      </div>
                      <div style={{
                        fontFamily: jost, fontSize: 11, fontWeight: 400,
                        color: T.muted, width: 28, textAlign: 'right',
                      }}>
                        {c.count}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ background: 'white', border: `1px solid ${T.border}`, padding: '22px 24px' }}>
              <p style={{
                fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.28em', textTransform: 'uppercase',
                color: 'rgba(184,151,90,0.6)', marginBottom: 20,
              }}>
                Most Active Users (7d)
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(stats.byUser || []).slice(0, 8).map((u, i) => (
                  <div key={u._id || i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 28, height: 28, background: T.navy,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <span style={{
                        fontFamily: jost, fontSize: 10, fontWeight: 400,
                        color: T.gold, letterSpacing: '0.05em',
                      }}>
                        {(u.name || u.email || '?').slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: jost, fontSize: 12, fontWeight: 400,
                        color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {u.name || u.email}
                      </div>
                      <div style={{ marginTop: 2 }}>
                        <RoleBadge role={u.role} />
                      </div>
                    </div>
                    <div style={{
                      fontFamily: serif, fontSize: 20, fontWeight: 300,
                      color: T.gold,
                    }}>
                      {u.count}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recent actions */}
          <div style={{ background: 'white', border: `1px solid ${T.border}`, padding: '22px 24px' }}>
            <p style={{
              fontFamily: jost, fontSize: 9, fontWeight: 400,
              letterSpacing: '0.28em', textTransform: 'uppercase',
              color: 'rgba(184,151,90,0.6)', marginBottom: 20,
            }}>
              Recent Activity
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {(stats.recentActions || []).map((a, i) => {
                const cfg = catConfig(a.category);
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '12px 0',
                    borderBottom: i < (stats.recentActions.length - 1) ? `1px solid ${T.border}` : 'none',
                  }}>
                    <div style={{
                      width: 24, height: 24, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: cfg.color + '14',
                    }}>
                      <cfg.icon size={11} style={{ color: cfg.color }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: jost, fontSize: 12, fontWeight: 300,
                        color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {a.summary}
                      </div>
                      <div style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted, marginTop: 2 }}>
                        {a.userName} · {fmtDateShort(a.createdAt)}
                      </div>
                    </div>
                    {a.success
                      ? <CheckCircle size={13} style={{ color: '#4caf7d', flexShrink: 0 }} />
                      : <XCircle    size={13} style={{ color: '#dc2626', flexShrink: 0 }} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Purge controls */}
          <div style={{
            background: 'white',
            border: '1px solid rgba(220,38,38,0.15)',
            padding: '22px 24px',
          }}>
            <p style={{
              fontFamily: jost, fontSize: 9, fontWeight: 400,
              letterSpacing: '0.28em', textTransform: 'uppercase',
              color: 'rgba(220,38,38,0.5)', marginBottom: 8,
              display: 'flex', alignItems: 'center', gap: 7,
            }}>
              <Trash2 size={11} /> Purge Old Logs
            </p>
            <p style={{
              fontFamily: jost, fontSize: 12, fontWeight: 300,
              color: T.muted, marginBottom: 18, lineHeight: 1.6,
            }}>
              Permanently delete log entries older than the selected period. Cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[30, 60, 90, 180].map(d => (
                <button
                  key={d}
                  onClick={() => purge(d)}
                  disabled={purging}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(220,38,38,0.2)',
                    padding: '8px 18px', cursor: 'pointer',
                    fontFamily: jost, fontSize: 9, fontWeight: 400,
                    letterSpacing: '0.2em', textTransform: 'uppercase',
                    color: '#dc2626', opacity: purging ? 0.4 : 1,
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(220,38,38,0.05)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {purging ? '…' : `Purge › ${d}d`}
                </button>
              ))}
            </div>
            {purgeMsg && (
              <p style={{
                fontFamily: jost, fontSize: 12, fontWeight: 400,
                color: '#3a7a5a', marginTop: 14, letterSpacing: '0.04em',
              }}>
                ✓ {purgeMsg}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════ LOG FEED TAB ══════════════════ */}
      {activeTab === 'logs' && (
        <>
          {/* ── Filters ── */}
          <div style={{
            background: 'white', border: `1px solid ${T.border}`,
            padding: '20px 22px', marginBottom: 16,
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            {/* Search + date range + status */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Search */}
              <div style={{ flex: '1 1 220px', position: 'relative', minWidth: 200 }}>
                <Search size={12} style={{
                  position: 'absolute', left: 12, top: '50%',
                  transform: 'translateY(-50%)', color: T.muted, pointerEvents: 'none',
                }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by user, email, action, summary…"
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  style={{
                    width: '100%', padding: '9px 14px 9px 34px',
                    background: T.offwhite,
                    border: `1px solid ${searchFocused ? T.gold : 'transparent'}`,
                    fontFamily: jost, fontSize: 11, fontWeight: 300,
                    color: T.text, outline: 'none', boxSizing: 'border-box',
                    transition: 'border-color 0.2s',
                  }}
                />
              </div>
              <input
                type="date" value={from} onChange={e => setFrom(e.target.value)}
                style={dateInputStyle}
                onFocus={e => e.target.style.borderColor = T.gold}
                onBlur={e => e.target.style.borderColor = T.border}
              />
              <input
                type="date" value={to} onChange={e => setTo(e.target.value)}
                style={dateInputStyle}
                onFocus={e => e.target.style.borderColor = T.gold}
                onBlur={e => e.target.style.borderColor = T.border}
              />
              {/* Status filter */}
              <div style={{ display: 'flex', gap: 6 }}>
                {STATUS_FILTER.map(s => (
                  <button
                    key={s.key}
                    onClick={() => setSuccess(s.key)}
                    style={{
                      background: success === s.key ? T.gold : 'transparent',
                      color:      success === s.key ? T.navy  : T.muted,
                      border: `1px solid ${success === s.key ? T.gold : T.border}`,
                      padding: '8px 14px', cursor: 'pointer',
                      fontFamily: jost, fontSize: 9, fontWeight: 400,
                      letterSpacing: '0.2em', textTransform: 'uppercase',
                      transition: 'all 0.2s',
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Category chips */}
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {CATEGORIES.map(cat => {
                const active = category === cat.key;
                return (
                  <button
                    key={cat.key}
                    onClick={() => setCategory(cat.key)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '5px 12px',
                      background: active ? cat.color : 'transparent',
                      color:      active ? 'white'    : T.muted,
                      border: `1px solid ${active ? cat.color : T.border}`,
                      cursor: 'pointer',
                      fontFamily: jost, fontSize: 9, fontWeight: 400,
                      letterSpacing: '0.18em', textTransform: 'uppercase',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = cat.color; }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = T.border; }}
                  >
                    <cat.icon size={10} />
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Log table ── */}
          <div style={{ background: 'white', border: `1px solid ${T.border}`, overflow: 'hidden' }}>
            {loading ? (
              <SectionLoader message="Loading logs…" />
            ) : logs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '72px 0' }}>
                <Activity size={28} style={{ color: 'rgba(0,0,0,0.1)', margin: '0 auto 12px', display: 'block' }} />
                <p style={{
                  fontFamily: jost, fontSize: 12, fontWeight: 300,
                  letterSpacing: '0.1em', color: T.muted,
                }}>
                  No log entries found
                </p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.border}`, background: T.offwhite }}>
                    {['Time', 'User', 'What Happened', 'Details', 'Status'].map(h => (
                      <th key={h} style={{
                        padding: '11px 16px', textAlign: 'left',
                        fontFamily: jost, fontSize: 9, fontWeight: 400,
                        letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted,
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((entry, i) => {
                    const cfg = catConfig(entry.category);
                    return (
                      <tr
                        key={entry._id || i}
                        style={{
                          borderBottom: `1px solid ${T.border}`,
                          background: !entry.success ? 'rgba(220,38,38,0.025)' : 'transparent',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = !entry.success ? 'rgba(220,38,38,0.04)' : 'rgba(0,0,0,0.015)'}
                        onMouseLeave={e => e.currentTarget.style.background = !entry.success ? 'rgba(220,38,38,0.025)' : 'transparent'}
                      >
                        {/* Time */}
                        <td style={{ padding: '13px 16px', whiteSpace: 'nowrap' }}>
                          <span style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.text }}>
                            {fmtDateShort(entry.createdAt)}
                          </span>
                        </td>

                        {/* User */}
                        <td style={{ padding: '13px 16px' }}>
                          <div style={{
                            fontFamily: jost, fontSize: 12, fontWeight: 400,
                            color: T.text, maxWidth: 130,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {entry.userName && entry.userName !== 'Anonymous' ? entry.userName : (entry.userEmail || 'Anonymous')}
                          </div>
                          {entry.userEmail && entry.userName !== entry.userEmail && (
                            <div style={{
                              fontFamily: jost, fontSize: 10, fontWeight: 300,
                              color: T.muted, maxWidth: 130,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {entry.userEmail}
                            </div>
                          )}
                          <div style={{ marginTop: 3 }}>
                            <RoleBadge role={entry.userRole} />
                          </div>
                        </td>

                        {/* What happened */}
                        <td style={{ padding: '13px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{
                              width: 24, height: 24, flexShrink: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: cfg.color + '14',
                            }}>
                              <cfg.icon size={11} style={{ color: cfg.color }} />
                            </div>
                            <div>
                              <div style={{
                                fontFamily: jost, fontSize: 12, fontWeight: 400,
                                color: T.text, lineHeight: 1.3,
                              }}>
                                {actionLabel(entry.action)}
                              </div>
                              <div style={{
                                fontFamily: jost, fontSize: 9, fontWeight: 400,
                                letterSpacing: '0.12em', textTransform: 'capitalize',
                                color: cfg.color, marginTop: 2,
                              }}>
                                {entry.category || 'general'}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Details */}
                        <td style={{ padding: '13px 16px', maxWidth: 280 }}>
                          <div style={{
                            fontFamily: jost, fontSize: 11, fontWeight: 300,
                            color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {entry.summary}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            <MethodBadge method={entry.method} />
                            <span style={{
                              fontFamily: 'monospace', fontSize: 10,
                              color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              maxWidth: 160,
                            }}>
                              {entry.path}
                            </span>
                          </div>
                        </td>

                        {/* Status */}
                        <td style={{ padding: '13px 16px' }}>
                          <span style={{
                            fontFamily: jost, fontSize: 11, fontWeight: 400,
                            display: 'flex', alignItems: 'center', gap: 5,
                            color: entry.success ? '#4caf7d' : '#dc2626',
                          }}>
                            {entry.success
                              ? <CheckCircle size={12} />
                              : <XCircle    size={12} />}
                            {entry.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Pagination ── */}
          {pages > 1 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginTop: 20, flexWrap: 'wrap', gap: 12,
            }}>
              <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted }}>
                Page {page} of {pages} · {total.toLocaleString()} entries
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  style={{
                    padding: '7px 11px', background: 'white',
                    border: `1px solid ${T.border}`, cursor: 'pointer',
                    color: T.muted, opacity: page === 1 ? 0.3 : 1,
                    display: 'flex', alignItems: 'center',
                    transition: 'border-color 0.2s, color 0.2s',
                  }}
                  onMouseEnter={e => { if (page !== 1) { e.currentTarget.style.borderColor = T.gold; e.currentTarget.style.color = T.gold; }}}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.muted; }}
                >
                  <ChevronLeft size={14} />
                </button>
                {Array.from({ length: Math.min(7, pages) }, (_, i) => {
                  const p = page <= 4 ? i + 1 : page - 3 + i;
                  if (p < 1 || p > pages) return null;
                  const isActive = p === page;
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      style={{
                        width: 32, height: 32,
                        background: isActive ? T.gold : 'white',
                        color:      isActive ? T.navy  : T.muted,
                        border: `1px solid ${isActive ? T.gold : T.border}`,
                        cursor: 'pointer',
                        fontFamily: jost, fontSize: 11, fontWeight: 400,
                        transition: 'all 0.2s',
                      }}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage(p => Math.min(pages, p + 1))}
                  disabled={page === pages}
                  style={{
                    padding: '7px 11px', background: 'white',
                    border: `1px solid ${T.border}`, cursor: 'pointer',
                    color: T.muted, opacity: page === pages ? 0.3 : 1,
                    display: 'flex', alignItems: 'center',
                    transition: 'border-color 0.2s, color 0.2s',
                  }}
                  onMouseEnter={e => { if (page !== pages) { e.currentTarget.style.borderColor = T.gold; e.currentTarget.style.color = T.gold; }}}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.muted; }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ActivityLogView;