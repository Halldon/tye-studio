import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's built-in type stripping requires the source extension.
import { saveOrDownloadExport } from '../app/components/editors/editor-utils.ts';

test('a failed library save downloads the actual completed media and reports no persistence', async () => {
  const media = new Blob(['actual encoded media'], { type: 'video/webm' });
  let downloaded: Blob | undefined; let filename = '';
  const result = await saveOrDownloadExport(media, 'sequence.webm', async () => { throw new Error('Upload exceeds 20 MB.'); }, (blob: Blob, name: string) => { downloaded = blob; filename = name; });
  assert.equal(downloaded, media); assert.equal(filename, 'sequence.webm');
  assert.equal(await downloaded!.text(), 'actual encoded media');
  assert.deepEqual(result, { saved: false, saveError: 'Upload exceeds 20 MB.' });
});

test('successful library persistence does not create an extra download', async () => {
  const media = new Blob(['PNG'], { type: 'image/png' }); let saved: Blob | undefined;
  const result = await saveOrDownloadExport(media, 'edit.png', async (blob: Blob) => { saved = blob; }, () => assert.fail('An already-saved file should not be downloaded again'));
  assert.equal(saved, media); assert.deepEqual(result, { saved: true });
});

test('a download failure remains an error instead of claiming that media was delivered', async () => {
  await assert.rejects(() => saveOrDownloadExport(new Blob(['media']), 'edit.png', async () => { throw new Error('Network error'); }, () => { throw new Error('Download unavailable'); }), /Download unavailable/);
});
