/**
 * src/lib/taskStore.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Global store for long-running background work, shown in <TaskTray />.
 *
 * Two kinds of task share one list:
 *   • local  — work running in this tab (e.g. sending a video in chunks);
 *              the caller updates progress itself via updateTask()
 *   • job    — a server background job (202 Accepted + jobId); this store
 *              polls GET /api/v2/jobs?ids=… until it reaches a final state
 *
 * A local task can hand over to a server job (upload finished → OneDrive
 * job queued) with attachJob(), so the user sees one continuous row.
 *
 * Polling: one batched request for all active jobs, every 2s while things
 * are changing, backing off to 10s when nothing changes or the network is
 * failing, and stopping completely once no job is active. Active job ids
 * are kept in sessionStorage so a page refresh resumes tracking them.
 *
 * React: useTasks() subscribes via useSyncExternalStore — no extra deps.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useSyncExternalStore } from 'react';
import v2 from './apiV2';

const STORAGE_KEY = 'marqland_active_jobs';
const POLL_MIN_MS = 2000;
const POLL_MAX_MS = 10_000;
const FINAL = new Set(['completed', 'failed', 'cancelled']);

let tasks = [];                 // [{ id, kind, title, status, progress, message, error, jobId, createdAt, ... }]
const callbacks = new Map();    // taskId -> { onComplete, onFailed, retry }
const listeners = new Set();
let pollTimer = null;
let pollDelay = POLL_MIN_MS;
let polling = false;

const emit = () => { tasks = [...tasks]; listeners.forEach((l) => l()); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => tasks;

const persist = () => {
  try {
    const active = tasks.filter((t) => t.jobId && !FINAL.has(t.status)).map((t) => ({ id: t.id, jobId: t.jobId, title: t.title }));
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(active));
  } catch { /* storage unavailable — tracking just won't survive a refresh */ }
};

