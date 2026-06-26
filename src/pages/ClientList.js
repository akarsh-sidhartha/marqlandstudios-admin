import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../api';
import { createLogger } from '../utils/logger';
import { SectionLoader, SkeletonList } from '../components/PageLoader';
import { Download, Search, ChevronDown, ChevronRight, Edit2, Trash2, Building2 } from 'lucide-react';

const log = createLogger('ClientList');

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
};
const jost  = '"Jost", sans-serif';
const serif = '"Cormorant Garamond", Georgia, serif';

// ── Shared input style ────────────────────────────────────────────────────────
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

const FocusInput = ({ value, onChange, placeholder, style: extra = {} }) => {
  const [focused, setFocused] = useState(false);
  return (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{ ...inputStyle(focused), ...extra }}
    />
  );
};

// ── ClientList ────────────────────────────────────────────────────────────────
const ClientList = () => {
  const [clients, setClients]           = useState([]);
  const [isLoading, setIsLoading]       = useState(true);
  const [searchTerm, setSearchTerm]     = useState('');
  const [expandedRows, setExpandedRows] = useState([]);
  const [showModal, setShowModal]       = useState(false);
  const [isEditing, setIsEditing]       = useState(false);
  const [currentId, setCurrentId]       = useState(null);
  const [highlightId, setHighlightId]   = useState(null);   // briefly highlights a matched row
  const [sortOrder, setSortOrder]       = useState('asc');
  const [searchFocused, setSearchFocused] = useState(false);

  const [formData, setFormData] = useState({
    companyName: '',
    contacts: [{ name: '', phone: '', email: '' }],
  });

  // ── Move-contact modal state ───────────────────────────────────────────────
  const [moveModal, setMoveModal]         = useState(false);
  const [moveContact, setMoveContact]     = useState(null);   // { name, phone, email }
  const [moveFromId, setMoveFromId]       = useState(null);
  const [moveToId, setMoveToId]           = useState('');
  const [moveNewEmail, setMoveNewEmail]   = useState('');
  const [moveToFocused, setMoveToFocused] = useState(false);
  const [moveEmailFocused, setMoveEmailFocused] = useState(false);

  useEffect(() => { fetchClients(); }, []);

  const fetchClients = async () => {
    log.debug('Fetching clients…');
    setIsLoading(true);
    try {
      const res = await api.get('/clients');
      log.info('Clients loaded', { count: res.data.length });
      setClients(res.data);
    } catch (err) {
      log.error('Failed to fetch clients', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const processClients = () => {
    const s = searchTerm.toLowerCase();
    return clients
      .filter(c =>
        c.companyName?.toLowerCase().includes(s) ||
        c.contacts?.some(ct => ct.name?.toLowerCase().includes(s))
      )
      .sort((a, b) => {
        const na = a.companyName.toLowerCase();
        const nb = b.companyName.toLowerCase();
        return sortOrder === 'asc' ? (na < nb ? -1 : 1) : (na > nb ? -1 : 1);
      });
  };

  const filteredClients = processClients();

  const toggleSort  = () => setSortOrder(p => p === 'asc' ? 'desc' : 'asc');
  const toggleRow   = (id) => setExpandedRows(p => p.includes(id) ? p.filter(r => r !== id) : [...p, id]);

  const handleContactChange = (index, field, value) => {
    const updated = [...formData.contacts];
    updated[index][field] = value;
    setFormData({ ...formData, contacts: updated });
  };

  const handleAddContactRow    = () => setFormData({ ...formData, contacts: [...formData.contacts, { name: '', phone: '', email: '' }] });
  const handleRemoveContactRow = (index) => {
    const updated = formData.contacts.filter((_, i) => i !== index);
    setFormData({ ...formData, contacts: updated.length > 0 ? updated : [{ name: '', phone: '', email: '' }] });
  };

  const handleDelete = async (id, name, e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete client "${name}"?`)) return;
    log.info('Deleting client', { id, name });
    try {
      await api.delete(`/clients/${id}`);
      fetchClients();
    } catch (err) {
      log.error('Delete failed', err.message);
      alert('Failed to delete client.');
    }
  };

  const handleEdit = (client, e) => {
    e.stopPropagation();
    setIsEditing(true);
    setCurrentId(client._id);
    setFormData({
      companyName: client.companyName,
      contacts: client.contacts.length > 0 ? client.contacts : [{ name: '', phone: '', email: '' }],
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    log.info(isEditing ? 'Updating client' : 'Creating client', { companyName: formData.companyName });
    try {
      if (isEditing) await api.put(`/clients/${currentId}`, formData);
      else            await api.post('/clients', formData);
      setShowModal(false);
      resetForm();
      fetchClients();
    } catch (err) {
      log.error('Save failed', err.message);
      alert('Error saving client.');
    }
  };

  const exportToExcel = () => {
    log.debug('Exporting clients to CSV');
    const headers = ['Company Name', 'Contact Person', 'Phone', 'Email'];
    const rows = clients
      .filter(c => c.companyName.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => sortOrder === 'asc' ? a.companyName.localeCompare(b.companyName) : b.companyName.localeCompare(a.companyName))
      .flatMap(c => c.contacts.map(ct => [c.companyName, ct.name, ct.phone, ct.email]));
    const csv = 'data:text/csv;charset=utf-8,' +
      [headers, ...rows].map(r => r.map(v => `"${v || ''}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = encodeURI(csv);
    a.download = `Client_List_${new Date().toLocaleDateString()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const resetForm = () => {
    setFormData({ companyName: '', contacts: [{ name: '', phone: '', email: '' }] });
    setIsEditing(false);
    setCurrentId(null);
  };

  // ── Move contact ───────────────────────────────────────────────────────────
  const openMoveModal = (contact, clientId, e) => {
    e.stopPropagation();
    setMoveContact(contact);
    setMoveFromId(clientId);
    setMoveToId('');
    setMoveNewEmail(contact.email || '');
    setMoveModal(true);
  };

  const handleMoveContact = async () => {
    if (!moveToId) return alert('Please select a destination client.');
    try {
      await api.patch('/clients/move-contact', {
        fromClientId: moveFromId,
        contactName:  moveContact.name,
        toClientId:   moveToId,
        newEmail:     moveNewEmail,
      });
      setMoveModal(false);
      fetchClients();
    } catch (err) {
      log.error('Move contact failed', err.message);
      alert(err.response?.data?.message || 'Failed to move contact.');
    }
  };

  // ── Duplicate client detection ─────────────────────────────────────────────
  // Active only when adding (not editing). Flags clients whose name is "close"
  // to what is being typed via substring match or shared meaningful tokens.
  const NOISE_WORDS = /^(pvt|ltd|llp|inc|corp|co|and|the|a|of|enterprises?|solutions?|services?|india|group)$/i;
  const nameTokens  = (str) =>
    str.toLowerCase().split(/[\s,.()\/\-]+/).filter(w => w.length > 1 && !NOISE_WORDS.test(w));

  const duplicateMatches = useMemo(() => {
    if (isEditing) return [];
    const raw = formData.companyName.trim();
    if (raw.length < 3) return [];
    const inputLow    = raw.toLowerCase();
    const inputToks   = nameTokens(raw);
    return clients.filter(c => {
      const nameLow  = c.companyName?.toLowerCase() ?? '';
      const nameToks = nameTokens(c.companyName ?? '');
      if (nameLow.includes(inputLow) || inputLow.includes(nameLow)) return true;
      return inputToks.length > 0 && nameToks.length > 0 &&
        inputToks.some(t => nameToks.includes(t));
    });
  }, [formData.companyName, clients, isEditing]);

  // Close modal, set search to the matched client, scroll + flash the row.
  const handleJumpToClient = (client) => {
    setShowModal(false);
    resetForm();
    setSearchTerm(client.companyName);
    setHighlightId(client._id);
    setTimeout(() => {
      const el = document.getElementById(`client-row-${client._id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    setTimeout(() => setHighlightId(null), 2500);
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
          Documentation
        </p>
        <h1 style={{
          fontFamily: serif, fontSize: 40, fontWeight: 300,
          color: T.navy, lineHeight: 1.05, margin: '0 0 24px',
        }}>
          Client <em style={{ color: T.gold }}>Management.</em>
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
              placeholder="Search by company or contact…"
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

          {/* Add client */}
          <button
            onClick={() => { resetForm(); setShowModal(true); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: T.gold, color: T.navy,
              border: 'none', padding: '11px 28px',
              fontFamily: jost, fontSize: 10, fontWeight: 500,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              cursor: 'pointer', transition: 'background 0.25s',
              flexShrink: 0,
            }}
            onMouseEnter={e => e.currentTarget.style.background = T.gold2}
            onMouseLeave={e => e.currentTarget.style.background = T.gold}
          >
            + Add Client
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
              cursor: 'pointer', transition: 'border-color 0.25s, color 0.25s',
              flexShrink: 0,
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

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div style={{
        background: 'white',
        border: `1px solid ${T.border}`,
        overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{
              borderBottom: `1px solid ${T.border}`,
              background: T.offwhite,
            }}>
              {/* Expand toggle col */}
              <th style={{ width: 44, padding: '12px 16px' }} />
              <th
                onClick={toggleSort}
                style={{
                  padding: '12px 16px', textAlign: 'left',
                  fontFamily: jost, fontSize: 9, fontWeight: 400,
                  letterSpacing: '0.25em', textTransform: 'uppercase',
                  color: T.muted, cursor: 'pointer', userSelect: 'none',
                  transition: 'color 0.2s',
                  whiteSpace: 'nowrap',
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
              <SkeletonList rows={8} cols={4} />
            ) : filteredClients.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: '64px 0', textAlign: 'center' }}>
                  <Building2 size={28} style={{ color: 'rgba(0,0,0,0.12)', margin: '0 auto 12px', display: 'block' }} />
                  <p style={{
                    fontFamily: jost, fontSize: 12, fontWeight: 300,
                    letterSpacing: '0.1em', color: T.muted,
                  }}>
                    No clients found
                  </p>
                </td>
              </tr>
            ) : filteredClients.map(c => {
              const isExpanded = expandedRows.includes(c._id);
              return (
                <React.Fragment key={c._id}>
                  <tr
                    id={`client-row-${c._id}`}
                    onClick={() => toggleRow(c._id)}
                    style={{
                      cursor: 'pointer',
                      borderBottom: `1px solid ${T.border}`,
                      background: highlightId === c._id
                        ? '#fffbeb'
                        : isExpanded ? T.dimBg : 'transparent',
                      outline: highlightId === c._id ? '2px solid #f59e0b' : 'none',
                      outlineOffset: -2,
                      transition: 'background 0.4s, outline 0.4s',
                    }}
                    onMouseEnter={e => { if (!isExpanded && highlightId !== c._id) e.currentTarget.style.background = 'rgba(0,0,0,0.015)'; }}
                    onMouseLeave={e => { if (!isExpanded && highlightId !== c._id) e.currentTarget.style.background = isExpanded ? T.dimBg : 'transparent'; }}
                  >
                    <td style={{ padding: '14px 16px', textAlign: 'center', width: 44 }}>
                      {isExpanded
                        ? <ChevronDown size={13} style={{ color: T.gold }} />
                        : <ChevronRight size={13} style={{ color: T.muted }} />}
                    </td>
                    <td style={{
                      padding: '14px 16px',
                      fontFamily: jost, fontSize: 12, fontWeight: 500,
                      letterSpacing: '0.06em', textTransform: 'uppercase',
                      color: T.text,
                    }}>
                      {c.companyName}
                    </td>
                    <td style={{
                      padding: '14px 16px',
                      fontFamily: jost, fontSize: 12, fontWeight: 300,
                      color: T.muted,
                    }}>
                      {c.contacts[0]?.name || '—'}
                      {c.contacts.length > 1 && (
                        <span style={{
                          marginLeft: 8,
                          fontFamily: jost, fontSize: 9, fontWeight: 400,
                          letterSpacing: '0.15em', textTransform: 'uppercase',
                          color: T.gold, border: `1px solid ${T.borderG}`,
                          padding: '2px 7px',
                        }}>
                          +{c.contacts.length - 1}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <button
                        onClick={e => handleEdit(c, e)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          fontFamily: jost, fontSize: 9, fontWeight: 400,
                          letterSpacing: '0.2em', textTransform: 'uppercase',
                          color: T.gold, marginRight: 20,
                          transition: 'color 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = T.gold2}
                        onMouseLeave={e => e.currentTarget.style.color = T.gold}
                      >
                        Edit
                      </button>
                      <button
                        onClick={e => handleDelete(c._id, c.companyName, e)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          fontFamily: jost, fontSize: 9, fontWeight: 400,
                          letterSpacing: '0.2em', textTransform: 'uppercase',
                          color: 'rgba(220,38,38,0.6)', transition: 'color 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                        onMouseLeave={e => e.currentTarget.style.color = 'rgba(220,38,38,0.6)'}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>

                  {/* Expanded contact directory */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={4} style={{
                        padding: '24px 24px 24px 48px',
                        borderBottom: `1px solid ${T.border}`,
                        background: T.dimBg,
                      }}>
                        <p style={{
                          fontFamily: jost, fontSize: 9, fontWeight: 400,
                          letterSpacing: '0.28em', textTransform: 'uppercase',
                          color: 'rgba(184,151,90,0.6)', marginBottom: 16,
                        }}>
                          Full Contact Directory
                        </p>
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                          gap: 12,
                        }}>
                          {c.contacts.map((contact, idx) => (
                            <div key={idx} style={{
                              background: 'white',
                              border: `1px solid ${T.border}`,
                              padding: '16px 18px',
                              display: 'flex', flexDirection: 'column', gap: 5,
                              position: 'relative',
                            }}>
                              <p style={{
                                fontFamily: jost, fontSize: 12, fontWeight: 500,
                                color: T.text, margin: 0,
                              }}>
                                {contact.name}
                              </p>
                              <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted, margin: 0 }}>
                                {contact.phone || 'No phone'}
                              </p>
                              <p style={{
                                fontFamily: jost, fontSize: 11, fontWeight: 300,
                                color: T.muted, margin: 0,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                                {contact.email || 'No email'}
                              </p>
                              {/* Move contact button */}
                              <button
                                onClick={e => openMoveModal(contact, c._id, e)}
                                title="Move to another client"
                                style={{
                                  position: 'absolute', top: 10, right: 10,
                                  background: 'none', border: `1px solid ${T.borderG}`,
                                  cursor: 'pointer', color: T.gold,
                                  fontFamily: jost, fontSize: 9, fontWeight: 400,
                                  letterSpacing: '0.15em', textTransform: 'uppercase',
                                  padding: '3px 8px',
                                  transition: 'background 0.15s, color 0.15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = T.dimBg; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                              >
                                Move →
                              </button>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>

        {/* Row count footer */}
        {!isLoading && (
          <div style={{
            borderTop: `1px solid ${T.border}`,
            padding: '10px 18px',
            fontFamily: jost, fontSize: 10, fontWeight: 300,
            letterSpacing: '0.12em', color: T.muted,
            textAlign: 'right',
          }}>
            {filteredClients.length} of {clients.length} client{clients.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* ── Modal ────────────────────────────────────────────────────── */}
      {showModal && (
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
            padding: '36px 36px 28px',
            width: '100%', maxWidth: 580,
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
                <h2 style={{
                  fontFamily: serif, fontSize: 28, fontWeight: 300,
                  color: T.navy, margin: 0,
                }}>
                  {isEditing ? 'Edit Client' : 'Add Client'}
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

            {/* Company name */}
            <div style={{ marginBottom: 24 }}>
              <label style={{
                display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.25em', textTransform: 'uppercase',
                color: T.muted, marginBottom: 8,
              }}>
                Company Name
              </label>
              <FocusInput
                value={formData.companyName}
                onChange={e => setFormData({ ...formData, companyName: e.target.value })}
                placeholder="Company name"
              />
            </div>

            {/* ── Duplicate client warning ── */}
            {!isEditing && duplicateMatches.length > 0 && (
              <div style={{
                marginBottom: 20,
                background: '#fffbeb',
                border: '1px solid #f59e0b',
                padding: '12px 14px',
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>⚠️</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    margin: '0 0 8px', fontFamily: jost, fontSize: 11, fontWeight: 500,
                    color: '#92400e', letterSpacing: '0.02em',
                  }}>
                    {duplicateMatches.length === 1
                      ? 'A similar client may already exist'
                      : `${duplicateMatches.length} similar clients may already exist`}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {duplicateMatches.map(c => (
                      <div key={c._id} style={{
                        display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between', gap: 8,
                      }}>
                        <span style={{
                          fontFamily: jost, fontSize: 11, fontWeight: 300, color: '#78350f',
                          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {c.companyName}
                          {c.contacts?.[0]?.name
                            ? <span style={{ color: '#a16207', marginLeft: 6 }}>· {c.contacts[0].name}</span>
                            : null}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleJumpToClient(c)}
                          style={{
                            flexShrink: 0,
                            background: 'none', border: '1px solid #f59e0b',
                            color: '#92400e', cursor: 'pointer',
                            fontFamily: jost, fontSize: 9, fontWeight: 500,
                            letterSpacing: '0.15em', textTransform: 'uppercase',
                            padding: '3px 10px', whiteSpace: 'nowrap',
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
                    You can still proceed if this is a different client.
                  </p>
                </div>
              </div>
            )}

            {/* Contacts */}
            <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 24 }}>
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
                  onClick={handleAddContactRow}
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
                {formData.contacts.map((contact, index) => (
                  <div key={index} style={{
                    display: 'flex', gap: 10, alignItems: 'center',
                    padding: '14px 16px',
                    background: T.offwhite,
                    border: `1px solid ${T.border}`,
                  }}>
                    <div style={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                      gap: 10, flex: 1,
                    }}>
                      {['name', 'phone', 'email'].map(field => (
                        <FocusInput
                          key={field}
                          value={contact[field]}
                          onChange={e => handleContactChange(index, field, e.target.value)}
                          placeholder={field.charAt(0).toUpperCase() + field.slice(1)}
                          style={{ fontSize: 12 }}
                        />
                      ))}
                    </div>
                    <button
                      onClick={() => handleRemoveContactRow(index)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: T.muted, fontSize: 16, lineHeight: 1, flexShrink: 0,
                        transition: 'color 0.2s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                      onMouseLeave={e => e.currentTarget.style.color = T.muted}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer actions */}
            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: 14,
              borderTop: `1px solid ${T.border}`, marginTop: 28, paddingTop: 24,
            }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: jost, fontSize: 10, fontWeight: 400,
                  letterSpacing: '0.2em', textTransform: 'uppercase',
                  color: T.muted, padding: '10px 20px',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = T.text}
                onMouseLeave={e => e.currentTarget.style.color = T.muted}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
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
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Move Contact Modal ───────────────────────────────────────── */}
      {moveModal && moveContact && (
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
            width: '100%', maxWidth: 480,
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              marginBottom: 28, paddingBottom: 20, borderBottom: `1px solid ${T.border}`,
            }}>
              <div>
                <p style={{
                  fontFamily: jost, fontSize: 9, fontWeight: 400,
                  letterSpacing: '0.28em', textTransform: 'uppercase',
                  color: T.muted, marginBottom: 6,
                }}>
                  Reassign Employee
                </p>
                <h2 style={{ fontFamily: serif, fontSize: 26, fontWeight: 300, color: T.navy, margin: 0 }}>
                  Move Contact
                </h2>
              </div>
              <button
                onClick={() => setMoveModal(false)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: T.muted, fontSize: 20, lineHeight: 1, padding: 4,
                  transition: 'color 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = T.text}
                onMouseLeave={e => e.currentTarget.style.color = T.muted}
              >✕</button>
            </div>

            {/* Contact summary */}
            <div style={{
              background: T.dimBg,
              border: `1px solid ${T.borderG}`,
              padding: '14px 16px',
              marginBottom: 24,
            }}>
              <p style={{ fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.22em', textTransform: 'uppercase', color: T.gold, margin: '0 0 8px' }}>
                Contact Being Moved
              </p>
              <p style={{ fontFamily: jost, fontSize: 13, fontWeight: 500, color: T.text, margin: '0 0 3px' }}>
                {moveContact.name}
              </p>
              <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted, margin: 0 }}>
                {moveContact.phone || 'No phone'} · {moveContact.email || 'No email'}
              </p>
              <p style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted, margin: '6px 0 0' }}>
                From: <strong style={{ color: T.text }}>
                  {clients.find(c => c._id === moveFromId)?.companyName || '—'}
                </strong>
              </p>
            </div>

            {/* Destination dropdown */}
            <div style={{ marginBottom: 18 }}>
              <label style={{
                display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.25em', textTransform: 'uppercase',
                color: T.muted, marginBottom: 8,
              }}>
                Destination Client
              </label>
              <select
                value={moveToId}
                onChange={e => setMoveToId(e.target.value)}
                onFocus={() => setMoveToFocused(true)}
                onBlur={() => setMoveToFocused(false)}
                style={{
                  width: '100%', padding: '10px 14px',
                  background: 'white',
                  border: `1px solid ${moveToFocused ? T.gold : T.border}`,
                  borderRadius: 3,
                  fontFamily: jost, fontSize: 13, fontWeight: 300,
                  color: moveToId ? T.text : T.muted,
                  outline: 'none', boxSizing: 'border-box',
                  transition: 'border-color 0.2s', cursor: 'pointer',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 12px center',
                  paddingRight: 36,
                }}
              >
                <option value="">Select destination client…</option>
                {clients
                  .filter(c => c._id !== moveFromId)
                  .sort((a, b) => a.companyName.localeCompare(b.companyName))
                  .map(c => (
                    <option key={c._id} value={c._id}>{c.companyName}</option>
                  ))
                }
              </select>
            </div>

            {/* New email (optional) */}
            <div style={{ marginBottom: 28 }}>
              <label style={{
                display: 'block', fontFamily: jost, fontSize: 9, fontWeight: 400,
                letterSpacing: '0.25em', textTransform: 'uppercase',
                color: T.muted, marginBottom: 8,
              }}>
                Update Email Address <span style={{ letterSpacing: 0, textTransform: 'none', fontWeight: 300, fontSize: 10 }}>(optional)</span>
              </label>
              <input
                type="email"
                value={moveNewEmail}
                onChange={e => setMoveNewEmail(e.target.value)}
                placeholder={moveContact.email || 'New email at destination…'}
                onFocus={() => setMoveEmailFocused(true)}
                onBlur={() => setMoveEmailFocused(false)}
                style={{
                  width: '100%', padding: '10px 14px',
                  background: 'white',
                  border: `1px solid ${moveEmailFocused ? T.gold : T.border}`,
                  borderRadius: 3,
                  fontFamily: jost, fontSize: 13, fontWeight: 300,
                  color: T.text, outline: 'none',
                  boxSizing: 'border-box', transition: 'border-color 0.2s',
                }}
              />
            </div>

            {/* Footer */}
            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: 14,
              borderTop: `1px solid ${T.border}`, paddingTop: 24,
            }}>
              <button
                onClick={() => setMoveModal(false)}
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
                onClick={handleMoveContact}
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
                Confirm Move
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientList;