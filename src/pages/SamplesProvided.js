import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../api';
import { createLogger } from '../utils/logger';
import {
  Plus, Trash2, Search, Calendar, Hash, Package,
  Camera, X, CheckCircle2, User, AlertTriangle,
  ClipboardEdit, Upload, Download, File, ExternalLink,
  BriefcaseBusiness, Eye, Edit3, ShieldAlert,
  Image as ImageIcon,
} from 'lucide-react';

const log = createLogger('SamplesProvided');

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
  indigo:  '#4f46e5',
  red:     '#dc2626',
  green:   '#16a34a',
  amber:   '#d97706',
};

const jost  = '"Jost", sans-serif';
const serif = '"Cormorant Garamond", Georgia, serif';

// ── Shared input style ────────────────────────────────────────────────────────
const inputStyle = (focused) => ({
  width: '100%',
  padding: '10px 14px',
  background: 'white',
  border: `1px solid ${focused ? T.gold : T.border}`,
  borderRadius: 3,
  fontFamily: jost,
  fontSize: 13,
  fontWeight: 300,
  color: T.text,
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.2s',
});

const FocusInput = ({ value, onChange, placeholder, type = 'text', disabled = false, style: extra = {} }) => {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{ ...inputStyle(focused), ...extra }}
    />
  );
};

