/**
 * paymentTracker/InvoiceVaultTab.js — FY → Month → Invoice hierarchy with the
 * payment trail (invoice → PI → payments), CSV export and ZIP download.
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Trash2, Link2, FolderOpen, Folder, ChevronDown, ChevronRight, Download, Archive, X, Eye, FileText, CreditCard, ClipboardList } from 'lucide-react';
import trackerApi, { docUrl } from './trackerApi';
import { DocLink, ProgressBar, SearchSelect } from './components';
import { T, IS, fmt, fmtN, fmtDate, normalizeFY, invoiceTrail, invoiceMatches } from './shared';
import { createLogger } from '../../utils/logger';

const log = createLogger('PaymentTracker.vault');

// JSZip + FileSaver are only needed for "Zip" downloads — loaded on demand.
const ZIP_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js',
];
const loadScript = (src) => new Promise((resolve) => {
  if (document.querySelector(`script[src="${src}"]`)) return resolve(true);
  const el = document.createElement('script');
  el.src = src;
  el.crossOrigin = 'anonymous';
  el.onload = () => resolve(true);
  el.onerror = () => resolve(false);
  document.head.appendChild(el);
});

// ── Shared vendor-name filter for Invoice tab (uses name strings, not IDs) ────
/** Vendor-name filter for the vault (vault invoices store names, not vendor ids). */
export function GlobalVendorNameFilter({ invoices, value, onChange }) {
  const options = useMemo(
    () => [...new Set(invoices.map((i) => i.vendor_name).filter(Boolean))].sort().map((n) => ({ value: n, label: n })),
    [invoices],
  );
  return (
    <div style={{ width: 220, flexShrink: 0 }}>
      <SearchSelect compact options={options} value={value} onChange={onChange} placeholder="All vendors" emptyText="No vendors match" />
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// INVOICE VAULT TAB — FY/Month hierarchy with payment backtrack
// ═══════════════════════════════════════════════════════════════════════════════
export default function InvoiceVaultTab({ invoices, payments, proformaInvoices, onDelete, onViewInvoice, onUpload, onToast, externalSearch, externalVendorFilter }) {
  const [expandedFY, setExpandedFY] = useState(null);
  const [expandedMo, setExpandedMo] = useState(null);
  const [expandedInv, setExpandedInv] = useState(null);
  const [zipLoading, setZipLoading] = useState(false);
  const [zipProgress, setZipProgress] = useState(null); // { current, total }
  const [docList, setDocList] = useState(null);

  useEffect(() => { ZIP_LIBS.forEach(loadScript); }, []);

  const filteredInvoices = useMemo(() => invoices.filter((inv) => {
    if (externalVendorFilter && inv.vendor_name !== externalVendorFilter) return false;
    return invoiceMatches(inv, externalSearch);
  }), [invoices, externalSearch, externalVendorFilter]);

  const hierarchy = filteredInvoices.reduce((acc, inv) => {
    const fy = normalizeFY(inv.financialYear || 'Other');
    const mo = inv.month || 'Other';
    if (!acc[fy]) acc[fy] = {};
    if (!acc[fy][mo]) acc[fy][mo] = [];
    acc[fy][mo].push(inv);
    return acc;
  }, {});

  const getTotals = (items) =>
    items.reduce(
      (s, i) => ({
        total: s.total + (Number(i.total_amount) || 0),
        cgst: s.cgst + (Number(i.cgst) || 0),
        sgst: s.sgst + (Number(i.sgst) || 0),
        igst: s.igst + (Number(i.igst) || 0),
      }),
      { total: 0, cgst: 0, sgst: 0, igst: 0 },
    );

  const exportCSV = (label, items) => {
    const hdr = ['Date', 'Vendor Name', 'GSTIN', 'Invoice Number', 'CGST', 'SGST', 'IGST', 'Total Amount'];
    // Every cell quoted; text that a spreadsheet would run as a formula is neutralised.
    const cell = (v) => {
      const t = String(v ?? '');
      return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
    };
    const rows = items.map((inv) => [
      inv.date, inv.vendor_name, inv.vendor_gst, inv.invoice_number,
      inv.cgst || 0, inv.sgst || 0, inv.igst || 0, inv.total_amount || 0,
    ]);
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([[hdr, ...rows].map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv' }));
    a.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    a.download = `Invoices_${label}.csv`;
    a.click();
    log.debug('CSV exported', { label, count: items.length });
  };

  const downloadZip = async (label, items, isYearly = false) => {
    const J = window.JSZip;
    const S = window.saveAs;
    if (!J || !S) { onToast('Zip libraries are still loading — please try again in a moment.', 'warning'); return; }

    // Invoices that have a file in OneDrive or embedded image
    const downloadable = items.filter((inv) => inv.oneDriveFileId);
    if (downloadable.length === 0) {
      onToast('No invoice documents found to zip for this period.', 'warning'); return;
    }

    log.debug('Starting zip download', { label, total: downloadable.length });
    setZipLoading(true);
    setZipProgress({ current: 0, total: downloadable.length });

    const zip = new J();
    const root = zip.folder(label);
    let done = 0;

    try {
      for (const inv of downloadable) {
        const mime = inv.mimeType || 'application/pdf';
        const ext = mime === 'application/pdf' ? 'pdf' : 'jpg';

        // Filename = {invoice_number}_{vendor_name}.{ext}
        const safeNo = (inv.invoice_number || 'UNKNOWN').replace(/[^a-z0-9_\-]/gi, '_');
        const safeVend = (inv.vendor_name || '').replace(/[^a-z0-9_\-]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
        const name = safeVend ? `${safeNo}_${safeVend}` : safeNo;

        // For FY zips, put each invoice in a {Month} subfolder
        const folder = isYearly
          ? root.folder(inv.month || (() => {
            const d = new Date(inv.date);
            return !isNaN(d.getTime())
              ? d.toLocaleString('default', { month: 'long' })
              : 'Unknown';
          })())
          : root;

        // Use api (axios) — strip /api prefix since baseURL already includes it
        if (inv.oneDriveFileId) {
          try {
            const res = await trackerApi.fetchDocument(docUrl.invoice(inv._id));
            const blob = new Blob([res.data], { type: res.headers['content-type'] || mime });
            folder.file(`${name}.${ext}`, blob);
            log.debug('Zip: file fetched', { invoice: inv.invoice_number });
          } catch (fetchErr) {
            log.warn('Zip: skipping file — fetch failed', { invoice: inv.invoice_number, error: fetchErr.message });
          }
        }

        done++;
        setZipProgress({ current: done, total: downloadable.length });
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      S(blob, `${label.replace(/[\s/]/g, '_')}.zip`);
      log.info('Zip downloaded', { label, count: done });
    } catch (e) {
      log.error('Zip failed', e.message);
      onToast(`Zip failed: ${e.message}`, 'error');
    } finally {
      setZipLoading(false);
      setZipProgress(null);
    }
  };

  // Invoice → PI → payments (shared rule, see shared.js)
  const getInvoicePayments = (inv) => invoiceTrail(inv, { pis: proformaInvoices, payments });

  const grandT = getTotals(filteredInvoices);

  if (invoices.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', borderRadius: 14 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🧾</div>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Invoice Vault is empty</div>
        <div style={{ color: '#94a3b8', marginBottom: 20, fontSize: 13 }}>
          Upload invoices, or they appear automatically from WhatsApp & Outlook.
        </div>
        <button
          onClick={onUpload}
          style={{ background: '#0891b2', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}
        >
          🧾 Upload First Invoice
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Zip loading overlay */}
      {zipLoading && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 20, padding: '30px 40px', textAlign: 'center', minWidth: 220 }}>
            <div style={{ width: 36, height: 36, border: '3px solid #e2e8f0', borderTop: '3px solid #6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
            <div style={{ fontWeight: 700, fontSize: 13, color: '#475569', textTransform: 'uppercase', marginBottom: zipProgress ? 8 : 0 }}>Preparing Zip…</div>
            {zipProgress && (
              <>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
                  {zipProgress.current} / {zipProgress.total} invoices
                </div>
                <div style={{ height: 4, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 99, background: '#6366f1',
                    width: `${Math.round((zipProgress.current / zipProgress.total) * 100)}%`,
                    transition: 'width 0.2s ease',
                  }} />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Document list modal */}
      {docList && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 600, maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{docList.title}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{docList.items.length} docs</div>
              </div>
              <button onClick={() => setDocList(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {docList.items.map((inv) => (
                <div key={inv._id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{inv.vendor_name}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>INV: {inv.invoice_number} · {fmt(inv.total_amount)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { onViewInvoice(inv); setDocList(null); }} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, border: 'none', background: '#eff6ff', color: '#1d4ed8', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                      <Eye size={12} /> View
                    </button>
                    {inv.oneDriveFileId && (
                      <DocLink
                        url={docUrl.invoice(inv._id)}
                        mimeType={inv.mimeType}
                        label="⬇"
                        style={{ padding: '6px 12px', borderRadius: 7, background: '#f1f5f9', color: '#475569', fontSize: 11 }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Grand totals */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        {[
          ['Total Invoiced', fmt(grandT.total), '#1d4ed8'],
          ['Total CGST', fmt(grandT.cgst), '#475569'],
          ['Total SGST', fmt(grandT.sgst), '#475569'],
          ['Total IGST', fmt(grandT.igst), '#475569'],
        ].map(([l, v, c]) => (
          <div key={l} style={{ padding: '14px 16px', background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      {/* FY / Month / Invoice hierarchy */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Object.entries(hierarchy).sort().reverse().map(([fy, months]) => {
          const allFYItems = Object.values(months).flat();
          const fyT = getTotals(allFYItems);

          return (
            <div key={fy} style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>

              {/* FY row */}
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: '#f8fafc', cursor: 'pointer' }}
                onClick={() => setExpandedFY(expandedFY === fy ? null : fy)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    {expandedFY === fy ? <FolderOpen size={18} color="#6366f1" /> : <Folder size={18} color="#6366f1" />}
                  </span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>FY {fy}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{allFYItems.length} invoices</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,80px)', gap: 8, textAlign: 'right' }}>
                    {[['CGST', fyT.cgst], ['SGST', fyT.sgst], ['IGST', fyT.igst], ['Total', fyT.total]].map(([l, v]) => (
                      <div key={l}>
                        <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>{l}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: l === 'Total' ? '#6366f1' : '#0f172a' }}>₹{fmtN(v)}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={(e) => { e.stopPropagation(); setDocList({ title: `FY ${fy} Vault`, items: allFYItems.filter((i) => i.oneDriveFileId) }); }} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      <Link2 size={12} /> Links
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); downloadZip(`FY_${fy}`, allFYItems, true); }} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      <Archive size={12} /> Zip
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); exportCSV(`FY_${fy}`, allFYItems); }} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      <Download size={12} /> Excel
                    </button>
                  </div>
                </div>
              </div>

              {/* Month rows */}
              {expandedFY === fy && (
                <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {Object.entries(months).map(([month, items]) => {
                    const moKey = `${fy}-${month}`;
                    const moT = getTotals(items);

                    return (
                      <div key={month} style={{ border: '1px solid #f1f5f9', borderRadius: 12, overflow: 'hidden' }}>

                        {/* Month header */}
                        <div
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', background: '#fafafa', cursor: 'pointer' }}
                          onClick={() => setExpandedMo(expandedMo === moKey ? null : moKey)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ display: 'flex', alignItems: 'center', color: '#94a3b8' }}>
                              {expandedMo === moKey ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </span>
                            <span style={{ fontWeight: 700, fontSize: 13 }}>{month}</span>
                            <span style={{ fontSize: 11, background: '#eff6ff', color: '#1d4ed8', borderRadius: 20, padding: '1px 8px', fontWeight: 700 }}>{items.length}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,80px)', gap: 8, textAlign: 'right' }}>
                              {[['CGST', moT.cgst], ['SGST', moT.sgst], ['IGST', moT.igst], ['Total', moT.total]].map(([l, v]) => (
                                <div key={l}>
                                  <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>{l}</div>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: l === 'Total' ? '#0891b2' : '#0f172a' }}>₹{fmtN(v)}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={(e) => { e.stopPropagation(); downloadZip(`${month}_${fy}`, items); }} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                                <Archive size={11} />
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); exportCSV(`${month}_${fy}`, items); }} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 6, border: 'none', background: '#10b981', color: '#fff', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                                <Download size={11} />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Invoice rows */}
                        {expandedMo === moKey && (
                          <div style={{ padding: '10px 14px' }}>
                            {items.map((inv) => {
                              const invKey = `${moKey}-${inv._id}`;
                              const { direct, matchedPI, piPayments } = getInvoicePayments(inv);
                              const hasPayments = direct.length > 0 || piPayments.length > 0 || !!matchedPI;

                              return (
                                <div key={inv._id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, marginBottom: 8, overflow: 'hidden' }}>

                                  {/* Invoice summary row */}
                                  <div
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer' }}
                                    onClick={() => setExpandedInv(expandedInv === invKey ? null : invKey)}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                      <span style={{ fontSize: 18 }}>{inv.mimeType === 'application/pdf' ? '📄' : '🖼'}</span>
                                      <div>
                                        <div style={{ fontWeight: 700, fontSize: 13 }}>{inv.vendor_name}</div>
                                        <div style={{ fontSize: 11, color: '#94a3b8' }}>INV: {inv.invoice_number} · {fmtDate(inv.date)}</div>
                                        {inv.notes && (
                                          <div style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                            marginTop: 4, padding: '3px 8px',
                                            background: '#fefce8', border: '1px solid #fde68a',
                                            borderRadius: 6, maxWidth: 300,
                                          }}>
                                            <FileText size={10} style={{ color: '#b45309', flexShrink: 0 }} />
                                            <span style={{
                                              fontSize: 11, color: '#78350f', fontWeight: 500,
                                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            }} title={inv.notes}>
                                              {inv.notes}
                                            </span>
                                          </div>
                                        )}
                                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 3 }}>
                                          {matchedPI && (
                                            <span style={{ fontSize: 10, fontWeight: 700, background: '#ede9fe', color: '#6d28d9', borderRadius: 20, padding: '1px 7px' }}>
                                              PI: {matchedPI.piNumber}
                                            </span>
                                          )}
                                          {(direct.length + piPayments.length) > 0 && (
                                            <span style={{ fontSize: 10, fontWeight: 700, background: '#d1fae5', color: '#065f46', borderRadius: 20, padding: '1px 7px' }}>
                                              {direct.length + piPayments.length} payment{direct.length + piPayments.length > 1 ? 's' : ''}
                                            </span>
                                          )}
                                          {inv.receivedVia && inv.receivedVia !== 'manual_upload' && (
                                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', background: inv.receivedVia === 'whatsapp' ? '#dcfce7' : '#dbeafe', color: inv.receivedVia === 'whatsapp' ? '#15803d' : '#1d4ed8', borderRadius: 20, padding: '1px 6px' }}>
                                              {inv.receivedVia}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                      <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: 15, fontWeight: 800, color: '#6366f1' }}>{fmt(inv.total_amount)}</div>
                                        {hasPayments && (
                                          <div style={{ fontSize: 11, color: '#10b981' }}>
                                            ✓ {direct.length + piPayments.length} payment{(direct.length + piPayments.length) > 1 ? 's' : ''} tracked
                                          </div>
                                        )}
                                      </div>
                                      <button onClick={(e) => { e.stopPropagation(); onViewInvoice(inv); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 7, border: 'none', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer' }}>
                                        <Eye size={13} />
                                      </button>
                                      <button onClick={(e) => { e.stopPropagation(); onDelete(inv._id); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 7, border: 'none', background: '#fef2f2', color: '#ef4444', cursor: 'pointer' }}>
                                        <Trash2 size={13} />
                                      </button>
                                      <span style={{ display: 'flex', alignItems: 'center', color: '#94a3b8' }}>
                                        {expandedInv === invKey ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Payment backtrack hierarchy */}
                                  {expandedInv === invKey && (
                                    <div style={{ background: '#f8fafc', borderTop: '1px solid #f1f5f9', padding: '14px 18px' }}>

                                      {/* Level 1 — Invoice node */}
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                        <div style={{ width: 28, height: 28, borderRadius: 8, background: '#0891b2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                          <FileText size={14} color="#fff" />
                                        </div>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                                          Invoice {inv.invoice_number}
                                          <span style={{ fontSize: 12, fontWeight: 400, color: '#64748b', marginLeft: 8 }}>{fmt(inv.total_amount)}</span>
                                        </div>
                                      </div>

                                      {/* Level 2 — Linked PI */}
                                      {matchedPI && (
                                        <div style={{ marginLeft: 14, borderLeft: '2px solid #e2e8f0', paddingLeft: 18, marginBottom: 8 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                              <div style={{ width: 24, height: 24, borderRadius: 7, background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                <ClipboardList size={12} color="#fff" />
                                              </div>
                                              <div style={{ fontSize: 12, fontWeight: 700, color: '#6366f1' }}>
                                                PI: {matchedPI.piNumber}
                                                <span style={{ fontSize: 11, fontWeight: 400, color: '#64748b', marginLeft: 8 }}>
                                                  Total: {fmt(matchedPI.totalAmount)} · Paid: {fmt(matchedPI.amountPaid)}
                                                </span>
                                              </div>
                                            </div>
                                            {matchedPI.attachmentFileId && (
                                              <DocLink
                                                url={docUrl.piAttach(matchedPI._id)}
                                                mimeType={matchedPI.attachmentMime}
                                                label="PI Doc"
                                                style={{ background: '#ede9fe', color: '#6d28d9', padding: '4px 9px', fontSize: 10 }}
                                              />
                                            )}
                                          </div>

                                          {/* Level 3 — Payments via PI */}
                                          {piPayments.length > 0 && (
                                            <div style={{ marginLeft: 14, borderLeft: '2px solid #e2e8f0', paddingLeft: 14 }}>
                                              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
                                                Payments via PI ({piPayments.length})
                                              </div>
                                              {piPayments.map((p, i) => (
                                                <div key={p._id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: '#ede9fe', borderRadius: 8, marginBottom: 4 }}>
                                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <CreditCard size={12} style={{ color: '#6366f1', flexShrink: 0 }} />
                                                    <div>
                                                      <div style={{ fontSize: 12, fontWeight: 700, color: '#4f46e5' }}>{fmt(p.amount)}</div>
                                                      <div style={{ fontSize: 11, color: '#64748b' }}>{fmtDate(p.paymentDate)} · {p.paymentMode?.toUpperCase()}{p.bankRef ? ` · ${p.bankRef}` : ''}</div>
                                                    </div>
                                                  </div>
                                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{p.paymentRef}</span>
                                                    {p.screenshotFileId && (
                                                      <DocLink
                                                        url={docUrl.payReceipt(p._id)}
                                                        mimeType={p.screenshotMime}
                                                        label="Receipt"
                                                        style={{ background: '#ddd6fe', color: '#5b21b6', padding: '3px 7px', fontSize: 10 }}
                                                      />
                                                    )}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          {piPayments.length === 0 && (
                                            <div style={{ marginLeft: 14, fontSize: 11, color: '#94a3b8', paddingBottom: 4 }}>
                                              No payments recorded against this PI yet
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {/* Direct payments against invoice */}
                                      {direct.length > 0 && (
                                        <div style={{ marginLeft: 14, borderLeft: '2px solid #e2e8f0', paddingLeft: 18, marginBottom: 8 }}>
                                          <div style={{ fontSize: 11, color: '#0891b2', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
                                            Direct Invoice Payments ({direct.length})
                                          </div>
                                          {direct.map((p, i) => (
                                            <div key={p._id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: '#e0f2fe', borderRadius: 8, marginBottom: 4 }}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <CreditCard size={12} style={{ color: '#0891b2', flexShrink: 0 }} />
                                                <div>
                                                  <div style={{ fontSize: 12, fontWeight: 700, color: '#0369a1' }}>{fmt(p.amount)}</div>
                                                  <div style={{ fontSize: 11, color: '#64748b' }}>{fmtDate(p.paymentDate)} · {p.paymentMode?.toUpperCase()}{p.bankRef ? ` · ${p.bankRef}` : ''}</div>
                                                </div>
                                              </div>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{p.paymentRef}</span>
                                                {p.screenshotFileId && (
                                                  <DocLink
                                                    url={docUrl.payReceipt(p._id)}
                                                    mimeType={p.screenshotMime}
                                                    label="Receipt"
                                                    style={{ background: '#bfdbfe', color: '#1d4ed8', padding: '3px 7px', fontSize: 10 }}
                                                  />
                                                )}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}

                                      {/* No payments at all */}
                                      {direct.length === 0 && !matchedPI && (
                                        <div style={{ marginLeft: 14, fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
                                          No payments linked to this invoice yet.
                                        </div>
                                      )}

                                      {/* Summary footer */}
                                      {(direct.length > 0 || piPayments.length > 0) && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
                                          <div style={{ fontSize: 12, color: '#475569' }}>
                                            Total paid:{' '}
                                            <b style={{ color: '#10b981' }}>
                                              {fmt([...direct, ...piPayments].reduce((s, p) => s + p.amount, 0))}
                                            </b>
                                            <span style={{ color: '#94a3b8', marginLeft: 6 }}>
                                              / Invoice: <b style={{ color: '#0891b2' }}>{fmt(inv.total_amount)}</b>
                                            </span>
                                          </div>
                                          <div style={{ width: 120 }}>
                                            <ProgressBar
                                              paid={[...direct, ...piPayments].reduce((s, p) => s + p.amount, 0)}
                                              total={inv.total_amount}
                                              height={6}
                                            />
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