const find = (id) => tasks.find((t) => t.id === id);
const genId = () => `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** Status for display: queued | running | uploading | retrying | completed | failed | cancelled */
const fromJob = (job) => ({
  status: job.status === 'queued' && job.attempts > 0 ? 'retrying' : job.status,
  progress: job.progress?.percent ?? 0,
  message: job.progress?.message || '',
  error: job.status === 'failed' ? (job.error?.message || 'Task failed.') : '',
  result: job.result,
  job,
});

export const addLocalTask = ({ title, onComplete, onFailed, retry }) => {
  const id = genId();
  tasks = [{ id, kind: 'local', title, status: 'running', progress: 0, message: '', error: '', createdAt: Date.now() }, ...tasks];
  callbacks.set(id, { onComplete, onFailed, retry });
  emit();
  return id;
};

export const updateTask = (id, patch) => {
  const t = find(id);
  if (!t) return;
  Object.assign(t, patch);
  emit();
};

export const failTask = (id, error, { retry } = {}) => {
  const t = find(id);
  if (!t) return;
  Object.assign(t, { status: 'failed', error: error?.message || String(error || 'Failed.') });
  if (retry) callbacks.set(id, { ...(callbacks.get(id) || {}), retry });
  emit();
  callbacks.get(id)?.onFailed?.(t);
};

export const completeTask = (id, result) => {
  const t = find(id);
  if (!t) return;
  Object.assign(t, { status: 'completed', progress: 100, result });
  emit();
  callbacks.get(id)?.onComplete?.(result, t);
};

/** Track a server job (from a 202 response). Returns the task id. */
export const trackJob = (job, { title, onComplete, onFailed } = {}) => {
  const id = genId();
  tasks = [{ id, kind: 'job', title: title || job.title || 'Background task', jobId: job.id, createdAt: Date.now(), ...fromJob(job) }, ...tasks];
  callbacks.set(id, { onComplete, onFailed });
  emit();
  persist();
  schedule(0);
  return id;
};

/** A local task has handed its work to a server job. */
export const attachJob = (taskId, job) => {
  const t = find(taskId);
  if (!t) return;
  Object.assign(t, { kind: 'job', jobId: job.id, ...fromJob(job), message: job.progress?.message || 'Queued for processing…' });
  emit();
  persist();
  schedule(0);
};

export const dismissTask = (id) => {
  tasks = tasks.filter((t) => t.id !== id);
  callbacks.delete(id);
  emit();
  persist();
};

export const clearFinished = () => {
  tasks.filter((t) => FINAL.has(t.status)).forEach((t) => callbacks.delete(t.id));
  tasks = tasks.filter((t) => !FINAL.has(t.status));
  emit();
};

export const retryTask = async (id) => {
  const t = find(id);
  if (!t) return;
  const cb = callbacks.get(id);
  if (cb?.retry) {                     // local retry (e.g. resume a chunked upload)
    Object.assign(t, { status: 'running', error: '' });
    emit();
    return cb.retry(id);
  }
  if (!t.jobId) return;
  try {
    const { data } = await v2.post(`/v2/jobs/${t.jobId}/retry`);
    Object.assign(t, fromJob(data));
    emit();
    persist();
    schedule(0);
  } catch (err) {
    Object.assign(t, { error: err.message });
    emit();
  }
};

// ── Polling ─────────────────────────────────────────────────────────────────
const activeJobTasks = () => tasks.filter((t) => t.jobId && !FINAL.has(t.status));

function schedule(ms) {
  if (pollTimer) clearTimeout(pollTimer);
  if (!activeJobTasks().length) { pollTimer = null; return; }
  pollTimer = setTimeout(poll, ms);
}

async function poll() {
  pollTimer = null;
  const active = activeJobTasks();
  if (!active.length || polling) return;
  polling = true;
  let changed = false;
  try {
    const ids = [...new Set(active.map((t) => t.jobId))].join(',');
    const { data: jobs } = await v2.get('/v2/jobs', { params: { ids }, retries: 0, timeout: 8000 });
    const byId = new Map(jobs.map((j) => [j.id, j]));
    for (const t of active) {
      const job = byId.get(t.jobId);
      if (!job) continue;
      const next = fromJob(job);
      if (next.status !== t.status || next.progress !== t.progress || next.message !== t.message) changed = true;
      Object.assign(t, next);
      if (FINAL.has(next.status)) {
        const cb = callbacks.get(t.id);
        if (next.status === 'completed') cb?.onComplete?.(job.result, t);
        else cb?.onFailed?.(t);
      }
    }
    if (changed) emit();
    persist();
    pollDelay = changed ? POLL_MIN_MS : Math.min(POLL_MAX_MS, pollDelay * 1.5);
  } catch {
    // Network blip / server restart — keep the tasks, just poll less often.
    pollDelay = Math.min(POLL_MAX_MS, pollDelay * 2);
    active.forEach((t) => { t.message = 'Reconnecting…'; });
    emit();
  } finally {
    polling = false;
    schedule(pollDelay);
  }
}

/** Refresh-safe: pick up jobs that were still running when the page reloaded. */
export const resumePersistedJobs = () => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    const known = new Set(tasks.map((t) => t.jobId));
    saved.filter((s) => s.jobId && !known.has(s.jobId)).forEach((s) => {
      tasks = [{ id: s.id || genId(), kind: 'job', title: s.title, jobId: s.jobId, status: 'running', progress: 0, message: 'Checking status…', error: '', createdAt: Date.now() }, ...tasks];
    });
    if (saved.length) { emit(); schedule(0); }
  } catch { /* ignore */ }
};

// Poll immediately when the tab becomes visible again or the network returns.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { pollDelay = POLL_MIN_MS; schedule(0); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pollDelay = POLL_MIN_MS; schedule(0); } });
}

export const useTasks = () => useSyncExternalStore(subscribe, snapshot, snapshot);
export const isFinalStatus = (s) => FINAL.has(s);
