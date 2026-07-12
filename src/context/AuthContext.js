import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, {
  setAccessToken,
  clearAccessToken,
  getCachedUser,
  setCachedUser,
  clearCachedUser,
  refreshAccessToken,
} from '../api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // true while we validate the session

  // ── On mount: restore session then fetch fresh user data from /api/auth/me ──
  // This ensures allowedRoutes changes made by admin are picked up on next login.
  //
  // There's no access token to read from storage anymore (it lives in memory
  // only and is gone after a reload) — instead we silently exchange the
  // httpOnly refresh-token cookie for a fresh one via refreshAccessToken().
  // `silent: true` means "no cookie" is treated as "not logged in yet" rather
  // than "session expired", so anonymous visitors don't get bounced through a
  // forced redirect on first load.
  useEffect(() => {
    let cancelled = false;

    // Optimistically restore the cached profile so the UI paints instantly.
    const stored = getCachedUser();
    if (stored) setUser(stored);

    refreshAccessToken({ silent: true })
      .then(() => api.get('/auth/me'))
      .then(({ data: fresh }) => {
        if (cancelled) return;
        setUser(fresh);
        setCachedUser(fresh);
      })
      .catch(() => {
        // No valid session (never logged in, or refresh token expired/rotated
        // out from another session). Don't keep showing a stale cached user.
        if (cancelled) return;
        clearCachedUser();
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // ── Legacy fetch-shaped request helper ───────────────────────────────────
  // Kept for backward compatibility with any existing call sites written
  // against the old `authFetch(url, options) => Response`-like contract
  // (e.g. `const res = await authFetch('/api/products'); const data = await
  // res.json();`). Internally it now just delegates to `api` (the single
  // axios client), so there is exactly one request pipeline, one token store,
  // and one refresh implementation in the app — this no longer runs its own
  // independent 401/refresh logic that could race with api.js's.
  //
  // ASSUMPTION: existing call sites pass a `/api/...`-prefixed path, matching
  // this file's own previous internal convention (`${API_ROOT}${url}`). That
  // leading `/api` is stripped below before delegating to `api`, whose
  // baseURL already includes `/api`. Verify with a repo-wide search for
  // `authFetch(` before relying on this in production — see the review notes.
  const authFetch = useCallback(async (url, options = {}) => {
    const path = url.replace(/^\/api(?=\/|$)/, '');

    let data;
    if (options.body) {
      try { data = JSON.parse(options.body); } catch { data = options.body; }
    }

    try {
      const response = await api.request({
        url:    path,
        method: options.method || 'GET',
        data,
        headers: options.headers,
      });
      return {
        ok:     true,
        status: response.status,
        json:   async () => response.data,
        text:   async () => JSON.stringify(response.data),
      };
    } catch (err) {
      const response = err.response;
      return {
        ok:     false,
        status: response?.status ?? 0,
        json:   async () => response?.data ?? { message: err.message },
        text:   async () => JSON.stringify(response?.data ?? { message: err.message }),
      };
    }
  }, []);

  // ── Login ─────────────────────────────────────────────────────────────────
  const login = async (email, password) => {
    try {
      const { data } = await api.post('/auth/login', { email, password });

      setAccessToken(data.accessToken);
      setCachedUser(data.user);
      setUser(data.user);
      return data.user;
    } catch (err) {
      const payload = err.response?.data;
      const loginError = new Error(payload?.message || 'Login failed');
      // Preserve the server-side partner-routing redirect (see authRoutes.js)
      // so LoginPage's existing `if (err?.redirect)` handling keeps working.
      if (payload?.redirect) loginError.redirect = payload.redirect;
      throw loginError;
    }
  };

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      // Uses the current in-memory access token (attached automatically by
      // api.js's request interceptor) and clears the refresh_token cookie
      // server-side.
      await api.post('/auth/logout');
    } catch { /* silent fail */ }

    clearAccessToken();
    clearCachedUser();
    setUser(null);
  }, []);

  // ── Permission helpers ────────────────────────────────────────────────────

  /**
   * Check if current user has one of the given roles
   * Usage: can(['admin', 'accounts'])
   */
  const can = useCallback((roles = []) => {
    if (!user) return false;
    return roles.includes(user.role);
  }, [user]);

  /**
   * Role-based visibility map for sidebar navigation
   * Returns true if the user should see this section
   */
  const canAccess = useCallback((section) => {
    if (!user) return false;
    if (user.role === 'admin') return true;

    const permissions = {
      products:        ['inventory', 'sales', 'accounts'],
      vendors:         ['accounts'],
      clients:         ['sales', 'accounts'],
      catalogues:      ['inventory', 'sales', 'accounts'],
      properties:      ['inventory', 'sales', 'accounts'],
      offsites:        ['inventory', 'sales', 'accounts'],
      orders:          ['sales', 'accounts'],
      challans:        ['inventory', 'sales', 'accounts'],
      sourcinghub:     ['sales', 'accounts'],
      paymenttracker:  ['accounts'],
      letterhead:      ['sales', 'accounts'],
      userManagement:  [], // admin only — handled by admin check above
    };

    return (permissions[section] || []).includes(user.role);
  }, [user]);

  // ── Manually refresh current user from server (call after admin saves routes) ──
  const refreshUser = useCallback(async () => {
    try {
      const { data: fresh } = await api.get('/auth/me');
      setUser(fresh);
      setCachedUser(fresh);
    } catch { /* silent */ }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, authFetch, can, canAccess, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
