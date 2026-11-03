import { fixParsedWebmDuration } from '@fix-webm-duration/fix';
import { WebmContainer, WebmFile } from '@fix-webm-duration/parser';

function vintLength(first: number): number {
  for (let length = 1; length <= 8; length++) if (first & 1 << (8 - length)) return length;
  return 0;
}
function unknownSizeAt(bytes: Uint8Array, start: number): boolean {
  const idLength = vintLength(bytes[start]); if (!idLength) return false;
  const sizeAt = start + idLength; const length = vintLength(bytes[sizeAt]);
  if (!length || sizeAt + length > bytes.length) return false;
  const mask = (1 << (8 - length)) - 1;
  if ((bytes[sizeAt] & mask) !== mask) return false;
  for (let index = 1; index < length; index++) if (bytes[sizeAt + index] !== 255) return false;
  return true;
}
function preserveUnknownSizeSections(container: WebmContainer) {
  for (const section of container.data || []) {
    if (!(section.data instanceof WebmContainer) && container.source && unknownSizeAt(container.source, section.data.start)) {
      // The parser deliberately treats Cluster as opaque bytes. Preserve its
      // unknown length as well: a finite wrapper around later unknown clusters
      // would produce a malformed hierarchy when recording emits many clusters.
      const preserved = new WebmContainer(section.data.name, true, section.data.start);
      preserved.source = section.data.source; section.data = preserved;
    } else if (section.data instanceof WebmContainer) preserveUnknownSizeSections(section.data);
  }
}

/** Read the actual EBML Duration field, respecting the container's time scale. */
export function webmContainerDurationMs(bytes: Uint8Array): number | undefined {
  const file = new WebmFile(bytes);
  const info = file.getSectionById(0x8538067)?.getSectionById(0x549a966);
  const duration = info?.getSectionById(0x489)?.getValue();
  const scale = info?.getSectionById(0xad7b1)?.getValue() ?? 1_000_000;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return undefined;
  return duration * scale / 1_000_000;
}

/** Write measured recorder elapsed time into the container, without re-encoding media. */
export async function finalizeWebmDuration(blob: Blob, recordedDurationMs: number): Promise<Blob> {
  if (!Number.isFinite(recordedDurationMs) || recordedDurationMs <= 0) throw new Error('The recording duration could not be measured. Render the sequence again.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (webmContainerDurationMs(bytes)) return blob;
  const parsed = new WebmFile(bytes);
  preserveUnknownSizeSections(parsed);
  const info = parsed.getSectionById(0x8538067)?.getSectionById(0x549a966);
  // The upstream fixer targets the millisecond scale used by MediaRecorder.
  // Reject an unexpected scale instead of changing packet timestamp semantics.
  if (info?.getSectionById(0xad7b1)?.getValue() !== 1_000_000) throw new Error('This browser produced an unsupported WebM time scale. Save the edit and render in another browser.');
  if (!fixParsedWebmDuration(parsed, recordedDurationMs, { logger: false })) throw new Error('The WebM duration metadata could not be finalized. Render the sequence again.');
  const result = parsed.toBlob(blob.type || 'video/webm');
  const actual = webmContainerDurationMs(new Uint8Array(await result.arrayBuffer()));
  if (!actual || Math.abs(actual - recordedDurationMs) > 1) throw new Error('The WebM container duration failed verification. The incomplete file was not saved.');
  return result;
}
