'use client';
/* eslint-disable @next/next/no-img-element -- Library and workflow thumbnails retain original local/blob asset URLs. */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, applyNodeChanges, type Node, type NodeProps, type Connection } from '@xyflow/react';
import { AudioLines, Download, Film, LockKeyhole, Play, Plus, Redo2, Sparkles, Trash2, Type, Undo2, Upload, X } from 'lucide-react';
import { blankWorkflowDocument, editorId, exportComfyGraph, importWorkflowJson, resolveWorkflowOperation, workflowConnectionError, workflowInputs, type EditorAsset, type WorkflowDocument, type WorkflowExecutionRequest, type WorkflowNodeData, type WorkflowOperation } from './editor-model';
import { downloadBlob, jsonDownload } from './editor-utils';
import { useDocumentHistory } from './use-document-history';
import '@xyflow/react/dist/style.css';
import './editors.css';

export interface WorkflowEditorProps {
  assets: EditorAsset[]; document?: WorkflowDocument; onChange?: (document: WorkflowDocument) => void; onImport?: () => void;
  onExecute?: (request: WorkflowExecutionRequest) => Promise<{ jobId?: string; message?: string } | void>;
  executionAvailable?: boolean; executionUnavailableReason?: string;
}
type FlowNode = Node<WorkflowNodeData, 'studio'>;
const operationNames: Record<WorkflowOperation, string> = { 'image-generate': 'Generate image', 'image-edit': 'Edit image', 'video-generate': 'Animate image', upscale: 'Upscale image', export: 'Export media' };
const StudioNode = memo(function StudioNode({ data, selected, id }: NodeProps<FlowNode>) {
  const inputs = data.kind === 'comfy' ? (Array.isArray(data.inputNames) ? data.inputNames : []).map(name => ({ id: String(name), type: 'unknown', label: String(name) })) : workflowInputs({ id, position: { x: 0, y: 0 }, data });
  return <div style={{ minHeight: Math.max(143, 82 + inputs.length * 26) }} className={`ed-flow-node ${selected ? 'selected' : ''} ed-port-${data.output}`}>
    <div className="ed-flow-node-header"><strong>{data.label}</strong><span>{data.output}</span></div>{typeof data.previewUrl === 'string' && data.previewUrl ? <img className="ed-flow-thumbnail" src={data.previewUrl} alt="" /> : (data.kind === 'text' || data.kind === 'comfy') ? <p>{data.kind === 'text' ? data.text || 'Write a prompt in the inspector.' : data.classType}</p> : null}
    {inputs.map((input, index) => <div key={input.id} className="ed-flow-input" style={{ top: 57 + index * 26 }}><Handle type="target" position={Position.Left} id={input.id} isConnectable={data.kind !== 'comfy'} /><span>{input.label}</span></div>)}
    <Handle type="source" position={Position.Right} id="out" isConnectable={data.kind !== 'comfy'} />
  </div>;
});
const nodeTypes = { studio: StudioNode };

