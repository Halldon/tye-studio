import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's built-in type stripping requires the source extension.
import { finalizeWebmDuration, webmContainerDurationMs } from '../app/components/editors/webm-duration.ts';

const element = (id: number[], data: number[]) => [...id, 0x80 | data.length, ...data];
function minimalWebm(scale = [0x0f, 0x42, 0x40]) {
  const info = element([0x15, 0x49, 0xa9, 0x66], element([0x2a, 0xd7, 0xb1], scale));
  const cluster = element([0x1f, 0x43, 0xb6, 0x75], [...element([0xe7], [0]), ...element([0xa3], [0x81, 0, 0, 0x80, 0x11, 0x22])]);
  return new Uint8Array(element([0x18, 0x53, 0x80, 0x67], [...info, ...cluster]));
}

test('WebM finalization writes a real container Duration field without changing block payload bytes', async () => {
  const original = minimalWebm();
  assert.equal(webmContainerDurationMs(original), undefined);
  const fixed = await finalizeWebmDuration(new Blob([original], { type: 'video/webm' }), 1548);
  const bytes = new Uint8Array(await fixed.arrayBuffer());
  assert.equal(webmContainerDurationMs(bytes), 1548);
  assert.deepEqual(bytes.slice(-6), original.slice(-6));
  assert.ok(bytes.byteLength > original.byteLength);
  assert.equal(fixed.type, 'video/webm');
});

test('an existing finite WebM Duration is preserved instead of overwritten with a guess', async () => {
  const first = await finalizeWebmDuration(new Blob([minimalWebm()], { type: 'video/webm' }), 1234.5);
  const next = await finalizeWebmDuration(first, 9999);
  assert.equal(next, first); assert.equal(webmContainerDurationMs(new Uint8Array(await next.arrayBuffer())), 1234.5);
});

test('WebM finalization rejects missing clock measurements and unexpected timestamp scales', async () => {
  await assert.rejects(() => finalizeWebmDuration(new Blob([minimalWebm()]), 0), /could not be measured/);
  await assert.rejects(() => finalizeWebmDuration(new Blob([minimalWebm([1])]), 1000), /unsupported WebM time scale/);
});

test('unknown-size MediaRecorder clusters keep their original hierarchy and payload', async () => {
  const info = element([0x15, 0x49, 0xa9, 0x66], element([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]));
  const unknown = [1, 255, 255, 255, 255, 255, 255, 255];
  const cluster = [0x1f, 0x43, 0xb6, 0x75, ...unknown, ...element([0xe7], [0]), ...element([0xa3], [0x81, 0, 0, 0x80, 0x11, 0x22])];
  const source = new Uint8Array([0x18, 0x53, 0x80, 0x67, ...unknown, ...info, ...cluster, ...cluster]);
  const result = new Uint8Array(await (await finalizeWebmDuration(new Blob([source]), 1500)).arrayBuffer());
  assert.equal(webmContainerDurationMs(result), 1500);
  assert.deepEqual(result.slice(-cluster.length * 2), source.slice(-cluster.length * 2), 'Both original unknown-size cluster headers and payload must remain unchanged');
});
