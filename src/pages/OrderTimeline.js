/**
 * src/components/OrderTimeline.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Timeline panel for the OrderInquiry edit drawer (rendered inside
 * OrderTracker.js). Lets staff post a status + message update, which is
 * saved to OrderInquiry.timeline and, server-side, emailed to the client
 * as a threaded reply in the same conversation as the original portal email.
 *
 * Visual language mirrors OrderTracker.js — navy/gold/offwhite palette,
 * Jost typography, razor-thin borders.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { Send, Mail, MailWarning } from 'lucide-react';

const jost = '"Jost", sans-serif';

const T = {
  navy: '#0e1520', gold: '#b8975a', gold2: '#d4b06a', offwhite: '#faf8f5',
  text: '#1a1a1a', muted: '#888', border: 'rgba(0,0,0,0.07)',
};

const STATUS_OPTIONS = [
  { value: 'update',    label: 'General Update' },
  { value: 'inquiry',   label: 'Inquiry Received' },
  { value: 'ongoing',   label: 'In Production' },
  { value: 'completed', label: 'Completed' },
];

const STATUS_COLORS = {
  inquiry:   T.gold,
  ongoing:   '#4f46e5',
  completed: '#059669',
  update:    '#64748b',
};

const CUSTOM_VALUE = '__custom__';

/**
 * @param {object}   order    - The full order document (must include _id and timeline[])
 * @param {function} onPosted - Called with the newly-created timeline event after a
 *                              successful post, so the parent can optimistically
 *                              append it to local state without a full refetch.
 */
