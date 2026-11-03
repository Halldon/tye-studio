"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { mediaDuration } from "../components/editors/editor-utils";
import { assertPortableExport, portableProjectAssets, preparePortableImport, referencedAssetIds, remapAssetIds, restoredComposerWorkspace, PORTABLE_LIMITS } from "./project-portability";
import { parseShotsDocument, syncShotTakes } from "../components/editors/shots-model";
import { restoreImageVersion, saveImageWork } from "./image-versions";
import type { Asset, Bootstrap, GenerationRequest, Job, Project, StudioController, StudioDraft, Workspace } from "./types";

const initialDraft: StudioDraft = {
  prompt: "", negativePrompt: "", recipeId: "z-image-turbo", aspectRatio: "1:1",
  width: 1024, height: 1024, steps: 8, seed: "", duration: 5, fps: 16,
  batchSize: 1, inputAssetIds: [],
  parentAssetId: null,
};
const activeStatuses = new Set(["queued", "running", "canceling"]);
function message(error: unknown): string { return error instanceof Error ? error.message : "The operation could not be completed."; }
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function filename(name: string): string { return name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0,120) || "asset"; }
function readDraft(project: Project | null): StudioDraft {
  const raw = project?.document?.draft as Partial<StudioDraft> | undefined;
  return { ...initialDraft, ...raw, inputAssetIds: Array.isArray(raw?.inputAssetIds) ? raw.inputAssetIds : [],
    parentAssetId: typeof raw?.parentAssetId === "string" ? raw.parentAssetId : null };
}
async function probeMedia(src: string, kind: string): Promise<{ width?: number; height?: number; duration?: number }> {
  if (kind.startsWith("image")) return new Promise(resolve => {
    const image = new Image(); const timer = setTimeout(() => resolve({}), 6000);
    image.onload = () => { clearTimeout(timer); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { clearTimeout(timer); resolve({}); }; image.src = src;
  });
  return new Promise(resolve => {
    const media = document.createElement(kind.startsWith("audio") ? "audio" : "video");
    const done = (value: { width?: number; height?: number; duration?: number }) => {
      clearTimeout(timer); media.removeAttribute("src"); media.load(); resolve(value);
    };
    const timer = setTimeout(() => done({}), 6000);
    media.preload = "metadata"; media.onloadedmetadata = () => {
      const video = media as HTMLVideoElement;
      const dimensions = video.videoWidth ? { width: video.videoWidth, height: video.videoHeight } : {};
      if (Number.isFinite(media.duration) && media.duration > 0) done({ ...dimensions, duration: media.duration });
      else {
        clearTimeout(timer);
        void mediaDuration(src).then(duration => done({ ...dimensions, duration })).catch(() => done(dimensions));
      }
    };
    media.onerror = () => done({}); media.src = src;
  });
}

export function useStudio(): StudioController {
  const [data, setData] = useState<Bootstrap | null>(null);
  const dataRef = useRef<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workspace, setWorkspaceState] = useState<Workspace>("image");
  const workspaceRef = useRef<Workspace>("image");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const projectIdRef = useRef<string | null>(null);
  const [draft, setDraft] = useState<StudioDraft>(initialDraft);
  const draftRef = useRef<StudioDraft>(initialDraft);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [recentRecipeIds, setRecentRecipeIds] = useState<string[]>([]);
  const [favoriteRecipeIds, setFavoriteRecipeIds] = useState<string[]>([]);
  const preferencesOwner = useRef<string | null>(null);
  const sessionKey = useRef("");
  const pendingDocs = useRef(new Map<string, Record<string, unknown>>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const refreshing = useRef(false);
  const commit = useCallback((next: Bootstrap) => { dataRef.current = next; setData(next); }, []);

  const request = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    if (sessionKey.current) headers.set("X-Comfy-Api-Key", sessionKey.current);
    if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    if (!response.ok) throw new Error(body?.error?.message || ("Request failed (" + response.status + ")."));
    return body as T;
  }, []);
  const flushDocuments = useCallback(() => {
    saveQueue.current = saveQueue.current.then(async () => {
      for (const [id, doc] of [...pendingDocs.current]) {
        try {
          await request("/api/projects/" + id, { method: "PATCH", body: JSON.stringify({ document: doc }) });
          if (pendingDocs.current.get(id) === doc) pendingDocs.current.delete(id);
        } catch (e) { setError("Changes are still in this session. Saving failed: " + message(e)); }
      }
    });
    return saveQueue.current;
  }, [request]);
  const saveProjectDocument = useCallback((id: string, key: string, documentValue: unknown) => {
    const current = dataRef.current;
    if (!id || !current) return;
    const project = current.projects.find(p => p.id === id); if (!project) return;
    const doc = { ...(pendingDocs.current.get(id) || project.document || {}), version: 1, [key]: documentValue };
    pendingDocs.current.set(id, doc);
    commit({ ...current, projects: current.projects.map(p => p.id === id ? { ...p, document: doc, updatedAt: new Date().toISOString() } : p) });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushDocuments(); }, 850);
  }, [commit, flushDocuments]);
  const saveDocument = useCallback((key: string, value: unknown) => {
    const id = projectIdRef.current; if (id) saveProjectDocument(id, key, value);
  }, [saveProjectDocument]);
  const saveImageDocument = useCallback((id: string, assetId: string, value: unknown) => {
    const project = dataRef.current?.projects.find(item => item.id === id);
    const doc = pendingDocs.current.get(id) || project?.document || {};
    const next = saveImageWork(doc, assetId, value);
    if (next.imageVersionDocuments !== doc.imageVersionDocuments) saveProjectDocument(id, "imageVersionDocuments", next.imageVersionDocuments);
    saveProjectDocument(id, "imageEdits", next.imageEdits);
  }, [saveProjectDocument]);
  const updateDraft = useCallback((patch: Partial<StudioDraft>) => {
    const next = { ...draftRef.current, ...patch };
    if (patch.inputAssetIds && next.parentAssetId && !patch.inputAssetIds.includes(next.parentAssetId)) next.parentAssetId = patch.inputAssetIds[0] || null;
    draftRef.current = next; setDraft(next); saveDocument("draft", next);
  }, [saveDocument]);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      let next = await request<Bootstrap>("/api/bootstrap");
      if (!next.projects.length && next.engine.storageReady) {
        const result = await request<{ project: Project }>("/api/projects", { method: "POST", body: JSON.stringify({ name: "Untitled project" }) });
        next = { ...next, projects: [result.project] };
      }
      let observedTakes = false;
      next.projects = next.projects.map(project => {
        let document = pendingDocs.current.get(project.id) || project.document;
        if (document?.shots) {
          try {
            const parsed = parseShotsDocument(document.shots);
            const synced = syncShotTakes(parsed, next.jobs, next.assets.map(asset => ({ id: asset.id, name: asset.name, type: asset.type, url: asset.url })), project.id);
            if (synced !== parsed) {
              document = { ...document, shots: synced };
              pendingDocs.current.set(project.id, document); observedTakes = true;
            }
          } catch { /* Preserve invalid or newer documents for explicit recovery in Shots. */ }
        }
        return document !== project.document ? { ...project, document } : project;
      });
      if (preferencesOwner.current !== next.user.id) {
        preferencesOwner.current = next.user.id;
        const readPreference = (kind: string) => {
          try { const value = JSON.parse(localStorage.getItem("tye." + next.user.id + "." + kind) || "[]");
            return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && next.recipes.some(recipe => recipe.id === id)).slice(0, 30) : [];
          } catch { return []; }
        };
        setRecentRecipeIds(readPreference("recentModels")); setFavoriteRecipeIds(readPreference("favoriteModels"));
      }
      commit(next);
      if (observedTakes) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => { void flushDocuments(); }, 850);
      }
      if (next.projects.length && (!projectIdRef.current || !next.projects.some(p => p.id === projectIdRef.current))) {
        const stored = typeof window !== "undefined" ? localStorage.getItem("tye.selectedProject") : null;
        const project = next.projects.find(p => p.id === stored) || next.projects[0];
        projectIdRef.current = project.id; setSelectedProjectId(project.id);
        const restored = readDraft(project);
        if (!next.recipes.some(r => r.id === restored.recipeId) && next.recipes.length) restored.recipeId = next.recipes[0].id;
        draftRef.current = restored; setDraft(restored);
        const composer = restoredComposerWorkspace(workspaceRef.current, next.recipes.find(recipe => recipe.id === restored.recipeId)?.kind);
        if (composer !== workspaceRef.current) {
          workspaceRef.current = composer; setWorkspaceState(composer);
          try { localStorage.setItem("tye.workspace", composer); } catch { /* The selected project still determines its composer for this session. */ }
        }
        const activeImage = project.document?.activeImageAssetId;
        if (workspaceRef.current === "edit" && typeof activeImage === "string") setSelectedAsset(next.assets.find(asset => asset.id === activeImage) || null);
      }
    } finally { refreshing.current = false; }
  }, [commit, flushDocuments, request]);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      const saved = localStorage.getItem("tye.workspace");
      if (saved && ["image","video","shots","edit","sequence","workflows","library","queue","settings"].includes(saved)) { workspaceRef.current = saved as Workspace; setWorkspaceState(saved as Workspace); }
      void refresh().catch(e => setError(message(e))).finally(() => setLoading(false));
    });
    return () => { current = false; };
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      const jobs = dataRef.current?.jobs.filter(j => activeStatuses.has(j.status)) || [];
      if (!jobs.length || document.hidden) return;
      void Promise.allSettled(jobs.map(job => request("/api/jobs/" + job.id + "/reconcile", { method: "POST" })))
        .then(async results => {
          const failed = results.find(result => result.status === "rejected");
          if (failed?.status === "rejected") setError("Could not refresh generation status: " + message(failed.reason));
          await refresh();
        }).catch(e => setError(message(e)));
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh, request]);
  useEffect(() => {
    const save = () => {
      for (const [id, doc] of pendingDocs.current) {
        const headers: Record<string,string> = { "Content-Type": "application/json" };
        if (sessionKey.current) headers["X-Comfy-Api-Key"] = sessionKey.current;
        void fetch("/api/projects/" + id, { method: "PATCH", headers, body: JSON.stringify({ document: doc }), keepalive: true });
      }
    };
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, []);
  const setWorkspace = useCallback((value: Workspace) => {
    workspaceRef.current = value; setWorkspaceState(value); localStorage.setItem("tye.workspace", value);
    if (value === "edit") {
      const project = dataRef.current?.projects.find(p => p.id === projectIdRef.current);
      const activeImage = project?.document?.activeImageAssetId;
      if (typeof activeImage === "string") setSelectedAsset(dataRef.current?.assets.find(asset => asset.id === activeImage) || null);
    }
    const kind = value === "video" ? "video" : value === "image" ? "image" : null;
    if (kind) {
      const recipes = dataRef.current?.recipes || [];
      const active = recipes.find(recipe => recipe.id === draftRef.current.recipeId);
      if (active?.kind !== kind) {
        const recipe = recipes.find(recipe => recipe.kind === kind && !recipe.requiresInput) || recipes.find(recipe => recipe.kind === kind);
        if (recipe) updateDraft({ recipeId: recipe.id, width: recipe.defaults.width, height: recipe.defaults.height,
          steps: recipe.defaults.steps, duration: recipe.defaults.duration || 2, fps: recipe.defaults.fps || 16,
          batchSize: 1, aspectRatio: recipe.defaults.width === recipe.defaults.height ? "1:1" : recipe.defaults.width > recipe.defaults.height ? "16:9" : "9:16" });
      }
    }
  }, [updateDraft]);
  const selectProject = useCallback((id: string) => {
    const project = dataRef.current?.projects.find(p => p.id === id); if (!project) return;
    void flushDocuments();
    projectIdRef.current = id; setSelectedProjectId(id); setSelectedAsset(null);
    localStorage.setItem("tye.selectedProject", id);
    const restored = readDraft(project); draftRef.current = restored; setDraft(restored);
    const composer = restoredComposerWorkspace(workspaceRef.current, dataRef.current?.recipes.find(recipe => recipe.id === restored.recipeId)?.kind);
    if (composer !== workspaceRef.current) {
      workspaceRef.current = composer; setWorkspaceState(composer);
      try { localStorage.setItem("tye.workspace", composer); } catch { /* Keep the restored composer in this session. */ }
    }
    const activeImage = project.document?.activeImageAssetId;
    if (workspaceRef.current === "edit" && typeof activeImage === "string") setSelectedAsset(dataRef.current?.assets.find(asset => asset.id === activeImage) || null);
  }, [flushDocuments]);
  const createProject = useCallback(async (name: string) => {
    setBusy(true); setError(null);
    try {
      const result = await request<{ project: Project }>("/api/projects", { method: "POST", body: JSON.stringify({ name: name.trim() || "Untitled project" }) });
      await refresh(); selectProject(result.project.id); setNotice("Project created.");
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }, [request, refresh, selectProject]);
  const renameProject = useCallback(async (id: string, name: string) => {
    if (!name.trim()) return;
    try { await request("/api/projects/" + id, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) }); await refresh(); }
    catch (e) { setError(message(e)); }
  }, [request, refresh]);
  const importBlob = useCallback(async (blob: Blob, name: string, options: { parentAssetId?: string; projectId?: string | null } = {}): Promise<Asset | undefined> => {
    const form = new FormData(); form.append("file", blob, filename(name));
    const id = options.projectId === undefined ? projectIdRef.current : options.projectId;
    if (id) form.append("projectId", id);
    if (options.parentAssetId) form.append("parentAssetId", options.parentAssetId);
    const objectUrl = URL.createObjectURL(blob);
    try {
      const metadata = await probeMedia(objectUrl, blob.type);
      for (const [key, value] of Object.entries(metadata)) if (value) form.append(key, String(value));
    } finally { URL.revokeObjectURL(objectUrl); }
    const result = await request<{ asset: Asset }>("/api/assets", { method: "POST", body: form });
    const current = dataRef.current;
    if (current) commit({ ...current, assets: [result.asset, ...current.assets.filter(a => a.id !== result.asset.id)] });
    return result.asset;
  }, [commit, request]);
  const importFiles = useCallback(async (files: File[] | FileList) => {
    setBusy(true); setError(null); let count = 0;
    try {
      for (const file of Array.from(files)) {
        if (!/^(image|video|audio)\//.test(file.type)) throw new Error("Choose an image, video or audio file.");
        if (file.size > 20 * 1024 * 1024) throw new Error("Keep individual uploads below 20 MB.");
        await importBlob(file, file.name); count++;
      }
      setNotice(count + " asset" + (count === 1 ? "" : "s") + " imported.");
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }, [importBlob]);
  const attachAssets = useCallback((assets: Asset[]) => {
    const images = assets.filter(asset => asset.type === "image");
    if (!images.length) { setError("Generation references must be images. Import video and audio into the library or use Shots to capture a frame."); return; }
    const ids = [...new Set([...draftRef.current.inputAssetIds, ...images.map(asset => asset.id)])];
    if (!["image", "video"].includes(workspaceRef.current)) setWorkspace("image");
    updateDraft({ inputAssetIds: ids });
    setNotice(images.length === 1 ? images[0].name + " attached." : images.length + " reference images attached.");
  }, [setWorkspace, updateDraft]);
  const attachFiles = useCallback(async (files: File[] | FileList): Promise<Asset[]> => {
    const selected = Array.from(files); const projectId = projectIdRef.current; const imported: Asset[] = [];
    setBusy(true); setError(null);
    try {
      if (!selected.length) return [];
      if (selected.some(file => !file.type.startsWith("image/"))) throw new Error("Attach an image here. Import video into the library, then capture a frame in Shots.");
      if (selected.some(file => file.size > 20 * 1024 * 1024)) throw new Error("Keep individual reference images below 20 MB.");
      for (const file of selected) {
        const asset = await importBlob(file, file.name, { projectId }); if (asset) imported.push(asset);
      }
    } catch (e) { setError(message(e)); }
    finally {
      if (imported.length && projectIdRef.current === projectId) attachAssets(imported);
      else if (imported.length) setNotice("Reference images were saved in the previous project.");
      setBusy(false);
    }
    return imported;
  }, [attachAssets, importBlob]);
  const rememberRecipe = useCallback((id: string) => {
    setRecentRecipeIds(previous => {
      const next = [id, ...previous.filter(value => value !== id)].slice(0, 8);
      try { if (preferencesOwner.current) localStorage.setItem("tye." + preferencesOwner.current + ".recentModels", JSON.stringify(next)); } catch { /* Preferences can remain session-only. */ }
      return next;
    });
  }, []);
  const toggleFavoriteRecipe = useCallback((id: string) => {
    if (!dataRef.current?.recipes.some(recipe => recipe.id === id)) return;
    setFavoriteRecipeIds(previous => {
      const next = previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id];
      try { if (preferencesOwner.current) localStorage.setItem("tye." + preferencesOwner.current + ".favoriteModels", JSON.stringify(next)); } catch { /* Preferences can remain session-only. */ }
      return next;
    });
  }, []);
  const selectRecipe = useCallback((id: string) => {
    const recipe = dataRef.current?.recipes.find(r => r.id === id); if (!recipe) return;
    rememberRecipe(id);
    updateDraft({ recipeId: id, width: recipe.defaults.width, height: recipe.defaults.height,
      steps: recipe.defaults.steps, duration: recipe.defaults.duration || 2, fps: recipe.defaults.fps || 16,
      batchSize: recipe.kind === "video" ? 1 : draftRef.current.batchSize,
      aspectRatio: recipe.defaults.width === recipe.defaults.height ? "1:1" : recipe.defaults.width > recipe.defaults.height ? "16:9" : "9:16" });
  }, [rememberRecipe, updateDraft]);
  const generate = useCallback(async (overrides: Partial<GenerationRequest> = {}): Promise<Job | undefined> => {
    setBusy(true); setError(null); let result: Job | undefined;
    try {
      const draft = draftRef.current;
      const body: GenerationRequest = {
        projectId: projectIdRef.current, recipeId: draft.recipeId, prompt: draft.prompt.trim(),
        negativePrompt: draft.negativePrompt, width: draft.width, height: draft.height,
        steps: draft.steps, duration: draft.duration, fps: draft.fps,
        ...(draft.seed.trim() ? { seed: Number(draft.seed) } : {}),
        inputAssetIds: draft.inputAssetIds, ...overrides,
      };
      body.batchId = overrides.batchId || crypto.randomUUID();
      body.parentAssetId = overrides.parentAssetId || (overrides.inputAssetIds === undefined ? draft.parentAssetId : null) || body.inputAssetIds?.[0] || undefined;
      if (overrides.recipeId !== undefined || overrides.shotId !== undefined) {
        if (overrides.seed === undefined) body.seed = undefined;
        if (overrides.negativePrompt === undefined) body.negativePrompt = undefined;
      }
      const recipe = dataRef.current?.recipes.find(r => r.id === body.recipeId);
      if (!recipe?.capabilities.includes("negative-prompt")) body.negativePrompt = undefined;
      if (!body.prompt) throw new Error("Describe what you want to create.");
      const count = Object.keys(overrides).length ? 1 : draft.batchSize;
      rememberRecipe(body.recipeId);
      for (let i = 0; i < Math.min(4, Math.max(1, count)); i++) {
        const response = await request<{ job: Job }>("/api/jobs", { method: "POST",
          body: JSON.stringify({ ...body, requestId: crypto.randomUUID() }) });
        result = response.job; await refresh();
        if (result.status === "submission_unknown" || result.status === "failed") {
          setError(result.error?.message || "The job needs attention. Review its status before submitting again."); break;
        }
      }
      if (result && !["failed","submission_unknown"].includes(result.status)) setNotice("Added to the generation queue.");
      return result;
    } catch (e) { setError(message(e)); return undefined; } finally { setBusy(false); }
  }, [refresh, rememberRecipe, request]);
  const cancelJob = useCallback(async (id: string) => {
    try { await request("/api/jobs/" + id + "/cancel", { method: "POST" }); await refresh(); }
    catch (e) { setError(message(e)); }
  }, [refresh, request]);
  const retryJob = useCallback(async (job: Job) => {
    if (job.status === "submission_unknown") {
      try { await request("/api/jobs/" + job.id + "/reconcile", { method: "POST" }); await refresh();
        setNotice("Checked the existing submission. An uncertain submission is never automatically retried."); }
      catch (e) { setError(message(e)); }
      return;
    }
    if (!["failed","canceled"].includes(job.status)) return;
    await generate({ ...job.parameters, requestId: undefined, batchId: undefined });
  }, [generate, refresh, request]);
  const starAsset = useCallback(async (asset: Asset) => {
    try { await request("/api/assets/" + asset.id, { method: "PATCH", body: JSON.stringify({ starred: !asset.starred }) }); await refresh(); }
    catch (e) { setError(message(e)); }
  }, [refresh, request]);
  const deleteAsset = useCallback(async (asset: Asset) => {
    try { await request("/api/assets/" + asset.id, { method: "DELETE" }); setSelectedAsset(null); await refresh(); setNotice("Asset removed from the library."); }
    catch (e) { setError(message(e)); }
  }, [refresh, request]);
  const useAsset = useCallback((asset: Asset, destination?: Workspace) => {
    if (destination === "edit") {
      if (asset.projectId && asset.projectId !== projectIdRef.current) selectProject(asset.projectId);
      setSelectedAsset(asset); saveDocument("activeImageAssetId", asset.id); setWorkspace("edit"); return;
    }
    if (destination === "sequence") {
      const id = projectIdRef.current;
      void (async () => {
        const metadata = asset.type === "video" && !asset.duration ? await probeMedia(asset.url, "video") : {};
        if (projectIdRef.current !== id) return;
        const project = dataRef.current?.projects.find(p => p.id === id);
        const sequence = project?.document?.sequence as { version: 1; width: number; height: number; fps: number; clips: unknown[] } | undefined;
        const doc = sequence || { version: 1, width: 1280, height: 720, fps: 30, clips: [] };
        if (asset.type === "audio") saveDocument("sequence", { ...doc, audio: { assetId: asset.id, offset: 0, volume: 1 } });
        else {
          const duration = asset.type === "image" ? 5 : asset.duration || metadata.duration;
          if (!duration) { setError("This video's duration could not be read. Add a supported source in the sequence editor."); return; }
          saveDocument("sequence", { ...doc, clips: [...doc.clips, { id: crypto.randomUUID(), assetId: asset.id,
            in: 0, out: duration, caption: "", muted: false }] });
        }
        setWorkspace("sequence"); setNotice("Added " + asset.name + " to the sequence.");
      })(); return;
    }
    updateDraft({ inputAssetIds: [...new Set([...draftRef.current.inputAssetIds, asset.id])] });
    if (destination) setWorkspace(destination);
    setNotice(asset.name + " added as a reference.");
  }, [saveDocument, selectProject, setWorkspace, updateDraft]);
  const openAsset = useCallback((asset: Asset) => {
    if (asset.projectId && asset.projectId !== projectIdRef.current) selectProject(asset.projectId);
    const current = workspaceRef.current;
    if (asset.type === "audio" || !["image", "video", "library"].includes(current)) setWorkspace("library");
    setSelectedAsset(asset);
  }, [selectProject, setWorkspace]);
  const reuseJob = useCallback((job: Job) => {
    if (job.projectId && job.projectId !== projectIdRef.current) selectProject(job.projectId);
    const recipe = dataRef.current?.recipes.find(item => item.id === job.recipeId);
    if (!recipe) { setError("This workflow is no longer configured. Choose an available model."); return; }
    const p = job.parameters;
    setWorkspace(recipe.kind); selectRecipe(recipe.id);
    updateDraft({ prompt: job.prompt, negativePrompt: p.negativePrompt || "", recipeId: job.recipeId,
      width: p.width ?? recipe.defaults.width, height: p.height ?? recipe.defaults.height,
      steps: p.steps ?? recipe.defaults.steps, seed: p.seed?.toString() || "",
      duration: p.duration ?? recipe.defaults.duration ?? 2, fps: p.fps ?? recipe.defaults.fps ?? 16,
      inputAssetIds: p.inputAssetIds || [], parentAssetId: p.parentAssetId || p.inputAssetIds?.[0] || null,
      aspectRatio: "custom", batchSize: 1 });
    setNotice("Prompt and settings loaded. Generate when you are ready.");
  }, [selectProject, selectRecipe, setWorkspace, updateDraft]);
  const inlineEdit = useCallback(async (asset: Asset, instruction: string): Promise<Job | undefined> => {
    if (asset.type !== "image") { setError("Capture a video frame in Shots before editing it as an image."); return; }
    const recipe = dataRef.current?.recipes.find(item => item.id === "qwen-image-edit");
    if (!recipe || !dataRef.current?.engine.capabilities.generation || !["available", "unverified"].includes(recipe.availability)) {
      setError("Connect an engine with Qwen Image Edit to run this edit."); return;
    }
    if (!instruction.trim()) { setError("Describe the change to make."); return; }
    openAsset(asset); setWorkspace("image");
    return generate({ projectId: asset.projectId || projectIdRef.current, recipeId: recipe.id, prompt: instruction.trim(),
      inputAssetIds: [asset.id], parentAssetId: asset.id, width: asset.width || recipe.defaults.width,
      height: asset.height || recipe.defaults.height, steps: recipe.defaults.steps });
  }, [generate, openAsset, setWorkspace]);
  const branchAsset = useCallback((asset: Asset) => {
    if (asset.type === "image") {
      if (asset.projectId && asset.projectId !== projectIdRef.current) selectProject(asset.projectId);
      const project = dataRef.current?.projects.find(item => item.id === projectIdRef.current);
      if (project) saveDocument("imageEdits", restoreImageVersion(project.document || {}, asset.id));
      useAsset(asset, "edit"); setNotice("Editing from " + asset.name + ". Export or generate an edit to save a new version.");
    } else if (asset.type === "video") {
      if (asset.projectId && asset.projectId !== projectIdRef.current) selectProject(asset.projectId);
      const project = dataRef.current?.projects.find(item => item.id === projectIdRef.current);
      try {
        const shots = project?.document?.shots ? parseShotsDocument(project.document.shots) : undefined;
        if (shots) saveDocument("shots", { ...shots, frameSourceAssetId: asset.id });
      } catch { /* The Shots editor provides recovery without overwriting its document. */ }
      saveDocument("frameSourceAssetId", asset.id); setWorkspace("shots"); setSelectedAsset(null);
      setNotice("Capture a frame from this take to start a new branch.");
    } else openAsset(asset);
  }, [openAsset, saveDocument, selectProject, setWorkspace, useAsset]);
  const downloadAsset = useCallback(async (asset: Asset) => {
    try { const response = await fetch(asset.url); if (!response.ok) throw new Error("The asset could not be downloaded.");
      download(await response.blob(), asset.name); } catch (e) { setError(message(e)); }
  }, []);
  const exportProject = useCallback(async () => {
    const exportId = projectIdRef.current;
    setBusy(true); setError(null);
    try {
      await flushDocuments();
      const current = dataRef.current; const source = current?.projects.find(p => p.id === exportId); if (!source || !current) return;
      const project = structuredClone(source);
      const listed = await request<{ assets: Asset[] }>("/api/assets?projectId=" + encodeURIComponent(project.id));
      const known = new Map(current.assets.map(asset => [asset.id, asset]));
      listed.assets.forEach(asset => known.set(asset.id, asset));
      const seed = new Map(listed.assets.map(asset => [asset.id, asset]));
      const jobs = current.jobs.filter(job => job.projectId === project.id);
      const historyRefs = new Set<string>(); jobs.forEach(job => referencedAssetIds(job.parameters, historyRefs));
      current.assets.filter(asset => historyRefs.has(asset.id)).forEach(asset => seed.set(asset.id, asset));
      const references = { projectDocument: project.document, historicalParameters: jobs.map(job => job.parameters) };
      const assets = await portableProjectAssets([...seed.values()], references, async id => {
        const cached = known.get(id); if (cached) return cached;
        const asset = (await request<{ asset: Asset }>("/api/assets/" + encodeURIComponent(id))).asset;
        known.set(id, asset); return asset;
      });
      const entries = assets.map(asset => ({ ...asset, path: "media/" + asset.id + "-" + filename(asset.name), url: undefined }));
      const manifest = strToU8(JSON.stringify({ format: "tye-studio", version: 1, project, assets: entries, jobs }, null, 2));
      assertPortableExport(assets, project.document, manifest.byteLength);
      const files: Record<string, Uint8Array> = { "project.json": manifest }; let expanded = manifest.byteLength;
      for (const entry of entries) {
        const asset = known.get(entry.id) || assets.find(item => item.id === entry.id)!;
        const response = await fetch(asset.url); if (!response.ok) throw new Error("Could not include " + asset.name + " in the project.");
        const bytes = new Uint8Array(await response.arrayBuffer()); expanded += bytes.byteLength;
        if (!bytes.byteLength || bytes.byteLength > PORTABLE_LIMITS.mediaBytes || expanded > PORTABLE_LIMITS.expandedBytes || expanded > PORTABLE_LIMITS.archiveBytes) throw new Error("The project exceeds the portable-project media or size limit.");
        files[entry.path] = bytes;
      }
      const archive = zipSync(files, { level: 0 });
      if (archive.byteLength > PORTABLE_LIMITS.archiveBytes) throw new Error("This ZIP exceeds the 150 MB portable-project limit. Split the project before exporting.");
      download(new Blob([archive as BlobPart], { type: "application/zip" }), filename(project.name) + ".tye.zip");
      setNotice("Portable project exported with its source media.");
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }, [flushDocuments, request]);
  const importProject = useCallback(async (file: File) => {
    setBusy(true); setError(null); let createdProjectId: string | null = null; let uploaded = 0;
    try {
      if (file.size > PORTABLE_LIMITS.archiveBytes) throw new Error("Portable projects must be smaller than 150 MB.");
      let expanded = 0; const seenPaths = new Set<string>();
      const files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: entry => {
        expanded += entry.originalSize;
        if (seenPaths.has(entry.name)) throw new Error("The archive contains duplicate file paths.");
        seenPaths.add(entry.name);
        if (entry.originalSize > PORTABLE_LIMITS.mediaBytes || expanded > PORTABLE_LIMITS.expandedBytes) throw new Error("This project exceeds the import size limit.");
        return entry.name === "project.json" || entry.name.startsWith("media/");
      } });
      if (!files["project.json"]) throw new Error("This ZIP does not contain a Tye project.");
      const prepared = preparePortableImport(JSON.parse(strFromU8(files["project.json"])), files);
      // All format, ancestry, file and remapped-document bounds are checked before writes begin.
      const created = await request<{ project: Project }>("/api/projects", { method: "POST", body: JSON.stringify({ name: prepared.name }) });
      createdProjectId = created.project.id;
      const ids = new Map<string, string>();
      for (const asset of prepared.assets) {
        const form = new FormData(); form.append("projectId", created.project.id);
        if (asset.parentAssetId) form.append("parentAssetId", ids.get(asset.parentAssetId)!);
        const blob = new Blob([files[asset.path] as BlobPart], { type: asset.mimeType });
        form.append("file", blob, asset.name);
        const objectUrl = URL.createObjectURL(blob);
        try {
          const metadata = await probeMedia(objectUrl, blob.type);
          for (const [key, value] of Object.entries(metadata)) {
            const valid = Number.isFinite(value) && (key === "duration" ? value >= 0 && value <= 3600 : Number.isInteger(value) && value >= 16 && value <= 16384);
            if (valid) form.append(key, String(value));
          }
        } finally { URL.revokeObjectURL(objectUrl); }
        const imported = await request<{ asset: Asset }>("/api/assets", { method: "POST", body: form }); ids.set(asset.id, imported.asset.id); uploaded++;
      }
      const doc = remapAssetIds(prepared.document, ids);
      await request("/api/projects/" + created.project.id, { method: "PATCH", body: JSON.stringify({ document: doc }) });
      await refresh(); selectProject(created.project.id); setNotice("Portable project imported. Historical jobs remain in the archive and are not resubmitted.");
    } catch (e) {
      if (createdProjectId) await refresh().catch(() => {});
      setError((createdProjectId ? "Import stopped after " + uploaded + " media files. The partial project remains available in Projects. " : "") + message(e));
    } finally { setBusy(false); }
  }, [refresh, request, selectProject]);
  const connectEngine = useCallback(async (apiKey: string) => {
    setBusy(true); setError(null); const nextKey = apiKey.trim();
    if (nextKey) sessionKey.current = nextKey;
    try { const result = await request<{ engine: Bootstrap["engine"]; saved: boolean }>(nextKey ? "/api/engine/connect" : "/api/engine/check", {
        method: "POST", ...(nextKey ? { body: JSON.stringify({ apiKey: sessionKey.current }) } : {}) });
      if (!result.engine.connected) throw new Error(result.engine.message);
      if (result.saved) sessionKey.current = "";
      await refresh(); setNotice(!nextKey ? "Connection checked. Generation access is confirmed only by a successful run." : result.saved ? "Comfy connected. Your key is encrypted and saved on this server." : "Comfy connected for this browser session. The key is not saved on this device.");
    } catch (e) { if (nextKey) sessionKey.current = ""; setError(message(e)); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }, [refresh, request]);
  const disconnectEngine = useCallback(() => {
    sessionKey.current = "";
    void request("/api/engine/connect", { method: "DELETE" }).then(() => refresh())
      .then(() => setNotice("Your saved connection was removed.")).catch(e => setError(message(e)));
  }, [refresh, request]);
  const project = data?.projects.find(p => p.id === selectedProjectId) || null;
  return {
    data, loading, busy, error, notice, workspace, setWorkspace, projects: data?.projects || [],
    project, selectedProjectId, selectProject, createProject, renameProject,
    assets: (data?.assets || []).filter(a => a.projectId === selectedProjectId),
    allAssets: data?.assets || [], jobs: data?.jobs || [], recipes: data?.recipes || [],
    engine: data?.engine || null, draft, updateDraft, selectRecipe, selectedAsset, setSelectedAsset,
    importFiles, importBlob, attachFiles, attachAssets, openAsset, reuseJob, inlineEdit, branchAsset,
    recentRecipeIds, favoriteRecipeIds, toggleFavoriteRecipe,
    generate, cancelJob, retryJob, starAsset, deleteAsset, useAsset,
    downloadAsset, saveDocument, saveImageDocument, exportProject, importProject, refresh: async () => { try { await refresh(); } catch (e) { setError(message(e)); } }, connectEngine, disconnectEngine,
    dismissMessage: () => { setError(null); setNotice(null); },
  };
}
