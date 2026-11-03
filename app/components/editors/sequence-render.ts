import { clipAtTime, sequenceDuration, type EditorAsset, type SequenceDocument } from './editor-model';
import { loadImage } from './editor-utils';
import { finalizeWebmDuration } from './webm-duration';

export function webmSupport(): { supported: boolean; mimeType?: string; reason?: string } {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined' || typeof AudioContext === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return { supported: false, reason: 'This browser does not support canvas and audio recording. Save the edit document and render it in a compatible Chromium or Firefox browser.' };
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
  return mimeType ? { supported: true, mimeType } : { supported: false, reason: 'This browser cannot encode WebM. Use a browser with WebM MediaRecorder support, or save the edit document.' };
}

function mediaReady(element: HTMLMediaElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    element.crossOrigin = 'anonymous'; element.preload = 'auto';
    const done = () => { cleanup(); resolve(); };
    const error = () => { cleanup(); reject(new Error('A sequence source could not be loaded for rendering. Reimport a local copy and try again.')); };
    const cleanup = () => { clearTimeout(timer); element.removeEventListener('loadeddata', done); element.removeEventListener('error', error); };
    const timer = setTimeout(error, 20000);
    element.addEventListener('loadeddata', done); element.addEventListener('error', error); element.src = url; element.load();
  });
}
function seek(element: HTMLMediaElement, seconds: number): Promise<void> {
  if (Math.abs(element.currentTime - seconds) < .02) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { element.removeEventListener('seeked', done); reject(new Error('A media seek timed out. Check the source file.')); }, 12000);
    const done = () => { clearTimeout(timer); resolve(); };
    element.addEventListener('seeked', done, { once: true }); element.currentTime = seconds;
  });
}
export function drawContained(ctx: CanvasRenderingContext2D, image: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number) {
  const scale = Math.min(width / Math.max(1, sourceWidth), height / Math.max(1, sourceHeight));
  const w = sourceWidth * scale; const h = sourceHeight * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}
