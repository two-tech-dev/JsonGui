import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type Dispatch, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  Download,
  Eye,
  FileDown,
  FolderOpen,
  GripVertical,
  HelpCircle,
  LayoutGrid,
  ListFilter,
  Lock,
  Maximize2,
  MessageCircle,
  PanelLeft,
  PanelRight,
  Plus,
  Redo2,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { PixelItemIcon } from "./components/PixelItemIcon";
import { LibraryVirtualGrid } from "./components/LibraryVirtualGrid";
import { PluginWorkspace } from "./components/PluginWorkspace";
import { ApiError, bootstrapSessionToken, getCanonicalExport, getCatalog, getProject, getWorkspaceGui, listJsonSkills, putProject, putWorkspaceGui, type JsonSkillSummary } from "./api/client";
import { canCheckForUpdates, checkForUpdate, downloadInstallAndRelaunch, type UpdateInfo, type UpdateProgress } from "./platform/updater";
import {
  CONTAINERS,
  editorStateToProject,
  type ProjectDocument,
  buildExport,
  getFilteredItems,
  getItem,
  canonicalExportToProject,
  isCanonicalGuiExport,
  initialState,
  isValidContainerSlot,
  reducer,
  type ContainerSpec,
  type EditorState,
  type ItemDefinition,
  type PlacedItem,
  type ItemAction,
} from "./domain/editor";
import { mapJsonGuiToDeluxeMenus, serializeDeluxeMenus, generateExternalMenuSnippet } from "../shared/export/index";
import { parse as parseYaml } from "yaml";
import { parseMinecraftText } from "./domain/minecraftText";

const categories = ["All", "Tools", "Decoration", "Combat", "Food", "Redstone", "Utility", "Misc"] as const;

function importDeluxeMenusYaml(yamlStr: string, catalog: ItemDefinition[]): Partial<ProjectDocument> {
  try {
    const data = parseYaml(yamlStr);
    if (!data || typeof data !== "object") throw new Error("Invalid YAML structure");

    const title = String(data.menu_title || data.title || "Imported Menu");
    const size = Number(data.size) || 54;
    const rows = Math.ceil(size / 9);

    let containerId = "double-chest";
    if (data.inventory_type) {
      const inv = String(data.inventory_type).toUpperCase();
      if (inv === "HOPPER") containerId = "hopper";
      else if (inv === "DISPENSER") containerId = "dispenser";
      else if (inv === "DROPPER") containerId = "dropper";
      else if (inv === "ANVIL") containerId = "anvil";
      else if (inv === "FURNACE") containerId = "furnace";
      else if (inv === "BREWING") containerId = "brewing";
      else if (inv === "WORKBENCH") containerId = "workbench";
    } else {
      if (rows <= 1) containerId = "hopper";
      else if (rows <= 3) containerId = "single-chest";
      else containerId = "double-chest";
    }

    const container = CONTAINERS.find(c => c.id === containerId);

    const placements: PlacedItem[] = [];
    if (data.items && typeof data.items === "object") {
      for (const [, value] of Object.entries(data.items)) {
        if (!value || typeof value !== "object") continue;
        const val = value as Record<string, unknown>;
        const slot = Number(val.slot) || 0;
        const material = String(val.material || "STONE").toUpperCase();

        const def = catalog.find(i => i.material === material) || catalog[0];
        const itemId = def ? def.id : "minecraft:stone";

        let action: ItemAction = { type: "prompt_only" };
        const cmdList = (val.left_click_commands || val.click_commands || []) as string[];
        if (cmdList.length > 0) {
          const cmd = String(cmdList[0]);
          if (cmd.startsWith("[openguimenu]")) {
            action = { type: "open_gui", guiId: cmd.replace("[openguimenu]", "").trim() };
          } else if (cmd.startsWith("[player]")) {
            action = { type: "run_command", command: cmd.replace("[player]", "").trim() };
          } else if (cmd.startsWith("[close]")) {
            action = { type: "close_inventory" };
          } else if (cmd.startsWith("[message]")) {
            action = { type: "send_message", message: cmd.replace("[message]", "").trim() };
          }
        }

        if (slot >= 0 && container && slot < container.slots) {
          placements.push({
            slot,
            itemId,
            amount: Number(val.amount) || 1,
            displayName: String(val.display_name || def?.name || "Item"),
            lore: Array.isArray(val.lore) ? val.lore.map(String) : [],
            action,
            includeInExport: true
          });
        }
      }
    }

    return {
      schemaVersion: 1,
      title,
      containerId,
      placements
    };
  } catch (err) {
    console.error("DeluxeMenus YAML import error:", err);
    throw err;
  }
}

