/**
 * PaymentTracker.js — vendor PIs, payments and the invoice vault.
 * ─────────────────────────────────────────────────────────────────────────────
 * Module layout (src/pages/paymentTracker/):
 *   trackerApi.js       every HTTP call (one /overview load, idempotent creates)
 *   hooks.js            useTrackerData · useDocumentScan · useAutoForm · useIsMobile
 *   forms.js            Upload PI / Upload Invoice / Record Payment — shared by
 *                       desktop (dialog) and mobile (full-screen)
 *   modals.js           PI flow · map advance · invoice viewer
 *   InvoiceVaultTab.js  FY → month → invoice hierarchy, CSV / ZIP export
 *   MobileTracker.js    phone layout: the three capture actions only
 *   components.js       UI atoms · shared.js tokens, formatters, relations
 *
 * Documents are read by the backend's open-source extractor (pdf.js +
 * Tesseract) — no Gemini or other paid API is involved.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useState, useMemo, useCallback } from 'react';
import { Trash2, Search, X, MapPin, ClipboardList, FileUp, Plus } from 'lucide-react';
import { usePopup, AppPopupStyles } from '../components/AppPopups';
import trackerApi, { friendlyError, docUrl } from './paymentTracker/trackerApi';
import { useIsMobile, useTrackerData } from './paymentTracker/hooks';
import { Badge, ProgressBar, DocLink, VendorSelect, SearchSelect } from './paymentTracker/components';
import { T, jost, serif, IS, STATUS_META, fmt, fmtDate, fiscalOf, currentFY, normalizeFY, paymentsByPi, invoiceTrail, idOf, piMatches, paymentMatches, invoiceMatches } from './paymentTracker/shared';
import InvoiceVaultTab, { GlobalVendorNameFilter } from './paymentTracker/InvoiceVaultTab';
import MobileTracker from './paymentTracker/MobileTracker';
import { PiForm, InvoiceForm, PaymentForm } from './paymentTracker/forms';
import { MapAdvanceModal, PIFlowModal, InvoiceViewerModal } from './paymentTracker/modals';
import BulkUpload from './paymentTracker/BulkUpload';

const PI_STATUSES = ['pending', 'partial', 'fully_paid', 'invoiced', 'cancelled'];
const PAYMENT_STATUSES = ['recorded', 'verified', 'reconciled'];

export default function PaymentTracker() {
  // All hooks run unconditionally (the old page returned early on mobile
  // before its effects, which broke React's rules of hooks).
  const isMobile = useIsMobile();
  const { data, loading, error, reload } = useTrackerData();
  const { showToast: popupToast, confirm, Toast, ConfirmDialog } = usePopup();
  const showToast = useCallback((msg, type = 'success') => popupToast(type, msg, type === 'success' ? 2500 : 6000), [popupToast]);

  const [tab, setTab] = useState('pi');
  const [modal, setModal] = useState(null); // { type, id?, linkedPiId?, returnTo? }
  const [filterVendor, setFilterVendor] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalVendorFilter, setGlobalVendorFilter] = useState('');

  const openModal = useCallback((type, extra = {}) => setModal({ type, ...extra }), []);
  const closeModal = useCallback(() => setModal(null), []);
  const toBulk = useCallback((kind) => (files) => setModal({ type: 'bulk', kind, files }), []);

  /** After any successful write: toast, return to the PI flow if we came from it, refresh. */
  const onSaved = useCallback((record, message) => {
    if (record?._warning) showToast(`${message}. ${record._warning}`, 'warning');
    else showToast(message);
    setModal((m) => (m?.returnTo ? { type: 'pi_flow', id: m.returnTo } : null));
    reload({ silent: true });
  }, [reload, showToast]);

  // ── Derived data (memoised — recomputed only when the data changes) ────────
  const payByPi = useMemo(() => paymentsByPi(data.payments), [data.payments]);

  const filteredPIs = useMemo(() => data.pis.filter((p) => {
    if (filterVendor && idOf(p.vendor) !== filterVendor) return false;
    if (filterStatus) { if (p.status !== filterStatus) return false; }
    else if (!globalSearch && p.status === 'invoiced' && p.amountDue <= 0) return false; // closed PIs hidden unless searched
    return piMatches(p, globalSearch);
  }), [data.pis, filterVendor, filterStatus, globalSearch]);

  // Payments tab: unmapped advances by default; a search looks through every
  // payment so one made against a PI or invoice can be found by its number.
  const filteredPayments = useMemo(() => data.payments.filter((p) => {
    if (!globalSearch && p.mappedTo !== 'advance') return false;
    if (filterVendor && idOf(p.vendor) !== filterVendor) return false;
    if (filterStatus && p.status !== filterStatus) return false;
    return paymentMatches(p, globalSearch);
  }), [data.payments, filterVendor, filterStatus, globalSearch]);

  // "Also found in …" hints when the current tab has no (or few) matches.
  const otherTabHits = useMemo(() => {
    if (!globalSearch) return [];
    return [
      ['pi', 'Proforma Invoices', data.pis.filter((p) => piMatches(p, globalSearch)).length],
      ['payments', 'Payments', data.payments.filter((p) => paymentMatches(p, globalSearch)).length],
      ['invoices', 'Invoice Vault', data.invoices.filter((i) => invoiceMatches(i, globalSearch)).length],
    ].filter(([key, , n]) => key !== tab && n > 0);
  }, [globalSearch, data, tab]);

  const { statCards, tabs } = useMemo(() => {
    const thisFY = currentFY();
    const inFY = (d) => d && normalizeFY(fiscalOf(d).fy) === thisFY;
    const fyPIs = data.pis.filter((p) => inFY(p.piDate));
    const fyPayments = data.payments.filter((p) => inFY(p.paymentDate));
    const fyInvoices = data.invoices.filter((inv) => normalizeFY(inv.financialYear) === thisFY);
    const fyAdvances = fyPayments.filter((p) => p.mappedTo === 'advance').length;
    const advanceCount = data.payments.filter((p) => p.mappedTo === 'advance').length;
    const activePIs = data.pis.filter((p) => !(p.status === 'invoiced' && p.amountDue <= 0)).length;
    return {
      statCards: [
        { label: `PI Value ${thisFY}`, value: fmt(fyPIs.reduce((s, p) => s + p.totalAmount, 0)), sub: `${fyPIs.length} PIs this FY`, color: '#6366f1' },
        { label: `Paid ${thisFY}`, value: fmt(fyPayments.filter((p) => p.mappedTo !== 'advance').reduce((s, p) => s + p.amount, 0)), sub: `${fyPayments.length} payments · ${fyAdvances} unmapped`, color: '#10b981' },
        { label: 'Outstanding', value: fmt(fyPIs.filter((p) => p.status !== 'cancelled').reduce((s, p) => s + p.amountDue, 0)), sub: `Across FY ${thisFY} PIs`, color: '#f59e0b' },
        { label: 'Invoice Vault', value: String(fyInvoices.length), sub: `${fyAdvances} advances unmapped`, color: fyAdvances > 0 ? '#ef4444' : '#0891b2' },
      ],
      tabs: [
        { key: 'pi', label: '📋 Proforma Invoices', count: activePIs, total: data.pis.length },
        { key: 'payments', label: '💳 Advances', count: advanceCount, alert: advanceCount },
        { key: 'invoices', label: '🧾 Invoice Vault', count: data.invoices.length },
      ],
    };
  }, [data]);

  if (isMobile) return <MobileTracker data={data} loading={loading} error={error} reload={reload} />;

  const statusOptions = tab === 'pi' ? PI_STATUSES : PAYMENT_STATUSES;
  const byId = (list, id) => list.find((x) => x._id === id);
  const modalPi = modal?.type === 'pi_flow' ? byId(data.pis, modal.id) : null;
  const modalPayment = modal?.type === 'map' ? byId(data.payments, modal.id) : null;
  const modalInvoice = modal?.type === 'invoice_view' ? byId(data.invoices, modal.id) : null;

  return (
    <div style={{ minHeight: '100vh', background: T.offwhite, fontFamily: jost, padding: '56px 48px' }}>
      <AppPopupStyles />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <Toast />
      <ConfirmDialog />

      {/* ── Page header ───────────────────────────────────────────────── */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ width: 32, height: 1, background: T.gold, marginBottom: 20 }} />
        <p style={{
          fontSize: 9, fontWeight: 400, letterSpacing: '0.3em',
          textTransform: 'uppercase', color: T.muted, marginBottom: 10, fontFamily: jost,
        }}>
          Finance &amp; Operations
        </p>
        <h1 style={{
          fontFamily: serif, fontSize: 40, fontWeight: 300,
          color: T.navy, lineHeight: 1.05, margin: '0 0 24px',
        }}>
          Payment <em style={{ color: T.gold }}>Tracker.</em>
        </h1>

        {/* Action controls */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => openModal('pi')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'transparent', color: T.muted,
              border: `1px solid ${T.border}`, padding: '10px 20px',
              fontFamily: jost, fontSize: 10, fontWeight: 400,
              letterSpacing: '0.2em', textTransform: 'uppercase',
              cursor: 'pointer', transition: 'border-color 0.25s, color 0.25s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = T.gold; e.currentTarget.style.color = T.gold; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.muted; }}
          >
            <ClipboardList size={13} /> Upload PI
          </button>
          <button
            onClick={() => openModal('invoice')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'transparent', color: T.muted,
              border: `1px solid ${T.border}`, padding: '10px 20px',
              fontFamily: jost, fontSize: 10, fontWeight: 400,
              letterSpacing: '0.2em', textTransform: 'uppercase',
              cursor: 'pointer', transition: 'border-color 0.25s, color 0.25s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = T.gold; e.currentTarget.style.color = T.gold; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.muted; }}
          >
            <FileUp size={13} /> Upload Invoice
          </button>
          <button
            onClick={() => openModal('payment')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: T.gold, color: T.navy, border: 'none',
              padding: '11px 28px', fontFamily: jost, fontSize: 10, fontWeight: 500,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              cursor: 'pointer', transition: 'background 0.25s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = T.gold2}
            onMouseLeave={e => e.currentTarget.style.background = T.gold}
          >
            <Plus size={13} /> Record Payment
          </button>
        </div>
      </div>

      {/* ── Stat cards — borderless grid ───────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, marginBottom: 40, background: T.border }}>
        {statCards.map((c) => (
          <div key={c.label} style={{ background: '#fff', padding: '22px 24px', borderTop: `2px solid ${c.color}` }}>
            <p style={{
              fontFamily: jost, fontSize: 9, fontWeight: 400,
              letterSpacing: '0.25em', textTransform: 'uppercase',
              color: T.muted, margin: '0 0 10px',
            }}>
              {c.label}
            </p>
            <p style={{ fontFamily: serif, fontSize: 28, fontWeight: 300, color: T.navy, margin: '0 0 4px' }}>
              {c.value}
            </p>
            <p style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted, margin: 0 }}>
              {c.sub}
            </p>
          </div>
        ))}
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0, marginBottom: 0, borderBottom: `1px solid ${T.border}` }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setFilterStatus(''); setGlobalSearch(''); setGlobalVendorFilter(''); }}
            style={{
              padding: '12px 24px', border: 'none',
              borderBottom: tab === t.key ? `2px solid ${T.gold}` : '2px solid transparent',
              background: 'transparent', fontFamily: jost, fontSize: 10,
              fontWeight: tab === t.key ? 500 : 400,
              letterSpacing: '0.18em', textTransform: 'uppercase',
              color: tab === t.key ? T.gold : T.muted,
              cursor: 'pointer', transition: 'color 0.2s', marginBottom: -1,
            }}
            onMouseEnter={e => { if (tab !== t.key) e.currentTarget.style.color = T.text; }}
            onMouseLeave={e => { if (tab !== t.key) e.currentTarget.style.color = T.muted; }}
          >
            {t.label}
            {t.alert > 0 && (
              <span style={{ marginLeft: 8, background: T.red, color: '#fff', fontSize: 9, fontWeight: 600, padding: '1px 6px', letterSpacing: '0.05em' }}>
                {t.alert}
              </span>
            )}
            {t.count !== undefined && (
              <span style={{ marginLeft: 6, fontSize: 9, color: T.muted, letterSpacing: 0 }}>
                ({t.count}{t.total ? `/${t.total}` : ''})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Unified search + filter bar (common to all tabs) ───────────── */}
      <div style={{
        display: 'flex', gap: 10, alignItems: 'center',
        padding: '10px 16px',
        background: T.offwhite, border: `1px solid ${T.border}`, borderTop: 'none',
      }}>
        {/* Search input — placeholder adapts per tab */}
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: T.muted, display: 'flex', pointerEvents: 'none' }}>
            <Search size={14} />
          </span>
          <input
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder="Search invoice #, PI #, vendor, GSTIN, bank ref…"
            style={{ ...IS, paddingLeft: 34, paddingRight: globalSearch ? 34 : 12, fontSize: 12 }}
          />
          {globalSearch && (
            <button
              onClick={() => setGlobalSearch('')}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: T.muted, display: 'flex', alignItems: 'center', padding: 2 }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Vendor filter — for invoice tab uses vendor name strings; others use VendorSelect with IDs */}
        {tab === 'invoices' ? (
          <GlobalVendorNameFilter
            invoices={data.invoices}
            value={globalVendorFilter}
            onChange={setGlobalVendorFilter}
          />
        ) : (
          <div style={{ width: 200, flexShrink: 0 }}>
            <VendorSelect vendors={data.vendors} value={filterVendor} onChange={setFilterVendor} placeholder="All Vendors" />
          </div>
        )}

        {/* Status filter — PI and Payments tabs only */}
        {tab !== 'invoices' && (
          <div style={{ width: 170, flexShrink: 0 }}>
            <SearchSelect compact options={statusOptions.map((s) => ({ value: s, label: STATUS_META[s]?.label || s }))} value={filterStatus} onChange={setFilterStatus} placeholder="All statuses" />
          </div>
        )}

        {/* Clear all */}
        {(globalSearch || globalVendorFilter || filterVendor || filterStatus) && (
          <button
            onClick={() => { setGlobalSearch(''); setGlobalVendorFilter(''); setFilterVendor(''); setFilterStatus(''); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'none', border: `1px solid ${T.border}`,
              fontFamily: jost, fontSize: 9, letterSpacing: '0.15em',
              textTransform: 'uppercase', color: T.muted, flexShrink: 0,
              padding: '8px 14px', cursor: 'pointer',
              transition: 'color 0.2s, border-color 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = T.red; e.currentTarget.style.borderColor = T.red; }}
            onMouseLeave={e => { e.currentTarget.style.color = T.muted; e.currentTarget.style.borderColor = T.border; }}
          >
            <X size={11} /> Clear
          </button>
        )}
      </div>

      {otherTabHits.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 16px', background: T.dimBg, border: `1px solid ${T.border}`, borderTop: 'none', fontFamily: jost, fontSize: 11, color: T.muted }}>
          Also found:
          {otherTabHits.map(([key, label, n]) => (
            <button key={key} onClick={() => { setTab(key); setFilterStatus(''); }} style={{ background: '#fff', border: `1px solid ${T.borderG}`, color: T.gold, borderRadius: 12, padding: '2px 10px', fontSize: 11, cursor: 'pointer', fontFamily: jost }}>
              {n} in {label} →
            </button>
          ))}
        </div>
      )}

      {/* ── Tab content panel ──────────────────────────────────────────── */}
      <div style={{ background: 'white', border: `1px solid ${T.border}`, borderTop: 'none', overflow: 'hidden' }}>

        {/* Loading */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '64px 0' }}>
            <div style={{ width: 28, height: 28, border: `2px solid ${T.border}`, borderTop: `2px solid ${T.gold}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 14px' }} />
            <p style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, letterSpacing: '0.1em', color: T.muted }}>Loading…</p>
          </div>
        ) : (
          <>
            {/* ── PROFORMA INVOICES TAB ── */}
            {tab === 'pi' && (
              <>
                {filteredPIs.length === 0 ? (
                  <div style={{ padding: '64px 0', textAlign: 'center' }}>
                    <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, letterSpacing: '0.1em', color: T.muted, marginBottom: 20 }}>
                      No proforma invoices found
                    </p>
                    <button
                      onClick={() => openModal('pi')}
                      style={{
                        background: T.gold, color: T.navy, border: 'none',
                        padding: '11px 28px', fontFamily: jost, fontSize: 10, fontWeight: 500,
                        letterSpacing: '0.22em', textTransform: 'uppercase', cursor: 'pointer',
                      }}
                    >
                      Upload PI
                    </button>
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${T.border}`, background: T.offwhite }}>
                        {['PI Number', 'Vendor', 'Date / Due', 'Amount', 'Progress', 'Status', ''].map((h, i) => (
                          <th key={h + i} style={{
                            padding: '12px 18px',
                            textAlign: h === 'Amount' || h === '' ? 'right' : 'left',
                            fontFamily: jost, fontSize: 9, fontWeight: 400,
                            letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted,
                          }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPIs.map((pi) => (
                        <tr
                          key={pi._id}
                          onClick={() => openModal('pi_flow', { id: pi._id })}
                          style={{ borderBottom: `1px solid ${T.border}`, cursor: 'pointer', transition: 'background 0.15s' }}
                          onMouseEnter={e => e.currentTarget.style.background = T.dimBg}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <td style={{ padding: '16px 18px', fontFamily: jost, fontSize: 12, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.text }}>
                            {pi.piNumber}
                          </td>
                          <td style={{ padding: '16px 18px', fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted }}>
                            {pi.vendor?.companyName || '—'}
                            {pi.notes && (
                              <div style={{ fontSize: 10, color: T.muted, marginTop: 3, fontStyle: 'italic', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pi.notes}>
                                {pi.notes}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '16px 18px' }}>
                            <div style={{ fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted }}>{fmtDate(pi.piDate)}</div>
                            {pi.dueDate && <div style={{ fontFamily: jost, fontSize: 10, color: T.gold }}>Due {fmtDate(pi.dueDate)}</div>}
                          </td>
                          <td style={{ padding: '16px 18px', textAlign: 'right' }}>
                            <div style={{ fontFamily: serif, fontSize: 18, fontWeight: 300, color: T.navy }}>{fmt(pi.totalAmount)}</div>
                            <div style={{ fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted }}>Due: {fmt(pi.amountDue)}</div>
                          </td>
                          <td style={{ padding: '16px 18px', minWidth: 140 }}>
                            <ProgressBar paid={pi.amountPaid} total={pi.totalAmount} />
                          </td>
                          <td style={{ padding: '16px 18px' }}>
                            <Badge status={pi.status} />
                          </td>
                          <td style={{ padding: '16px 18px', textAlign: 'right' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>

                              {/* PI document chip */}
                              {pi.attachmentFileId && (
                                <span onClick={(e) => e.stopPropagation()}>
                                  <DocLink
                                    url={docUrl.piAttach(pi._id)}
                                    mimeType={pi.attachmentMime}
                                    label="PI"
                                    style={{
                                      fontFamily: jost, fontSize: 9, fontWeight: 400,
                                      letterSpacing: '0.12em', textTransform: 'uppercase',
                                      color: '#6d28d9', background: 'transparent',
                                      padding: '3px 8px', border: '1px solid #ede9fe', borderRadius: 4,
                                    }}
                                  />
                                </span>
                              )}

                              {/* Payment receipt chips — one per payment that has a screenshot */}
                              {(payByPi.get(String(pi._id)) || [])
                                .filter((p) => p.screenshotFileId)
                                .map((pay, i) => (
                                  <span key={pay._id || i} onClick={(e) => e.stopPropagation()}>
                                    <DocLink
                                      url={docUrl.payReceipt(pay._id)}
                                      mimeType={pay.screenshotMime}
                                      label={fmt(pay.amount)}
                                      style={{
                                        fontFamily: jost, fontSize: 9, fontWeight: 400,
                                        letterSpacing: '0.12em', textTransform: 'uppercase',
                                        color: '#15803d', background: 'transparent',
                                        padding: '3px 8px', border: '1px solid #bbf7d0', borderRadius: 4,
                                      }}
                                    />
                                  </span>
                                ))
                              }

                              <span style={{
                                fontFamily: jost, fontSize: 9, fontWeight: 400,
                                letterSpacing: '0.18em', textTransform: 'uppercase', color: T.gold,
                                pointerEvents: 'none',
                              }}>
                                View →
                              </span>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const ok = await confirm({
                                    title: `Delete PI ${pi.piNumber}?`,
                                    message: `Vendor: ${pi.vendor?.companyName || '—'} · ${fmt(pi.totalAmount)}. All linked payments will also be removed.`,
                                    confirmLabel: 'Delete',
                                    variant: 'danger',
                                  });
                                  if (!ok) return;
                                  try {
                                    await trackerApi.deletePi(pi._id);
                                    showToast('PI deleted', 'success');
                                    reload({ silent: true });
                                  } catch (err) {
                                    showToast(friendlyError(err), 'error');
                                  }
                                }}
                                title="Delete PI"
                                style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  width: 28, height: 28, borderRadius: 6,
                                  border: 'none', background: 'transparent',
                                  color: 'rgba(220,38,38,0.4)', cursor: 'pointer',
                                  transition: 'background 0.15s, color 0.15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = T.red; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(220,38,38,0.4)'; }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div style={{ borderTop: `1px solid ${T.border}`, padding: '10px 18px', fontFamily: jost, fontSize: 10, fontWeight: 300, letterSpacing: '0.12em', color: T.muted, textAlign: 'right' }}>
                  {filteredPIs.length} of {data.pis.length} proforma invoice{data.pis.length !== 1 ? 's' : ''}
                </div>
              </>
            )}

            {/* ── PAYMENTS (ADVANCES) TAB ── */}
            {tab === 'payments' && (
              <>
                {filteredPayments.length === 0 ? (
                  <div style={{ padding: '64px 0', textAlign: 'center' }}>
                    <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, letterSpacing: '0.1em', color: T.muted }}>
                      {globalSearch ? `No payments match "${globalSearch}"` : 'No unmapped advances'}
                    </p>
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${T.border}`, background: T.offwhite }}>
                        {['Ref', 'Vendor', 'Date', 'Amount', 'Mode', 'Status', ''].map((h, i) => (
                          <th key={h + i} style={{
                            padding: '12px 18px',
                            textAlign: h === 'Amount' || h === '' ? 'right' : 'left',
                            fontFamily: jost, fontSize: 9, fontWeight: 400,
                            letterSpacing: '0.25em', textTransform: 'uppercase', color: T.muted,
                          }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPayments.map((pay) => (
                        <tr
                          key={pay._id}
                          style={{ borderBottom: `1px solid ${T.border}`, transition: 'background 0.15s' }}
                          onMouseEnter={e => e.currentTarget.style.background = T.dimBg}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <td style={{ padding: '14px 18px', fontFamily: jost, fontSize: 11, fontWeight: 400, letterSpacing: '0.04em', color: T.text }}>
                            {pay.paymentRef}
                          </td>
                          <td style={{ padding: '14px 18px', fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted }}>
                            {pay.vendor?.companyName || <span style={{ color: T.gold }}>Unknown</span>}
                          </td>
                          <td style={{ padding: '14px 18px', fontFamily: jost, fontSize: 11, fontWeight: 300, color: T.muted }}>
                            {fmtDate(pay.paymentDate)}
                            {pay.bankRef && <div style={{ fontSize: 10, fontFamily: 'monospace', color: T.muted }}>{pay.bankRef}</div>}
                          </td>
                          <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: serif, fontSize: 18, fontWeight: 300, color: T.navy }}>
                            {fmt(pay.amount)}
                          </td>
                          <td style={{ padding: '14px 18px', fontFamily: jost, fontSize: 10, fontWeight: 300, color: T.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                            {pay.paymentMode}
                            {pay.remarks && (
                              <div style={{ fontSize: 10, color: T.muted, marginTop: 3, fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pay.remarks}>
                                {pay.remarks}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '14px 18px' }}>
                            <span style={{ fontFamily: jost, fontSize: 9, color: T.gold, border: `1px solid ${T.borderG}`, padding: '2px 8px', letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                              {pay.mappedTo === 'advance' ? 'Advance' : pay.mappedTo === 'proforma_invoice' ? `PI ${pay.proformaInvoice?.piNumber || ''}` : `Inv ${pay.vendorInvoice?.invoice_number || ''}`}
                            </span>
                          </td>
                          <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
                              {pay.screenshotFileId && (
                                <DocLink
                                  url={docUrl.payReceipt(pay._id)}
                                  mimeType={pay.screenshotMime}
                                  label="Receipt"
                                  style={{ fontFamily: jost, fontSize: 9, fontWeight: 400, letterSpacing: '0.18em', textTransform: 'uppercase', color: T.muted, background: 'none', padding: '0' }}
                                />
                              )}
                              {pay.mappedTo === 'advance' && <button
                                onClick={() => openModal('map', { id: pay._id })}
                                title="Map to PI or Invoice"
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 5,
                                  background: 'none', border: `1px solid ${T.borderG}`,
                                  borderRadius: 6, padding: '5px 10px',
                                  cursor: 'pointer', fontFamily: jost, fontSize: 9, fontWeight: 400,
                                  letterSpacing: '0.18em', textTransform: 'uppercase', color: T.gold,
                                  transition: 'background 0.15s, color 0.15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = T.dimBg; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                              >
                                <MapPin size={11} /> Map
                              </button>}
                              <button
                                onClick={async () => {
                                  const ok = await confirm({
                                    title: `Delete Payment ${pay.paymentRef}?`,
                                    message: `Amount: ${fmt(pay.amount)}. This will reverse any balance updates.`,
                                    confirmLabel: 'Delete',
                                    variant: 'danger',
                                  });
                                  if (!ok) return;
                                  try {
                                    await trackerApi.deletePayment(pay._id);
                                    showToast('Payment deleted', 'success');
                                    reload({ silent: true });
                                  } catch (err) {
                                    showToast(friendlyError(err), 'error');
                                  }
                                }}
                                title="Delete payment"
                                style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  width: 28, height: 28, borderRadius: 6,
                                  border: 'none', background: 'transparent',
                                  color: 'rgba(220,38,38,0.4)', cursor: 'pointer',
                                  transition: 'background 0.15s, color 0.15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = T.red; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(220,38,38,0.4)'; }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div style={{ borderTop: `1px solid ${T.border}`, padding: '10px 18px', fontFamily: jost, fontSize: 10, fontWeight: 300, letterSpacing: '0.12em', color: T.muted, textAlign: 'right' }}>
                  {globalSearch ? `${filteredPayments.length} matching payment${filteredPayments.length !== 1 ? 's' : ''}` : `${filteredPayments.length} unmapped advance${filteredPayments.length !== 1 ? 's' : ''}`}
                </div>
              </>
            )}

            {/* ── INVOICE VAULT TAB ── */}
            {tab === 'invoices' && (
              <InvoiceVaultTab
                invoices={data.invoices}
                payments={data.payments}
                proformaInvoices={data.pis}
                externalSearch={globalSearch}
                externalVendorFilter={globalVendorFilter}
                onDelete={async (id) => {
                  const ok = await confirm({ title: 'Delete Invoice?', message: 'This invoice will be permanently removed from the vault. Linked PIs are re-opened.', confirmLabel: 'Delete', variant: 'danger' });
                  if (!ok) return;
                  try {
                    await trackerApi.deleteInvoice(id);
                    showToast('Invoice deleted');
                    reload({ silent: true });
                  } catch (err) {
                    showToast(friendlyError(err), 'error');
                  }
                }}
                onViewInvoice={(inv) => openModal('invoice_view', { id: inv._id })}
                onUpload={() => openModal('invoice')}
                onToast={showToast}
              />
            )}
          </>
        )}
      </div>

      {error && !loading && (
        <div role="alert" style={{ marginTop: 16, padding: '12px 16px', background: '#fef2f2', borderLeft: `3px solid ${T.red}`, color: T.red, fontSize: 12, fontFamily: jost }}>
          {error} <button onClick={() => reload()} style={{ marginLeft: 8, background: 'none', border: 'none', color: T.red, textDecoration: 'underline', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────── */}
      {modal?.type === 'pi' && <PiForm vendors={data.vendors} onSaved={onSaved} onClose={closeModal} onBulk={toBulk('pi')} />}
      {modal?.type === 'invoice' && (
        <InvoiceForm vendors={data.vendors} pis={data.pis} linkedPiId={modal.linkedPiId} onSaved={onSaved}
          onBulk={modal.linkedPiId ? undefined : toBulk('invoice')}
          onVendorsChanged={() => reload({ silent: true })}
          onClose={() => setModal(modal.returnTo ? { type: 'pi_flow', id: modal.returnTo } : null)} />
      )}
      {modal?.type === 'payment' && (
        <PaymentForm vendors={data.vendors} pis={data.pis} invoices={data.invoices} payments={data.payments} onSaved={onSaved} onClose={closeModal} onBulk={toBulk('payment')} />
      )}
      {modalPi && (
        <PIFlowModal
          pi={modalPi}
          piPayments={payByPi.get(String(modalPi._id)) || []}
          payments={data.payments}
          invoices={data.invoices}
          onMapPayment={(pay) => openModal('map', { id: pay._id, returnTo: modalPi._id })}
          onUploadInvoice={(piId) => openModal('invoice', { linkedPiId: piId, returnTo: piId })}
          onLinked={() => { showToast('PI linked to invoice'); reload({ silent: true }); }}
          onClose={closeModal}
        />
      )}
      {modalPayment && (
        <MapAdvanceModal payment={modalPayment} pis={data.pis} invoices={data.invoices} onSaved={onSaved}
          onClose={() => setModal(modal.returnTo ? { type: 'pi_flow', id: modal.returnTo } : null)} />
      )}
      {modal?.type === 'bulk' && (
        <BulkUpload kind={modal.kind} initialFiles={modal.files} data={data}
          onSavedSome={(n) => { showToast(`${n} saved`); reload({ silent: true }); }}
          onClose={() => { closeModal(); reload({ silent: true }); }} />
      )}
      {modalInvoice && (
        <InvoiceViewerModal invoice={modalInvoice} trail={invoiceTrail(modalInvoice, { pis: data.pis, payments: data.payments })} onClose={closeModal} />
      )}
    </div>
  );
}
