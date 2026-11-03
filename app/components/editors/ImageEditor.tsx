'use client';
/* eslint-disable @next/next/no-img-element -- Project assets can be local/blob URLs and must keep their source pixels. */

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowDown, ArrowUp, Brush, Check, Crop, Eraser, Eye, EyeOff, ImagePlus, Layers, MousePointer2, Plus, Redo2, RotateCcw, Sparkles, Trash2, Type, Undo2, X } from 'lucide-react';
import { addImageLayer, blankImageDocument, clamp, cropImageDocument, editorId, resizeImageCanvas, type AIEditRequest, type EditorAsset, type ImageDocument, type ImageLayer, type Point, type Rect } from './editor-model';
import { canvasBlob, drawMask, imageWithDimensions, jsonDownload, renderImageDocument, saveOrDownloadExport } from './editor-utils';
import { useDocumentHistory } from './use-document-history';
import './editors.css';

export interface ImageEditorProps {
  assets: EditorAsset[]; document?: ImageDocument; onChange?: (document: ImageDocument) => void;
  onExport?: (blob: Blob, name: string) => void | Promise<void>;
  onAIEdit?: (request: AIEditRequest) => void | Promise<void>;
  aiEditAvailable?: boolean; aiEditUnavailableReason?: string; aiEditOperations?: ('image-edit' | 'inpaint')[]; onImport?: () => void; initialAssetId?: string;
}
type Tool = 'move' | 'paint' | 'erase' | 'crop';

