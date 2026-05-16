/**
 * src/components/PageLoader.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Reusable loading / skeleton components — same API as before, restyled to
 * match the Marqland Studios design language (navy, gold, Cormorant Garamond /
 * Jost, thin borders, grain texture).
 *
 * EXPORTS
 * ───────
 *  <PageLoader />              Full-page centred spinner (route-level / auth)
 *  <SectionLoader />           Inline centred spinner inside a card / section
 *  <SkeletonRow  cols={n} />   Table-row skeleton  (n columns, default 4)
 *  <SkeletonList rows={n} />   Stack of SkeletonRow for table bodies
 *  <SkeletonCard />            Card skeleton for grid / catalogue views
 *  <SkeletonStat />            Stat card skeleton for dashboards
 *
 * USAGE
 * ─────
 *  import { PageLoader, SectionLoader, SkeletonList, SkeletonCard } from '../components/PageLoader';
 *
 *  // Full-page while auth resolves:
 *  if (loading) return <PageLoader />;
 *
 *  // Table body while data loads:
 *  {isLoading ? <SkeletonList rows={8} cols={5} /> : <TableBody ... />}
 *
 *  // Grid while data loads:
 *  {isLoading
 *    ? <div className="grid grid-cols-3 gap-4">{Array.from({length:6}).map((_,i)=><SkeletonCard key={i}/>)}</div>
 *    : <Grid ... />}
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect } from 'react';

// ── Google Fonts (mirrors FontLoader in HomePage) ─────────────────────────────
const FontLoader = () => {
  useEffect(() => {
    if (document.querySelector('#ms-pl-gf')) return;
    const link = document.createElement('link');
    link.id   = 'ms-pl-gf';
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Jost:wght@200;300;400;500&display=swap';
    document.head.appendChild(link);
  }, []);
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens (keep in sync with HomePage CSS vars)
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  navy:     '#0e1520',
  gold:     '#b8975a',
  gold2:    '#d4b06a',
  offwhite: '#faf8f5',
  muted:    'rgba(255,255,255,0.28)',
  border:   'rgba(184,151,90,0.18)',
};

// ── Shared CSS injected once into <head> ──────────────────────────────────────
const GLOBAL_CSS = `
  @keyframes ms-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @keyframes ms-shimmer {
    0%   { background-position: -400px 0; }
    100% { background-position:  400px 0; }
  }
  @keyframes ms-pulse-ring {
    0%,100% { opacity: 0.7; transform: translate(-50%,-50%) scale(1);    }
    50%     { opacity: 0.2; transform: translate(-50%,-50%) scale(1.18); }
  }
  @keyframes ms-grain-float {
    0%,100% { transform: translate(0,0); }
    25%     { transform: translate(-1px, 1px); }
    75%     { transform: translate(1px,-1px); }
  }
  .ms-shimmer-bar {
    background: linear-gradient(
      90deg,
      rgba(184,151,90,0.07) 25%,
      rgba(184,151,90,0.15) 50%,
      rgba(184,151,90,0.07) 75%
    );
    background-size: 400px 100%;
    animation: ms-shimmer 1.6s ease-in-out infinite;
    border-radius: 2px;
  }
`;

const injectGlobalCss = (() => {
  let injected = false;
  return () => {
    if (injected || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = GLOBAL_CSS;
    document.head.appendChild(style);
    injected = true;
  };
})();

// ── Grain texture overlay (matches .grain::after in HomePage) ─────────────────
const GrainOverlay = () => (
  <div style={{
    position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`,
    backgroundSize: '200px',
    animation: 'ms-grain-float 8s ease-in-out infinite',
  }} />
);

// ── Decorative pulse rings (echoes the hero strip circles in TestimonialsPage) ─
const DecorRings = () => (
  <>
    <div style={{
      position: 'absolute', top: '50%', left: '50%',
      width: 280, height: 280,
      border: '1px solid rgba(184,151,90,0.08)',
      borderRadius: '50%',
      animation: 'ms-pulse-ring 3s ease-in-out infinite',
    }} />
    <div style={{
      position: 'absolute', top: '50%', left: '50%',
      width: 420, height: 420,
      border: '1px solid rgba(184,151,90,0.04)',
      borderRadius: '50%',
      animation: 'ms-pulse-ring 3s ease-in-out infinite 0.6s',
    }} />
  </>
);

// ── Gold ring spinner (replaces indigo SVG) ───────────────────────────────────
const Spinner = ({ size = 36 }) => (
  <div style={{
    width: size, height: size,
    border: '1px solid rgba(184,151,90,0.18)',
    borderTop: `1px solid ${T.gold}`,
    borderRadius: '50%',
    animation: 'ms-spin 1.1s linear infinite',
    flexShrink: 0,
  }} />
);

// ─────────────────────────────────────────────────────────────────────────────
// PageLoader — full-page, used while auth / initial route resolves
// ─────────────────────────────────────────────────────────────────────────────
export const PageLoader = ({ message = 'Loading…' }) => {
  injectGlobalCss();
  return (
    <>
      <FontLoader />
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed', inset: 0,
          background: T.navy,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 28, zIndex: 9999,
          overflow: 'hidden',
        }}
      >
        <GrainOverlay />
        <DecorRings />

        {/* Content sits above grain + rings */}
        <div style={{
          position: 'relative', zIndex: 3,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 22,
        }}>
          {/* Wordmark */}
          <div style={{
            fontFamily: '"Cormorant Garamond", Georgia, serif',
            fontSize: 26, fontWeight: 300,
            color: 'white', letterSpacing: '0.05em',
          }}>
            Marqland <em style={{ color: T.gold }}>Studios.</em>
          </div>

          {/* Spinner */}
          <Spinner size={40} />

          {/* Gold rule */}
          <div style={{ width: 40, height: 1, background: T.gold, opacity: 0.45 }} />

          {/* Message */}
          <p style={{
            fontFamily: '"Jost", sans-serif',
            fontSize: 9, fontWeight: 400,
            letterSpacing: '0.3em', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.28)', margin: 0,
          }}>
            {message}
          </p>
        </div>
      </div>
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SectionLoader — inline, inside a page card or section while data fetches
// ─────────────────────────────────────────────────────────────────────────────
export const SectionLoader = ({ message = 'Loading…', className = '' }) => {
  injectGlobalCss();
  return (
    <div
      role="status"
      aria-live="polite"
      className={className}
      style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '64px 0', gap: 16,
      }}
    >
      <Spinner size={28} />
      <p style={{
        fontFamily: '"Jost", sans-serif',
        fontSize: 9, fontWeight: 400,
        letterSpacing: '0.28em', textTransform: 'uppercase',
        color: '#888', margin: 0,
      }}>
        {message}
      </p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SkeletonBar — internal shimmer primitive