function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [appMode, setAppMode] = useState<"editor" | "workspace">("editor");
  const [dragSlot, setDragSlot] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragSourceRef = useRef<number | null>(null);
  const dropHandledRef = useRef(false);

  useEffect(() => {
    const handleDragStart = (event: globalThis.DragEvent) => {
      setIsDragging(true);
      dropHandledRef.current = false;
      try {
        const data = JSON.parse(event.dataTransfer?.getData("text/plain") ?? "") as { source?: string; slot?: number };
        dragSourceRef.current = data.source === "slot" && data.slot !== undefined ? data.slot : null;
      } catch { dragSourceRef.current = null; }
    };
    const handleDragEnd = () => {
      if (!dropHandledRef.current && dragSourceRef.current !== null) dispatch({ type: "REMOVE_ITEM", slot: dragSourceRef.current });
      dragSourceRef.current = null;
      setIsDragging(false);
    };
    window.addEventListener("dragstart", handleDragStart);
    window.addEventListener("dragend", handleDragEnd);
    return () => {
      window.removeEventListener("dragstart", handleDragStart);
      window.removeEventListener("dragend", handleDragEnd);
    };
  }, []);
  const [apiStatus, setApiStatus] = useState<"loading" | "saved" | "saving" | "offline" | "conflict">("loading");
  const [etag, setEtag] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [saveTick, setSaveTick] = useState(0);
  const [update, setUpdate] = useState<{ info: UpdateInfo; phase: "available" | "downloading" | "installing" | "error"; percent?: number; message?: string } | null>(null);
  const updateCheckStarted = useRef(false);

  // Keyboard navigation & zoom state history
  const [undoStack, setUndoStack] = useState<Omit<EditorState, "toast" | "dirty" | "overlay">[]>([]);
  const [redoStack, setRedoStack] = useState<Omit<EditorState, "toast" | "dirty" | "overlay">[]>([]);
  const [activityLog, setActivityLog] = useState<{ id: string; time: string; action: string }[]>([]);

  // Local preferences
  const [placedSearch, setPlacedSearch] = useState("");

  const [placedSort, setPlacedSort] = useState<"slot" | "name" | "material">("slot");
  const [placedDensity, setPlacedDensity] = useState<"comfortable" | "compact">("comfortable");
  const [librarySort, setLibrarySort] = useState<"name" | "material">("name");
  const [libraryDensity, setLibraryDensity] = useState<"comfortable" | "compact">("comfortable");

  // Track project mutations in undo history
  const lastStateRef = useRef<Omit<EditorState, "toast" | "dirty" | "overlay"> | null>(null);

  useEffect(() => {
    // Save snapshot of mutations to undo history when placements/defaults/container/title change
    if (!state.dirty || !lastStateRef.current) return;
    const prev = lastStateRef.current;
    const hasProjectMutations =
      JSON.stringify(prev.placements) !== JSON.stringify(state.placements) ||
      JSON.stringify(prev.itemDefaults) !== JSON.stringify(state.itemDefaults) ||
      prev.container.id !== state.container.id ||
      prev.title !== state.title ||
      prev.description !== state.description;

    if (hasProjectMutations) {
      setUndoStack((stack) => [...stack, prev]);
      setRedoStack([]); // Clear redo stack on new mutations
      // Log activity
      let desc = "Đã chỉnh sửa GUI";
      if (JSON.stringify(prev.placements) !== JSON.stringify(state.placements)) {
        const addedSlot = Object.keys(state.placements).find((k) => !prev.placements[Number(k)]);
        const removedSlot = Object.keys(prev.placements).find((k) => !state.placements[Number(k)]);
        if (addedSlot) desc = `Thêm item vào slot ${addedSlot}`;
        else if (removedSlot) desc = `Xóa item khỏi slot ${removedSlot}`;
        else desc = "Di chuyển item";
      } else if (prev.container.id !== state.container.id) desc = `Đổi container sang ${state.container.label}`;
      else if (prev.title !== state.title) desc = "Đổi tiêu đề GUI";
      setActivityLog((log) => [{ id: Math.random().toString(), time: new Date().toLocaleTimeString(), action: desc }, ...log].slice(0, 50));
    }
    lastStateRef.current = { ...state };
  }, [state.placements, state.itemDefaults, state.container, state.title, state.description, state.dirty]);

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, { ...state }]);
    lastStateRef.current = prev;
    dispatch({ type: "HYDRATE", project: editorStateToProject(prev as EditorState), catalog: state.catalog });
    dispatch({ type: "TOAST", toast: { message: "Đã hoàn tác hành động", tone: "info" } });
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, { ...state }]);
    lastStateRef.current = next;
    dispatch({ type: "HYDRATE", project: editorStateToProject(next as EditorState), catalog: state.catalog });
    dispatch({ type: "TOAST", toast: { message: "Đã làm lại hành động", tone: "info" } });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await bootstrapSessionToken();
        const projectResponse = await getProject("main-menu");
        const project = projectResponse.data as ProjectDocument;
        const catalogResponse = await getCatalog(project.catalogVersion);
        if (cancelled) return;
        const items = catalogResponse.data.items;
        localStorage.setItem(`gui-forge:catalog:${project.catalogVersion}`, JSON.stringify(items));
        dispatch({ type: "HYDRATE", project, catalog: items });
        lastStateRef.current = { ...initialState, projectId: project.id, catalogVersion: project.catalogVersion, catalog: items, title: project.title, description: project.description, placements: Object.fromEntries(project.placements.map((p) => [p.slot, p])), itemDefaults: project.itemDefaults ?? {} };
        setEtag(projectResponse.etag);
        setApiStatus("saved");
      } catch {
        if (cancelled) return;
        try {
          const backup = localStorage.getItem("gui-forge:main-menu:backup");
          if (backup) {
            const backupProject = JSON.parse(backup) as ProjectDocument;
            const cachedCatalog = localStorage.getItem(`gui-forge:catalog:${backupProject.catalogVersion}`);
            if (cachedCatalog) {
              dispatch({ type: "HYDRATE", project: backupProject, catalog: JSON.parse(cachedCatalog) });
              lastStateRef.current = { ...initialState, projectId: backupProject.id, catalogVersion: backupProject.catalogVersion, catalog: JSON.parse(cachedCatalog), title: backupProject.title, description: backupProject.description, placements: Object.fromEntries(backupProject.placements.map((p) => [p.slot, p])), itemDefaults: backupProject.itemDefaults ?? {} };
            }
          }
        } catch { /* keep catalog unavailable state */ }
        setApiStatus("offline");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!canCheckForUpdates() || updateCheckStarted.current) return;
    updateCheckStarted.current = true;
    let cancelled = false;
    void checkForUpdate().then((available) => {
      if (!cancelled && available) setUpdate({ info: available, phase: "available" });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const installUpdate = async () => {
    if (!update || update.phase === "downloading" || update.phase === "installing") return;
    const info = update.info;
    try {
      await downloadInstallAndRelaunch((progress: UpdateProgress) => {
        setUpdate({ info, phase: progress.phase, percent: progress.phase === "downloading" ? progress.percent : undefined });
      });
    } catch {
      setUpdate({ info, phase: "error", message: "Không thể tải hoặc xác minh bản cập nhật. Ứng dụng chưa thay đổi." });
    }
  };

  const saveGeneration = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!state.dirty || apiStatus === "loading" || apiStatus === "conflict") return;
    const generation = ++saveGeneration.current;
    const timeout = window.setTimeout(async () => {
      if (!etag || inFlight.current) return;
      inFlight.current = true;
      setApiStatus("saving");
      const snapshot = editorStateToProject(state);
      try {
        const response = activeWorkspaceId
          ? await putWorkspaceGui(activeWorkspaceId, state.projectId, snapshot, etag)
          : await putProject(state.projectId, snapshot, etag);
        setEtag(response.etag);
        if (generation === saveGeneration.current) dispatch({ type: "MARK_SAVED", revision: (response.data as ProjectDocument).revision });
        setApiStatus(generation === saveGeneration.current ? "saved" : "saving");
      } catch (error) { setApiStatus(error instanceof ApiError && error.status === 412 ? "conflict" : "offline"); }
      finally { inFlight.current = false; setSaveTick((tick) => tick + 1); }
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [state, apiStatus, etag, saveTick]);

  useEffect(() => {
    if (apiStatus !== "conflict") return;
    dispatch({ type: "TOAST", toast: { message: "Xung đột phiên bản. Tải lại dự án để giữ bản server.", tone: "warning" } });
  }, [apiStatus]);

  useEffect(() => {
    if (!etag || apiStatus === "loading" || apiStatus === "offline") return;
    let cancelled = false;
    const refresh = async () => {
      if (cancelled || state.dirty || inFlight.current || apiStatus === "saving" || apiStatus === "conflict") return;
      try {
        const response = activeWorkspaceId ? await getWorkspaceGui(activeWorkspaceId, state.projectId) : await getProject(state.projectId);
        if (cancelled || !response.etag || response.etag === etag) return;
        const project = response.data as ProjectDocument;
        const catalog = project.catalogVersion === state.catalogVersion ? state.catalog : (await getCatalog(project.catalogVersion)).data.items;
        if (cancelled) return;
        dispatch({ type: "HYDRATE", project, catalog });
        setEtag(response.etag);
        setApiStatus("saved");
        setUndoStack([]);
        setRedoStack([]);
        dispatch({ type: "TOAST", toast: { message: "GUI đã cập nhật từ AI/MCP.", tone: "info" } });
      } catch { /* retry next poll */ }
    };
    const interval = window.setInterval(() => void refresh(), 2_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [activeWorkspaceId, apiStatus, etag, state.catalog, state.catalogVersion, state.dirty, state.projectId]);

  useEffect(() => {
    document.body.style.overflow = state.overlay || update ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [state.overlay, update]);

  useEffect(() => {
    if (apiStatus !== "offline" || !state.dirty) return;
    try { localStorage.setItem(`gui-forge:main-menu:backup:${state.catalogVersion}`, JSON.stringify(editorStateToProject(state))); } catch { /* storage is optional */ }
  }, [state, apiStatus]);

  useEffect(() => {
    if (!state.dirty) return;
    try { localStorage.setItem("gui-forge:main-menu:backup", JSON.stringify(editorStateToProject(state))); } catch { /* storage is optional */ }
  }, [state]);

  useEffect(() => {
    if (!state.toast) return;
    const timeout = window.setTimeout(() => dispatch({ type: "CLEAR_TOAST" }), 4000);
    return () => window.clearTimeout(timeout);
  }, [state.toast]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const element = event.target as HTMLElement;
      if (element.matches("input, textarea, select")) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        handleRedo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
        event.preventDefault();
        dispatch({ type: "OPEN_OVERLAY", overlay: "export" });
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        document.getElementById("menu-file-input")?.click();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "0") {
        event.preventDefault();
        dispatch({ type: "SET_ZOOM", zoom: 1 });
      }
      if (event.key === "p" && state.selectedSlot !== null && state.placements[state.selectedSlot]) {
        dispatch({ type: "OPEN_EDITOR", target: { kind: "placement", slot: state.selectedSlot } });
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (state.selectedSlot !== null) {
          const placed = state.placements[state.selectedSlot];
          if (placed) {
            const newName = window.prompt("Nhập tên hiển thị mới cho item:", placed.displayName);
            if (newName !== null) {
              dispatch({ type: "RENAME_ITEM", slot: state.selectedSlot, name: newName });
            }
          }
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.selectedSlot, state.placements, undoStack, redoStack]);

  const placedItems = useMemo(() => {
    let list = Object.values(state.placements);
    if (placedSearch.trim()) {
      const q = placedSearch.toLowerCase();
      list = list.filter((item) => item.displayName.toLowerCase().includes(q) || item.itemId.toLowerCase().includes(q));
    }
    if (placedSort === "name") {
      list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    } else if (placedSort === "material") {
      list.sort((a, b) => {
        const defA = getItem(a.itemId, state.catalog);
        const defB = getItem(b.itemId, state.catalog);
        return (defA?.material ?? "").localeCompare(defB?.material ?? "");
      });
    } else {
      list.sort((a, b) => a.slot - b.slot);
    }
    return list;
  }, [state.placements, state.catalog, placedSearch, placedSort]);

  const sortedLibraryItems = useMemo(() => {
    const list = getFilteredItems(state);
    if (librarySort === "material") {
      list.sort((a, b) => a.material.localeCompare(b.material));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [state.catalog, state.query, state.category, state.libraryTab, state.favorites, state.recentItemIds, librarySort]);

  const placeItem = (slot: number, itemId: string) => {
    if (!isValidContainerSlot(slot, state.container)) {
      dispatch({ type: "TOAST", toast: { message: "Chỉ đặt item trong container GUI", tone: "warning" } });
      return;
    }
    const oldItem = state.placements[slot];
    const definition = getItem(itemId, state.catalog);
    if (!definition) { dispatch({ type: "TOAST", toast: { message: "Item không tồn tại trong catalog", tone: "error" } }); return; }
    dispatch({ type: "PLACE_ITEM", slot, itemId });
    dispatch({ type: "TOAST", toast: { message: oldItem ? `Đã thay thế ${oldItem.displayName} tại Slot ${slot}` : `Đã thêm ${definition.name} vào Slot ${slot}`, tone: "success", undo: true } });
  };

  const quickAdd = (itemId: string) => {
    const target = Array.from({ length: state.container.slots }, (_, slot) => slot).find((slot) => !state.placements[slot]);
    if (target === undefined) {
      dispatch({ type: "TOAST", toast: { message: `GUI đã đầy ${state.container.slots} slot`, tone: "warning" } });
      return;
    }
    placeItem(target, itemId);
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>, slot: number) => {
    event.preventDefault();
    setDragSlot(null);
    if (!isValidContainerSlot(slot, state.container)) return;
    const raw = event.dataTransfer.getData("application/x-gui-forge-item") || event.dataTransfer.getData("text/plain");
    if (!raw) return;
    try {
      dropHandledRef.current = true;
      const data = JSON.parse(raw) as { source: "library" | "slot"; itemId?: string; slot?: number };
      if (data.source === "library" && data.itemId) placeItem(slot, data.itemId);
      if (data.source === "slot" && data.slot !== undefined) dispatch({ type: "MOVE_ITEM", from: data.slot, to: slot });
    } catch {
      dispatch({ type: "TOAST", toast: { message: "Không thể đọc item đang kéo", tone: "error" } });
    }
  };

  const undoToast = () => {
    handleUndo();
  };
  const openWorkspaceGui = async (project: ProjectDocument, nextEtag: string, workspaceId: string) => {
    try {
      const catalogResponse = await getCatalog(project.catalogVersion);
      dispatch({ type: "HYDRATE", project, catalog: catalogResponse.data.items });
      setEtag(nextEtag);
      setActiveWorkspaceId(workspaceId);
      try { localStorage.setItem("jsongui:workspace:active", workspaceId); } catch { /* storage optional */ }
      setAppMode("editor");
      setApiStatus("saved");
    } catch (error) {
      dispatch({ type: "TOAST", toast: { message: error instanceof Error ? error.message : "Không thể tải catalog cho GUI.", tone: "error" } });
    }
  };

  if (appMode === "workspace") return <div className="app-shell plugin-workspace-shell"><div className="plugin-workspace-nav"><button className="secondary-button" onClick={() => setAppMode("editor")}>Back to editor</button></div><PluginWorkspace onOpenGui={(project, nextEtag, workspaceId) => void openWorkspaceGui(project, nextEtag, workspaceId)} /></div>;

  return <div className={`app-shell ${isDragging ? "dragging" : ""}`}>
    <a className="skip-link" href="#workspace">Bỏ qua thanh công cụ</a>
    <AppHeader state={state} apiStatus={apiStatus} dispatch={dispatch} handleUndo={handleUndo} handleRedo={handleRedo} undoStack={undoStack} redoStack={redoStack} activityLog={activityLog} onOpenWorkspace={() => setAppMode("workspace")} />
    <div className="editor-layout">
      <PlacedItemsPanel state={state} placedItems={placedItems} dispatch={dispatch} placedSearch={placedSearch} setPlacedSearch={setPlacedSearch} placedSort={placedSort} setPlacedSort={setPlacedSort} placedDensity={placedDensity} setPlacedDensity={setPlacedDensity} />
      <main className="workspace" id="workspace">
        <div className="workspace-header-section">
          <div className="mobile-panel-buttons">
            <button className="secondary-button" onClick={() => dispatch({ type: "OPEN_OVERLAY", overlay: "placed" })}><PanelLeft size={16} />Item đã đặt <span className="badge">{Object.keys(state.placements).length}</span></button>
            <button className="secondary-button" onClick={() => dispatch({ type: "OPEN_OVERLAY", overlay: "library" })}><PanelRight size={16} />Thư viện</button>
          </div>
          <WorkspaceToolbar state={state} dispatch={dispatch} />
        </div>
        <div className="canvas-viewport">
          <div className="inventory-wrapper">
            <InventoryPreview state={state} dragSlot={dragSlot} setDragSlot={setDragSlot} onDrop={onDrop} dispatch={dispatch} />

          </div>
        </div>
        <div className="stat-row" aria-label="Tóm tắt GUI">
          <div className="stat-pill"><strong>{state.container.slots}</strong> ô</div>
          <div className="stat-pill"><strong>{Object.keys(state.placements).length}</strong> đã đặt</div>
          <div className="stat-pill"><strong>{state.container.slots - Object.keys(state.placements).length}</strong> trống</div>
        </div>
      </main>
      <ItemLibraryPanel state={state} filteredItems={sortedLibraryItems} dispatch={dispatch} librarySort={librarySort} setLibrarySort={setLibrarySort} libraryDensity={libraryDensity} setLibraryDensity={setLibraryDensity} onQuickAdd={quickAdd} />
    </div>
    {state.overlay === "drawer" && <ItemDrawer state={state} dispatch={dispatch} />}
    {state.overlay === "container" && <ContainerPicker state={state} dispatch={dispatch} />}
    {state.overlay === "export" && <ExportModal state={state} apiStatus={apiStatus} dispatch={dispatch} />}
    {state.overlay === "placed" && <MobilePanel title="Item đã đặt" onClose={() => dispatch({ type: "CLOSE_OVERLAY" })}><PlacedItemsPanel state={state} placedItems={placedItems} dispatch={dispatch} placedSearch={placedSearch} setPlacedSearch={setPlacedSearch} placedSort={placedSort} setPlacedSort={setPlacedSort} placedDensity={placedDensity} setPlacedDensity={setPlacedDensity} embedded /></MobilePanel>}
    {state.overlay === "library" && <MobilePanel title="Minecraft items" onClose={() => dispatch({ type: "CLOSE_OVERLAY" })}><ItemLibraryPanel state={state} filteredItems={sortedLibraryItems} dispatch={dispatch} librarySort={librarySort} setLibrarySort={setLibrarySort} libraryDensity={libraryDensity} setLibraryDensity={setLibraryDensity} onQuickAdd={quickAdd} embedded /></MobilePanel>}
    {update && <UpdateModal update={update} onInstall={() => void installUpdate()} onClose={() => setUpdate(null)} onRetry={() => { setUpdate(null); void checkForUpdate().then((info) => { if (info) setUpdate({ info, phase: "available" }); }).catch(() => undefined); }} />}
    <ToastRegion state={state} dispatch={dispatch} handleUndo={undoToast} />
  </div>;
}

function UpdateModal({ update, onInstall, onClose, onRetry }: { update: { info: UpdateInfo; phase: "available" | "downloading" | "installing" | "error"; percent?: number; message?: string }; onInstall: () => void; onClose: () => void; onRetry: () => void }) {
  const busy = update.phase === "downloading" || update.phase === "installing";
  const close = busy ? undefined : onClose;
  const status = update.phase === "downloading" ? `Đang tải${update.percent === undefined ? "…" : ` ${update.percent}%`}` : update.phase === "installing" ? "Đang xác minh và cài đặt…" : update.phase === "error" ? update.message : "Bản mới đã sẵn sàng để tải và cài đặt.";
  return <div className="overlay-scrim modal-wrap" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close?.(); }}><section className="modal small" role="dialog" aria-modal="true" aria-labelledby="update-title" aria-live="polite">
    <header className="modal-header"><div><h2 id="update-title">Có bản cập nhật mới</h2><p>JsonGui {update.info.currentVersion} → {update.info.version}</p></div>{close && <button className="icon-button" aria-label="Đóng cập nhật" onClick={close}><X size={18} /></button>}</header>
    <div className="modal-body"><p>{status}</p>{update.info.notes && <section className="form-section"><h3>Có gì mới</h3><pre className="update-notes">{update.info.notes}</pre></section>}</div>
    <footer className="modal-footer">{update.phase === "error" ? <><button className="ghost-button" onClick={onClose}>Để sau</button><button className="primary-button" onClick={onRetry}>Thử lại</button></> : busy ? <button className="primary-button" disabled>{status}</button> : <><button className="ghost-button" onClick={onClose}>Để sau</button><button className="primary-button" onClick={onInstall}>Tải và cài đặt</button></>}</footer>
  </section></div>;
}

function AppHeader({ state, apiStatus, dispatch, handleUndo, handleRedo, undoStack, redoStack, activityLog, onOpenWorkspace }: { state: EditorState; apiStatus: "loading" | "saved" | "saving" | "offline" | "conflict"; dispatch: Dispatch<Parameters<typeof reducer>[1]>; handleUndo: () => void; handleRedo: () => void; undoStack: unknown[]; redoStack: unknown[]; activityLog: Array<{ id: string; time: string; action: string }>; onOpenWorkspace: () => void }) {
  const [showActivity, setShowActivity] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [jsonSkills, setJsonSkills] = useState<JsonSkillSummary[]>([]);
  const [activeMenu, setActiveMenu] = useState<"file" | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<ProjectDocument[]>(() => {
    try { return JSON.parse(localStorage.getItem("gui-forge:templates") ?? "[]") as ProjectDocument[]; } catch { return []; }
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleOutsideClick = () => setActiveMenu(null);
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, []);

  const saveTemplate = () => {
    const template = { ...editorStateToProject(state), id: `template-${Date.now()}`, updatedAt: new Date().toISOString() };
    const next = [template, ...templates].slice(0, 30);
    localStorage.setItem("gui-forge:templates", JSON.stringify(next));
    setTemplates(next);
    dispatch({ type: "TOAST", toast: { message: "Đã lưu template", tone: "success" } });
  };
  const deleteTemplate = (id: string) => {
    const next = templates.filter((item) => item.id !== id);
    localStorage.setItem("gui-forge:templates", JSON.stringify(next));
    setTemplates(next);
  };
  const loadTemplate = (template: ProjectDocument) => {
    dispatch({ type: "HYDRATE", project: { ...template, id: state.projectId, revision: state.revision, updatedAt: new Date().toISOString() }, catalog: state.catalog });
    setShowTemplates(false);
  };

  const triggerFileOpen = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      try {
        if (file.name.endsWith(".json")) {
          const parsed = JSON.parse(text) as unknown;
          if (typeof parsed === "object" && parsed !== null && "schemaVersion" in parsed && parsed.schemaVersion === 1) {
            dispatch({ type: "HYDRATE", project: parsed as ProjectDocument, catalog: state.catalog });
            dispatch({ type: "TOAST", toast: { message: "Đã import file JSON thành công", tone: "success" } });
          } else if (isCanonicalGuiExport(parsed)) {
            const source = parsed as { catalogVersion: string };
            let importedCatalog = state.catalog;
            if (state.catalogVersion !== source.catalogVersion || importedCatalog.length === 0) {
              const response = await getCatalog(source.catalogVersion);
              if (response.data.version !== source.catalogVersion) throw new Error("Catalog version không khớp file import");
              importedCatalog = response.data.items;
              localStorage.setItem(`gui-forge:catalog:${source.catalogVersion}`, JSON.stringify(importedCatalog));
            }
            const project = canonicalExportToProject(parsed, { id: state.projectId, revision: state.revision, description: state.description }, importedCatalog);
            dispatch({ type: "HYDRATE", project, catalog: importedCatalog, dirty: true });
            dispatch({ type: "TOAST", toast: { message: `Đã import GUI JSON: ${project.title}`, tone: "success" } });
          } else {
            throw new Error("File JSON không phải JsonGui project hoặc canonical export");
          }
        } else if (file.name.endsWith(".yml") || file.name.endsWith(".yaml")) {
          const doc = importDeluxeMenusYaml(text, state.catalog);
          const fullDoc: ProjectDocument = {
            schemaVersion: 1,
            id: state.projectId,
            revision: state.revision,
            catalogVersion: state.catalogVersion,
            title: doc.title || "Imported Menu",
            description: state.description,
            containerId: doc.containerId || "double-chest",
            itemDefaults: {},
            placements: doc.placements || [],
            updatedAt: new Date().toISOString()
          };
          dispatch({ type: "HYDRATE", project: fullDoc, catalog: state.catalog });
          dispatch({ type: "TOAST", toast: { message: "Đã import file DeluxeMenus YAML thành công!", tone: "success" } });
        }
      } catch (err) {
        dispatch({ type: "TOAST", toast: { message: `Import lỗi: ${err instanceof Error ? err.message : "Định dạng không hợp lệ"}`, tone: "error" } });
      }
    };
    reader.readAsText(file);
  };

  return <header className="app-header">
    <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: "none" }} id="menu-file-input" accept=".json,.yml,.yaml" />
    <div className="header-left">
      <div className="brand" aria-label="JsonGui">
        <span><strong><span style={{ color: "var(--text-primary)" }}>Json</span><span style={{ color: "var(--accent)" }}>Gui</span></strong></span>
      </div>
    </div>
    <div className="header-center">
      <div className="project-context">
        <span className="project-label">GUI hiện tại</span>
        <strong>{state.title || "Untitled GUI"}</strong>
      </div>
      <div className="template-menu">
        <button className="secondary-button template-button" onClick={() => setShowTemplates(!showTemplates)}>Mẫu <ChevronDown size={13} /></button>
        <button className="icon-button" aria-label="Lưu template" title="Lưu template" onClick={saveTemplate}><Save size={15} /></button>
        {showTemplates && <div className="template-popover">{templates.length === 0 ? <p>Chưa có template.</p> : templates.map((template) => <div className="template-row" key={`${template.id}-${template.updatedAt}`}><button onClick={() => loadTemplate(template)}><strong>{template.title}</strong><small>{template.containerId} · {template.placements.length} items</small></button><button className="icon-button" aria-label={`Xóa template ${template.title}`} onClick={() => deleteTemplate(template.id)}><Trash2 size={14} /></button></div>)}</div>}
      </div>
      <div className="status">
        <i className="status-dot" />
        <span>{{ loading: "Đang tải…", saved: "Đã lưu", saving: "Đang lưu…", offline: "Chưa lưu", conflict: "Xung đột" }[apiStatus]}</span>
      </div>
    </div>
    <div className="header-actions">
      <div className="menu-bar" onClick={(e) => e.stopPropagation()}>
        <button className={`header-menu-button ${activeMenu === "file" ? "open" : ""}`} aria-label="File menu" onClick={() => setActiveMenu(activeMenu === "file" ? null : "file")}>File</button>
        {activeMenu === "file" && <div className="menu-dropdown header-menu-dropdown">
          <button className="menu-dropdown-item" onClick={() => { triggerFileOpen(); setActiveMenu(null); }}><span>Mở file...</span><span className="shortcut">Ctrl+O</span></button>
          <div className="menu-dropdown-separator" />
          <button className="menu-dropdown-item" onClick={() => { dispatch({ type: "OPEN_OVERLAY", overlay: "export" }); setActiveMenu(null); }}><span>Xuất JSON...</span><span className="shortcut">Ctrl+E</span></button>
          <button className="menu-dropdown-item" onClick={() => { dispatch({ type: "OPEN_OVERLAY", overlay: "export" }); setActiveMenu(null); }}><span>Xuất YAML...</span></button>
        </div>}
      </div>
      <span className="header-action-divider" aria-hidden="true" />
      <button className="icon-button" aria-label="Hoàn tác" title="Hoàn tác · Ctrl + Z" onClick={handleUndo} disabled={undoStack.length === 0}><Undo2 size={16} /></button>
      <button className="icon-button" aria-label="Làm lại" title="Làm lại · Ctrl + Shift + Z" onClick={handleRedo} disabled={redoStack.length === 0}><Redo2 size={16} /></button>
      <div style={{ position: "relative" }}>
        <button className="icon-button" aria-label="Hoạt động" title="Hoạt động" onClick={() => setShowActivity(!showActivity)}><Clock3 size={16} /></button>
        {showActivity && <div className="popover activity-popover" style={{ position: "absolute", top: 40, right: 0, width: 260, background: "var(--surface-panel)", border: "1px solid var(--border-subtle)", padding: 12, borderRadius: 8, zIndex: 10 }}>
          <h4 style={{ margin: "0 0 8px 0", fontSize: 12, fontWeight: 600 }}>Nhật ký hoạt động</h4>
          <div style={{ maxHeight: 180, overflowY: "auto", fontSize: 11, color: "var(--text-secondary)" }}>
            {activityLog.length === 0 ? <p style={{ margin: 0 }}>Chưa có hoạt động nào.</p> : activityLog.map((log) => <div key={log.id} style={{ marginBottom: 6 }}><span style={{ color: "var(--accent)" }}>[{log.time}]</span> {log.action}</div>)}
          </div>
        </div>}
      </div>
      <button className="secondary-button" onClick={onOpenWorkspace}><FolderOpen size={15} />Workspace</button>
       <button className="icon-button" aria-label="Cài đặt dự án" title="Cài đặt dự án" onClick={() => { setShowSettings(true); void listJsonSkills().then((response) => setJsonSkills(response.data)).catch(() => setJsonSkills([])); }}><Settings size={16} /></button>
      <button className="icon-button" aria-label="Trợ giúp" title="Trợ giúp · Ctrl + K" onClick={() => setShowHelp(true)}><CircleHelp size={16} /></button>
      <button className="primary-button" onClick={() => dispatch({ type: "OPEN_OVERLAY", overlay: "export" })}><Download size={16} />Export</button>
    </div>

    {showSettings && <div className="overlay-scrim modal-wrap" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}><section className="modal small" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="modal-header"><div><h2 id="settings-title">Cài đặt dự án</h2><p>Cấu hình thuộc tính dự án và hiển thị.</p></div><button className="icon-button" aria-label="Đóng cài đặt" onClick={() => setShowSettings(false)}><X size={18} /></button></header>
      <div className="modal-body">
        <section className="form-section">
          <label className="field-label">Phiên bản Minecraft</label>
          <input className="text-input" value="Minecraft Java 1.21.8" readOnly />
        </section>
        <section className="form-section">
          <label className="field-label">Độ phân giải hiển thị</label>
          <input className="text-input" value="Bình thường (CrispEdges)" readOnly />
        </section>
        <section className="form-section">
          <label className="field-label" htmlFor="json-skill">JsonSkill</label>
          <select id="json-skill" className="text-input" value={state.jsonSkillId ?? ""} onChange={(event) => dispatch({ type: "SET_JSON_SKILL", jsonSkillId: event.target.value || undefined })}>
            <option value="">Không dùng JsonSkill</option>
            {jsonSkills.map((skill) => <option key={skill.id} value={skill.id}>{skill.id} · {skill.fileCount} file</option>)}
          </select>
        </section>
      </div>
      <footer className="modal-footer"><button className="primary-button" onClick={() => setShowSettings(false)}>Đóng</button></footer>
    </section></div>}

    {showHelp && <div className="overlay-scrim modal-wrap" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowHelp(false); }}><section className="modal small" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <header className="modal-header"><div><h2 id="help-title">Trợ giúp & Phím tắt</h2><p>Hướng dẫn xây dựng menu Minecraft.</p></div><button className="icon-button" aria-label="Đóng trợ giúp" onClick={() => setShowHelp(false)}><X size={18} /></button></header>
      <div className="modal-body" style={{ fontSize: 13 }}>
        <p><strong>HTML5 Kéo & Thả:</strong> Kéo item từ thư viện (phải) vào slot bất kỳ để đặt item. Kéo item đã đặt để chuyển vị trí hoặc kéo xuống thùng rác phía dưới để xóa.</p>
        <h4 style={{ margin: "16px 0 8px 0" }}>Phím tắt phổ biến:</h4>
        <ul style={{ paddingLeft: 18, lineHeight: 1.6 }}>
          <li><kbd>Ctrl + Z</kbd> / <kbd>Ctrl + Y</kbd>: Hoàn tác / Làm lại hành động</li>
          <li><kbd>Ctrl + E</kbd>: Mở trình xuất JSON dự án</li>
          <li><kbd>Delete</kbd>: Xóa item trong slot được chọn</li>
          <li><kbd>Mũi tên</kbd>: Di chuyển vùng chọn slot</li>
        </ul>
      </div>
      <footer className="modal-footer"><button className="primary-button" onClick={() => setShowHelp(false)}>Đóng</button></footer>
    </section></div>}
  </header>;
}

