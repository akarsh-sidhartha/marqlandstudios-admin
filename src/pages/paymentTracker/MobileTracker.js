/**
 * paymentTracker/MobileTracker.js
 * Phone layout: exactly three actions — Upload PI, Upload Invoice, Record
 * Payment. Each opens the same form the desktop uses, full-screen, with a
 * one-tap camera button; nothing else from the desktop tracker is shown.
 */
import React, { useState } from 'react';
import { ClipboardList, FileUp, CreditCard, CheckCircle, ChevronRight } from 'lucide-react';
import { PiForm, InvoiceForm, PaymentForm } from './forms';
import BulkUpload from './BulkUpload';
import { T, fmt } from './shared';

const ACTIONS = [
  { key: 'pi', label: 'Upload PI', sub: 'Proforma invoice or quotation', icon: ClipboardList, color: T.indigo },
  { key: 'invoice', label: 'Upload Invoice', sub: "Vendor's final tax invoice", icon: FileUp, color: T.cyan },
  { key: 'payment', label: 'Record Payment', sub: 'Bank / UPI screenshot', icon: CreditCard, color: T.blue },
];

export default function MobileTracker({ data, loading, error, reload }) {
  const [open, setOpen] = useState(null);
  const [done, setDone] = useState(null);
  const [bulk, setBulk] = useState(null); // { kind, files }

  const onSaved = (record, message) => {
    setOpen(null);
    setDone({ record, message, kind: open });
    reload({ silent: true });
  };

  if (done) {
    const r = done.record;
    const amount = r.totalAmount ?? r.total_amount ?? r.amount;
    const ref = r.piNumber || r.invoice_number || r.paymentRef;
    return (
      <div style={{ minHeight: '100dvh', background: '#f0fdf4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', fontFamily: "'DM Sans',-apple-system,sans-serif" }}>
        <div style={{ width: 72, height: 72, borderRadius: 20, background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
          <CheckCircle size={40} color="#fff" />
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 900, color: '#0f172a' }}>{done.message}</h2>
        {ref && <div style={{ fontSize: 14, color: '#475569', marginBottom: 4 }}>{ref}</div>}
        {amount != null && <div style={{ fontSize: 22, fontWeight: 800, color: '#10b981', marginBottom: 12 }}>{fmt(amount)}</div>}
        {r._warning && <div style={{ fontSize: 13, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 12, maxWidth: 360 }}>{r._warning}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, width: '100%', maxWidth: 360 }}>
          <button onClick={() => setDone(null)} style={{ flex: 1, padding: '14px', borderRadius: 12, border: '2px solid #10b981', background: '#fff', color: '#047857', fontWeight: 700, fontSize: 15 }}>Done</button>
          <button onClick={() => { const k = done.kind; setDone(null); setOpen(k); }} style={{ flex: 1, padding: '14px', borderRadius: 12, border: 'none', background: '#10b981', color: '#fff', fontWeight: 700, fontSize: 15 }}>Add another</button>
        </div>
      </div>
    );
  }

  const common = { vendors: data.vendors, onClose: () => setOpen(null), onSaved, fullScreen: true, onBulk: (files) => { setBulk({ kind: open, files }); setOpen(null); } };

  return (
    <div style={{ minHeight: '100dvh', background: '#f8fafc', fontFamily: "'DM Sans',-apple-system,sans-serif" }}>
      <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
      <div style={{ background: T.navy, padding: '32px 20px 28px', color: '#fff' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.25em', textTransform: 'uppercase', color: T.gold, marginBottom: 8 }}>Finance</div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>Payment Tracker</h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.75 }}>Snap or upload — details are read for you.</p>
      </div>

      <div style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <div role="alert" style={{ padding: '12px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, color: '#dc2626', fontSize: 13 }}>{error} <button onClick={() => reload()} style={{ marginLeft: 6, color: '#dc2626', background: 'none', border: 'none', textDecoration: 'underline', fontWeight: 700 }}>Retry</button></div>}
        {ACTIONS.map(({ key, label, sub, icon: Icon, color }) => (
          <button key={key} onClick={() => setOpen(key)} disabled={loading && !data.vendors.length}
            style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', padding: '20px 18px', borderRadius: 16, border: 'none', background: '#fff', boxShadow: '0 2px 10px rgba(15,23,42,0.08)', cursor: 'pointer', textAlign: 'left', opacity: loading && !data.vendors.length ? 0.6 : 1 }}>
            <span style={{ width: 52, height: 52, borderRadius: 14, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon size={26} color="#fff" />
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 17, fontWeight: 800, color: '#0f172a' }}>{label}</span>
              <span style={{ display: 'block', fontSize: 13, color: '#64748b', marginTop: 2 }}>{sub}</span>
            </span>
            <ChevronRight size={20} color="#94a3b8" />
          </button>
        ))}
        {loading && !data.vendors.length && <div style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>Loading vendors…</div>}
      </div>

      {open === 'pi' && <PiForm {...common} />}
      {open === 'invoice' && <InvoiceForm {...common} pis={data.pis} onVendorsChanged={() => reload({ silent: true })} />}
      {open === 'payment' && <PaymentForm {...common} pis={data.pis} invoices={data.invoices} payments={data.payments} />}
      {bulk && (
        <BulkUpload kind={bulk.kind} initialFiles={bulk.files} data={data} fullScreen
          onSavedSome={() => reload({ silent: true })} onClose={() => { setBulk(null); reload({ silent: true }); }} />
      )}
    </div>
  );
}