// ── ItemFileDrop ──────────────────────────────────────────────────────────────
const ItemFileDrop = ({ item, onFileSelect, disabled, toBase64 }) => {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

  const handleDrop = async (e) => {
    e.preventDefault();
    if (disabled) return;
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      const base64 = await toBase64(file);
      onFileSelect(base64);
    }
  };

  return (
    <div
      onClick={() => !disabled && inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      style={{
        width: 52,
        height: 52,
        flexShrink: 0,
        borderRadius: 4,
        border: `2px dashed ${isDragging ? T.indigo : T.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer',
        overflow: 'hidden',
        transition: 'border-color 0.2s',
        background: isDragging ? 'rgba(79,70,229,0.04)' : 'transparent',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={async (e) => {
          const file = e.target.files[0];
          if (file) {
            const base64 = await toBase64(file);
            onFileSelect(base64);
          }
        }}
      />
      {item.image ? (
        <img src={item.image} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Item" />
      ) : (
        <Camera size={18} style={{ color: T.muted }} />
      )}
    </div>
  );
};

// ── SamplesProvided ───────────────────────────────────────────────────────────
const SamplesProvided = () => {

  // ── State ──────────────────────────────────────────────────────────────────
  const [challans,          setChallans]          = useState([]);
  const [searchTerm,        setSearchTerm]        = useState('');
  const [clientFilter,      setClientFilter]      = useState('');
  const [dateFilter,        setDateFilter]        = useState('all');
  const [activeTab,         setActiveTab]         = useState('open');
  const [showModal,         setShowModal]         = useState(false);
  const [showSettleConfirm, setShowSettleConfirm] = useState(false);
  const [modalMode,         setModalMode]         = useState('edit');
  const [currentChallan,   setCurrentChallan]    = useState(null);
  const [settleReason,      setSettleReason]      = useState('');
  const [targetSettleId,    setTargetSettleId]    = useState(null);
  const [loading,           setLoading]           = useState(false);
  const [searchFocused,     setSearchFocused]     = useState(false);

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => { fetchChallans(); }, []);

  // ── API helpers ────────────────────────────────────────────────────────────
  const fetchChallans = async () => {
    log.debug('Fetching challans…');
    try {
      const res = await api.get('/challans');
      log.info('Challans loaded', { count: res.data.length });
      setChallans(res.data);
    } catch (err) {
      log.error('Failed to fetch challans', err.message);
    }
  };

  const handleSave = async () => {
    if (!currentChallan.challanNumber || !currentChallan.clientName) return;
    setLoading(true);
    log.info(currentChallan._id ? 'Updating challan' : 'Creating challan', {
      challanNumber: currentChallan.challanNumber,
    });
    try {
      if (currentChallan._id) {
        await api.put(`/challans/${currentChallan._id}`, currentChallan);
      } else {
        await api.post('/challans', currentChallan);
      }
      fetchChallans();
      setShowModal(false);
    } catch (err) {
      log.error('Save failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const initiateSettle = (challan) => {
    log.debug('Initiating settle', { id: challan._id });
    setTargetSettleId(challan._id);
    setSettleReason('');
    setShowSettleConfirm(true);
  };

  const handleSettleConfirm = async () => {
    log.info('Settling challan', { id: targetSettleId });
    try {
      const challan = challans.find(c => c._id === targetSettleId);
      const updatedSamples = challan.samples.map(s => ({
        ...s,
        writeOffRemarks: s.qtyMissing > 0 ? settleReason : s.writeOffRemarks,
      }));
      await api.put(`/challans/${targetSettleId}`, {
        status: 'settled',
        settledAt: new Date(),
        samples: updatedSamples,
        dcAttachments: challan.dcAttachments,
      });
      fetchChallans();
      setShowSettleConfirm(false);
    } catch (err) {
      log.error('Settle failed', err.message);
    }
  };

  // ── Modal openers ──────────────────────────────────────────────────────────
  const openAddModal = () => {
    log.debug('Opening add modal');
    setModalMode('edit');
    setCurrentChallan({
      challanNumber: `CH-${Date.now().toString().slice(-6)}`,
      clientName: '',
      orderedBy: '',
      description: '',
      date: new Date().toISOString().split('T')[0],
      samples: [],
      dcAttachments: [],
      status: 'open',
    });
    setShowModal(true);
  };

  const openEditModal = (challan) => {
    log.debug('Opening edit modal', { id: challan._id });
    setModalMode('edit');
    setCurrentChallan({ ...challan });
    setShowModal(true);
  };

  const openViewModal = (challan) => {
    log.debug('Opening view modal', { id: challan._id });
    setModalMode('view');
    setCurrentChallan({ ...challan });
    setShowModal(true);
  };

  // ── Derived data ───────────────────────────────────────────────────────────
  const filteredChallans = useMemo(() => {
    return challans.filter(c => {
      const matchesTab    = c.status === activeTab;
      const matchesSearch =
        c.challanNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.clientName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesClient = clientFilter === '' || c.clientName === clientFilter;

      let matchesDate = true;
      if (dateFilter === 'older') {
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        matchesDate = new Date(c.date) < oneMonthAgo;
      }
      return matchesTab && matchesSearch && matchesClient && matchesDate;
    });
  }, [challans, activeTab, searchTerm, clientFilter, dateFilter]);

  const clients = useMemo(() => [...new Set(challans.map(c => c.clientName))], [challans]);

  // ── Utilities ──────────────────────────────────────────────────────────────
  const toBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload  = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });

  const isOlderThanMonth = (dateString) => {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    return new Date(dateString) < oneMonthAgo;
  };

  const downloadFile = (file) => {
    log.debug('Downloading file', { name: file.name });
    const link = document.createElement('a');
    link.href     = file.data;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const viewFile = (file) => {
    log.debug('Viewing file', { name: file.name });
    const win = window.open();
    win.document.write(
      `<iframe src="${file.data}" frameborder="0" style="border:0;top:0;left:0;bottom:0;right:0;width:100%;height:100%;" allowfullscreen></iframe>`
    );
  };

  // ── Sample item helpers ────────────────────────────────────────────────────
  const removeItem = (id) => {
    setCurrentChallan(prev => ({
      ...prev,
      samples: prev.samples.filter(s => s.id !== id),
    }));
  };

  const updateItem = (id, field, value) => {
    setCurrentChallan(prev => ({
      ...prev,
      samples: prev.samples.map(s => s.id === id ? { ...s, [field]: value } : s),
    }));
  };

  const handleDCUpload = async (e) => {
    const files = Array.from(e.target.files);
    log.debug('Uploading DC attachments', { count: files.length });
    const newAttachments = await Promise.all(files.map(async (file) => ({
      name: file.name,
      type: file.type,
      size: (file.size / 1024).toFixed(1) + ' KB',
      data: await toBase64(file),
    })));
    setCurrentChallan(prev => ({
      ...prev,
      dcAttachments: [...(prev.dcAttachments || []), ...newAttachments],
    }));
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: T.offwhite, fontFamily: jost, padding: '56px 48px' }}>

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ width: 32, height: 1, background: T.gold, marginBottom: 20 }} />
        <p style={{
          fontSize: 9, fontWeight: 400, letterSpacing: '0.3em',
          textTransform: 'uppercase', color: T.muted, marginBottom: 10,
        }}>
          Asset Management
        </p>
        <h1 style={{
          fontFamily: serif, fontSize: 40, fontWeight: 300,
          color: T.navy, lineHeight: 1.05, margin: '0 0 24px',
        }}>
          Samples <em style={{ color: T.gold }}>Provided.</em>
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
              placeholder="ID or Client Name…"
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
            value={clientFilter}
            onChange={e => setClientFilter(e.target.value)}
            style={{
              padding: '10px 14px', background: 'white',
              border: `1px solid ${T.border}`, borderRadius: 3,
              fontFamily: jost, fontSize: 12, fontWeight: 300,
              color: T.text, outline: 'none', cursor: 'pointer',
            }}
          >
            <option value="">All Clients</option>
            {clients.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Date filter (open tab only) */}
          {activeTab === 'open' && (
            <select
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              style={{
                padding: '10px 14px', background: 'white',
                border: `1px solid ${T.border}`, borderRadius: 3,
                fontFamily: jost, fontSize: 12, fontWeight: 300,
                color: T.text, outline: 'none', cursor: 'pointer',
              }}
            >
              <option value="all">All Dates</option>
              <option value="older">Older than 30 Days</option>
            </select>
          )}

          {/* Create manifest */}
          <button
            onClick={openAddModal}
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
            <Plus size={14} strokeWidth={2.5} /> Create Manifest
          </button>
        </div>
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 0,
        borderBottom: `1px solid ${T.border}`,
        marginBottom: 24,
      }}>
        {['open', 'settled', 'archived'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 24px',
              fontFamily: jost, fontSize: 9, fontWeight: 400,
              letterSpacing: '0.25em', textTransform: 'uppercase',
              color: activeTab === tab ? T.gold : T.muted,
              borderBottom: `2px solid ${activeTab === tab ? T.gold : 'transparent'}`,
              marginBottom: -1,
              transition: 'color 0.2s, border-color 0.2s',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Challan list ─────────────────────────────────────────────────── */}
      <div style={{ background: 'white', border: `1px solid ${T.border}`, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.border}`, background: T.offwhite }}>
              {['Manifest ID', 'Client / Ordered By', 'Date', 'Qty Sent', 'Received', 'Pending', 'Actions'].map((col, i) => (
                <th
                  key={col}
                  style={{
                    padding: '12px 16px',
                    textAlign: i >= 3 && i <= 5 ? 'center' : i === 6 ? 'right' : 'left',
                    fontFamily: jost, fontSize: 9, fontWeight: 400,
                    letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted,
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredChallans.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '64px 0', textAlign: 'center' }}>
                  <Package size={28} style={{ color: 'rgba(0,0,0,0.12)', margin: '0 auto 12px', display: 'block' }} />
                  <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, letterSpacing: '0.1em', color: T.muted }}>
                    No records found
                  </p>
                </td>
              </tr>
            ) : filteredChallans.map(challan => {
              const totals = {
                sent:     challan.samples.reduce((acc, s) => acc + (s.qtySent     || 0), 0),
                received: challan.samples.reduce((acc, s) => acc + (s.qtyReturned || 0), 0),
                pending:  challan.samples.reduce((acc, s) => acc + (s.qtyMissing  || 0), 0),
              };
              const overdue = activeTab === 'open' && isOlderThanMonth(challan.date);

              return (
                <tr
                  key={challan._id}
                  style={{
                    borderBottom: `1px solid ${T.border}`,
                    background: overdue ? 'rgba(220,38,38,0.02)' : 'transparent',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = overdue ? 'rgba(220,38,38,0.04)' : 'rgba(0,0,0,0.015)'}
                  onMouseLeave={e => e.currentTarget.style.background = overdue ? 'rgba(220,38,38,0.02)' : 'transparent'}
                >
                  {/* Manifest ID + overdue badge */}
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Hash size={13} style={{ color: T.muted, flexShrink: 0 }} />
                      <span style={{
                        fontFamily: jost, fontSize: 12, fontWeight: 500,
                        letterSpacing: '0.06em', color: T.text,
                      }}>
                        {challan.challanNumber}
                      </span>
                      {overdue && (
                        <span style={{
                          fontFamily: jost, fontSize: 8, fontWeight: 500,
                          letterSpacing: '0.18em', textTransform: 'uppercase',
                          color: T.red, border: `1px solid rgba(220,38,38,0.3)`,
                          padding: '2px 7px',
                        }}>
                          Overdue
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Client / ordered by */}
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontFamily: jost, fontSize: 12, fontWeight: 500, color: T.text }}>
                        {challan.clientName}
                      </span>
                      {challan.orderedBy && (
                        <span style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted }}>
                          {challan.orderedBy}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Date */}
                  <td style={{ padding: '14px 16px', fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted }}>
                    {new Date(challan.date).toLocaleDateString()}
                  </td>

                  {/* Qty sent */}
                  <td style={{ padding: '14px 16px', textAlign: 'center', fontFamily: jost, fontSize: 12, fontWeight: 500, color: T.text }}>
                    {totals.sent}
                  </td>

                  {/* Received */}
                  <td style={{ padding: '14px 16px', textAlign: 'center', fontFamily: jost, fontSize: 12, fontWeight: 500, color: T.green }}>
                    {totals.received}
                  </td>

                  {/* Pending */}
                  <td style={{ padding: '14px 16px', textAlign: 'center', fontFamily: jost, fontSize: 12, fontWeight: 500, color: totals.pending > 0 ? T.red : T.muted }}>
                    {totals.pending}
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '14px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      onClick={() => openViewModal(challan)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontFamily: jost, fontSize: 9, fontWeight: 400,
                        letterSpacing: '0.2em', textTransform: 'uppercase',
                        color: T.muted, marginRight: 16, transition: 'color 0.2s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = T.gold}
                      onMouseLeave={e => e.currentTarget.style.color = T.muted}
                    >
                      View
                    </button>

                    {activeTab === 'open' && (
                      <>
                        <button
                          onClick={() => openEditModal(challan)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontFamily: jost, fontSize: 9, fontWeight: 400,
                            letterSpacing: '0.2em', textTransform: 'uppercase',
                            color: T.gold, marginRight: 16, transition: 'color 0.2s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = T.gold2}
                          onMouseLeave={e => e.currentTarget.style.color = T.gold}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => initiateSettle(challan)}
                          style={{
                            background: 'none',
                            border: `1px solid rgba(22,163,74,0.3)`,
                            cursor: 'pointer',
                            padding: '4px 14px',
                            fontFamily: jost, fontSize: 9, fontWeight: 400,
                            letterSpacing: '0.2em', textTransform: 'uppercase',
                            color: T.green, transition: 'background 0.2s, border-color 0.2s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(22,163,74,0.06)'; e.currentTarget.style.borderColor = T.green; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = 'rgba(22,163,74,0.3)'; }}
                        >
                          Settle
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Row count footer */}
        <div style={{
          borderTop: `1px solid ${T.border}`,
          padding: '10px 18px',
          fontFamily: jost, fontSize: 10, fontWeight: 300,
          letterSpacing: '0.12em', color: T.muted, textAlign: 'right',
        }}>
          {filteredChallans.length} of {challans.length} manifest{challans.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* ── Manifest Modal ────────────────────────────────────────────────── */}
      {showModal && currentChallan && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(14,21,32,0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, zIndex: 50,
        }}>
          <div style={{
            background: 'white',
            border: `1px solid ${T.border}`,
            width: '100%', maxWidth: 900,
            maxHeight: '90vh', display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>

            {/* Modal header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              padding: '28px 32px', borderBottom: `1px solid ${T.border}`,
              background: T.offwhite,
            }}>
              <div>
                <p style={{
                  fontFamily: jost, fontSize: 9, fontWeight: 400,
                  letterSpacing: '0.28em', textTransform: 'uppercase',
                  color: T.muted, marginBottom: 6,
                }}>
                  {modalMode === 'view' ? 'Viewing Record' : currentChallan._id ? 'Update Record' : 'New Manifest'}
                </p>
                <h2 style={{
                  fontFamily: serif, fontSize: 28, fontWeight: 300,
                  color: T.navy, margin: 0,
                }}>
                  Manifest: {currentChallan.challanNumber}
                </h2>
              </div>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: T.muted, fontSize: 20, lineHeight: 1, padding: 4,
                  transition: 'color 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = T.text}
                onMouseLeave={e => e.currentTarget.style.color = T.muted}
              >
                ✕
              </button>
            </div>

            {/* Modal body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 40 }}>

                {/* ── Left column: Details + Attachments ─────────────────── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

                  {/* Details section */}
                  <section>
                    <p style={{
                      fontFamily: jost, fontSize: 9, fontWeight: 400,
                      letterSpacing: '0.28em', textTransform: 'uppercase',
                      color: 'rgba(184,151,90,0.65)', marginBottom: 14,
                    }}>
                      Details
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <FocusInput
                        value={currentChallan.clientName}
                        onChange={e => setCurrentChallan(prev => ({ ...prev, clientName: e.target.value }))}
                        placeholder="Client Name"
                        disabled={modalMode === 'view'}
                      />
                      <FocusInput
                        value={currentChallan.orderedBy || ''}
                        onChange={e => setCurrentChallan(prev => ({ ...prev, orderedBy: e.target.value }))}
                        placeholder="Ordered By"
                        disabled={modalMode === 'view'}
                      />
                      <FocusInput
                        type="date"
                        value={currentChallan.date?.split('T')[0]}
                        onChange={e => setCurrentChallan(prev => ({ ...prev, date: e.target.value }))}
                        disabled={modalMode === 'view'}
                      />
                    </div>
                  </section>

                  {/* DC Attachments section */}
                  <section>
                    <p style={{
                      fontFamily: jost, fontSize: 9, fontWeight: 400,
                      letterSpacing: '0.28em', textTransform: 'uppercase',
                      color: 'rgba(184,151,90,0.65)', marginBottom: 14,
                    }}>
                      DC Attachments
                    </p>

                    {modalMode !== 'view' && (
                      <label style={{
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        height: 80,
                        border: `2px dashed ${T.border}`,
                        cursor: 'pointer', marginBottom: 10,
                        transition: 'border-color 0.2s',
                      }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = T.gold}
                        onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
                      >
                        <Upload size={18} style={{ color: T.muted, marginBottom: 4 }} />
                        <p style={{
                          fontFamily: jost, fontSize: 9, fontWeight: 400,
                          letterSpacing: '0.2em', textTransform: 'uppercase', color: T.muted,
                        }}>
                          Drop or Click
                        </p>
                        <input type="file" multiple hidden onChange={handleDCUpload} accept="image/*,.pdf" />
                      </label>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {currentChallan.dcAttachments?.map((file, idx) => (
                        <div key={idx} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 12px',
                          background: T.offwhite, border: `1px solid ${T.border}`,
                        }}>
                          {file.type.includes('pdf')
                            ? <File size={14} style={{ color: T.red, flexShrink: 0 }} />
                            : <ImageIcon size={14} style={{ color: T.indigo, flexShrink: 0 }} />
                          }
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{
                              fontFamily: jost, fontSize: 11, fontWeight: 500,
                              color: T.text, margin: 0,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {file.name}
                            </p>
                            <p style={{ fontFamily: jost, fontSize: 9, fontWeight: 300, color: T.muted, margin: 0 }}>
                              {file.size}
                            </p>
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => viewFile(file)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, transition: 'color 0.2s' }}
                              onMouseEnter={e => e.currentTarget.style.color = T.gold}
                              onMouseLeave={e => e.currentTarget.style.color = T.muted}
                            ><ExternalLink size={13} /></button>
                            <button onClick={() => downloadFile(file)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, transition: 'color 0.2s' }}
                              onMouseEnter={e => e.currentTarget.style.color = T.gold}
                              onMouseLeave={e => e.currentTarget.style.color = T.muted}
                            ><Download size={13} /></button>
                            {modalMode !== 'view' && (
                              <button
                                onClick={() => setCurrentChallan(prev => ({
                                  ...prev,
                                  dcAttachments: prev.dcAttachments.filter((_, i) => i !== idx),
                                }))}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, transition: 'color 0.2s' }}
                                onMouseEnter={e => e.currentTarget.style.color = T.red}
                                onMouseLeave={e => e.currentTarget.style.color = T.muted}
                              ><X size={13} /></button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                {/* ── Right column: Item Table ────────────────────────────── */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <p style={{
                      fontFamily: jost, fontSize: 9, fontWeight: 400,
                      letterSpacing: '0.28em', textTransform: 'uppercase',
                      color: 'rgba(184,151,90,0.65)', margin: 0,
                    }}>
                      Item Table
                    </p>
                    {modalMode !== 'view' && (
                      <button
                        onClick={() => setCurrentChallan(prev => ({
                          ...prev,
                          samples: [...prev.samples, {
                            id: Date.now(), name: '', qtySent: 1,
                            qtyReturned: 0, qtyMissing: 0, image: '', writeOffRemarks: '',
                          }],
                        }))}
                        style={{
                          background: 'none',
                          border: `1px solid ${T.borderG}`,
                          cursor: 'pointer', padding: '5px 14px',
                          fontFamily: jost, fontSize: 9, fontWeight: 400,
                          letterSpacing: '0.2em', textTransform: 'uppercase',
                          color: T.gold, transition: 'background 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = T.dimBg}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        + Add Item
                      </button>
                    )}
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                          {['Item Description', 'Qty Sent', 'Qty Received', 'Qty Pending', ...(modalMode !== 'view' ? [''] : [])].map((col, i) => (
                            <th
                              key={i}
                              style={{
                                padding: '10px 12px',
                                textAlign: i > 0 && i < 4 ? 'center' : 'left',
                                fontFamily: jost, fontSize: 9, fontWeight: 400,
                                letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted,
                              }}
                            >
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {currentChallan.samples.map((item) => (
                          <React.Fragment key={item.id}>
                            <tr style={{ borderBottom: `1px solid ${T.border}` }}>

                              {/* Item description + image */}
                              <td style={{ padding: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                  <ItemFileDrop
                                    item={item}
                                    disabled={modalMode === 'view'}
                                    toBase64={toBase64}
                                    onFileSelect={(data) => updateItem(item.id, 'image', data)}
                                  />
                                  <input
                                    placeholder="Name…"
                                    disabled={modalMode === 'view'}
                                    value={item.name}
                                    onChange={e => updateItem(item.id, 'name', e.target.value)}
                                    style={{
                                      background: 'transparent', border: 'none',
                                      fontFamily: jost, fontSize: 13, fontWeight: 500,
                                      color: T.text, outline: 'none', width: '100%',
                                    }}
                                  />
                                </div>
                              </td>

                              {/* Qty sent */}
                              <td style={{ padding: '12px', textAlign: 'center' }}>
                                <input
                                  type="number"
                                  disabled={modalMode === 'view'}
                                  value={item.qtySent}
                                  onChange={e => {
                                    const s = parseInt(e.target.value) || 0;
                                    updateItem(item.id, 'qtySent', s);
                                    updateItem(item.id, 'qtyMissing', Math.max(0, s - item.qtyReturned));
                                  }}
                                  style={{
                                    width: 56, padding: '6px', textAlign: 'center',
                                    background: T.offwhite, border: `1px solid ${T.border}`,
                                    borderRadius: 2,
                                    fontFamily: jost, fontSize: 12, fontWeight: 500,
                                    color: T.text, outline: 'none',
                                  }}
                                />
                              </td>

                              {/* Qty received */}
                              <td style={{ padding: '12px', textAlign: 'center' }}>
                                <input
                                  type="number"
                                  disabled={modalMode === 'view'}
                                  value={item.qtyReturned}
                                  onChange={e => {
                                    const r = parseInt(e.target.value) || 0;
                                    updateItem(item.id, 'qtyReturned', r);
                                    updateItem(item.id, 'qtyMissing', Math.max(0, item.qtySent - r));
                                  }}
                                  style={{
                                    width: 56, padding: '6px', textAlign: 'center',
                                    background: 'rgba(22,163,74,0.06)', border: `1px solid rgba(22,163,74,0.2)`,
                                    borderRadius: 2,
                                    fontFamily: jost, fontSize: 12, fontWeight: 500,
                                    color: T.green, outline: 'none',
                                  }}
                                />
                              </td>

                              {/* Qty pending */}
                              <td style={{ padding: '12px', textAlign: 'center' }}>
                                <span style={{
                                  fontFamily: jost, fontSize: 12, fontWeight: 500,
                                  color: item.qtyMissing > 0 ? T.red : T.muted,
                                }}>
                                  {item.qtyMissing}
                                </span>
                              </td>

                              {/* Delete action */}
                              {modalMode !== 'view' && (
                                <td style={{ padding: '12px', textAlign: 'right' }}>
                                  <button
                                    onClick={() => removeItem(item.id)}
                                    style={{
                                      background: 'none', border: 'none', cursor: 'pointer',
                                      color: T.muted, transition: 'color 0.2s',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.color = T.red}
                                    onMouseLeave={e => e.currentTarget.style.color = T.muted}
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </td>
                              )}
                            </tr>

                            {/* Write-off remark row */}
                            {item.writeOffRemarks && (modalMode === 'view' || activeTab !== 'open') && (
                              <tr>
                                <td colSpan={5} style={{ paddingBottom: 10, paddingLeft: 12 }}>
                                  <div style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    padding: '6px 10px',
                                    background: 'rgba(217,119,6,0.06)',
                                    border: `1px solid rgba(217,119,6,0.18)`,
                                    fontFamily: jost, fontSize: 10, fontWeight: 400,
                                    color: T.amber,
                                  }}>
                                    <AlertTriangle size={11} /> Write-off Reason: {item.writeOffRemarks}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '20px 32px', borderTop: `1px solid ${T.border}`,
              background: T.offwhite,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.2em', textTransform: 'uppercase', color: T.muted,
              }}>
                <ShieldAlert size={12} style={{ color: T.gold }} /> Digital audit trail active
              </div>
              <div style={{ display: 'flex', gap: 14 }}>
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
                  {modalMode === 'view' ? 'Close' : 'Discard'}
                </button>
                {modalMode === 'edit' && (
                  <button
                    onClick={handleSave}
                    disabled={loading}
                    style={{
                      background: T.gold, color: T.navy,
                      border: 'none', padding: '12px 36px',
                      fontFamily: jost, fontSize: 10, fontWeight: 500,
                      letterSpacing: '0.22em', textTransform: 'uppercase',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      opacity: loading ? 0.7 : 1,
                      transition: 'background 0.25s',
                    }}
                    onMouseEnter={e => { if (!loading) e.currentTarget.style.background = T.gold2; }}
                    onMouseLeave={e => { if (!loading) e.currentTarget.style.background = T.gold; }}
                  >
                    {loading ? 'Saving…' : 'Confirm Save'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Settle Confirmation Modal ─────────────────────────────────────── */}
      {showSettleConfirm && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(14,21,32,0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, zIndex: 60,
        }}>
          <div style={{
            background: 'white',
            border: `1px solid ${T.border}`,
            padding: '36px 36px 28px',
            width: '100%', maxWidth: 460,
          }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{
                display: 'inline-flex', padding: 14,
                background: 'rgba(22,163,74,0.08)',
                marginBottom: 16,
              }}>
                <CheckCircle2 size={28} style={{ color: T.green }} />
              </div>
              <h3 style={{
                fontFamily: serif, fontSize: 26, fontWeight: 300,
                color: T.navy, margin: '0 0 8px',
              }}>
                Settle Manifest
              </h3>
              <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted, margin: 0 }}>
                Are you sure you want to finalize this record?
              </p>
            </div>

            {challans.find(c => c._id === targetSettleId)?.samples.some(s => s.qtyMissing > 0) && (
              <div style={{ marginBottom: 20 }}>
                <label style={{
                  display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400,
                  letterSpacing: '0.25em', textTransform: 'uppercase',
                  color: T.muted, marginBottom: 8,
                }}>
                  Write-off Reason (Pending Items Exist)
                </label>
                <textarea
                  autoFocus
                  placeholder="Enter reason for missing items…"
                  value={settleReason}
                  onChange={e => setSettleReason(e.target.value)}
                  style={{
                    width: '100%', padding: '12px 14px',
                    background: T.offwhite, border: `1px solid ${T.border}`,
                    borderRadius: 2,
                    fontFamily: jost, fontSize: 13, fontWeight: 300,
                    color: T.text, outline: 'none', resize: 'none',
                    height: 88, boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 14, borderTop: `1px solid ${T.border}`, paddingTop: 20 }}>
              <button
                onClick={() => setShowSettleConfirm(false)}
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
                onClick={handleSettleConfirm}
                style={{
                  background: T.gold, color: T.navy,
                  border: 'none', padding: '12px 36px',
                  fontFamily: jost, fontSize: 10, fontWeight: 500,
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  cursor: 'pointer', transition: 'background 0.25s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.gold2}
                onMouseLeave={e => e.currentTarget.style.background = T.gold}
              >
                Yes, Settle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SamplesProvided;