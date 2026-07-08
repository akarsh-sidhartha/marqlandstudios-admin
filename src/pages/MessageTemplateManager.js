/**
 * src/components/MessageTemplateManager.js
 * ─────────────────────────────────────────────────────────────────────────────
 * "Manage Statements" modal — lets staff maintain the list of canned
 * statements that populate the Quick Statement dropdown in OrderTimeline.js.
 *
 * Rows are editable in place, addable, and deletable. A fixed, non-editable
 * "Custom" row is always pinned at the bottom — it isn't a database record,
 * it's a visual reminder that the composer's dropdown always keeps a
 * "Custom…" option for free-typed messages that don't match any statement.
 *
 * Visual language mirrors OrderTracker.js — navy/gold/offwhite palette,
 * Jost typography, razor-thin borders.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { Plus, Trash2, Pencil, Check, X, Loader2 } from 'lucide-react';

const jost = '"Jost", sans-serif';

const T = {
  navy: '#0e1520', gold: '#b8975a', gold2: '#d4b06a', offwhite: '#faf8f5',
  text: '#1a1a1a', muted: '#888', border: 'rgba(0,0,0,0.07)', danger: '#dc2626',
};

const STATUS_OPTIONS = [
  { value: 'update',    label: 'General Update' },
  { value: 'inquiry',   label: 'Inquiry Received' },
  { value: 'ongoing',   label: 'In Production' },
  { value: 'completed', label: 'Completed' },
];

const STATUS_COLORS = {
  inquiry: T.gold, ongoing: '#4f46e5', completed: '#059669', update: '#64748b',
};

/**
 * @param {boolean}  isOpen
 * @param {function} onClose
 * @param {function} [onChange] - Called after any successful add/edit/delete,
 *                                so a parent (e.g. OrderTimeline) can refetch.
 */
