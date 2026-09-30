/**
 * src/pages/orders/StartProjectModal.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Inquiry → Ongoing. The quote number is required; uploading the quote is
 * optional. When a quote PDF/image is chosen it is read on the server
 * (nothing is stored yet) and its line items are shown for review — untick
 * rows you don't want tracked, fix names or quantities — then "Confirm &
 * Start" saves the quote into the order folder and creates one procurement
 * row per ticked item, in a single request.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useRef, useState } from 'react';
import { AlertTriangle, FileUp, Hash, X } from 'lucide-react';
import ordersApi from './ordersApi';
import { T, jost, serif, FieldLabel, FocusInput, GoldBtn, GhostBtn, Modal, Spinner, formatMoney, numericOnly } from './ui';

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
const cell = { padding: '8px 10px', borderBottom: `1px solid ${T.border}`, fontFamily: jost, fontSize: 12 };
const tiny = { width: '100%', border: `1px solid ${T.border}`, padding: '5px 8px', fontFamily: jost, fontSize: 12, boxSizing: 'border-box', outline: 'none' };

export default function StartProjectModal({ order, onClose, onStarted, showToast }) {
  const [quoteNumber, setQuoteNumber] = useState(order.quoteNumber || '');
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);   // { quoteNumber, quoteDate, subject, subTotal, total, warnings }
  const [rows, setRows] = useState([]);         // [{ ...item, include }]
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const pick = async (picked) => {
    if (!picked) return;
    setFile(picked);
    setParsed(null);
    setRows([]);
    setError(null);
    setParsing(true);
    try {
      const result = await ordersApi.parseQuote(order._id, picked);
      setParsed(result);
      setRows(result.items.map((it) => ({ ...it, include: true })));
      if (!quoteNumber.trim() && result.quoteNumber) setQuoteNumber(result.quoteNumber);
    } catch (err) {
      setError(`The quote couldn't be read (${err.message}). You can still start the project — the file will be saved, add items later.`);
    } finally {
      setParsing(false);
    }
  };

  const clearFile = () => { setFile(null); setParsed(null); setRows([]); setError(null); };
  const setRow = (i, patch) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const included = rows.filter((r) => r.include && r.name?.trim());

  const submit = async () => {
    const qn = quoteNumber.trim();
    if (!qn || submitting || parsing) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await ordersApi.start(order._id, {
        quoteNumber: qn,
        file,
        items: included.map(({ include, ...it }) => ({
          lineNo: it.lineNo, name: it.name.trim(), details: it.details || '', hsn: it.hsn || undefined,
          quantity: Number(it.quantity) || 0, unit: it.unit || undefined, rate: it.rate, amount: it.amount,
        })),
        quoteDocument: parsed ? { quoteDate: parsed.quoteDate, subject: parsed.subject, subTotal: parsed.subTotal, total: parsed.total } : undefined,
      });
      showToast?.('success', `Project started${included.length ? ` · ${included.length} item${included.length !== 1 ? 's' : ''} added to procurement` : ''}`);
      onStarted(updated);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const mismatch = parsed?.quoteNumber && quoteNumber.trim() && parsed.quoteNumber.toUpperCase() !== quoteNumber.trim().toUpperCase();

  return (
    <Modal onClose={onClose} busy={submitting} width={rows.length ? 820 : 440} zIndex={100} padding="36px 40px 30px">
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ width: 44, height: 44, background: 'rgba(79,70,229,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', color: T.indigo }}>
          <Hash size={22} />
        </div>
        <h3 style={{ fontFamily: serif, fontSize: 26, fontWeight: 300, color: T.navy, margin: '0 0 6px' }}>Finalize Quote</h3>
        <p style={{ fontFamily: jost, fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: T.muted, margin: 0 }}>
          {order.refNumber} · {order.title || order.clientName}
        </p>
      </div>

      <div style={{ maxWidth: 380, margin: '0 auto' }}>
        <FieldLabel>Quote number *</FieldLabel>
        <FocusInput
          autoFocus
          value={quoteNumber}
          onChange={(e) => setQuoteNumber(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="e.g. QT-26-27/0095"
          style={{ textAlign: 'center', fontWeight: 500 }}
        />
        {mismatch && (
          <p style={{ fontFamily: jost, fontSize: 10, color: '#b45309', margin: '6px 0 0' }}>
            The uploaded quote says {parsed.quoteNumber}.{' '}
            <button type="button" onClick={() => setQuoteNumber(parsed.quoteNumber)} style={{ background: 'none', border: 'none', color: T.indigo, cursor: 'pointer', padding: 0, fontSize: 10 }}>Use it</button>
          </p>
        )}

        <FieldLabel style={{ marginTop: 18 }}>Quote document (optional)</FieldLabel>
        {file ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: T.offwhite, border: `1px solid ${T.border}`, fontFamily: jost, fontSize: 12 }}>
            {parsing ? <Spinner size={13} /> : <FileUp size={13} style={{ color: T.gold }} />}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
            {parsing && <span style={{ color: T.muted, fontSize: 10 }}>Reading line items…</span>}
            <button type="button" aria-label="Remove quote file" onClick={clearFile} disabled={submitting} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, display: 'flex' }}><X size={14} /></button>
          </div>
        ) : (
          <button
            type="button" onClick={() => inputRef.current?.click()}
            style={{ width: '100%', padding: '14px', border: `1px dashed ${T.borderG}`, background: T.dimBg, color: T.gold, cursor: 'pointer', fontFamily: jost, fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <FileUp size={14} /> Upload quote (PDF or image)
          </button>
        )}
        <input ref={inputRef} type="file" accept={ACCEPT} style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pick(f); }} />
      </div>

      {parsed?.warnings?.length > 0 && !rows.length && (
        <p style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', fontFamily: jost, fontSize: 11, color: '#b45309', margin: '14px 0 0' }}>
          <AlertTriangle size={13} /> {parsed.warnings[0]}
        </p>
      )}

      {rows.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <FieldLabel style={{ margin: 0 }}>Line items → procurement tracking ({included.length} of {rows.length})</FieldLabel>
            {parsed?.total != null && <span style={{ fontFamily: jost, fontSize: 11, color: T.muted }}>Quote total {formatMoney(parsed.total)}</span>}
          </div>
          <div style={{ border: `1px solid ${T.border}`, maxHeight: 320, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: T.offwhite }}>
                  {['', '#', 'Item', 'Qty', 'Rate', 'Amount'].map((h) => (
                    <th key={h} style={{ ...cell, fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: T.muted, fontWeight: 400, textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ opacity: r.include ? 1 : 0.45 }}>
                    <td style={{ ...cell, width: 24 }}>
                      <input type="checkbox" checked={r.include} onChange={(e) => setRow(i, { include: e.target.checked })} aria-label={`Track ${r.name}`} />
                    </td>
                    <td style={{ ...cell, width: 24, color: T.muted }}>{r.lineNo}</td>
                    <td style={cell}>
                      <input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} style={tiny} />
                      {r.details && <div style={{ fontSize: 10, color: T.muted, marginTop: 3 }}>{r.details}</div>}
                    </td>
                    <td style={{ ...cell, width: 80 }}>
                      <input inputMode="decimal" value={r.quantity} onChange={(e) => setRow(i, { quantity: numericOnly(e.target.value) })} style={tiny} />
                    </td>
                    <td style={{ ...cell, width: 90, color: T.muted }}>{formatMoney(r.rate)}</td>
                    <td style={{ ...cell, width: 100, color: T.muted }}>{formatMoney(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (
        <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontFamily: jost, fontSize: 11, color: T.danger, margin: '14px 0 0' }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 24, maxWidth: rows.length ? 'none' : 380, marginLeft: 'auto', marginRight: 'auto', justifyContent: 'flex-end' }}>
        <GhostBtn onClick={onClose} disabled={submitting} style={{ flex: rows.length ? 'none' : 1 }}>Cancel</GhostBtn>
        <GoldBtn onClick={submit} disabled={!quoteNumber.trim() || submitting || parsing} style={{ flex: rows.length ? 'none' : 1 }}>
          {submitting ? <><Spinner size={13} /> Starting…</> : 'Confirm & Start'}
        </GoldBtn>
      </div>
    </Modal>
  );
}
