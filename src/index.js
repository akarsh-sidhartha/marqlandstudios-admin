/**
 * src/index.js
 * ─────────────────────────────────────────────────────────────────────────────
 * React entry point.
 * index.css must be imported here (Tailwind base styles live there).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { logger } from './utils/logger';

logger.info(`Marqland Admin — ${process.env.NODE_ENV} build starting`);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);