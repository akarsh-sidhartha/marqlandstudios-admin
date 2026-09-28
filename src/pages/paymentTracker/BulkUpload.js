/**
 * paymentTracker/BulkUpload.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Upload many PIs, invoices or payment proofs at once:
 *
 *   1. every file is read by the open-source extractor (two at a time)
 *   2. each becomes an editable row: Ready · Needs review · Duplicate
 *   3. "Save all ready" saves only the clean rows
 *   4. anything that fails or turns out to be a duplicate stays under
 *      "Needs attention" to fix and retry — or remove — separately
 *
 * The field rules (mapping, required fields, duplicates, payload) come from
 * docKinds.js — the same rules the single-document forms use.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { FileText, Trash2, RotateCcw, CheckCircle, AlertTriangle, Plus, Eye } from 'lucide-react';
import trackerApi, { friendlyError, duplicateInfo } from './trackerApi';
import { DOC_KINDS } from './docKinds';
import { Modal, VendorSelect, SearchSelect, Spinner, ErrBox } from './components';
import { T, IS, fmt, prepareFile, PAYMENT_MODES, ACCEPT_DOCS } from './shared';

const CONCURRENCY = 2;
const MODE_OPTIONS = PAYMENT_MODES.map((m) => ({ value: m, label: m.toUpperCase() }));

/** Run `fn` over `items` with at most `limit` in flight. */
async function runPool(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

let seq = 0;
const newRow = (file, kind) => ({
  id: `r${++seq}`,
  file,
  name: file.name || 'document',
  previewUrl: file.type?.startsWith('image/') && file.type !== 'image/heic' ? URL.createObjectURL(file) : null,
  phase: 'reading', // reading → editable → saving → saved
  fields: DOC_KINDS[kind].empty(),
  auto: {},
  readError: '',
  saveError: '',
  saved: null,
});

// Editable columns per document type.
const COLUMNS = {
  pi: [
    { key: 'piNumber', label: 'PI number' },
    { key: 'vendor', label: 'Vendor', type: 'vendor', wide: true },
    { key: 'piDate', label: 'PI date', type: 'date' },
    { key: 'totalAmount', label: 'Total (incl. GST)', type: 'number' },
    { key: 'dueDate', label: 'Due date', type: 'date' },
  ],
  invoice: [
    { key: 'vendorId', label: 'Vendor', type: 'vendor', wide: true },
    { key: 'vendor_gst', label: 'GSTIN', upper: true },
    { key: 'invoice_number', label: 'Invoice number' },
    { key: 'date', label: 'Invoice date', type: 'date' },
    { key: 'total_amount', label: 'Total', type: 'number' },
    { key: 'cgst', label: 'CGST', type: 'number', twin: 'sgst' },
    { key: 'sgst', label: 'SGST', type: 'number', twin: 'cgst' },
    { key: 'igst', label: 'IGST', type: 'number' },
  ],
  payment: [
    { key: 'amount', label: 'Amount', type: 'number' },
    { key: 'paymentDate', label: 'Payment date', type: 'date' },
    { key: 'vendor', label: 'Vendor (payee)', type: 'vendor', wide: true },
    { key: 'paymentMode', label: 'Mode', type: 'mode' },
    { key: 'bankRef', label: 'Bank ref / UTR', upper: true },
    { key: 'remarks', label: 'Remarks' },
  ],
};

export default function BulkUpload({ kind, initialFiles, data, onClose, onSavedSome, fullScreen }) {
  const K = DOC_KINDS[kind];
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [notice, setNotice] = useState('');
  const addRef = useRef();
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const patchRow = useCallback((id, patch) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)));
  }, []);

  // ── Reading ──────────────────────────────────────────────────────────────────
  const addFiles = useCallback(async (fileList) => {
    const fresh = Array.from(fileList || []).map((f) => newRow(f, kind));
    if (!fresh.length) return;
    setRows((rs) => [...rs, ...fresh]);
    await runPool(fresh, CONCURRENCY, async (row) => {
      try {
        const prepared = await prepareFile(row.file);
        const ex = await trackerApi.extract(prepared, K.docType);
        const read = Object.fromEntries(Object.entries(K.fromExtract(ex, data)).filter(([, v]) => v !== null && v !== undefined && v !== ''));
        patchRow(row.id, (r) => ({
          file: prepared,
          phase: 'editable',
          fields: { ...r.fields, ...read },
          auto: Object.fromEntries(Object.keys(read).map((k) => [k, true])),
          readName: K.readName(ex) || '',
        }));
      } catch (e) {
        patchRow(row.id, { phase: 'editable', readError: `Couldn't read automatically (${friendlyError(e)}) — please fill in.` });
      }
    });
  }, [K, data, kind, patchRow]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    addFiles(initialFiles);
  }, [addFiles, initialFiles]);

  // Revoke preview URLs when rows go away.
  useEffect(() => () => rowsRef.current.forEach((r) => r.previewUrl && URL.revokeObjectURL(r.previewUrl)), []);

  // ── Status of every row (derived, so it updates as the user edits) ───────────
  const statusOf = useMemo(() => {
    const seen = new Map();
    const out = {};
    for (const r of rows) {
      if (r.phase === 'saved') { out[r.id] = { state: 'saved' }; continue; }
      if (r.phase === 'reading') { out[r.id] = { state: 'reading' }; continue; }
      if (r.phase === 'saving') { out[r.id] = { state: 'saving' }; continue; }
      const missing = K.missing(r.fields);
      const key = K.batchKey(r.fields);
      const inBatch = key && seen.has(key) ? `Same ${K.noun} as "${seen.get(key)}" in this upload` : null;
      if (key && !seen.has(key)) seen.set(key, r.name);
      const dup = K.duplicate(r.fields, { pis: data.pis, invoices: data.invoices, payments: data.payments }) || inBatch;
      if (r.saveError) out[r.id] = { state: r.saveDuplicate ? 'duplicate' : 'failed', msg: r.saveError };
      else if (dup) out[r.id] = { state: 'duplicate', msg: dup };
      else if (missing.length) out[r.id] = { state: 'review', msg: `Needs: ${missing.join(', ')}` };
      else out[r.id] = { state: 'ready' };
    }
    return out;
  }, [rows, K, data]);

  const counts = useMemo(() => Object.values(statusOf).reduce((c, s) => ({ ...c, [s.state]: (c[s.state] || 0) + 1 }), {}), [statusOf]);
  const attention = (counts.review || 0) + (counts.duplicate || 0) + (counts.failed || 0);
  const readyRows = rows.filter((r) => statusOf[r.id]?.state === 'ready');

  // ── Saving ───────────────────────────────────────────────────────────────────
  const saveRows = async (list) => {
    if (!list.length) return;
    setSaving(true);
    setNotice('');
    let ok = 0;
    await runPool(list, CONCURRENCY, async (row) => {
      patchRow(row.id, { phase: 'saving', saveError: '', saveDuplicate: false });
      try {
        const saved = await K.save(row.fields, row.file);
        ok += 1;
        patchRow(row.id, { phase: 'saved', saved, warning: saved._warning || '' });
      } catch (e) {
        const dup = duplicateInfo(e);
        patchRow(row.id, { phase: 'editable', saveError: dup ? `Already exists: ${friendlyError(e)}` : friendlyError(e), saveDuplicate: !!dup });
      }
    });
    setSaving(false);
    if (ok) onSavedSome(ok);
    const failed = list.length - ok;
    setNotice(failed ? `${ok} saved. ${failed} couldn't be saved — see "Needs attention" below.` : `${ok} saved.`);
  };

  const editField = (row, col, value) => {
    patchRow(row.id, (r) => {
      const fields = { ...r.fields, [col.key]: value };
      // Vendor picked from the list: carry its name/GSTIN for invoices.
      if (kind === 'invoice' && col.key === 'vendorId') {
        const v = data.vendors.find((x) => x._id === value);
        fields.vendor_name = v?.companyName || r.fields.vendor_name;
        if (v?.gstNumber) fields.vendor_gst = v.gstNumber;
      }
      // CGST and SGST are always equal.
      if (col.twin && (!r.fields[col.twin] || r.fields[col.twin] === r.fields[col.key])) fields[col.twin] = value;
      const auto = { ...r.auto };
      delete auto[col.key];
      return { fields, auto, saveError: '', saveDuplicate: false };
    });
  };

  const removeRow = (row) => {
    if (row.previewUrl) URL.revokeObjectURL(row.previewUrl);
    setRows((rs) => rs.filter((r) => r.id !== row.id));
  };

  const unsaved = rows.filter((r) => r.phase !== 'saved').length;
  const requestClose = () => (unsaved && !confirmClose ? setConfirmClose(true) : onClose());

  // ── Rendering ────────────────────────────────────────────────────────────────
  const section = (title, list, color) => list.length > 0 && (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color, marginBottom: 8 }}>{title} ({list.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.map((r) => <RowCard key={r.id} row={r} status={statusOf[r.id]} columns={COLUMNS[kind]} vendors={data.vendors}
          fullScreen={fullScreen} onEdit={editField} onRemove={removeRow} onRetry={() => saveRows([r])} disabled={saving} />)}
      </div>
    </div>
  );

  const byState = (...states) => rows.filter((r) => states.includes(statusOf[r.id]?.state));

  const footer = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {confirmClose && <span style={{ fontSize: 12, color: T.red, flex: '1 1 220px' }}>{unsaved} document{unsaved > 1 ? 's are' : ' is'} not saved. Close anyway?</span>}
      <input ref={addRef} type="file" accept={ACCEPT_DOCS} multiple style={{ display: 'none' }} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      <button type="button" onClick={() => addRef.current?.click()} disabled={saving} style={btn('#fff', '#475569', '1.5px solid #e2e8f0')}><Plus size={14} /> Add files</button>
      <button type="button" onClick={requestClose} style={btn('#fff', confirmClose ? T.red : '#64748b', `1.5px solid ${confirmClose ? T.red : '#e2e8f0'}`)}>{confirmClose ? 'Discard & close' : 'Close'}</button>
      <button type="button" onClick={() => saveRows(readyRows)} disabled={saving || !readyRows.length}
        style={btn(saving || !readyRows.length ? '#e2e8f0' : T.cyan, saving || !readyRows.length ? '#94a3b8' : '#fff')}>
        {saving ? 'Saving…' : `Save ${readyRows.length || ''} ready`}
      </button>
    </div>
  );

  return (
    <Modal title={`Bulk upload — ${K.title}`} onClose={requestClose} extraWide fullScreen={fullScreen} footer={footer}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {[['reading', 'Reading', T.slateL], ['ready', 'Ready', T.green], ['review', 'Needs review', T.amber], ['duplicate', 'Duplicate', T.red], ['failed', 'Failed', T.red], ['saved', 'Saved', T.blue]]
          .filter(([k]) => counts[k])
          .map(([k, label, color]) => <span key={k} style={{ fontSize: 12, fontWeight: 700, color, border: `1px solid ${color}55`, borderRadius: 20, padding: '3px 10px' }}>{counts[k]} {label}</span>)}
      </div>
      {kind === 'payment' && <div style={{ fontSize: 12, color: '#92400e', background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>Bulk payments are saved as <b>advances</b> — map each to its PI or invoice from the Payments tab.</div>}
      {notice && <div role="status" style={{ fontSize: 13, color: attention ? '#b45309' : T.green, marginBottom: 14, fontWeight: 600 }}>{notice}</div>}

      {section('Reading', byState('reading'), T.slateL)}
      {section('Ready to save', byState('ready', 'saving'), T.green)}
      {section('Needs attention — not saved', byState('review', 'duplicate', 'failed'), T.red)}
      {section('Saved', byState('saved'), T.blue)}
      {!rows.length && <ErrBox msg="No files selected." />}
    </Modal>
  );
}

const btn = (bg, color, border = 'none') => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 8, border, background: bg, color, fontWeight: 700, fontSize: 14, cursor: 'pointer' });

