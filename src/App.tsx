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
  EyeOff,
  FileDown,
  GripVertical,
  HelpCircle,
  LayoutGrid,
  ListFilter,
  Lock,
  Maximize2,
  MessageCircle,
  PanelLeft,
  PanelRight,
  Pencil,
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
import { TrashDropZone } from "./components/TrashDropZone";
import { LibraryVirtualGrid } from "./components/LibraryVirtualGrid";
import { ApiError, getCanonicalExport, getCatalog, getProject, putProject } from "./api/client";
import {
  CONTAINERS,
  editorStateToProject,
  type ProjectDocument,
  buildExport,
  getFilteredItems,
  getItem,
  initialState,
  isValidContainerSlot,
  reducer,
  type ContainerSpec,
  type EditorState,
  type ItemDefinition,
} from "./domain/editor";

const categories = ["All", "Tools", "Decoration", "Combat", "Food", "Redstone", "Utility", "Misc"] as const;

function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [dragSlot, setDragSlot] = useState<number | null>(null);
  const [trashActive, setTrashActive] = useState(false);
  const [apiStatus, setApiStatus] = useState<"loading" | "saved" | "saving" | "offline" | "conflict">("loading");
  const [etag, setEtag] = useState<string | null>(null);
  const [saveTick, setSaveTick] = useState(0);

  // Keyboard navigation & zoom state history
  const [undoStack, setUndoStack] = useState<Omit<EditorState, "toast" | "dirty" | "overlay">[]>([]);
  const [redoStack, setRedoStack] = useState<Omit<EditorState, "toast" | "dirty" | "overlay">[]>([]);
  const [activityLog, setActivityLog] = useState<{ id: string; time: string; action: string }[]>([]);

  // Local preferences
  const [placedSearch, setPlacedSearch] = useState("");
  const [placedFilter, setPlacedFilter] = useState<"all" | "prompted" | "missing">("all");
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
        const response = await putProject(state.projectId, snapshot, etag);
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
    document.body.style.overflow = state.overlay ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [state.overlay]);

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
      if ((event.ctrlKey || event.metaKey) && event.key === "0") {
        event.preventDefault();
        dispatch({ type: "SET_ZOOM", zoom: 1 });
      }
      if (event.key === "p" && state.selectedSlot !== null && state.placements[state.selectedSlot]) {
        dispatch({ type: "OPEN_PROMPT", target: { kind: "placement", slot: state.selectedSlot } });
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
    if (placedFilter === "prompted") {
      list = list.filter((item) => item.prompt.trim());
    } else if (placedFilter === "missing") {
      list = list.filter((item) => !item.prompt.trim());
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
  }, [state.placements, state.catalog, placedSearch, placedFilter, placedSort]);

  const sortedLibraryItems = useMemo(() => {
    const list = getFilteredItems(state);
    if (librarySort === "material") {
      list.sort((a, b) => a.material.localeCompare(b.material));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [state.catalog, state.query, state.category, state.libraryTab, state.favorites, state.recentItemIds, librarySort]);

  const promptCount = useMemo(() => Object.values(state.placements).filter((entry) => entry.prompt.trim()).length, [state.placements]);

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
    setTrashActive(false);
    if (!isValidContainerSlot(slot, state.container)) return;
    const raw = event.dataTransfer.getData("application/x-gui-forge-item");
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { source: "library" | "slot"; itemId?: string; slot?: number };
      if (data.source === "library" && data.itemId) placeItem(slot, data.itemId);
      if (data.source === "slot" && data.slot !== undefined) dispatch({ type: "MOVE_ITEM", from: data.slot, to: slot });
    } catch {
      dispatch({ type: "TOAST", toast: { message: "Không thể đọc item đang kéo", tone: "error" } });
    }
  };

  const onTrashDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setTrashActive(false);
    try {
      const data = JSON.parse(event.dataTransfer.getData("application/x-gui-forge-item")) as { source?: string; slot?: number };
      if (data.source !== "slot" || data.slot === undefined) {
        dispatch({ type: "TOAST", toast: { message: "Chỉ có thể xóa item đã đặt trong GUI", tone: "warning" } });
        return;
      }
      dispatch({ type: "REMOVE_ITEM", slot: data.slot });
    } catch {
      dispatch({ type: "TOAST", toast: { message: "Không thể đọc item đang kéo", tone: "error" } });
    }
  };

  const undoToast = () => {
    handleUndo();
  };

  return <div className="app-shell">
    <a className="skip-link" href="#workspace">Bỏ qua thanh công cụ</a>
    <AppHeader apiStatus={apiStatus} dispatch={dispatch} handleUndo={handleUndo} handleRedo={handleRedo} undoStack={undoStack} redoStack={redoStack} activityLog={activityLog} />
    <div className="editor-layout">
      <PlacedItemsPanel state={state} placedItems={placedItems} promptCount={promptCount} dispatch={dispatch} placedSearch={placedSearch} setPlacedSearch={setPlacedSearch} placedFilter={placedFilter} setPlacedFilter={setPlacedFilter} placedSort={placedSort} setPlacedSort={setPlacedSort} placedDensity={placedDensity} setPlacedDensity={setPlacedDensity} />
      <main className="workspace" id="workspace">
        <section className="workspace-inner" aria-labelledby="workspace-title">
          <div className="mobile-panel-buttons">
            <button className="secondary-button" onClick={() => dispatch({ type: "OPEN_OVERLAY", overlay: "placed" })}><PanelLeft size={16} />Item đã đặt <span className="badge">{Object.keys(state.placements).length}</span></button>
            <button className="secondary-button" onClick={() => dispatch({ type: "OPEN_OVERLAY", overlay: "library" })}><PanelRight size={16} />Thư viện</button>
          </div>
          <WorkspaceToolbar state={state} placedCount={Object.keys(state.placements).length} promptCount={promptCount} dispatch={dispatch} />
          <InventoryPreview state={state} dragSlot={dragSlot} setDragSlot={setDragSlot} onDrop={onDrop} dispatch={dispatch} />
          <TrashDropZone active={trashActive} onDragOver={(event) => { const raw = event.dataTransfer.types.includes("application/x-gui-forge-item"); if (!raw) return; event.preventDefault(); setTrashActive(true); }} onDragLeave={() => setTrashActive(false)} onDrop={onTrashDrop} />
          <div className="stat-row" aria-label="Tóm tắt GUI">
            <div className="stat-pill"><Boxes size={14} /><strong>{state.container.slots}</strong> container slots</div>
            <div className="stat-pill"><LayoutGrid size={14} /><strong>{Object.keys(state.placements).length}</strong> occupied</div>
            <div className="stat-pill"><Plus size={14} /><strong>{state.container.slots - Object.keys(state.placements).length}</strong> available</div>
            <div className="stat-pill"><MessageCircle size={14} /><strong>{promptCount}</strong> prompts attached</div>
            <div className="stat-pill"><CheckCircle2 size={14} /><strong>0</strong> validation errors</div>
          </div>
        </section>
      </main>
      <ItemLibraryPanel state={state} filteredItems={sortedLibraryItems} dispatch={dispatch} librarySort={librarySort} setLibrarySort={setLibrarySort} libraryDensity={libraryDensity} setLibraryDensity={setLibraryDensity} onQuickAdd={quickAdd} />
    </div>
    {state.overlay === "prompt" && <PromptDrawer state={state} dispatch={dispatch} />}
    {state.overlay === "container" && <ContainerPicker state={state} dispatch={dispatch} />}
    {state.overlay === "export" && <ExportModal state={state} apiStatus={apiStatus} dispatch={dispatch} />}
    {state.overlay === "placed" && <MobilePanel title="Item đã đặt" onClose={() => dispatch({ type: "CLOSE_OVERLAY" })}><PlacedItemsPanel state={state} placedItems={placedItems} promptCount={promptCount} dispatch={dispatch} placedSearch={placedSearch} setPlacedSearch={setPlacedSearch} placedFilter={placedFilter} setPlacedFilter={setPlacedFilter} placedSort={placedSort} setPlacedSort={setPlacedSort} placedDensity={placedDensity} setPlacedDensity={setPlacedDensity} embedded /></MobilePanel>}
    {state.overlay === "library" && <MobilePanel title="Minecraft items" onClose={() => dispatch({ type: "CLOSE_OVERLAY" })}><ItemLibraryPanel state={state} filteredItems={sortedLibraryItems} dispatch={dispatch} librarySort={librarySort} setLibrarySort={setLibrarySort} libraryDensity={libraryDensity} setLibraryDensity={setLibraryDensity} onQuickAdd={quickAdd} embedded /></MobilePanel>}
    <ToastRegion state={state} dispatch={dispatch} handleUndo={undoToast} />
  </div>;
}

