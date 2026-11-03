'use client';
/* eslint-disable @next/next/no-img-element -- Shot previews use original local project media. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Film, ImagePlus, Pause, Pin, Plus, Redo2, Trash2, Undo2, X } from 'lucide-react';
import type { GenerationRequest, Job, Recipe } from '../../lib/server/contracts';
import type { EditorAsset } from './editor-model';
import { timecode } from './editor-model';
import { canvasBlob, jsonDownload, mediaDuration } from './editor-utils';
import { useDocumentHistory } from './use-document-history';
import { addShot, attachShotTake, blankShotsDocument, jobsForShot, observeShotOutputs, parseShotsDocument, removeShot, shotGenerationIssue, shotGenerationRequest, shotReferences, takesForShot, updateShot, type Shot, type ShotsDocument, type ShotTake } from './shots-model';
import './editors.css';
import './shots.css';

export interface ShotsEditorProps {
  assets: EditorAsset[]; jobs: Job[]; recipes: Recipe[]; projectId: string | null;
  document?: ShotsDocument; onChange: (document: ShotsDocument) => void;
  onGenerate: (request: GenerationRequest) => Promise<Job | undefined>; onImport?: () => void;
  onExtractFrame: (blob: Blob, name: string, parentAssetId: string) => Promise<EditorAsset | undefined>;
  onEditFrame: (asset: EditorAsset) => void; onUseTake: (asset: EditorAsset) => void;
  onCancelJob?: (jobId: string) => Promise<void>; initialVideoAssetId?: string;
  generationAvailable?: boolean; generationUnavailableReason?: string;
}
const labels: Record<Job['status'], string> = { queued: 'Queued', running: 'Generating', canceling: 'Canceling', succeeded: 'Completed', failed: 'Failed', canceled: 'Canceled', submission_unknown: 'Submission uncertain' };

function TakeMedia({ asset, controls = true }: { asset: EditorAsset; controls?: boolean }) {
  if (asset.type === 'video') return <video src={asset.url} controls={controls} muted={!controls} playsInline preload="metadata" aria-label={asset.name} />;
  return <img src={asset.url} alt={asset.name} />;
}

export function ShotsEditor({ assets, jobs, recipes, projectId, document: external, onChange, onGenerate, onImport, onExtractFrame, onEditFrame, onUseTake, onCancelJob, initialVideoAssetId, generationAvailable = false, generationUnavailableReason = 'Connect a compatible Comfy engine to generate a take.' }: ShotsEditorProps) {
  const validated = useMemo(() => {
    if (!external) return { document: undefined, error: '' };
    try { return { document: parseShotsDocument(external), error: '' }; }
    catch (error) { return { document: undefined, error: error instanceof Error ? error.message : 'Invalid shots document.' }; }
  }, [external]);
  const history = useDocumentHistory(blankShotsDocument, validated.document, onChange); const doc = history.value;
  const apply = history.apply;
  const shot = doc.shots.find(item => item.id === doc.activeShotId) || doc.shots[0];
  const recipe = recipes.find(item => item.id === shot?.recipeId);
  const activeJobs = shot ? jobsForShot(jobs, shot.id, projectId) : [];
  const takes = shot ? takesForShot(shot, jobs, assets, projectId) : [];
  const selected = shot?.selectedTakeAssetId ? takes.find(take => take.assetId === shot.selectedTakeAssetId) : takes.find(take => take.asset);
  const [mode, setMode] = useState<'takes' | 'frames'>(initialVideoAssetId ? 'frames' : 'takes');
  const [picker, setPicker] = useState<'scene' | 'shot' | 'take' | null>(null);
  const [message, setMessage] = useState(''); const [submitting, setSubmitting] = useState(false);
  const [comparisonId, setComparisonId] = useState('');
  const [frameOverride, setFrameOverride] = useState<string | null>(initialVideoAssetId || null);
  const frameSourceId = frameOverride ?? doc.frameSourceAssetId ?? '';
  const frameSource = assets.find(asset => asset.id === frameSourceId && asset.type === 'video');
  const [frameTime, setFrameTime] = useState(0); const [sourceDuration, setSourceDuration] = useState(0);
  const [frameReady, setFrameReady] = useState(false); const [seeking, setSeeking] = useState(false);
  const [capturing, setCapturing] = useState(false); const [captured, setCaptured] = useState<EditorAsset | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null); const alive = useRef(true);
  const documentRef = useRef(doc);
  const imageAssets = assets.filter(asset => asset.type === 'image');
  const videoAssets = assets.filter(asset => asset.type === 'video');
  const referenceIds = shot ? shotReferences(doc, shot) : [];
  const uncertain = activeJobs.some(job => job.status === 'submission_unknown');
  const issue = shot ? shotGenerationIssue(doc, shot, recipe, assets) : 'Create a shot first.';
  const generationIssue = uncertain ? 'A previous submission could not be confirmed. Check its status in Queue before generating another take.' : issue;
  const comparison = takes.find(take => take.assetId === comparisonId && take.assetId !== selected?.assetId);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { documentRef.current = doc; }, [doc]);
  useEffect(() => {
    if (validated.error) return;
    let current = true;
    queueMicrotask(() => { if (current) { try { const next = observeShotOutputs(doc, jobs, projectId, assets); if (next !== doc) apply(next, false); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not retain these take references.'); } } });
    return () => { current = false; };
  }, [doc, jobs, assets, projectId, apply, validated.error]);
  useEffect(() => {
    if (!initialVideoAssetId || validated.error) return;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      setFrameOverride(initialVideoAssetId); setMode('frames'); setFrameReady(false); setFrameTime(0); setSourceDuration(0); setCaptured(null);
      const latest = documentRef.current;
      if (latest.frameSourceAssetId !== initialVideoAssetId) apply({ ...latest, frameSourceAssetId: initialVideoAssetId }, false);
    });
    return () => { current = false; };
  }, [initialVideoAssetId, validated.error, apply]);

  function patch(values: Partial<Omit<Shot, 'id' | 'createdAt'>>) { if (shot) apply(updateShot(doc, shot.id, values)); }
  function createShot() {
    try { apply(addShot(doc, recipes.find(item => item.kind === 'video') || recipes[0])); setMessage(''); setMode('takes'); setComparisonId(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create a shot.'); }
  }
  function selectRecipe(id: string) {
    const next = recipes.find(item => item.id === id); if (!next) return;
    patch({ recipeId: id, width: next.defaults.width, height: next.defaults.height, duration: next.defaults.duration || 2, fps: next.defaults.fps || 24 });
  }
  function toggleReference(id: string, scope: 'scene' | 'shot') {
    const refs = scope === 'scene' ? doc.sceneReferenceAssetIds : shot?.referenceAssetIds || [];
    const next = refs.includes(id) ? refs.filter(item => item !== id) : [...refs, id];
    if (next.length > 32) { setMessage('Keep no more than 32 references in each list.'); return; }
    if (scope === 'scene') apply({ ...doc, sceneReferenceAssetIds: next }); else patch({ referenceAssetIds: next });
  }
  function selectTake(take: ShotTake) { patch({ selectedTakeAssetId: take.assetId }); setMode('takes'); }
  async function generate() {
    if (!shot || !recipe || generationIssue || !generationAvailable || submitting) return;
    setSubmitting(true); setMessage('');
    try {
      const request = shotGenerationRequest(doc, shot, recipe, assets, projectId);
      request.requestId = `take-${crypto.randomUUID()}`; request.batchId = `batch-${crypto.randomUUID()}`;
      const job = await onGenerate(request);
      if (!alive.current) return;
      if (!job) throw new Error('The take was not submitted. Check the engine connection.');
      if (job.status === 'failed') throw new Error(job.error?.message || 'Generation failed.');
      setMessage(job.status === 'submission_unknown' ? 'Submission could not be confirmed. Check the existing job in Queue.' : job.status === 'succeeded' ? `Job ${job.id} completed.` : `Queued for ${shot.title}. Job ${job.id}.`);
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : 'The take could not be submitted.'); }
    finally { if (alive.current) setSubmitting(false); }
  }
  function chooseFrameSource(id: string) {
    setFrameOverride(id); setFrameReady(false); setFrameTime(0); setSourceDuration(0); setCaptured(null);
    apply({ ...doc, frameSourceAssetId: id });
  }
  async function readFrameSource(video: HTMLVideoElement, asset: EditorAsset) {
    try {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : await mediaDuration(asset.url);
      if (alive.current && videoRef.current === video) setSourceDuration(duration);
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : 'Could not read this video.'); }
  }
  function seekFrame(time: number) {
    const video = videoRef.current; if (!video) return;
    video.pause(); video.currentTime = Math.max(0, Math.min(time, Math.max(0, sourceDuration - .001))); setFrameTime(video.currentTime);
  }
  async function captureFrame() {
    const video = videoRef.current;
    if (!video || !frameSource || !frameReady || capturing) return;
    setCapturing(true); setMessage('');
    try {
      if (video.seeking) throw new Error('Wait for the selected frame to finish loading.');
      video.pause();
      if (!video.videoWidth || !video.videoHeight || video.readyState < 2) throw new Error('This video has no decoded frame to capture.');
      const time = video.currentTime;
      const canvas = window.document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas is unavailable.');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await canvasBlob(canvas); if (!alive.current) return;
      const name = `${frameSource.name.replace(/\.[^.]+$/, '')}-frame-${Math.round(time * 1000)}ms.png`;
      const result = await onExtractFrame(blob, name, frameSource.id); if (!alive.current) return;
      if (!result) throw new Error('The captured frame could not be saved.');
      setCaptured(result); setMessage(`Frame at ${timecode(time)} saved to your library.`);
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : 'Frame capture failed.'); }
    finally { if (alive.current) setCapturing(false); }
  }
  function addCapturedReference(asset: EditorAsset) {
    const videoRecipe = recipe?.kind === 'video' && recipe.capabilities.includes('image-to-video') ? recipe : recipes.find(item => item.kind === 'video' && item.capabilities.includes('image-to-video'));
    if (!videoRecipe) { setMessage('No configured recipe supports a start image.'); return; }
    if (!shot) {
      const next = addShot(doc, videoRecipe); const created = next.shots.at(-1)!;
      apply(updateShot(next, created.id, { referenceAssetIds: [asset.id] })); setMode('takes');
      setMessage('Shot created with the captured frame as a reference. Pinned scene references are retained.'); return;
    }
    const refs = [...new Set([...shot.referenceAssetIds, asset.id])];
    if (refs.length > 32) { setMessage('Remove a shot reference before adding another captured frame. The current references have been preserved.'); return; }
    patch({ recipeId: videoRecipe.id, referenceAssetIds: refs, ...(videoRecipe.id !== shot.recipeId ? { width: videoRecipe.defaults.width, height: videoRecipe.defaults.height, duration: videoRecipe.defaults.duration || 2, fps: videoRecipe.defaults.fps || 24 } : {}) });
    const count = new Set([...doc.sceneReferenceAssetIds, ...refs]).size;
    setMessage(count > videoRecipe.maxInputs ? `Frame added. ${videoRecipe.name} accepts ${videoRecipe.maxInputs} start image; remove the other references before generating.` : 'Captured frame added as the start image.');
  }
  async function cancel(job: Job) {
    if (!onCancelJob) return;
    try { await onCancelJob(job.id); setMessage('Cancellation requested. The job remains active until the engine confirms it.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Cancellation could not be requested.'); }
  }
  function referenceChips(ids: string[], scope: 'scene' | 'shot') {
    return <div className="shots-reference-list">{ids.map(id => { const asset = assets.find(item => item.id === id); return <div className="shots-reference" key={id}>{asset && <img src={asset.thumbnailUrl || asset.url} alt="" />}<span>{asset?.name || 'Missing reference'}</span><button aria-label={`Remove ${asset?.name || 'missing reference'}`} onClick={() => toggleReference(id, scope)}><X size={13} /></button></div>; })}</div>;
  }

  if (validated.error) return <section className="ed-workspace shots-invalid"><h2>Saved shots could not be opened</h2><p role="alert">{validated.error}</p><button onClick={() => jsonDownload(external, 'saved-shots-recovery.json')}>Download saved data</button><p>The saved document has not been replaced.</p></section>;

  return <section className="ed-workspace shots-workspace" aria-label="Shots and takes">
    <header className="ed-topbar"><div className="ed-heading"><strong>Shots</strong><span className="ed-count">{doc.shots.length}</span></div><div className="ed-actions"><button onClick={history.undo} disabled={!history.canUndo} aria-label="Undo shot change" title="Undo"><Undo2 size={16} /></button><button onClick={history.redo} disabled={!history.canRedo} aria-label="Redo shot change" title="Redo"><Redo2 size={16} /></button><button onClick={createShot} disabled={!projectId || doc.shots.length >= 100}><Plus size={15} />New shot</button></div></header>
    <div className="shots-layout">
      <aside className="shots-list" aria-label="Shot list">{doc.shots.map((item, index) => { const itemTakes = takesForShot(item, jobs, assets, projectId); const job = jobsForShot(jobs, item.id, projectId).find(item => ['queued', 'running', 'canceling', 'submission_unknown'].includes(item.status)); return <button className={item.id === shot?.id ? 'is-active' : ''} key={item.id} onClick={() => { apply({ ...doc, activeShotId: item.id }, false); setComparisonId(''); setMessage(''); }}><span className="shots-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{item.title}</strong><small>{job ? labels[job.status] : `${itemTakes.length} ${itemTakes.length === 1 ? 'take' : 'takes'}`}</small></span></button>; })}{!doc.shots.length && <p>No shots yet.</p>}</aside>
      <main className="shots-main">
        {(shot || mode === 'frames') ? <>
          <div className="shots-view-toolbar"><div className="shots-view-tabs" aria-label="Shot workspace"><button aria-pressed={mode === 'takes'} className={mode === 'takes' ? 'is-active' : ''} onClick={() => setMode('takes')}>Takes</button><button aria-pressed={mode === 'frames'} className={mode === 'frames' ? 'is-active' : ''} onClick={() => setMode('frames')}>Capture frame</button></div>{mode === 'takes' && <button onClick={() => setPicker('take')}>Choose take</button>}</div>
          {mode === 'takes' ? <>
            <div className={`shots-preview-area ${comparison?.asset && selected?.asset ? 'is-comparing' : ''}`}>
              {selected?.asset ? <div className="shots-preview"><TakeMedia asset={selected.asset} /><div className="shots-preview-actions"><span>{selected.asset.name}</span>{selected.asset.type === 'video' && <button onClick={() => { chooseFrameSource(selected.asset!.id); setMode('frames'); }}>Capture frame</button>}<button onClick={() => onUseTake(selected.asset!)}>Add to sequence</button></div></div> : <div className="shots-empty"><h2>{selected ? 'Take unavailable' : 'No takes yet'}</h2><p>{selected ? 'The selected media is missing. Choose another take or relink the source in your library.' : 'Generate a take or choose an image or video from your library.'}</p><button onClick={() => setPicker('take')}>Choose take</button></div>}
              {comparison?.asset && selected?.asset && <div className="shots-preview"><TakeMedia asset={comparison.asset} /><div className="shots-preview-actions"><span>{comparison.asset.name}</span><button onClick={() => selectTake(comparison)}>Select this take</button></div></div>}
            </div>
            {takes.length > 1 && <div className="shots-compare"><label>Compare with<select aria-label="Compare take" value={comparison?.assetId || ''} onChange={event => setComparisonId(event.target.value)}><option value="">No comparison</option>{takes.filter(take => take.assetId !== selected?.assetId && take.asset).map(take => <option key={take.assetId} value={take.assetId}>{take.asset!.name}</option>)}</select></label></div>}
            <div className="shots-take-tray" aria-label="Shot takes">{takes.map((take, index) => <button key={take.assetId} className={take.assetId === selected?.assetId ? 'is-selected' : ''} onClick={() => selectTake(take)}><div>{take.asset ? <TakeMedia asset={take.asset} controls={false} /> : <span>Missing media</span>}{take.assetId === selected?.assetId && <Check className="shots-take-check" size={14} />}</div><strong>Take {takes.length - index}</strong><small>{take.source === 'generation' ? 'Generated' : take.source === 'manual' ? 'From library' : 'Saved take'}</small></button>)}</div>
          </> : <div className="shots-frame-workspace"><div className="shots-frame-source"><label>Source clip<select aria-label="Frame source video" value={frameSourceId} onChange={event => chooseFrameSource(event.target.value)}><option value="" disabled>Choose a video</option>{frameSourceId && !frameSource && <option value={frameSourceId}>Missing source clip</option>}{videoAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>{onImport && <button onClick={onImport}>Import media</button>}</div>
            {frameSource ? <><div className="shots-frame-preview"><video key={frameSource.id} ref={videoRef} src={frameSource.url} crossOrigin="anonymous" controls playsInline preload="auto" onLoadedMetadata={event => { void readFrameSource(event.currentTarget, frameSource); }} onLoadedData={() => setFrameReady(true)} onSeeking={() => setSeeking(true)} onSeeked={() => setSeeking(false)} onTimeUpdate={event => setFrameTime(event.currentTarget.currentTime)} onError={() => { setFrameReady(false); setMessage('The source video could not be loaded. Relink it in the library.'); }} /></div><div className="shots-frame-controls"><button aria-label="Previous moment" onClick={() => seekFrame(frameTime - .04)} disabled={!frameReady}><ChevronLeft size={16} /></button><button aria-label="Pause source video" onClick={() => videoRef.current?.pause()} disabled={!frameReady}><Pause size={15} /></button><button aria-label="Next moment" onClick={() => seekFrame(frameTime + .04)} disabled={!frameReady}><ChevronRight size={16} /></button><input aria-label="Capture timestamp" type="range" min={0} max={Math.max(.001, sourceDuration - .001)} step={.001} value={Math.min(frameTime, Math.max(0, sourceDuration - .001))} disabled={!sourceDuration} onChange={event => seekFrame(Number(event.target.value))} /><span>{timecode(frameTime)}</span><button className="ed-primary" onClick={captureFrame} disabled={!frameReady || seeking || capturing}>{capturing ? 'Saving frame…' : 'Capture PNG'}</button></div></> : <div className="shots-empty"><h2>Choose a source video</h2><p>Scrub to a frame and save it as a full-resolution PNG.</p>{onImport && <button onClick={onImport}>Import video</button>}</div>}
            {captured && <div className="shots-captured"><img src={captured.url} alt="Captured frame" /><div><strong>{captured.name}</strong><div className="ed-actions"><button onClick={() => onEditFrame(captured)}>Edit frame</button><button onClick={() => addCapturedReference(captured)}>{shot ? "Use as start frame" : "Create shot from frame"}</button></div></div></div>}
          </div>}
          {!!activeJobs.length && <div className="shots-jobs" aria-label="Shot generation history">{activeJobs.map(job => <div key={job.id} className={`shots-job shots-job-${job.status}`}><div><strong>{labels[job.status]}</strong><span>{job.stage || recipes.find(recipe => recipe.id === job.recipeId)?.name || job.recipeId}</span>{job.progress !== null && ['queued', 'running', 'canceling'].includes(job.status) && <progress max={1} value={job.progress} aria-label="Generation progress" />}{job.error && <p>{job.error.message}</p>}<small title={job.id}>Job {job.id}</small></div>{onCancelJob && ['queued', 'running'].includes(job.status) && <button onClick={() => cancel(job)}>Cancel</button>}</div>)}</div>}
        </> : <div className="shots-empty shots-empty-project"><h2>Plan a shot</h2><p>Keep its prompt, references and alternative takes together.</p><button className="ed-primary" onClick={createShot} disabled={!projectId}>New shot</button>{!projectId && <p>Choose a project to save your shots.</p>}</div>}
        {message && <div className="ed-status" role="status">{message}</div>}
      </main>
      <aside className="shots-inspector">
        <section><div className="shots-section-heading"><h2>Scene references</h2><button aria-label="Pin scene reference images" onClick={() => setPicker('scene')}><Pin size={14} /></button></div>{referenceChips(doc.sceneReferenceAssetIds, 'scene')}{!doc.sceneReferenceAssetIds.length && <p className="shots-help">Pin images to reuse across every shot.</p>}</section>
        {shot && <><section><div className="shots-section-heading"><h2>Shot settings</h2><button aria-label="Delete shot" onClick={() => { apply(removeShot(doc, shot.id)); setMessage('Shot removed. Undo restores it; media and jobs remain in your library.'); }}><Trash2 size={14} /></button></div><label>Title<input key={`${shot.id}:${shot.title}`} defaultValue={shot.title} maxLength={120} onBlur={event => { const title = event.target.value.trim(); if (title) patch({ title }); else event.target.value = shot.title; }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label><label>Model<select value={shot.recipeId} onChange={event => selectRecipe(event.target.value)}><option value="" disabled>Choose a model</option>{shot.recipeId && !recipe && <option value={shot.recipeId}>Model unavailable</option>}{recipes.map(item => <option key={item.id} value={item.id}>{item.name}{item.availability === 'missing-models' ? ' · missing models' : ''}</option>)}</select></label><label>Prompt<textarea key={shot.id} value={shot.prompt} maxLength={12000} placeholder={recipe?.kind === 'video' ? 'Describe the scene and its motion…' : 'Describe the image or edit…'} onChange={event => patch({ prompt: event.target.value })} /></label>{recipe?.capabilities.includes('dimensions') ? <label>Format<select value={`${shot.width}:${shot.height}`} onChange={event => { const [width, height] = event.target.value.split(':').map(Number); patch({ width, height }); }}>{!(recipe?.kind === 'video' ? ['832:480', '480:832', '640:640'] : ['1024:1024', '1152:768', '768:1152']).includes(`${shot.width}:${shot.height}`) && <option value={`${shot.width}:${shot.height}`}>{shot.width} × {shot.height}</option>}{(recipe?.kind === 'video' ? [[832, 480], [480, 832], [640, 640]] : [[1024, 1024], [1152, 768], [768, 1152]]).map(([width, height]) => <option key={`${width}:${height}`} value={`${width}:${height}`}>{width} × {height}</option>)}</select></label> : recipe?.requiresInput ? <p className="shots-help">Output dimensions follow the reference image.</p> : null}{recipe?.kind === 'video' && <div className="shots-two-fields"><label>Duration<select value={shot.duration} onChange={event => patch({ duration: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}s</option>)}</select></label><label>Frame rate<select value={shot.fps} onChange={event => patch({ fps: Number(event.target.value) })}><option value={16}>16 fps</option><option value={24}>24 fps</option></select></label></div>}</section>
          <section><div className="shots-section-heading"><h2>{recipe?.kind === 'video' && recipe.capabilities.includes('image-to-video') ? 'Start image' : 'Shot references'}</h2><button aria-label="Add reference image to shot" onClick={() => setPicker('shot')}><Plus size={15} /></button></div>{referenceChips(shot.referenceAssetIds, 'shot')}{recipe?.kind === 'video' && recipe.maxInputs > 0 && <p className="shots-help">{recipe.maxInputs === 1 ? 'One reference image controls the first frame.' : `This recipe accepts ${recipe.maxInputs} reference images.`}</p>}{!!doc.sceneReferenceAssetIds.length && <p className="shots-help">{doc.sceneReferenceAssetIds.length} scene reference{doc.sceneReferenceAssetIds.length === 1 ? '' : 's'} included.</p>}</section>
          <section className="shots-generate"><button className="ed-primary ed-full" onClick={generate} disabled={!generationAvailable || !projectId || Boolean(generationIssue) || submitting}>{submitting ? 'Submitting…' : 'Generate take'}</button>{generationIssue && <p className="shots-warning">{generationIssue}</p>}{!generationAvailable && <p className="shots-help">{generationUnavailableReason}</p>} {!!referenceIds.length && <p className="shots-help">{referenceIds.length} reference image{referenceIds.length === 1 ? '' : 's'} assigned. They are kept when changing models.</p>}</section>
        </>}
      </aside>
    </div>
    {picker && <div className="ed-modal-backdrop" onClick={() => setPicker(null)}><div className="ed-modal" role="dialog" aria-modal="true" aria-label={picker === 'take' ? 'Choose existing take' : 'Choose reference images'} onClick={event => event.stopPropagation()}><div className="ed-modal-header"><h2>{picker === 'scene' ? 'Scene references' : picker === 'shot' ? 'Shot references' : 'Choose a take'}</h2><button aria-label="Close media picker" onClick={() => setPicker(null)}><X size={18} /></button></div><div className="ed-asset-grid">{(picker === 'take' ? assets.filter(asset => asset.type !== 'audio') : imageAssets).map(asset => { const isSelected = picker === 'scene' ? doc.sceneReferenceAssetIds.includes(asset.id) : picker === 'shot' ? shot?.referenceAssetIds.includes(asset.id) : selected?.assetId === asset.id; return <button className={isSelected ? 'shots-picker-selected' : ''} aria-pressed={Boolean(isSelected)} key={asset.id} onClick={() => { if (picker === 'take' && shot) { try { apply(attachShotTake(doc, shot.id, asset.id)); setPicker(null); setMode('takes'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not add this take.'); } } else toggleReference(asset.id, picker === 'scene' ? 'scene' : 'shot'); }}>{asset.type === 'image' || asset.thumbnailUrl ? <img src={asset.thumbnailUrl || asset.url} alt="" /> : <div className="ed-asset-icon"><Film size={25} /></div>}<span>{asset.name}{isSelected ? ' · selected' : ''}</span></button>; })}</div>{!(picker === 'take' ? assets.some(asset => asset.type !== 'audio') : imageAssets.length) && <div className="shots-picker-empty"><ImagePlus size={22} /><p>No compatible media in your library.</p>{onImport && <button onClick={() => { setPicker(null); onImport(); }}>Import media</button>}</div>}{message && <p className="shots-warning" role="status">{message}</p>}{picker !== 'take' && <button className="ed-primary" onClick={() => setPicker(null)}>Done</button>}</div></div>}
  </section>;
}
