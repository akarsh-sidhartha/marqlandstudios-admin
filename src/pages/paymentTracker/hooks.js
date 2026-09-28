/**
 * paymentTracker/hooks.js — state logic shared by desktop and mobile.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import trackerApi, { friendlyError } from './trackerApi';
import { prepareFile } from './shared';
import { createLogger } from '../../utils/logger';

const log = createLogger('PaymentTracker');

/** Live (max-width: 768px) media query — updates on rotate / resize. */
export function useIsMobile(query = '(max-width: 768px)') {
  const get = () => typeof window !== 'undefined' && window.matchMedia(query).matches;
  const [isMobile, setIsMobile] = useState(get);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return isMobile;
}

const EMPTY = { pis: [], payments: [], invoices: [], vendors: [], financialYears: [] };

/**
 * The whole tracker in one request. `reload()` is called after every write;
 * a slower, older response can never overwrite a newer one.
 */
export function useTrackerData() {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const reload = useCallback(async ({ silent = false } = {}) => {
    const mine = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const next = await trackerApi.overview();
      if (mine !== seq.current) return;
      setData({ ...EMPTY, ...next });
      setError('');
      if (Object.values(next.truncated || {}).some(Boolean)) log.warn('Overview truncated by server cap', next.truncated);
    } catch (e) {
      if (mine !== seq.current) return;
      log.error('Failed to load payment tracker', e.message);
      setError(friendlyError(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

/**
 * Form state with "auto-filled" tracking. Values read from a document only
 * fill fields the user hasn't typed into, and stay highlighted until edited.
 */
export function useAutoForm(initial) {
  const initialRef = useRef(initial);
  const [form, setForm] = useState(initial);
  const [auto, setAuto] = useState({});
  const touched = useRef(new Set());

  const set = useCallback((k, v) => {
    touched.current.add(k);
    setForm((f) => ({ ...f, [k]: v }));
    setAuto((a) => { if (!a[k]) return a; const n = { ...a }; delete n[k]; return n; });
  }, []);

  /** Apply values read from a document; returns how many were used. */
  const fill = useCallback((values) => {
    const usable = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== null && v !== undefined && v !== '' && !touched.current.has(k)));
    setForm((f) => ({ ...f, ...usable }));
    setAuto((a) => ({ ...a, ...Object.fromEntries(Object.keys(usable).map((k) => [k, true])) }));
    return Object.keys(usable).length;
  }, []);

  /** Programmatic update that isn't a user edit (e.g. prefill from a PI). */
  const patch = useCallback((values, { highlight = true } = {}) => {
    setForm((f) => ({ ...f, ...values }));
    if (highlight) setAuto((a) => ({ ...a, ...Object.fromEntries(Object.keys(values).map((k) => [k, true])) }));
  }, []);

  const reset = useCallback(() => { touched.current = new Set(); setForm(initialRef.current); setAuto({}); }, []);

  return { form, set, fill, patch, auto, autoCount: Object.keys(auto).length, reset };
}

/**
 * Attach a document and read it with the backend's open-source extractor.
 * `onExtracted(result)` maps the result into the form and returns the number
 * of fields it filled.
 */
export function useDocumentScan(docType, onExtracted) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState({ result: null, msg: '' });
  const onExtractedRef = useRef(onExtracted);
  onExtractedRef.current = onExtracted;
  const run = useRef(0);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const attach = useCallback(async (raw) => {
    if (!raw) return;
    const mine = ++run.current;
    const prepared = await prepareFile(raw);
    setFile(prepared);
    setPreviewUrl(prepared.type.startsWith('image/') && prepared.type !== 'image/heic' ? URL.createObjectURL(prepared) : null);
    setScanning(true);
    setScan({ result: null, msg: '' });
    try {
      const result = await trackerApi.extract(prepared, docType);
      if (mine !== run.current) return;
      const n = onExtractedRef.current(result) || 0;
      setScan(n >= 4
        ? { result: 'success', msg: `${n} fields read from the document.` }
        : n > 0 ? { result: 'partial', msg: `${n} field${n > 1 ? 's' : ''} read — please fill in the rest.` }
          : { result: 'error', msg: 'Nothing could be read automatically — please fill in the fields.' });
    } catch (e) {
      if (mine !== run.current) return;
      log.warn('Document read failed', e.message);
      setScan({ result: 'error', msg: `Could not read the document: ${friendlyError(e)} The file is still attached.` });
    } finally {
      if (mine === run.current) setScanning(false);
    }
  }, [docType]);

  const clear = useCallback(() => {
    run.current++;
    setFile(null);
    setPreviewUrl(null);
    setScanning(false);
    setScan({ result: null, msg: '' });
  }, []);

  return { file, previewUrl, scanning, scanResult: scan.result, scanMsg: scan.msg, attach, clear };
}