function WorkspaceToolbar({ state, dispatch }: { state: EditorState; dispatch: Dispatch<Parameters<typeof reducer>[1]> }) {
  const [draftTitle, setDraftTitle] = useState(state.title);
  const commitTitle = () => {
    if (draftTitle !== state.title) dispatch({ type: "SET_TITLE", title: draftTitle });
  };
  useEffect(() => setDraftTitle(state.title), [state.title]);
  const cycleZoom = (direction: -1 | 1) => {
    const values: EditorState["zoom"][] = [0.75, 1, 1.25, 1.5];
    const index = values.indexOf(state.zoom);
    dispatch({ type: "SET_ZOOM", zoom: values[Math.max(0, Math.min(values.length - 1, index + direction))] });
  };
  return <>
    <div className="workspace-top">
        <div className="workspace-heading">
        <span className="workspace-kicker">GUI preview</span>
        <input
          className="workspace-title-input"
          aria-label="Tiêu đề GUI"
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitTitle();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setDraftTitle(state.title);
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      <div className="workspace-controls">
        <span className="badge">{state.container.slots} ô · {state.container.rows} hàng</span>
      </div>
    </div>
    <div className="toolbar-card" aria-label="Công cụ preview">
      <div className="toolbar-group">
        <button className="select-control" onClick={() => dispatch({ type: "OPEN_OVERLAY", overlay: "container" })}><Boxes size={14} />{state.container.label}<ChevronDown size={12} /></button>
        <span className="select-control">{state.container.rows} × {state.container.columns}</span>
      </div>
      <div className="toolbar-divider" />
      <div className="mode-toggle" role="group" aria-label="Chế độ preview">
        <button className={`seg-button ${state.previewMode === "editor" ? "active" : ""}`} onClick={() => dispatch({ type: "SET_MODE", mode: "editor" })}><LayoutGrid size={13} />Editor</button>
        <button className={`seg-button ${state.previewMode === "minecraft" ? "active" : ""}`} onClick={() => dispatch({ type: "SET_MODE", mode: "minecraft" })}><Eye size={13} />Minecraft</button>
      </div>
      <div className="toolbar-divider" />
      <div className="toolbar-group">
        <button className={`seg-button ${state.showSlotNumbers ? "active" : ""}`} title="Hiện số slot" onClick={() => dispatch({ type: "SET_OPTION", option: "showSlotNumbers", value: !state.showSlotNumbers })}># Slot</button>
        <button className={`seg-button ${state.showPlayerInventory ? "active" : ""}`} title="Hiện Player Inventory" onClick={() => dispatch({ type: "SET_OPTION", option: "showPlayerInventory", value: !state.showPlayerInventory })}>Player Inv</button>
        <button className={`seg-button ${state.showRoles ? "active" : ""}`} title="Hiện vai trò slot" onClick={() => dispatch({ type: "SET_OPTION", option: "showRoles", value: !state.showRoles })}>Roles</button>
      </div>
      <div className="toolbar-divider" />
      <div className="zoom-controls" aria-label="Zoom preview">
        <button className="icon-button" aria-label="Thu nhỏ" onClick={() => cycleZoom(-1)} disabled={state.zoom === 0.75}><ZoomOut size={14} /></button>
        <span className="zoom-value">{Math.round(state.zoom * 100)}%</span>
        <button className="icon-button" aria-label="Phóng to" onClick={() => cycleZoom(1)} disabled={state.zoom === 1.5}><ZoomIn size={14} /></button>
        <button className="icon-button" aria-label="Đặt lại zoom" title="Reset view · Ctrl + 0" onClick={() => dispatch({ type: "SET_ZOOM", zoom: 1 })}><Maximize2 size={14} /></button>
      </div>
    </div>
  </>;
}