const STATE_STYLE = {
  reading: { color: T.slateL, icon: <Spinner size={14} color={T.slateL} />, label: 'Reading…' },
  saving: { color: T.cyan, icon: <Spinner size={14} color={T.cyan} />, label: 'Saving…' },
  ready: { color: T.green, icon: <CheckCircle size={14} />, label: 'Ready' },
  review: { color: T.amber, icon: <AlertTriangle size={14} />, label: 'Needs review' },
  duplicate: { color: T.red, icon: <AlertTriangle size={14} />, label: 'Duplicate' },
  failed: { color: T.red, icon: <AlertTriangle size={14} />, label: 'Not saved' },
  saved: { color: T.blue, icon: <CheckCircle size={14} />, label: 'Saved' },
};

function RowCard({ row, status = { state: 'reading' }, columns, vendors, fullScreen, onEdit, onRemove, onRetry, disabled }) {
  const st = STATE_STYLE[status.state];
  const locked = ['reading', 'saving', 'saved'].includes(status.state);
  const openPreview = () => { const u = URL.createObjectURL(row.file); window.open(u, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(u), 60_000); };

  if (status.state === 'saved') {
    const s = row.saved || {};
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: `1px solid ${T.blue}33`, borderRadius: 10, background: '#f8fafc', fontSize: 13 }}>
        <CheckCircle size={16} color={T.blue} />
        <span style={{ fontWeight: 700 }}>{s.piNumber || s.invoice_number || s.paymentRef}</span>
        <span style={{ color: '#64748b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.vendor?.companyName || s.vendor_name || row.name}</span>
        <span style={{ fontWeight: 700 }}>{fmt(s.totalAmount ?? s.total_amount ?? s.amount)}</span>
        {row.warning && <span title={row.warning} style={{ color: '#b45309' }}><AlertTriangle size={14} /></span>}
      </div>
    );
  }

  return (
    <div style={{ border: `1.5px solid ${st.color}55`, borderLeft: `4px solid ${st.color}`, borderRadius: 10, padding: 12, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: locked && status.state === 'reading' ? 0 : 10 }}>
        <button type="button" onClick={openPreview} title="Open document" style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', overflow: 'hidden', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {row.previewUrl ? <img src={row.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <FileText size={20} color="#94a3b8" />}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: st.color, fontWeight: 600 }}>
            {st.icon} {st.label}{status.msg ? <span style={{ color: '#64748b', fontWeight: 400 }}> — {status.msg}</span> : null}
          </div>
          {row.readError && <div style={{ fontSize: 11, color: '#b45309' }}>{row.readError}</div>}
          {row.readName && columns.some((c) => c.type === 'vendor') && !row.fields.vendor && !row.fields.vendorId && (
            <div style={{ fontSize: 11, color: '#64748b' }}>Read as “{row.readName}” — not in your vendor list; pick or add it.</div>
          )}
        </div>
        <button type="button" onClick={openPreview} aria-label="Preview" style={iconBtn}><Eye size={15} /></button>
        {(status.state === 'failed' || status.state === 'duplicate') && row.saveError && (
          <button type="button" onClick={onRetry} disabled={disabled} aria-label="Retry" title="Retry saving" style={iconBtn}><RotateCcw size={15} /></button>
        )}
        {status.state !== 'saving' && <button type="button" onClick={() => onRemove(row)} aria-label="Remove" title="Remove from this upload" style={{ ...iconBtn, color: T.red }}><Trash2 size={15} /></button>}
      </div>
      {status.state !== 'reading' && (
        <div style={{ display: 'grid', gridTemplateColumns: fullScreen ? '1fr 1fr' : 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
          {columns.map((col) => (
            <label key={col.key} style={{ gridColumn: col.wide ? (fullScreen ? '1 / -1' : 'span 2') : undefined, display: 'block', minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{col.label}</span>
              <Cell col={col} row={row} vendors={vendors} disabled={locked} onChange={(v) => onEdit(row, col, v)} />
            </label>
          ))}
          {row.fields.vendor_name && !row.fields.vendorId && columns.some((c) => c.key === 'vendorId') && (
            <label style={{ gridColumn: fullScreen ? '1 / -1' : 'span 2' }}>
              <span style={{ display: 'block', fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Vendor name (new)</span>
              <input style={cell(false)} value={row.fields.vendor_name} disabled={locked} onChange={(e) => onEdit(row, { key: 'vendor_name' }, e.target.value)} />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

const iconBtn = { width: 32, height: 32, borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', flexShrink: 0 };
const cell = (hi) => ({ ...IS, padding: '7px 10px', fontSize: 13, ...(hi ? { border: `1px solid ${T.gold}`, background: T.dimBg } : {}) });

function Cell({ col, row, vendors, disabled, onChange }) {
  const v = row.fields[col.key] ?? '';
  const hi = !!row.auto[col.key];
  if (col.type === 'vendor') return <VendorSelect compact vendors={vendors} value={v} onChange={onChange} highlighted={hi} placeholder="Search vendor…" />;
  if (col.type === 'mode') return <SearchSelect compact options={MODE_OPTIONS} value={v} onChange={(x) => onChange(x || 'other')} clearable={false} highlighted={hi} />;
  return (
    <input
      type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
      inputMode={col.type === 'number' ? 'decimal' : undefined}
      style={cell(hi)} value={v} disabled={disabled}
      onChange={(e) => onChange(col.upper ? e.target.value.toUpperCase() : e.target.value)}
    />
  );
}