export function WorkflowEditor({ assets, document: external, onChange, onImport, onExecute, executionAvailable = false, executionUnavailableReason = 'Connect a compatible Comfy engine to run an operation.' }: WorkflowEditorProps) {
  const history = useDocumentHistory(blankWorkflowDocument, external, onChange); const doc = history.value;
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>([]); const [selected, setSelected] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false); const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState(''); const [message, setMessage] = useState('');
  const [executing, setExecuting] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const selectedNode = doc.nodes.find(node => node.id === selected);
  const selectedAsset = assets.find(asset => asset.id === selectedNode?.data.assetId);
  const selectedExecution = useMemo((): { request?: WorkflowExecutionRequest; error?: string } => {
    if (!selected || doc.importKind || selectedNode?.data.kind !== 'operation') return {};
    try { return { request: resolveWorkflowOperation(doc, selected) }; }
    catch (error) { return { error: error instanceof Error ? error.message : 'Operation inputs are invalid.' }; }
  }, [doc, selected, selectedNode?.data.kind]);
  const enrichedNodes = useMemo(() => doc.nodes.map(node => {
    const asset = assets.find(item => item.id === node.data.assetId);
    return { ...node, type: 'studio' as const, data: { ...node.data, previewUrl: asset?.thumbnailUrl || (asset?.type === 'image' ? asset.url : '') }, deletable: !doc.importKind, connectable: !doc.importKind };
  }), [doc.nodes, doc.importKind, assets]);
  useEffect(() => setFlowNodes(enrichedNodes), [enrichedNodes]);
  const scalarInputs: Record<string, unknown> = useMemo(() => {
    if (doc.importKind !== 'comfy-api' || !doc.originalComfyJson || !selected) return {};
    try { return JSON.parse(doc.originalComfyJson)[selected]?.inputs || {}; } catch { return {}; }
  }, [doc.importKind, doc.originalComfyJson, selected]);

  function addNode(data: WorkflowNodeData) {
    const position = { x: 80 + doc.nodes.length % 3 * 280, y: 60 + Math.floor(doc.nodes.length / 3) * 210 };
    const node = { id: editorId('node'), position, data }; history.apply({ ...doc, nodes: [...doc.nodes, node] }); setSelected(node.id); setShowAdd(false); setMessage('');
  }
  function patchNode(values: Partial<WorkflowNodeData>) { if (selectedNode) history.apply({ ...doc, nodes: doc.nodes.map(node => node.id === selectedNode.id ? { ...node, data: { ...node.data, ...values } } : node) }); }
  function removeNodes(ids: string[]) { history.apply({ ...doc, nodes: doc.nodes.filter(node => !ids.includes(node.id)), edges: doc.edges.filter(edge => !ids.includes(edge.source) && !ids.includes(edge.target)) }); if (ids.includes(selected || '')) setSelected(null); }
  function connection(connection: Connection) {
    if (!connection.source || !connection.target) return;
    const issue = workflowConnectionError(doc, connection.source, connection.target, connection.targetHandle);
    if (issue) { setMessage(issue); return; }
    history.apply({ ...doc, edges: [...doc.edges, { ...connection, id: editorId('edge') }] }); setMessage('Connection added.');
  }
  async function executeSelected() {
    if (!onExecute || !executionAvailable || !selectedExecution.request || executing) return;
    const request = selectedExecution.request;
    if (request.inputAssetIds.some(id => !assets.some(asset => asset.id === id))) { setMessage('An input asset is missing from the library. Relink it before running.'); return; }
    setExecuting(true); setMessage('Submitting the selected operation…');
    try {
      const result = await onExecute(request);
      setMessage(result?.jobId ? `Queued job ${result.jobId}. Follow its real progress in the queue. Outputs will appear in the library.` : result?.message || 'Execution request accepted. Check the queue for its status.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The operation could not be submitted.'); }
    finally { setExecuting(false); }
  }
  function importGraph(text: string) {
    try { const next = importWorkflowJson(text); history.apply(next); setSelected(null); setShowImport(false); setImportText(''); setMessage(next.importKind ? 'Comfy JSON preserved. Imported topology is locked; supported scalar inputs can be edited in API graphs.' : 'Workflow imported.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Invalid workflow.'); }
  }
  function exportComfy(original = false) {
    try {
      const value = original ? doc.originalComfyJson! : exportComfyGraph(doc);
      downloadBlob(new Blob([value], { type: 'application/json' }), original ? 'original-comfy-workflow.json' : 'edited-comfy-api-workflow.json');
      setMessage(original ? 'Original Comfy JSON downloaded without modification.' : 'Comfy API JSON exported with scalar overrides. Validate it in the intended ComfyUI installation before running.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Export failed.'); }
  }

  return <section className="ed-workspace" aria-label="Workflow editor">
    <div className="ed-topbar"><div className="ed-heading"><strong>Workflow</strong></div><div className="ed-actions"><button onClick={history.undo} disabled={!history.canUndo} aria-label="Undo workflow edit" title="Undo"><Undo2 size={16} /></button><button onClick={history.redo} disabled={!history.canRedo} aria-label="Redo workflow edit" title="Redo"><Redo2 size={16} /></button><button onClick={() => setShowImport(true)}>Import JSON</button><button onClick={() => jsonDownload(doc, 'tye-workflow.json')}>Save graph</button><button className="ed-primary" onClick={() => doc.importKind ? (history.apply(blankWorkflowDocument()), setSelected(null), setMessage('New native graph. Undo restores the imported document.')) : setShowAdd(true)}><Plus size={15} />{doc.importKind ? 'New graph' : 'Add node'}</button></div></div>
    <div className="ed-workflow-layout"><div className="ed-flow-surface">
      {doc.importKind && <div className="ed-flow-notice"><LockKeyhole size={14} />{doc.importKind === 'comfy-api' ? 'Comfy API import: scalar inputs are editable.' : 'Comfy UI import: edit the original in ComfyUI.'}</div>}
      <ReactFlow<FlowNode> nodes={flowNodes} edges={doc.edges.map(edge => ({ ...edge, animated: false, style: { stroke: '#85878c', strokeWidth: 1.5 }, deletable: !doc.importKind }))} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: .3 }} minZoom={.2} maxZoom={1.6}
        onNodesChange={changes => setFlowNodes(previous => applyNodeChanges(changes, previous))}
        onNodeDragStop={(_, dragged) => history.apply({ ...doc, nodes: doc.nodes.map(node => node.id === dragged.id ? { ...node, position: dragged.position } : node) })}
        onNodesDelete={nodes => { if (!doc.importKind) removeNodes(nodes.map(node => node.id)); }}
        onEdgesDelete={edges => { if (!doc.importKind) history.apply({ ...doc, edges: doc.edges.filter(edge => !edges.some(item => item.id === edge.id)) }); }}
        onNodeClick={(_, node) => setSelected(node.id)} onPaneClick={() => setSelected(null)} onConnect={connection} onConnectEnd={() => {}} colorMode="dark"
        isValidConnection={link => !workflowConnectionError(doc, link.source, link.target, link.targetHandle)}
        deleteKeyCode={doc.importKind ? null : ['Backspace', 'Delete']} proOptions={{ hideAttribution: false }}>
        <Background color="#ffffff0c" gap={24} size={1} /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={node => node.data.kind === 'operation' ? '#85878c' : '#55575b'} maskColor="#12131599" />
      </ReactFlow>
      {!doc.nodes.length && <div className="ed-flow-empty"><h2>Create a workflow</h2><p>Add an asset, prompt or operation, or import ComfyUI JSON.</p><div className="ed-actions"><button className="ed-primary" onClick={() => setShowAdd(true)}><Plus size={16} />Add node</button><button onClick={() => setShowImport(true)}><Upload size={16} />Import Comfy JSON</button></div></div>}
      {message && <div className="ed-status ed-flow-status" role="status">{message}</div>}
    </div><aside className="ed-inspector">
      <div className="ed-panel-section"><div className="ed-section-title">{selectedNode ? 'Node inspector' : 'Workflow'}</div>{selectedNode ? <>
        <label className="ed-label">Node name<input value={selectedNode.data.label} onChange={event => patchNode({ label: event.target.value })} /></label><p className="ed-help">{selectedNode.data.kind === 'comfy' ? selectedNode.data.classType : `Output: ${selectedNode.data.output}`}</p>
        {selectedNode.data.kind === 'text' && <label className="ed-label">Prompt text<textarea className="ed-tall-textarea" value={selectedNode.data.text || ''} placeholder="Describe an image, a scene or motion…" onChange={event => patchNode({ text: event.target.value })} /></label>}
        {selectedNode.data.kind === 'operation' && <><label className="ed-label">Operation<select value={selectedNode.data.operation} onChange={event => { const operation = event.target.value as WorkflowOperation; history.apply({ ...doc, edges: doc.edges.filter(edge => edge.target !== selectedNode.id && edge.source !== selectedNode.id), nodes: doc.nodes.map(node => node.id === selectedNode.id ? { ...node, data: { ...node.data, operation, label: operationNames[operation], output: operation === 'video-generate' ? 'video' : operation === 'export' ? 'any' : 'image' } } : node) }); }} >{Object.entries(operationNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p className="ed-help">Runs with connected prompts and library assets.</p>{selectedExecution.error && <p className="ed-inline-warning">{selectedExecution.error}</p>}<button className="ed-primary ed-full" disabled={!onExecute || !executionAvailable || !selectedExecution.request || executing} onClick={executeSelected}><Play size={14} />{executing ? 'Submitting…' : 'Run selected operation'}</button>{(!onExecute || !executionAvailable) && <p className="ed-help">{executionUnavailableReason}</p>}</>}
        {selectedAsset && <><p className="ed-selected-asset">{selectedAsset.name}</p></>}
        {doc.importKind === 'comfy-api' && Object.entries(scalarInputs).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)).map(([key, value]) => {
          const current = doc.scalarOverrides?.[selectedNode.id]?.[key] ?? value;
          const update = (next: string | number | boolean) => history.apply({ ...doc, scalarOverrides: { ...doc.scalarOverrides, [selectedNode.id]: { ...doc.scalarOverrides?.[selectedNode.id], [key]: next } } });
          return <label className="ed-label" key={key}>{key}{typeof value === 'boolean' ? <select value={String(current)} onChange={event => update(event.target.value === 'true')}><option value="true">True</option><option value="false">False</option></select> : typeof value === 'number' ? <input type="number" value={String(current)} step="any" onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) update(next); }} /> : <textarea value={String(current)} onChange={event => update(event.target.value)} />}</label>;
        })}
        {!doc.importKind && <button onClick={() => removeNodes([selectedNode.id])}><Trash2 size={15} />Delete node</button>}
      </> : <p className="ed-help">Select a node to edit it. Connect outputs to matching inputs.</p>}</div>
      {doc.importKind && <div className="ed-panel-section"><div className="ed-section-title"><LockKeyhole size={15} />Comfy interoperability</div><p className="ed-help">Original JSON is preserved. Edit custom widgets and subgraphs in ComfyUI.</p><button onClick={() => exportComfy(true)}><Download size={14} />Export original JSON</button>{doc.importKind === 'comfy-api' && <button onClick={() => exportComfy()}><Download size={14} />Export scalar edits</button>}<p className="ed-help">Names and positions affect this preview only. Validate the original in ComfyUI before running.</p></div>}
      <div className="ed-panel-section"><div className="ed-section-title">Execution</div><p className="ed-help">Run one operation at a time, then connect its completed library asset to continue. Full graph execution is unavailable.</p></div>
    </aside></div>
    {showAdd && <div className="ed-modal-backdrop" onClick={() => setShowAdd(false)}><div className="ed-modal" role="dialog" aria-modal="true" aria-label="Add workflow node" onClick={event => event.stopPropagation()}><div className="ed-modal-header"><h2>Add node</h2><button aria-label="Close node picker" onClick={() => setShowAdd(false)}><X size={18} /></button></div><div className="ed-node-add-grid"><button onClick={() => addNode({ label: 'Prompt', kind: 'text', output: 'text', text: '' })}><Type size={22} /><strong>Prompt</strong></button>{Object.entries(operationNames).map(([operation, label]) => <button key={operation} onClick={() => addNode({ label, kind: 'operation', operation: operation as WorkflowOperation, output: operation === 'video-generate' ? 'video' : operation === 'export' ? 'any' : 'image' })}><Sparkles size={22} /><strong>{label}</strong></button>)}</div><div className="ed-section-title">Your assets</div><div className="ed-asset-grid">{assets.map(asset => <button key={asset.id} onClick={() => addNode({ label: asset.name, kind: 'asset', output: asset.type, assetId: asset.id })}>{asset.thumbnailUrl || asset.type === 'image' ? <img src={asset.thumbnailUrl || asset.url} alt="" /> : <div className="ed-asset-icon">{asset.type === 'audio' ? <AudioLines size={28} /> : <Film size={28} />}</div>}<span>{asset.name}</span></button>)}</div>{!assets.length && onImport && <button onClick={() => { setShowAdd(false); onImport(); }}><Upload size={15} />Import media into library</button>}</div></div>}
    {showImport && <div className="ed-modal-backdrop" onClick={() => setShowImport(false)}><div className="ed-modal" role="dialog" aria-modal="true" aria-label="Import workflow JSON" onClick={event => event.stopPropagation()}><div className="ed-modal-header"><h2>Import a workflow</h2><button aria-label="Close workflow import" onClick={() => setShowImport(false)}><X size={18} /></button></div><p className="ed-help">Import Tye or ComfyUI JSON. ComfyUI graphs are preserved, with scalar editing available for API graphs.</p><input type="file" accept=".json,application/json" ref={uploadRef} hidden onChange={event => { const file = event.target.files?.[0]; if (file) { if (file.size > 10 * 1024 * 1024) { setMessage('Workflow JSON must be smaller than 10 MB.'); return; } file.text().then(setImportText).catch(() => setMessage('File could not be read.')); } event.target.value = ''; }} /><button onClick={() => uploadRef.current?.click()}><Upload size={15} />Choose JSON file</button><textarea className="ed-json-input" aria-label="Workflow JSON" value={importText} onChange={event => setImportText(event.target.value)} placeholder="Or paste workflow JSON here…" spellCheck={false} /><div className="ed-actions"><button onClick={() => setShowImport(false)}>Cancel</button><button className="ed-primary" disabled={!importText.trim()} onClick={() => importGraph(importText)}>Import workflow</button></div><p className="ed-help" role="status">{message}</p></div></div>}
  </section>;
}