function PlacedItemsPanel({ state, placedItems, dispatch, placedSearch, setPlacedSearch, placedSort, setPlacedSort, placedDensity, setPlacedDensity, embedded = false }: { state: EditorState; placedItems: Array<EditorState["placements"][number]>; dispatch: Dispatch<Parameters<typeof reducer>[1]>; placedSearch: string; setPlacedSearch: (v: string) => void; placedSort: "slot" | "name" | "material"; setPlacedSort: (v: "slot" | "name" | "material") => void; placedDensity: "comfortable" | "compact"; setPlacedDensity: (v: "comfortable" | "compact") => void; embedded?: boolean }) {
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [newSlotValue, setNewSlotValue] = useState<string>("");
  const [editingAmount, setEditingAmount] = useState<number | null>(null);
  const [newAmountValue, setNewAmountValue] = useState<string>("");

  return <aside className={`panel panel-left ${embedded ? "embedded-panel" : ""}`} aria-label="Item đã đặt">
    <div className="panel-header">
      <div className="panel-heading"><div><h2>Placed items</h2><p className="panel-subtitle">{Object.keys(state.placements).length} items</p></div>{!embedded && <button className="icon-button" aria-label="Mở thư viện item" onClick={() => dispatch({ type: "OPEN_OVERLAY", overlay: "library" })}><Plus size={15} /></button>}</div>
      <label className="search-field"><Search size={15} /><input value={placedSearch} onChange={(e) => setPlacedSearch(e.target.value)} placeholder="Search placed items..." aria-label="Tìm item đã đặt" /></label>
      <div className="toolbar-row" style={{ flexWrap: "wrap", gap: 4 }}>
        <select className="compact-select" value={placedSort} onChange={(e) => setPlacedSort(e.target.value as typeof placedSort)} style={{ height: 28, fontSize: 11, padding: "0 4px" }}><option value="slot">Slot</option><option value="name">Name</option><option value="material">Material</option></select>
        <button className={`icon-button ${placedDensity === "compact" ? "active" : ""}`} style={{ width: 28, height: 28 }} title="Density" onClick={() => setPlacedDensity(placedDensity === "comfortable" ? "compact" : "comfortable")}><ListFilter size={13} /></button>
      </div>
    </div>
    <div className="list-scroll">
      {placedItems.length === 0 ? <div className="empty-state"><LayoutGrid size={28} /><strong>Không tìm thấy item nào</strong><p>Thử đổi bộ lọc hoặc thêm item từ thư viện.</p></div> : <>
        <div className="group-label"><span>Container slots</span><span>{placedItems.length}</span></div>
        {placedItems.map((placed) => {
          const definition = getItem(placed.itemId, state.catalog);
          if (!definition) return null;
          const selected = state.selectedSlot === placed.slot;
          const isCompact = placedDensity === "compact";
          return <button className={`placed-row ${selected ? "selected" : ""} ${isCompact ? "compact" : "comfortable"}`} key={placed.slot} onClick={() => { if (editingSlot === null && editingAmount === null) dispatch({ type: "OPEN_EDITOR", target: { kind: "placement", slot: placed.slot } }); }} draggable onDragStart={(event) => { event.dataTransfer.clearData(); event.dataTransfer.setData("text/plain", JSON.stringify({ source: "slot", slot: placed.slot })); event.dataTransfer.effectAllowed = "move"; }}>
            <div className="slot-badge" title={`Click to edit slot ${placed.slot}`} onClick={(e) => { e.stopPropagation(); if (editingSlot !== placed.slot) { setEditingSlot(placed.slot); setNewSlotValue(String(placed.slot)); } }}>
              {editingSlot === placed.slot ? (
                <input
                  type="number"
                  className="slot-input"
                  value={newSlotValue}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setNewSlotValue(e.target.value)}
                  onBlur={() => {
                    const target = parseInt(newSlotValue, 10);
                    if (!isNaN(target) && target >= 0 && target < state.container.slots && target !== placed.slot) {
                      dispatch({ type: "MOVE_ITEM", from: placed.slot, to: target });
                    }
                    setEditingSlot(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    else if (e.key === "Escape") setEditingSlot(null);
                  }}
                />
              ) : (
                <>
                  <small style={{ display: isCompact ? "none" : "block" }}>Slot</small>
                  {placed.slot}
                </>
              )}
            </div>
            <span className="item-row-main"><span className="item-row-name"><PixelItemIcon kind={definition.icon} label={definition.name} size={isCompact ? 16 : 20} /><span>{placed.displayName}</span>{editingAmount === placed.slot ? (
              <input
                type="number"
                className="badge-input"
                value={newAmountValue}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setNewAmountValue(e.target.value)}
                onBlur={() => {
                  const target = parseInt(newAmountValue, 10);
                  const maxStack = definition.maxStack || 64;
                  if (!isNaN(target) && target >= 1 && target <= maxStack) {
                    dispatch({ type: "SET_AMOUNT", slot: placed.slot, amount: target });
                  }
                  setEditingAmount(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  else if (e.key === "Escape") setEditingAmount(null);
                }}
              />
            ) : (
              <span className="badge amount-badge" title="Click to edit quantity" onClick={(e) => { e.stopPropagation(); setEditingAmount(placed.slot); setNewAmountValue(String(placed.amount)); }}>×{placed.amount}</span>
            )}</span>{!isCompact && <span className="item-row-id" title={definition.material}>{definition.material}</span>}</span>
            <span className="row-actions"><MessageCircle size={14} aria-hidden="true" /><GripVertical size={15} aria-hidden="true" /></span>
          </button>;
        })}
      </>}
    </div>
    <div className="panel-footer">
      <div className="summary-line">
        <span>{Object.keys(state.placements).length} placed · {state.container.slots - Object.keys(state.placements).length} empty</span>
      </div>
    </div>
  </aside>;
}

function MinecraftText({ value }: { value: string }) {
  return <>{parseMinecraftText(value).map((part, index) => <span key={index} className={part.obfuscated ? "minecraft-obfuscated" : undefined} style={{ color: part.color, fontWeight: part.bold ? 700 : undefined, fontStyle: part.italic ? "italic" : undefined, textDecoration: [part.underline && "underline", part.strikethrough && "line-through"].filter(Boolean).join(" ") || undefined }}>{part.text}</span>)}</>;
}

