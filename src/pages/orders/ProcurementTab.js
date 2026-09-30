/**
 * src/pages/orders/ProcurementTab.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Procurement tracker for one order: one row per product to source, seeded
 * from the quote's line items at Start Project or added by hand.
 *
 *   Item · Qty · Product supplier · Branding partner · Procurement status ·
 *   Book-keeping notes
 *
 * Supplier and branding partner are searchable pickers over the vendors table.
 * Status changes save immediately; name/qty/notes save when the field loses
 * focus. Every save is optimistic and rolls back (with a toast) on failure.
 * Each save touches only its own row server-side, so two people updating
 * different items never overwrite each other.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useMemo, useState } from 'react';
import Select from 'react-select';
import { History, Plus, Trash2 } from 'lucide-react';
import ordersApi from './ordersApi';
import { T, TONES, jost, FieldLabel, GoldBtn, IconBtn, Spinner, inputStyle, formatMoney, numericOnly } from './ui';

const cell = { padding: '10px 12px', borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' };
const th = {
  padding: '10px 12px', textAlign: 'left', fontFamily: jost, fontSize: 9, fontWeight: 400,
  letterSpacing: '0.22em', textTransform: 'uppercase', color: T.muted,
  borderBottom: `1px solid ${T.border}`, background: T.offwhite, whiteSpace: 'nowrap',
};
const bare = {
  width: '100%', border: '1px solid transparent', background: 'transparent', padding: '6px 8px',
  fontFamily: jost, fontSize: 12, color: T.text, outline: 'none', boxSizing: 'border-box', borderRadius: 3,
};

/** Text field that looks like plain text until focused, and saves on blur. */
const InlineField = ({ value, onSave, multiline, numeric, placeholder, style }) => {
  const [draft, setDraft] = useState(value ?? '');
  const [focused, setFocused] = useState(false);
  React.useEffect(() => { if (!focused) setDraft(value ?? ''); }, [value, focused]);
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <Tag
      type={multiline ? undefined : 'text'}
      inputMode={numeric ? 'decimal' : undefined}
      rows={multiline ? 2 : undefined}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(numeric ? numericOnly(e.target.value) : e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); if (String(draft) !== String(value ?? '')) onSave(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !multiline) e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(value ?? ''); e.currentTarget.blur(); }
      }}
      style={{
        ...bare, ...(focused ? { border: `1px solid ${T.gold}`, background: 'white' } : {}),
        resize: multiline ? 'vertical' : undefined, ...style,
      }}
    />
  );
};

const StatusSelect = ({ value, statuses, onChange, disabled }) => {
  const current = statuses.find((s) => s.value === value) || statuses[0];
  const tone = TONES[current?.tone] || TONES.slate;
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%', minWidth: 170, padding: '7px 10px', border: `1px solid ${tone.color}33`, borderRadius: 3,
        background: tone.bg, color: tone.color, fontFamily: jost, fontSize: 11, fontWeight: 500,
        cursor: disabled ? 'wait' : 'pointer', outline: 'none',
      }}
    >
      {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
    </select>
  );
};

/**
 * Searchable vendor picker (type to filter by name, category or city). The
 * menu renders into <body> so the table's horizontal scroll can't clip it.
 */
const VendorSelect = ({ value, vendors, loading, onChange, disabled, placeholder }) => {
  const options = useMemo(() => vendors.map((v) => ({
    value: v.id, label: v.name, hint: [v.category, v.city].filter(Boolean).join(' · '), preferred: v.preferred,
  })), [vendors]);
  // A vendor deleted since it was picked still shows, from the stored name.
  const selected = value?.vendorId
    ? options.find((o) => o.value === String(value.vendorId)) || { value: String(value.vendorId), label: value.name }
    : null;
  return (
    <Select
      isClearable
      isSearchable
      isLoading={loading}
      isDisabled={disabled}
      placeholder={placeholder}
      noOptionsMessage={() => 'No vendor found'}
      options={options}
      value={selected}
      onChange={(opt) => onChange(opt ? { vendorId: opt.value } : null)}
      filterOption={(opt, input) => `${opt.label} ${opt.data.hint || ''}`.toLowerCase().includes(input.toLowerCase())}
      formatOptionLabel={(opt, { context }) => (context === 'menu' ? (
        <div>
          <div>{opt.label}{opt.preferred ? <span style={{ color: T.gold }}> ★</span> : null}</div>
          {opt.hint && <div style={{ fontSize: 10, color: T.muted }}>{opt.hint}</div>}
        </div>
      ) : opt.label)}
      menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
      menuPosition="fixed"
      styles={{
        control: (base, { isFocused }) => ({
          ...base, minHeight: 34, borderRadius: 3, boxShadow: 'none', fontFamily: jost, fontSize: 12,
          border: `1px solid ${isFocused ? T.gold : T.border}`, '&:hover': { borderColor: T.gold },
        }),
        menuPortal: (base) => ({ ...base, zIndex: 1000 }),
        option: (base, { isFocused, isSelected }) => ({
          ...base, fontFamily: jost, fontSize: 12, color: T.text,
          background: isSelected ? 'rgba(184,151,90,0.14)' : isFocused ? T.dimBg : 'white',
        }),
        placeholder: (base) => ({ ...base, color: '#aaa' }),
      }}
    />
  );
};

