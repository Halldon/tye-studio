'use client';
/* eslint-disable @next/next/no-img-element -- These are original local or blob project media URLs. */

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, AudioLines, Captions, Film, ImagePlus, Pause, Play, Plus, Redo2, Scissors, Trash2, Undo2, Volume2, VolumeX, X } from 'lucide-react';
import { blankSequenceDocument, clamp, clipAtTime, clipDuration, editorId, moveSequenceClip, sequenceDuration, splitSequenceClip, timecode, type EditorAsset, type SequenceClip, type SequenceDocument } from './editor-model';
import { jsonDownload, mediaDuration, saveOrDownloadExport } from './editor-utils';
import { drawCaption, renderSequenceWebM, webmSupport } from './sequence-render';
import { useDocumentHistory } from './use-document-history';
import './editors.css';

export interface SequenceEditorProps {
  assets: EditorAsset[]; document?: SequenceDocument; onChange?: (document: SequenceDocument) => void;
  onExport?: (blob: Blob, name: string) => void | Promise<void>; onImport?: () => void;
}
export function SequenceEditor({ assets, document: external, onChange, onExport, onImport }: SequenceEditorProps) {
  const history = useDocumentHistory(blankSequenceDocument, external, onChange); const doc = history.value;
  const [selected, setSelected] = useState<string | null>(null); const [time, setTime] = useState(0); const [playing, setPlaying] = useState(false);
  const [picker, setPicker] = useState<'clips' | 'audio' | null>(null); const [error, setError] = useState('');
  const [loadingAsset, setLoadingAsset] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false); const [progress, setProgress] = useState(0);
  const [support, setSupport] = useState<ReturnType<typeof webmSupport>>({ supported: false, reason: 'Checking browser encoder…' });
  const videoRef = useRef<HTMLVideoElement>(null); const audioRef = useRef<HTMLAudioElement>(null); const abortRef = useRef<AbortController | null>(null);
  const captionRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  const duration = sequenceDuration(doc); const at = clipAtTime(doc, time);
  const activeClipId = at?.clip.id; const sourceTime = at ? at.clip.in + at.localTime : 0; const sourceMuted = at?.clip.muted ?? false;
  const currentAsset = assets.find(asset => asset.id === at?.clip.assetId);
  const selectedClip = doc.clips.find(clip => clip.id === selected) || at?.clip;
  const selectedAsset = assets.find(asset => asset.id === selectedClip?.assetId);
  const audioAsset = assets.find(asset => asset.id === doc.audio?.assetId);
  const clipAssets = assets.filter(asset => asset.type === 'image' || asset.type === 'video');

  useEffect(() => { queueMicrotask(() => setSupport(webmSupport())); return () => abortRef.current?.abort(); }, []);
  useEffect(() => { timeRef.current = time; }, [time]);
  const currentCaption = at?.clip.caption || '';
  useEffect(() => {
    const canvas = captionRef.current; const context = canvas?.getContext('2d'); if (!canvas || !context) return;
    context.clearRect(0, 0, doc.width, doc.height); drawCaption(context, currentCaption, doc.width, doc.height);
  }, [currentCaption, doc.width, doc.height]);
  useEffect(() => {
    if (!playing || !duration) return;
    let frame = 0; let previous = performance.now();
    const tick = (now: number) => {
      const next = timeRef.current + Math.min((now - previous) / 1000, .1); previous = now;
      if (next >= duration) { setTime(0); timeRef.current = 0; setPlaying(false); return; }
      timeRef.current = next; setTime(next); frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing, duration]);
  useEffect(() => {
    const video = videoRef.current; if (!video) return;
    video.muted = sourceMuted;
    if (playing) video.play().catch(() => { setPlaying(false); setError('Playback could not start. Select Play again or check this source.'); }); else video.pause();
    return () => video.pause();
  }, [activeClipId, playing, sourceMuted]);
  useEffect(() => {
    const video = videoRef.current; if (!video) return;
    if (Number.isFinite(video.duration) && Math.abs(video.currentTime - sourceTime) > .3) video.currentTime = Math.min(sourceTime, Math.max(0, video.duration - .01));
  }, [sourceTime]);
  useEffect(() => {
    const audio = audioRef.current; if (!audio || !doc.audio) return;
    const local = time - doc.audio.offset; audio.volume = doc.audio.volume;
    if (local < 0 || Number.isFinite(audio.duration) && local >= audio.duration) { audio.pause(); return; }
    if (Math.abs(audio.currentTime - local) > .3) audio.currentTime = Math.max(0, local);
    if (playing) audio.play().catch(() => setError('Audio playback could not start. Check the audio source.')); else audio.pause();
  }, [playing, time, doc.audio]);

  async function addClip(asset: EditorAsset) {
    if (loadingAsset) return;
    setLoadingAsset(asset.id);
    try {
      const sourceDuration = asset.type === 'video' ? asset.duration || await mediaDuration(asset.url) : 4;
      const clip: SequenceClip = { id: editorId('clip'), assetId: asset.id, in: 0, out: Math.max(.1, sourceDuration), caption: '', muted: false };
      history.apply({ ...doc, clips: [...doc.clips, clip] }); setSelected(clip.id); setTime(duration); setPlaying(false); setPicker(null); setError('');
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Could not read the media.'); }
    finally { setLoadingAsset(null); }
  }
  function patchClip(values: Partial<SequenceClip>) { if (selectedClip) history.apply({ ...doc, clips: doc.clips.map(clip => clip.id === selectedClip.id ? { ...clip, ...values } : clip) }); }
  function chooseClip(clip: SequenceClip) { const index = doc.clips.findIndex(item => item.id === clip.id); setSelected(clip.id); setTime(doc.clips.slice(0, index).reduce((sum, item) => sum + clipDuration(item), 0)); setPlaying(false); }
  async function render() {
    if (!support.supported || rendering) return;
    setPlaying(false); setRendering(true); setError(''); setProgress(0); abortRef.current = new AbortController();
    try {
      const blob = await renderSequenceWebM(doc, assets, setProgress, abortRef.current.signal); const name = `tye-sequence-${Date.now()}.webm`;
      const result = await saveOrDownloadExport(blob, name, onExport);
      setError(result.saveError ? `WebM downloaded; library save failed: ${result.saveError}` : result.saved ? 'WebM saved to your library.' : 'WebM downloaded.');
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Render failed.'); } finally { setRendering(false); abortRef.current = null; }
  }
  function exportEdit() {
    jsonDownload({ format: 'tye-sequence', version: 1, document: doc, assets: assets.filter(asset => doc.clips.some(clip => clip.assetId === asset.id) || doc.audio?.assetId === asset.id).map(asset => ({ ...asset, note: 'Relink this source if its URL is unavailable on another installation.' })) }, 'tye-sequence-edit.json');
    setError('Edit JSON downloaded with source references.');
  }
  const splitAvailable = selectedClip && at?.clip.id === selectedClip.id && at.localTime >= .1 && at.localTime <= clipDuration(selectedClip) - .1;

  return <section className="ed-workspace" aria-label="Sequence editor">
    <div className="ed-topbar"><div className="ed-heading"><strong>Sequence</strong><span className="ed-count">{doc.clips.length} {doc.clips.length === 1 ? "shot" : "shots"}</span></div><div className="ed-actions"><button onClick={history.undo} disabled={!history.canUndo} aria-label="Undo sequence edit" title="Undo"><Undo2 size={16} /></button><button onClick={history.redo} disabled={!history.canRedo} aria-label="Redo sequence edit" title="Redo"><Redo2 size={16} /></button><button onClick={exportEdit}>Save edit JSON</button><button className="ed-primary" disabled={!doc.clips.length || !support.supported || rendering} onClick={render} title={support.reason}>{rendering ? `Rendering ${progress}%` : 'Render WebM'}</button></div></div>
    <div className="ed-sequence-layout"><main className="ed-sequence-main">
      <div className="ed-sequence-preview-area"><div className="ed-preview-label"><span>{doc.width} × {doc.height} · {doc.fps} fps</span></div><div className="ed-sequence-preview" style={{ aspectRatio: `${doc.width}/${doc.height}`, width: doc.clips.length ? `min(100%, ${42 * doc.width / doc.height}vh)` : "100%" }}>
        {currentAsset ? <>{currentAsset.type === 'video' ? <video key={at?.clip.id} src={currentAsset.url} ref={videoRef} playsInline preload="auto" onLoadedMetadata={() => { if (videoRef.current && at) { const video = videoRef.current; const sourceDuration = video.duration; if (!currentAsset.duration && Number.isFinite(sourceDuration) && sourceDuration > .1 && at.clip.out > sourceDuration) { history.apply({ ...doc, clips: doc.clips.map(clip => clip.id === at.clip.id ? { ...clip, in: Math.min(clip.in, Math.max(0, sourceDuration - .1)), out: sourceDuration } : clip) }); setError('The source duration was detected and this shot was trimmed to its available frames.'); } video.currentTime = Math.min(at.clip.in + at.localTime, Math.max(0, sourceDuration - .01)); if (playing) void video.play(); } }} onError={() => setError('Video source unavailable. Relink or reimport the media.')} /> : <img src={currentAsset.url} alt={currentAsset.name} />}<canvas ref={captionRef} width={doc.width} height={doc.height} className="ed-caption-canvas" aria-label={currentCaption ? `Caption: ${currentCaption}` : "No caption"} /></> : <div className="ed-empty"><h2>Create a sequence</h2><p>Add images or video clips, then arrange them on the timeline.</p><button className="ed-primary" onClick={() => setPicker('clips')}><Plus size={16} />Add a shot</button></div>}
      </div><div className="ed-playback"><button aria-label={playing ? 'Pause sequence' : 'Play sequence'} disabled={!doc.clips.length || rendering} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={20} /> : <Play size={20} />}</button><span className="ed-timecode">{timecode(time)} <span>/ {timecode(duration)}</span></span><input aria-label="Sequence playhead" type="range" min={0} max={Math.max(.01, duration - .01)} step={1 / doc.fps} value={Math.min(time, Math.max(0, duration - .01))} onChange={event => { setTime(Number(event.target.value)); setPlaying(false); }} /></div></div>
      <div className="ed-timeline"><div className="ed-timeline-toolbar"><div className="ed-actions"><button onClick={() => setPicker('clips')}><Plus size={15} />Add shot</button><button onClick={() => setPicker('audio')}><AudioLines size={15} />Audio</button><button disabled={!splitAvailable} onClick={() => { history.apply(splitSequenceClip(doc, selectedClip!.id, at!.localTime)); setPlaying(false); }}><Scissors size={15} />Split at playhead</button></div><span>{timecode(duration)} total</span></div><div className="ed-track"><div className="ed-track-label"><Film size={15} /><span>Video</span></div><div className="ed-clip-track">{doc.clips.map((clip, index) => { const asset = assets.find(item => item.id === clip.assetId); return <button key={clip.id} onClick={() => chooseClip(clip)} className={`ed-clip ${selectedClip?.id === clip.id ? 'selected' : ''}`} style={{ width: Math.max(100, clipDuration(clip) * 22) }}><div className="ed-clip-visual">{asset?.type === 'image' || asset?.thumbnailUrl ? <img src={asset.thumbnailUrl || asset.url} alt="" /> : <Film size={26} />}<span>{String(index + 1).padStart(2, '0')}</span></div><div className="ed-clip-caption"><span>{asset?.name || 'Missing media'}</span><small>{clipDuration(clip).toFixed(1)}s{clip.caption ? ' · CC' : ''}</small></div></button>; })}<button className="ed-clip-add" onClick={() => setPicker('clips')} aria-label="Add another shot"><Plus size={22} /></button></div></div><div className="ed-track ed-audio-track"><div className="ed-track-label"><AudioLines size={15} /><span>Audio</span></div>{audioAsset ? <div className="ed-audio-bar"><AudioLines size={22} /><span>{audioAsset.name}</span><small>{doc.audio?.offset.toFixed(1)}s offset</small><button aria-label="Remove audio track" onClick={() => history.apply({ ...doc, audio: undefined })}><X size={14} /></button></div> : <button className="ed-add-audio" onClick={() => setPicker('audio')}><Plus size={14} />Add a soundtrack or voiceover</button>}</div></div>
      {(error || rendering) && <div className="ed-status" role="status">{error || 'Rendering in real time. Keep this tab visible.'}{rendering && <button onClick={() => abortRef.current?.abort()}>Cancel render</button>}</div>}
    </main><aside className="ed-inspector">
      <div className="ed-panel-section"><div className="ed-section-title">Sequence settings</div><label className="ed-label">Format<select value={`${doc.width}:${doc.height}`} onChange={event => { const [width, height] = event.target.value.split(':').map(Number); history.apply({ ...doc, width, height }); }}><option value="1280:720">Landscape · 16:9</option><option value="720:1280">Portrait · 9:16</option><option value="1080:1080">Square · 1:1</option></select></label><label className="ed-label">Frame rate<select value={doc.fps} onChange={event => history.apply({ ...doc, fps: Number(event.target.value) })}><option value={24}>24 fps</option><option value={25}>25 fps</option><option value={30}>30 fps</option></select></label></div>
      <div className="ed-panel-section"><div className="ed-section-title">Shot inspector</div>{selectedClip ? <><p className="ed-selected-asset">{selectedAsset?.name || 'Missing media'}</p><div className="ed-field-grid"><label className="ed-label">{selectedAsset?.type === 'image' ? 'Start' : 'In point'}<input type="number" step={.1} min={0} max={selectedClip.out - .1} disabled={selectedAsset?.type === 'image'} value={selectedClip.in} onChange={event => patchClip({ in: clamp(Number(event.target.value), 0, selectedClip.out - .1) })} /></label><label className="ed-label">{selectedAsset?.type === 'image' ? 'Hold duration' : 'Out point'}<input type="number" step={.1} min={selectedClip.in + .1} max={selectedAsset?.type === 'video' ? selectedAsset.duration || 600 : 120} value={selectedClip.out} onChange={event => patchClip({ out: clamp(Number(event.target.value), selectedClip.in + .1, selectedAsset?.type === 'video' ? selectedAsset.duration || 600 : 120) })} /></label></div><div className="ed-actions"><button onClick={() => history.apply(moveSequenceClip(doc, selectedClip.id, -1))} disabled={doc.clips[0]?.id === selectedClip.id} title="Move shot earlier" aria-label="Move shot earlier"><ArrowLeft size={15} /></button><button onClick={() => history.apply(moveSequenceClip(doc, selectedClip.id, 1))} disabled={doc.clips.at(-1)?.id === selectedClip.id} title="Move shot later" aria-label="Move shot later"><ArrowRight size={15} /></button><button onClick={() => patchClip({ muted: !selectedClip.muted })}>{selectedClip.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}{selectedClip.muted ? 'Muted' : 'Source audio'}</button><button aria-label="Remove selected shot" title="Remove selected shot" onClick={() => { history.apply({ ...doc, clips: doc.clips.filter(clip => clip.id !== selectedClip.id) }); setSelected(null); setTime(0); setPlaying(false); }}><Trash2 size={15} /></button></div><label className="ed-label ed-caption-label"><span><Captions size={15} />Caption</span><textarea value={selectedClip.caption} maxLength={300} placeholder="Add a caption to this shot…" onChange={event => patchClip({ caption: event.target.value })} /></label><p className="ed-help">Captions are burned into WebM.</p></> : <p className="ed-help">Choose a shot to trim, reorder or caption it.</p>}</div>
      {doc.audio && <div className="ed-panel-section"><div className="ed-section-title">Audio track</div><label className="ed-label">Start offset in sequence<input type="number" min={0} max={duration} step={.1} value={doc.audio.offset} onChange={event => history.apply({ ...doc, audio: { ...doc.audio!, offset: clamp(Number(event.target.value), 0, duration) } })} /></label><label className="ed-label">Volume <span>{Math.round(doc.audio.volume * 100)}%</span><input type="range" min={0} max={1} step={.01} value={doc.audio.volume} onChange={event => history.apply({ ...doc, audio: { ...doc.audio!, volume: Number(event.target.value) } })} /></label></div>}
      <div className="ed-panel-section"><div className="ed-section-title">Export</div><p className="ed-help">WebM renders at playback speed. Keep this tab visible.</p>{!support.supported && <p className="ed-inline-warning">{support.reason}</p>}<p className="ed-help">Edit JSON contains source references. Export the project to include media.</p></div>
    </aside></div>
    {audioAsset && <audio ref={audioRef} src={audioAsset.url} preload="auto" />}
    {picker && <div className="ed-modal-backdrop" onClick={() => setPicker(null)}><div className="ed-modal" role="dialog" aria-modal="true" aria-label={picker === 'audio' ? 'Choose audio' : 'Choose shot'} onClick={event => event.stopPropagation()}><div className="ed-modal-header"><h2>{picker === 'audio' ? 'Add a soundtrack' : 'Add a shot'}</h2><button aria-label="Close asset picker" onClick={() => setPicker(null)}><X size={18} /></button></div><div className="ed-asset-grid">{(picker === 'audio' ? assets.filter(asset => asset.type === 'audio') : clipAssets).map(asset => <button key={asset.id} disabled={Boolean(loadingAsset)} onClick={() => picker === 'audio' ? (history.apply({ ...doc, audio: { assetId: asset.id, offset: 0, volume: .8 } }), setPicker(null)) : addClip(asset)}>{asset.type === 'image' || asset.thumbnailUrl ? <img src={asset.thumbnailUrl || asset.url} alt="" /> : <div className="ed-asset-icon">{asset.type === 'audio' ? <AudioLines size={32} /> : <Film size={32} />}</div>}<span>{loadingAsset === asset.id ? "Reading source…" : asset.name}</span><small>{asset.type}{asset.duration ? ` · ${asset.duration.toFixed(1)}s` : ''}</small></button>)}</div>{!(picker === 'audio' ? assets.some(asset => asset.type === 'audio') : clipAssets.length) && <div className="ed-empty"><ImagePlus size={30} /><p>Import {picker === 'audio' ? 'an audio file' : 'images or video clips'} into your library first.</p>{onImport && <button className="ed-primary" onClick={() => { setPicker(null); onImport(); }}><Plus size={15} />Import media</button>}</div>}</div></div>}
  </section>;
}