function InventoryPreview({ state, dragSlot, setDragSlot, onDrop, dispatch }: { state: EditorState; dragSlot: number | null; setDragSlot: (slot: number | null) => void; onDrop: (event: DragEvent<HTMLButtonElement>, slot: number) => void; dispatch: Dispatch<Parameters<typeof reducer>[1]> }) {
  const slotSize = 36 * state.zoom;
  const frameStyle = { "--slot-size": `${slotSize}px` } as CSSProperties;
  const gridClass = state.container.columns === 5 ? "hopper" : state.container.columns === 3 ? "special" : "chest";
  const roleForSlot = (slot: number) => state.container.kind === "special" ? (["Input", "Fuel", "Result"][slot] ?? "Crafting") : "";
  const onSlotKey = (event: KeyboardEvent<HTMLButtonElement>, slot: number) => {
    const columns = state.container.columns || 1;
    let next = slot;
    if (event.key === "ArrowRight") next = Math.min(state.container.slots - 1, slot + 1);
    else if (event.key === "ArrowLeft") next = Math.max(0, slot - 1);
    else if (event.key === "ArrowDown") next = Math.min(state.container.slots - 1, slot + columns);
    else if (event.key === "ArrowUp") next = Math.max(0, slot - columns);
    else if (event.key === "Delete" && state.placements[slot]) { dispatch({ type: "REMOVE_ITEM", slot }); return; }
    else if (event.key === " " || event.key === "Enter") { dispatch({ type: "SELECT_SLOT", slot }); return; }
    else return;
    event.preventDefault();
    dispatch({ type: "SELECT_SLOT", slot: next });
    document.getElementById(`container-slot-${next}`)?.focus();
  };

  const renderContainerGrid = () => {
    if (state.container.id === "anvil") {
      return <div className="anvil-container" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px', alignItems: 'center' }}>
        <div className="anvil-rename" style={{ background: '#2c2c2d', border: '2px solid #555', borderRadius: '2px', height: '24px', width: '180px', padding: '2px 8px', color: '#fff', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span>{state.previewMode === "minecraft" ? <MinecraftText value={state.title || "Repair & Name"} /> : state.title || "Repair & Name"}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
          <InventorySlot slot={0} state={state} role={roleForSlot(0)} dragOver={dragSlot === 0} setDragSlot={setDragSlot} onDrop={onDrop} onKeyDown={onSlotKey} dispatch={dispatch} />
          <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#444' }}>+</span>
          <InventorySlot slot={1} state={state} role={roleForSlot(1)} dragOver={dragSlot === 1} setDragSlot={setDragSlot} onDrop={onDrop} onKeyDown={onSlotKey} dispatch={dispatch} />
          <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#444' }}>➜</span>
          <InventorySlot slot={2} state={state} role={roleForSlot(2)} dragOver={dragSlot === 2} setDragSlot={setDragSlot} onDrop={onDrop} onKeyDown={onSlotKey} dispatch={dispatch} />
        </div>
      </div>;
    }
    if (state.container.id === "furnace") {
      return <div className="furnace-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px', padding: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
          <InventorySlot slot={0} state={state} role={roleForSlot(0)} dragOver={dragSlot === 0} setDragSlot={setDragSlot} onDrop={onDrop} onKeyDown={onSlotKey} dispatch={dispatch} />
          <div className="furnace-flame" style={{ fontSize: '16px', color: '#e67e22', lineHeight: 1 }}>🔥</div>
          <InventorySlot slot={1} state={state} role={roleForSlot(1)} dragOver={dragSlot === 1} setDragSlot={setDragSlot} onDrop={onDrop} onKeyDown={onSlotKey} dispatch={dispatch} />
        </div>
        <div style={{ fontSize: '24px', color: '#444' }}>➜</div>
        <InventorySlot slot={2} state={state} role={roleForSlot(2)} dragOver={dragSlot === 2} setDragSlot={setDragSlot} onDrop={onDrop} onKeyDown={onSlotKey} dispatch={dispatch} />
      </div>;
    }
    if (state.container.id === "brewing") {
      return <div className="brewing-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '12px' }}>
        <div style={{ display: 'flex', width: '100%', justifyContent: 'center', gap: '32px', position: 'relative' }}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <InventorySlot slot={4} state={state} role={roleForSlot(4)} dragOver={dragSlot === 4} setDragSlot={setDragSlot} onDrop={onDrop} onKeyDown={onSlotKey} dispatch={dispatch} />
            <div style={{ fontSize: '16px', color: '#e67e22' }}>⚡</div>
          </div>
          <InventorySlot slot={3} state={state} role={roleForSlot(3)} dragOver={dragSlot === 3} setDragSlot={setDragSlot} onDrop={onDrop} onKeyDown={onSlotKey} dispatch={dispatch} />
        </div>
        <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
          <InventorySlot slot={0} state={state} role={roleForSlot(0)} dragOver={dragSlot === 0} setDragSlot={setDragSlot} onDrop={onDrop} onKeyDown={onSlotKey} dispatch={dispatch} />
          <InventorySlot slot={1} state={state} role={roleForSlot(1)} dragOver={dragSlot === 1} setDragSlot={setDragSlot} onDrop={onDrop} onKeyDown={onSlotKey} dispatch={dispatch} />
          <InventorySlot slot={2} state={state} role={roleForSlot(2)} dragOver={dragSlot === 2} setDragSlot={setDragSlot} onDrop={onDrop} onKeyDown={onSlotKey} dispatch={dispatch} />
        </div>
      </div>;
    }
    if (state.container.id === "workbench") {
      return <div className="workbench-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '24px', padding: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, var(--slot-size))', gap: '2px' }}>
          {Array.from({ length: 9 }, (_, index) => <InventorySlot key={index} slot={index} state={state} role={roleForSlot(index)} dragOver={dragSlot === index} setDragSlot={setDragSlot} onDrop={onDrop} onKeyDown={onSlotKey} dispatch={dispatch} />)}
        </div>
        <div style={{ fontSize: '24px', color: '#444' }}>➜</div>
        <InventorySlot slot={9} state={state} role={roleForSlot(9)} dragOver={dragSlot === 9} setDragSlot={setDragSlot} onDrop={onDrop} onKeyDown={onSlotKey} dispatch={dispatch} />
      </div>;
    }

    return <div className={`slot-grid ${gridClass}`} style={{ gridTemplateColumns: `repeat(${state.container.columns}, var(--slot-size))` }}>
      {Array.from({ length: state.container.slots }, (_, slot) => <InventorySlot key={slot} slot={slot} state={state} role={roleForSlot(slot)} dragOver={dragSlot === slot} setDragSlot={setDragSlot} onDrop={onDrop} onKeyDown={onSlotKey} dispatch={dispatch} />)}
    </div>;
  };

  return <div className="preview-card">
    <div className="minecraft-frame" style={frameStyle}>
       <div className="frame-label"><span className="minecraft-gui-title"><MinecraftText value={state.title || state.container.bukkitId} /></span><button className="item-lock-all" onClick={() => dispatch({ type: "SET_ALL_ITEM_LOCKS", locked: !Object.values(state.placements).every((item) => item.locked !== false) })}><Lock size={11} />{Object.values(state.placements).every((item) => item.locked !== false) ? "Mở khóa tất cả" : "Khóa tất cả"}</button><span>0–{Math.max(0, state.container.slots - 1)}</span></div>
      {state.container.kind === "special" && state.showRoles && <div className="frame-label"><span>{state.container.role}</span><span>Special layout</span></div>}
      {renderContainerGrid()}
      {state.showPlayerInventory && state.container.kind !== "special" && <>
        <div className="frame-divider" /><div className="region-label">Player Inventory</div>
        <div className="slot-grid chest">{Array.from({ length: 27 }, (_, slot) => <PlayerSlot key={slot} slot={slot} style={frameStyle} />)}</div>
        <div className="region-label">Hotbar</div><div className="slot-grid chest">{Array.from({ length: 9 }, (_, slot) => <PlayerSlot key={slot} slot={slot} style={frameStyle} />)}</div>
      </>}
    </div>
  </div>;
}

function InventorySlot({ slot, state, role, dragOver, setDragSlot, onDrop, onKeyDown, dispatch }: { slot: number; state: EditorState; role: string; dragOver: boolean; setDragSlot: (slot: number | null) => void; onDrop: (event: DragEvent<HTMLButtonElement>, slot: number) => void; onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, slot: number) => void; dispatch: Dispatch<Parameters<typeof reducer>[1]> }) {
  const placed = state.placements[slot];
  const definition = placed ? getItem(placed.itemId, state.catalog) : undefined;
  const selected = state.selectedSlot === slot;
  const label = placed ? `Slot ${slot}, ${placed.displayName}, số lượng ${placed.amount}` : `Slot ${slot} trống, kéo item vào đây`;
  return <button id={`container-slot-${slot}`} className={`inventory-slot ${selected ? "selected" : ""} ${dragOver ? "drag-over" : ""} ${placed?.enchantmentGlintOverride || placed?.enchantments?.length ? "enchanted" : ""}`} aria-label={label} aria-pressed={selected} title={placed ? undefined : `Slot ${slot} · Kéo item vào đây`} tabIndex={selected || (state.selectedSlot === null && slot === 0) ? 0 : -1} onClick={() => placed ? dispatch({ type: "OPEN_EDITOR", target: { kind: "placement", slot } }) : dispatch({ type: "SELECT_SLOT", slot })} onKeyDown={(event) => onKeyDown(event, slot)} draggable={Boolean(placed)} onDragStart={(event) => { if (!placed) return; event.dataTransfer.clearData(); event.dataTransfer.setData("text/plain", JSON.stringify({ source: "slot", slot })); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDragSlot(null)} onDragEnter={(event) => { event.preventDefault(); setDragSlot(slot); }} onDragOver={(event) => { event.preventDefault(); setDragSlot(slot); }} onDragLeave={() => setDragSlot(null)} onDrop={(event) => onDrop(event, slot)}>
    {definition && <PixelItemIcon kind={definition.icon} label={definition.name} size={Math.max(18, Math.round(27 * state.zoom))} />}
    {state.previewMode === "editor" && state.showSlotNumbers && <span className="slot-number">{slot}</span>}
    {placed && placed.amount > 1 && <span className="quantity">{placed.amount}</span>}
    {role && state.showRoles && state.previewMode === "editor" && <span className="slot-number">{role}</span>}
    {placed && <span className="minecraft-tooltip"><strong><MinecraftText value={placed.displayName} /></strong>{placed.lore.map((line, index) => <span key={index}><MinecraftText value={line} /></span>)}</span>}
  </button>;
}

function PlayerSlot({ slot, style }: { slot: number; style: CSSProperties }) {
  return <button className="inventory-slot player" style={style} aria-label={`Player inventory slot ${slot}, preview-only`} title="Player inventory chỉ là phần mô phỏng" disabled />;
}

function ItemLibraryPanel({ state, filteredItems, dispatch, librarySort, setLibrarySort, libraryDensity, setLibraryDensity, onQuickAdd, embedded = false }: { state: EditorState; filteredItems: ItemDefinition[]; dispatch: Dispatch<Parameters<typeof reducer>[1]>; librarySort: "name" | "material"; setLibrarySort: (v: "name" | "material") => void; libraryDensity: "comfortable" | "compact"; setLibraryDensity: (v: "comfortable" | "compact") => void; onQuickAdd: (itemId: string) => void; embedded?: boolean }) {
  const LibraryCard = useMemo(() => {
    return function LibraryCard({ definition, selected, isCompact, dispatch, favorites }: { definition: ItemDefinition; selected: boolean; isCompact: boolean; dispatch: Dispatch<Parameters<typeof reducer>[1]>; favorites: string[] }) {
      const isFavorite = favorites.includes(definition.id);
      return <article className={`library-card ${selected ? "selected" : ""} ${isCompact ? "compact" : "comfortable"}`} tabIndex={0} draggable onDragStart={(event) => { event.dataTransfer.clearData(); event.dataTransfer.setData("text/plain", JSON.stringify({ source: "library", itemId: definition.id })); event.dataTransfer.effectAllowed = "copy"; }} onDragEnd={() => undefined} onClick={() => dispatch({ type: "OPEN_EDITOR", target: { kind: "library", itemId: definition.id } })} onKeyDown={(event) => { if (event.key === "Enter") dispatch({ type: "OPEN_EDITOR", target: { kind: "library", itemId: definition.id } }); }}>
        <button className={`card-action ${isFavorite ? "favorited" : ""}`} aria-label={`Yêu thích ${definition.name}`} onClick={(event) => { event.stopPropagation(); dispatch({ type: "TOGGLE_FAVORITE", itemId: definition.id }); }}><span style={{ color: isFavorite ? "#ffd54c" : "var(--text-tertiary)" }}>★</span></button>
        <button className="card-action-add" aria-label={`Thêm ${definition.name}`} onClick={(event) => { event.stopPropagation(); onQuickAdd(definition.id); }}><Plus size={14} style={{ color: "#06130f" }} /></button>
        <span className="library-icon-wrap"><PixelItemIcon kind={definition.icon} label={definition.name} size={isCompact ? 24 : 34} /></span>
        <span className="library-card-name" title={definition.name}>{definition.name}</span>{!isCompact && <span className="library-card-id" title={definition.material}>{definition.material}</span>}
      </article>;
    };
  }, [state.catalog, state.container, state.placements, onQuickAdd]);

  return <aside className={`panel panel-right ${embedded ? "embedded-panel" : ""}`} aria-label="Minecraft items">
    <div className="panel-header library-header">
      <div className="panel-heading"><div><h2>Minecraft Items</h2><p className="panel-subtitle">Drag an item into a slot</p></div></div>
      <label className="search-field"><Search size={15} /><input value={state.query} onChange={(event) => dispatch({ type: "SET_QUERY", query: event.target.value })} placeholder="Search materials..." aria-label="Tìm Minecraft item" /><kbd>/</kbd></label>
      <div className="library-tabs" role="tablist" aria-label="Phạm vi item">{(["All", "Recent", "Favorites"] as const).map((tab) => <button className={`library-tab ${state.libraryTab === tab ? "active" : ""}`} key={tab} onClick={() => dispatch({ type: "SET_TAB", tab })}>{tab}</button>)}</div>
      <div className="toolbar-row" style={{ marginTop: 8, alignItems: "center", gap: 4 }}>
        <select className="compact-select" value={state.category} onChange={(event) => dispatch({ type: "SET_CATEGORY", category: event.target.value as EditorState["category"] })} style={{ height: 28, fontSize: 11, padding: "0 4px" }}>
          {categories.map((cat) => <option value={cat} key={cat}>{cat === "All" ? "All categories" : cat}</option>)}
        </select>
        <select className="compact-select" value={librarySort} onChange={(e) => setLibrarySort(e.target.value as typeof librarySort)} style={{ height: 28, fontSize: 11, padding: "0 4px" }}><option value="name">Name</option><option value="material">Material</option></select>
        <button className={`icon-button ${libraryDensity === "compact" ? "active" : ""}`} style={{ width: 28, height: 28 }} title="Compact view" onClick={() => setLibraryDensity(libraryDensity === "comfortable" ? "compact" : "comfortable")}><SlidersHorizontal size={13} /></button>
      </div>
    </div>
    {state.catalog.length === 0 ? <div className="empty-library"><CircleAlert size={24} /><p>Catalog Minecraft chưa sẵn sàng</p><small>Khởi động backend hoặc refresh catalog Fandom.</small></div> : filteredItems.length === 0 ? <div className="empty-library"><Search size={24} /><p>Không tìm thấy item phù hợp.<br />Kiểm tra Material ID.</p><button className="secondary-button" onClick={() => { dispatch({ type: "SET_QUERY", query: "" }); dispatch({ type: "SET_CATEGORY", category: "All" }); dispatch({ type: "SET_TAB", tab: "All" }); }}>Clear filters</button></div> : <>
      <div className="library-result-count" title={`Catalog: ${state.catalogVersion}`}>{filteredItems.length} items</div>
      <LibraryVirtualGrid items={filteredItems} itemKey={(item) => item.id} resetKey={`${state.query}|${state.category}|${state.libraryTab}|${librarySort}|${libraryDensity}`} rowHeight={libraryDensity === "compact" ? 84 : 104} renderItem={(definition) => <LibraryCard definition={definition} selected={state.selectedLibraryItemId === definition.id || state.selectedSlot !== null && state.placements[state.selectedSlot]?.itemId === definition.id} isCompact={libraryDensity === "compact"} dispatch={dispatch} favorites={state.favorites} />} />
    </>}
  </aside>;
}

function ActionFields({ action, catalog, onChange }: { action: EditorState["draftAction"]; catalog: ItemDefinition[]; onChange: (action: EditorState["draftAction"]) => void }) {
  const field = (label: string, value: string | number, update: (value: string) => EditorState["draftAction"], type: "text" | "number" = "text") => <label className="field-label">{label}<input className="text-input" type={type} value={value} onChange={(event) => onChange(update(event.target.value))} /></label>;
  if (action.type === "open_gui") return field("GUI ID", action.guiId, (value) => ({ ...action, guiId: value }));
  if (action.type === "run_command") return field("Command", action.command, (value) => ({ ...action, command: value }));
  if (action.type === "send_message") return field("Message", action.message, (value) => ({ ...action, message: value }));
  if (action.type === "give_item") return <div className="form-section"><label className="field-label">Material<select className="drawer-select" value={action.material} onChange={(event) => onChange({ ...action, material: event.target.value })}>{catalog.map((item) => <option value={item.material} key={item.id}>{item.material} · {item.name}</option>)}</select></label>{field("Amount", action.amount, (value) => ({ ...action, amount: Number(value) }), "number")}</div>;
  if (action.type === "teleport") return <div className="form-section">{field("World", action.world, (value) => ({ ...action, world: value }))}<div className="toolbar-row">{field("X", action.x, (value) => ({ ...action, x: Number(value) }), "number")}{field("Y", action.y, (value) => ({ ...action, y: Number(value) }), "number")}{field("Z", action.z, (value) => ({ ...action, z: Number(value) }), "number")}</div><div className="toolbar-row">{field("Yaw", action.yaw ?? 0, (value) => ({ ...action, yaw: Number(value) }), "number")}{field("Pitch", action.pitch ?? 0, (value) => ({ ...action, pitch: Number(value) }), "number")}</div></div>;
  return null;
}

function ItemDrawer({ state, dispatch }: { state: EditorState; dispatch: Dispatch<Parameters<typeof reducer>[1]> }) {
  const libraryItem = state.editorTarget?.kind === "library" ? getItem(state.editorTarget.itemId, state.catalog) : undefined;
  const current = state.editorTarget?.kind === "placement" ? state.placements[state.editorTarget.slot] : undefined;
  const activeItem = current;
  const definition = activeItem ? getItem(activeItem.itemId, state.catalog) : libraryItem;
  const isLibraryDraft = state.editorTarget?.kind === "library";
  return <div className="overlay-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) dispatch({ type: "CLOSE_OVERLAY" }); }}><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="item-title">
    <div className="drawer-header"><div className="drawer-header-top"><div><span className="drawer-breadcrumb">{isLibraryDraft ? `Draft item / ${definition?.name ?? "Item"}` : `Item / ${definition?.name ?? "Draft item"} / Slot ${activeItem?.slot ?? "—"}`}</span><h2 id="item-title">Item editor</h2></div><button className="icon-button" aria-label="Đóng item editor" onClick={() => dispatch({ type: "CLOSE_OVERLAY" })}><X size={18} /></button></div>
      {definition ? <div className="drawer-meta"><PixelItemIcon kind={definition.icon} size={38} /><div className="drawer-meta-text"><strong>{isLibraryDraft ? definition.name : activeItem?.displayName}</strong><code>{definition.material} · {isLibraryDraft ? "Draft item" : `Slot ${activeItem?.slot}`}</code></div></div> : <div className="empty-state"><MessageCircle size={24} /><strong>Chọn một item để chỉnh sửa</strong><p>Click item ở panel trái hoặc slot trong preview.</p></div>}
      <div className="drawer-tabs" role="tablist">{(["Details", ...(activeItem ? ["DeluxeMenus" as const] : []), "JSON"] as const).map((tab) => <button key={tab} className={`drawer-tab ${state.drawerTab === tab ? "active" : ""}`} onClick={() => dispatch({ type: "SET_DRAWER_TAB", tab })}>{tab}</button>)}</div>
    </div>
    {definition && (isLibraryDraft || activeItem) && <div className="drawer-body">
      {state.drawerTab === "Details" && <>
        <section className="form-section"><h3>Action mapping</h3><label className="field-label" htmlFor="action-type">Loại hành động</label><select className="drawer-select" id="action-type" value={state.draftAction.type} onChange={(event) => { const type = event.target.value; const action = type === "open_gui" ? { type, guiId: "menu-id" } : type === "run_command" ? { type, command: "/say {player}" } : type === "send_message" ? { type, message: "Xin chào {player}" } : type === "give_item" ? { type, material: state.catalog[0]?.material ?? "DIAMOND", amount: 1 } : type === "teleport" ? { type, world: "world", x: 0, y: 64, z: 0 } : { type }; dispatch({ type: "SET_DRAFT_ACTION", action: action as EditorState["draftAction"] }); }}><option value="prompt_only">Không có action</option><option value="run_command">Run command</option><option value="open_gui">Open another GUI</option><option value="give_item">Give item</option><option value="teleport">Teleport</option><option value="send_message">Send message</option><option value="close_inventory">Close inventory</option></select><ActionFields action={state.draftAction} catalog={state.catalog} onChange={(action) => dispatch({ type: "SET_DRAFT_ACTION", action })} /><div className="chip-row"><span className="variable-chip">{'{player}'}</span><span className="variable-chip">{'{slot}'}</span><span className="variable-chip">{'{world}'}</span><span className="variable-chip">{'{server}'}</span></div></section>
        <section className="form-section"><h3>Developer notes</h3><p className="helper">Ghi chú riêng, mặc định không đưa vào JSON.</p><textarea className="textarea" style={{ minHeight: 80 }} value={state.draftDeveloperNotes} maxLength={2000} onChange={(event) => dispatch({ type: "SET_DRAFT_NOTES", notes: event.target.value })} placeholder="Ví dụ: kiểm tra permission trước khi mở shop" /></section>
      {activeItem && <>
        <section className="form-section"><button className="ghost-button" onClick={() => dispatch({ type: "SET_ITEM_LOCK", slot: activeItem.slot, locked: activeItem.locked === false })}><Lock size={14} />{activeItem.locked !== false ? "Mở khóa item" : "Khóa item"}</button><p className="helper">Item khóa không thể bị lấy khỏi GUI trong JsonGuiLoader.</p></section><section className="form-section"><label className="field-label" htmlFor="item-name">Tên hiển thị</label><input className="text-input" id="item-name" value={state.draftTitle} onChange={(event) => dispatch({ type: "SET_DRAFT_TITLE", title: event.target.value })} /></section><section className="form-section"><label className="field-label">Material ID <Lock size={12} /></label><input className="text-input" value={definition.material} readOnly /></section><section className="form-section"><label className="field-label" htmlFor="quantity">Số lượng</label><input className="text-input" id="quantity" type="number" min="1" max={definition.maxStack} value={activeItem.amount} onChange={(event) => dispatch({ type: "SET_AMOUNT", slot: activeItem.slot, amount: Number(event.target.value) })} /></section><section className="form-section"><label className="field-label" htmlFor="lore">Lore</label><textarea className="textarea" id="lore" value={state.draftLore.join("\n")} maxLength={4000} onChange={(event) => dispatch({ type: "SET_DRAFT_LORE", lore: event.target.value.split("\n").slice(0, 20) })} placeholder="Mỗi dòng là một lore line..." style={{ minHeight: 90 }} /></section>
      </>}</>}
      {state.drawerTab === "DeluxeMenus" && activeItem && <DeluxeMenusItemFields state={state} dispatch={dispatch} />}
      {state.drawerTab === "JSON" && activeItem && <section className="form-section"><h3>Preview export item</h3><pre className="json-code">{JSON.stringify({ ...activeItem, material: definition.material }, null, 2)}</pre></section>}
    </div>}
    <div className="drawer-footer"><button className="ghost-button" onClick={() => dispatch({ type: "CLOSE_OVERLAY" })}>Hủy</button><div>{!isLibraryDraft && <button className="icon-button" aria-label="Xóa item" title="Xóa item" onClick={() => { if (activeItem) dispatch({ type: "REMOVE_ITEM", slot: activeItem.slot }); dispatch({ type: "CLOSE_OVERLAY" }); }}><Trash2 size={16} /></button>}<button className="primary-button" disabled={!definition} onClick={() => { dispatch({ type: "SAVE_ITEM" }); dispatch({ type: "CLOSE_OVERLAY" }); }}><Save size={16} />Lưu item</button></div></div>
  </aside></div>;
}

function ContainerPicker({ state, dispatch }: { state: EditorState; dispatch: Dispatch<Parameters<typeof reducer>[1]> }) {
  const [query, setQuery] = useState("");
  const [candidate, setCandidate] = useState(state.container.id);
  const [confirming, setConfirming] = useState(false);
  const [category, setCategory] = useState<"All" | ContainerSpec["category"]>("All");
  const filtered = CONTAINERS.filter((container) => (category === "All" || container.category === category) && `${container.label} ${container.bukkitId}`.toLowerCase().includes(query.toLowerCase()));
  const proposed = CONTAINERS.find((container) => container.id === candidate) ?? state.container;
  const trimmed = Object.values(state.placements).filter((entry) => entry.slot >= proposed.slots).length;
  const apply = () => {
    if (trimmed && !confirming) { setConfirming(true); return; }
    dispatch({ type: "SET_CONTAINER", container: proposed });
  };
  return <div className="overlay-scrim modal-wrap" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) dispatch({ type: "CLOSE_OVERLAY" }); }}><section className="modal small" role="dialog" aria-modal="true" aria-labelledby="container-title">
    <header className="modal-header"><div><h2 id="container-title">Đổi loại container</h2><p>Chọn layout phù hợp với GUI Bukkit/Paper.</p></div><button className="icon-button" aria-label="Đóng container picker" onClick={() => dispatch({ type: "CLOSE_OVERLAY" })}><X size={18} /></button></header>
    <div className="modal-body"><label className="search-field" style={{ marginTop: 0 }}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm container..." aria-label="Tìm container" /></label><div className="container-picker-tabs" role="tablist">{(["All", "Storage", "Processing", "Utility", "Entity"] as const).map((tab) => <button key={tab} className={`container-picker-tab ${category === tab ? "active" : ""}`} onClick={() => setCategory(tab)}>{tab}</button>)}</div><div className="library-grid" style={{ marginTop: 16 }}>{filtered.map((container) => <button key={container.id} className={`library-card ${candidate === container.id ? "selected" : ""}`} disabled={container.compatibility === "Unavailable"} onClick={() => { setCandidate(container.id); setConfirming(false); }}><span className="library-icon-wrap"><MiniContainer container={container} /></span><span className="library-card-name">{container.label} {candidate === container.id && <Check size={13} />}</span><span className="library-card-id">{container.bukkitId} · {container.slots} slots</span><span className={`badge ${container.compatibility === "Direct" ? "emerald" : container.compatibility === "Special" ? "warning" : ""}`} style={{ marginTop: 6 }}>{container.compatibility}</span></button>)}</div>{confirming && <div className="validation-row" style={{ marginTop: 16 }}><AlertTriangle size={16} />{trimmed} item ở slot ngoài phạm vi sẽ bị loại. Nhấn Áp dụng lần nữa để xác nhận.</div>}</div>
    <footer className="modal-footer"><span className="status" style={{ marginRight: "auto" }}>Đang dùng: {state.container.label} · {state.container.slots} slots</span><button className="ghost-button" onClick={() => dispatch({ type: "CLOSE_OVERLAY" })}>Hủy</button><button className="primary-button" disabled={proposed.compatibility === "Unavailable"} onClick={apply}>Áp dụng</button></footer>
  </section></div>;
}