export default function MessageTemplateManager({ isOpen, onClose, onChange }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [editingId, setEditingId] = useState(null);   // row currently in edit mode
  const [draft, setDraft]         = useState({ status: 'update', text: '' });
  const [savingId, setSavingId]   = useState(null);   // row id (or 'new') currently saving
  const [addingRow, setAddingRow] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/message-templates');
      setTemplates(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) fetchTemplates();
  }, [isOpen, fetchTemplates]);

  if (!isOpen) return null;

  const startEdit = (tpl) => {
    setEditingId(tpl._id);
    setDraft({ status: tpl.status, text: tpl.text });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft({ status: 'update', text: '' });
  };

  const saveEdit = async (id) => {
    if (!draft.text.trim()) return;
    setSavingId(id);
    try {
      const res = await api.patch(`/message-templates/${id}`, draft);
      setTemplates(prev => prev.map(t => (t._id === id ? res.data : t)));
      setEditingId(null);
      onChange?.();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setSavingId(null);
    }
  };

  const deleteRow = async (id) => {
    setSavingId(id);
    try {
      await api.delete(`/message-templates/${id}`);
      setTemplates(prev => prev.filter(t => t._id !== id));
      onChange?.();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setSavingId(null);
    }
  };

  const addRow = async () => {
    if (!draft.text.trim()) return;
    setSavingId('new');
    try {
      const res = await api.post('/message-templates', draft);
      setTemplates(prev => [...prev, res.data]);
      setDraft({ status: 'update', text: '' });
      setAddingRow(false);
      onChange?.();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setSavingId(null);
    }
  };

  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 0', borderBottom: `1px solid ${T.border}`,
  };

  const selectStyle = {
    padding: '8px 10px', background: 'white', border: `1px solid ${T.border}`,
    borderRadius: 3, fontFamily: jost, fontSize: 12, fontWeight: 300,
    color: T.text, outline: 'none', flexShrink: 0, width: 150,
  };

  const inputStyle = {
    flex: 1, padding: '8px 10px', background: 'white', border: `1px solid ${T.border}`,
    borderRadius: 3, fontFamily: jost, fontSize: 12, fontWeight: 300,
    color: T.text, outline: 'none', minWidth: 0,
  };

  const iconBtn = (color) => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'none', border: 'none', cursor: 'pointer', color, padding: 6, flexShrink: 0,
  });

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(14,21,32,0.78)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, zIndex: 60,
    }}>
      <div style={{
        background: 'white', border: `1px solid ${T.border}`,
        width: '100%', maxWidth: 640, maxHeight: '86vh',
        overflowY: 'auto', padding: '36px 36px 28px',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          marginBottom: 24, paddingBottom: 18, borderBottom: `1px solid ${T.border}`,
        }}>
          <div>
            <p style={{
              fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.28em',
              textTransform: 'uppercase', color: T.muted, marginBottom: 6,
            }}>
              Timeline Composer
            </p>
            <h2 style={{ fontFamily: jost, fontSize: 20, fontWeight: 400, color: T.navy, margin: 0 }}>
              Manage Statements
            </h2>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: T.muted, fontSize: 20, lineHeight: 1, padding: 4,
          }}>
            ✕
          </button>
        </div>

        {error && (
          <p style={{ fontFamily: jost, fontSize: 12, color: T.danger, marginBottom: 14 }}>{error}</p>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <Loader2 size={22} className="spin" style={{ color: T.gold, animation: 'spin 1s linear infinite' }} />
          </div>
        ) : (
          <>
            {/* Existing rows */}
            {templates.map((tpl) => {
              const isEditing = editingId === tpl._id;
              const isBusy    = savingId === tpl._id;
              return (
                <div key={tpl._id} style={rowStyle}>
                  {isEditing ? (
                    <>
                      <select
                        value={draft.status}
                        onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}
                        style={selectStyle}
                      >
                        {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <input
                        type="text"
                        value={draft.text}
                        onChange={e => setDraft(d => ({ ...d, text: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(tpl._id); if (e.key === 'Escape') cancelEdit(); }}
                        style={inputStyle}
                        autoFocus
                      />
                      <button onClick={() => saveEdit(tpl._id)} disabled={isBusy || !draft.text.trim()} style={iconBtn('#059669')} title="Save">
                        <Check size={15} />
                      </button>
                      <button onClick={cancelEdit} disabled={isBusy} style={iconBtn(T.muted)} title="Cancel">
                        <X size={15} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span style={{
                        width: 150, flexShrink: 0,
                        fontFamily: jost, fontSize: 9, fontWeight: 600, letterSpacing: '0.1em',
                        textTransform: 'uppercase', color: STATUS_COLORS[tpl.status] || T.muted,
                      }}>
                        {STATUS_OPTIONS.find(o => o.value === tpl.status)?.label || tpl.status}
                      </span>
                      <span style={{
                        flex: 1, fontFamily: jost, fontSize: 13, fontWeight: 300,
                        color: T.text, minWidth: 0, wordBreak: 'break-word',
                      }}>
                        {tpl.text}
                      </span>
                      <button onClick={() => startEdit(tpl)} disabled={isBusy} style={iconBtn(T.muted)} title="Edit">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => deleteRow(tpl._id)} disabled={isBusy} style={iconBtn(T.danger)} title="Delete">
                        {isBusy ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={13} />}
                      </button>
                    </>
                  )}
                </div>
              );
            })}

            {/* Add-new row */}
            {addingRow ? (
              <div style={rowStyle}>
                <select
                  value={draft.status}
                  onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}
                  style={selectStyle}
                >
                  {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input
                  type="text"
                  value={draft.text}
                  onChange={e => setDraft(d => ({ ...d, text: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') addRow(); if (e.key === 'Escape') { setAddingRow(false); setDraft({ status: 'update', text: '' }); } }}
                  placeholder="New statement text…"
                  style={inputStyle}
                  autoFocus
                />
                <button onClick={addRow} disabled={savingId === 'new' || !draft.text.trim()} style={iconBtn('#059669')} title="Save">
                  <Check size={15} />
                </button>
                <button
                  onClick={() => { setAddingRow(false); setDraft({ status: 'update', text: '' }); }}
                  disabled={savingId === 'new'}
                  style={iconBtn(T.muted)}
                  title="Cancel"
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setAddingRow(true); setDraft({ status: 'update', text: '' }); }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer',
                  color: T.gold, fontFamily: jost, fontSize: 11, fontWeight: 500,
                  letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4,
                }}
              >
                <Plus size={14} /> Add Statement
              </button>
            )}

            {/* Fixed, non-editable "Custom" row — represents the always-present
                free-text option in the composer dropdown, not a DB record. */}
            <div style={{ ...rowStyle, borderBottom: 'none', opacity: 0.6, marginTop: 8 }}>
              <span style={{
                width: 150, flexShrink: 0,
                fontFamily: jost, fontSize: 9, fontWeight: 600, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: T.muted,
              }}>
                — Any Status —
              </span>
              <span style={{ flex: 1, fontFamily: jost, fontSize: 13, fontWeight: 300, fontStyle: 'italic', color: T.muted }}>
                Custom — always available in the composer for free-typed messages
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}