function AppHeader({ apiStatus, dispatch, handleUndo, handleRedo, undoStack, redoStack, activityLog }: { apiStatus: "loading" | "saved" | "saving" | "offline" | "conflict"; dispatch: Dispatch<Parameters<typeof reducer>[1]>; handleUndo: () => void; handleRedo: () => void; undoStack: any[]; redoStack: any[]; activityLog: any[] }) {
  const [showActivity, setShowActivity] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  return <header className="app-header">
    <div className="brand" aria-label="GUI Forge">
      <span className="logo-mark" aria-hidden="true"><i /><i /><i /><i /></span>
      <span><strong>GUI Forge</strong><small>Minecraft GUI Builder</small></span>
    </div>
    <div className="header-project">
      <span className="breadcrumb">Projects / Main Menu</span>
      <span className="project-name">Main Menu GUI</span>
      <span className="status"><i className="status-dot" />{{ loading: "Đang kết nối...", saved: "Đã lưu", saving: "Đang lưu...", offline: "Chưa đồng bộ", conflict: "Xung đột phiên bản" }[apiStatus]}</span>
    </div>
    <div className="header-actions">
      <button className="icon-button" aria-label="Hoàn tác" title="Hoàn tác · Ctrl + Z" onClick={handleUndo} disabled={undoStack.length === 0}><Undo2 size={18} /></button>
      <button className="icon-button" aria-label="Làm lại" title="Làm lại · Ctrl + Shift + Z" onClick={handleRedo} disabled={redoStack.length === 0}><Redo2 size={18} /></button>
      <div style={{ position: "relative" }}>
        <button className="icon-button" aria-label="Hoạt động" title="Hoạt động" onClick={() => setShowActivity(!showActivity)}><Clock3 size={18} /></button>
        {showActivity && <div className="popover activity-popover" style={{ position: "absolute", top: 40, right: 0, width: 260, background: "var(--surface-panel)", border: "1px solid var(--border-subtle)", padding: 12, borderRadius: 8, zIndex: 10 }}>
          <h4 style={{ margin: "0 0 8px 0", fontSize: 13 }}>Nhật ký hoạt động</h4>
          <div style={{ maxHeight: 180, overflowY: "auto", fontSize: 11, color: "var(--text-secondary)" }}>
            {activityLog.length === 0 ? <p style={{ margin: 0 }}>Chưa có hoạt động nào.</p> : activityLog.map((log) => <div key={log.id} style={{ marginBottom: 6 }}><span style={{ color: "var(--accent-emerald)" }}>[{log.time}]</span> {log.action}</div>)}
          </div>
        </div>}
      </div>
      <button className="icon-button" aria-label="Cài đặt dự án" title="Cài đặt dự án" onClick={() => setShowSettings(true)}><Settings size={18} /></button>
      <button className="icon-button" aria-label="Trợ giúp" title="Trợ giúp · Ctrl + K" onClick={() => setShowHelp(true)}><CircleHelp size={18} /></button>
      <button className="primary-button" onClick={() => dispatch({ type: "OPEN_OVERLAY", overlay: "export" })}><Download size={18} />Xuất JSON <span className="shortcut">Ctrl + E</span></button>
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
          <li><kbd>P</kbd>: Mở nhanh Prompt Editor cho slot được chọn</li>
          <li><kbd>Delete</kbd>: Xóa item trong slot được chọn</li>
          <li><kbd>Mũi tên</kbd>: Di chuyển vùng chọn slot</li>
        </ul>
      </div>
      <footer className="modal-footer"><button className="primary-button" onClick={() => setShowHelp(false)}>Đóng</button></footer>
    </section></div>}
  </header>;
}

