/**
 * src/pages/orders/OrderDetailModal.js
 * ─────────────────────────────────────────────────────────────────────────────
 * The full-screen view that opens when an order row is clicked. Two columns:
 *
 *   Left  — tabs:
 *             Details     — title, client, contact, notes.
 *             Procurement — one row per product with its sourcing stage and
 *                           book-keeping notes (see ProcurementTab).
 *   Right — the order's screenshots, quote and attachments as large
 *           thumbnails (paste / drop / pick several), all stored in the
 *           order's OneDrive folder.
 *
 * Closes with the X at the top right or Escape.
 *
 * The list row carries only summary fields; the full order (items, timeline)
 * is fetched once here, when the popup opens. Saving sends only the fields
 * that actually changed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, FileText, Hash, Receipt } from 'lucide-react';
import ordersApi from './ordersApi';
import OrderFiles from './OrderFiles';
import ProcurementTab from './ProcurementTab';
import { T, jost, FieldLabel, FocusInput, GoldBtn, GhostBtn, Modal, Spinner } from './ui';

const EDITABLE = ['title', 'clientName', 'orderPlacedBy'];

/** Plain-text paste into the notes box; images are picked up by OrderFiles as screenshots. */
const pasteAsText = (e) => {
  const text = e.clipboardData?.getData('text/plain');
  e.preventDefault();
  if (text) document.execCommand('insertText', false, text);
};

const TabButton = ({ active, onClick, icon: Icon, children }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', background: 'none', border: 'none',
      cursor: 'pointer', fontFamily: jost, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase',
      color: active ? T.gold : T.muted, borderBottom: `2px solid ${active ? T.gold : 'transparent'}`, marginBottom: -1,
    }}
  >
    <Icon size={13} /> {children}
  </button>
);

const Badge = ({ icon: Icon, color, children }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: color, color: 'white',
    fontFamily: jost, fontSize: 9, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase',
  }}>
    {Icon && <Icon size={9} />} {children}
  </span>
);

/**
 * @param {object}   order          — the list row that was clicked
 * @param {string}   initialTab     — 'details' | 'procurement'
 * @param {Array}    statuses       — procurement stages from /v2/orders/meta
 * @param {Function} onClose
 * @param {Function} onChange       — (patch) => void: merge into the list row
 */
