/**
 * src/hooks/useFetch.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generic data-fetching hook that wraps `api` with:
 *   • loading / error / data state
 *   • structured logging (debug on load, info on success, error on fail)
 *   • abort-on-unmount via AbortController
 *   • manual refetch trigger
 *
 * USAGE
 * ─────
 *   const { data, isLoading, error, refetch } = useFetch('/products');
 *
 *   // With transform:
 *   const { data: vendors } = useFetch('/vendors', {
 *     transform: (res) => res.data.vendors,
 *   });
 *
 *   // Conditionally (skip until id is ready):
 *   const { data } = useFetch(id ? `/orders/${id}` : null);
 *
 *   // With initial params:
 *   const { data } = useFetch('/products', { params: { page: 1, limit: 50 } });
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import { createLogger } from '../utils/logger';

const log = createLogger('useFetch');

/**
 * @param {string|null} url       - API path, e.g. '/products'. Pass null to skip.
 * @param {object}      options
 * @param {object}      [options.params]       - Query params forwarded to axios
 * @param {Function}    [options.transform]    - (axiosResponse) => desiredData
 * @param {any}         [options.initialData]  - Seed value before first fetch
 */
const useFetch = (url, { params, transform, initialData = null } = {}) => {
  const [data,      setData]      = useState(initialData);
  const [isLoading, setIsLoading] = useState(!!url);   // start true when url given
  const [error,     setError]     = useState(null);
  const [tick,      setTick]      = useState(0);        // increment to re-fetch

  // Stable serialisation of params so effect deps don't thrash
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!url) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    log.debug(`Fetching ${url}`, paramsRef.current);

    api
      .get(url, { params: paramsRef.current, signal: controller.signal })
      .then((response) => {
        const result = transform ? transform(response) : response.data;
        log.info(`Fetched ${url}`, { rows: Array.isArray(result) ? result.length : 1 });
        setData(result);
      })
      .catch((err) => {
        if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
          log.debug(`Fetch aborted: ${url}`);
          return; // unmount — don't update state
        }
        log.error(`Fetch error: ${url}`, err.message);
        setError(err?.response?.data?.message ?? err.message ?? 'Unknown error');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick]);

  return { data, isLoading, error, refetch };
};

export default useFetch;