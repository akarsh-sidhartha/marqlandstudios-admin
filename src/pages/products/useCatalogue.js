/**
 * src/pages/products/useCatalogue.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Data layer for the product catalogue screen. Replaces "download every
 * product on page load" (which got slower with every product added) with:
 *
 *   1. GET /v2/products/categories  → category list + counts (tiny, one query)
 *   2. a category's products load only when that category is expanded,
 *      one page (24) at a time with "Load more"; its sort / price range
 *      are applied by the server
 *   3. any global filter (search, brand, sub-category, source, price) switches to a
 *      single server-side search across the catalogue, also paginated
 *
 * Requests are cancelled when superseded (typing in search, collapsing a
 * category) so stale responses never overwrite newer ones.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import v2 from '../../lib/apiV2';

const CATEGORY_PAGE = 24;
const SEARCH_PAGE = 48;
const SORT_MAP = { '': 'recent', asc: 'name-asc', desc: 'name-desc', 'price-asc': 'price-asc', 'price-desc': 'price-desc' };

const num = (v) => (v === '' || v === undefined || v === null ? undefined : Number(v));

export const isFilterMode = (f) =>
  Boolean(f.searchTerm.trim() || f.brand || f.subCategory || f.source || f.minPrice !== '' || f.maxPrice !== '');

const emptyBucket = { items: [], page: 0, total: 0, hasMore: false, loading: false, error: '' };

export default function useCatalogue({ filters, categorySort, categoryPriceFilter }) {
  const [summary, setSummary] = useState({ categories: [], brands: [], total: 0 });
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [buckets, setBuckets] = useState({});      // category -> bucket
  const [search, setSearch] = useState(emptyBucket);
  const controllers = useRef({});                   // category|'__search' -> AbortController
  const bucketsRef = useRef(buckets);
  bucketsRef.current = buckets;

  const filterMode = isFilterMode(filters);

  // ── 1. Category summary ──────────────────────────────────────────────────
  const loadSummary = useCallback(async () => {
    setSummaryError('');
    try {
      const { data } = await v2.get('/v2/products/categories');
      setSummary(data);
    } catch (err) {
      setSummaryError(err.message);
    } finally {
      setSummaryLoading(false);
    }
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const meta = useMemo(() => ({
    brands: summary.brands,
    categories: summary.categories.map((c) => c.category),
    subCategories: Object.fromEntries(summary.categories.map((c) => [c.category, c.subCategories.map((s) => s.name)])),
  }), [summary]);

  // ── 2. Per-category pages ────────────────────────────────────────────────
  const loadCategory = useCallback(async (category, { reset = false } = {}) => {
    const prev = bucketsRef.current[category] || emptyBucket;
    if (!reset && (prev.loading || (prev.page > 0 && !prev.hasMore))) return;
    const page = reset ? 1 : prev.page + 1;

    controllers.current[category]?.abort();
    const controller = new AbortController();
    controllers.current[category] = controller;
    setBuckets((b) => ({ ...b, [category]: { ...(reset ? emptyBucket : prev), loading: true, error: '' } }));

    const price = categoryPriceFilter[category] || {};
    try {
      const { data, meta: m } = await v2.get('/v2/products', {
        signal: controller.signal,
        params: {
          category, page, limit: CATEGORY_PAGE,
          sort: SORT_MAP[categorySort[category] || ''],
          minPrice: num(price.min), maxPrice: num(price.max),
        },
      });
      setBuckets((b) => {
        const base = page === 1 ? [] : (b[category]?.items || []);
        const seen = new Set(base.map((p) => p._id));
        return {
          ...b,
          [category]: { items: [...base, ...data.filter((p) => !seen.has(p._id))], page, total: m.total, hasMore: m.hasMore, loading: false, error: '' },
        };
      });
    } catch (err) {
      if (err.code === 'CANCELLED') return;
      setBuckets((b) => ({ ...b, [category]: { ...(b[category] || emptyBucket), loading: false, error: err.message } }));
    }
  }, [categorySort, categoryPriceFilter]);

  // Re-query a loaded category when its own sort / price range changes.
  const catFilterKey = JSON.stringify({ categorySort, categoryPriceFilter });
  const lastCatFilterKey = useRef(catFilterKey);
  useEffect(() => {
    if (lastCatFilterKey.current === catFilterKey) return undefined;
    const timer = setTimeout(() => {
      lastCatFilterKey.current = catFilterKey;
      Object.keys(bucketsRef.current).forEach((cat) => {
        if (bucketsRef.current[cat].page > 0) loadCategory(cat, { reset: true });
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [catFilterKey, loadCategory]);

  // ── 3. Global search mode ────────────────────────────────────────────────
  const searchParams = useMemo(() => ({
    search: filters.searchTerm.trim() || undefined,
    brand: filters.brand || undefined,
    category: filters.category || undefined,
    subCategory: filters.subCategory || undefined,
    minPrice: num(filters.minPrice),
    maxPrice: num(filters.maxPrice),
    source: filters.source || undefined,   // 'partner' | 'marqland'
    sort: 'name-asc',
  }), [filters]);

  const runSearch = useCallback(async (page) => {
    controllers.current.__search?.abort();
    const controller = new AbortController();
    controllers.current.__search = controller;
    setSearch((s) => ({ ...(page === 1 ? emptyBucket : s), loading: true, error: '' }));
    try {
      const { data, meta: m } = await v2.get('/v2/products', { signal: controller.signal, params: { ...searchParams, page, limit: SEARCH_PAGE } });
      setSearch((s) => ({ items: page === 1 ? data : [...s.items, ...data], page, total: m.total, hasMore: m.hasMore, loading: false, error: '' }));
    } catch (err) {
      if (err.code === 'CANCELLED') return;
      setSearch((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, [searchParams]);

  useEffect(() => {
    if (!filterMode) { controllers.current.__search?.abort(); setSearch(emptyBucket); return undefined; }
    const timer = setTimeout(() => runSearch(1), 350); // debounce typing
    return () => clearTimeout(timer);
  }, [filterMode, runSearch]);

  const loadMoreSearch = () => { if (!search.loading && search.hasMore) runSearch(search.page + 1); };

  // ── Cache maintenance after edits ────────────────────────────────────────
  /** Reload the summary and any listed categories (after a create/edit/delete). */
  const refresh = useCallback((categories = []) => {
    loadSummary();
    const cats = new Set(categories.filter(Boolean));
    Object.keys(bucketsRef.current).forEach((cat) => {
      if (!cats.size || cats.has(cat)) {
        if (bucketsRef.current[cat].page > 0) loadCategory(cat, { reset: true });
        else setBuckets((b) => { const n = { ...b }; delete n[cat]; return n; });
      }
    });
    if (filterMode) runSearch(1);
  }, [loadSummary, loadCategory, filterMode, runSearch]);

  /** Swap one product in place (e.g. its video finished processing). */
  const patchProduct = useCallback((product) => {
    const swap = (items) => items.map((p) => (p._id === product._id ? { ...p, ...product } : p));
    setBuckets((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, { ...v, items: swap(v.items) }])));
    setSearch((s) => ({ ...s, items: swap(s.items) }));
  }, []);

  const removeProduct = useCallback((id) => {
    const drop = (v) => ({ ...v, items: v.items.filter((p) => p._id !== id), total: Math.max(0, v.total - (v.items.some((p) => p._id === id) ? 1 : 0)) });
    setBuckets((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, drop(v)])));
    setSearch((s) => drop(s));
    loadSummary();
  }, [loadSummary]);

  useEffect(() => () => Object.values(controllers.current).forEach((c) => c.abort()), []);

  return {
    summary, summaryLoading, summaryError, meta, buckets, loadCategory, filterMode,
    search, loadMoreSearch, refresh, patchProduct, removeProduct, reloadSummary: loadSummary,
  };
}
