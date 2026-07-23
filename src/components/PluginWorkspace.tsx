import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Plus, RefreshCw, Trash2 } from "lucide-react";
import { ApiError, connectWorkspace, createWorkspaceGui, deleteWorkspaceGui, getCatalog, getWorkspaceGui, listWorkspaceGuis, rescanWorkspace, setWorkspaceSessionToken, subscribeWorkspace, type WorkspaceResponse } from "../api/client";
import { defaultWorkspaceGui, workspaceGuiIdFromTitle, type WorkspaceGuiSummary } from "../domain/workspace";
import { pickPluginFolder } from "../desktop";
import type { ProjectDocument } from "../domain/editor";

interface Props {
  onOpenGui: (project: ProjectDocument, etag: string, workspaceId: string) => void;
}

export function PluginWorkspace({ onOpenGui }: Props) {
  const [rootPath, setRootPath] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [guis, setGuis] = useState<WorkspaceGuiSummary[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const connect = async () => {
    if (!rootPath.trim()) return setMessage("Nhập hoặc chọn đường dẫn plugin project.");
    setBusy(true); setMessage(null);
    try {
      const response = await connectWorkspace(rootPath.trim());
      if (response.data.sessionToken) setWorkspaceSessionToken(response.data.sessionToken);
      setWorkspace(response.data); setGuis(response.data.guiIndex.guis); setRootPath("");
    } catch (error) { setMessage(error instanceof ApiError ? error.message : "Không thể kết nối plugin project."); }
    finally { setBusy(false); }
  };
  const chooseFolder = async () => {
    try {
      const selected = await pickPluginFolder();
      if (selected) setRootPath(selected);
      else if (!("__TAURI_INTERNALS__" in window)) setMessage("Folder picker cần JsonGui desktop. Browser mode dùng path text.");
    } catch { setMessage("Không thể mở folder picker."); }
  };
  const refresh = async () => {
    if (!workspace) return;
    setBusy(true); setMessage(null);
    try { const response = await rescanWorkspace(workspace.workspaceId); setWorkspace(response.data); setGuis(response.data.guiIndex.guis); setDirty(false); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : "Rescan thất bại."); }
    finally { setBusy(false); }
  };
  const openGui = async (id: string) => {
    if (!workspace) return;
    try { const response = await getWorkspaceGui(workspace.workspaceId, id); onOpenGui(response.data, response.etag ?? "", workspace.workspaceId); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : "Không thể mở GUI."); }
  };
  const createGui = async () => {
    if (!workspace) return;
    const title = window.prompt("Tên GUI mới", "New GUI");
    if (!title) return;
    const id = workspaceGuiIdFromTitle(title);
    const catalog = await getCatalog();
    const project = defaultWorkspaceGui(id, catalog.data.version);
    project.title = title;
    setBusy(true);
    try { const response = await createWorkspaceGui(workspace.workspaceId, project); setGuis(await listWorkspaceGuis(workspace.workspaceId).then((value) => value.data)); onOpenGui(response.data, response.etag ?? "", workspace.workspaceId); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : "Không thể tạo GUI."); }
    finally { setBusy(false); }
  };
  const removeGui = async (gui: WorkspaceGuiSummary) => {
    if (!workspace || !window.confirm(`Xóa GUI ${gui.title}?`)) return;
    try {
      const loaded = await getWorkspaceGui(workspace.workspaceId, gui.id);
      await deleteWorkspaceGui(workspace.workspaceId, gui.id, loaded.etag ?? "");
      setGuis((await listWorkspaceGuis(workspace.workspaceId)).data);
    } catch (error) { setMessage(error instanceof ApiError ? error.message : "Không thể xóa GUI."); }
  };

  useEffect(() => {
    if (!workspace) return;
    return subscribeWorkspace(workspace.workspaceId, () => setDirty(true));
  }, [workspace?.workspaceId]);

  const filtered = useMemo(() => guis.filter((gui) => `${gui.id} ${gui.title}`.toLowerCase().includes(query.toLowerCase())), [guis, query]);
  const manifest = workspace?.manifest;

  return <div className="plugin-workspace">
    <header className="plugin-workspace-header"><div><span className="workspace-kicker">Plugin Workspace</span><h1>{manifest?.projectName ?? "Connect Plugin Project"}</h1></div><div className="toolbar-row"><button className="secondary-button" onClick={refresh} disabled={!workspace || busy}><RefreshCw size={14} />Rescan</button><button className="primary-button" onClick={createGui} disabled={!workspace || busy}><Plus size={14} />New GUI</button></div></header>
    {!workspace ? <section className="panel plugin-connect-card"><h2>Connect Plugin Project</h2><p>Local backend scan Java/Kotlin, Gradle/Maven, metadata và source roots.</p><label className="field-label">Plugin path<input className="text-input" value={rootPath} onChange={(event) => setRootPath(event.target.value)} placeholder="C:\\Users\\...\\MagicHeroes" onKeyDown={(event) => { if (event.key === "Enter") void connect(); }} /></label><div className="toolbar-row"><button className="secondary-button" onClick={() => void chooseFolder()} disabled={busy}><FolderOpen size={15} />Choose folder</button><button className="primary-button" onClick={() => void connect()} disabled={busy}>{busy ? "Scanning…" : "Connect Plugin Project"}</button></div>{message && <p className="validation-row warning">{message}</p>}<small className="helper">Browser-only mode cần nhập path. Desktop shell sẽ thêm native folder picker.</small></section> : <div className="plugin-workspace-layout"><aside className="panel plugin-explorer"><div className="panel-header"><div className="panel-heading"><div><h2>GUI Explorer</h2><p className="panel-subtitle">{guis.length} GUI · {dirty ? "External changes" : "Synced"}</p></div></div><input className="text-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search GUI..." /></div><div className="list-scroll">{filtered.map((gui) => <div className={`plugin-gui-row ${gui.status}`} key={gui.id}><button onClick={() => void openGui(gui.id)}><strong>{gui.title}</strong><small>{gui.id} · {gui.placementsCount ?? 0} items</small></button><button className="icon-button" aria-label={`Xóa ${gui.title}`} onClick={() => void removeGui(gui)}><Trash2 size={14} /></button></div>)}{filtered.length === 0 && <div className="empty-state"><p>Chưa có GUI.</p></div>}</div></aside><main className="panel plugin-details"><h2>Detected project</h2><div className="plugin-facts">{([["Platform", manifest?.platform], ["Language", manifest?.language], ["Build", manifest?.buildSystem], ["Java", manifest?.javaVersion ?? "unknown"], ["Minecraft", manifest?.minecraftVersion ?? "unknown"], ["Main class", manifest?.mainClass ?? "unknown"], ["Source roots", manifest?.sourceRoots.join(", ") || "unknown"], ["Resources", manifest?.resourceRoot ?? "unknown"]] as const).map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>{manifest?.issues?.map((issue) => <p className={`validation-row ${issue.severity === "error" ? "error" : "warning"}`} key={`${issue.code}-${issue.message}`}>{issue.message}</p>)}{message && <p className="validation-row warning">{message}</p>}</main></div>}
  </div>;
}