function MiniContainer({ container }: { container: ContainerSpec }) {
  const shown = Math.min(container.slots || 6, 18);
  return <span style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(container.columns || 3, 6)}, 5px)`, gap: 1 }}>{Array.from({ length: shown }, (_, index) => <i key={index} style={{ width: 5, height: 5, background: "#7a8490", border: "1px solid #d3d3d3" }} />)}</span>;
}

function DeluxeMenusItemFields({ state, dispatch }: { state: EditorState; dispatch: Dispatch<Parameters<typeof reducer>[1]> }) {
  const config = state.draftDeluxeMenus;
  const set = (patch: Partial<EditorState["draftDeluxeMenus"]>) => dispatch({ type: "SET_DRAFT_DELUXE_MENUS", config: { ...config, ...patch } });
  const lines = (value?: string[]) => value?.join("\n") ?? "";
  const setLines = (key: "enchantments" | "itemFlags" | "rightClickCommands" | "shiftLeftClickCommands" | "shiftRightClickCommands" | "middleClickCommands", value: string) => set({ [key]: value.split("\n").map((line) => line.trim()).filter(Boolean) } as Partial<EditorState["draftDeluxeMenus"]>);
  const toggle = (key: "enchantmentGlintOverride" | "unbreakable" | "hideTooltip" | "hideAttributes" | "hideEnchantments") => set({ [key]: !config[key] } as Partial<EditorState["draftDeluxeMenus"]>);
  const setJson = (key: "viewRequirement" | "leftClickRequirement" | "rightClickRequirement" | "shiftLeftClickRequirement" | "shiftRightClickRequirement", value: string) => {
    try { set({ [key]: value.trim() ? JSON.parse(value) : undefined } as Partial<EditorState["draftDeluxeMenus"]>); }
    catch { dispatch({ type: "TOAST", toast: { message: "Requirement JSON không hợp lệ", tone: "error" } }); }
  };
  return <>
    <section className="form-section"><h3>Enchantments</h3><p className="helper">Mỗi dòng <code>ENCHANTMENT;LEVEL</code>. Ví dụ: <code>SHARPNESS;5</code>.</p><textarea className="textarea" value={lines(config.enchantments)} onChange={(event) => setLines("enchantments", event.target.value)} placeholder="SHARPNESS;5" style={{ minHeight: 72 }} /></section>
    <section className="form-section"><h3>Appearance</h3><div className="toggle-stack">{([["enchantmentGlintOverride", "Force enchantment glint"], ["unbreakable", "Unbreakable"], ["hideTooltip", "Hide tooltip"], ["hideAttributes", "Hide attributes"], ["hideEnchantments", "Hide enchantments"]] as const).map(([key, label]) => <label className="toggle-field" key={key}><input type="checkbox" checked={Boolean(config[key])} onChange={() => toggle(key)} /><span><strong>{label}</strong></span></label>)}</div><label className="field-label" style={{ marginTop: 10 }}>Item flags<textarea className="textarea" value={lines(config.itemFlags)} onChange={(event) => setLines("itemFlags", event.target.value)} placeholder="HIDE_ATTRIBUTES" style={{ minHeight: 72 }} /></label></section>
    <section className="form-section"><h3>Item data</h3><div className="toolbar-row"><label className="field-label">Damage<input className="text-input" type="number" min="0" value={config.damage ?? ""} onChange={(event) => set({ damage: event.target.value === "" ? undefined : Number(event.target.value) })} /></label><label className="field-label">Model data<input className="text-input" type="number" min="0" value={config.modelData ?? ""} onChange={(event) => set({ modelData: event.target.value === "" ? undefined : Number(event.target.value) })} /></label><label className="field-label">Priority<input className="text-input" type="number" min="0" value={config.priority ?? ""} onChange={(event) => set({ priority: event.target.value === "" ? undefined : Number(event.target.value) })} /></label></div><label className="toggle-field"><input type="checkbox" checked={Boolean(config.update)} onChange={() => set({ update: !config.update })} /><span><strong>Update item</strong></span></label><label className="field-label" style={{ marginTop: 10 }}>Item model<input className="text-input" value={config.itemModel ?? ""} onChange={(event) => set({ itemModel: event.target.value || undefined })} placeholder="namespace:model" /></label></section>
    <section className="form-section"><h3>Extra click commands</h3><p className="helper">Left click dùng Action mapping. Mỗi dòng dưới đây là một DeluxeMenus command.</p>{([["rightClickCommands", "Right click"], ["shiftLeftClickCommands", "Shift + left click"], ["shiftRightClickCommands", "Shift + right click"], ["middleClickCommands", "Middle click"]] as const).map(([key, label]) => <label className="field-label" key={key}>{label}<textarea className="textarea" value={lines(config[key])} onChange={(event) => setLines(key, event.target.value)} placeholder="[message] Xin chào {player}" style={{ minHeight: 64 }} /></label>)}</section>
    <section className="form-section"><h3>Requirements (JSON)</h3><p className="helper">Nhập object requirements chuẩn DeluxeMenus. Để trống nếu không dùng.</p>{([["viewRequirement", "View requirement"], ["leftClickRequirement", "Left click requirement"], ["rightClickRequirement", "Right click requirement"], ["shiftLeftClickRequirement", "Shift left requirement"], ["shiftRightClickRequirement", "Shift right requirement"]] as const).map(([key, label]) => <label className="field-label" key={key}>{label}<textarea className="textarea" value={config[key] ? JSON.stringify(config[key], null, 2) : ""} onChange={(event) => setJson(key, event.target.value)} placeholder='{"requirements":{"permission":{"type":"has permission","permission":"server.vip"}}}' style={{ minHeight: 88 }} /></label>)}</section>
  </>;
}

type ExportFormat = "json" | "deluxemenus";

function ExportModal({ state, apiStatus, dispatch }: { state: EditorState; apiStatus: "loading" | "saved" | "saving" | "offline" | "conflict"; dispatch: Dispatch<Parameters<typeof reducer>[1]> }) {
  const [copied, setCopied] = useState(false);
  
  const defaultSanitizedName = useMemo(() => {
    return state.title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      || "menu";
  }, [state.title]);

  const [filename, setFilename] = useState(defaultSanitizedName);
  const [menuId, setMenuId] = useState(defaultSanitizedName);

  const [cancelItemMovement, setCancelItemMovement] = useState(true);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("json");
  const deluxeMenusConfig = state.deluxeMenus;
  const setDeluxeMenusConfig = (patch: Partial<EditorState["deluxeMenus"]>) => dispatch({ type: "SET_DELUXE_MENUS_MENU", config: { ...deluxeMenusConfig, ...patch } });
  const [openRequirementDraft, setOpenRequirementDraft] = useState(() => deluxeMenusConfig.openRequirement ? JSON.stringify(deluxeMenusConfig.openRequirement, null, 2) : "");
  const saveOpenRequirement = (value: string) => {
    setOpenRequirementDraft(value);
    try { setDeluxeMenusConfig({ openRequirement: value.trim() ? JSON.parse(value) : undefined }); }
    catch { dispatch({ type: "TOAST", toast: { message: "Open requirement JSON không hợp lệ", tone: "error" } }); }
  };
  const [json, setJson] = useState(() => buildExport(state, { cancelItemMovement: true }));

  const handleMenuIdChange = (val: string) => {
    const sanitized = val
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    setMenuId(sanitized);
    setFilename(sanitized);
  };

  const deluxemenusExport = useMemo(() => {
    const exportData = JSON.parse(buildExport(state, { cancelItemMovement }));
    const items = Object.values(state.placements)
      .filter((entry) => entry.includeInExport !== false && isValidContainerSlot(entry.slot, state.container))
      .sort((a, b) => a.slot - b.slot)
      .map((entry) => {
        const definition = getItem(entry.itemId, state.catalog);
        return {
          ...entry,
          material: definition?.material ?? "UNKNOWN",
        };
      });
    const input = {
      ...exportData,
      ...state.deluxeMenus,
      container: state.container,
      items,
    };
    return mapJsonGuiToDeluxeMenus(input, {
      menuId: menuId || undefined,
      openCommand: deluxeMenusConfig.openCommand || undefined,
      registerCommand: deluxeMenusConfig.registerCommand,
      emitEmptyOpenCommand: true,
    });
  }, [state, cancelItemMovement, menuId, deluxeMenusConfig.openCommand, deluxeMenusConfig.registerCommand]);

  useEffect(() => {
    if (exportFormat === "json") {
      if (apiStatus === "offline" || apiStatus === "conflict" || apiStatus === "saving" || state.dirty) {
        setJson(buildExport(state, { cancelItemMovement }));
        return;
      }
      getCanonicalExport(state.projectId)
        .then((response) => setJson(JSON.stringify({ ...(response.data as object), cancelItemMovement }, null, 2)))
        .catch(() => setJson(buildExport(state)));
    }
  }, [state, apiStatus, cancelItemMovement, exportFormat]);

  const exportContent = exportFormat === "json" ? json : serializeDeluxeMenus(deluxemenusExport.document);
  const lines = exportContent.split("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportContent);
      setCopied(true);
      dispatch({ type: "TOAST", toast: { message: exportFormat === "json" ? "Đã sao chép JSON" : "Đã sao chép YAML", tone: "success" } });
    } catch {
      dispatch({ type: "TOAST", toast: { message: "Không thể sao chép. Hãy kiểm tra quyền clipboard.", tone: "error" } });
    }
  };

  const download = () => {
    const extension = exportFormat === "json" ? "json" : "yml";
    const mimeType = exportFormat === "json" ? "application/json" : "application/yaml";
    const blob = new Blob([exportContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename.replace(/[\\/:*?"<>|]/g, "-") || "menu"}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
    dispatch({ type: "TOAST", toast: { message: exportFormat === "json" ? "Đã tải file JSON" : "Đã tải file YAML", tone: "success" } });
  };

  const hasValidationErrors = deluxemenusExport.validation.issues.some(i => i.severity === "error");
  const canDownload = exportFormat === "json" || !hasValidationErrors;

  return <div className="overlay-scrim modal-wrap" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) dispatch({ type: "CLOSE_OVERLAY" }); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
    <header className="modal-header"><div><h2 id="export-title">{exportFormat === "json" ? "Xuất GUI dưới dạng JSON" : "Xuất GUI cho DeluxeMenus"}</h2><p>{exportFormat === "json" ? "Xuất cấu hình container, item và action cho plugin Java." : "Xuất file YAML tương thích với plugin DeluxeMenus."}</p></div><button className="icon-button" aria-label="Đóng export" onClick={() => dispatch({ type: "CLOSE_OVERLAY" })}><X size={18} /></button></header>
    <div className="modal-body">
      <div className="toolbar-row" style={{ marginBottom: 12 }}>
        <div className="mode-toggle" role="group" aria-label="Chọn định dạng xuất">
          <button className={`seg-button ${exportFormat === "json" ? "active" : ""}`} onClick={() => setExportFormat("json")}><Code2 size={14} />JsonGui JSON</button>
          <button className={`seg-button ${exportFormat === "deluxemenus" ? "active" : ""}`} onClick={() => setExportFormat("deluxemenus")}>YAML (DeluxeMenus)</button>
        </div>
      </div>
      {exportFormat === "deluxemenus" && <div style={{ marginBottom: 12 }}>
        <div className="form-section" style={{ marginTop: 0 }}>
          <label className="field-label">Menu ID</label>
          <input className="text-input" value={menuId} onChange={(e) => handleMenuIdChange(e.target.value)} placeholder="Ví dụ: main-menu" />
          <p className="helper" style={{ fontSize: 11 }}>ID của menu dùng để đăng ký trong config.yml.</p>
        </div>
        <div className="form-section">
          <label className="field-label">Open command (tùy chọn)</label>
          <input className="text-input" value={deluxeMenusConfig.openCommand ?? ""} onChange={(e) => setDeluxeMenusConfig({ openCommand: e.target.value || undefined })} placeholder="Ví dụ: mainmenu" />
          <p className="helper" style={{ fontSize: 11 }}>Lệnh để mở menu. Không có dấu /. Để trống nếu không cần.</p>
        </div>
        <div className="form-section">
          <label className="field-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={Boolean(deluxeMenusConfig.registerCommand)} onChange={(e) => setDeluxeMenusConfig({ registerCommand: e.target.checked })} />
            Đăng ký command
          </label>
          <p className="helper" style={{ fontSize: 11 }}>Cần restart server để command registration có hiệu lực.</p>
        </div>
        <div className="form-section"><label className="field-label">Update interval (ticks)</label><input className="text-input" type="number" min="1" value={deluxeMenusConfig.updateInterval ?? ""} onChange={(e) => setDeluxeMenusConfig({ updateInterval: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="Ví dụ: 20" /></div>
        <div className="form-section"><label className="field-label">Open commands</label><textarea className="textarea" value={(deluxeMenusConfig.openCommands ?? []).join("\n")} onChange={(e) => setDeluxeMenusConfig({ openCommands: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean) })} placeholder="[sound] BLOCK_CHEST_OPEN 1 1" style={{ minHeight: 64 }} /></div>
        <div className="form-section"><label className="field-label">Close commands</label><textarea className="textarea" value={(deluxeMenusConfig.closeCommands ?? []).join("\n")} onChange={(e) => setDeluxeMenusConfig({ closeCommands: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean) })} placeholder="[sound] BLOCK_CHEST_CLOSE 1 1" style={{ minHeight: 64 }} /></div>
        <div className="form-section"><label className="field-label">Open requirement (JSON)</label><textarea className="textarea" value={openRequirementDraft} onChange={(e) => saveOpenRequirement(e.target.value)} placeholder='{"requirements":{"permission":{"type":"has permission","permission":"server.vip"}}}' style={{ minHeight: 88 }} /></div>
      </div>}
      <div className={`validation-row ${apiStatus === "offline" || apiStatus === "conflict" || state.dirty || apiStatus === "saving" ? "warning" : ""}`}>
        {apiStatus === "offline" || apiStatus === "conflict" || state.dirty || apiStatus === "saving" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
        <span><strong>{Object.values(state.placements).filter((item) => item.includeInExport !== false).length} item hợp lệ</strong> · {apiStatus === "offline" || apiStatus === "conflict" || state.dirty || apiStatus === "saving" ? "Chưa được server validate" : "Backend canonical"}</span>
      </div>
      {exportFormat === "deluxemenus" && deluxemenusExport.validation.issues.length > 0 && <div className="validation-row" style={{ marginTop: 8, flexDirection: "column", alignItems: "flex-start" }}>
        {deluxemenusExport.validation.issues.map((issue, idx) => <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6, color: issue.severity === "error" ? "var(--status-error)" : "var(--status-warning)" }}>
          {issue.severity === "error" ? <AlertTriangle size={14} /> : <CircleAlert size={14} />}
          <span style={{ fontSize: 12 }}>{issue.path}: {issue.message}</span>
        </div>)}
      </div>}
      <div className="export-toolbar">
        <span className="select-control">{exportFormat === "json" ? <><Code2 size={14} />GUI Forge plugin JSON v1</> : <>YAML · DeluxeMenus</>}</span>
        <label className="select-control">Tên file <input value={filename} onChange={(event) => { if (exportFormat === "deluxemenus") { handleMenuIdChange(event.target.value); } else { setFilename(event.target.value); } }} aria-label="Tên file" style={{ width: 120, background: "transparent", border: 0, outline: 0 }} /><span>.{exportFormat === "json" ? "json" : "yml"}</span></label>
      </div>
      <div className="toolbar-row" style={{ marginBottom: 14 }}>
        {exportFormat === "json" && <button className="ghost-button" onClick={() => setCancelItemMovement(!cancelItemMovement)}>{cancelItemMovement ? <Check size={14} /> : <X size={14} />}Khóa lấy item khỏi GUI</button>}
      </div>
      <div className="code-box"><div className="line-numbers">{lines.map((_, index) => <div key={index}>{index + 1}</div>)}</div><pre className="json-code">{lines.map((line, index) => <div key={index}>{exportFormat === "json" ? highlightJson(line) : line}</div>)}</pre></div>
      {exportFormat === "deluxemenus" && <div style={{ marginTop: 12, padding: 12, background: "var(--surface-elevated)", borderRadius: 6 }}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: 13 }}>Đăng ký menu trong config.yml</h4>
        <pre style={{ margin: 0, fontSize: 11, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>{generateExternalMenuSnippet(menuId || "menu")}</pre>
        <p className="helper" style={{ fontSize: 11, marginTop: 8 }}>Thêm đoạn trên vào <code>plugins/DeluxeMenus/config.yml</code> để đăng ký menu.</p>
      </div>}
      <div className="schema-note"><strong>Schema:</strong> {exportFormat === "json" ? <><code>type</code>, <code>title</code>, <code>rows</code>, <code>items[].slot</code>, <code>material</code>, <code>amount</code>, <code>action</code></> : <><code>menu_title</code>, <code>size</code>, <code>items</code>, <code>left_click_commands</code></>}. Player inventory không có trong export.</div>
    </div>
    <footer className="modal-footer">
      <button className="ghost-button" onClick={() => dispatch({ type: "CLOSE_OVERLAY" })}>Đóng</button>
      <button className="secondary-button" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Đã sao chép" : exportFormat === "json" ? "Sao chép JSON" : "Sao chép YAML"}</button>
      <button className="primary-button" onClick={download} disabled={!canDownload}><FileDown size={16} />Tải file {exportFormat === "json" ? "JSON" : "YAML"}</button>
    </footer>
  </section></div>;
}

function highlightJson(line: string) {
  const parts = line.split(/("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?)|(true|false|null)/g);
  return parts.map((part, index) => {
    if (!part) return null;
    const next = parts[index + 1] ?? "";
    const className = /^"/.test(part) ? (next.trimStart().startsWith(":") ? "json-key" : "json-string") : /^-?\d/.test(part) ? "json-number" : /^(true|false|null)$/.test(part) ? "json-string" : undefined;
    return <span className={className} key={`${part}-${index}`}>{part}</span>;
  });
}

function MobilePanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="overlay-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="drawer" role="dialog" aria-modal="true" aria-label={title}><div className="drawer-header"><div className="drawer-header-top"><h2>{title}</h2><button className="icon-button" aria-label={`Đóng ${title}`} onClick={onClose}><X size={18} /></button></div></div>{children}</aside></div>;
}

function ToastRegion({ state, dispatch, handleUndo }: { state: EditorState; dispatch: Dispatch<Parameters<typeof reducer>[1]>; handleUndo: () => void }) {
  if (!state.toast) return null;
  const icon = state.toast.tone === "success" ? <CheckCircle2 size={17} /> : state.toast.tone === "warning" ? <CircleAlert size={17} /> : state.toast.tone === "error" ? <AlertTriangle size={17} /> : <HelpCircle size={17} />;
  return <div className="toast-region" aria-live="polite"><div className={`toast ${state.toast.tone}`}><span className={`toast-icon ${state.toast.tone}`}>{icon}</span><div className="toast-content">{state.toast.message}{state.toast.undo && <small>Thay đổi có thể hoàn tác</small>}</div>{state.toast.undo && <button className="ghost-button" onClick={handleUndo}>Hoàn tác</button>}<button className="icon-button" aria-label="Đóng thông báo" onClick={() => dispatch({ type: "CLEAR_TOAST" })}><X size={15} /></button></div></div>;
}

export default App;
