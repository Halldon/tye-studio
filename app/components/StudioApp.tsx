"use client";

import { useRef } from "react";
import { Studio } from "./Studio";
import { VersionRail } from "./studio/VersionRail";
import { ImageEditor, SequenceEditor, WorkflowEditor, ShotsEditor } from "./editors";
import type { AIEditRequest, EditorAsset, ImageDocument, SequenceDocument, WorkflowDocument, WorkflowExecutionRequest, ShotsDocument } from "./editors";
import { useStudio } from "../lib/use-studio";
import type { Asset } from "../lib/types";

function editorAssets(assets: Asset[]): EditorAsset[] {
  return assets.map(asset => ({ id: asset.id, name: asset.name, type: asset.type, url: asset.url,
    width: asset.width ?? undefined, height: asset.height ?? undefined, duration: asset.duration ?? undefined }));
}
export default function StudioApp() {
  const controller = useStudio();
  const currentController = useRef(controller); currentController.current = controller;
  const fileRef = useRef<HTMLInputElement>(null);
  const projectId = controller.selectedProjectId;
  const assets = editorAssets(controller.allAssets);
  const imageKey = controller.selectedAsset?.type === "image" ? controller.selectedAsset.id : "canvas";
  const imageEdits = (controller.project?.document?.imageEdits || {}) as Record<string, ImageDocument>;
  const sourceImageId = controller.selectedAsset?.type === "image" ? controller.selectedAsset.id : imageEdits[imageKey]?.sourceAssetId;
  const editRecipe = controller.recipes.find(recipe => recipe.id === "qwen-image-edit");
  const canEdit = Boolean(controller.engine?.capabilities.generation && editRecipe &&
    ["available", "unverified"].includes(editRecipe.availability));
  const onAIEdit = async (edit: AIEditRequest) => {
    if (!canEdit || !editRecipe) throw new Error("Connect a Comfy engine with Qwen Image Edit to run this edit.");
    const image = await controller.importBlob(edit.image, "edit-source.png", { projectId });
    if (!image) throw new Error("The source image could not be saved.");
    const mask = edit.mask ? await controller.importBlob(edit.mask, "edit-mask.png", { projectId }) : undefined;
    if (edit.mask && !mask) throw new Error("The edit mask could not be saved.");
    const job = await controller.generate({ projectId, parentAssetId: sourceImageId, recipeId: editRecipe.id, prompt: edit.prompt, width: edit.width,
      height: edit.height, steps: editRecipe.defaults.steps, inputAssetIds: [image.id],
      ...(mask ? { maskAssetId: mask.id } : {}) });
    if (!job || job.status === "failed" || job.status === "submission_unknown") throw new Error(job?.error?.message || "The edit was not submitted. See the queue for details.");
  };
  const saveExport = async (blob: Blob, name: string) => { await controller.importBlob(blob, name); };
  const saveImageVersion = async (blob: Blob, name: string) => {
    const document = imageEdits[imageKey];
    const asset = await controller.importBlob(blob, name, { projectId, parentAssetId: sourceImageId });
    if (!asset) throw new Error("The image version could not be saved.");
    if (projectId && document) controller.saveImageDocument(projectId, asset.id, document);
    if (currentController.current.selectedProjectId === projectId) currentController.current.useAsset(asset, "edit");
  };
  const findAsset = (asset: EditorAsset) => currentController.current.allAssets.find(item => item.id === asset.id);
  const executeWorkflow = async (request: WorkflowExecutionRequest) => {
    if (request.operation === "upscale" || request.operation === "export") {
      throw new Error(request.operation === "export" ? "Export the connected asset from the library or sequence editor." :
        "This engine does not yet expose a validated upscale recipe. Use a configured Comfy workflow for this operation.");
    }
    const recipeId = request.operation === "video-generate" ? "wan-2.2-5b" : request.operation === "image-edit" ? "qwen-image-edit" : "z-image-turbo";
    const recipe = controller.recipes.find(item => item.id === recipeId);
    if (!recipe || !controller.engine?.capabilities.generation) throw new Error(controller.engine?.message || "Connect a compatible Comfy engine first.");
    const job = await controller.generate({ recipeId, prompt: request.prompt, inputAssetIds: request.inputAssetIds,
      width: request.width || recipe.defaults.width, height: request.height || recipe.defaults.height,
      steps: recipe.defaults.steps, duration: recipe.defaults.duration || 2, fps: recipe.defaults.fps || 16 });
    if (!job || ["failed", "submission_unknown"].includes(job.status)) throw new Error(job?.error?.message || "The operation was not submitted.");
    return { jobId: job.id, message: "Queued with " + recipe.name + ". Follow its real status in Queue; outputs will appear in your library." };
  };
  const importMedia = () => fileRef.current?.click();
  return <>
    <input ref={fileRef} hidden type="file" multiple accept="image/*,video/*,audio/*"
      onChange={event => { if (event.target.files?.length) void controller.importFiles(event.target.files); event.target.value = ""; }} />
    <Studio controller={controller}
      renderEditor={() => <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        <VersionRail controller={controller} currentAsset={controller.selectedAsset}
          onSelectVersion={asset => { if (asset.id !== controller.selectedAsset?.id) controller.branchAsset(asset); }} />
        <div style={{ flex: 1, minHeight: 0 }}><ImageEditor key={"image-" + controller.selectedProjectId + "-" + imageKey} assets={assets}
        document={imageEdits[imageKey]}
        initialAssetId={controller.selectedAsset?.type === "image" ? controller.selectedAsset.id : undefined}
        onChange={doc => { if (projectId) controller.saveImageDocument(projectId, imageKey, doc); }} onExport={saveImageVersion}
        onAIEdit={onAIEdit} aiEditAvailable={canEdit}
        aiEditOperations={["image-edit", "inpaint"]}
        aiEditUnavailableReason={controller.engine?.message || "Connect a compatible Comfy engine to run AI edits."} onImport={importMedia} /></div></div>}
      renderSequence={() => <SequenceEditor key={"sequence-" + controller.selectedProjectId} assets={assets}
        document={controller.project?.document?.sequence as SequenceDocument | undefined}
        onChange={doc => controller.saveDocument("sequence", doc)} onExport={saveExport} onImport={importMedia} />}
      renderShots={() => <ShotsEditor key={"shots-" + projectId} assets={assets} jobs={controller.jobs} recipes={controller.recipes}
        projectId={projectId} document={controller.project?.document?.shots as ShotsDocument | undefined}
        initialVideoAssetId={typeof controller.project?.document?.frameSourceAssetId === "string" ? controller.project.document.frameSourceAssetId : undefined}
        onChange={doc => { controller.saveDocument("shots", doc); controller.saveDocument("frameSourceAssetId", doc.frameSourceAssetId || null); }}
        onGenerate={controller.generate} onImport={importMedia} onCancelJob={controller.cancelJob}
        onExtractFrame={async (blob, name, parentAssetId) => {
          const asset = await controller.importBlob(blob, name, { projectId, parentAssetId });
          return asset ? editorAssets([asset])[0] : undefined;
        }}
        onEditFrame={asset => { const found = findAsset(asset); if (found) currentController.current.useAsset(found, "edit"); }}
        onUseTake={asset => { const found = findAsset(asset); if (found) currentController.current.useAsset(found, "sequence"); }}
        generationAvailable={Boolean(controller.engine?.capabilities.generation)}
        generationUnavailableReason={controller.engine?.eligibility?.state === "blocked" ? controller.engine.eligibility.message : controller.engine?.message} />}
      renderWorkflow={() => <WorkflowEditor key={"workflow-" + controller.selectedProjectId} assets={assets}
        document={controller.project?.document?.workflow as WorkflowDocument | undefined}
        onChange={doc => controller.saveDocument("workflow", doc)} onImport={importMedia}
        onExecute={executeWorkflow} executionAvailable={Boolean(controller.engine?.capabilities.generation)}
        executionUnavailableReason={controller.engine?.message || "Connect a Comfy engine to execute a validated operation."} />}
    />
  </>;
}
