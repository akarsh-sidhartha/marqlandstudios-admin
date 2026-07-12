import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api';
import { createLogger } from '../utils/logger';

const log = createLogger('LoginPage');

// ── Partner routing guard ─────────────────────────────────────────────────────
// Suppliers with role "partner" must never land on the internal admin app or any
// marqlandstudios.com subdomain — they get bounced to the public partner portal.
// (Primary enforcement lives server-side in authRoutes.js; this is a fast, purely
// cosmetic client-side redirect for the case where the server-side check already
// blocked the login and returned a `redirect` field on the error response.)
const MARQLAND_ROOT_DOMAIN = 'marqlandstudios.com';
const PARTNER_PORTAL_URL   = 'https://marqlandstudios.com/partner';

const isMarqlandStudiosHost = (hostname = '') => {
  const h = hostname.toLowerCase();
  // Matches admin.marqlandstudios.com and any other subdomain (not the bare root).
  // Deliberately excludes the bare root domain (marqlandstudios.com) — that's
  // where the partner portal itself lives, so matching it here would block
  // partners from logging in on the very page we redirect them to.
  return h.endsWith(`.${MARQLAND_ROOT_DOMAIN}`);
};

// ── Reusable input field with optional eye toggle for passwords ───────────────
const Field = ({ label, type = 'text', value, onChange, placeholder, required, disabled }) => {
  const [show, setShow] = React.useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (show ? 'text' : 'password') : type;
  return (
    <div style={{ marginBottom: '18px' }}>
      <label style={{
        display: 'block', fontSize: '11px', fontWeight: 700,
        letterSpacing: '0.08em', textTransform: 'uppercase',
        color: '#94a3b8', marginBottom: '6px',
      }}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          type={inputType} value={value} onChange={onChange}
          placeholder={placeholder} required={required} disabled={disabled}
          style={{
            width: '100%', padding: isPassword ? '12px 42px 12px 14px' : '12px 14px',
            background: disabled ? '#0f172a' : '#1e293b',
            border: `1px solid ${disabled ? '#1e293b' : '#334155'}`,
            borderRadius: '10px', color: disabled ? '#475569' : '#f1f5f9',
            fontSize: '14px', outline: 'none', boxSizing: 'border-box',
            transition: 'border-color 0.2s', fontFamily: 'inherit',
            cursor: disabled ? 'not-allowed' : 'text',
          }}
          onFocus={e => { if (!disabled) e.target.style.borderColor = '#6366f1'; }}
          onBlur={e => { if (!disabled) e.target.style.borderColor = '#334155'; }}
        />
        {isPassword && !disabled && (
          <button
            type="button"
            onClick={() => setShow(s => !s)}
            style={{
              position: 'absolute', right: '12px', top: '50%',
              transform: 'translateY(-50%)', background: 'none',
              border: 'none', cursor: 'pointer', padding: '2px',
              color: '#64748b', display: 'flex', alignItems: 'center',
            }}
            tabIndex={-1}
          >
            {show ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

// ── Password strength indicator ───────────────────────────────────────────────
const PasswordStrength = ({ password }) => {
  if (!password) return null;
  let strength = 0;
  if (password.length >= 8) strength++;
  if (/[A-Z]/.test(password)) strength++;
  if (/[0-9]/.test(password)) strength++;
  if (/[^A-Za-z0-9]/.test(password)) strength++;
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['', '#ef4444', '#f59e0b', '#3b82f6', '#22c55e'];
  return (
    <div style={{ marginTop: '-12px', marginBottom: '18px' }}>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
        {[1,2,3,4].map(i => (
          <div key={i} style={{
            flex: 1, height: '3px', borderRadius: '2px',
            background: i <= strength ? colors[strength] : '#1e293b',
            transition: 'background 0.3s',
          }} />
        ))}
      </div>
      <span style={{ fontSize: '11px', color: colors[strength] }}>{labels[strength]}</span>
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────
const LoginPage = () => {
  const { login } = useAuth();

  // ── Read invite token ONCE and store in ref so it survives URL cleanup ────────
  const inviteTokenRef = React.useRef((() => {
    const fromSearch = new URLSearchParams(window.location.search).get('token');
    if (fromSearch) return fromSearch;
    const hash = window.location.hash;
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
    return new URLSearchParams(hashQuery).get('token');
  })());
  const inviteToken = inviteTokenRef.current;

  // Detect reset token from URL: /#/?reset=TOKEN
  const resetTokenRef = React.useRef((() => {
    const fromSearch = new URLSearchParams(window.location.search).get('reset');
    if (fromSearch) return fromSearch;
    const hash = window.location.hash;
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
    return new URLSearchParams(hashQuery).get('reset');
  })());
  const resetToken = resetTokenRef.current;

  // 'login' | 'register' | 'invite' | 'forgot' | 'reset' | 'success'
  const [mode, setMode] = useState(
    resetToken ? 'reset' : inviteToken ? 'invite' : 'login'
  );
  const [loginEmail, setLoginEmail]     = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [name, setName]     = useState('');
  const [email, setEmail]   = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [inviteValid, setInviteValid] = useState(inviteToken ? null : true);
  const [inviteError, setInviteError] = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  // Forgot / reset password
  const [forgotEmail, setForgotEmail]   = useState('');
  const [forgotSent, setForgotSent]     = useState(false);
  const [resetNewPass, setResetNewPass] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');

  // ── Validate invite token on mount ───────────────────────────────────────────
  useEffect(() => {
    if (!inviteToken) return;
    const verify = async () => {
      try {
        log.debug('Verifying invite token', inviteToken);
        const { data } = await api.get('/auth/invite/verify', { params: { token: inviteToken } });
        log.info('Invite verification response', data);

        if (data.valid) {
          setEmail(data.email);
          window.history.replaceState(null, '', window.location.pathname + window.location.hash.split('?')[0]);
          setInviteValid(true);
        } else {
          setInviteValid(false);
          setInviteError(data.message || 'Invalid invite link.');
        }
      } catch (err) {
        log.error('Invite verification error', err.message);
        setInviteValid(false);
        setInviteError(err.response?.data?.message || 'Could not verify invite. Please check your connection.');
      }
    };
    verify();
  }, [inviteToken]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      // NOTE: `login()` is expected to resolve with the logged-in user object
      // (e.g. `return data.user;` at the end of AuthContext's login function),
      // and to reject with an Error that carries a `redirect` field when the
      // server blocks the login for routing reasons (see authRoutes.js).
      const user = await login(loginEmail, loginPassword);

      if (user?.role === 'partner' && isMarqlandStudiosHost(window.location.hostname)) {
        window.location.href = PARTNER_PORTAL_URL;
        return;
      }
    } catch (err) {
      if (err?.redirect) {
        // Server-side guard already blocked this login and told us where to send them.
        window.location.href = err.redirect;
        return;
      }
      setError(err.message);
    }
    finally { setLoading(false); }
  };

  const handleRegister = async (e) => {
    e.preventDefault(); setError('');
    if (password !== confirm) return setError('Passwords do not match.');
    if (password.length < 8)  return setError('Password must be at least 8 characters.');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', { name, email, password });
      log.info('Self-register response', data);
      setMode('success');
    } catch (err) {
      log.error('Self-register error', err.message);
      setError(err.response?.data?.message || 'Registration failed');
    }
    finally { setLoading(false); }
  };

  const handleInviteRegister = async (e) => {
    e.preventDefault(); setError('');
    if (password !== confirm) return setError('Passwords do not match.');
    if (password.length < 8)  return setError('Password must be at least 8 characters.');
    setLoading(true);
    try {
      log.debug('Submitting invite registration', { token: inviteToken, name });
      const { data } = await api.post('/auth/invite/register', { token: inviteToken, name, password });
      log.info('Invite register response', data);
      setMode('success');
    } catch (err) {
      log.error('Invite register error', err.message);
      setError(err.response?.data?.message || 'Registration failed');
    }
    finally { setLoading(false); }
  };

  // ── Forgot password handler ──────────────────────────────────────────────────
  const handleForgot = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: forgotEmail });
      setForgotSent(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Request failed.');
    }
    finally { setLoading(false); }
  };

  // ── Reset password handler (from email link token) ────────────────────────
  const handleReset = async (e) => {
    e.preventDefault(); setError('');
    if (resetNewPass.length < 8) return setError('Password must be at least 8 characters.');
    if (resetNewPass !== resetConfirm) return setError('Passwords do not match.');
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token: resetToken, newPassword: resetNewPass });
      // Clear the token from URL
      window.history.replaceState(null, '', window.location.pathname + window.location.hash.split('?')[0]);
      setMode('reset-success');
    } catch (err) {
      setError(err.response?.data?.message || 'Reset failed.');
    }
    finally { setLoading(false); }
  };

  // ── Styles ────────────────────────────────────────────────────────────────────
  const S = {
    page: {
      minHeight: '100vh', background: '#0f172a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', system-ui, sans-serif", padding: '24px',
      position: 'relative', overflow: 'hidden',
    },
    glow: {
      position: 'absolute', width: '700px', height: '700px', borderRadius: '50%',
      background: 'radial-gradient(circle, rgba(99,102,241,0.1) 0%, transparent 70%)',
      top: '-250px', left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none',
    },
    card: {
      background: '#1e293b', border: '1px solid #334155', borderRadius: '20px',
      padding: '40px 36px', width: '100%', maxWidth: '420px',
      position: 'relative', zIndex: 1, boxShadow: '0 25px 60px rgba(0,0,0,0.4)',
    },
    logo: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '28px' },
    logoBox: {
      width: '36px', height: '36px', background: '#6366f1', borderRadius: '10px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '16px', color: '#fff', fontWeight: 900,
    },
    logoText: {
      fontSize: '20px', fontWeight: 800, color: '#f1f5f9',
      letterSpacing: '-0.02em', textTransform: 'uppercase', margin: 0,
    },
    subtitle: { fontSize: '13px', color: '#64748b', marginBottom: '28px', marginTop: 0 },
    btn: {
      width: '100%', padding: '13px', background: '#6366f1',
      color: '#fff', border: 'none', borderRadius: '10px',
      fontSize: '14px', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
      letterSpacing: '0.02em', marginTop: '4px',
      transition: 'opacity 0.2s', fontFamily: 'inherit', opacity: loading ? 0.7 : 1,
    },
    error: {
      background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
      borderRadius: '8px', padding: '10px 14px',
      color: '#fca5a5', fontSize: '13px', marginBottom: '16px',
    },
    toggle: { textAlign: 'center', marginTop: '20px', fontSize: '13px', color: '#64748b' },
    link: {
      color: '#818cf8', cursor: 'pointer', fontWeight: 600,
      background: 'none', border: 'none', fontSize: '13px',
      fontFamily: 'inherit', padding: 0,
    },
    inviteTag: {
      display: 'flex', alignItems: 'center', gap: '6px',
      background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
      borderRadius: '8px', padding: '10px 14px',
      color: '#a5b4fc', fontSize: '13px', fontWeight: 600,
      marginBottom: '20px',
    },
  };

  // ── Invite invalid ─────────────────────────────────────────────────────────────
  if (mode === 'invite' && inviteValid === false) {
    return (
      <div style={S.page}>
        <div style={S.glow} />
        <div style={S.card}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>❌</div>
            <h2 style={{ color: '#f1f5f9', fontWeight: 800, marginBottom: '8px' }}>Invalid Invite</h2>
            <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: '1.6' }}>{inviteError}</p>
            <button onClick={() => { setMode('login'); window.history.replaceState({}, '', '/'); }}
              style={{ ...S.btn, marginTop: '24px', width: 'auto', padding: '12px 32px' }}>
              Back to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Invite verifying ───────────────────────────────────────────────────────────
  if (mode === 'invite' && inviteValid === null) {
    return (
      <div style={S.page}>
        <div style={S.glow} />
        <div style={S.card}>
          <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
            <div style={{ fontSize: '32px', marginBottom: '16px' }}>⏳</div>
            Verifying your invite link...
          </div>
        </div>
      </div>
    );
  }

  // ── Success ────────────────────────────────────────────────────────────────────
  if (mode === 'success') {
    return (
      <div style={S.page}>
        <div style={S.glow} />
        <div style={S.card}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
            <h2 style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '20px', marginBottom: '8px' }}>
              You're registered!
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: '1.6' }}>
              Your account is pending admin approval.<br />
              An admin will activate your account shortly.
            </p>
            <button
              onClick={() => { setMode('login'); window.history.replaceState({}, '', '/'); }}
              style={{ ...S.btn, marginTop: '24px', width: 'auto', padding: '12px 32px' }}
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Reset success ─────────────────────────────────────────────────────────────
  if (mode === 'reset-success') {
    return (
      <div style={S.page}>
        <div style={S.glow} />
        <div style={S.card}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔐</div>
            <h2 style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '20px', marginBottom: '8px' }}>
              Password Reset!
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: '1.6' }}>
              Your new password is active. You can now sign in.
            </p>
            <button onClick={() => setMode('login')}
              style={{ ...S.btn, marginTop: '24px', width: 'auto', padding: '12px 32px' }}>
              Sign In →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main form ──────────────────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      <div style={S.glow} />
      <div style={S.card}>

        <div style={S.logo}>
          <div style={S.logoBox}>▦</div>
          <span style={S.logoText}>Marqland</span>
        </div>

        <p style={S.subtitle}>
          {mode === 'login'   ? 'Internal Portal — Sign in to continue'
          : mode === 'invite' ? "You've been invited — complete your registration"
          : mode === 'forgot' ? 'Enter your email to receive a reset link'
          : mode === 'reset'  ? 'Set your new password'
          :                     'Create your account — pending admin approval'}
        </p>

        {mode === 'invite' && (
          <div style={S.inviteTag}>
            ✉️ Invited as: <strong>{email}</strong>
          </div>
        )}

        {error && <div style={S.error}>⚠ {error}</div>}

        {/* LOGIN */}
        {mode === 'login' && (
          <form onSubmit={handleLogin}>
            <Field label="Email Address" type="email" value={loginEmail}
              onChange={e => setLoginEmail(e.target.value)} placeholder="you@marqland.com" required />
            <Field label="Password" type="password" value={loginPassword}
              onChange={e => setLoginPassword(e.target.value)} placeholder="••••••••" required />
            <button type="submit" style={S.btn} disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In →'}
            </button>
            <div style={{ textAlign: 'center', marginTop: '14px' }}>
              <button type="button" style={S.link}
                onClick={() => { setMode('forgot'); setError(''); setForgotSent(false); }}>
                Forgot password?
              </button>
            </div>
          </form>
        )}

        {/* SELF REGISTER */}
        {mode === 'register' && (
          <form onSubmit={handleRegister}>
            <Field label="Full Name" value={name} onChange={e => setName(e.target.value)}
              placeholder="Your full name" required />
            <Field label="Email Address" type="email" value={email}
              onChange={e => setEmail(e.target.value)} placeholder="you@marqland.com" required />
            <Field label="Password" type="password" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters" required />
            <PasswordStrength password={password} />
            <Field label="Confirm Password" type="password" value={confirm}
              onChange={e => setConfirm(e.target.value)} placeholder="Repeat password" required />
            <button type="submit" style={S.btn} disabled={loading}>
              {loading ? 'Submitting...' : 'Request Access →'}
            </button>
          </form>
        )}

        {/* INVITE REGISTER */}
        {mode === 'invite' && inviteValid && (
          <form onSubmit={handleInviteRegister}>
            <Field label="Full Name" value={name} onChange={e => setName(e.target.value)}
              placeholder="Your full name" required />
            <Field label="Email Address" type="email" value={email}
              onChange={() => {}} placeholder="" disabled />
            <Field label="Password" type="password" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters" required />
            <PasswordStrength password={password} />
            <Field label="Confirm Password" type="password" value={confirm}
              onChange={e => setConfirm(e.target.value)} placeholder="Repeat password" required />
            <button type="submit" style={S.btn} disabled={loading}>
              {loading ? 'Creating Account...' : 'Complete Registration →'}
            </button>
          </form>
        )}

        {/* FORGOT PASSWORD */}
        {mode === 'forgot' && (
          !forgotSent ? (
            <form onSubmit={handleForgot}>
              <Field label="Email Address" type="email" value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                placeholder="you@marqland.com" required />
              <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '16px', lineHeight: '1.5' }}>
                If your email is registered, we'll send a secure link to reset your password.
                The link expires in <strong style={{ color: '#94a3b8' }}>1 hour</strong>.
              </div>
              <button type="submit" style={S.btn} disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Link →'}
              </button>
              <div style={S.toggle}>
                <button style={S.link} onClick={() => { setMode('login'); setError(''); }}>
                  ← Back to Sign In
                </button>
              </div>
            </form>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📧</div>
              <h3 style={{ color: '#f1f5f9', fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>
                Check your inbox
              </h3>
              <p style={{ color: '#94a3b8', fontSize: '13px', lineHeight: '1.6', marginBottom: '20px' }}>
                If <strong style={{ color: '#cbd5e1' }}>{forgotEmail}</strong> is registered,
                you'll receive a reset link shortly.
              </p>
              <button style={{ ...S.btn, width: 'auto', padding: '10px 28px' }}
                onClick={() => { setMode('login'); setError(''); }}>
                Back to Sign In
              </button>
            </div>
          )
        )}

        {/* RESET PASSWORD (via email token) */}
        {mode === 'reset' && (
          <form onSubmit={handleReset}>
            <div style={{
              background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)',
              borderRadius: '8px', padding: '10px 14px',
              color: '#a5b4fc', fontSize: '12px', marginBottom: '20px', lineHeight: '1.5',
            }}>
              🔐 Reset link verified. Enter your new password below.
            </div>
            <Field label="New Password" type="password" value={resetNewPass}
              onChange={e => setResetNewPass(e.target.value)}
              placeholder="Min. 8 characters" required />
            <PasswordStrength password={resetNewPass} />
            <Field label="Confirm New Password" type="password" value={resetConfirm}
              onChange={e => setResetConfirm(e.target.value)}
              placeholder="Repeat new password" required />
            {resetConfirm && (
              <div style={{
                fontSize: '12px', marginTop: '-12px', marginBottom: '16px',
                color: resetNewPass === resetConfirm ? '#22c55e' : '#ef4444',
              }}>
                {resetNewPass === resetConfirm ? '✓ Passwords match' : '✗ Passwords do not match'}
              </div>
            )}
            <button type="submit" style={S.btn} disabled={loading}>
              {loading ? 'Resetting...' : 'Set New Password →'}
            </button>
          </form>
        )}

        {mode === 'register' && (
          <div style={S.toggle}>
            <>Already have an account?{' '}
              <button style={S.link} onClick={() => { setMode('login'); setError(''); }}>
                Sign in
              </button>
            </>
          </div>
        )}

      </div>
    </div>
  );
};

export default LoginPage;
