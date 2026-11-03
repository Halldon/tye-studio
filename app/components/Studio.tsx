"use client";

/* Asset URLs can be authenticated API responses or local object URLs; keep originals unproxied. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle, ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CheckCircle2,
  ChevronDown, Clapperboard, Clock3, ExternalLink, FileJson, Film, FolderOpen, Heart,
  Image as ImageIcon, ImagePlus, KeyRound, LayoutGrid, Link2, List,
  Loader2, Menu, Minus, MoreHorizontal, Music2, PencilLine, Plus,
  RefreshCw, Scissors, Search, Server, Settings2, ShieldCheck,
  SlidersHorizontal, Sparkles, Trash2, Upload, Video, Workflow, X,
} from "lucide-react";
import type { Asset, Job, StudioController, Workspace } from "../lib/types";
import { Dialog as Modal } from "./studio/Dialog";
import { ModelPicker } from "./studio/ModelPicker";
import { AssetInspector } from "./studio/AssetInspector";
import { GenerationFeed } from "./studio/GenerationFeed";
import { CommandPalette } from "./studio/CommandPalette";
import { generationRuns, runMatches } from "./studio/studio-model";
import "./studio.css";

export interface StudioProps {
  controller: StudioController;
  renderEditor?: (controller: StudioController) => ReactNode;
  renderShots?: (controller: StudioController) => ReactNode;
  renderSequence?: (controller: StudioController) => ReactNode;
  renderWorkflow?: (controller: StudioController) => ReactNode;
}

const NAV: { id: Workspace; label: string; icon: typeof ImageIcon; group: "create" | "organize" }[] = [
  { id: "image", label: "Create image", icon: ImageIcon, group: "create" },
  { id: "video", label: "Create video", icon: Video, group: "create" },
  { id: "edit", label: "Edit image", icon: Scissors, group: "create" },
  { id: "shots", label: "Shots", icon: Clapperboard, group: "create" },
  { id: "sequence", label: "Sequence", icon: Film, group: "create" },
  { id: "workflows", label: "Workflows", icon: Workflow, group: "create" },
  { id: "library", label: "Library", icon: FolderOpen, group: "organize" },
  { id: "queue", label: "Queue", icon: Clock3, group: "organize" },
];
const STATUS_LABELS: Record<Job["status"], string> = {
  queued: "Queued", running: "Generating", canceling: "Canceling", succeeded: "Completed",
  failed: "Failed", canceled: "Canceled", submission_unknown: "Needs reconciliation",
};
const activeJob = (job: Job) => ["queued", "running", "canceling", "submission_unknown"].includes(job.status);
const dateLabel = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const durationLabel = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;

function BrandMark() {
  return <svg viewBox="0 0 30 30" width="29" height="29" fill="none" aria-hidden="true"><path d="M6 8.5h17.5M14.75 8.5v15M6 8.5v7a8.75 8.75 0 0 0 17.5 0v-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><path d="M10 4.5h9.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;
}

function EmptySection({ title, description, action, onAction }: { icon: typeof ImageIcon; title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className="studio-section-empty"><h2>{title}</h2><p>{description}</p>{action && <button className="studio-button" onClick={onAction}><Plus size={14} />{action}</button>}</div>;
}

function MediaCard({ asset, controller: c }: { asset: Asset; controller: StudioController }) {
  const Icon = asset.type === "video" ? Video : asset.type === "audio" ? Music2 : ImageIcon;
  return <article className="studio-media-card">
    <button className="studio-media-preview" onClick={() => c.openAsset(asset)} aria-label={`Open ${asset.name}`}>
      {asset.type === "image" ? <img src={asset.url} alt={asset.name} loading="lazy" /> : asset.type === "video" ? <video src={asset.url} preload="metadata" muted playsInline /> : <Music2 size={38} />}
      <div className="studio-media-overlay" /><span className="studio-media-type"><Icon size={12} />{asset.duration ? durationLabel(asset.duration) : asset.width && asset.height ? `${asset.width} × ${asset.height}` : asset.type}</span>
    </button>
    <button className={`studio-media-favorite ${asset.starred ? "is-favorite" : ""}`} onClick={() => void c.starAsset(asset)} aria-label={asset.starred ? `Unfavorite ${asset.name}` : `Favorite ${asset.name}`} aria-pressed={asset.starred}><Heart size={13} fill={asset.starred ? "currentColor" : "none"} /></button>
    <div className="studio-media-caption"><div><strong title={asset.name}>{asset.name}</strong><p>{asset.source === "generation" ? "Generated" : "Imported"} · {dateLabel(asset.createdAt)}</p></div><button className="studio-icon-button" aria-label={`View details for ${asset.name}`} onClick={() => c.openAsset(asset)}><MoreHorizontal size={16} /></button></div>
  </article>;
}

function SettingsView({ controller: c, importProject }: { controller: StudioController; importProject: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const isReady = c.engine?.connected && c.engine.capabilities.generation;
  return <div className="studio-settings"><div className="studio-view-header"><div><h1>Settings</h1></div></div>
    <section className="studio-settings-section"><div className="studio-settings-heading"><Server size={20} /><div><h2>ComfyUI engine</h2><p>Manage your generation connection.</p></div></div>
      <div className="studio-info-row"><span>Status</span><strong style={{ display: "flex", alignItems: "center", gap: 7 }}><span className={`studio-status-dot ${isReady ? "is-ready" : ""}`} />{isReady ? "Connection verified" : "Connection needed"}</strong></div><div className="studio-info-row"><span>Execution mode</span><strong>{c.engine?.mode ?? "Loading configuration"}</strong></div>{c.engine?.baseUrl && <div className="studio-info-row"><span>Endpoint</span><strong style={{ overflowWrap: "anywhere", maxWidth: "65%" }}>{c.engine.baseUrl}</strong></div>}
      <p className="studio-settings-note">{c.engine?.message ?? "Checking engine configuration…"}</p>
      <form onSubmit={event => { event.preventDefault(); void c.connectEngine(apiKey).then(() => setApiKey("")); }} style={{ marginTop: 22 }}><label className="studio-field"><span style={{ display: "flex", alignItems: "center", gap: 6 }}><KeyRound size={12} />Comfy API key</span><input className="studio-input" type="password" aria-label="Comfy API key" value={apiKey} autoComplete="off" onChange={event => setApiKey(event.target.value)} placeholder={c.engine?.apiKeyConfigured ? "An engine key is already configured" : "Paste your Comfy API key"} /><small>{c.engine?.connectionSaved && <span style={{ display: "block", color: "#b8c99c", marginBottom: 3 }}><ShieldCheck size={11} style={{ display: "inline", marginRight: 5, verticalAlign: "-2px" }} />Saved securely on this server</span>}{c.engine?.credentialStorageReady || c.engine?.connectionSaved ? "Key encrypted before storage; excluded from project exports." : "The key is held for this browser session only and excluded from project exports."}</small></label><div className="studio-settings-footer"><p>Self-hosted endpoint configuration is managed by the server operator.</p><div style={{ display: "flex", gap: 7 }}>{c.engine?.connected && <button type="button" className="studio-button" onClick={c.disconnectEngine}>Disconnect</button>}<button className="studio-button is-primary" disabled={c.busy}>{c.busy ? <Loader2 size={13} className="studio-spinner" /> : <Link2 size={13} />}{isReady ? "Check connection" : "Connect engine"}</button></div></div></form>
      <p className="studio-settings-note" style={{ margin: "18px 0 0" }}><a href="https://docs.comfy.org/" target="_blank" rel="noreferrer">ComfyUI documentation <ExternalLink size={10} style={{ display: "inline", marginLeft: 3 }} /></a></p>
    </section>
    {c.recipes.length > 0 && <section className="studio-settings-section"><div className="studio-settings-heading"><Workflow size={20} /><div><h2>Model workflows</h2><p>Each recipe keeps its own capabilities and setup requirements.</p></div></div>{c.recipes.map(recipe => <div key={recipe.id} className="studio-recipe-status"><div className="studio-info-row"><span style={{ color: "#c7cdd4" }}>{recipe.name}</span><strong>{recipe.availability === "available" ? "Ready" : recipe.availability === "missing-models" ? "Models needed" : recipe.availability === "unverified" ? "Check on engine" : "Connect engine"}</strong></div><p>{recipe.missingModels.length ? recipe.missingModels.join(", ") : recipe.description}</p><div><span>{recipe.license}</span><a href={recipe.sourceUrl} target="_blank" rel="noreferrer">Setup guide<ArrowUpRight size={11} /></a></div></div>)}</section>}
    <section className="studio-settings-section"><div className="studio-settings-heading"><FileJson size={20} /><div><h2>Project files</h2></div></div><p className="studio-settings-note">Export the current project with its media and editable documents, or bring a project back into your library.</p><div style={{ display: "flex", gap: 9, marginTop: 20, flexWrap: "wrap" }}><button className="studio-button" disabled={c.busy || !c.project} onClick={() => void c.exportProject()}><ArrowDownToLine size={14} />Export project</button><button className="studio-button" disabled={c.busy} onClick={importProject}><Upload size={14} />Import project</button></div></section>

  </div>;
}

function QueueView({ controller: c }: { controller: StudioController }) {
  const [filter, setFilter] = useState("all");
  const jobs = c.jobs.filter(job => filter === "all" || activeJob(job));
  return <><div className="studio-view-header"><div><h1>Queue</h1></div><div className="studio-view-tools"><div className="studio-segmented">{["all", "active"].map(value => <button key={value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)} aria-pressed={filter === value}>{value === "all" ? "All jobs" : "Active"}</button>)}</div><button className="studio-icon-button" onClick={() => void c.refresh()} disabled={c.busy} aria-label="Refresh queue"><RefreshCw size={15} className={c.busy ? "studio-spinner" : ""} /></button></div></div>
    {!jobs.length ? <EmptySection icon={Clock3} title={filter === "active" ? "No active generations" : "No generations yet"} description="Submitted jobs and their results will appear here." action="Create an image" onAction={() => c.setWorkspace("image")} /> : <div className="studio-queue-list">{jobs.map(job => {
      const recipe = c.recipes.find(value => value.id === job.recipeId);
      const canCancel = ["queued", "running"].includes(job.status) && c.engine?.capabilities.cancellation;
      return <article className="studio-job" key={job.id}><div className="studio-job-icon">{job.status === "running" ? <Loader2 size={20} className="studio-spinner" /> : job.status === "succeeded" ? <CheckCircle2 size={20} /> : job.status === "failed" ? <AlertCircle size={20} /> : recipe?.kind === "video" ? <Video size={20} /> : <ImageIcon size={20} />}</div><div className="studio-job-content"><div className="studio-job-title"><strong>{recipe?.name ?? "Generation"}</strong><span className={`studio-job-status ${job.status === "succeeded" ? "is-completed" : job.status === "failed" ? "is-failed" : ""}`}>{STATUS_LABELS[job.status]}</span></div><p>{job.prompt}</p>{job.error && <p className="studio-job-error">{job.error.message}</p>}{job.status === "submission_unknown" && <p className="studio-job-error">The engine has not confirmed this submission. Refresh status before starting it again.</p>}{job.progress !== null && job.status === "running" && <div className="studio-job-progress" role="progressbar" aria-label="Generation progress" aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, Math.max(0, job.progress * 100))}%` }} /></div>}<div className="studio-job-meta">{dateLabel(job.createdAt)}{job.stage ? ` · ${job.stage}` : ""}{job.progress !== null && job.status === "running" ? ` · ${Math.round(job.progress * 100)}%` : ""}</div></div><div className="studio-job-actions">{job.status === "succeeded" && job.outputAssetIds[0] && <button className="studio-button" onClick={() => { const asset = c.allAssets.find(value => value.id === job.outputAssetIds[0]); if (asset) c.openAsset(asset); }}><ArrowUpRight size={13} />View</button>}{canCancel && <button className="studio-button" disabled={c.busy} onClick={() => void c.cancelJob(job.id)}>Cancel</button>}{["failed", "canceled"].includes(job.status) && <button className="studio-button" disabled={c.busy} onClick={() => void c.retryJob(job)}><RefreshCw size={12} />Retry</button>}{job.status === "submission_unknown" && <button className="studio-button" disabled={c.busy} onClick={() => void c.retryJob(job)}><RefreshCw size={12} />Check submission</button>}</div></article>;
    })}</div>}
  </>;
}

export function Studio({ controller: c, renderEditor, renderShots, renderSequence, renderWorkflow }: StudioProps) {
  const [mobileNav, setMobileNav] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);
  const [projectDialog, setProjectDialog] = useState<"create" | "rename" | null>(null);
  const [projectName, setProjectName] = useState("");
  const [modelPicker, setModelPicker] = useState(false);
  const [compatiblePicker, setCompatiblePicker] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [composerDragging, setComposerDragging] = useState(false);
  const [composerHeight, setComposerHeight] = useState(180);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [compact, setCompact] = useState(false);
  const [search, setSearch] = useState("");
  const [searchWorkspace, setSearchWorkspace] = useState<Workspace>(c.workspace);
  const [mediaFilter, setMediaFilter] = useState("all");
  const [deleteAsset, setDeleteAsset] = useState<Asset | null>(null);
  const [referencePicker, setReferencePicker] = useState(false);
  const [dragging, setDragging] = useState(false);
  const mediaInput = useRef<HTMLInputElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const composerDock = useRef<HTMLDivElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const recipe = c.recipes.find(value => value.id === c.draft.recipeId);
  const isVideo = c.workspace === "video";
  const editableDimensions = !recipe || recipe.capabilities.includes("dimensions");
  const supportsNegativePrompt = recipe?.capabilities.includes("negative-prompt");
  const isComposer = c.workspace === "image" || isVideo;
  const isEditor = ["edit", "shots", "sequence", "workflows"].includes(c.workspace);
  const ready = Boolean(c.engine?.connected && c.engine.capabilities.generation);
  const referenceAssets = c.draft.inputAssetIds.map(id => c.allAssets.find(asset => asset.id === id)).filter((asset): asset is Asset => Boolean(asset));
  const missingReferenceIds = c.draft.inputAssetIds.filter(id => !c.allAssets.some(asset => asset.id === id));
  const incompatibleReferences = c.draft.inputAssetIds.length > (recipe?.maxInputs ?? 0);
  const currentAssets = c.workspace === "library" ? c.assets : c.assets.filter(asset => asset.type === (isVideo ? "video" : "image"));
  const effectiveSearch = searchWorkspace === c.workspace ? search : "";
  const effectiveFilter = c.workspace === "library" ? mediaFilter : "all";
  const filteredAssets = currentAssets.filter(asset => asset.name.toLowerCase().includes(effectiveSearch.toLowerCase()) && (effectiveFilter === "all" || effectiveFilter === "starred" && asset.starred || asset.type === effectiveFilter));
  const activeJobs = c.jobs.filter(activeJob);
  const runs = generationRuns(c.jobs, c.allAssets, c.recipes, c.selectedProjectId, isVideo ? "video" : "image");
  const visibleRuns = runs.filter(run => runMatches(run, effectiveSearch));
  const outputIds = new Set(runs.flatMap(run => run.outputs.map(asset => asset.id)));
  const mediaAssets = filteredAssets.filter(asset => !outputIds.has(asset.id));
  const inspecting = Boolean(c.selectedAsset && ["image", "video", "library"].includes(c.workspace));
  const canGenerate = ready && Boolean(recipe) && !["missing-models", "not-configured"].includes(recipe?.availability ?? "not-configured") && c.draft.prompt.trim().length > 0 && !incompatibleReferences && missingReferenceIds.length === 0 && (!recipe?.requiresInput || referenceAssets.length > 0);

  useEffect(() => {
    const dock = composerDock.current;
    if (!isComposer || !dock || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => { const height = Math.ceil(entries[0]?.contentRect.height ?? 0); setComposerHeight(previous => previous === height ? previous : height); });
    observer.observe(dock);
    return () => observer.disconnect();
  }, [isComposer]);

  useEffect(() => {
    function outside(event: PointerEvent) { if (projectMenuRef.current && !projectMenuRef.current.contains(event.target as Node)) setProjectMenu(false); }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") { setProjectMenu(false); setMobileNav(false); } }
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  useEffect(() => {
    if (!c.notice || c.error) return;
    const timer = window.setTimeout(c.dismissMessage, 5000);
    return () => window.clearTimeout(timer);
  }, [c.notice, c.error, c.dismissMessage]);

  useEffect(() => {
    function command(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (document.querySelector("dialog[open]") && !paletteOpen) return;
        setPaletteOpen(value => !value);
      }
    }
    window.addEventListener("keydown", command);
    return () => window.removeEventListener("keydown", command);
  }, [paletteOpen]);

  async function attachImages(files: File[] | FileList) {
    setAttachmentError(null);
    try { await c.attachFiles(files); }
    catch (issue) { setAttachmentError(issue instanceof Error ? issue.message : "The image could not be attached."); }
  }
  function chooseCompatible() { setCompatiblePicker(true); setModelPicker(true); }
  function navigate(workspace: Workspace) {
    if ((workspace === "image" || workspace === "video") && recipe?.kind !== workspace) { const target = c.recipes.find(value => value.kind === workspace); if (target) c.selectRecipe(target.id); }
    if (workspace !== "edit") c.setSelectedAsset(null);
    c.setWorkspace(workspace); setProjectMenu(false); setMobileNav(false); setSearch(""); setMediaFilter("all");
  }
  function newProject() { setProjectName(""); setProjectDialog("create"); setProjectMenu(false); }
  function upload() { mediaInput.current?.click(); }
  function addReference(asset: Asset) { c.attachAssets([asset]); setReferencePicker(false); }
  function setAspect(value: string) {
    const sizes: Record<string, [number, number]> = { "1:1": [1024, 1024], "16:9": [1344, 768], "9:16": [768, 1344], "4:3": [1152, 896], "3:4": [896, 1152] };
    const videoSizes: Record<string, [number, number]> = { "1:1": [768, 768], "16:9": [1024, 576], "9:16": [576, 1024], "4:3": [1024, 768], "3:4": [768, 1024] };
    const dimensions = (isVideo ? videoSizes : sizes)[value];
    c.updateDraft({ aspectRatio: value, ...(dimensions ? { width: dimensions[0], height: dimensions[1] } : {}) });
  }
  function generate() { if (!ready) navigate("settings"); else if (!recipe) setModelPicker(true); else if (canGenerate && !c.busy) void c.generate(); }
  function focusPrompt() { promptInput.current?.focus(); }
  function selectVideo() { const videoRecipe = c.recipes.find(value => value.kind === "video"); if (videoRecipe) c.selectRecipe(videoRecipe.id); navigate("video"); }
  const libraryHeader = c.workspace === "library";

  return <div className="tye-studio" onDragEnter={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current += 1; setDragging(true); } }} onDragLeave={event => { event.preventDefault(); dragDepth.current -= 1; if (dragDepth.current <= 0) setDragging(false); }} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (event.dataTransfer.files.length) void c.importFiles(event.dataTransfer.files); }}>
    <input ref={mediaInput} hidden type="file" multiple accept="image/*,video/*,audio/*" onChange={event => { if (event.target.files?.length) void c.importFiles(event.target.files); event.target.value = ""; }} />
    <input ref={attachmentInput} hidden type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { if (event.target.files?.length) void attachImages(event.target.files); event.target.value = ""; }} />
    <input ref={projectInput} hidden type="file" accept=".zip,.tye,.json,application/json,application/zip" onChange={event => { const file = event.target.files?.[0]; if (file) void c.importProject(file); event.target.value = ""; }} />
    {mobileNav && <button onClick={() => setMobileNav(false)} aria-label="Close navigation" style={{ position: "fixed", inset: 0, zIndex: 60, background: "#0008", border: 0 }} />}
    <aside className={`studio-sidebar ${mobileNav ? "is-open" : ""}`}><a className="studio-brand" href="#" onClick={event => { event.preventDefault(); navigate("image"); }} aria-label="Tye Studio home"><span className="studio-brandmark"><BrandMark /></span><span className="studio-brand-word">tye<span>studio</span></span></a><nav className="studio-nav" aria-label="Creative tools">{NAV.filter(item => item.group === "create").map(item => <button key={item.id} className={c.workspace === item.id ? "is-active" : ""} onClick={() => navigate(item.id)} title={item.label} aria-current={c.workspace === item.id ? "page" : undefined}><item.icon size={17} /><span>{item.label}</span></button>)}</nav><div className="studio-nav-group-gap" /><nav className="studio-nav" aria-label="Workspace">{NAV.filter(item => item.group === "organize").map(item => <button key={item.id} className={c.workspace === item.id ? "is-active" : ""} onClick={() => navigate(item.id)} title={item.label} aria-current={c.workspace === item.id ? "page" : undefined}><item.icon size={17} /><span>{item.label}</span>{item.id === "queue" && activeJobs.length > 0 && <span className="studio-count">{activeJobs.length}</span>}</button>)}</nav><div className="studio-nav-spacer" /><nav className="studio-nav" aria-label="Configuration"><button onClick={() => navigate("settings")} className={c.workspace === "settings" ? "is-active" : ""} title="Settings"><Settings2 size={17} /><span>Settings</span></button></nav><button className="studio-engine-card" onClick={() => navigate("settings")} title={ready ? "API connection verified" : "Connect your ComfyUI engine"}><span className="studio-engine-title"><span className={`studio-status-dot ${ready ? "is-ready" : ""}`} /><span>{ready ? "API connected" : "Connect engine"}</span></span></button><div className="studio-sidebar-footer"><a href="https://docs.comfy.org/" target="_blank" rel="noreferrer">Documentation<ArrowUpRight size={12} /></a></div></aside>
    <main className={`studio-main ${inspecting ? "has-inspector" : ""}`}><header className="studio-header"><div className="studio-breadcrumb"><button className="studio-icon-button studio-mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19} /></button><div className="studio-project-switcher" ref={projectMenuRef}><button className="studio-project-trigger" onClick={() => setProjectMenu(!projectMenu)} aria-expanded={projectMenu} aria-haspopup="menu"><span>{c.project?.name ?? "Your workspace"}</span><ChevronDown size={13} /></button>{projectMenu && <div className="studio-project-menu" role="menu" onKeyDown={event => { if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button")); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length; buttons[next]?.focus(); } }}>{c.projects.map(project => <button key={project.id} className={c.selectedProjectId === project.id ? "is-selected" : ""} role="menuitem" onClick={() => { c.selectProject(project.id); setProjectMenu(false); }}><FolderOpen size={13} /><span>{project.name}</span>{c.selectedProjectId === project.id && <Check size={12} />}</button>)}<div className="studio-project-divider" /><button role="menuitem" onClick={newProject}><Plus size={13} />New project</button>{c.project && <button role="menuitem" onClick={() => { setProjectName(c.project?.name ?? ""); setProjectDialog("rename"); setProjectMenu(false); }}><PencilLine size={13} />Rename project</button>}<button role="menuitem" onClick={() => { projectInput.current?.click(); setProjectMenu(false); }}><Upload size={13} />Import project</button></div>}</div></div><div className="studio-header-actions"><button className="studio-button studio-command-trigger" aria-label="Open search and commands" onClick={() => setPaletteOpen(true)}><Search size={14} /><span>Search</span><kbd>⌘ K</kbd></button><button className="studio-icon-button" onClick={() => void c.refresh()} disabled={c.busy} aria-label="Refresh workspace" title="Refresh workspace"><RefreshCw size={15} className={c.busy ? "studio-spinner" : ""} /></button><button className="studio-button" onClick={upload} disabled={c.busy} title="Import images, video or audio, up to 20 MB per file"><Upload size={13} />Import media</button></div></header>
      <div className={`studio-workspace ${isEditor ? "is-editor" : !isComposer ? "is-standard" : ""}`} style={isComposer ? { paddingBottom: composerHeight + 48 } : undefined}>
        {c.loading && !c.data ? <EmptySection icon={Loader2} title="Opening your studio…" description="Loading your projects and creative tools." /> : c.workspace === "settings" ? <SettingsView controller={c} importProject={() => projectInput.current?.click()} /> : c.workspace === "queue" ? <QueueView controller={c} /> : c.workspace === "edit" ? renderEditor?.(c) ?? <EmptySection icon={Scissors} title="Start with an image" description="Import an image or choose one from your library to begin editing." action="Import image" onAction={upload} /> : c.workspace === "shots" ? renderShots?.(c) ?? <EmptySection icon={Clapperboard} title="Shots" description="Create and review takes for each shot." /> : c.workspace === "sequence" ? renderSequence?.(c) ?? <EmptySection icon={Film} title="Sequence" description="Bring images, video and audio together in an editable sequence." action="Import media" onAction={upload} /> : c.workspace === "workflows" ? renderWorkflow?.(c) ?? <EmptySection icon={Workflow} title="Workflows" description="Build reusable workflows from your media and ComfyUI recipes." /> : <>
          <div className="studio-view-header"><div><h1>{libraryHeader ? "Library" : isVideo ? "Create video" : "Create image"}</h1>{libraryHeader && <p>{`${c.assets.length} ${c.assets.length === 1 ? "asset" : "assets"} in this project`}</p>}</div><div className="studio-view-tools">{(currentAssets.length > 0 || runs.length > 0) && <div className="studio-search"><Search size={14} /><input className="studio-input" placeholder="Search assets" value={effectiveSearch} onChange={event => { setSearchWorkspace(c.workspace); setSearch(event.target.value); }} aria-label="Search assets and generation prompts" /></div>}{currentAssets.length > 0 && <div className="studio-segmented" aria-label="Grid density"><button className={!compact ? "is-active" : ""} onClick={() => setCompact(false)} aria-label="Comfortable grid" aria-pressed={!compact}><LayoutGrid size={14} /></button><button className={compact ? "is-active" : ""} onClick={() => setCompact(true)} aria-label="Compact grid" aria-pressed={compact}><List size={14} /></button></div>}</div></div>

          {libraryHeader && currentAssets.length > 0 && <div className="studio-segmented" style={{ width: "fit-content", marginBottom: 22 }} aria-label="Filter library">{[{ id: "all", label: "All media" }, { id: "image", label: "Images" }, { id: "video", label: "Video" }, { id: "audio", label: "Audio" }, { id: "starred", label: "Favorites" }].map(item => <button key={item.id} className={mediaFilter === item.id ? "is-active" : ""} onClick={() => setMediaFilter(item.id)} aria-pressed={mediaFilter === item.id}>{item.id === "starred" && <Heart size={10} />}{item.label}</button>)}</div>}
          {libraryHeader ? (filteredAssets.length > 0 ? <div className={`studio-media-grid ${compact ? "is-compact" : ""}`}>{filteredAssets.map(asset => <MediaCard asset={asset} controller={c} key={asset.id} />)}</div> : <EmptySection icon={FolderOpen} title={currentAssets.length ? "No matching assets" : "No assets yet"} description={currentAssets.length ? "Try a different search or media filter." : "Import images, video or audio up to 20 MB per file."} action={currentAssets.length ? undefined : "Import media"} onAction={upload} />) : (runs.length > 0 || currentAssets.length > 0) ? <>
            <GenerationFeed controller={c} kind={isVideo ? "video" : "image"} search={effectiveSearch} compact={compact} />
            {mediaAssets.length > 0 && <section className="studio-project-media"><h2>Media</h2><div className={`studio-media-grid ${compact ? "is-compact" : ""}`}>{mediaAssets.map(asset => <MediaCard asset={asset} controller={c} key={asset.id} />)}</div></section>}
            {!visibleRuns.length && !mediaAssets.length && <EmptySection icon={Search} title="No matching results" description="Search an asset name, generation prompt or model." />}
          </> : <div className="studio-empty"><div className="studio-starter-grid">
            <button className="studio-starter-card" onClick={() => { navigate("image"); focusPrompt(); }}><div className="studio-starter-visual"><img src="/graphics/create-image-v2.webp" width={768} height={512} alt="" decoding="async" /></div><div className="studio-starter-copy"><span className="studio-starter-title">Create image</span><p>Generate from a text prompt.</p></div></button>
            <button className="studio-starter-card" onClick={selectVideo}><div className="studio-starter-visual"><img src="/graphics/create-video-v2.webp" width={768} height={512} alt="" decoding="async" /></div><div className="studio-starter-copy"><span className="studio-starter-title">Create video</span><p>Animate an image or a scene.</p></div></button>
            <button className="studio-starter-card" onClick={() => navigate("edit")}><div className="studio-starter-visual"><img src="/graphics/edit-image-v2.webp" width={768} height={512} alt="" decoding="async" /></div><div className="studio-starter-copy"><span className="studio-starter-title">Edit image</span><p>Crop, layer and mask.</p></div></button>
          </div></div>}

        </>}
      </div>
      {isComposer && <div ref={composerDock} className="studio-composer-dock"><div className="studio-composer-wrap"><form className={`studio-composer ${composerDragging ? "is-dragging" : ""}`} onDragOver={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); setComposerDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setComposerDragging(false); }} onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); setComposerDragging(false); dragDepth.current = 0; if (event.dataTransfer.files.length) void attachImages(event.dataTransfer.files); }} onSubmit={event => { event.preventDefault(); generate(); }}>
        {c.draft.inputAssetIds.length > 0 && <div className="studio-reference-strip">{referenceAssets.map(asset => <div className="studio-reference-chip" key={asset.id} title={asset.name}>{asset.type === "image" ? <img src={asset.url} alt={asset.name} /> : <Video size={16} style={{ margin: 15, color: "#9ba5b1" }} />}<button type="button" aria-label={`Remove reference ${asset.name}`} onClick={() => c.updateDraft({ inputAssetIds: c.draft.inputAssetIds.filter(id => id !== asset.id) })}><X size={10} /></button></div>)}{missingReferenceIds.map(id => <div className="studio-reference-chip" key={id} title="This reference is unavailable"><AlertCircle size={18} style={{ margin: 14, color: "#d8b17f" }} /><button type="button" aria-label="Remove unavailable reference" onClick={() => c.updateDraft({ inputAssetIds: c.draft.inputAssetIds.filter(value => value !== id) })}><X size={10} /></button></div>)}<span className={incompatibleReferences || missingReferenceIds.length ? "studio-reference-warning" : "studio-reference-label"}>{missingReferenceIds.length ? "A reference is unavailable. Remove it or import the source again." : incompatibleReferences ? `This workflow supports ${recipe?.maxInputs ?? 0} references. Choose a compatible workflow or remove extras.` : `${referenceAssets.length} ${referenceAssets.length === 1 ? "reference" : "references"}`}</span>{incompatibleReferences && !missingReferenceIds.length && <button className="studio-reference-repair" type="button" onClick={chooseCompatible}>Choose compatible model</button>}</div>}
        <textarea onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void attachImages(files); } }} ref={promptInput} value={c.draft.prompt} onChange={event => c.updateDraft({ prompt: event.target.value })} placeholder={isVideo ? "Describe the scene and motion…" : recipe?.requiresInput ? "Describe what to change in the source image…" : "Describe the image you want to create…"} aria-label={isVideo ? "Video prompt" : "Image prompt"} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); generate(); } }} rows={2} />
        <div className="studio-composer-bottom"><div className="studio-composer-controls"><button type="button" className="studio-control-chip" aria-label="Add reference image" title="Add reference image" onClick={() => setReferencePicker(true)}><Plus size={14} /></button><button type="button" className="studio-control-chip is-model" onClick={() => { setCompatiblePicker(false); setModelPicker(true); }}><Sparkles size={12} /><span>{recipe?.name ?? "Choose model"}</span><ChevronDown size={11} /></button><label className="studio-control-chip"><ImageIcon size={12} /><select value={editableDimensions ? c.draft.aspectRatio : "source"} disabled={!editableDimensions} onChange={event => setAspect(event.target.value)} aria-label="Aspect ratio" title={editableDimensions ? "Output aspect ratio" : "Uses source image dimensions"}>{["1:1", "16:9", "9:16", "4:3", "3:4"].map(value => <option value={value} key={value}>{value}</option>)}<option value="custom">Custom</option>{!editableDimensions && <option value="source">Source</option>}</select></label>{isVideo && recipe?.capabilities.includes("duration") ? <label className="studio-control-chip"><Clock3 size={12} /><input type="number" min={1} max={5} value={c.draft.duration} onChange={event => c.updateDraft({ duration: Math.min(5, Math.max(1, Number(event.target.value))) })} style={{ width: 20, background: "none", border: 0, color: "inherit", padding: 0 }} aria-label="Video duration in seconds" />s</label> : <div className="studio-control-chip studio-batch"><button type="button" onClick={() => c.updateDraft({ batchSize: Math.max(1, c.draft.batchSize - 1) })} disabled={c.draft.batchSize <= 1} aria-label="Fewer images"><Minus size={10} /></button><span aria-label={`${c.draft.batchSize} images per batch`}>{c.draft.batchSize}</span><button type="button" onClick={() => c.updateDraft({ batchSize: Math.min(4, c.draft.batchSize + 1) })} disabled={c.draft.batchSize >= 4} aria-label="More images"><Plus size={10} /></button></div>}<button type="button" className="studio-control-chip" onClick={() => setAdvanced(!advanced)} aria-label="Advanced generation settings" aria-expanded={advanced} title="Advanced settings"><SlidersHorizontal size={12} /></button></div><button type="submit" className="studio-generate" disabled={c.busy || ready && Boolean(recipe) && !canGenerate} aria-label={!ready ? "Connect engine to generate" : "Generate"}>{c.busy ? <Loader2 size={14} className="studio-spinner" /> : <><span>{!ready ? "Connect engine" : "Generate"}</span><ArrowRight size={15} /></>}</button></div>
        {advanced && <div className="studio-advanced-panel" onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }}>{editableDimensions && <label className="studio-field"><span>Width</span><input className="studio-input" type="number" min={256} max={isVideo ? 1280 : 2048} step={isVideo ? 32 : 16} disabled={!editableDimensions} value={c.draft.width} onChange={event => c.updateDraft({ width: Number(event.target.value), aspectRatio: "custom" })} /></label>}{editableDimensions && <label className="studio-field"><span>Height</span><input className="studio-input" type="number" min={256} max={isVideo ? 1280 : 2048} step={isVideo ? 32 : 16} disabled={!editableDimensions} value={c.draft.height} onChange={event => c.updateDraft({ height: Number(event.target.value), aspectRatio: "custom" })} /></label>}{recipe?.capabilities.includes("steps") && <label className="studio-field"><span>Steps</span><input className="studio-input" type="number" min={1} max={100} value={c.draft.steps} onChange={event => c.updateDraft({ steps: Number(event.target.value) })} /></label>}{recipe?.capabilities.includes("seed") && <label className="studio-field"><span>Seed</span><input className="studio-input" type="number" min={0} value={c.draft.seed} onChange={event => c.updateDraft({ seed: event.target.value })} placeholder="Random" /></label>}{isVideo && recipe?.capabilities.includes("fps") && <label className="studio-field"><span>Frames per second</span><select className="studio-input" value={c.draft.fps} onChange={event => c.updateDraft({ fps: Number(event.target.value) })}><option value={16}>16 fps</option><option value={24}>24 fps</option></select></label>}{supportsNegativePrompt && <label className="studio-field" style={{ gridColumn: isVideo ? "1/-1" : "span 2" }}><span>Negative prompt</span><input className="studio-input" value={c.draft.negativePrompt} onChange={event => c.updateDraft({ negativePrompt: event.target.value })} placeholder="What should be left out?" /></label>}</div>}
      </form>{attachmentError && <div className="studio-composer-requirement" role="alert"><AlertCircle size={13} />{attachmentError}</div>}{c.engine?.eligibility?.state === "blocked" && <div className="studio-eligibility-warning" role="status"><span><AlertCircle size={14} />{c.engine.eligibility.message}</span><button disabled={c.busy} onClick={() => void c.connectEngine("")}>Check access</button></div>}{(recipe?.availability === "missing-models" || recipe?.requiresInput && !referenceAssets.length) && <div className="studio-composer-requirement" role="status">{recipe.availability === "missing-models" ? <><AlertCircle size={13} />{recipe.missingModels.length ? `Missing models: ${recipe.missingModels.join(", ")}` : "Install the required models on your engine."}</> : <><ImagePlus size={13} />Add a source image for this workflow.</>}</div>}</div></div>}

    </main>
    {inspecting && <AssetInspector controller={c} onDelete={setDeleteAsset} />}
    {(c.error || c.notice) && <div className={`studio-toast ${c.error ? "is-error" : ""}`} role={c.error ? "alert" : "status"}>{c.error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}<span>{c.error ?? c.notice}</span><button onClick={c.dismissMessage} aria-label="Dismiss message"><X size={13} /></button></div>}
    {modelPicker && <ModelPicker controller={c} compatibleOnly={compatiblePicker} onClose={() => setModelPicker(false)} />}
    {referencePicker && <Modal title="Add a reference" subtitle="Choose an image, or import a new source up to 20 MB." onClose={() => setReferencePicker(false)}><div className="studio-dialog-content"><button className="studio-button" onClick={() => { setReferencePicker(false); attachmentInput.current?.click(); }} style={{ marginBottom: 20 }}><Upload size={13} />Import media</button><div className="studio-media-grid">{c.allAssets.filter(asset => asset.type === "image").map(asset => <button key={asset.id} className="studio-media-preview" onClick={() => addReference(asset)} aria-label={`Use ${asset.name} as reference`}><img src={asset.url} alt={asset.name} loading="lazy" />{c.draft.inputAssetIds.includes(asset.id) && <CheckCircle2 size={22} style={{ position: "absolute", right: 9, top: 9, color: "#d6e9a7", background: "#0009", borderRadius: "50%" }} />}</button>)}</div>{!c.allAssets.some(asset => asset.type === "image") && <EmptySection icon={ImagePlus} title="No reference images" description="Import a source image to attach it directly. Your original stays in the library." />}</div></Modal>}
    {paletteOpen && <CommandPalette controller={c} onClose={() => setPaletteOpen(false)} onNavigate={navigate} onImport={upload} onAttach={() => { if (!isComposer) navigate(recipe?.kind ?? "image"); attachmentInput.current?.click(); }} onNewProject={newProject} />}
    {projectDialog && <Modal title={projectDialog === "create" ? "New project" : "Rename project"} small onClose={() => setProjectDialog(null)}><form className="studio-dialog-content" onSubmit={event => { event.preventDefault(); const name = projectName.trim(); if (!name) return; const operation = projectDialog === "create" ? c.createProject(name) : c.project ? c.renameProject(c.project.id, name) : Promise.resolve(); void operation.then(() => setProjectDialog(null)); }}><label className="studio-field"><span>Project name</span><input className="studio-input" value={projectName} onChange={event => setProjectName(event.target.value)} maxLength={120} placeholder="Project name" autoFocus required /></label><div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24 }}><button className="studio-button" type="button" onClick={() => setProjectDialog(null)}>Cancel</button><button className="studio-button is-primary" disabled={c.busy || !projectName.trim()}>{c.busy ? <Loader2 size={13} className="studio-spinner" /> : <Check size={13} />}{projectDialog === "create" ? "Create project" : "Save name"}</button></div></form></Modal>}
    {deleteAsset && <Modal title="Delete this asset?" small onClose={() => setDeleteAsset(null)}><div className="studio-dialog-content"><p style={{ color: "#929eaa", fontSize: 12, lineHeight: 1.8 }}>“{deleteAsset.name}” will be removed from your library. Export a copy first if you want to keep it.</p><div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24 }}><button className="studio-button" onClick={() => setDeleteAsset(null)}>Keep asset</button><button className="studio-button is-danger" disabled={c.busy} onClick={() => void c.deleteAsset(deleteAsset).then(() => { setDeleteAsset(null); c.setSelectedAsset(null); })}><Trash2 size={13} />Delete asset</button></div></div></Modal>}
    {dragging && <div className="studio-drop-overlay"><div><Upload size={32} /><span>Drop media to import</span></div></div>}
  </div>;
}

export default Studio;
