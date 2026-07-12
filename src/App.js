/**
 * src/App.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Application root — restyled to match the Marqland Studios brand language
 * (navy sidebar, gold accents, Cormorant Garamond / Jost, grain texture).
 *
 * All routing logic, permission checks and auth flow are unchanged.
 *
 * Route-level code-splitting: every page/route component below is loaded via
 * React.lazy() instead of a static import, so the initial bundle only ships
 * App shell + whichever single route the user actually lands on — not all 20+
 * page files (some of which are 100–200KB of source each). PageLoader (already
 * built and already used as the "Authenticating…" fallback) doubles as the
 * Suspense fallback. LoginPage stays a static import since it's rendered
 * synchronously outside of <Routes> and is on the critical path for almost
 * every visitor — lazy-loading it would add Suspense boundaries for no benefit.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, Suspense, lazy } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useLocation,
  Navigate,
} from 'react-router-dom';
import {
  Gift,
  Package,
  Users,
  Building,
  Bookmark,
  Compass,
  Map,
  HardDrive,
  LetterTextIcon,
  FileText,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Shield,
  Activity,
  TrendingUp,
  Truck,
  Target,
} from 'lucide-react';

import { AuthProvider, useAuth } from './context/AuthContext';
import { AppPopupStyles }        from './components/AppPopups';
import { PageLoader }            from './components/PageLoader';
import { createLogger }          from './utils/logger';

import LoginPage from './pages/LoginPage';

const UserManagement      = lazy(() => import('./pages/UserManagement'));
const PublicAdminPortal   = lazy(() => import('./pages/public-site/AdminView'));
const ChangePassword      = lazy(() => import('./pages/ChangePassword'));
const ProductList         = lazy(() => import('./pages/ProductList'));
const VendorList          = lazy(() => import('./pages/VendorList'));
const ClientList          = lazy(() => import('./pages/ClientList'));
const SavedCatalogues     = lazy(() => import('./pages/SavedCatalogues'));
const CatalogueBuilder    = lazy(() => import('./components/CatalogueBuilder'));
const OffsiteBuilder      = lazy(() => import('./components/OffsiteBuilder'));
const PropertyList        = lazy(() => import('./pages/PropertyList'));
const OffsiteCatalogues   = lazy(() => import('./pages/OffsiteCatalogues'));
const MarqlandLetterHead  = lazy(() => import('./pages/MarqlandLetterHead'));
const OrderTracker        = lazy(() => import('./pages/OrderTracker'));
const SamplesProvided     = lazy(() => import('./pages/SamplesProvided'));
const SourcingHub         = lazy(() => import('./pages/SourcingHub'));
const PaymentTracker      = lazy(() => import('./pages/PaymentTracker'));
const ClientPortalView    = lazy(() => import('./pages/ClientPortalView'));
const ActivityLogView     = lazy(() => import('./pages/ActivityLogView'));
const TrendingProducts    = lazy(() => import('./pages/TrendingProducts'));
const CourierTracking     = lazy(() => import('./pages/CourierTracking'));
const LeadScout           = lazy(() => import('./pages/LeadScout'));

const log = createLogger('App');

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens — mirrors HomePage CSS vars exactly
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  navy:       '#0e1520',
  navyDeep:   '#0c1018',
  gold:       '#b8975a',
  gold2:      '#d4b06a',
  offwhite:   '#faf8f5',
  text:       '#1a1a1a',
  muted:      '#888',
  borderGold: 'rgba(184,151,90,0.18)',
  borderDim:  'rgba(255,255,255,0.06)',
  mutedText:  'rgba(255,255,255,0.28)',
  dimText:    'rgba(255,255,255,0.45)',
};

// ── Fonts (Cormorant Garamond + Jost, same as HomePage) ──────────────────────
const FontLoader = () => {
  useEffect(() => {
    if (document.querySelector('#ms-app-gf')) return;
    const link = document.createElement('link');
    link.id   = 'ms-app-gf';
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Jost:wght@200;300;400;500&display=swap';
    document.head.appendChild(link);
  }, []);
  return null;
};

// ── Grain overlay (matches .grain::after in HomePage) ────────────────────────
const GrainOverlay = () => (
  <div style={{
    position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1,
    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`,
    backgroundSize: '200px',
  }} />
);

// ─────────────────────────────────────────────────────────────────────────────
// Route permission map  — keep in sync with ALL_ROUTES in UserManagement.js
// ─────────────────────────────────────────────────────────────────────────────
export const PATH_TO_ROUTE_KEY = {
  '/':                   'Order Tracker',
  '/sourcinghub':        'Sourcing Hub',
  '/products':           'Products',
  '/samplesprovided':    'Samples Provided',
  '/savedcatalogues':    'Saved Catalogues',
  '/paymenttracker':     'Payment Tracker',
  '/vendors':            'Vendors',
  '/clients':            'Clients',
  '/MarqlandLetterHead': 'Letter Head',
  '/properties':         'Property List',
  '/saved-offsites':     'Saved Offsites',
  '/admin/users':        'User Management',
  '/admin/logs':         'Activity Logs',
  '/trending-products':  'Trending Products',
  '/courier-tracking':   'Courier Tracking',
  '/admin/lead-scout':   'Lead Scout',
};

// ─────────────────────────────────────────────────────────────────────────────
// Role defaults — mirrors ROLE_DEFAULTS in UserManagement.js
// ─────────────────────────────────────────────────────────────────────────────
const ROLE_DEFAULTS = {
  admin:     Object.values(PATH_TO_ROUTE_KEY),
  accounts:  ['Order Tracker', 'Payment Tracker', 'Vendors', 'Clients', 'Invoice Tracking'],
  sales:     ['Order Tracker', 'Sourcing Hub', 'Products', 'Saved Catalogues', 'Clients', 'Property List', 'Saved Offsites'],
  inventory: ['Products', 'Samples Provided', 'Saved Catalogues', 'Sourcing Hub', 'Property List', 'Saved Offsites'],
  courier:   ['Courier Tracking'],
  viewer:    ['Order Tracker'],
};

export const getUserRoutes = (user) =>
  user?.allowedRoutes?.length
    ? user.allowedRoutes
    : (ROLE_DEFAULTS[user?.role] ?? []);

// ─────────────────────────────────────────────────────────────────────────────
// ProtectedRoute — unchanged logic
// ─────────────────────────────────────────────────────────────────────────────
const ProtectedRoute = ({ children, routeKey }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader />;
  if (!user)   return <Navigate to="/" replace />;
  if (user.role === 'admin') return children;

  const key = routeKey ?? PATH_TO_ROUTE_KEY[location.pathname];
  if (key && !getUserRoutes(user).includes(key)) {
    log.warn(`Access denied: user "${user.email}" → "${key}". Redirecting home.`);
    return <Navigate to="/" replace />;
  }

  return children;
};

// ─────────────────────────────────────────────────────────────────────────────
// Role badge colours — updated to gold-tinted palette on navy
// ─────────────────────────────────────────────────────────────────────────────
const ROLE_BADGE = {
  admin:     { bg: 'rgba(184,151,90,0.18)', color: T.gold },
  accounts:  { bg: 'rgba(134,197,134,0.15)', color: '#7dc47d' },
  sales:     { bg: 'rgba(230,185,80,0.15)',  color: '#e6b950' },
  inventory: { bg: 'rgba(100,160,220,0.15)', color: '#64a0dc' },
  courier:   { bg: 'rgba(180,130,220,0.15)', color: '#b482dc' },
  viewer:    { bg: 'rgba(255,255,255,0.08)', color: T.dimText },
};

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────────────────────
const Sidebar = () => {
  const location = useLocation();
  const { user, logout } = useAuth();

  const [isCollapsed,  setIsCollapsed]  = useState(false);
  const [openSections, setOpenSections] = useState({
    orders: true, gifting: true, documentation: true, offsites: true, admin: true,
  });

  // Hide on invoice-scan and mobile payment tracker
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
  if (
    location.pathname === '/scaninvoice' ||
    (isMobile && location.pathname.startsWith('/paymenttracker'))
  ) return null;

  const isActive = (path) => location.pathname === path;

  const toggleSection = (section) => {
    if (isCollapsed) {
      setIsCollapsed(false);
      setOpenSections((prev) => ({ ...prev, [section]: true }));
      return;
    }
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // User initials
  const initials = (user?.name || user?.email || '?')
    .split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);

  const badge = ROLE_BADGE[user?.role] ?? ROLE_BADGE.viewer;

  // ── NavLink ─────────────────────────────────────────────────────────────────
  const NavLink = ({ to, icon: Icon, label, routeKey: rk }) => {
    const key = rk ?? PATH_TO_ROUTE_KEY[to];
    if (user?.role !== 'admin' && key && !getUserRoutes(user).includes(key)) return null;

    const active = isActive(to);
    return (
      <Link
        to={to}
        title={isCollapsed ? label : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: isCollapsed ? '10px 0' : '9px 12px',
          justifyContent: isCollapsed ? 'center' : 'flex-start',
          borderRadius: 3,
          textDecoration: 'none',
          fontSize: 11,
          fontFamily: '"Jost", sans-serif',
          fontWeight: 400,
          letterSpacing: '0.08em',
          transition: 'background 0.25s, color 0.25s, border-color 0.25s',
          // Active: gold left-border + subtle gold tint
          background: active ? 'rgba(184,151,90,0.10)' : 'transparent',
          color:      active ? T.gold : T.dimText,
          borderLeft: active
            ? `2px solid ${T.gold}`
            : '2px solid transparent',
          marginLeft: isCollapsed ? 0 : -2,   // align with border
        }}
        onMouseEnter={(e) => {
          if (!active) {
            e.currentTarget.style.background  = 'rgba(255,255,255,0.04)';
            e.currentTarget.style.color       = 'rgba(255,255,255,0.75)';
          }
        }}
        onMouseLeave={(e) => {
          if (!active) {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color      = T.dimText;
          }
        }}
      >
        <Icon size={15} style={{ flexShrink: 0, opacity: active ? 1 : 0.6 }} />
        {!isCollapsed && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>}
      </Link>
    );
  };

  // ── SectionBtn ──────────────────────────────────────────────────────────────
  const SectionBtn = ({ sectionKey, icon: Icon, label }) => (
    <button
      onClick={() => toggleSection(sectionKey)}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: isCollapsed ? 'center' : 'space-between',
        padding: isCollapsed ? '8px 0' : '6px 12px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        marginBottom: 2,
        borderRadius: 3,
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
    >
      <span style={{
        display: 'flex', alignItems: 'center', gap: 7,
        fontFamily: '"Jost", sans-serif',
        fontSize: 9, fontWeight: 400,
        letterSpacing: '0.28em', textTransform: 'uppercase',
        color: 'rgba(184,151,90,0.55)',
      }}>
        <Icon size={11} style={{ opacity: 0.7 }} />
        {!isCollapsed && label}
      </span>
      {!isCollapsed && (
        openSections[sectionKey]
          ? <ChevronDown  size={12} style={{ color: 'rgba(255,255,255,0.2)' }} />
          : <ChevronRight size={12} style={{ color: 'rgba(255,255,255,0.2)' }} />
      )}
    </button>
  );

  return (
    <aside style={{
      width: isCollapsed ? 68 : 228,
      background: T.navy,
      borderRight: `1px solid ${T.borderDim}`,
      display: 'flex',
      flexDirection: 'column',
      position: 'sticky',
      top: 0,
      height: '100vh',
      flexShrink: 0,
      transition: 'width 0.3s ease',
      overflow: 'hidden',
      // grain
      position: 'relative',
    }}>
      <GrainOverlay />

      {/* Everything sits above grain */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div style={{
          padding: isCollapsed ? '20px 0' : '22px 18px 18px',
          borderBottom: `1px solid ${T.borderDim}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'space-between',
          gap: 8,
          flexShrink: 0,
        }}>
          {!isCollapsed && (
            <div>
              <div style={{
                fontFamily: '"Cormorant Garamond", Georgia, serif',
                fontSize: 18, fontWeight: 300,
                color: 'white', letterSpacing: '0.04em',
                lineHeight: 1.2,
              }}>
                Marqland <em style={{ color: T.gold }}>Studios.</em>
              </div>
              <div style={{
                fontFamily: '"Jost", sans-serif',
                fontSize: 9, fontWeight: 400,
                letterSpacing: '0.25em', textTransform: 'uppercase',
                color: 'rgba(184,151,90,0.45)',
                marginTop: 3,
              }}>
                Admin Portal
              </div>
            </div>
          )}
          <button
            onClick={() => setIsCollapsed((c) => !c)}
            title={isCollapsed ? 'Expand' : 'Collapse'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.25)', padding: 4, borderRadius: 3,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'color 0.2s',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = T.gold}
            onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.25)'}
          >
            {isCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>

        {/* ── Navigation ──────────────────────────────────────────────── */}
        <div style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden',
          padding: isCollapsed ? '12px 8px' : '12px 10px',
          display: 'flex', flexDirection: 'column', gap: 4,
          // thin scrollbar
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(184,151,90,0.15) transparent',
        }}>

          {/* Orders & Tracking */}
          <nav>
            <SectionBtn sectionKey="orders" icon={Gift} label="Orders & Tracking" />
            {(openSections.orders || isCollapsed) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 4 }}>
                <NavLink to="/"                 icon={Gift}    label="Order Tracker"    />
                <NavLink to="/sourcinghub"      icon={Compass} label="Sourcing Hub"     />
                <NavLink to="/courier-tracking" icon={Truck}   label="Courier Tracking" />
              </div>
            )}
          </nav>

          {/* thin gold rule between sections */}
          <div style={{ height: 1, background: T.borderGold, margin: '2px 12px' }} />

          {/* Gifting */}
          <nav>
            <SectionBtn sectionKey="gifting" icon={Package} label="Gifting" />
            {(openSections.gifting || isCollapsed) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 4 }}>
                <NavLink to="/products"          icon={Package}   label="Products"          />
                <NavLink to="/samplesprovided"   icon={Package}   label="Samples Provided"  />
                <NavLink to="/savedcatalogues"   icon={Bookmark}  label="Saved Catalogues"  />
                <NavLink to="/trending-products" icon={TrendingUp} label="Trending Products" />
              </div>
            )}
          </nav>

          <div style={{ height: 1, background: T.borderGold, margin: '2px 12px' }} />

          {/* Documentation */}
          <nav>
            <SectionBtn sectionKey="documentation" icon={FileText} label="Documentation" />
            {(openSections.documentation || isCollapsed) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 4 }}>
                <NavLink to="/paymenttracker"     icon={Bookmark}       label="Invoice & Payment Tracker" />
                <NavLink to="/vendors"            icon={Users}          label="Vendors"                   />
                <NavLink to="/clients"            icon={Building}       label="Clients"                   />
                <NavLink to="/MarqlandLetterHead" icon={LetterTextIcon} label="Letter Head"               />
              </div>
            )}
          </nav>

          <div style={{ height: 1, background: T.borderGold, margin: '2px 12px' }} />

          {/* Offsites */}
          <nav>
            <SectionBtn sectionKey="offsites" icon={Compass} label="Offsites" />
            {(openSections.offsites || isCollapsed) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 4 }}>
                <NavLink to="/properties"     icon={Map}      label="Property List"  />
                <NavLink to="/saved-offsites" icon={HardDrive} label="Saved Offsites" />
              </div>
            )}
          </nav>

          {/* Admin — only for admin role */}
          {user?.role === 'admin' && (
            <>
              <div style={{ height: 1, background: T.borderGold, margin: '2px 12px' }} />
              <nav>
                <SectionBtn sectionKey="admin" icon={Shield} label="Admin" />
                {(openSections.admin || isCollapsed) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 4 }}>
                    <NavLink to="/admin/users"       icon={Shield}   label="User Management"        />
                    <NavLink to="/admin/logs"         icon={Activity} label="Activity Logs"           />
                    <NavLink to="/admin/lead-scout"  icon={Target}   label="Lead Scout"              />
                    <NavLink to="/public-site-admin" icon={Shield}   label="Public Admin Management" />
                  </div>
                )}
              </nav>
            </>
          )}

          {/* Change Password — all users */}
          <div style={{ height: 1, background: T.borderGold, margin: '2px 12px' }} />
          <nav>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <NavLink to="/change-password" icon={Shield} label="Change Password" />
            </div>
          </nav>
        </div>

        {/* ── User footer ─────────────────────────────────────────────── */}
        <div style={{
          padding: isCollapsed ? '14px 0' : '14px 16px',
          borderTop: `1px solid ${T.borderDim}`,
          flexShrink: 0,
        }}>
          {!isCollapsed ? (
            <>
              {/* Avatar + name + role */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                {/* Initials square — mirrors the navy square in homepage testimonials */}
                <div style={{
                  width: 32, height: 32,
                  background: 'rgba(184,151,90,0.15)',
                  border: `1px solid ${T.borderGold}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  borderRadius: 3,
                }}>
                  <span style={{
                    fontFamily: '"Jost", sans-serif',
                    fontSize: 11, fontWeight: 500, color: T.gold,
                  }}>
                    {initials}
                  </span>
                </div>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{
                    fontFamily: '"Jost", sans-serif',
                    fontSize: 12, fontWeight: 400, color: 'rgba(255,255,255,0.75)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {user?.name}
                  </div>
                  {/* Role pill — mirrors .pill from homepage */}
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    border: `1px solid rgba(184,151,90,0.3)`,
                    fontFamily: '"Jost", sans-serif',
                    fontSize: 9, fontWeight: 400,
                    letterSpacing: '0.2em', textTransform: 'uppercase',
                    background: badge.bg, color: badge.color,
                    borderRadius: 2,
                    marginTop: 3,
                  }}>
                    {user?.role}
                  </span>
                </div>
              </div>

              {/* Sign out */}
              <button
                onClick={logout}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px', background: 'none',
                  border: '1px solid transparent', borderRadius: 3, cursor: 'pointer',
                  fontFamily: '"Jost", sans-serif',
                  fontSize: 10, fontWeight: 400,
                  letterSpacing: '0.15em', textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.25)',
                  transition: 'color 0.25s, border-color 0.25s, background 0.25s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color       = '#e57373';
                  e.currentTarget.style.borderColor = 'rgba(229,115,115,0.25)';
                  e.currentTarget.style.background  = 'rgba(229,115,115,0.06)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color       = 'rgba(255,255,255,0.25)';
                  e.currentTarget.style.borderColor = 'transparent';
                  e.currentTarget.style.background  = 'none';
                }}
              >
                <LogOut size={13} /> Sign Out
              </button>
            </>
          ) : (
            /* Collapsed: just logout icon */
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              {/* Initials only */}
              <div style={{
                width: 32, height: 32,
                background: 'rgba(184,151,90,0.12)',
                border: `1px solid ${T.borderGold}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 3,
              }}>
                <span style={{ fontFamily: '"Jost", sans-serif', fontSize: 11, fontWeight: 500, color: T.gold }}>
                  {initials}
                </span>
              </div>
              <button
                onClick={logout}
                title="Sign Out"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'rgba(255,255,255,0.25)', padding: 4, borderRadius: 3,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#e57373'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.25)'}
              >
                <LogOut size={15} />
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// AppShell — unchanged logic, updated wrapper background
// ─────────────────────────────────────────────────────────────────────────────
const AppShell = () => {
  const { user, loading } = useAuth();

  if (loading) return <PageLoader message="Authenticating…" />;

  // Invite-token intercept
  const hashQuery = window.location.hash.includes('?')
    ? window.location.hash.slice(window.location.hash.indexOf('?'))
    : '';
  const urlToken =
    new URLSearchParams(window.location.search).get('token') ||
    new URLSearchParams(hashQuery).get('token');
  if (urlToken) {
    log.info('Invite token detected — rendering LoginPage');
    return <LoginPage />;
  }

  // Public routes — no auth required
  const PUBLIC_PREFIXES = ['/p/', '/respond/'];
  if (PUBLIC_PREFIXES.some((p) => window.location.pathname.startsWith(p))) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/p/:slug"     element={<ClientPortalView />} />
          <Route path="/respond/:id" element={<SourcingHub />}      />
        </Routes>
      </Suspense>
    );
  }

  if (!user) return <LoginPage />;

  log.info('AppShell: rendering authenticated shell', { user: user.email, role: user.role });

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      // Off-white content area — matches var(--offwhite) from HomePage
      background: T.offwhite,
      fontFamily: '"Jost", sans-serif',
    }}>
      <Sidebar />
      <main style={{ flex: 1, overflowY: 'auto', height: '100vh' }}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* ── Orders & Tracking ── */}
            <Route path="/"                 element={<ProtectedRoute routeKey="Order Tracker"><OrderTracker /></ProtectedRoute>} />
            <Route path="/courier-tracking" element={<ProtectedRoute routeKey="Courier Tracking"><CourierTracking /></ProtectedRoute>} />
            <Route path="/sourcinghub"      element={<ProtectedRoute routeKey="Sourcing Hub"><SourcingHub /></ProtectedRoute>} />

            {/* ── Gifting ── */}
            <Route path="/products"          element={<ProtectedRoute routeKey="Products"><ProductList /></ProtectedRoute>} />
            <Route path="/samplesprovided"   element={<ProtectedRoute routeKey="Samples Provided"><SamplesProvided /></ProtectedRoute>} />
            <Route path="/savedcatalogues"   element={<ProtectedRoute routeKey="Saved Catalogues"><SavedCatalogues /></ProtectedRoute>} />
            <Route path="/builder"           element={<ProtectedRoute routeKey="Saved Catalogues"><CatalogueBuilder /></ProtectedRoute>} />
            <Route path="/trending-products" element={<ProtectedRoute routeKey="Trending Products"><TrendingProducts /></ProtectedRoute>} />

            {/* ── Documentation ── */}
            <Route path="/paymenttracker"     element={<ProtectedRoute routeKey="Payment Tracker"><PaymentTracker /></ProtectedRoute>} />
            <Route path="/vendors"            element={<ProtectedRoute routeKey="Vendors"><VendorList /></ProtectedRoute>} />
            <Route path="/clients"            element={<ProtectedRoute routeKey="Clients"><ClientList /></ProtectedRoute>} />
            <Route path="/MarqlandLetterHead" element={<ProtectedRoute routeKey="Letter Head"><MarqlandLetterHead /></ProtectedRoute>} />

            {/* ── Offsites ── */}
            <Route path="/properties"     element={<ProtectedRoute routeKey="Property List"><PropertyList /></ProtectedRoute>} />
            <Route path="/saved-offsites" element={<ProtectedRoute routeKey="Saved Offsites"><OffsiteCatalogues /></ProtectedRoute>} />
            <Route path="/offsite-builder" element={<ProtectedRoute routeKey="Saved Offsites"><OffsiteBuilder /></ProtectedRoute>} />

            {/* ── Admin ── */}
            <Route path="/admin/users"       element={<ProtectedRoute routeKey="User Management"><UserManagement /></ProtectedRoute>} />
            <Route path="/admin/logs"        element={<ProtectedRoute routeKey="Activity Logs"><ActivityLogView /></ProtectedRoute>} />
            <Route path="/public-site-admin" element={<ProtectedRoute routeKey="User Management"><PublicAdminPortal /></ProtectedRoute>} />
            <Route path="/admin/lead-scout"  element={<ProtectedRoute routeKey="Lead Scout"><LeadScout /></ProtectedRoute>} />

            {/* ── All users ── */}
            <Route path="/change-password" element={<ChangePassword />} />

            {/* ── Public (accessible when logged in too) ── */}
            <Route path="/p/:slug"     element={<ClientPortalView />} />
            <Route path="/respond/:id" element={<SourcingHub />}      />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────
function App() {
  return (
    <AuthProvider>
      <FontLoader />
      <AppPopupStyles />
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppShell />
      </Router>
    </AuthProvider>
  );
}

export default App;
