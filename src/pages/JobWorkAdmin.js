/**
 * src/pages/JobWorkAdmin.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin review queue for the Job Work portal (see marqlandstudios-client's
 * /job-work page for the vendor-facing side, and marqlandstudios-backend-v2's
 * routes/jobWorkAdminRoutes.js for the API this talks to).
 *
 * Styled to match the rest of the app (PendingSupplierApprovals.js /
 * CourierTracking.js conventions — hand-rolled inline styles, gold/navy
 * design tokens, Jost + Cormorant Garamond fonts, no UI kit).
 *
 * NOT wired into App.js's routes/sidebar/PATH_TO_ROUTE_KEY yet — see
 * JOB_WORK_WIRING.md at the repo root for the exact lines to add.
 *
 * Talks to:
 *   GET  /api/admin/job-work/rows            ?tab=&search=&vendor=&from=&to=
 *   GET  /api/admin/job-work/vendors
 *   PUT  /api/admin/job-work/rows/:id/approve
 *   PUT  /api/admin/job-work/rows/:id/comment  { text }
 *   GET  /api/admin/job-work/pending-vendors
 *   PATCH /api/auth/users/:id/approve          { role: 'jobWork' }  (existing endpoint)
 *
 * Inviting new vendors now happens from User Management (src/pages/
 * UserManagement.js's InvitePanel, extended with a "Job Work Vendor" invite
 * type) rather than a dedicated modal here — same place every other invite
 * (employee, partner/supplier) is sent from. See JOB_WORK_WIRING.md.
 */
import React, { useState, useEffect, useCallback } from 'react';
import api, { BASE_URL } from '../api';
import {
  Search, X, CheckCircle2, MessageSquare, Loader2, Users,
  Image as ImageIcon, Calendar, ChevronRight, RotateCcw,
} from 'lucide-react';

const T = {
  navy: '#0e1520', gold: '#b8975a', gold2: '#d4b06a', offwhite: '#faf8f5',
  text: '#1a1a1a', muted: '#888', border: 'rgba(0,0,0,0.07)',
  borderG: 'rgba(184,151,90,0.18)', red: '#dc2626', green: '#16a34a',
};
const jost = '"Jost", sans-serif';
const serif = '"Cormorant Garamond", Georgia, serif';

const inputStyle = () => ({
  padding: '9px 12px', border: `1px solid ${T.border}`, borderRadius: 3,
  fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.text,
  background: 'white', outline: 'none', boxSizing: 'border-box',
});

// OneDrive's webUrl (img.url) opens the online viewer page, not a raw image
// byte stream, so it can't be used as an <img src> directly — this hits the
// backend proxy (GET /api/job-work/media/:rowId/:imageId) instead, which
// streams the actual file content through Graph. BASE_URL already ends in
// '/api' (see src/api.js), hence no extra '/api' segment here.
const mediaUrl = (rowId, imageId) => `${BASE_URL}/job-work/media/${rowId}/${imageId}`;

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const TABS = [
  { key: 'ongoing', label: 'Ongoing' },
  { key: 'completed', label: 'Completed' },
  { key: 'archive', label: 'Archive' },
];

const STATUS_BADGE = {
  ongoing: { bg: 'rgba(230,185,80,0.15)', color: '#e6b950' },
  completed: { bg: 'rgba(134,197,134,0.15)', color: '#16a34a' },
  archive: { bg: 'rgba(255,255,255,0.08)', color: T.muted },
};

