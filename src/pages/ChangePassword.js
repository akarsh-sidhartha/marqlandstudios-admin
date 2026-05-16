import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { createLogger } from '../utils/logger';

const log = createLogger('ChangePassword');

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  navy:    '#0e1520',
  gold:    '#b8975a',
  gold2:   '#d4b06a',
  offwhite:'#faf8f5',
  text:    '#1a1a1a',
  muted:   '#888',
  border:  'rgba(0,0,0,0.09)',
  borderG: 'rgba(184,151,90,0.22)',
};

const jost  = '"Jost", sans-serif';
const serif = '"Cormorant Garamond", Georgia, serif';

// ── Password strength meter ───────────────────────────────────────────────────
const StrengthMeter = ({ password }) => {
  if (!password) return null;

  const checks = [
    { label: 'At least 8 characters', pass: password.length >= 8 },
    { label: 'Uppercase letter',       pass: /[A-Z]/.test(password) },
    { label: 'Number',                 pass: /[0-9]/.test(password) },
    { label: 'Special character',      pass: /[^A-Za-z0-9]/.test(password) },
  ];

  const score  = checks.filter(c => c.pass).length;
  const colors = ['#ef4444', '#d4b06a', '#b8975a', '#4caf7d'];
  const labels = ['Too weak', 'Fair', 'Good', 'Strong'];

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{
            flex: 1, height: 3,
            background: i < score ? colors[score - 1] : 'rgba(0,0,0,0.08)',
            transition: 'background 0.3s',
          }} />
        ))}
      </div>
      {/* Checklist + label */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {checks.map((c, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 7,
              fontFamily: jost, fontSize: 11,
              color: c.pass ? '#4caf7d' : T.muted,
              letterSpacing: '0.03em',
              transition: 'color 0.2s',
            }}>
              <div style={{
                width: 14, height: 14, borderRadius: '50%',
                background: c.pass ? 'rgba(76,175,125,0.12)' : 'rgba(0,0,0,0.04)',
                border: `1px solid ${c.pass ? '#4caf7d' : 'rgba(0,0,0,0.12)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'all 0.2s',
              }}>
                {c.pass && <CheckCircle2 size={9} color="#4caf7d" />}
              </div>
              {c.label}
            </div>
          ))}
        </div>
        <span style={{
          fontFamily: jost, fontSize: 11, fontWeight: 500,
          letterSpacing: '0.15em', textTransform: 'uppercase',
          color: score > 0 ? colors[score - 1] : T.muted,
        }}>
          {score > 0 ? labels[score - 1] : ''}
        </span>
      </div>
    </div>
  );
};

// ── Password field with show/hide ─────────────────────────────────────────────
const PasswordField = ({ label, value, onChange, placeholder, hint }) => {
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{
        display: 'block',
        fontFamily: jost, fontSize: 9, fontWeight: 400,
        letterSpacing: '0.25em', textTransform: 'uppercase',
        color: T.muted, marginBottom: 8,
      }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', padding: '11px 40px 11px 14px',
            background: 'white',
            border: `1px solid ${focused ? T.gold : T.border}`,
            borderRadius: 3,
            fontFamily: jost, fontSize: 13, fontWeight: 300,
            color: T.text, outline: 'none',
            boxSizing: 'border-box',
            transition: 'border-color 0.2s',
          }}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          style={{
            position: 'absolute', right: 12, top: '50%',
            transform: 'translateY(-50%)', background: 'none',
            border: 'none', cursor: 'pointer',
            color: T.muted, padding: 2, display: 'flex',
            transition: 'color 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = T.gold}
          onMouseLeave={e => e.currentTarget.style.color = T.muted}
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {hint && (
        <p style={{
          fontFamily: jost, fontSize: 11, fontWeight: 300,
          color: 'rgba(0,0,0,0.35)', marginTop: 5, letterSpacing: '0.02em',
        }}>
          {hint}
        </p>
      )}
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
const ChangePassword = () => {
  const { authFetch, user } = useAuth();

  const [current, setCurrent] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (newPass.length < 8)       return setError('New password must be at least 8 characters.');
    if (newPass !== confirm)       return setError('New passwords do not match.');
    if (current === newPass)       return setError('New password must differ from your current password.');

    log.info('Submitting password change for', user?.email);
    setLoading(true);
    try {
      const res  = await authFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: newPass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to change password.');

      log.info('Password changed successfully');
      setSuccess(true);
      setCurrent(''); setNewPass(''); setConfirm('');
    } catch (err) {
      log.error('Password change failed', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: T.offwhite,
      fontFamily: jost, padding: '56px 48px',
    }}>
      <div style={{ maxWidth: 480 }}>

        {/* ── Page header ───────────────────────────────────────────── */}
        <div style={{ marginBottom: 40 }}>
          {/* Gold rule */}
          <div style={{ width: 32, height: 1, background: T.gold, marginBottom: 20 }} />

          <p style={{
            fontFamily: jost, fontSize: 9, fontWeight: 400,
            letterSpacing: '0.3em', textTransform: 'uppercase',
            color: T.muted, marginBottom: 10,
          }}>
            Security
          </p>
          <h1 style={{
            fontFamily: serif, fontSize: 38, fontWeight: 300,
            color: T.navy, lineHeight: 1.05, margin: '0 0 10px',
          }}>
            Change <em style={{ color: T.gold }}>Password.</em>
          </h1>
          <p style={{
            fontFamily: jost, fontSize: 13, fontWeight: 300,
            color: T.muted, lineHeight: 1.7,
          }}>
            Logged in as{' '}
            <span style={{ color: T.text, fontWeight: 400 }}>{user?.email}</span>
          </p>
        </div>

        {/* ── Success banner ────────────────────────────────────────── */}
        {success && (
          <div style={{
            background: 'rgba(76,175,125,0.07)',
            border: '1px solid rgba(76,175,125,0.25)',
            padding: '16px 20px', marginBottom: 28,
            display: 'flex', alignItems: 'flex-start', gap: 12,
          }}>
            <CheckCircle2 size={16} color="#4caf7d" style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{
                fontFamily: jost, fontSize: 12, fontWeight: 500,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                color: '#3a7d5a', marginBottom: 3,
              }}>
                Password updated
              </div>
              <div style={{ fontFamily: jost, fontSize: 12, fontWeight: 300, color: '#3a7d5a' }}>
                Your new password is active immediately.
              </div>
            </div>
          </div>
        )}

        {/* ── Error banner ──────────────────────────────────────────── */}
        {error && (
          <div style={{
            background: 'rgba(220,38,38,0.05)',
            border: '1px solid rgba(220,38,38,0.2)',
            padding: '12px 18px', marginBottom: 24,
            fontFamily: jost, fontSize: 12, fontWeight: 300,
            color: '#b91c1c', lineHeight: 1.6,
          }}>
            {error}
          </div>
        )}

        {/* ── Form card ─────────────────────────────────────────────── */}
        <div style={{
          background: 'white',
          border: `1px solid ${T.border}`,
          padding: '32px 32px 28px',
        }}>
          <form onSubmit={handleSubmit}>
            <PasswordField
              label="Current Password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              placeholder="Your current password"
              hint="Enter the password you use to log in now."
            />

            <PasswordField
              label="New Password"
              value={newPass}
              onChange={e => setNewPass(e.target.value)}
              placeholder="Choose a strong new password"
            />

            <StrengthMeter password={newPass} />

            <PasswordField
              label="Confirm New Password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat new password"
            />

            {/* Match indicator */}
            {confirm && (
              <div style={{
                fontFamily: jost, fontSize: 11, fontWeight: 400,
                letterSpacing: '0.06em',
                marginTop: -10, marginBottom: 22,
                color: newPass === confirm ? '#4caf7d' : '#dc2626',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {newPass === confirm ? '✓ Passwords match' : '✗ Passwords do not match'}
              </div>
            )}

            {/* Submit — gold button mirrors .btn-gold from homepage */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                background: loading ? 'rgba(184,151,90,0.5)' : T.gold,
                color: T.navy,
                border: 'none', padding: '14px 40px',
                fontFamily: jost, fontSize: 10, fontWeight: 500,
                letterSpacing: '0.25em', textTransform: 'uppercase',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'background 0.3s, transform 0.3s',
              }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.background = T.gold2; }}
              onMouseLeave={e => { if (!loading) e.currentTarget.style.background = T.gold; }}
            >
              {loading ? 'Updating…' : 'Update Password →'}
            </button>
          </form>
        </div>

        {/* ── Tip ───────────────────────────────────────────────────── */}
        <div style={{
          marginTop: 20,
          padding: '16px 18px',
          border: `1px solid ${T.borderG}`,
          background: 'rgba(184,151,90,0.04)',
          fontFamily: jost, fontSize: 12, fontWeight: 300,
          color: T.muted, lineHeight: 1.75,
        }}>
          <span style={{ color: T.gold, fontWeight: 500, letterSpacing: '0.05em' }}>Tip —</span>{' '}
          Use a mix of uppercase, numbers, and symbols. Don't reuse passwords from other
          services. You'll need to log in again on other devices after changing.
        </div>

      </div>
    </div>
  );
};

export default ChangePassword;