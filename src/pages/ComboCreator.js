/**
 * src/admin/ComboCreator.jsx
 *
 * Admin panel for generating Dynamic Combos.
 * Mount this inside the admin Product section or as a standalone route.
 *
 * Features:
 *   - Budget input with live tolerance preview
 *   - Category + subcategory filter chips (populated from /api/products)
 *   - POST /api/combos/generate → shows result list
 *   - Existing combos fetched from GET /api/combos with delete support
 *
 * Usage:
 *   import ComboCreator from './admin/ComboCreator';
 *   // Inside your admin router / tab:
 *   <ComboCreator />
 */

import React, { useState, useEffect } from 'react';
import api from '../api';   // your existing axios instance
import {
  RefreshCw, Trash2, Plus, Loader2, X, Search,
} from 'lucide-react';

const INR = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;

function budgetToleranceLabel(B) {
  const n = Number(B);
  if (!n || n <= 0) return null;
  if (n <= 500)  return `${INR(Math.round(n * 0.9))} – ${INR(Math.round(n * 1.1))}  (±10%)`;
  if (n <= 1000) return `${INR(Math.round(n * 0.9))} – ${INR(n)}  (−10% to 0%)`;
  if (n <= 5000) return `${INR(n - 500)} – ${INR(n + 500)}  (±₹500)`;
  return `${INR(n - 1000)} – ${INR(n + 1000)}  (±₹1,000)`;
}

