/**
 * paymentTracker/docKinds.js
 * ─────────────────────────────────────────────────────────────────────────────
 * The rules for each document type — PI, invoice, payment — in one place:
 * how extracted values map to form fields, what is required, how duplicates
 * are recognised, and how a record is saved. Used by the single-document
 * forms (forms.js) and the bulk flow (BulkUpload.js), so both always agree.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import trackerApi from './trackerApi';
import { todayISO, matchVendor } from './shared';

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const str = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => parseFloat(v) || 0;
const up = (v) => str(v).trim().toUpperCase();

// ── Proforma invoice ──────────────────────────────────────────────────────────
const pi = {
  key: 'pi',
  docType: 'pi',
  title: 'Proforma Invoices',
  noun: 'PI',
  empty: () => ({ piNumber: '', vendor: '', piDate: todayISO(), dueDate: '', totalAmount: '', currency: 'INR', bankDetails: '', notes: '' }),
  fromExtract: (ex, { vendors }) => ({
    piNumber: ex.invoice_number,
    piDate: ex.date,
    dueDate: ex.due_date,
    totalAmount: str(ex.total_amount),
    vendor: matchVendor(vendors, { name: ex.vendor_name, gstin: ex.vendor_gst })?._id,
    bankDetails: ex.bank_details,
    notes: ex.subject,
  }),
  readName: (ex) => ex.vendor_name,
  missing: (f) => [
    !str(f.piNumber).trim() && 'PI number',
    !f.vendor && 'vendor',
    !(num(f.totalAmount) > 0) && 'total amount',
  ].filter(Boolean),
  duplicate: (f, { pis }) => {
    const n = up(f.piNumber);
    const hit = n && pis.find((p) => up(p.piNumber) === n);
    return hit ? `PI ${hit.piNumber} already exists` : null;
  },
  batchKey: (f) => up(f.piNumber),
  payload: (f) => ({ ...f, piNumber: str(f.piNumber).trim(), totalAmount: num(f.totalAmount) }),
  save: (f, file) => trackerApi.createPi(pi.payload(f), file),
  label: (f) => f.piNumber || 'PI',
};

// ── Vendor invoice ────────────────────────────────────────────────────────────
const invoice = {
  key: 'invoice',
  docType: 'invoice',
  title: 'Invoices',
  noun: 'invoice',
  empty: () => ({ vendorId: '', vendor_name: '', vendor_gst: '', invoice_number: '', date: todayISO(), total_amount: '', cgst: '', sgst: '', igst: '', notes: '', linkedPi: '' }),
  fromExtract: (ex, { vendors }) => {
    const v = matchVendor(vendors, { name: ex.vendor_name, gstin: ex.vendor_gst });
    return {
      vendorId: v?._id,
      vendor_name: v?.companyName || ex.vendor_name,
      vendor_gst: ex.vendor_gst || v?.gstNumber,
      invoice_number: ex.invoice_number,
      date: ex.date,
      total_amount: str(ex.total_amount),
      cgst: str(ex.cgst),
      sgst: str(ex.sgst ?? ex.cgst), // CGST and SGST are always equal
      igst: str(ex.igst),
    };
  },
  readName: (ex) => ex.vendor_name,
  /** Tax split rule shared with the form: CGST+SGST or IGST, never both. */
  taxState: (f) => {
    const intra = num(f.cgst) > 0 && num(f.sgst) > 0;
    const inter = num(f.igst) > 0;
    return { intra, inter, ok: (intra || inter) && !(intra && inter) };
  },
  missing: (f) => {
    const { intra, inter, ok } = invoice.taxState(f);
    const gst = up(f.vendor_gst);
    return [
      !str(f.invoice_number).trim() && 'invoice number',
      !f.vendorId && !str(f.vendor_name).trim() && 'vendor',
      !GSTIN_RE.test(gst) && (gst ? 'valid GSTIN' : 'GSTIN'),
      !(num(f.total_amount) > 0) && 'total amount',
      !ok && (intra && inter ? 'either CGST+SGST or IGST (not both)' : 'GST amounts'),
    ].filter(Boolean);
  },
  duplicate: (f, { invoices }) => {
    const n = up(f.invoice_number);
    const g = up(f.vendor_gst);
    if (!n) return null;
    const hit = invoices.find((i) => up(i.invoice_number) === n && (g ? up(i.vendor_gst) === g : up(i.vendor_name) === up(f.vendor_name)));
    return hit ? `Invoice #${hit.invoice_number} from ${hit.vendor_name} is already in the vault` : null;
  },
  batchKey: (f) => `${up(f.vendor_gst) || up(f.vendor_name)}|${up(f.invoice_number)}`,
  payload: (f) => ({
    vendorId: f.vendorId,
    vendor_name: str(f.vendor_name).trim(),
    vendor_gst: up(f.vendor_gst),
    invoice_number: str(f.invoice_number).trim(),
    date: f.date,
    total_amount: num(f.total_amount),
    cgst: num(f.cgst),
    sgst: num(f.sgst),
    igst: num(f.igst),
    notes: f.notes,
    linkedPi: f.linkedPi,
  }),
  save: (f, file) => trackerApi.createInvoice(invoice.payload(f), file),
  label: (f) => f.invoice_number || 'Invoice',
};

// ── Payment ───────────────────────────────────────────────────────────────────
const payment = {
  key: 'payment',
  docType: 'payment',
  title: 'Payments',
  noun: 'payment',
  empty: () => ({ vendor: '', paymentDate: todayISO(), amount: '', currency: 'INR', paymentMode: 'neft', bankRef: '', remarks: '', mappedTo: 'advance', proformaInvoice: '', vendorInvoice: '' }),
  fromExtract: (ex, { vendors }) => ({
    amount: str(ex.amount),
    paymentDate: ex.payment_date,
    paymentMode: ex.payment_mode,
    bankRef: ex.bank_ref,
    remarks: ex.remarks,
    vendor: matchVendor(vendors, { name: ex.payee_name })?._id,
  }),
  readName: (ex) => ex.payee_name,
  missing: (f) => [
    !(num(f.amount) > 0) && 'amount',
    !f.paymentDate && 'date',
    f.mappedTo === 'proforma_invoice' && !f.proformaInvoice && 'PI',
    f.mappedTo === 'vendor_invoice' && !f.vendorInvoice && 'invoice',
  ].filter(Boolean),
  duplicate: (f, { payments }) => {
    const r = up(f.bankRef);
    const hit = r && payments.find((p) => up(p.bankRef) === r);
    return hit ? `Reference ${hit.bankRef} is already recorded (${hit.paymentRef})` : null;
  },
  batchKey: (f) => up(f.bankRef),
  payload: (f) => ({
    vendor: f.vendor,
    paymentDate: f.paymentDate,
    amount: num(f.amount),
    currency: f.currency,
    paymentMode: f.paymentMode,
    bankRef: str(f.bankRef).trim(),
    remarks: f.remarks,
    mappedTo: f.mappedTo,
    proformaInvoice: f.mappedTo === 'proforma_invoice' ? f.proformaInvoice : '',
    vendorInvoice: f.mappedTo === 'vendor_invoice' ? f.vendorInvoice : '',
  }),
  save: (f, file) => trackerApi.createPayment(payment.payload(f), file),
  label: (f) => f.bankRef || (f.amount ? `₹${f.amount}` : 'Payment'),
};

export const DOC_KINDS = { pi, invoice, payment };