function WorkspaceToolbar({ state, placedCount, promptCount, dispatch }: { state: EditorState; placedCount: number; promptCount: number; dispatch: Dispatch<Parameters<typeof reducer>[1]> }) {
  const cycleZoom = (direction: -1 | 1) => {
    const values: EditorState["zoom"][] = [0.75, 1, 1.25, 1.5];
    const index = values.indexOf(state.zoom);
    dispatch({ type: "SET_ZOOM", zoom: values[Math.max(0, Math.min(values.length - 1, index + direction))] });
  };
  return <>
    <div className="workspace-top">
      <div className="workspace-heading">
        <h1 id="workspace-title">GUI Preview</h1>
        <p className="workspace-subtitle">Xem chính xác bố cục menu Minecraft</p>
      </div>
      <div className="workspace-controls">
        <span className="badge emerald">{state.container.slots} slots</span>
        <span className="badge">{state.container.rows} rows</span>
        <button className="secondary-button" disabled={state.selectedSlot === null} onClick={() => state.selectedSlot !== null && dispatch({ type: "OPEN_PROMPT", target: { kind: "placement", slot: state.selectedSlot } })}><MessageCircle size={15} />Prompt <span className="shortcut">P</span></button>
      </div>
    </div>
    <div className="toolbar-card" aria-label="Công cụ preview">
      <span className="toolbar-label">Loại menu</span>
      <button className="select-control" onClick={() => dispatch({ type: "OPEN_OVERLAY", overlay: "container" })}><Boxes size={15} />{state.container.label}<ChevronDown size={14} /></button>
      <span className="toolbar-label">Kích thước</span>
      <span className="select-control">{state.container.rows} × {state.container.columns} · {state.container.slots} slots</span>
      <button className="ghost-button" onClick={() => dispatch({ type: "OPEN_OVERLAY", overlay: "container" })}>Cài đặt menu</button>
      <button className="ghost-button" onClick={() => dispatch({ type: "OPEN_OVERLAY", overlay: "export" })}><Code2 size={15} />Xem JSON</button>
      <div className="mode-toggle" role="group" aria-label="Chế độ preview">
        <button className={`seg-button ${state.previewMode === "editor" ? "active" : ""}`} onClick={() => dispatch({ type: "SET_MODE", mode: "editor" })}><LayoutGrid size={14} />Editor</button>
        <button className={`seg-button ${state.previewMode === "minecraft" ? "active" : ""}`} onClick={() => dispatch({ type: "SET_MODE", mode: "minecraft" })}><Eye size={14} />Minecraft-like</button>
      </div>
      <div className="zoom-controls" aria-label="Zoom preview">
        <button className="icon-button" aria-label="Thu nhỏ" onClick={() => cycleZoom(-1)} disabled={state.zoom === 0.75}><ZoomOut size={16} /></button>
        <span className="zoom-value">{Math.round(state.zoom * 100)}%</span>
        <button className="icon-button" aria-label="Phóng to" onClick={() => cycleZoom(1)} disabled={state.zoom === 1.5}><ZoomIn size={16} /></button>
        <button className="icon-button" aria-label="Đặt lại zoom" title="Reset view · Ctrl + 0" onClick={() => dispatch({ type: "SET_ZOOM", zoom: 1 })}><Maximize2 size={16} /></button>
      </div>
    </div>
    <div className="toolbar-row" aria-label="Tùy chọn editor">
      <button className={`ghost-button ${state.showSlotNumbers ? "" : ""}`} onClick={() => dispatch({ type: "SET_OPTION", option: "showSlotNumbers", value: !state.showSlotNumbers })}>{state.showSlotNumbers ? <Eye size={14} /> : <EyeOff size={14} />}Hiển thị số slot</button>
      <button className="ghost-button" onClick={() => dispatch({ type: "SET_OPTION", option: "showPlayerInventory", value: !state.showPlayerInventory })}>{state.showPlayerInventory ? <Eye size={14} /> : <EyeOff size={14} />}Inventory người chơi</button>
      <button className="ghost-button" onClick={() => dispatch({ type: "SET_OPTION", option: "showRoles", value: !state.showRoles })}>{state.showRoles ? <Eye size={14} /> : <EyeOff size={14} />}Vai trò slot</button>
      <span className="badge">Prompt coverage {promptCount}/{placedCount}</span>
    </div>
  </>;
}

