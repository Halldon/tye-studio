"use client";
import { useState } from "react";
import { Check, Search, Star } from "lucide-react";
import type { Recipe, StudioController } from "../../lib/types";
import { Dialog } from "./Dialog";
import { recipeInputIssue } from "./studio-model";

type Task = "all" | "image" | "video" | "edit";
export function ModelPicker({ controller: c, onClose, compatibleOnly = false }: { controller: StudioController; onClose: () => void; compatibleOnly?: boolean }) {
  const [search, setSearch] = useState("");
  const [task, setTask] = useState<Task>(c.workspace === "video" ? "video" : "all");
  const [onlyCompatible, setOnlyCompatible] = useState(compatibleOnly);
  const [section, setSection] = useState("all");
  const models = c.recipes.filter(recipe => {
    const matchesTask = task === "all" || (task === "edit" ? recipe.capabilities.includes("image-edit") : recipe.kind === task);
    const matchesSection = section === "all" || (section === "favorites" ? c.favoriteRecipeIds.includes(recipe.id) : c.recentRecipeIds.includes(recipe.id));
    return matchesTask && matchesSection && (!onlyCompatible || !recipeInputIssue(recipe, c.draft.inputAssetIds.length)) && `${recipe.name} ${recipe.description} ${recipe.capabilities.join(" ")}`.toLowerCase().includes(search.toLowerCase());
  }).sort((a, b) => Number(c.favoriteRecipeIds.includes(b.id)) - Number(c.favoriteRecipeIds.includes(a.id)) || (section === "recent" ? c.recentRecipeIds.indexOf(a.id) - c.recentRecipeIds.indexOf(b.id) : 0));
  function select(recipe: Recipe) { c.selectRecipe(recipe.id); c.setWorkspace(recipe.kind); onClose(); }
  return <Dialog title="Model workflows" onClose={onClose}>
    <div className="studio-dialog-content">
      <div className="studio-search"><Search size={15} /><input className="studio-input" autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search models or capabilities" aria-label="Search model workflows" /></div>
      <div className="studio-model-filters"><div className="studio-segmented">{([{ id: "all", label: "All tasks" }, { id: "image", label: "Image" }, { id: "edit", label: "Edit" }, { id: "video", label: "Video" }] as const).map(value => <button key={value.id} className={task === value.id ? "is-active" : ""} onClick={() => setTask(value.id)} aria-pressed={task === value.id}>{value.label}</button>)}</div><label className="studio-checkbox"><input type="checkbox" checked={onlyCompatible} onChange={event => setOnlyCompatible(event.target.checked)} />Compatible with inputs</label></div>
      <div className="studio-model-sections">{[{ id: "all", label: "All models" }, { id: "favorites", label: "Favorites" }, { id: "recent", label: "Recent" }].map(value => <button key={value.id} className={section === value.id ? "is-active" : ""} onClick={() => setSection(value.id)} aria-pressed={section === value.id}>{value.label}</button>)}</div>
      <div className="studio-model-grid">{models.map(recipe => {
        const issue = recipeInputIssue(recipe, c.draft.inputAssetIds.length);
        return <article className={`studio-model-choice ${c.draft.recipeId === recipe.id ? "is-selected" : ""}`} key={recipe.id}>
          <button className="studio-model-choice-main" onClick={() => select(recipe)}><h3>{recipe.name}{c.draft.recipeId === recipe.id && <Check size={14} />}</h3><p>{recipe.description}</p><div className="studio-model-meta"><span>{recipe.kind}</span><span>{recipe.maxInputs ? `${recipe.maxInputs} ${recipe.maxInputs === 1 ? "reference" : "references"}` : "Text input"}</span><span>{recipe.availability === "available" ? "Available" : recipe.availability === "missing-models" ? "Models needed" : recipe.availability === "unverified" ? "Runtime check" : "Connect engine"}</span></div>{issue && <p className="studio-model-input-issue">{issue}. Attached images will be kept.</p>}</button>
          <button className={`studio-model-star ${c.favoriteRecipeIds.includes(recipe.id) ? "is-favorite" : ""}`} onClick={() => c.toggleFavoriteRecipe(recipe.id)} aria-label={`${c.favoriteRecipeIds.includes(recipe.id) ? "Unfavorite" : "Favorite"} ${recipe.name}`} aria-pressed={c.favoriteRecipeIds.includes(recipe.id)}><Star size={15} fill={c.favoriteRecipeIds.includes(recipe.id) ? "currentColor" : "none"} /></button>
        </article>;
      })}</div>
      {!models.length && <div className="studio-picker-empty">{onlyCompatible && c.draft.inputAssetIds.length ? "No configured workflow accepts these inputs. Adjust the task filter or remove extra references." : section === "favorites" ? "No matching favorites. Star a workflow in All models to save it here." : "No matching workflows. Adjust the filters or add a source image."}</div>}
    </div>
  </Dialog>;
}
