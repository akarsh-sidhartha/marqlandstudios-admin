/**
 * src/components/TaskTray.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Non-intrusive tray (bottom-right) listing background work: video uploads,
 * OneDrive processing, image imports, Studio AI. Never blocks the page —
 * the user keeps working while tasks progress here.
 *
 * Per task: title, status chip (Uploading / Queued / Processing / Retrying /
 * Completed / Failed), progress bar, detail line, and Retry / Dismiss actions.
 * Collapses to a small pill; hides itself when there is nothing to show.
 *
 * Mount once near the app root. Data comes from src/lib/taskStore.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, RotateCcw, X, ChevronDown, ChevronUp, UploadCloud, Clock } from 'lucide-react';
import { useTasks, dismissTask, retryTask, clearFinished, resumePersistedJobs, isFinalStatus } from '../lib/taskStore';

const C = {
  navy: '#0e1520', gold: '#b8975a', text: 'rgba(255,255,255,0.88)', muted: 'rgba(255,255,255,0.45)',
  line: 'rgba(255,255,255,0.08)', green: '#7ec98a', red: '#e08585', amber: '#d4b06a',
};
const font = '"Jost", sans-serif';

const STATUS = {
  uploading: { label: 'Uploading', color: C.gold, Icon: UploadCloud },
  queued:    { label: 'Queued', color: C.muted, Icon: Clock },
  running:   { label: 'Processing', color: C.gold, Icon: Loader2, spin: true },
  retrying:  { label: 'Retrying', color: C.amber, Icon: RotateCcw },
  completed: { label: 'Completed', color: C.green, Icon: CheckCircle2 },
  failed:    { label: 'Failed', color: C.red, Icon: AlertCircle },
  cancelled: { label: 'Cancelled', color: C.muted, Icon: X },
};

const TaskRow = ({ task }) => {
  const s = STATUS[task.status] || STATUS.running;
  const final = isFinalStatus(task.status);
  return (
    <div style={{ padding: '12px 14px', borderTop: `1px solid ${C.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <s.Icon size={13} style={{ color: s.color, flexShrink: 0, animation: s.spin ? 'tt-spin 1s linear infinite' : 'none' }} />
        <span title={task.title} style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {task.title}
        </span>
        <span style={{ fontSize: 8, letterSpacing: '0.16em', textTransform: 'uppercase', color: s.color, border: `1px solid ${s.color}55`, padding: '2px 6px', borderRadius: 2, flexShrink: 0 }}>
          {s.label}
        </span>
      </div>

      {!final && (
        <div style={{ marginTop: 8, height: 3, background: C.line, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${Math.max(3, task.progress || 0)}%`, height: '100%', background: s.color, transition: 'width 0.4s ease' }} />
        </div>
      )}

      {(task.error || task.message) && (
        <p style={{ margin: '6px 0 0', fontSize: 10.5, lineHeight: 1.45, color: task.error ? C.red : C.muted }}>
          {task.error || task.message}
        </p>
      )}

      {(task.status === 'failed' || final) && (
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          {task.status === 'failed' && (
            <button onClick={() => retryTask(task.id)} style={btn(C.gold)}><RotateCcw size={10} /> Retry</button>
          )}
          <button onClick={() => dismissTask(task.id)} style={btn(C.muted)}>Dismiss</button>
        </div>
      )}
    </div>
  );
};

const btn = (color) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0,
  cursor: 'pointer', color, fontFamily: font, fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
});

const TaskTray = () => {
  const tasks = useTasks();
  const [open, setOpen] = useState(true);

  useEffect(() => { resumePersistedJobs(); }, []);

  // Pop open whenever a new task starts.
  const count = tasks.length;
  useEffect(() => { if (count) setOpen(true); }, [count]);

  if (!tasks.length) return null;
  const active = tasks.filter((t) => !isFinalStatus(t.status)).length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const finished = tasks.length - active;

  return (
    <div role="status" aria-live="polite" style={{
      position: 'fixed', right: 20, bottom: 20, zIndex: 900, width: 320, maxWidth: 'calc(100vw - 32px)',
      background: C.navy, border: `1px solid ${C.line}`, boxShadow: '0 12px 40px rgba(0,0,0,0.35)', fontFamily: font,
    }}>
      <style>{'@keyframes tt-spin { to { transform: rotate(360deg); } }'}</style>
      <button onClick={() => setOpen((o) => !o)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px',
        background: 'none', border: 'none', cursor: 'pointer', color: C.text, fontFamily: font,
      }}>
        {active ? <Loader2 size={13} style={{ color: C.gold, animation: 'tt-spin 1s linear infinite' }} />
          : failed ? <AlertCircle size={13} style={{ color: C.red }} /> : <CheckCircle2 size={13} style={{ color: C.green }} />}
        <span style={{ flex: 1, textAlign: 'left', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          {active ? `${active} task${active > 1 ? 's' : ''} in progress` : failed ? `${failed} task${failed > 1 ? 's' : ''} failed` : 'All tasks done'}
        </span>
        {open ? <ChevronDown size={14} style={{ color: C.muted }} /> : <ChevronUp size={14} style={{ color: C.muted }} />}
      </button>

      {open && (
        <>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {tasks.map((t) => <TaskRow key={t.id} task={t} />)}
          </div>
          {finished > 0 && (
            <div style={{ padding: '8px 14px', borderTop: `1px solid ${C.line}`, textAlign: 'right' }}>
              <button onClick={clearFinished} style={btn(C.muted)}>Clear finished</button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default TaskTray;
