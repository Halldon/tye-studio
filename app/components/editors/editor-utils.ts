import type { ImageDocument, EditorAsset, MaskStroke } from './editor-model';

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function jsonDownload(value: unknown, name: string) { downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), name); }
export async function saveOrDownloadExport(
  blob: Blob, name: string, save?: (blob: Blob, name: string) => void | Promise<void>,
  download: (blob: Blob, name: string) => void = downloadBlob,
): Promise<{ saved: boolean; saveError?: string }> {
  if (save) {
    try { await save(blob, name); return { saved: true }; }
    catch (error) { download(blob, name); return { saved: false, saveError: error instanceof Error ? error.message : 'The library could not save this file.' }; }
  }
  download(blob, name); return { saved: false };
}
export const canvasBlob = (canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> => new Promise((resolve, reject) => {
  try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The canvas could not be encoded.')), type); }
  catch { reject(new Error('This media does not allow canvas export. Import a local copy into the library first.')); }
});
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => resolve(img); img.onerror = () => reject(new Error('Image unavailable. Reimport the source file or check its access permissions.')); img.src = url; });
}
export async function imageWithDimensions(asset: EditorAsset, cache: Map<string, HTMLImageElement>): Promise<EditorAsset> {
  let image = cache.get(asset.url); if (!image) { image = await loadImage(asset.url); cache.set(asset.url, image); }
  return { ...asset, width: image.naturalWidth, height: image.naturalHeight };
}
export function mediaDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video'); video.preload = 'metadata';
    let settled = false; let tailSeek = false;
    const cleanup = () => { clearTimeout(timer); video.onloadedmetadata = null; video.ondurationchange = null; video.onseeked = null; video.ontimeupdate = null; video.onerror = null; video.removeAttribute('src'); video.load(); };
    const succeed = (duration: number) => { if (settled || !Number.isFinite(duration) || duration <= 0) return false; settled = true; cleanup(); resolve(duration); return true; };
    const fail = (message: string) => { if (settled) return; settled = true; cleanup(); reject(new Error(message)); };
    const timer = setTimeout(() => fail(tailSeek ? 'This video has no readable finite duration after a bounded tail seek. Re-encode it before adding it to a sequence.' : 'Reading video metadata timed out. Try reimporting the file.'), 15000);
    const readDuration = () => succeed(video.duration);
    video.onloadedmetadata = () => {
      if (readDuration()) return;
      // Legacy MediaRecorder WebM may omit Duration. Seeking past the tail lets
      // the browser scan the actual last packets instead of guessing a length.
      tailSeek = true; video.preload = 'auto';
      try { video.currentTime = 1e10; } catch { fail('This video does not expose a readable duration or seekable tail.'); }
    };
    video.ondurationchange = readDuration; video.ontimeupdate = readDuration;
    video.onseeked = () => {
      if (readDuration()) return;
      if (!tailSeek) return;
      const bufferedEnd = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
      const seekableEnd = video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0;
      if (!succeed(Number.isFinite(seekableEnd) && seekableEnd > 0 ? seekableEnd : bufferedEnd)) fail('The video tail could not be read. Reimport or re-encode the source.');
    };
    video.onerror = () => fail('Video metadata is unavailable. Reimport a playable video file.');
    video.src = url;
  });
}
export function drawMask(ctx: CanvasRenderingContext2D, strokes: MaskStroke[], color = '#ffffff') {
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    ctx.save(); ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = stroke.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const first = stroke.points[0];
    ctx.beginPath(); ctx.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(first.x, first.y); for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y); ctx.stroke(); ctx.restore();
  }
}
export async function renderImageDocument(canvas: HTMLCanvasElement, doc: ImageDocument, assets: EditorAsset[], cache?: Map<string, HTMLImageElement>) {
  canvas.width = doc.width; canvas.height = doc.height;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas is unavailable in this browser.');
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    ctx.save(); ctx.globalAlpha = layer.opacity;
    ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2); ctx.rotate(layer.rotation * Math.PI / 180);
    if (layer.kind === 'image') {
      const asset = assets.find(item => item.id === layer.assetId);
      if (!asset) { ctx.restore(); throw new Error(`Source image for “${layer.name}” is missing. Relink it in the library or remove the layer before exporting.`); }
      let img = cache?.get(asset.url);
      if (!img) { img = await loadImage(asset.url); cache?.set(asset.url, img); }
      ctx.drawImage(img, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
    } else {
      ctx.font = `600 ${layer.fontSize || 56}px sans-serif`; ctx.textBaseline = 'top'; ctx.fillStyle = layer.color || '#ffffff';
      (layer.text || '').split('\n').forEach((line, index) => ctx.fillText(line, -layer.width / 2, -layer.height / 2 + index * (layer.fontSize || 56) * 1.2, layer.width));
    }
    ctx.restore();
  }
}