const historyTitle = (item, statuses) => {
  const label = (v) => statuses.find((s) => s.value === v)?.label || v;
  return (item.statusHistory || [])
    .map((h) => `${label(h.status)} — ${h.by || 'staff'}, ${new Date(h.at).toLocaleString()}`)
    .join('\n') || 'No history yet';
};

const EMPTY_NEW = { name: '', quantity: 1, notes: '' };

/**
 * @param {string}   orderId
 * @param {Array}    items      — order.procurementItems
 * @param {Array}    statuses   — [{ value, label, tone }] from /v2/orders/meta
 * @param {Function} onChange   — (items | (items) => items) => void, like a state setter
 * @param {Function} showToast
 * @param {Function} confirm
 */
export default function ProcurementTab({ orderId, items, statuses, onChange, showToast, confirm }) {
  const [saving, setSaving] = useState({}); // itemId -> true
  const [draft, setDraft] = useState(EMPTY_NEW);
  const [adding, setAdding] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    ordersApi.vendorOptions()
      .then((list) => alive && setVendors(list))
      .catch((err) => alive && showToast?.('error', `Couldn't load vendors: ${err.message}`))
      .finally(() => alive && setVendorsLoading(false));
    return () => { alive = false; };
  }, [showToast]);

  const counts = useMemo(() => statuses.map((s) => ({ ...s, count: items.filter((i) => i.status === s.value).length })), [items, statuses]);
  const ready = items.filter((i) => ['ready_at_office', 'dispatched'].includes(i.status)).length;

  // All updates are functional (onChange receives an updater), so two quick
  // saves on different rows can't overwrite each other's optimistic state,
  // and a failed save rolls back only its own row.
  const replaceRow = (id, row) => onChange((list) => list.map((i) => (i._id === id ? row : i)));

  const save = async (item, patch) => {
    onChange((list) => list.map((i) => (i._id === item._id ? { ...i, ...patch } : i)));
    setSaving((s) => ({ ...s, [item._id]: true }));
    try {
      replaceRow(item._id, await ordersApi.updateItem(orderId, item._id, patch));
    } catch (err) {
      replaceRow(item._id, item);
      showToast?.('error', `Couldn't save "${item.name}": ${err.message}`);
    } finally {
      setSaving((s) => { const { [item._id]: _, ...rest } = s; return rest; });
    }
  };

  const remove = async (item, index) => {
    const ok = await confirm?.({ title: 'Remove item', message: `"${item.name}" will be removed from procurement tracking.`, confirmLabel: 'Remove', variant: 'danger' });
    if (!ok) return;
    onChange((list) => list.filter((i) => i._id !== item._id));
    try {
      await ordersApi.removeItem(orderId, item._id);
    } catch (err) {
      onChange((list) => [...list.slice(0, index), item, ...list.slice(index)]);
      showToast?.('error', err.message);
    }
  };

  const add = async (e) => {
    e?.preventDefault();
    const name = draft.name.trim();
    if (!name) return;
    setAdding(true);
    try {
      const all = await ordersApi.addItems(orderId, [{ name, quantity: Number(draft.quantity) || 1, notes: draft.notes.trim() }]);
      onChange(all);
      setDraft(EMPTY_NEW);
    } catch (err) {
      showToast?.('error', err.message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: jost, fontSize: 11, color: T.muted, marginBottom: 6 }}>
            <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
            <span>{ready} of {items.length} ready</span>
          </div>
          <div style={{ height: 4, background: T.offwhite, border: `1px solid ${T.border}` }}>
            <div style={{ height: '100%', width: `${items.length ? (ready / items.length) * 100 : 0}%`, background: T.emerald, transition: 'width 0.3s' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {counts.filter((c) => c.count).map((c) => {
            const tone = TONES[c.tone] || TONES.slate;
            return (
              <span key={c.value} style={{ fontFamily: jost, fontSize: 10, padding: '3px 8px', background: tone.bg, color: tone.color }}>
                {c.label} · {c.count}
              </span>
            );
          })}
        </div>
      </div>

      <div style={{ border: `1px solid ${T.border}`, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 28 }}>#</th>
              <th style={th}>Item</th>
              <th style={{ ...th, width: 80 }}>Qty</th>
              <th style={{ ...th, width: 200 }}>Product supplier</th>
              <th style={{ ...th, width: 200 }}>Branding partner</th>
              <th style={{ ...th, width: 190 }}>Procurement status</th>
              <th style={th}>Book-keeping notes</th>
              <th style={{ ...th, width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item._id}>
                <td style={{ ...cell, fontFamily: jost, fontSize: 11, color: T.muted, paddingTop: 16 }}>{item.lineNo || idx + 1}</td>
                <td style={cell}>
                  <InlineField value={item.name} onSave={(v) => v.trim() && save(item, { name: v.trim() })} style={{ fontWeight: 500 }} />
                  {(item.details || item.rate != null) && (
                    <p style={{ fontFamily: jost, fontSize: 10, color: T.muted, margin: '2px 8px 0' }}>
                      {[item.details, item.hsn && `HSN ${item.hsn}`, item.rate != null && `${formatMoney(item.rate)} / ${item.unit || 'unit'}`].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </td>
                <td style={cell}>
                  <InlineField numeric value={item.quantity} onSave={(v) => save(item, { quantity: Math.max(0, Number(v) || 0) })} />
                  {item.unit && <p style={{ fontFamily: jost, fontSize: 10, color: T.muted, margin: '2px 8px 0' }}>{item.unit}</p>}
                </td>
                <td style={cell}>
                  <VendorSelect
                    value={item.productSupplier} vendors={vendors} loading={vendorsLoading} disabled={saving[item._id]}
                    placeholder="Search supplier…" onChange={(ref) => save(item, { productSupplier: ref })}
                  />
                </td>
                <td style={cell}>
                  <VendorSelect
                    value={item.brandingPartner} vendors={vendors} loading={vendorsLoading} disabled={saving[item._id]}
                    placeholder="Search partner…" onChange={(ref) => save(item, { brandingPartner: ref })}
                  />
                </td>
                <td style={cell}>
                  <StatusSelect value={item.status} statuses={statuses} disabled={saving[item._id]} onChange={(status) => save(item, { status })} />
                </td>
                <td style={cell}>
                  <InlineField multiline value={item.notes} placeholder="Vendor, PO / payment ref, courier…" onSave={(v) => save(item, { notes: v.trim() })} />
                </td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    {saving[item._id] ? <span style={{ padding: 6, color: T.gold }}><Spinner size={13} /></span> : (
                      <span title={historyTitle(item, statuses)} style={{ padding: 6, color: T.muted, display: 'flex', cursor: 'help' }}>
                        <History size={13} />
                      </span>
                    )}
                    <IconBtn title="Remove item" onClick={() => remove(item, idx)} color="rgba(220,38,38,0.5)" hover={T.danger}><Trash2 size={13} /></IconBtn>
                  </div>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={8} style={{ ...cell, textAlign: 'center', padding: '28px 12px', fontFamily: jost, fontSize: 12, color: T.muted }}>
                  No items yet. Upload the quote when starting the project, or add items below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add item */}
      <form onSubmit={add} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 1fr auto', gap: 10, marginTop: 14, alignItems: 'end' }}>
        <div>
          <FieldLabel>Add item</FieldLabel>
          <input value={draft.name} placeholder="Item name" onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputStyle(false)} />
        </div>
        <div>
          <FieldLabel>Qty</FieldLabel>
          <input inputMode="decimal" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: numericOnly(e.target.value) })} style={inputStyle(false)} />
        </div>
        <div>
          <FieldLabel>Notes</FieldLabel>
          <input value={draft.notes} placeholder="Optional" onChange={(e) => setDraft({ ...draft, notes: e.target.value })} style={inputStyle(false)} />
        </div>
        <GoldBtn type="submit" disabled={adding || !draft.name.trim()} style={{ padding: '11px 20px' }}>
          {adding ? <Spinner size={13} /> : <Plus size={13} />} Add
        </GoldBtn>
      </form>
    </div>
  );
}