export function drawCaption(ctx: CanvasRenderingContext2D, text: string, width: number, height: number) {
  if (!text.trim()) return;
  const size = Math.max(18, Math.round(height / 22)); ctx.font = `600 ${size}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const words = text.trim().split(/\s+/); const lines: string[] = []; let line = '';
  for (const word of words) { const trial = line ? `${line} ${word}` : word; if (ctx.measureText(trial).width > width * .84 && line) { lines.push(line); line = word; } else line = trial; }
  if (line) lines.push(line);
  lines.slice(-4).forEach((value, index, all) => {
    const y = height - size * (all.length - index + .7); const measured = ctx.measureText(value).width;
    ctx.fillStyle = '#000000bb'; ctx.fillRect((width - measured) / 2 - size * .4, y - size * .65, measured + size * .8, size * 1.3);
    ctx.fillStyle = '#ffffff'; ctx.fillText(value, width / 2, y);
  });
}

/** Real-time native WebM rendering. Sources are never uploaded to a renderer. */
export async function renderSequenceWebM(doc: SequenceDocument, assets: EditorAsset[], progress: (percent: number) => void, signal?: AbortSignal): Promise<Blob> {
  const support = webmSupport(); if (!support.supported) throw new Error(support.reason);
  if (!doc.clips.length) throw new Error('Add at least one clip first.');
  const total = sequenceDuration(doc); if (total > 600) throw new Error('Browser renders are limited to ten minutes. Export the edit document for a longer sequence.');
  const canvas = document.createElement('canvas'); canvas.width = doc.width; canvas.height = doc.height;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas is unavailable.');
  const sources = new Map<string, HTMLImageElement | HTMLVideoElement>();
  const audioContext = new AudioContext(); const mix = audioContext.createMediaStreamDestination();
  const media: HTMLMediaElement[] = [];
  let stream: MediaStream | undefined; let recorder: MediaRecorder | undefined; let animation = 0;
  let backgroundAudio: HTMLAudioElement | undefined;
  try {
    await audioContext.resume();
    await Promise.all(doc.clips.map(async clip => {
      const asset = assets.find(item => item.id === clip.assetId); if (!asset) throw new Error(`Missing source for clip ${clip.id}. Relink or remove it before exporting.`);
      if (asset.type === 'image') sources.set(clip.id, await loadImage(asset.url));
      else if (asset.type === 'video') {
        const video = document.createElement('video'); video.playsInline = true; media.push(video);
        await mediaReady(video, asset.url); await seek(video, clampMediaTime(clip.in, video.duration));
        if (Number.isFinite(video.duration) && (clip.in >= video.duration || clip.out > video.duration + .05)) throw new Error(`“${asset.name}” is shorter than this shot's selected range. Set its out point to ${video.duration.toFixed(2)}s or less.`);
        const audio = audioContext.createMediaElementSource(video); const gain = audioContext.createGain(); gain.gain.value = clip.muted ? 0 : 1;
        audio.connect(gain).connect(mix); sources.set(clip.id, video);
      } else throw new Error('Audio assets belong on the audio track, not the video track.');
    }));
    if (doc.audio) {
      const asset = assets.find(item => item.id === doc.audio!.assetId);
      if (!asset) throw new Error('The audio track source is missing. Relink or remove it before exporting.');
      backgroundAudio = document.createElement('audio'); media.push(backgroundAudio);
      await mediaReady(backgroundAudio, asset.url);
      const source = audioContext.createMediaElementSource(backgroundAudio); const gain = audioContext.createGain(); gain.gain.value = doc.audio.volume;
      source.connect(gain).connect(mix);
    }
    if (signal?.aborted) throw new Error('Render cancelled.');
    // drawImage + getImageData rejects a tainted canvas before a long render starts.
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, doc.width, doc.height);
    for (const source of sources.values()) { ctx.drawImage(source, 0, 0, 1, 1); ctx.getImageData(0, 0, 1, 1); }
    stream = canvas.captureStream(doc.fps);
    mix.stream.getAudioTracks().forEach(track => stream!.addTrack(track));
    recorder = new MediaRecorder(stream, { mimeType: support.mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks: BlobPart[] = [];
    const finished = new Promise<Blob>((resolve, reject) => {
      recorder!.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder!.onstop = () => resolve(new Blob(chunks, { type: support.mimeType }));
      recorder!.onerror = () => reject(new Error('The browser encoder failed. Save the edit document and try a shorter sequence.'));
    });
    let currentId = ''; let audioStarted = false;
    const first = doc.clips[0]; const firstSource = sources.get(first.id);
    if (firstSource instanceof HTMLVideoElement) await firstSource.play();
    currentId = first.id;
    recorder.start(200);
    const start = performance.now();
    await new Promise<void>((resolve, reject) => {
      const frame = () => {
        try {
        if (signal?.aborted) { reject(new Error('Render cancelled.')); return; }
        const time = (performance.now() - start) / 1000;
        if (time >= total) { resolve(); return; }
        const at = clipAtTime(doc, time); if (!at) { resolve(); return; }
        const source = sources.get(at.clip.id)!;
        if (currentId !== at.clip.id) {
          const previous = sources.get(currentId); if (previous instanceof HTMLVideoElement) previous.pause();
          currentId = at.clip.id;
          if (source instanceof HTMLVideoElement) source.play().catch(reject);
        }
        if (backgroundAudio && doc.audio && !audioStarted && time >= doc.audio.offset) { audioStarted = true; backgroundAudio.play().catch(reject); }
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, doc.width, doc.height);
        drawContained(ctx, source, source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth, source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight, doc.width, doc.height);
        drawCaption(ctx, at.clip.caption, doc.width, doc.height); progress(Math.round(time / total * 100));
        animation = requestAnimationFrame(frame);
        } catch (error) { reject(error); }
      };
      frame();
    });
    const recordedDurationMs = performance.now() - start;
    recorder.stop(); const result = await finished;
    const finalized = await finalizeWebmDuration(result, recordedDurationMs); progress(100); return finalized;
  } catch (error) {
    if (recorder?.state === 'recording') recorder.stop();
    if (error instanceof DOMException && error.name === 'SecurityError') throw new Error('A source blocks canvas recording. Import a local copy into the library first.');
    throw error;
  } finally {
    cancelAnimationFrame(animation); media.forEach(element => { element.pause(); element.removeAttribute('src'); element.load(); });
    stream?.getTracks().forEach(track => track.stop()); mix.stream.getTracks().forEach(track => track.stop()); await audioContext.close();
  }
}
const clampMediaTime = (value: number, duration: number) => Math.max(0, Math.min(value, Number.isFinite(duration) ? Math.max(0, duration - .01) : value));