function PlacedItemsPanel({ state, placedItems, promptCount, dispatch, placedSearch, setPlacedSearch, placedFilter, setPlacedFilter, placedSort, setPlacedSort, placedDensity, setPlacedDensity, embedded = false }: { state: EditorState; placedItems: Array<EditorState["placements"][number]>; promptCount: number; dispatch: Dispatch<Parameters<typeof reducer>[1]>; placedSearch: string; setPlacedSearch: (v: string) => void; placedFilter: "all" | "prompted" | "missing"; setPlacedFilter: (v: "all" | "prompted" | "missing") => void; placedSort: "slot" | "name" | "material"; setPlacedSort: (v: "slot" | "name" | "material") => void; placedDensity: "comfortable" | "compact"; setPlacedDensity: (v: "comfortable" | "compact") => void; embedded?: boolean }) {
  return <aside className={`panel panel-left ${embedded ? "embedded-panel" : ""}`} aria-label="Item đã đặt">
    <div className="panel-header">
      <div className="panel-heading"><div><h2>Item đã đặt <span className="badge">{Object.keys(state.placements).length}</span></h2><p className="panel-subtitle">Sắp xếp và cấu hình item</p></div>{!embedded && <button className="icon-button" aria-label="Mở thư viện item" onClick={() => dispatch({ type: "OPEN_OVERLAY", overlay: "library" })}><Plus size={17} /></button>}</div>
      <label className="search-field"><Search size={15} /><input value={placedSearch} onChange={(e) => setPlacedSearch(e.target.value)} placeholder="Tìm item đã đặt..." aria-label="Tìm item đã đặt" /></label>
      <div className="toolbar-row" style={{ flexWrap: "wrap", gap: 4 }}>
        <select className="compact-select" value={placedFilter} onChange={(e) => setPlacedFilter(e.target.value as any)} style={{ height: 28, fontSize: 11, padding: "0 4px" }}><option value="all">Tất cả</option><option value="prompted">Có prompt</option><option value="missing">Chưa prompt</option></select>
        <select className="compact-select" value={placedSort} onChange={(e) => setPlacedSort(e.target.value as any)} style={{ height: 28, fontSize: 11, padding: "0 4px" }}><option value="slot">Slot</option><option value="name">Tên</option><option value="material">Material</option></select>
        <button className={`icon-button ${placedDensity === "compact" ? "active" : ""}`} style={{ width: 28, height: 28 }} title="Xem gọn" onClick={() => setPlacedDensity(placedDensity === "comfortable" ? "compact" : "comfortable")}><ListFilter size={14} /></button>
      </div>
    </div>
    <div className="list-scroll">
      {placedItems.length === 0 ? <div className="empty-state"><LayoutGrid size={28} /><strong>Không tìm thấy item nào</strong><p>Thử đổi bộ lọc hoặc thêm item từ thư viện.</p></div> : <>
        <div className="group-label"><span>Container slots</span><span>{placedItems.length}</span></div>
        {placedItems.map((placed) => {
          const definition = getItem(placed.itemId, state.catalog);
          if (!definition) return null;
          const selected = state.selectedSlot === placed.slot;
          const hasPrompt = Boolean(placed.prompt.trim());
          const isCompact = placedDensity === "compact";
          return <button className={`placed-row ${selected ? "selected" : ""}`} style={{ minHeight: isCompact ? 46 : 68, padding: isCompact ? "4px 8px" : "10px 8px" }} key={placed.slot} onClick={() => dispatch({ type: "OPEN_PROMPT", target: { kind: "placement", slot: placed.slot } })} draggable onDragStart={(event) => { event.dataTransfer.setData("application/x-gui-forge-item", JSON.stringify({ source: "slot", slot: placed.slot })); event.dataTransfer.effectAllowed = "move"; }}>
            <span className="slot-badge" style={{ height: isCompact ? 28 : 38 }} title={`Chọn Slot ${placed.slot}`}><small style={{ display: isCompact ? "none" : "block" }}>Slot</small>{placed.slot}</span>
            <span className="item-row-main"><span className="item-row-name" style={{ fontSize: isCompact ? 12 : 14 }}><PixelItemIcon kind={definition.icon} label={definition.name} size={isCompact ? 16 : 20} /><span>{placed.displayName}</span>{placed.amount > 1 && <span className="badge">×{placed.amount}</span>}</span>{!isCompact && <span className="item-row-id" title={definition.material}>{definition.material}</span>}<span className="row-status" style={{ display: isCompact ? "none" : "flex" }}><i className={`prompt-dot ${hasPrompt ? "attached" : ""}`} />{hasPrompt ? "Prompt đã thêm" : "Chưa có prompt"}</span></span>
            <span className="row-actions"><MessageCircle size={14} aria-hidden="true" /><GripVertical size={15} aria-hidden="true" /></span>
          </button>;
        })}
      </>}
    </div>
    <div className="panel-footer"><div className="summary-line"><span>{Object.keys(state.placements).length} item đã đặt</span><span>{promptCount} item đã có prompt</span></div><div className="summary-line"><span>{state.container.slots - Object.keys(state.placements).length} slot còn trống</span><span>{Math.round((promptCount / Math.max(1, Object.keys(state.placements).length)) * 100)}% configured</span></div><div className="progress"><i style={{ width: `${(promptCount / Math.max(1, Object.keys(state.placements).length)) * 100}%` }} /></div></div>
  </aside>;
}

function InventoryPreview({ state, dragSlot, setDragSlot, onDrop, dispatch }: { state: EditorState; dragSlot: number | null; setDragSlot: (slot: number | null) => void; onDrop: (event: DragEvent<HTMLButtonElement>, slot: number) => void; dispatch: Dispatch<Parameters<typeof reducer>[1]> }) {
  const slotSize = 34 * state.zoom;
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
  return <div className="preview-card">
    <div className="preview-card-header"><div className="preview-title"><Pencil size={14} /><input aria-label="Tiêu đề GUI" value={state.title} onChange={(event) => dispatch({ type: "SET_TITLE", title: event.target.value })} /></div><span className="preview-note">Preview only</span></div>
    <div className="minecraft-frame" style={frameStyle}>
      <div className="frame-label"><span>{state.title}</span><span>{state.container.bukkitId} · 0–{Math.max(0, state.container.slots - 1)}</span></div>
      {state.container.kind === "special" && state.showRoles && <div className="frame-label"><span>{state.container.role}</span><span>Special layout</span></div>}
      <div className={`slot-grid ${gridClass}`} style={{ gridTemplateColumns: `repeat(${state.container.columns}, var(--slot-size))` }}>
        {Array.from({ length: state.container.slots }, (_, slot) => <InventorySlot key={slot} slot={slot} state={state} role={roleForSlot(slot)} dragOver={dragSlot === slot} setDragSlot={setDragSlot} onDrop={onDrop} onKeyDown={onSlotKey} dispatch={dispatch} />)}
      </div>
      {state.showPlayerInventory && state.container.kind !== "special" && <>
        <div className="frame-divider" /><div className="region-label">Player inventory · chỉ mô phỏng, không xuất JSON</div>
        <div className="slot-grid chest">{Array.from({ length: 27 }, (_, slot) => <PlayerSlot key={slot} slot={slot} style={frameStyle} />)}</div>
        <div className="region-label">Hotbar · 0–8</div><div className="slot-grid chest">{Array.from({ length: 9 }, (_, slot) => <PlayerSlot key={slot} slot={slot} style={frameStyle} />)}</div>
      </>}
    </div>
    <div className="legend"><span><i />Container slot</span><span><i />Player inventory</span><span><i className="selected-swatch" />Selected slot</span><span><i className="prompt-swatch" />Prompt attached</span></div>
    <p className="canvas-note">Slot numbers map trực tiếp đến chỉ số <code>slot</code> trong JSON. Player inventory chỉ để mô phỏng.</p>
  </div>;
}

