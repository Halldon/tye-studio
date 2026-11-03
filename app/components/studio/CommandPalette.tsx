"use client";
import { useId, useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import type { StudioController, Workspace } from "../../lib/types";
import { Dialog } from "./Dialog";

interface Command { id: string; group: string; label: string; detail?: string; run: () => void }
export function CommandPalette({ controller: c, onClose, onNavigate, onImport, onAttach, onNewProject }: { controller: StudioController; onClose: () => void; onNavigate: (value: Workspace) => void; onImport: () => void; onAttach: () => void; onNewProject: () => void }) {
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const commands = useMemo(() => {
    const result: Command[] = [
      ...([{ id: "image", label: "Create image" }, { id: "video", label: "Create video" }, { id: "edit", label: "Edit image" }, { id: "shots", label: "Shots" }, { id: "sequence", label: "Sequence" }, { id: "workflows", label: "Workflows" }, { id: "library", label: "Library" }, { id: "queue", label: "Queue" }, { id: "settings", label: "Settings" }] as const).map(value => ({ id: `nav-${value.id}`, group: "Actions", label: value.label, run: () => onNavigate(value.id) })),
      { id: "import", group: "Actions", label: "Import media", run: onImport },
      { id: "attach", group: "Actions", label: "Attach reference image", run: onAttach },
      { id: "project", group: "Actions", label: "New project", run: onNewProject },
      { id: "export", group: "Actions", label: "Export current project", detail: c.project?.name, run: () => { void c.exportProject(); } },
      ...c.projects.map(project => ({ id: `project-${project.id}`, group: "Projects", label: project.name, detail: project.id === c.selectedProjectId ? "Current project" : "Open project", run: () => c.selectProject(project.id) })),
      ...c.recipes.map(recipe => ({ id: `recipe-${recipe.id}`, group: "Models", label: recipe.name, detail: recipe.kind, run: () => { c.selectRecipe(recipe.id); c.setWorkspace(recipe.kind); } })),
      ...c.allAssets.map(asset => ({ id: `asset-${asset.id}`, group: "Assets", label: asset.name, detail: `${asset.type} · ${c.projects.find(project => project.id === asset.projectId)?.name ?? "Library"}`, run: () => c.openAsset(asset) })),
    ];
    const query = search.trim().toLowerCase();
    const filtered = result.filter(command => !query || `${command.label} ${command.detail ?? ""} ${command.group}`.toLowerCase().includes(query));
    const limits: Record<string, number> = { Actions: 14, Projects: 8, Models: 8, Assets: query ? 20 : 6 };
    const seen: Record<string, number> = {};
    return filtered.filter(command => (seen[command.group] = (seen[command.group] ?? 0) + 1) <= limits[command.group]);
  }, [search, c, onNavigate, onImport, onAttach, onNewProject]);
  const selected = Math.min(active, Math.max(0, commands.length - 1));
  function execute(command?: Command) { if (!command) return; onClose(); command.run(); }
  return <Dialog title="Search and commands" className="studio-command-dialog" onClose={onClose}>
    <div className="studio-command-search"><Search size={18} /><input autoFocus role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={commands[selected] ? `${listId}-${selected}` : undefined} value={search} onChange={event => { setSearch(event.target.value); setActive(0); }} placeholder="Search projects, assets, models or actions…" aria-label="Search projects, assets, models or actions" onKeyDown={event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const next = (selected + (event.key === "ArrowUp" ? -1 : 1) + commands.length) % Math.max(1, commands.length); setActive(next); document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" }); }
      if (event.key === "Enter") { event.preventDefault(); execute(commands[selected]); }
    }} /></div>
    <div className="studio-command-results" role="listbox" id={listId} aria-label="Commands">{commands.map((command, index) => <div key={command.id}>{(index === 0 || command.group !== commands[index - 1].group) && <div className="studio-command-group">{command.group}</div>}<button role="option" tabIndex={-1} id={`${listId}-${index}`} aria-selected={selected === index} className={selected === index ? "is-active" : ""} onPointerMove={() => setActive(index)} onClick={() => execute(command)}><span>{command.label}{command.detail && <small>{command.detail}</small>}</span><ArrowRight size={14} /></button></div>)}{!commands.length && <p className="studio-picker-empty">No matching projects, assets, models or actions.</p>}</div>
  </Dialog>;
}