export default function OrderTimeline({ order, onPosted }) {
  const [status, setStatus]   = useState('update');
  const [message, setMessage] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError]     = useState(null);

  // Quick Statement dropdown — populated from Settings → Manage Statements.
  // Selecting a statement fills the message box (still freely editable
  // before posting); "Custom…" (always last) just clears back to free text.
  const [templates, setTemplates]         = useState([]);
  const [quickStatement, setQuickStatement] = useState(CUSTOM_VALUE);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await api.get('/message-templates');
      setTemplates(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      // Non-fatal — the composer still works with free text if this fails.
      console.warn('Failed to load message templates:', err.message);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const templatesForStatus = templates.filter(t => t.status === status);

  const timeline = [...(order.timeline || [])].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  const handleStatusChange = (newStatus) => {
    setStatus(newStatus);
    setQuickStatement(CUSTOM_VALUE); // reset — last status's statement rarely fits the new one
  };

  const handleQuickStatementChange = (value) => {
    setQuickStatement(value);
    if (value === CUSTOM_VALUE) return;
    const tpl = templates.find(t => t._id === value);
    if (tpl) setMessage(tpl.text);
  };

  const handlePost = async () => {
    if (!message.trim() || posting) return;
    setPosting(true);
    setError(null);
    try {
      const res = await api.post(`/orders/${order._id}/timeline`, {
        status,
        message: message.trim(),
      });
      setMessage('');
      setQuickStatement(CUSTOM_VALUE);
      onPosted?.(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setPosting(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handlePost();
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      {/* Sub-section header — mirrors LinkedShipmentsPanel in OrderTracker.js */}
      <p style={{
        fontFamily: jost, fontSize: 9, fontWeight: 400,
        letterSpacing: '0.28em', textTransform: 'uppercase',
        color: 'rgba(184,151,90,0.65)', margin: '0 0 10px',
      }}>
        Timeline
      </p>

      {/* ── Category + Quick Statement (statement list filters to the chosen category) ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <select
          value={status}
          onChange={e => handleStatusChange(e.target.value)}
          disabled={posting}
          style={{
            padding: '10px 12px', background: 'white',
            border: `1px solid ${T.border}`, borderRadius: 3,
            fontFamily: jost, fontSize: 12, fontWeight: 300,
            color: T.text, outline: 'none', cursor: posting ? 'not-allowed' : 'pointer',
            flexShrink: 0,
          }}
        >
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={quickStatement}
          onChange={e => handleQuickStatementChange(e.target.value)}
          disabled={posting}
          style={{
            flex: '1 1 220px', padding: '10px 12px', background: 'white',
            border: `1px solid ${T.border}`, borderRadius: 3,
            fontFamily: jost, fontSize: 12, fontWeight: 300,
            color: T.text, outline: 'none', cursor: posting ? 'not-allowed' : 'pointer',
          }}
        >
          {templatesForStatus.length === 0 && (
            <option value={CUSTOM_VALUE} disabled>No saved statements for this category</option>
          )}
          {templatesForStatus.map(t => (
            <option key={t._id} value={t._id}>{t.text}</option>
          ))}
          <option value={CUSTOM_VALUE}>Custom…</option>
        </select>
      </div>

      {/* ── Composer ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Post an update for the client…"
          disabled={posting}
          style={{
            flex: '1 1 240px', padding: '10px 14px',
            background: posting ? T.offwhite : 'white',
            border: `1px solid ${T.border}`, borderRadius: 3,
            fontFamily: jost, fontSize: 13, fontWeight: 300,
            color: T.text, outline: 'none', boxSizing: 'border-box',
          }}
        />

        <button
          onClick={handlePost}
          disabled={posting || !message.trim()}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '10px 20px',
            background: posting || !message.trim() ? '#e2e8f0' : T.gold,
            color: posting || !message.trim() ? '#94a3b8' : T.navy,
            border: 'none', cursor: posting || !message.trim() ? 'not-allowed' : 'pointer',
            fontFamily: jost, fontSize: 10, fontWeight: 500,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            transition: 'background 0.2s',
          }}
          onMouseEnter={e => { if (!posting && message.trim()) e.currentTarget.style.background = T.gold2; }}
          onMouseLeave={e => { if (!posting && message.trim()) e.currentTarget.style.background = T.gold; }}
        >
          <Send size={13} /> {posting ? 'Posting…' : 'Post Update'}
        </button>
      </div>

      {error && (
        <p style={{
          fontFamily: jost, fontSize: 11, fontWeight: 300,
          color: '#dc2626', marginBottom: 14,
        }}>
          {error}
        </p>
      )}

      {/* ── Timeline list ── */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {timeline.length === 0 && (
          <p style={{
            padding: '14px 16px', background: T.offwhite, border: `1px solid ${T.border}`,
            fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted, margin: 0,
          }}>
            No updates posted yet.
          </p>
        )}

        {timeline.map((ev, idx) => {
          const color = STATUS_COLORS[ev.status] || T.muted;
          const label = STATUS_OPTIONS.find(o => o.value === ev.status)?.label || ev.status;
          return (
            <div
              key={ev._id || idx}
              style={{
                display: 'flex', gap: 12,
                padding: '10px 0 14px 16px',
                borderLeft: `2px solid ${color}`,
                position: 'relative',
              }}
            >
              <div style={{
                position: 'absolute', left: -5, top: 4,
                width: 8, height: 8, borderRadius: '50%', background: color,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{
                    fontFamily: jost, fontSize: 9, fontWeight: 600,
                    letterSpacing: '0.15em', textTransform: 'uppercase', color,
                  }}>
                    {label}
                  </span>

                  {ev.emailSent ? (
                    <Mail size={11} title="Emailed to client" style={{ color: '#059669', flexShrink: 0 }} />
                  ) : (
                    <MailWarning
                      size={11}
                      title={ev.emailError || 'Email not sent'}
                      style={{ color: '#dc2626', flexShrink: 0 }}
                    />
                  )}

                  <span style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted }}>
                    {new Date(ev.createdAt).toLocaleString()}
                  </span>

                  {ev.postedBy && (
                    <span style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted }}>
                      · {ev.postedBy}
                    </span>
                  )}
                </div>

                <p style={{
                  fontFamily: jost, fontSize: 13, fontWeight: 300,
                  color: T.text, margin: 0, lineHeight: 1.5,
                  wordBreak: 'break-word',
                }}>
                  {ev.message}
                </p>

                {!ev.emailSent && ev.emailError && (
                  <p style={{
                    fontFamily: jost, fontSize: 10, fontWeight: 300,
                    color: '#dc2626', margin: '4px 0 0',
                  }}>
                    {ev.emailError}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}