function InventorySlot({ slot, state, role, dragOver, setDragSlot, onDrop, onKeyDown, dispatch }: { slot: number; state: EditorState; role: string; dragOver: boolean; setDragSlot: (slot: number | null) => void; onDrop: (event: DragEvent<HTMLButtonElement>, slot: number) => void; onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, slot: number) => void; dispatch: Dispatch<Parameters<typeof reducer>[1]> }) {
  const placed = state.placements[slot];
  const definition = placed ? getItem(placed.itemId, state.catalog) : undefined;
  const selected = state.selectedSlot === slot;
  const label = placed ? `Slot ${slot}, ${placed.displayName}, số lượng ${placed.amount}${placed.prompt ? ", có prompt" : ", chưa có prompt"}` : `Slot ${slot} trống, kéo item vào đây`;
  return <button id={`container-slot-${slot}`} className={`inventory-slot ${selected ? "selected" : ""} ${dragOver ? "drag-over" : ""}`} aria-label={label} aria-pressed={selected} title={placed ? `${definition?.material} · ${placed.prompt ? "Prompt đã thêm" : "Chưa có prompt"}` : `Slot ${slot} · Kéo item vào đây`} tabIndex={selected || (state.selectedSlot === null && slot === 0) ? 0 : -1} onClick={() => placed ? dispatch({ type: "OPEN_PROMPT", target: { kind: "placement", slot } }) : dispatch({ type: "SELECT_SLOT", slot })} onKeyDown={(event) => onKeyDown(event, slot)} draggable={Boolean(placed)} onDragStart={(event) => { if (!placed) return; event.dataTransfer.setData("application/x-gui-forge-item", JSON.stringify({ source: "slot", slot })); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => { event.preventDefault(); setDragSlot(slot); }} onDragLeave={() => setDragSlot(null)} onDrop={(event) => onDrop(event, slot)}>
    {definition && <PixelItemIcon kind={definition.icon} label={definition.name} size={Math.max(18, Math.round(27 * state.zoom))} />}
    {state.previewMode === "editor" && state.showSlotNumbers && <span className="slot-number">{slot}</span>}
    {placed && placed.amount > 1 && <span className="quantity">{placed.amount}</span>}
    {role && state.showRoles && state.previewMode === "editor" && <span className="slot-number">{role}</span>}
  </button>;
}

function PlayerSlot({ slot, style }: { slot: number; style: CSSProperties }) {
  return <button className="inventory-slot player" style={style} aria-label={`Player inventory slot ${slot}, preview-only`} title="Player inventory chỉ là phần mô phỏng" disabled />;
}

function ItemLibraryPanel({ state, filteredItems, dispatch, librarySort, setLibrarySort, libraryDensity, setLibraryDensity, onQuickAdd, embedded = false }: { state: EditorState; filteredItems: ItemDefinition[]; dispatch: Dispatch<Parameters<typeof reducer>[1]>; librarySort: "name" | "material"; setLibrarySort: (v: "name" | "material") => void; libraryDensity: "comfortable" | "compact"; setLibraryDensity: (v: "comfortable" | "compact") => void; onQuickAdd: (itemId: string) => void; embedded?: boolean }) {
  const LibraryCard = useMemo(() => {
    return function LibraryCard({ definition, selected, isCompact, dispatch, favorites }: { definition: ItemDefinition; selected: boolean; isCompact: boolean; dispatch: Dispatch<Parameters<typeof reducer>[1]>; favorites: string[] }) {
      const isFavorite = favorites.includes(definition.id);
      return <article className={`library-card ${selected ? "selected" : ""}`} style={{ minHeight: isCompact ? 84 : 128, padding: isCompact ? "6px 8px 6px" : "11px 9px 9px" }} tabIndex={0} draggable onDragStart={(event) => { event.dataTransfer.setData("application/x-gui-forge-item", JSON.stringify({ source: "library", itemId: definition.id })); event.dataTransfer.effectAllowed = "copy"; }} onClick={() => dispatch({ type: "OPEN_PROMPT", target: { kind: "library", itemId: definition.id } })} onKeyDown={(event) => { if (event.key === "Enter") dispatch({ type: "OPEN_PROMPT", target: { kind: "library", itemId: definition.id } }); }}>
        <button className="card-action" style={{ opacity: 1, top: 4, right: 4, width: 24, height: 24 }} aria-label={`Yêu thích ${definition.name}`} onClick={(event) => { event.stopPropagation(); dispatch({ type: "TOGGLE_FAVORITE", itemId: definition.id }); }}><span style={{ color: isFavorite ? "#ffd54c" : "var(--text-tertiary)" }}>★</span></button>
        <button className="card-action-add" style={{ position: "absolute", bottom: 4, right: 4, width: 24, height: 24, background: "var(--accent-emerald)", border: 0, borderRadius: 4, cursor: "pointer", display: "grid", placeItems: "center" }} aria-label={`Thêm ${definition.name}`} onClick={(event) => { event.stopPropagation(); onQuickAdd(definition.id); }}><Plus size={14} style={{ color: "#06130f" }} /></button>
        <span className="library-icon-wrap" style={{ height: isCompact ? 36 : 58, marginBottom: isCompact ? 4 : 8 }}><PixelItemIcon kind={definition.icon} label={definition.name} size={isCompact ? 24 : 34} /></span>
        <span className="library-card-name" style={{ fontSize: isCompact ? 11 : 12 }} title={definition.name}>{definition.name}</span>{!isCompact && <span className="library-card-id" title={definition.material}>{definition.material}</span>}
      </article>;
    };
  }, [state.catalog, state.container, state.placements, onQuickAdd]);

  return <aside className={`panel panel-right ${embedded ? "embedded-panel" : ""}`} aria-label="Minecraft items">
    <div className="panel-header library-header">
      <div className="panel-heading"><div><h2>Minecraft items</h2><p className="panel-subtitle">Kéo item vào slot để thêm</p></div></div>
      <label className="search-field"><Search size={15} /><input value={state.query} onChange={(event) => dispatch({ type: "SET_QUERY", query: event.target.value })} placeholder="Tìm material, tên item..." aria-label="Tìm Minecraft item" /><kbd>/</kbd></label>
      <div className="library-tabs" role="tablist" aria-label="Phạm vi item">{(["All", "Recent", "Favorites"] as const).map((tab) => <button className={`library-tab ${state.libraryTab === tab ? "active" : ""}`} key={tab} onClick={() => dispatch({ type: "SET_TAB", tab })}>{tab === "All" ? "Tất cả" : tab === "Recent" ? "Gần đây" : "Yêu thích"}</button>)}</div>
      <div className="category-row">{categories.map((category) => <button className={`category-chip ${state.category === category ? "active" : ""}`} key={category} onClick={() => dispatch({ type: "SET_CATEGORY", category })}>{category === "All" ? "Tất cả" : category}</button>)}</div>
      <div className="toolbar-row" style={{ flexWrap: "wrap", gap: 4 }}>
        <select className="compact-select" value={librarySort} onChange={(e) => setLibrarySort(e.target.value as any)} style={{ height: 28, fontSize: 11, padding: "0 4px" }}><option value="name">Tên</option><option value="material">Material</option></select>
        <button className={`icon-button ${libraryDensity === "compact" ? "active" : ""}`} style={{ width: 28, height: 28 }} title="Xem gọn" onClick={() => setLibraryDensity(libraryDensity === "comfortable" ? "compact" : "comfortable")}><SlidersHorizontal size={14} /></button>
      </div>
    </div>
    {state.catalog.length === 0 ? <div className="empty-library"><CircleAlert size={24} /><p>Catalog Minecraft chưa sẵn sàng</p><small>Khởi động backend hoặc refresh catalog Fandom.</small></div> : filteredItems.length === 0 ? <div className="empty-library"><Search size={24} /><p>Không tìm thấy item phù hợp.<br />Kiểm tra Material ID.</p><button className="secondary-button" onClick={() => { dispatch({ type: "SET_QUERY", query: "" }); dispatch({ type: "SET_CATEGORY", category: "All" }); dispatch({ type: "SET_TAB", tab: "All" }); }}>Clear filters</button></div> : <>
      <div className="library-result-count">{filteredItems.length} item · catalog {state.catalogVersion}</div>
      <LibraryVirtualGrid items={filteredItems} itemKey={(item) => item.id} resetKey={`${state.query}|${state.category}|${state.libraryTab}|${librarySort}|${libraryDensity}`} rowHeight={libraryDensity === "compact" ? 92 : 136} renderItem={(definition) => <LibraryCard definition={definition} selected={state.selectedLibraryItemId === definition.id || state.selectedSlot !== null && state.placements[state.selectedSlot]?.itemId === definition.id} isCompact={libraryDensity === "compact"} dispatch={dispatch} favorites={state.favorites} />} />
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

function PromptDrawer({ state, dispatch }: { state: EditorState; dispatch: Dispatch<Parameters<typeof reducer>[1]> }) {
  const libraryItem = state.promptTarget?.kind === "library" ? getItem(state.promptTarget.itemId, state.catalog) : undefined;
  const current = state.promptTarget?.kind === "placement" ? state.placements[state.promptTarget.slot] : undefined;
  const activeItem = current;
  const definition = activeItem ? getItem(activeItem.itemId, state.catalog) : libraryItem;
  const isLibraryDraft = state.promptTarget?.kind === "library";
  const activePrompt = isLibraryDraft && state.promptTarget?.kind === "library" ? state.itemDefaults[state.promptTarget.itemId]?.prompt ?? "" : activeItem?.prompt ?? "";
  const openTemplate = (template: string) => dispatch({ type: "SET_PROMPT_DRAFT", prompt: template });
  return <div className="overlay-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) dispatch({ type: "CLOSE_OVERLAY" }); }}><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
    <div className="drawer-header"><div className="drawer-header-top"><div><span className="drawer-breadcrumb">{isLibraryDraft ? `Draft item / ${definition?.name ?? "Item"}` : `Item / ${definition?.name ?? "Draft item"} / Slot ${activeItem?.slot ?? "—"}`}</span><h2 id="prompt-title">Prompt editor</h2></div><button className="icon-button" aria-label="Đóng prompt editor" onClick={() => dispatch({ type: "CLOSE_OVERLAY" })}><X size={18} /></button></div>
      {definition ? <div className="drawer-meta"><PixelItemIcon kind={definition.icon} size={38} /><div className="drawer-meta-text"><strong>{isLibraryDraft ? definition.name : activeItem?.displayName}</strong><code>{definition.material} · {isLibraryDraft ? "Draft item" : `Slot ${activeItem?.slot}`}</code></div><span className={`badge ${activePrompt ? "emerald" : "warning"}`}>{activePrompt ? "Prompt attached" : "No prompt"}</span></div> : <div className="empty-state"><MessageCircle size={24} /><strong>Chọn một item để chỉnh sửa</strong><p>Click item ở panel trái hoặc slot trong preview.</p></div>}
      <div className="drawer-tabs" role="tablist">{(["Details", "Prompt", "JSON"] as const).map((tab) => <button key={tab} className={`drawer-tab ${state.drawerTab === tab ? "active" : ""}`} onClick={() => dispatch({ type: "SET_DRAWER_TAB", tab })}>{tab}</button>)}</div>
    </div>
    {definition && (isLibraryDraft || activeItem) && <div className="drawer-body">
      {state.drawerTab === "Prompt" && <>
        <section className="form-section prompt-box"><h3><Code2 size={16} />Item behavior prompt <span className="badge emerald">Vibe code ready</span></h3><p className="helper">Mô tả hành vi mong muốn cho item này. Dữ liệu dùng cho coding assistant sau này, không tự chạy trong editor.</p><label className="field-label" htmlFor="behavior-prompt">Hành vi khi người chơi tương tác</label><textarea id="behavior-prompt" className="textarea" value={state.draftPrompt} placeholder="Khi người chơi nhấn item, mở menu nhiệm vụ..." maxLength={2000} onChange={(event) => dispatch({ type: "SET_PROMPT_DRAFT", prompt: event.target.value })} /><div className="prompt-quality"><span>{state.draftPrompt.length} / 2000</span><strong>{state.draftPrompt.length > 52 ? "Đã hoàn thiện" : "Thiếu chi tiết"}</strong></div><div className="chip-row"><button className="variable-chip" onClick={() => openTemplate("Khi người chơi nhấn, mở menu khác")}>Mở menu khác</button><button className="variable-chip" onClick={() => openTemplate("Chạy lệnh server với {player}")}>Chạy lệnh server</button><button className="variable-chip" onClick={() => openTemplate("Dịch chuyển {player} đến khu vực chỉ định")}>Dịch chuyển</button></div></section>
        <section className="form-section"><h3>Action mapping</h3><label className="field-label" htmlFor="action-type">Loại hành động</label><select className="drawer-select" id="action-type" value={state.draftAction.type} onChange={(event) => { const type = event.target.value; const action = type === "open_gui" ? { type, guiId: "menu-id" } : type === "run_command" ? { type, command: "/say {player}" } : type === "send_message" ? { type, message: "Xin chào {player}" } : type === "give_item" ? { type, material: state.catalog[0]?.material ?? "DIAMOND", amount: 1 } : type === "teleport" ? { type, world: "world", x: 0, y: 64, z: 0 } : { type }; dispatch({ type: "SET_DRAFT_ACTION", action: action as EditorState["draftAction"] }); }}><option value="prompt_only">Prompt only</option><option value="run_command">Run command</option><option value="open_gui">Open another GUI</option><option value="give_item">Give item</option><option value="teleport">Teleport</option><option value="send_message">Send message</option><option value="close_inventory">Close inventory</option></select><ActionFields action={state.draftAction} catalog={state.catalog} onChange={(action) => dispatch({ type: "SET_DRAFT_ACTION", action })} /><div className="chip-row"><span className="variable-chip">{'{player}'}</span><span className="variable-chip">{'{slot}'}</span><span className="variable-chip">{'{world}'}</span><span className="variable-chip">{'{server}'}</span></div></section>
        <section className="form-section"><h3>Developer notes</h3><p className="helper">Ghi chú riêng, mặc định không đưa vào JSON.</p><textarea className="textarea" style={{ minHeight: 80 }} value={state.draftDeveloperNotes} maxLength={2000} onChange={(event) => dispatch({ type: "SET_DRAFT_NOTES", notes: event.target.value })} placeholder="Ví dụ: kiểm tra permission trước khi mở shop" /></section>
      </>}
      {state.drawerTab === "Details" && activeItem && <>
        <section className="form-section"><label className="field-label" htmlFor="item-name">Tên hiển thị</label><input className="text-input" id="item-name" value={state.draftTitle} onChange={(event) => dispatch({ type: "SET_DRAFT_TITLE", title: event.target.value })} /></section><section className="form-section"><label className="field-label">Material ID <Lock size={12} /></label><input className="text-input" value={definition.material} readOnly /></section><section className="form-section"><label className="field-label" htmlFor="quantity">Số lượng</label><input className="text-input" id="quantity" type="number" min="1" max={definition.maxStack} value={activeItem.amount} onChange={(event) => dispatch({ type: "SET_AMOUNT", slot: activeItem.slot, amount: Number(event.target.value) })} /></section><section className="form-section"><label className="field-label" htmlFor="lore">Lore</label><textarea className="textarea" id="lore" value={state.draftLore.join("\n")} maxLength={4000} onChange={(event) => dispatch({ type: "SET_DRAFT_LORE", lore: event.target.value.split("\n").slice(0, 20) })} placeholder="Mỗi dòng là một lore line..." style={{ minHeight: 90 }} /></section>
      </>}
      {state.drawerTab === "JSON" && activeItem && <section className="form-section"><h3>Preview export item</h3><pre className="json-code">{JSON.stringify({ slot: activeItem.slot, material: definition.material, amount: activeItem.amount, prompt: activeItem.prompt || undefined }, null, 2)}</pre></section>}
    </div>}
    <div className="drawer-footer"><button className="ghost-button" onClick={() => dispatch({ type: "CLOSE_OVERLAY" })}>Hủy</button><div>{!isLibraryDraft && <button className="icon-button" aria-label="Xóa item" title="Xóa item" onClick={() => { if (activeItem) dispatch({ type: "REMOVE_ITEM", slot: activeItem.slot }); dispatch({ type: "CLOSE_OVERLAY" }); }}><Trash2 size={16} /></button>}<button className="primary-button" disabled={!definition} onClick={() => { dispatch({ type: "SAVE_PROMPT" }); dispatch({ type: "CLOSE_OVERLAY" }); }}><Save size={16} />Lưu item</button></div></div>
  </aside></div>;
}

function ContainerPicker({ state, dispatch }: { state: EditorState; dispatch: Dispatch<Parameters<typeof reducer>[1]> }) {
  const [query, setQuery] = useState("");
  const [candidate, setCandidate] = useState(state.container.id);
  const [confirming, setConfirming] = useState(false);
  const filtered = CONTAINERS.filter((container) => `${container.label} ${container.bukkitId}`.toLowerCase().includes(query.toLowerCase()));
  const proposed = CONTAINERS.find((container) => container.id === candidate) ?? state.container;
  const trimmed = Object.values(state.placements).filter((entry) => entry.slot >= proposed.slots).length;
  const apply = () => {
    if (trimmed && !confirming) { setConfirming(true); return; }
    dispatch({ type: "SET_CONTAINER", container: proposed });
  };
  return <div className="overlay-scrim modal-wrap" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) dispatch({ type: "CLOSE_OVERLAY" }); }}><section className="modal small" role="dialog" aria-modal="true" aria-labelledby="container-title">
    <header className="modal-header"><div><h2 id="container-title">Đổi loại container</h2><p>Chọn layout phù hợp với GUI Bukkit/Paper.</p></div><button className="icon-button" aria-label="Đóng container picker" onClick={() => dispatch({ type: "CLOSE_OVERLAY" })}><X size={18} /></button></header>
    <div className="modal-body"><label className="search-field" style={{ marginTop: 0 }}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm container..." aria-label="Tìm container" /></label><div className="category-row"><button className="category-chip active">Recommended</button><button className="category-chip">Container</button><button className="category-chip">Processing</button><button className="category-chip">Special</button></div><div className="library-grid" style={{ marginTop: 16 }}>{filtered.map((container) => <button key={container.id} className={`library-card ${candidate === container.id ? "selected" : ""}`} disabled={container.compatibility === "Unavailable"} onClick={() => { setCandidate(container.id); setConfirming(false); }}><span className="library-icon-wrap"><MiniContainer container={container} /></span><span className="library-card-name">{container.label} {candidate === container.id && <Check size={13} />}</span><span className="library-card-id">{container.bukkitId} · {container.slots} slots</span><span className={`badge ${container.compatibility === "Direct" ? "emerald" : container.compatibility === "Special" ? "warning" : ""}`} style={{ marginTop: 6 }}>{container.compatibility}</span></button>)}</div>{confirming && <div className="validation-row" style={{ marginTop: 16 }}><AlertTriangle size={16} />{trimmed} item ở slot ngoài phạm vi sẽ bị loại. Nhấn Áp dụng lần nữa để xác nhận.</div>}</div>
    <footer className="modal-footer"><span className="status" style={{ marginRight: "auto" }}>Đang dùng: {state.container.label} · {state.container.slots} slots</span><button className="ghost-button" onClick={() => dispatch({ type: "CLOSE_OVERLAY" })}>Hủy</button><button className="primary-button" disabled={proposed.compatibility === "Unavailable"} onClick={apply}>Áp dụng</button></footer>
  </section></div>;
}

