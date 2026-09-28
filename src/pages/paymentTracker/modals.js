/**
 * paymentTracker/modals.js — Map Advance, PI Flow and Invoice Viewer dialogs.
 * Relationships (which payments belong where) come from shared.js helpers so
 * every view agrees on them.
 */
import React, { useState, useMemo } from 'react';
import { Link2, FileText, FileUp } from 'lucide-react';
import trackerApi, { friendlyError, docUrl } from './trackerApi';
import { Modal, Field, ErrBox, SearchableList, SummaryRow, DueRow, Badge, ProgressBar, DocLink, BlobPreview } from './components';
import { T, fmt, fmtDate, idOf } from './shared';

// Loose vendor-name match. Server records can carry null names (an invoice
// saved without a vendor, a PI whose vendor was deleted), so never assume a string.
const sameName = (a, b) => {
  const x = String(a || '').trim().toLowerCase();
  const y = String(b || '').trim().toLowerCase();
  return !!x && !!y && (x.includes(y) || y.includes(x));
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAP ADVANCE
// ═══════════════════════════════════════════════════════════════════════════════
export function MapAdvanceModal({ payment, pis, invoices, onSaved, onClose }) {
  const [target, setTarget] = useState('proforma_invoice');
  const [piId, setPiId] = useState('');
  const [invId, setInvId] = useState('');
  const [piSearch, setPiSearch] = useState('');
  const [invSearch, setInvSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const vendorId = idOf(payment.vendor);
  const vendorName = payment.vendor?.companyName || '';

  const vendorPis = useMemo(() => pis.filter((pi) =>
    pi.amountDue > 0 && pi.status !== 'cancelled' && (!vendorId || idOf(pi.vendor) === vendorId)), [pis, vendorId]);
  const vendorInvoices = useMemo(() => invoices.filter((vi) =>
    vi.amountDue > 0 && (!vendorName || sameName(vi.vendor_name, vendorName))), [invoices, vendorName]);

  const shownPis = vendorPis.filter((pi) => !piSearch || `${pi.piNumber} ${pi.vendor?.companyName}`.toLowerCase().includes(piSearch.toLowerCase()));
  const shownInvs = vendorInvoices.filter((vi) => !invSearch || `${vi.invoice_number} ${vi.vendor_name}`.toLowerCase().includes(invSearch.toLowerCase()));
  const selectedPi = pis.find((p) => p._id === piId);
  const selectedInv = invoices.find((v) => v._id === invId);
  const due = target === 'proforma_invoice' ? selectedPi?.amountDue : selectedInv?.amountDue;
  const over = due != null && payment.amount > due + 1;

  const submit = async () => {
    setErr('');
    if (target === 'proforma_invoice' && !piId) { setErr('Select a PI.'); return; }
    if (target === 'vendor_invoice' && !invId) { setErr('Select an invoice.'); return; }
    setSaving(true);
    try {
      const saved = await trackerApi.mapPayment(payment._id, {
        mappedTo: target,
        ...(target === 'proforma_invoice' ? { proformaInvoice: piId } : { vendorInvoice: invId }),
      });
      onSaved(saved, 'Payment mapped');
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Map Advance Payment" onClose={onClose}>
      <div style={{ padding: '14px 16px', background: '#f8fafc', borderRadius: 12, marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[['Ref', payment.paymentRef, '#1d4ed8'], ['Amount', fmt(payment.amount), '#10b981'], ['Vendor', vendorName || '—', '#0f172a'], ['Date', fmtDate(payment.paymentDate), '#475569'], ['Mode', payment.paymentMode?.toUpperCase(), '#475569']].map(([l, v, c]) => (
          <div key={l}>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>{l}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: c }}>{v}</div>
          </div>
        ))}
      </div>
      <ErrBox msg={err} />

      <Field label="Map To">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[['proforma_invoice', '📋 Proforma Invoice (PI)'], ['vendor_invoice', '🧾 Vendor Invoice']].map(([val, lbl]) => (
            <button key={val} onClick={() => setTarget(val)} style={{ padding: '12px 8px', borderRadius: 10, border: `2px solid ${target === val ? '#3b82f6' : '#e2e8f0'}`, background: target === val ? '#eff6ff' : '#fff', fontWeight: 700, fontSize: 13, color: target === val ? '#1d4ed8' : '#475569', cursor: 'pointer' }}>
              {lbl}
            </button>
          ))}
        </div>
      </Field>

      {target === 'proforma_invoice' ? (
        <Field label={`Select PI${vendorPis.length ? ` — ${vendorPis.length} open` : ''}`}>
          <SearchableList items={shownPis} search={piSearch} onSearch={setPiSearch} selectedId={piId} onSelect={(pi) => setPiId(pi._id)}
            placeholder="Search PI number or vendor…"
            emptyMsg={vendorPis.length ? `No PIs match "${piSearch}"` : `No open PIs for ${vendorName || 'this vendor'}.`}
            renderRow={(pi, sel) => <DueRow title={pi.piNumber} subtitle={pi.vendor?.companyName} due={pi.amountDue} total={pi.totalAmount} selected={sel} />} />
          {selectedPi && <SummaryRow total={selectedPi.totalAmount} paid={selectedPi.amountPaid} due={selectedPi.amountDue} />}
        </Field>
      ) : (
        <Field label={`Select Invoice${vendorInvoices.length ? ` — ${vendorInvoices.length} open` : ''}`}>
          <SearchableList items={shownInvs} search={invSearch} onSearch={setInvSearch} selectedId={invId} onSelect={(vi) => setInvId(vi._id)}
            placeholder="Search invoice number or vendor…"
            emptyMsg={vendorInvoices.length ? `No invoices match "${invSearch}"` : `No open invoices for ${vendorName || 'this vendor'}.`}
            renderRow={(vi, sel) => <DueRow title={vi.invoice_number} subtitle={vi.vendor_name} due={vi.amountDue} total={vi.total_amount} selected={sel} accent={T.cyan} />} />
          {selectedInv && <SummaryRow total={selectedInv.total_amount} paid={selectedInv.amountPaid} due={selectedInv.amountDue} />}
        </Field>
      )}
      {over && <ErrBox msg={`Payment (${fmt(payment.amount)}) is more than the outstanding ${fmt(due)}.`} />}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
        <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', color: '#64748b', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
        <button onClick={submit} disabled={saving || over} style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: saving || over ? '#94a3b8' : '#10b981', color: '#fff', fontWeight: 700, cursor: saving || over ? 'not-allowed' : 'pointer', fontSize: 14 }}>
          {saving ? 'Mapping…' : 'Confirm Mapping'}
        </button>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PI FLOW — PI → payments → final invoice
// ═══════════════════════════════════════════════════════════════════════════════
export function PIFlowModal({ pi, piPayments, payments, invoices, onMapPayment, onUploadInvoice, onLinked, onClose }) {
  const [linkingId, setLinkingId] = useState(null);
  const [linkErr, setLinkErr] = useState('');

  const linkedInvoice = pi.finalInvoice ? invoices.find((inv) => String(inv._id) === idOf(pi.finalInvoice)) || pi.finalInvoice : null;

  const suggestions = !linkedInvoice
    ? invoices.filter((inv) => sameName(inv.vendor_name, pi.vendor?.companyName) && Math.abs(inv.total_amount - pi.totalAmount) < pi.totalAmount * 0.5)
    : [];

  const advances = payments.filter((p) =>
    p.mappedTo === 'advance' && (!p.vendor || idOf(p.vendor) === idOf(pi.vendor)) && Math.abs(p.amount - pi.amountDue) <= 2);

  const link = async (inv) => {
    setLinkingId(inv._id); setLinkErr('');
    try {
      await trackerApi.linkPiToInvoice(pi._id, inv._id);
      onLinked();
    } catch (e) {
      setLinkErr(friendlyError(e));
      setLinkingId(null);
    }
  };

  return (
    <Modal title={`Payment Flow — ${pi.piNumber}`} onClose={onClose} extraWide>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 40px minmax(0,1fr) 40px minmax(0,1fr)', alignItems: 'flex-start', marginBottom: 28 }}>
        {/* PI */}
        <div style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', borderRadius: 16, padding: '20px 22px', color: '#fff' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', opacity: 0.8, marginBottom: 8 }}>📋 Proforma Invoice</div>
          <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 4 }}>{fmt(pi.totalAmount)}</div>
          <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 10 }}>{pi.piNumber} · {pi.vendor?.companyName}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ background: '#fff', borderRadius: 2 }}><Badge status={pi.status} /></span>
            {pi.dueDate && <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.15)', padding: '2px 8px', borderRadius: 20 }}>Due {fmtDate(pi.dueDate)}</span>}
          </div>
          {pi.bankDetails && <div style={{ fontSize: 11, opacity: 0.75, borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 8, whiteSpace: 'pre-line' }}>{pi.bankDetails}</div>}
          {pi.attachmentFileId && <div style={{ marginTop: 8 }}><DocLink url={docUrl.piAttach(pi._id)} mimeType={pi.attachmentMime} label="PI Document" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }} /></div>}
        </div>

        <div style={{ textAlign: 'center', paddingTop: 30, fontSize: 22, color: '#94a3b8' }}>→</div>

        {/* Payments */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#475569', marginBottom: 10 }}>💳 Payments ({piPayments.length})</div>
          {piPayments.length === 0
            ? <div style={{ padding: 16, background: '#f8fafc', borderRadius: 12, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No payments yet</div>
            : piPayments.map((pay) => (
              <div key={pay._id} style={{ padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#15803d' }}>{fmt(pay.amount)}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>{pay.paymentRef}</span>
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{fmtDate(pay.paymentDate)} · {pay.paymentMode?.toUpperCase()}</div>
                {pay.bankRef && <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>Ref: {pay.bankRef}</div>}
                {pay.screenshotFileId && <div style={{ marginTop: 4 }}><DocLink url={docUrl.payReceipt(pay._id)} mimeType={pay.screenshotMime} label="Proof" style={{ background: '#f0fdf4', color: '#15803d' }} /></div>}
              </div>
            ))}
          <div style={{ marginTop: 8, padding: '10px 12px', background: '#f8fafc', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, marginBottom: 5 }}>
              <span style={{ color: '#10b981' }}>Paid: {fmt(pi.amountPaid)}</span>
              <span style={{ color: '#ef4444' }}>Due: {fmt(pi.amountDue)}</span>
            </div>
            <ProgressBar paid={pi.amountPaid} total={pi.totalAmount} height={8} />
          </div>
          {advances.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', marginBottom: 6 }}>⚠ Matching unmapped advances</div>
              {advances.map((pay) => (
                <div key={pay._id} style={{ padding: '9px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <div><div style={{ fontSize: 13, fontWeight: 700 }}>{fmt(pay.amount)}</div><div style={{ fontSize: 11, color: '#64748b' }}>{fmtDate(pay.paymentDate)} · {pay.paymentRef}</div></div>
                  <button onClick={() => onMapPayment(pay)} style={{ padding: '5px 10px', borderRadius: 7, border: 'none', background: '#f59e0b', color: '#fff', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>Map</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', paddingTop: 30, fontSize: 22, color: '#94a3b8' }}>→</div>

        {/* Final invoice */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#475569', marginBottom: 10 }}>🧾 Final Invoice</div>
          {linkedInvoice ? (
            <div style={{ background: 'linear-gradient(135deg,#0891b2,#06b6d4)', borderRadius: 16, padding: '20px 22px', color: '#fff' }}>
              <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 4 }}>{fmt(linkedInvoice.total_amount)}</div>
              <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 6 }}>{linkedInvoice.invoice_number}</div>
              <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 10 }}>{fmtDate(linkedInvoice.date)}</div>
              {!!(linkedInvoice.cgst || linkedInvoice.sgst || linkedInvoice.igst) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 8, marginBottom: 10 }}>
                  {[['CGST', linkedInvoice.cgst], ['SGST', linkedInvoice.sgst], ['IGST', linkedInvoice.igst]].map(([l, v]) => (
                    <div key={l} style={{ textAlign: 'center' }}><div style={{ fontSize: 9, opacity: 0.7, fontWeight: 700 }}>{l}</div><div style={{ fontSize: 12, fontWeight: 700 }}>{fmt(v)}</div></div>
                  ))}
                </div>
              )}
              {linkedInvoice.oneDriveFileId && <DocLink url={docUrl.invoice(linkedInvoice._id)} mimeType={linkedInvoice.mimeType} label="View Invoice" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }} />}
            </div>
          ) : (
            <div>
              <ErrBox msg={linkErr} />
              {suggestions.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.cyan, textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><Link2 size={12} /> Already in the vault — link it?</div>
                  {suggestions.map((inv) => (
                    <div key={inv._id} style={{ padding: '12px 14px', background: '#e0f2fe', border: '1px solid #7dd3fc', borderRadius: 12, marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{inv.invoice_number}</div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>{inv.vendor_name} · {fmtDate(inv.date)}</div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: T.cyan, marginTop: 2 }}>{fmt(inv.total_amount)}</div>
                        </div>
                        <button disabled={!!linkingId} onClick={() => link(inv)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 8, border: 'none', background: linkingId === inv._id ? '#94a3b8' : T.cyan, color: '#fff', fontWeight: 700, fontSize: 12, cursor: linkingId ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
                          <Link2 size={12} /> {linkingId === inv._id ? 'Linking…' : 'Link'}
                        </button>
                      </div>
                      {Math.abs(inv.total_amount - pi.totalAmount) > 10 && <div style={{ fontSize: 11, color: '#0369a1', marginTop: 6 }}>⚠ Amount differs from PI ({fmt(pi.totalAmount)})</div>}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ padding: '20px 16px', background: '#f8fafc', border: '2px dashed #cbd5e1', borderRadius: 16, textAlign: 'center' }}>
                <FileText size={28} color="#94a3b8" style={{ margin: '0 auto 8px', display: 'block' }} />
                <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>{suggestions.length ? 'Or upload a new invoice' : 'No invoice received yet'}</div>
                <button onClick={() => onUploadInvoice(pi._id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: 'none', background: T.cyan, color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  <FileUp size={13} /> Upload Invoice
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVOICE VIEWER
// ═══════════════════════════════════════════════════════════════════════════════
export function InvoiceViewerModal({ invoice, trail, onClose }) {
  const { matchedPI, direct, piPayments } = trail;
  const proofs = [...piPayments, ...direct].filter((p) => p.screenshotFileId);
  const docRow = (key, icon, title, sub, link) => (
    <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <div style={{ minWidth: 0 }}><div style={{ fontSize: 12, fontWeight: 700 }}>{title}</div><div style={{ fontSize: 10, color: '#94a3b8' }}>{sub}</div></div>
      </div>
      {link}
    </div>
  );

  return (
    <Modal title={`Invoice — ${invoice.invoice_number}`} onClose={onClose} extraWide>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
            {[['Vendor', invoice.vendor_name || '—'], ['GSTIN', invoice.vendor_gst || 'N/A'], ['Invoice #', invoice.invoice_number], ['Date', fmtDate(invoice.date)], ['FY', invoice.financialYear || '—'], ['Month', invoice.month || '—'], ['Source', invoice.receivedVia || '—'], ['Outstanding', fmt(invoice.amountDue)]].map(([l, v]) => (
              <div key={l} style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10 }}>
                <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, marginBottom: 3 }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', wordBreak: 'break-word' }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ padding: '16px 20px', background: '#eff6ff', borderRadius: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 700, textTransform: 'uppercase', marginBottom: 10 }}>Tax Breakdown</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {[['Total', invoice.total_amount, '#1d4ed8'], ['CGST', invoice.cgst], ['SGST', invoice.sgst], ['IGST', invoice.igst]].map(([l, v, c = '#475569']) => (
                <div key={l} style={{ textAlign: 'center', padding: '10px 6px', background: '#fff', borderRadius: 10, border: '1px solid #dbeafe' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>{l}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: c, marginTop: 4 }}>{fmt(v)}</div>
                </div>
              ))}
            </div>
          </div>

          {invoice.notes && <div style={{ padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, fontSize: 13, color: '#92400e', marginBottom: 14 }}>📝 {invoice.notes}</div>}

          <div style={{ background: '#f8fafc', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: 10 }}>All Documents</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {invoice.oneDriveFileId && docRow('invoice', invoice.mimeType === 'application/pdf' ? '📄' : '🖼', 'Invoice Document', invoice.fileName || invoice.invoice_number,
                <DocLink url={docUrl.invoice(invoice._id)} mimeType={invoice.mimeType} label="View" />)}
              {matchedPI?.attachmentFileId && docRow('pi', '📋', 'Proforma Invoice', matchedPI.piNumber,
                <DocLink url={docUrl.piAttach(matchedPI._id)} mimeType={matchedPI.attachmentMime} label="View" style={{ background: '#ede9fe', color: '#6d28d9' }} />)}
              {proofs.map((p) => docRow(p._id, '💳', `Payment — ${fmt(p.amount)}`, `${p.paymentRef} · ${fmtDate(p.paymentDate)}`,
                <DocLink url={docUrl.payReceipt(p._id)} mimeType={p.screenshotMime} label="View" style={{ background: '#f0fdf4', color: '#15803d' }} />))}
              {!invoice.oneDriveFileId && !matchedPI?.attachmentFileId && proofs.length === 0 && (
                <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, padding: '10px 0' }}>No documents attached</div>
              )}
            </div>
          </div>
        </div>
        <BlobPreview url={invoice.oneDriveFileId ? docUrl.invoice(invoice._id) : null} mimeType={invoice.mimeType} />
      </div>
    </Modal>
  );
}
