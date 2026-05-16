/**
 * src/utils/logger.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight structured logger.
 *
 * In production (NODE_ENV=production) debug/info calls are silenced.
 * All output is a timestamped, namespaced prefix so it's trivially grep-able
 * in DevTools or a log-drain.
 *
 * USAGE:
 *   import { createLogger } from '../utils/logger';
 *   const log = createLogger('ProductList');
 *   log.debug('fetching page', { page, limit });
 *   log.info('products loaded', { count: data.length });
 *   log.warn('cache miss');
 *   log.error('fetch failed', err);
 * ─────────────────────────────────────────────────────────────────────────────
 */

const IS_PROD = process.env.NODE_ENV === 'production';

const LEVELS = {
  debug: { method: 'debug', color: '#8b8b8b', silent: IS_PROD },
  info:  { method: 'info',  color: '#4f46e5', silent: IS_PROD },
  warn:  { method: 'warn',  color: '#d97706', silent: false   },
  error: { method: 'error', color: '#dc2626', silent: false   },
};

const timestamp = () => new Date().toISOString().slice(11, 23); // HH:mm:ss.mmm

/**
 * Creates a namespaced logger instance.
 * @param {string} namespace  - component / module name
 */
export const createLogger = (namespace) => {
  const log = (level, message, ...args) => {
    const { method, color, silent } = LEVELS[level];
    if (silent) return;

    const prefix = `%c[${timestamp()}] [${namespace}]`;
    const style  = `color:${color};font-weight:bold;`;

    if (args.length === 0) {
      console[method](prefix, style, message);
    } else {
      console[method](prefix, style, message, ...args);
    }
  };

  return {
    debug: (msg, ...a) => log('debug', msg, ...a),
    info:  (msg, ...a) => log('info',  msg, ...a),
    warn:  (msg, ...a) => log('warn',  msg, ...a),
    error: (msg, ...a) => log('error', msg, ...a),
  };
};

/** Module-level logger for one-off use */
export const logger = createLogger('App');