function MiniContainer({ container }: { container: ContainerSpec }) {
  const shown = Math.min(container.slots || 6, 18);
  return <span style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(container.columns || 3, 6)}, 5px)`, gap: 1 }}>{Array.from({ length: shown }, (_, index) => <i key={index} style={{ width: 5, height: 5, background: "#7a8490", border: "1px solid #d3d3d3" }} />)}</span>;
}

function ExportModal({ state, apiStatus, dispatch }: { state: EditorState; apiStatus: "loading" | "saved" | "saving" | "offline" | "conflict"; dispatch: Dispatch<Parameters<typeof reducer>[1]> }) {
  const [copied, setCopied] = useState(false);
  const [filename, setFilename] = useState("main-menu-gui");
  const [includePrompt, setIncludePrompt] = useState(true);
  const [json, setJson] = useState(() => buildExport(state, { includePrompts: true }));
  useEffect(() => {
    if (apiStatus === "offline" || apiStatus === "conflict" || apiStatus === "saving" || state.dirty) {
      setJson(buildExport(state, { includePrompts: includePrompt }));
      return;
    }
    getCanonicalExport(state.projectId, includePrompt)
      .then((response) => setJson(JSON.stringify(response.data, null, 2)))
      .catch(() => setJson(buildExport(state, { includePrompts: includePrompt })));
  }, [state, apiStatus, includePrompt]);
  const lines = json.split("\n");
  const copy = async () => {
    try { await navigator.clipboard.writeText(json); setCopied(true); dispatch({ type: "TOAST", toast: { message: "Đã sao chép JSON", tone: "success" } }); } catch { dispatch({ type: "TOAST", toast: { message: "Không thể sao chép. Hãy kiểm tra quyền clipboard.", tone: "error" } }); }
  };
  const download = () => { const blob = new Blob([json], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${filename.replace(/[\\/:*?"<>|]/g, "-") || "main-menu-gui"}.json`; link.click(); URL.revokeObjectURL(url); dispatch({ type: "TOAST", toast: { message: "Đã tải file JSON", tone: "success" } }); };
  return <div className="overlay-scrim modal-wrap" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) dispatch({ type: "CLOSE_OVERLAY" }); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
    <header className="modal-header"><div><h2 id="export-title">Xuất GUI dưới dạng JSON</h2><p>Xuất cấu hình container, item, action và prompt cho plugin Java.</p></div><button className="icon-button" aria-label="Đóng export JSON" onClick={() => dispatch({ type: "CLOSE_OVERLAY" })}><X size={18} /></button></header>
    <div className="modal-body"><div className={`validation-row ${apiStatus === "offline" || apiStatus === "conflict" || state.dirty || apiStatus === "saving" ? "warning" : ""}`}>{apiStatus === "offline" || apiStatus === "conflict" || state.dirty || apiStatus === "saving" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}<span><strong>{Object.values(state.placements).filter((item) => item.includeInExport !== false).length} item hợp lệ</strong> · {Object.values(state.placements).filter((item) => item.prompt.trim()).length} item đã có prompt · {apiStatus === "offline" || apiStatus === "conflict" || state.dirty || apiStatus === "saving" ? "JSON local chưa được server validate" : "Backend canonical JSON"}</span></div><div className="export-toolbar"><span className="select-control"><Code2 size={14} />GUI Forge plugin JSON v1</span><label className="select-control">Tên file <input value={filename} onChange={(event) => setFilename(event.target.value)} aria-label="Tên file JSON" style={{ width: 120, background: "transparent", border: 0, outline: 0 }} /><span>.json</span></label></div><div className="toolbar-row" style={{ marginBottom: 14 }}><button className="ghost-button" onClick={() => setIncludePrompt(!includePrompt)}>{includePrompt ? <Check size={14} /> : <X size={14} />}Bao gồm prompt vibe code</button></div><div className="code-box"><div className="line-numbers">{lines.map((_, index) => <div key={index}>{index + 1}</div>)}</div><pre className="json-code">{lines.map((line, index) => <div key={index}>{highlightJson(line)}</div>)}</pre></div><div className="schema-note"><strong>Schema:</strong> <code>type</code>, <code>title</code>, <code>rows</code>, <code>items[].slot</code>, <code>material</code>, <code>amount</code>, <code>prompt</code>, <code>action</code>. Player inventory không có trong export.</div></div>
    <footer className="modal-footer"><button className="ghost-button" onClick={() => dispatch({ type: "CLOSE_OVERLAY" })}>Đóng</button><button className="secondary-button" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Đã sao chép" : "Sao chép JSON"}</button><button className="primary-button" onClick={download}><FileDown size={16} />Tải file JSON</button></footer>
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
