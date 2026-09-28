/**
 * paymentTracker/forms.js
 * ─────────────────────────────────────────────────────────────────────────────
 * The three capture flows — Upload PI, Upload Invoice, Record Payment.
 * Each is written once and used by BOTH the desktop screen (dialog) and the
 * mobile screen (full-screen sheet via `fullScreen`), so validation, document
 * reading and saving can never drift between the two.
 *
 * Attaching a document always reads it (open-source extractor on our own
 * server — no paid API, so there is no "AI mode" to switch on). Read values
 * only fill fields the user hasn't typed into.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import trackerApi, { friendlyError, duplicateInfo } from './trackerApi';
import { useAutoForm, useDocumentScan } from './hooks';
import {
  Modal, Field, Row, ErrBox, WarnBox, AutoFillBanner, ScanBanner, DuplicateOverlay, UploadZone,
  VendorSelect, SearchSelect, SearchableList, SummaryRow, DueRow, FormActions,
} from './components';
import { T, IS, IShi, fmt, todayISO, fiscalOf, PAYMENT_MODES, idOf } from './shared';

const HOME_STATE_CODE = '29'; // Karnataka — intra-state supplies carry CGST + SGST
import { DOC_KINDS as K, GSTIN_RE } from './docKinds';
const str = (v) => (v === null || v === undefined ? '' : String(v));

/** Wraps a form in a desktop dialog or a mobile full-screen sheet. */
function FormShell({ title, fullScreen, onClose, footer, children }) {
  return <Modal title={title} onClose={onClose} wide fullScreen={fullScreen} footer={footer}>{children}</Modal>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD PI
// ═══════════════════════════════════════════════════════════════════════════════
export function PiForm({ vendors, onSaved, onClose, onBulk, fullScreen }) {
  const { form, set, fill, auto, autoCount } = useAutoForm({
    piNumber: '', vendor: '', piDate: todayISO(), dueDate: '', totalAmount: '', currency: 'INR', bankDetails: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [dup, setDup] = useState(null);

  const doc = useDocumentScan('pi', useCallback((ex) => fill(K.pi.fromExtract(ex, { vendors })), [fill, vendors]));

  const missing = [...(doc.file ? [] : ['document']), ...K.pi.missing(form)];
  const disabled = saving || doc.scanning || missing.length > 0;

  const submit = async () => {
    if (disabled) return;
    setErr(''); setSaving(true);
    try {
      const saved = await K.pi.save(form, doc.file);
      onSaved(saved, 'PI saved');
    } catch (e) {
      const d = duplicateInfo(e);
      if (d) setDup(d); else setErr(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormShell title="Upload Proforma Invoice" fullScreen={fullScreen} onClose={onClose}
      footer={<FormActions onCancel={onClose} onSubmit={submit} disabled={disabled} saving={saving} label="Save PI" missing={missing} />}>
      <DuplicateOverlay
        info={dup && { title: 'Duplicate PI', body: `PI number ${dup.piNumber} already exists.`, sub: 'If this is a revised PI, change the number before saving.', retryLabel: 'Change PI number' }}
        onRetry={() => setDup(null)} onClose={onClose}
      />
      <UploadZone label="PI document" hint="— fields are read automatically" compact={fullScreen}
        file={doc.file} previewUrl={doc.previewUrl} onFile={doc.attach} onFiles={onBulk} onClear={doc.clear} scanning={doc.scanning}>
        <ScanBanner result={doc.scanResult} msg={doc.scanMsg} />
      </UploadZone>
      <AutoFillBanner count={autoCount} />
      <ErrBox msg={err} />

      <Row compact={fullScreen}>
        <Field label="PI Number" required><input style={IShi(auto.piNumber)} value={form.piNumber} onChange={(e) => set('piNumber', e.target.value)} placeholder="e.g. PI-2026-001" /></Field>
        <Field label="Vendor" required hint={auto.vendor ? '✓ matched' : doc.scanResult && !form.vendor ? 'not matched — select' : ''}>
          <VendorSelect vendors={vendors} value={form.vendor} onChange={(v) => set('vendor', v)} highlighted={auto.vendor} />
        </Field>
      </Row>
      <Row compact={fullScreen}>
        <Field label="PI Date" required><input type="date" style={IShi(auto.piDate)} value={form.piDate} onChange={(e) => set('piDate', e.target.value)} /></Field>
        <Field label="Due Date"><input type="date" style={IShi(auto.dueDate)} value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></Field>
      </Row>
      <Row compact={fullScreen}>
        <Field label="Total Amount (incl. GST)" required><input type="number" inputMode="decimal" style={IShi(auto.totalAmount)} value={form.totalAmount} onChange={(e) => set('totalAmount', e.target.value)} placeholder="0.00" /></Field>
        <Field label="Currency"><input style={IS} value={form.currency} maxLength={3} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></Field>
      </Row>
      <Field label="Bank / Payment Details"><textarea style={{ ...IShi(auto.bankDetails), resize: 'vertical', minHeight: 56 }} value={form.bankDetails} onChange={(e) => set('bankDetails', e.target.value)} placeholder="Bank, account, IFSC, UPI ID…" /></Field>
      <Field label="Notes"><textarea style={{ ...IShi(auto.notes), resize: 'vertical', minHeight: 48 }} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
    </FormShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD INVOICE
// ═══════════════════════════════════════════════════════════════════════════════
export function InvoiceForm({ vendors, pis, linkedPiId, onSaved, onClose, onBulk, onVendorsChanged, fullScreen }) {
  const { form, set, fill, patch, auto, autoCount } = useAutoForm({
    vendorId: '', vendor_name: '', vendor_gst: '', invoice_number: '', date: todayISO(),
    total_amount: '', cgst: '', sgst: '', igst: '', notes: '', linkedPi: linkedPiId || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [dup, setDup] = useState(null);
  const [gstSaving, setGstSaving] = useState(false);

  const selectedVendor = vendors.find((v) => v._id === form.vendorId);
  const gstSaved = !!selectedVendor?.gstNumber && selectedVendor.gstNumber === form.vendor_gst;

  const piOptions = useMemo(
    () => pis
      .filter((p) => p.status !== 'cancelled' && (!p.finalInvoice || p._id === linkedPiId))
      .map((pi) => ({ value: pi._id, label: `${pi.piNumber} · ${pi.vendor?.companyName || '—'}`, sub: `${fmt(pi.totalAmount)} · due ${fmt(pi.amountDue)}` })),
    [pis, linkedPiId],
  );

  const prefillFromPi = useCallback((pi) => {
    if (!pi) return;
    patch({
      vendorId: idOf(pi.vendor),
      vendor_name: pi.vendor?.companyName || '',
      vendor_gst: pi.vendor?.gstNumber || '',
      total_amount: str(pi.totalAmount),
      ...(pi.notes ? { notes: pi.notes } : {}),
    });
  }, [patch]);

  // Opened from a PI's flow → start pre-filled from that PI.
  useEffect(() => {
    if (linkedPiId) prefillFromPi(pis.find((p) => p._id === linkedPiId));
  }, [linkedPiId]);

  const chooseVendor = (vendorId) => {
    const v = vendors.find((x) => x._id === vendorId);
    set('vendorId', vendorId);
    set('vendor_name', v?.companyName || '');
    set('vendor_gst', v?.gstNumber || '');
  };

  const doc = useDocumentScan('invoice', useCallback((ex) => fill(K.invoice.fromExtract(ex, { vendors })), [fill, vendors]));

  const saveGstToVendor = async () => {
    if (!form.vendorId || !GSTIN_RE.test(form.vendor_gst)) return;
    setGstSaving(true);
    try { await trackerApi.saveVendorGst(form.vendorId, form.vendor_gst); onVendorsChanged?.(); }
    catch (e) { setErr(friendlyError(e)); }
    finally { setGstSaving(false); }
  };

  // Tax split: CGST + SGST (same-state supply) or IGST (inter-state). The
  // supplier's state code only *suggests* which — place of supply decides — so
  // both are editable and either complete split is accepted.
  const gst = String(form.vendor_gst || '').trim().toUpperCase();
  const gstValid = GSTIN_RE.test(gst);
  const n = (k) => parseFloat(form[k]) || 0;
  const { intra: hasIntra, inter: hasInter } = K.invoice.taxState(form);
  const suggestion = !gstValid || hasIntra || hasInter ? '' : gst.startsWith(HOME_STATE_CODE) ? 'Karnataka supplier — usually CGST + SGST' : 'Other-state supplier — usually IGST';
  const taxTotal = n('cgst') + n('sgst') + n('igst');
  const taxLooksHigh = n('total_amount') > 0 && taxTotal > n('total_amount') * 0.3;

  const missing = [...(doc.file ? [] : ['document']), ...K.invoice.missing(form)];
  const disabled = saving || doc.scanning || missing.length > 0;
  const period = fiscalOf(form.date);

  const submit = async () => {
    if (disabled) return;
    setErr(''); setSaving(true);
    try {
      const saved = await K.invoice.save(form, doc.file);
      if (form.vendorId && !gstSaved) onVendorsChanged?.(); // server remembered the GSTIN
      onSaved(saved, saved._linkedPi ? 'Invoice saved and linked to its PI' : 'Invoice saved');
    } catch (e) {
      const d = duplicateInfo(e);
      if (d) setDup(d); else setErr(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  // CGST and SGST are always the same amount: typing one fills the other,
  // unless the other was already set to something different.
  const setTax = (k, v) => {
    set(k, v);
    const twin = { cgst: 'sgst', sgst: 'cgst' }[k];
    if (twin && (!form[twin] || form[twin] === form[k])) set(twin, v);
  };
  const taxInput = (k) => (
    <input type="number" inputMode="decimal" style={IShi(auto[k])} value={form[k]} onChange={(e) => setTax(k, e.target.value)} placeholder="0" />
  );

  return (
    <FormShell title="Upload Vendor Invoice" fullScreen={fullScreen} onClose={onClose}
      footer={<FormActions onCancel={onClose} onSubmit={submit} disabled={disabled} saving={saving} label="Save Invoice" color={T.cyan} missing={missing} />}>
      <DuplicateOverlay
        info={dup && { title: 'Duplicate Invoice', body: `Invoice #${dup.invoice_number} from ${dup.vendor_name} is already in the vault.`, sub: 'Nothing was saved.', retryLabel: 'Edit' }}
        onRetry={() => setDup(null)} onClose={onClose}
      />
      <UploadZone label="Invoice document" hint="— fields are read automatically" compact={fullScreen}
        file={doc.file} previewUrl={doc.previewUrl} onFile={doc.attach} onFiles={onBulk} onClear={doc.clear} scanning={doc.scanning}>
        <ScanBanner result={doc.scanResult} msg={doc.scanMsg} />
      </UploadZone>
      <AutoFillBanner count={autoCount} />
      <ErrBox msg={err} />

      <Field label="Link to Proforma Invoice" hint="optional — fills vendor & amount">
        <SearchSelect
          options={piOptions}
          value={form.linkedPi}
          onChange={(id) => { set('linkedPi', id); prefillFromPi(pis.find((p) => p._id === id)); }}
          placeholder="Search PI number or vendor — or leave unlinked"
          emptyText="No open PIs match"
        />
      </Field>

      <Row compact={fullScreen}>
        <Field label="Vendor" required hint={auto.vendorId ? '✓ matched' : 'select, or type if new'}>
          <VendorSelect vendors={vendors} value={form.vendorId} onChange={chooseVendor} highlighted={auto.vendorId || auto.vendor_name} />
          {!form.vendorId && (
            <input style={{ ...IShi(auto.vendor_name), marginTop: 6 }} value={form.vendor_name} onChange={(e) => set('vendor_name', e.target.value)} placeholder="Or type the vendor name…" />
          )}
        </Field>
        <Field label="Vendor GSTIN" required hint={gstSaved ? '✓ saved on vendor' : ''}>
          <div style={{ position: 'relative' }}>
            <input style={IShi(auto.vendor_gst)} value={form.vendor_gst} maxLength={15} onChange={(e) => set('vendor_gst', e.target.value.toUpperCase())} placeholder="15-character GSTIN" />
            {form.vendorId && gstValid && !gstSaved && (
              <button type="button" onClick={saveGstToVendor} disabled={gstSaving} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                {gstSaving ? '…' : 'Save to vendor'}
              </button>
            )}
          </div>
          {gst && !gstValid && <div style={{ fontSize: 11, color: T.red, marginTop: 4 }}>GSTIN format looks wrong</div>}
        </Field>
      </Row>

      <Row compact={fullScreen}>
        <Field label="Invoice Number" required><input style={IShi(auto.invoice_number)} value={form.invoice_number} onChange={(e) => set('invoice_number', e.target.value)} /></Field>
        <Field label="Invoice Date" required hint={`FY ${period.fy} · ${period.month}`}><input type="date" style={IShi(auto.date)} value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
      </Row>

      <Row cols={fullScreen ? 2 : 4}>
        <Field label="Total" required><input type="number" inputMode="decimal" style={IShi(auto.total_amount)} value={form.total_amount} onChange={(e) => set('total_amount', e.target.value)} placeholder="0" /></Field>
        <Field label="CGST">{taxInput('cgst')}</Field>
        <Field label="SGST">{taxInput('sgst')}</Field>
        <Field label="IGST">{taxInput('igst')}</Field>
      </Row>
      {suggestion && <div style={{ fontSize: 11, color: T.gold, margin: '-10px 0 14px' }}>{suggestion}</div>}
      {taxLooksHigh && <WarnBox msg="GST is more than 30% of the total — please double-check the amounts." />}

      <Field label="Notes"><textarea style={{ ...IS, resize: 'vertical', minHeight: 48 }} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
    </FormShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECORD PAYMENT
// ═══════════════════════════════════════════════════════════════════════════════
const MODE_OPTIONS = PAYMENT_MODES.map((m) => ({ value: m, label: m.toUpperCase() }));

const TARGETS = [
  ['advance', '💰', 'Advance', 'Map later'],
  ['proforma_invoice', '📋', 'Against PI', 'PI exists'],
  ['vendor_invoice', '🧾', 'Against Invoice', 'Invoice received'],
];

export function PaymentForm({ vendors, pis, invoices, payments, onSaved, onClose, onBulk, fullScreen }) {
  const { form, set, fill, auto, autoCount } = useAutoForm({
    vendor: '', paymentDate: todayISO(), amount: '', currency: 'INR', paymentMode: 'neft',
    bankRef: '', remarks: '', mappedTo: 'advance', proformaInvoice: '', vendorInvoice: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [piSearch, setPiSearch] = useState('');
  const [invSearch, setInvSearch] = useState('');

  const doc = useDocumentScan('payment', useCallback((ex) => fill(K.payment.fromExtract(ex, { vendors })), [fill, vendors]));

  const chooseVendor = (id) => { set('vendor', id); set('proformaInvoice', ''); set('vendorInvoice', ''); };
  const amount = parseFloat(form.amount) || 0;
  const vendorName = vendors.find((v) => v._id === form.vendor)?.companyName?.toLowerCase() || '';

  const openPis = useMemo(() => pis.filter((pi) =>
    pi.status !== 'cancelled' && pi.amountDue > 0 && (!form.vendor || idOf(pi.vendor) === form.vendor)
    && (!piSearch || `${pi.piNumber} ${pi.vendor?.companyName}`.toLowerCase().includes(piSearch.toLowerCase())),
  ), [pis, form.vendor, piSearch]);

  const openInvoices = useMemo(() => invoices.filter((vi) => {
    if (!(vi.amountDue > 0)) return false;
    if (vendorName) { const n = (vi.vendor_name || '').toLowerCase(); if (!(n.includes(vendorName) || vendorName.includes(n))) return false; }
    return !invSearch || `${vi.invoice_number} ${vi.vendor_name}`.toLowerCase().includes(invSearch.toLowerCase());
  }).sort((a, b) => Math.abs(a.amountDue - amount) - Math.abs(b.amountDue - amount)), [invoices, vendorName, invSearch, amount]);

  const selectedPi = pis.find((p) => p._id === form.proformaInvoice);
  const selectedInv = invoices.find((v) => v._id === form.vendorInvoice);
  const sameRef = form.bankRef && payments.find((p) => p.bankRef && p.bankRef.toUpperCase() === form.bankRef.trim().toUpperCase());
  const over = selectedPi ? amount > selectedPi.amountDue + 1 : selectedInv ? amount > selectedInv.amountDue + 1 : false;

  const missing = K.payment.missing(form);
  const disabled = saving || doc.scanning || missing.length > 0 || over;

  const submit = async () => {
    if (disabled) return;
    setErr(''); setSaving(true);
    try {
      const saved = await K.payment.save(form, doc.file);
      onSaved(saved, form.mappedTo === 'advance' ? 'Saved as advance' : 'Payment recorded');
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormShell title="Record Payment" fullScreen={fullScreen} onClose={onClose}
      footer={<FormActions onCancel={onClose} onSubmit={submit} disabled={disabled} saving={saving} color={T.blue}
        label={form.mappedTo === 'advance' ? 'Save as Advance' : 'Record Payment'} missing={missing} />}>
      <UploadZone label="Payment proof" hint="— screenshot or bank advice, read automatically" compact={fullScreen}
        file={doc.file} previewUrl={doc.previewUrl} onFile={doc.attach} onFiles={onBulk} onClear={doc.clear} scanning={doc.scanning}>
        <ScanBanner result={doc.scanResult} msg={doc.scanMsg} />
      </UploadZone>
      <AutoFillBanner count={autoCount} />
      <ErrBox msg={err} />
      <WarnBox msg={sameRef ? `A payment with reference ${sameRef.bankRef} is already recorded (${sameRef.paymentRef}, ${fmt(sameRef.amount)}). Check it isn't a duplicate.` : ''} />

      <Row compact={fullScreen}>
        <Field label="Amount" required><input type="number" inputMode="decimal" style={IShi(auto.amount)} value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0.00" /></Field>
        <Field label="Payment Date" required><input type="date" style={IShi(auto.paymentDate)} value={form.paymentDate} onChange={(e) => set('paymentDate', e.target.value)} /></Field>
      </Row>

      <Field label="Vendor" hint={auto.vendor ? '✓ matched from payee' : 'optional for advances'}>
        <VendorSelect vendors={vendors} value={form.vendor} onChange={chooseVendor} highlighted={auto.vendor} placeholder="Unknown / select later" />
      </Field>

      <Field label="Map Payment Against" required>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {TARGETS.map(([val, icon, lbl, sub]) => (
            <button type="button" key={val} aria-pressed={form.mappedTo === val} onClick={() => set('mappedTo', val)} style={{ padding: '10px 6px', borderRadius: 10, border: `2px solid ${form.mappedTo === val ? '#3b82f6' : '#e2e8f0'}`, background: form.mappedTo === val ? '#eff6ff' : '#fff', cursor: 'pointer' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: form.mappedTo === val ? '#1d4ed8' : '#475569' }}>{fullScreen ? <>{icon}<br />{lbl}</> : `${icon} ${lbl}`}</div>
              {!fullScreen && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
            </button>
          ))}
        </div>
      </Field>

      {form.mappedTo === 'proforma_invoice' && (
        <Field label="Proforma Invoice" required>
          <SearchableList items={openPis} search={piSearch} onSearch={setPiSearch} selectedId={form.proformaInvoice}
            onSelect={(pi) => { set('proformaInvoice', pi._id); if (!form.vendor) set('vendor', idOf(pi.vendor)); }}
            placeholder="Search PI number or vendor…" emptyMsg={piSearch ? `No PIs match "${piSearch}"` : 'No open PIs with a balance'}
            renderRow={(pi, sel) => <DueRow title={pi.piNumber} subtitle={pi.vendor?.companyName} due={pi.amountDue} total={pi.totalAmount} selected={sel} />} />
          {selectedPi && <SummaryRow total={selectedPi.totalAmount} paid={selectedPi.amountPaid} due={selectedPi.amountDue} />}
        </Field>
      )}

      {form.mappedTo === 'vendor_invoice' && (
        <Field label="Vendor Invoice" required hint={amount > 0 ? 'closest outstanding first' : ''}>
          <SearchableList items={openInvoices} search={invSearch} onSearch={setInvSearch} selectedId={form.vendorInvoice}
            onSelect={(vi) => set('vendorInvoice', vi._id)}
            placeholder="Search invoice number or vendor…" emptyMsg={invSearch ? `No invoices match "${invSearch}"` : 'No invoices with a balance'}
            renderRow={(vi, sel) => <DueRow title={vi.invoice_number} subtitle={vi.vendor_name} due={vi.amountDue} total={vi.total_amount} selected={sel} accent={T.cyan} />} />
          {selectedInv && <SummaryRow total={selectedInv.total_amount} paid={selectedInv.amountPaid} due={selectedInv.amountDue} />}
        </Field>
      )}

      {over && <ErrBox msg={`Amount is more than the outstanding ${fmt(selectedPi?.amountDue ?? selectedInv?.amountDue)}.`} />}
      {form.mappedTo === 'advance' && (
        <div style={{ padding: '12px 16px', background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, marginBottom: 16, fontSize: 13, color: '#92400e' }}>
          💡 Saved as an <b>advance</b> — map it to a PI or invoice later.
        </div>
      )}

      <Row compact={fullScreen}>
        <Field label="Payment Mode">
          <SearchSelect options={MODE_OPTIONS} value={form.paymentMode} onChange={(v) => set('paymentMode', v || 'other')} highlighted={auto.paymentMode} clearable={false} placeholder="Payment mode" />
        </Field>
        <Field label="Bank Ref / UTR"><input style={IShi(auto.bankRef)} value={form.bankRef} onChange={(e) => set('bankRef', e.target.value)} placeholder="UTR / UPI ref" /></Field>
      </Row>
      <Field label="Remarks"><textarea style={{ ...IShi(auto.remarks), resize: 'vertical', minHeight: 48 }} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} /></Field>
    </FormShell>
  );
}