export function ImageEditor({ assets, document: external, onChange, onExport, onAIEdit, onImport, initialAssetId, aiEditOperations, aiEditAvailable = false, aiEditUnavailableReason = 'Connect an engine and select a compatible image edit recipe to use AI editing.' }: ImageEditorProps) {
  const history = useDocumentHistory(blankImageDocument, external, onChange);
  const doc = history.value;
  const [draft, setDraft] = useState<ImageDocument | null>(null);
  const displayed = draft || doc;
  const [tool, setTool] = useState<Tool>('move'); const [brush, setBrush] = useState(44);
  const [activeLayer, setActiveLayer] = useState<string | null>(doc.layers.at(-1)?.id || null);
  const [showLibrary, setShowLibrary] = useState(false); const [showMask, setShowMask] = useState(true);
  const [crop, setCrop] = useState<Rect | null>(null); const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null); const maskRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null); const [stageSize, setStageSize] = useState({ width: 840, height: 640 });
  const images = useRef(new Map<string, HTMLImageElement>());
  const gesture = useRef<{ start: Point; source: ImageDocument; layer?: ImageLayer } | null>(null);
  const draftRef = useRef<ImageDocument | null>(null);
  const layer = displayed.layers.find(item => item.id === activeLayer);
  const imageAssets = assets.filter(asset => asset.type === 'image');
  const editOperation = doc.mask.some(stroke => stroke.mode === 'paint') ? 'inpaint' : 'image-edit';
  const operationAvailable = aiEditAvailable && (!aiEditOperations || aiEditOperations.includes(editOperation));
  const seeded = useRef(Boolean(external));
  const applyDocument = history.apply;

  useEffect(() => {
    const stage = stageRef.current; if (!stage) return;
    const observer = new ResizeObserver(entries => { const bounds = entries[0]?.contentRect; if (bounds) setStageSize({ width: bounds.width, height: bounds.height }); });
    observer.observe(stage); return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let current = true;
    queueMicrotask(async () => {
      if (!current || seeded.current || doc.layers.length || !initialAssetId) return;
      const asset = assets.find(item => item.id === initialAssetId && item.type === 'image');
      if (!asset) return;
      try {
        const resolved = await imageWithDimensions(asset, images.current); if (!current) return;
        seeded.current = true;
        const next = addImageLayer(doc, resolved); applyDocument(next); setActiveLayer(next.layers.at(-1)!.id);
      } catch (error) { if (current) setMessage(error instanceof Error ? error.message : 'Source image could not be loaded.'); }
    });
    return () => { current = false; };
  }, [initialAssetId, assets, doc, applyDocument]);

  useEffect(() => {
    let cancelled = false;
    const work = window.document.createElement('canvas');
    renderImageDocument(work, displayed, assets, images.current).then(() => {
      if (cancelled || !canvasRef.current) return;
      canvasRef.current.width = work.width; canvasRef.current.height = work.height;
      canvasRef.current.getContext('2d')?.drawImage(work, 0, 0);
    }).catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Image could not be rendered.'); });
    return () => { cancelled = true; };
  }, [displayed, assets]);

  useEffect(() => {
    const canvas = maskRef.current; if (!canvas) return;
    canvas.width = displayed.width; canvas.height = displayed.height;
    const context = canvas.getContext('2d'); if (!context) return;
    if (showMask) drawMask(context, displayed.mask, '#d6e9a7');
  }, [displayed, showMask]);

  function updateLayer(values: Partial<ImageLayer>) {
    history.apply({ ...doc, layers: doc.layers.map(item => item.id === activeLayer ? { ...item, ...values } : item) });
  }
  async function addAsset(asset: EditorAsset) {
    try { const resolved = await imageWithDimensions(asset, images.current); const next = addImageLayer(doc, resolved); history.apply(next); setActiveLayer(next.layers.at(-1)!.id); setShowLibrary(false); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Source image could not be loaded.'); }
  }
  function point(event: PointerEvent<HTMLCanvasElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / bounds.width * doc.width, y: (event.clientY - bounds.top) / bounds.height * doc.height };
  }
  function begin(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event);
    if (tool === 'move') {
      const hit = [...doc.layers].reverse().find(item => item.visible && start.x >= item.x && start.x <= item.x + item.width && start.y >= item.y && start.y <= item.y + item.height);
      if (hit) { setActiveLayer(hit.id); gesture.current = { start, source: doc, layer: hit }; }
    } else if (tool === 'crop') { setCrop({ ...start, width: 0, height: 0 }); gesture.current = { start, source: doc }; }
    else {
      gesture.current = { start, source: doc };
      const next = { ...doc, mask: [...doc.mask, { id: editorId('stroke'), mode: tool === 'erase' ? 'erase' as const : 'paint' as const, width: brush, points: [start] }] };
      draftRef.current = next; setDraft(next);
    }
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    const current = gesture.current; if (!current) return;
    const position = point(event);
    if (tool === 'crop') {
      setCrop({ x: clamp(Math.min(current.start.x, position.x), 0, doc.width), y: clamp(Math.min(current.start.y, position.y), 0, doc.height), width: Math.min(Math.abs(position.x - current.start.x), doc.width), height: Math.min(Math.abs(position.y - current.start.y), doc.height) });
    } else if (tool === 'move' && current.layer) {
      const next = { ...current.source, layers: current.source.layers.map(item => item.id === current.layer!.id ? { ...item, x: Math.round(item.x + position.x - current.start.x), y: Math.round(item.y + position.y - current.start.y) } : item) };
      draftRef.current = next; setDraft(next);
    } else if (tool === 'paint' || tool === 'erase') {
      const previous = draftRef.current; if (!previous) return;
      const next = { ...previous, mask: previous.mask.map((stroke, index) => index === previous.mask.length - 1 ? { ...stroke, points: [...stroke.points, position] } : stroke) };
      draftRef.current = next; setDraft(next);
    }
  }
  function finish() {
    if (draftRef.current) history.apply(draftRef.current);
    draftRef.current = null; setDraft(null); gesture.current = null;
  }
  async function exportPNG() {
    setBusy(true); setMessage('');
    try {
      const canvas = window.document.createElement('canvas'); await renderImageDocument(canvas, doc, assets, images.current);
      const blob = await canvasBlob(canvas); const name = `tye-edit-${Date.now()}.png`;
      const result = await saveOrDownloadExport(blob, name, onExport);
      setMessage(result.saveError ? `PNG downloaded; library save failed: ${result.saveError}` : result.saved ? 'PNG saved to your library.' : 'PNG downloaded.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Export failed.'); } finally { setBusy(false); }
  }
  async function submitEdit() {
    if (!onAIEdit || !operationAvailable || !prompt.trim()) return;
    setBusy(true); setMessage('');
    try {
      const canvas = window.document.createElement('canvas'); await renderImageDocument(canvas, doc, assets, images.current);
      const image = await canvasBlob(canvas); let mask: Blob | undefined;
      if (doc.mask.some(stroke => stroke.mode === 'paint')) {
        const maskCanvas = window.document.createElement('canvas'); maskCanvas.width = doc.width; maskCanvas.height = doc.height;
        const context = maskCanvas.getContext('2d')!;
        // Comfy upload/mask reads alpha: transparent pixels are the selected edit area.
        context.fillStyle = '#ffffff'; context.fillRect(0, 0, doc.width, doc.height);
        const selection = window.document.createElement('canvas'); selection.width = doc.width; selection.height = doc.height;
        const selectionContext = selection.getContext('2d')!; drawMask(selectionContext, doc.mask);
        const pixels = selectionContext.getImageData(0, 0, doc.width, doc.height).data;
        let hasSelection = false; for (let alpha = 3; alpha < pixels.length; alpha += 4) if (pixels[alpha] > 0) { hasSelection = true; break; }
        if (!hasSelection) throw new Error('The edit mask is empty. Paint an area or clear the mask to edit the whole image.');
        context.globalCompositeOperation = 'destination-out'; context.drawImage(selection, 0, 0);
        mask = await canvasBlob(maskCanvas);
      }
      await onAIEdit({ image, mask, prompt: prompt.trim(), width: doc.width, height: doc.height, sourceAssetId: doc.sourceAssetId, operation: mask ? 'inpaint' : 'image-edit', document: doc });
      setMessage('Edit submitted. Follow its progress in the queue.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The edit could not be submitted.'); } finally { setBusy(false); }
  }
  function reorder(direction: -1 | 1) {
    const index = doc.layers.findIndex(item => item.id === activeLayer); const target = index + direction;
    if (index < 0 || target < 0 || target >= doc.layers.length) return;
    const layers = [...doc.layers]; [layers[index], layers[target]] = [layers[target], layers[index]]; history.apply({ ...doc, layers });
  }
  function reset() { history.apply(blankImageDocument()); setActiveLayer(null); setCrop(null); }

  return <section className="ed-workspace" aria-label="Image editor">
    <div className="ed-topbar"><div className="ed-heading"><strong>Image editor</strong></div><div className="ed-actions">
      <button onClick={history.undo} disabled={!history.canUndo} title="Undo" aria-label="Undo image edit"><Undo2 size={16} /></button><button onClick={history.redo} disabled={!history.canRedo} title="Redo" aria-label="Redo image edit"><Redo2 size={16} /></button>
      <button onClick={() => jsonDownload(doc, 'tye-image-document.json')}><span>Save document</span></button>
      <button className="ed-primary" onClick={exportPNG} disabled={busy || !doc.layers.length}>{busy ? 'Working…' : 'Export PNG'}</button>
    </div></div>
    <div className="ed-editor-layout">
      <aside className="ed-toolrail" aria-label="Canvas tools">
        {([{ id: 'move', icon: MousePointer2, label: 'Move layer' }, { id: 'paint', icon: Brush, label: 'Paint edit mask' }, { id: 'erase', icon: Eraser, label: 'Erase edit mask' }, { id: 'crop', icon: Crop, label: 'Crop canvas' }] as const).map(item => <button key={item.id} className={tool === item.id ? 'active' : ''} onClick={() => setTool(item.id)} title={item.label} aria-label={item.label} aria-pressed={tool === item.id}><item.icon size={19} /></button>)}
        <button onClick={() => { const id = editorId('text'); history.apply({ ...doc, layers: [...doc.layers, { id, name: 'Text layer', kind: 'text', text: 'Text', x: 64, y: 64, width: Math.max(160, doc.width - 128), height: 100, fontSize: 56, color: '#ffffff', rotation: 0, opacity: 1, visible: true }] }); setActiveLayer(id); }} title="Add text layer" aria-label="Add text layer"><Type size={19} /></button>
        <button onClick={() => setShowLibrary(!showLibrary)} title="Add image from library" aria-label="Add image from library"><ImagePlus size={19} /></button>
      </aside>
      <main className="ed-main-stage">
        <div className="ed-contextbar"><span>{tool === 'move' ? 'Drag a layer to reposition' : tool === 'crop' ? 'Drag to select crop bounds' : tool === 'paint' ? 'Paint the area you want to change' : 'Remove areas from the edit mask'}</span><span>{doc.width} × {doc.height}</span></div>
        <div className="ed-stage" ref={stageRef}>
          {!doc.layers.length ? <div className="ed-empty"><h2>Edit an image</h2><p>Choose an image from your library or import a file.</p><button className="ed-primary" onClick={() => imageAssets.length ? setShowLibrary(true) : onImport ? onImport() : setShowLibrary(true)}><Plus size={16} />{imageAssets.length ? 'Choose an image' : 'Import an image'}</button></div>
          : <div className="ed-artboard" style={{ width: Math.max(48, Math.min(doc.width, stageSize.width, stageSize.height * doc.width / doc.height)), aspectRatio: `${doc.width}/${doc.height}` }}>
            <canvas ref={canvasRef} aria-label="Image composition" />
            <canvas ref={maskRef} className="ed-mask-overlay" style={{ cursor: tool === 'move' ? 'move' : 'crosshair', opacity: .45 }} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} aria-label="Paint mask or move selected layer" />
            {tool === 'move' && layer && <div className="ed-selection" style={{ left: `${layer.x / doc.width * 100}%`, top: `${layer.y / doc.height * 100}%`, width: `${layer.width / doc.width * 100}%`, height: `${layer.height / doc.height * 100}%`, transform: `rotate(${layer.rotation}deg)` }}><i /><i /><i /><i /></div>}
            {tool === 'crop' && crop && <div className="ed-crop-selection" style={{ left: `${crop.x / doc.width * 100}%`, top: `${crop.y / doc.height * 100}%`, width: `${crop.width / doc.width * 100}%`, height: `${crop.height / doc.height * 100}%` }} />}
          </div>}
        </div>
        {tool === 'crop' && crop && <div className="ed-floating-controls"><span>{Math.round(crop.width)} × {Math.round(crop.height)}</span><button onClick={() => setCrop(null)}><X size={15} />Cancel</button><button className="ed-primary" disabled={crop.width < 2 || crop.height < 2} onClick={() => { history.apply(cropImageDocument(doc, crop)); setCrop(null); setTool('move'); }}><Check size={15} />Apply crop</button></div>}
        {message && <div className="ed-status" role="status">{message}</div>}
      </main>
      <aside className="ed-inspector">
        <div className="ed-panel-section"><div className="ed-section-title">{tool === 'paint' || tool === 'erase' ? 'Edit mask' : 'Layer properties'}</div>
          {(tool === 'paint' || tool === 'erase') ? <><label className="ed-label">Brush size <span>{brush}px</span><input type="range" min={4} max={220} value={brush} onChange={event => setBrush(Number(event.target.value))} /></label><button onClick={() => setShowMask(!showMask)}>{showMask ? <EyeOff size={15} /> : <Eye size={15} />}{showMask ? 'Hide mask' : 'Show mask'}</button><button onClick={() => history.apply({ ...doc, mask: [] })} disabled={!doc.mask.length}><Trash2 size={15} />Clear mask</button></>
          : layer ? <><label className="ed-label">Layer name<input value={layer.name} onChange={event => updateLayer({ name: event.target.value })} /></label><div className="ed-field-grid">{(['x', 'y', 'width', 'height'] as const).map(field => <label className="ed-label" key={field}>{field === 'x' ? 'Position X' : field === 'y' ? 'Position Y' : field}<input type="number" value={Math.round(layer[field])} onChange={event => updateLayer({ [field]: field === 'width' || field === 'height' ? clamp(Number(event.target.value), 1, 16384) : Number(event.target.value) })} /></label>)}</div><label className="ed-label">Rotation <span>{layer.rotation}°</span><input type="range" min={-180} max={180} value={layer.rotation} onChange={event => updateLayer({ rotation: Number(event.target.value) })} /></label><label className="ed-label">Opacity <span>{Math.round(layer.opacity * 100)}%</span><input type="range" min={0} max={1} step={.01} value={layer.opacity} onChange={event => updateLayer({ opacity: Number(event.target.value) })} /></label>{layer.kind === 'text' && <><label className="ed-label">Text<textarea value={layer.text || ''} onChange={event => updateLayer({ text: event.target.value })} /></label><div className="ed-field-grid"><label className="ed-label">Size<input type="number" min={8} max={400} value={layer.fontSize} onChange={event => updateLayer({ fontSize: clamp(Number(event.target.value), 8, 400) })} /></label><label className="ed-label">Color<input type="color" value={layer.color} onChange={event => updateLayer({ color: event.target.value })} /></label></div></>}</>
          : <p className="ed-help">Choose a layer or add an image to start editing.</p>}
        </div>
        <div className="ed-panel-section"><div className="ed-section-title">Layers <span>{doc.layers.length}</span></div><div className="ed-layer-list">{[...doc.layers].reverse().map(item => <div className={`ed-layer-row ${activeLayer === item.id ? 'selected' : ''}`} key={item.id}><button className="ed-layer-name" onClick={() => { setActiveLayer(item.id); setTool('move'); }}>{item.kind === 'text' ? <Type size={15} /> : <Layers size={15} />}<span>{item.name}</span></button><button aria-label={`${item.visible ? 'Hide' : 'Show'} ${item.name}`} onClick={() => history.apply({ ...doc, layers: doc.layers.map(current => current.id === item.id ? { ...current, visible: !current.visible } : current) })}>{item.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button></div>)}</div><div className="ed-actions"><button onClick={() => setShowLibrary(true)}><Plus size={14} />Add</button><button onClick={() => reorder(1)} disabled={!layer} title="Bring layer forward" aria-label="Bring layer forward"><ArrowUp size={14} /></button><button onClick={() => reorder(-1)} disabled={!layer} title="Send layer backward" aria-label="Send layer backward"><ArrowDown size={14} /></button><button disabled={!layer} title="Delete selected layer" aria-label="Delete selected layer" onClick={() => { history.apply({ ...doc, layers: doc.layers.filter(item => item.id !== activeLayer) }); setActiveLayer(null); }}><Trash2 size={14} /></button></div></div>
        <div className="ed-panel-section"><div className="ed-section-title">Canvas bounds</div><form key={`${doc.width}:${doc.height}`} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); history.apply(resizeImageCanvas(doc, Number(form.get('width')), Number(form.get('height')))); }}><div className="ed-field-grid"><label className="ed-label">Width<input name="width" aria-label="Canvas width" type="number" min={16} max={8192} defaultValue={doc.width} required /></label><label className="ed-label">Height<input name="height" aria-label="Canvas height" type="number" min={16} max={8192} defaultValue={doc.height} required /></label></div><button type="submit" className="ed-full">Resize canvas</button></form><p className="ed-help">Expand the canvas, then mask the new area for an AI edit.</p></div>
        <div className="ed-panel-section"><div className="ed-section-title">AI edit</div><textarea className="ed-prompt" placeholder="Describe what should change…" value={prompt} onChange={event => setPrompt(event.target.value)} aria-label="Image edit instructions" /><button className="ed-primary ed-full" disabled={!operationAvailable || !onAIEdit || !doc.layers.length || !prompt.trim() || busy} onClick={submitEdit}><Sparkles size={15} />{editOperation === 'inpaint' ? 'Generate masked edit' : 'Generate image edit'}</button>{!operationAvailable && <p className="ed-help">{aiEditAvailable ? `The selected recipe does not support ${editOperation === "inpaint" ? "masked edits. Clear the mask or choose a compatible recipe." : "instruction editing. Choose an image edit recipe."}` : aiEditUnavailableReason}</p>}</div>
        <div className="ed-panel-section"><button onClick={reset} disabled={!doc.layers.length}><RotateCcw size={14} />New canvas</button></div>
      </aside>
    </div>
    {showLibrary && <div className="ed-modal-backdrop" onClick={() => setShowLibrary(false)}><div className="ed-modal" role="dialog" aria-modal="true" aria-label="Choose image" onClick={event => event.stopPropagation()}><div className="ed-modal-header"><h2>Add from your library</h2><button onClick={() => setShowLibrary(false)} aria-label="Close image picker"><X size={18} /></button></div><p className="ed-help">Add an image as a new layer.</p>{imageAssets.length ? <div className="ed-asset-grid">{imageAssets.map(asset => <button key={asset.id} onClick={() => addAsset(asset)}><img src={asset.thumbnailUrl || asset.url} alt="" /><span>{asset.name}</span></button>)}</div> : <div className="ed-empty"><ImagePlus size={32} /><p>No images in your library. Import an image to continue.</p></div>}</div></div>}
  </section>;
}