const JobWorkAdmin = () => {
  const [tab, setTab] = useState('ongoing');
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ ongoing: 0, completed: 0, archive: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [vendors, setVendors] = useState([]);

  const [reviewing, setReviewing] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [saving, setSaving] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);

  const [showPending, setShowPending] = useState(false);
  const [pendingVendors, setPendingVendors] = useState([]);
  const [approvingId, setApprovingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { tab, search: search.trim() || undefined, vendor: vendorFilter || undefined, from: from || undefined, to: to || undefined };
      const res = await api.get('/admin/job-work/rows', { params });
      setRows(res.data);

      // Refresh tab counts against the current search/vendor/date filters
      // (but not the tab itself) so switching tabs shows accurate badges.
      const [og, cp, ar] = await Promise.all(
        ['ongoing', 'completed', 'archive'].map(t =>
          api.get('/admin/job-work/rows', { params: { ...params, tab: t } }).then(r => r.data.length).catch(() => 0)
        )
      );
      setCounts({ ongoing: og, completed: cp, archive: ar });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load job work rows.');
    } finally {
      setLoading(false);
    }
  }, [tab, search, vendorFilter, from, to]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/admin/job-work/vendors').then(res => setVendors(res.data)).catch(() => {});
  }, []);

  const loadPendingVendors = useCallback(async () => {
    try {
      const res = await api.get('/admin/job-work/pending-vendors');
      setPendingVendors(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (showPending) loadPendingVendors(); }, [showPending, loadPendingVendors]);

  const openReview = (row) => {
    setReviewing(row);
    setCommentText('');
    setError('');
  };

  const submitApprove = async () => {
    setSaving(true);
    setError('');
    try {
      await api.put(`/admin/job-work/rows/${reviewing._id}/approve`);
      setReviewing(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Approval failed.');
    } finally {
      setSaving(false);
    }
  };

  const submitComment = async () => {
    if (!commentText.trim()) { setError('Please enter a comment.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await api.put(`/admin/job-work/rows/${reviewing._id}/comment`, { text: commentText.trim() });
      setReviewing(res.data.row);
      setCommentText('');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save comment.');
    } finally {
      setSaving(false);
    }
  };

  const approveVendorAccess = async (userId) => {
    setApprovingId(userId);
    try {
      await api.patch(`/auth/users/${userId}/approve`, { role: 'jobWork' });
      await loadPendingVendors();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to grant access.');
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <div style={{ padding: '32px 40px', fontFamily: jost, background: T.offwhite, minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <p style={{ fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: T.muted, marginBottom: 6 }}>
            Vendor Submissions
          </p>
          <h1 style={{ fontFamily: serif, fontSize: 32, fontWeight: 300, color: T.navy, margin: 0 }}>
            Job <em style={{ color: T.gold }}>Work.</em>
          </h1>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.border}`, marginBottom: 20 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 18px', fontFamily: jost, fontSize: 11, fontWeight: 500,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              color: tab === t.key ? T.navy : T.muted,
              borderBottom: tab === t.key ? `2px solid ${T.gold}` : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label}
            <span style={{
              background: tab === t.key ? T.gold : T.border, color: tab === t.key ? T.navy : T.muted,
              borderRadius: 10, padding: '1px 8px', fontSize: 10, fontWeight: 600,
            }}>
              {counts[t.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Search + filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 220 }}>
          <Search size={14} color={T.muted} style={{ position: 'absolute', left: 12, top: 11 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search description or serial ID…"
            style={{ ...inputStyle(), width: '100%', paddingLeft: 34 }}
          />
        </div>
        <div style={{ minWidth: 220 }}>
          <select
            value={vendorFilter}
            onChange={e => setVendorFilter(e.target.value)}
            style={{ ...inputStyle(), width: '100%' }}
          >
            <option value="">All Vendors</option>
            {vendors.map(v => (
              <option key={v._id} value={v._id}>{v.name} ({v.email})</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Calendar size={13} color={T.muted} />
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle()} />
          <span style={{ color: T.muted, fontSize: 11 }}>to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle()} />
          {(from || to) && (
            <button onClick={() => { setFrom(''); setTo(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted }}>
              <X size={14} />
            </button>
          )}
        </div>
        {(search || vendorFilter || from || to) && (
          <button
            onClick={() => { setSearch(''); setVendorFilter(''); setFrom(''); setTo(''); }}
            style={secondaryBtnStyle}
          >
            <RotateCcw size={13} /> Reset Filters
          </button>
        )}
      </div>

      {error && <p style={{ color: T.red, fontSize: 12, marginBottom: 12 }}>{error}</p>}

      {/* Table */}
      <div style={{ background: 'white', border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden' }}>
        {loading ? (
          <p style={{ textAlign: 'center', padding: 40, color: T.muted, fontSize: 12 }}>
            <Loader2 size={16} className="animate-spin" style={{ marginRight: 8, verticalAlign: 'middle' }} />
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40, color: T.muted, fontSize: 12 }}>No rows in {tab}.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.offwhite, textAlign: 'left' }}>
                {['Serial', 'Vendor', 'Description', 'Qty', 'Price/Unit', 'GST', 'Total', 'Images', 'Status', 'Submitted', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', fontWeight: 500, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10, borderBottom: `1px solid ${T.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row._id} onClick={() => openReview(row)} style={{ cursor: 'pointer', borderBottom: `1px solid ${T.border}` }}
                  onMouseEnter={e => { e.currentTarget.style.background = T.offwhite; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}>
                  <td style={{ padding: '10px 14px', color: T.navy, fontWeight: 500 }}>{row.serialId}</td>
                  <td style={{ padding: '10px 14px' }}>{row.vendor?.name || '—'}</td>
                  <td style={{ padding: '10px 14px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.description}</td>
                  <td style={{ padding: '10px 14px' }}>{row.quantity}</td>
                  <td style={{ padding: '10px 14px' }}>{money(row.pricePerUnit)}</td>
                  <td style={{ padding: '10px 14px' }}>{row.gstRate}%</td>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>{money(row.totalAmount)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    {row.images?.length ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: T.muted }}>
                        <ImageIcon size={12} /> {row.images.length}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ background: STATUS_BADGE[row.status]?.bg, color: STATUS_BADGE[row.status]?.color, borderRadius: 10, padding: '2px 10px', fontSize: 10, fontWeight: 600, textTransform: 'capitalize' }}>
                      {row.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', color: T.muted }}>{fmtDate(row.createdAt)}</td>
                  <td style={{ padding: '10px 14px' }}><ChevronRight size={14} color={T.muted} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Review modal ── */}
      {reviewing && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(14,21,32,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: 'white', width: '100%', maxWidth: 720, maxHeight: '88vh', overflowY: 'auto', borderRadius: 4, padding: 32, boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <h3 style={{ fontFamily: serif, fontSize: 22, fontWeight: 300, color: T.navy, margin: 0 }}>{reviewing.serialId}</h3>
                <p style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>
                  {reviewing.vendor?.name} ({reviewing.vendor?.email}) · {fmtDate(reviewing.createdAt)}
                </p>
              </div>
              <button onClick={() => setReviewing(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted }}><X size={18} /></button>
            </div>

            {reviewing.images?.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                {reviewing.images.map((img, i) => (
                  <img key={i} src={mediaUrl(reviewing._id, img._id)} alt="" onClick={() => setLightboxImage(mediaUrl(reviewing._id, img._id))}
                    style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 3, border: `1px solid ${T.border}`, cursor: 'zoom-in' }} />
                ))}
              </div>
            )}

            <p style={{ fontSize: 12, color: T.text, lineHeight: 1.7, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{reviewing.description}</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16, background: T.offwhite, borderRadius: 3, padding: '12px 14px' }}>
              <div><p style={smallLabel}>Quantity</p><p style={smallValue}>{reviewing.quantity}</p></div>
              <div><p style={smallLabel}>Price/Unit</p><p style={smallValue}>{money(reviewing.pricePerUnit)}</p></div>
              <div><p style={smallLabel}>GST</p><p style={smallValue}>{reviewing.gstRate}%</p></div>
              <div><p style={smallLabel}>Total</p><p style={{ ...smallValue, color: T.gold, fontWeight: 700 }}>{money(reviewing.totalAmount)}</p></div>
            </div>

            {reviewing.commentHistory?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <p style={smallLabel}>Comment History</p>
                {reviewing.commentHistory.map((c, i) => (
                  <div key={i} style={{ padding: '8px 12px', background: T.offwhite, borderRadius: 3, marginBottom: 6 }}>
                    <p style={{ fontSize: 12, color: T.text, margin: 0 }}>{c.text}</p>
                    <p style={{ fontSize: 10, color: T.muted, margin: '2px 0 0' }}>{c.byName} · {fmtDate(c.at)}</p>
                  </div>
                ))}
              </div>
            )}

            {error && <p style={{ fontSize: 12, color: T.red, marginBottom: 12 }}>{error}</p>}

            {reviewing.status === 'ongoing' && (
              <>
                <label style={smallLabel}>Leave a comment (visible to vendor)</label>
                <textarea rows={3} style={{ ...inputStyle(), width: '100%', marginTop: 6, marginBottom: 12, resize: 'none' }}
                  value={commentText} onChange={e => setCommentText(e.target.value)}
                  placeholder="Let the vendor know what needs fixing…" />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={submitApprove} disabled={saving} style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center' }}>
                    <CheckCircle2 size={15} /> {saving ? 'Approving…' : 'Approve → Completed'}
                  </button>
                  <button onClick={submitComment} disabled={saving} style={{ ...secondaryBtnStyle, flex: 1, justifyContent: 'center' }}>
                    <MessageSquare size={15} /> {saving ? 'Saving…' : 'Save Comment'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      {lightboxImage && (
        <div onClick={() => setLightboxImage(null)} style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, cursor: 'zoom-out' }}>
          <img src={lightboxImage} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }} />
        </div>
      )}

      {/* ── Pending vendor approvals modal ── */}
      {showPending && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(14,21,32,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: 'white', width: '100%', maxWidth: 560, maxHeight: '80vh', overflowY: 'auto', borderRadius: 4, padding: 28, boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontFamily: serif, fontSize: 20, fontWeight: 300, color: T.navy, margin: 0 }}>Pending Vendor <em style={{ color: T.gold }}>Approvals.</em></h3>
              <button onClick={() => setShowPending(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted }}><X size={18} /></button>
            </div>
            {pendingVendors.length === 0 ? (
              <p style={{ fontSize: 12, color: T.muted, textAlign: 'center', padding: 20 }}>No pending vendor signups.</p>
            ) : (
              pendingVendors.map(v => (
                <div key={v._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${T.border}` }}>
                  <div>
                    <p style={{ fontSize: 13, color: T.text, margin: 0 }}>{v.name}</p>
                    <p style={{ fontSize: 11, color: T.muted, margin: '2px 0 0' }}>{v.email}</p>
                  </div>
                  <button onClick={() => approveVendorAccess(v._id)} disabled={approvingId === v._id} style={primaryBtnStyle}>
                    {approvingId === v._id ? 'Granting…' : 'Grant Access'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const primaryBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  background: T.gold, color: T.navy, border: 'none', padding: '10px 18px', borderRadius: 2,
  fontFamily: jost, fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer',
};
const secondaryBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  background: 'transparent', color: T.navy, border: `1px solid ${T.border}`, padding: '10px 18px', borderRadius: 2,
  fontFamily: jost, fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer',
};
const smallLabel = { fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 };
const smallValue = { fontSize: 14, color: T.navy, fontWeight: 500, margin: '2px 0 0' };

export default JobWorkAdmin;