export default function ComboCreator() {
  // ── Generate form ──────────────────────────────────────────────────────────
  const [budget, setBudget]        = useState('');
  const [selCats, setSelCats]      = useState([]);
  const [selSubCats, setSelSubCats]= useState([]);
  const [maxResults, setMaxResults]= useState(20);
  const [generating, setGenerating]= useState(false);
  const [genError, setGenError]    = useState('');
  const [genResults, setGenResults]= useState([]);   // freshly generated this session

  // ── Catalog ────────────────────────────────────────────────────────────────
  const [allCats, setAllCats]         = useState([]);
  const [allSubCats, setAllSubCats]   = useState([]);

  // ── Saved combos list ──────────────────────────────────────────────────────
  const [savedCombos, setSavedCombos] = useState([]);
  const [combosLoading, setCombosLoading] = useState(false);
  const [comboSearch, setComboSearch] = useState('');
  const [deletingId, setDeletingId]   = useState(null);

  // ── Load categories and saved combos on mount ──────────────────────────────
  useEffect(() => {
    loadCatalog();
    loadSavedCombos();
  }, []);

  const loadCatalog = async () => {
    try {
      const res = await api.get('/products');
      const products = Array.isArray(res.data) ? res.data : [];
      setAllCats([...new Set(products.map(p => p.category).filter(Boolean))].sort());
      setAllSubCats([...new Set(products.map(p => p.subCategory).filter(Boolean))].sort());
    } catch (e) { console.error('load catalog failed', e); }
  };

  const loadSavedCombos = async () => {
    setCombosLoading(true);
    try {
      const res = await api.get('/combos');
      setSavedCombos(Array.isArray(res.data) ? res.data : []);
    } catch (e) { console.error('load combos failed', e); }
    finally { setCombosLoading(false); }
  };

  // ── Generate ───────────────────────────────────────────────────────────────
  const generate = async () => {
    const B = Number(budget);
    if (!B || B <= 0) { setGenError('Enter a valid budget greater than 0'); return; }
    setGenerating(true); setGenError(''); setGenResults([]);
    try {
      const res = await api.post('/combos/generate', {
        budget:        B,
        categories:    selCats,
        subCategories: selSubCats,
        maxResults,
      });
      const combos = res.data.combos || [];
      setGenResults(combos);
      if (!combos.length) setGenError('No combinations found within the budget tolerance. Try adjusting the budget, categories, or subcategory selection.');
      // Merge into saved list
      setSavedCombos(prev => [...combos, ...prev]);
    } catch (e) {
      setGenError(e.response?.data?.message || e.message);
    } finally { setGenerating(false); }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const deleteCombo = async (id) => {
    setDeletingId(id);
    try {
      await api.delete(`/combos/${id}`);
      setSavedCombos(prev => prev.filter(c => c._id !== id));
      setGenResults(prev => prev.filter(c => c._id !== id));
    } catch (e) { console.error('delete combo failed', e); }
    finally { setDeletingId(null); }
  };

  // ── Toggle helpers ─────────────────────────────────────────────────────────
  const toggleCat = (cat) => setSelCats(p => p.includes(cat) ? p.filter(c => c !== cat) : [...p, cat]);
  const toggleSub = (sc)  => setSelSubCats(p => p.includes(sc) ? p.filter(s => s !== sc) : [...p, sc]);

  // ── Filtered saved list ────────────────────────────────────────────────────
  const filteredSaved = savedCombos.filter(c => {
    if (!comboSearch.trim()) return true;
    const q = comboSearch.toLowerCase();
    return (c.label || '').toLowerCase().includes(q)
      || (c.categories || []).some(cat => cat.toLowerCase().includes(q))
      || String(c.totalPrice).includes(q)
      || (c.subCategories || []).some(sc => sc.toLowerCase().includes(q));
  });

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">

      {/* ── Page header ── */}
      <div>
        <h1 className="text-2xl font-light text-slate-900" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif' }}>
          Dynamic Combo Creator
        </h1>
        <p className="text-xs text-slate-400 mt-1 font-medium">
          Generated combos are hidden from the product list and only appear in the client portal Combo tab.
        </p>
      </div>

      {/* ── Generator form ── */}
      <div className="bg-white border border-slate-100 rounded-2xl p-5 space-y-5">
        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Generate Combos</div>

        {/* Budget */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Target Budget (₹)</label>
          <div className="flex items-center gap-3">
            <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden focus-within:border-indigo-400 transition-colors">
              <span className="px-3 py-2.5 text-sm font-bold text-slate-400 border-r border-slate-200 bg-slate-50">₹</span>
              <input
                type="number" min="0" value={budget}
                onChange={e => { setBudget(e.target.value); setGenError(''); }}
                placeholder="e.g. 1000"
                className="px-3 py-2.5 text-sm font-bold text-slate-800 outline-none w-40 bg-transparent"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400">Max results</span>
              <input
                type="number" min="1" max="50" value={maxResults}
                onChange={e => setMaxResults(Number(e.target.value) || 20)}
                className="w-14 text-center border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400 transition-colors"
              />
            </div>
          </div>
          {budgetToleranceLabel(budget) && (
            <div className="text-[11px] text-amber-600 font-bold">
              Tolerance range: {budgetToleranceLabel(budget)}
            </div>
          )}
        </div>

        {/* Categories */}
        {allCats.length > 0 && (
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              Categories <span className="font-normal normal-case tracking-normal text-slate-300">— leave blank to include all</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {allCats.map(cat => {
                const active = selCats.includes(cat);
                return (
                  <button key={cat} onClick={() => toggleCat(cat)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all border ${
                      active
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                    }`}>
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Subcategories */}
        {allSubCats.length > 0 && (
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              Subcategories <span className="font-normal normal-case tracking-normal text-slate-300">— one product per subcat in each combo</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {allSubCats.map(sc => {
                const active = selSubCats.includes(sc);
                return (
                  <button key={sc} onClick={() => toggleSub(sc)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all border ${
                      active
                        ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                        : 'bg-slate-50 text-slate-400 border-slate-200 hover:border-indigo-200 hover:text-indigo-500'
                    }`}>
                    {sc}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Error */}
        {genError && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-medium">
            <X size={13} className="shrink-0 mt-0.5" /> {genError}
          </div>
        )}

        {/* Generate button */}
        <button
          onClick={generate} disabled={generating || !budget}
          className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-black uppercase tracking-widest rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {generating
            ? <><Loader2 size={13} className="animate-spin" /> Generating…</>
            : <><Plus size={13} /> Generate Combos</>
          }
        </button>

        {/* Fresh results */}
        {genResults.length > 0 && (
          <div className="pt-3 border-t border-slate-100 space-y-2">
            <div className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
              ✓ {genResults.length} combo{genResults.length !== 1 ? 's' : ''} generated and saved
            </div>
            {genResults.map(c => (
              <ComboRow key={c._id} combo={c} deletingId={deletingId} onDelete={deleteCombo} fresh />
            ))}
          </div>
        )}
      </div>

      {/* ── Saved combos list ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
            All saved combos ({savedCombos.length})
          </div>
          <button onClick={loadSavedCombos} disabled={combosLoading}
            className="flex items-center gap-1 text-[10px] text-indigo-500 hover:text-indigo-700 font-bold disabled:opacity-40">
            <RefreshCw size={10} className={combosLoading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 focus-within:border-indigo-300 transition-colors">
          <Search size={12} className="text-slate-400 shrink-0" />
          <input
            value={comboSearch} onChange={e => setComboSearch(e.target.value)}
            placeholder="Filter by label, category, price…"
            className="flex-1 bg-transparent text-xs outline-none text-slate-700 placeholder:text-slate-300"
          />
          {comboSearch && (
            <button onClick={() => setComboSearch('')} className="text-slate-300 hover:text-slate-500"><X size={11} /></button>
          )}
        </div>

        {combosLoading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm font-bold">Loading…</span>
          </div>
        ) : filteredSaved.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-3xl mb-3">✦</div>
            <p className="text-sm font-bold text-slate-400">
              {savedCombos.length === 0 ? 'No combos yet — use the generator above.' : 'No results match your search.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSaved.map(c => (
              <ComboRow key={c._id} combo={c} deletingId={deletingId} onDelete={deleteCombo} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ComboRow — shared card for both generated result and saved list ─────────
function ComboRow({ combo, deletingId, onDelete, fresh = false }) {
  return (
    <div className={`flex gap-3 items-center p-3 rounded-xl border transition-colors ${
      fresh ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-slate-100 hover:border-slate-200'
    }`}>
      {/* Product thumbnails */}
      <div className="flex gap-1 shrink-0">
        {(combo.items || []).slice(0, 4).map((item, i) => (
          <div key={i} className="w-10 h-10 rounded-lg bg-slate-200 overflow-hidden">
            {item.imageUrl && <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />}
          </div>
        ))}
        {(combo.items || []).length > 4 && (
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-400">
            +{combo.items.length - 4}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm text-slate-800 truncate">
          {combo.label || `${INR(combo.totalPrice)} Bundle`}
        </div>
        <div className="text-[10px] text-slate-400 mt-0.5">
          {(combo.items || []).length} items · {INR(combo.totalPrice)} · target {INR(combo.budget)}
        </div>
        {(combo.items || []).length > 0 && (
          <div className="flex gap-1 flex-wrap mt-1">
            {(combo.items || []).map((item, i) => (
              <span key={i} className="text-[8px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded truncate max-w-[80px]">
                {item.subCategory || item.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Created date */}
      <div className="text-[9px] text-slate-300 shrink-0 hidden sm:block">
        {combo.createdAt ? new Date(combo.createdAt).toLocaleDateString('en-IN') : ''}
      </div>

      {/* Delete */}
      <button
        onClick={() => onDelete(combo._id)}
        disabled={deletingId === combo._id}
        className="p-1.5 text-slate-300 hover:text-red-500 transition-colors shrink-0 disabled:opacity-40"
        title="Delete combo"
      >
        {deletingId === combo._id
          ? <Loader2 size={13} className="animate-spin text-slate-400" />
          : <Trash2 size={13} />
        }
      </button>
    </div>
  );
}
