import type { ProjectDocument } from "./editor";

export interface WorkspaceEvent {
  type: "workspace.changed";
  changes: Array<{ path: string; kind: "change" | "rename" | "create" | "delete" | "rescan" }>;
}

export interface WorkspaceGuiSummary {
  id: string;
  title: string;
  file: string;
  status: "valid" | "warning" | "error" | "modified";
  updatedAt?: string;
  placementsCount?: number;
  error?: string;
}

export interface DetectedPluginProject {
  projectName: string;
  rootPath?: string;
  platform: "paper" | "spigot" | "bukkit" | "unknown";
  language: "java" | "kotlin" | "mixed" | "unknown";
  buildSystem: "gradle" | "gradle-kotlin" | "maven" | "unknown";
  javaVersion?: string;
  minecraftVersion?: string;
  sourceRoots: string[];
  resourceRoot?: string;
  mainClass?: string;
  basePackage?: string;
  metadataFile?: string;
  issues?: Array<{ code: string; message: string; severity: "info" | "warning" | "error" }>;
}

export interface PluginWorkspace {
  workspaceId: string;
  workspace: Omit<DetectedPluginProject, "rootPath" | "issues"> & { schemaVersion: number; generatedPackage?: string; integrationMode: "generated-source" };
  manifest: Omit<DetectedPluginProject, "rootPath"> & { schemaVersion: number };
  guiIndex: { schemaVersion: number; guis: WorkspaceGuiSummary[] };
}

export function workspaceStorageKey(workspaceId: string, key: string): string {
  return `jsongui:workspace:${workspaceId}:${key}`;
}

export function hasAbsolutePath(value: unknown): boolean {
  if (typeof value === "string") return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\\\");
  if (Array.isArray(value)) return value.some(hasAbsolutePath);
  if (value && typeof value === "object") return Object.values(value).some(hasAbsolutePath);
  return false;
}

export function readWorkspacePreference(workspaceId: string, key: string): string | null {
  try { return localStorage.getItem(workspaceStorageKey(workspaceId, key)); } catch { return null; }
}

export function writeWorkspacePreference(workspaceId: string, key: string, value: string): void {
  try { localStorage.setItem(workspaceStorageKey(workspaceId, key), value); } catch { /* storage optional */ }
}

export function withoutRootPath<T extends Record<string, unknown>>(value: T): Omit<T, "rootPath"> {
  const safe = { ...value };
  delete safe.rootPath;
  return safe;
}

export function workspaceGuiIdFromTitle(title: string): string {
  const value = title.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return value.slice(0, 64) || "new-gui";
}

export function defaultWorkspaceGui(id: string, catalogVersion: string): ProjectDocument {
  return { schemaVersion: 1, id, revision: 1, catalogVersion, title: id.replace(/-/g, " "), description: "", containerId: "double-chest", itemDefaults: {}, placements: [], updatedAt: new Date().toISOString() };
}
