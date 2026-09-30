/**
 * src/pages/orders/ClientContactForms.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Inline forms shown after a new inquiry is saved, when the client or the
 * contact person isn't in the database yet — collect their e-mail so the
 * client-portal link can be sent.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useState } from 'react';
import api from '../../api';
import { createLogger } from '../../utils/logger';
import { T, jost, FieldLabel, FocusInput, GoldBtn, GhostBtn } from './ui';

const log = createLogger('OrderTracker');

// ClientCreateInlineForm
// Pre-fills company + contact from the order so the user only needs
// phone + email before saving.
// ─────────────────────────────────────────────────────────────────────────────
export function ClientCreateInlineForm({ clientName, contactName, onCreated, onSkip, showToast }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    companyName: clientName || '',
    contacts: [{ name: contactName || '', phone: '', email: '' }],
  });

  const setContact = (field, value) => {
    setForm(prev => ({
      ...prev,
      contacts: [{ ...prev.contacts[0], [field]: value }],
    }));
  };

  const handleSave = async () => {
    if (!form.companyName.trim()) { showToast('error', 'Company name is required'); return; }
    log.info('Creating new client inline', { companyName: form.companyName });
    setSaving(true);
    try {
      const res = await api.post('/clients', form);
      log.info('Client created', { id: res.data._id });
      onCreated(res.data);
    } catch (err) {
      log.error('Client create failed', err.message);
      showToast('error', 'Failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '28px 32px' }}>
      <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted, marginBottom: 20 }}>
        Fill in contact details so we can send the portal link by email.
      </p>

      {/* Company name */}
      <div style={{ marginBottom: 16 }}>
        <FieldLabel>Company Name</FieldLabel>
        <FocusInput
          value={form.companyName}
          onChange={e => setForm(prev => ({ ...prev, companyName: e.target.value }))}
          placeholder="Company name"
        />
      </div>

      {/* Primary contact */}
      <div style={{ marginBottom: 24 }}>
        <FieldLabel>Primary Contact</FieldLabel>
        <div style={{
          background: T.offwhite, border: `1px solid ${T.border}`,
          padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <FocusInput
            value={form.contacts[0].name}
            onChange={e => setContact('name', e.target.value)}
            placeholder="Contact name"
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FocusInput
              value={form.contacts[0].phone}
              onChange={e => setContact('phone', e.target.value)}
              placeholder="Phone"
              style={{ fontSize: 12 }}
            />
            <FocusInput
              value={form.contacts[0].email}
              onChange={e => setContact('email', e.target.value)}
              placeholder="Email (for portal link)"
              style={{ fontSize: 12 }}
            />
          </div>
        </div>
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderTop: `1px solid ${T.border}`, paddingTop: 20,
      }}>
        <GhostBtn onClick={onSkip}>Skip — save without email</GhostBtn>
        <GoldBtn onClick={handleSave} disabled={saving || !form.companyName.trim()}>
          {saving ? 'Saving…' : 'Create Client & Send Email'}
        </GoldBtn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ContactAddInlineForm
// Adds a new contact to an existing client record.
// ─────────────────────────────────────────────────────────────────────────────
export function ContactAddInlineForm({ clientId, companyName, contactName, onAdded, onSkip, showToast }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: contactName || '', phone: '', email: '' });

  const handleSave = async () => {
    if (!form.name.trim()) { showToast('error', 'Contact name is required'); return; }
    log.info('Adding contact to existing client', { clientId, contactName: form.name });
    setSaving(true);
    try {
      const res = await api.patch(`/clients/${clientId}/add-contact`, form);
      log.info('Contact added', { clientId });
      onAdded(res.data);
    } catch (err) {
      log.error('Contact add failed', err.message);
      showToast('error', 'Failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '28px 32px' }}>
      <p style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: T.muted, marginBottom: 20 }}>
        <strong>{companyName}</strong> is in the database but <strong>"{contactName}"</strong> is not
        listed as a contact yet. Add their details to send the portal link.
      </p>

      <div style={{
        background: T.offwhite, border: `1px solid ${T.border}`,
        padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
        marginBottom: 24,
      }}>
        <FocusInput
          value={form.name}
          onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
          placeholder="Contact name"
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <FocusInput
            value={form.phone}
            onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))}
            placeholder="Phone"
            style={{ fontSize: 12 }}
          />
          <FocusInput
            value={form.email}
            onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
            placeholder="Email (for portal link)"
            style={{ fontSize: 12 }}
          />
        </div>
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderTop: `1px solid ${T.border}`, paddingTop: 20,
      }}>
        <GhostBtn onClick={onSkip}>Skip — save without email</GhostBtn>
        <GoldBtn onClick={handleSave} disabled={saving || !form.name.trim()}>
          {saving ? 'Saving…' : 'Add Contact & Send Email'}
        </GoldBtn>
      </div>
    </div>
  );
}