export default function OrderDetailModal({ order, initialTab = 'details', statuses, onClose, onChange, showToast, confirm }) {
  const [tab, setTab] = useState(initialTab);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(() => Object.fromEntries(EDITABLE.map((k) => [k, order[k] || ''])));
  const [saving, setSaving] = useState(false);
  const editorRef = useRef(null);

  useEffect(() => {
    let alive = true;
    ordersApi.get(order._id)
      .then((full) => alive && setDetail(full))
      .catch((err) => alive && showToast?.('error', `Couldn't load the order: ${err.message}`));
    return () => { alive = false; };
  }, [order._id, showToast]);

  const setItems = useCallback((next) => {
    setDetail((d) => ({ ...d, procurementItems: typeof next === 'function' ? next(d.procurementItems || []) : next }));
  }, []);

  // Keep the row's "3/6 ready" badge in step with edits made here.
  const itemsForSummary = detail?.procurementItems;
  useEffect(() => {
    if (!itemsForSummary) return;
    const ready = itemsForSummary.filter((i) => ['ready_at_office', 'dispatched'].includes(i.status)).length;
    onChange({ procurement: { total: itemsForSummary.length, ready } });
  }, [itemsForSummary, onChange]);

  const onFilesChange = useCallback((files) => onChange({ attachments: files }), [onChange]);

  const save = async () => {
    const patch = {};
    EDITABLE.forEach((k) => { if (form[k].trim() !== (order[k] || '')) patch[k] = form[k].trim(); });
    const html = editorRef.current?.innerHTML ?? '';
    if (html !== (order.description || '')) patch.description = html;
    if (!Object.keys(patch).length) { onClose(); return; }
    if (patch.clientName === '' || patch.orderPlacedBy === '') { showToast?.('error', 'Client and contact person are required.'); return; }

    setSaving(true);
    try {
      const updated = await ordersApi.update(order._id, patch);
      onChange(updated);
      showToast?.('success', 'Order updated');
      onClose();
    } catch (err) {
      showToast?.('error', err.message);
      setSaving(false);
    }
  };

  const items = detail?.procurementItems || [];

  const identifiers = (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {order.refNumber && <Badge color={T.gold}>{order.refNumber}</Badge>}
      {order.quoteNumber && <Badge color={T.indigo} icon={Hash}>{order.quoteNumber}</Badge>}
      {order.invoiceNumber && <Badge color={T.emerald} icon={Receipt}>{order.invoiceNumber}</Badge>}
    </div>
  );

  // Full-screen, two columns: everything about the order on the left, its
  // screenshots and files as large thumbnails on the right. Closes with the
  // X (top right) or Escape.
  return (
    <Modal fullScreen onClose={onClose} busy={saving} eyebrow="Order record" title={order.title || order.clientName} headerExtra={identifiers}>
      {/* The procurement table is wide (8 columns), so it gets most of the width. */}
      <div style={{ display: 'grid', gridTemplateColumns: tab === 'procurement' ? 'minmax(0, 3fr) minmax(300px, 1fr)' : 'minmax(0, 1.15fr) minmax(0, 1fr)', height: '100%' }}>
      {/* ── Left: details / procurement ── */}
      <div style={{ overflowY: 'auto', padding: '24px 32px 32px', borderRight: `1px solid ${T.border}` }}>
      <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, marginBottom: 22 }}>
        <TabButton active={tab === 'details'} onClick={() => setTab('details')} icon={FileText}>Details</TabButton>
        <TabButton active={tab === 'procurement'} onClick={() => setTab('procurement')} icon={ClipboardList}>
          Procurement{(detail ? items.length : order.procurement?.total) ? ` (${detail ? items.length : order.procurement.total})` : ''}
        </TabButton>
      </div>

      {/* Hidden, not unmounted, on the other tab — unsaved notes survive a tab switch. */}
      <div style={{ display: tab === 'details' ? 'block' : 'none' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 16 }}>
            <div>
              <FieldLabel>Project title</FieldLabel>
              <FocusInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Project title" />
            </div>
            <div>
              <FieldLabel>Client</FieldLabel>
              <FocusInput value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} placeholder="Client name" />
            </div>
            <div>
              <FieldLabel>Order placed by</FieldLabel>
              <FocusInput value={form.orderPlacedBy} onChange={(e) => setForm({ ...form, orderPlacedBy: e.target.value })} placeholder="Contact person" />
            </div>
          </div>

          <FieldLabel>Project notes</FieldLabel>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onPaste={pasteAsText}
            onDrop={(e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); showToast?.('warning', 'Drop files onto the files column on the right.'); } }}
            dangerouslySetInnerHTML={{ __html: order.description || '' }}
            data-placeholder="Requirements, budget, delivery dates…"
            style={{
              width: '100%', minHeight: 260, maxHeight: '48vh', overflowY: 'auto', padding: '14px 16px', marginBottom: 18,
              background: T.offwhite, border: `1px solid ${T.border}`, fontFamily: jost, fontSize: 13, fontWeight: 300,
              outline: 'none', boxSizing: 'border-box', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = T.gold; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = T.border; }}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 14, borderTop: `1px solid ${T.border}`, paddingTop: 20, marginTop: 4 }}>
            <GhostBtn onClick={onClose} disabled={saving}>Cancel</GhostBtn>
            <GoldBtn onClick={save} disabled={saving}>{saving ? <><Spinner size={13} /> Saving…</> : 'Save changes'}</GoldBtn>
          </div>
      </div>

      {tab === 'procurement' && (
        !detail ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '40px 0', justifyContent: 'center', color: T.muted, fontFamily: jost, fontSize: 12 }}>
            <Spinner size={16} /> Loading items…
          </div>
        ) : (
          <ProcurementTab orderId={order._id} items={items} statuses={statuses} onChange={setItems} showToast={showToast} confirm={confirm} />
        )
      )}
      </div>

      {/* ── Right: screenshots & files, large thumbnails ── */}
      <div style={{ overflowY: 'auto', padding: 24, background: '#fcfbf9' }}>
        <OrderFiles variant="gallery" orderId={order._id} initialFiles={order.attachments || []} showToast={showToast} confirm={confirm} onChange={onFilesChange} />
      </div>
      </div>
    </Modal>
  );
}