// ─────────────────────────────────────────────────────────────────────────────
const SkeletonBar = ({ width = '100%', height = 10, style: extra = {} }) => {
  injectGlobalCss();
  return (
    <div
      className="ms-shimmer-bar"
      aria-hidden="true"
      style={{ width, height, ...extra }}
    />
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SkeletonRow — single table row, n columns
// ─────────────────────────────────────────────────────────────────────────────
export const SkeletonRow = ({ cols = 4 }) => (
  <tr aria-hidden="true">
    {Array.from({ length: cols }).map((_, i) => (
      <td key={i} style={{ padding: '14px 16px' }}>
        <SkeletonBar width={i === 0 ? '55%' : '80%'} height={9} />
      </td>
    ))}
  </tr>
);

// ─────────────────────────────────────────────────────────────────────────────
// SkeletonList — n rows, used to replace full table <tbody>
// ─────────────────────────────────────────────────────────────────────────────
export const SkeletonList = ({ rows = 6, cols = 4 }) => (
  <>
    {Array.from({ length: rows }).map((_, i) => (
      <SkeletonRow key={i} cols={cols} />
    ))}
  </>
);

// ─────────────────────────────────────────────────────────────────────────────
// SkeletonCard — catalogue / grid card placeholder
// Mirrors the .cat-card feel: thin border, 4px radius, image + text area
// ─────────────────────────────────────────────────────────────────────────────
export const SkeletonCard = ({ className = '' }) => {
  injectGlobalCss();
  return (
    <div
      className={className}
      aria-hidden="true"
      style={{
        background: 'white',
        border: '1px solid rgba(0,0,0,0.07)',
        borderRadius: 4,
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Image area */}
      <SkeletonBar width="100%" height={200} extra={{ borderRadius: 0 }} />

      {/* Text area */}
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SkeletonBar width="55%" height={9} />
        <SkeletonBar width="80%" height={8} />
        {/* Tag row — mimics pill badges */}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <SkeletonBar width={52} height={16} style={{ borderRadius: 2 }} />
          <SkeletonBar width={38} height={16} style={{ borderRadius: 2 }} />
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SkeletonStat — dashboard stat card placeholder
// Mirrors the .proc-card aesthetic: thin border, 4px radius
// ─────────────────────────────────────────────────────────────────────────────
export const SkeletonStat = () => {
  injectGlobalCss();
  return (
    <div
      aria-hidden="true"
      style={{
        background: 'white',
        border: '1px solid rgba(0,0,0,0.07)',
        borderRadius: 4,
        padding: '24px 22px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      <SkeletonBar width="45%" height={8} />
      <SkeletonBar width="30%" height={22} />
      <SkeletonBar width="60%" height={7} />
    </div>
  );
};

export default PageLoader;