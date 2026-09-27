/**
 * src/lib/chunkedUpload.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends a large file (product video, up to 500 MB) to the API in small
 * resumable chunks, then asks the server to process it in the background.
 *
 *   startVideoUpload({ file, purpose, targetId, title, onDone })
 *
 * Runs entirely in the background task tray — the caller never awaits it,
 * so the form closes immediately and the user keeps working. Progress:
 *   0–100%  "Uploading"   bytes sent from this browser
 *   then    job progress  server → OneDrive (tracked by taskStore polling)
 *
 * Resilience: every chunk is a short request (timeout 60s) retried with
 * exponential backoff; if the server reports a different offset (a chunk
 * landed but its response was lost) the upload resyncs and continues. A
 * failed upload can be resumed from the tray's Retry button — it picks up
 * from the bytes the server already has instead of starting over.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import v2, { newIdempotencyKey } from './apiV2';
import { addLocalTask, updateTask, failTask, attachJob } from './taskStore';

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-m4v,video/mpeg,video/3gpp';

const CHUNK_TIMEOUT_MS = 60_000;
const MB = 1024 * 1024;

const mimeFor = (file) => {
  if (file.type) return file.type;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v', mpeg: 'video/mpeg', mpg: 'video/mpeg', '3gp': 'video/3gpp' }[ext] || 'video/mp4';
};

export const validateVideoFile = (file) => {
  if (!file) return 'Please choose a video file.';
  if (file.size > MAX_VIDEO_BYTES) return `That video is ${(file.size / MB).toFixed(0)} MB — the limit is 500 MB.`;
  if (!/^video\//.test(mimeFor(file))) return 'Please choose a video file (MP4, MOV, WEBM…).';
  return '';
};

const sendChunks = async (taskId, file, session) => {
  let offset = session.receivedBytes || 0;
  const chunkSize = session.chunkSize || 4 * MB;
  while (offset < file.size) {
    const end = Math.min(file.size, offset + chunkSize);
    const chunk = file.slice(offset, end);
    try {
      const { data } = await v2.put(`/v2/uploads/${session.uploadId}/chunks`, chunk, {
        params: { offset },
        headers: { 'Content-Type': 'application/octet-stream' },
        timeout: CHUNK_TIMEOUT_MS,
        retries: 4, // PUT at a fixed offset is naturally idempotent
      });
      offset = data.receivedBytes;
    } catch (err) {
      // Offset mismatch — the server tells us where it actually is.
      const serverOffset = err.details?.receivedBytes;
      if (err.status === 409 && Number.isFinite(serverOffset)) { offset = serverOffset; continue; }
      throw err;
    }
    updateTask(taskId, {
      status: 'uploading',
      progress: Math.round((offset / file.size) * 100),
      message: `${(offset / MB).toFixed(1)} / ${(file.size / MB).toFixed(1)} MB`,
    });
  }
};

/**
 * Fire-and-forget. Returns the tray task id.
 * @param {object} p
 * @param {File}   p.file
 * @param {'product-video'|'supplier-product-video'} p.purpose
 * @param {string} p.targetId      product / submission id
 * @param {string} p.title         tray label
 * @param {func}   [p.onDone]      called when the server job completes
 */
export const startVideoUpload = ({ file, purpose, targetId, title, onDone }) => {
  let session = null;
  const completeKey = newIdempotencyKey();

  const run = async (taskId) => {
    try {
      if (session) {
        // Resume: ask how much the server already holds.
        const { data } = await v2.get(`/v2/uploads/${session.uploadId}`);
        session = data;
      } else {
        const { data } = await v2.post('/v2/uploads', {
          purpose, targetId, fileName: file.name, mimeType: mimeFor(file), totalBytes: file.size,
        });
        session = data;
      }
      if (session.status === 'uploading') {
        await sendChunks(taskId, file, session);
        updateTask(taskId, { message: 'Finishing upload…', progress: 100 });
      }
      const { data } = await v2.post(`/v2/uploads/${session.uploadId}/complete`, null, { idempotencyKey: completeKey });
      attachJob(taskId, data.job);
    } catch (err) {
      if (err.status === 410 || err.status === 404) session = null; // expired — restart from scratch on retry
      failTask(taskId, err, { retry: run });
    }
  };

  const taskId = addLocalTask({ title, onComplete: onDone, retry: run });
  updateTask(taskId, { status: 'uploading', message: 'Starting upload…' });
  run(taskId);
  return taskId;
};
