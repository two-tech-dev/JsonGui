import type { ProjectDocument } from "../domain/editor";
import type { DetectedPluginProject, WorkspaceEvent, WorkspaceGuiSummary } from "../domain/workspace";

let workspaceSessionToken: string | null = null;
const isDesktop = "__TAURI_INTERNALS__" in window;
let apiBasePromise: Promise<string> | null = null;

function resolveApiBase(): Promise<string> {
  if (!isDesktop) return Promise.resolve("");
  if (!apiBasePromise) {
    apiBasePromise = import("@tauri-apps/api/core").then(({ invoke }) => invoke<string>("backend_url")).then((url) => {
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error("Invalid JsonGui backend URL");
      return url;
    });
  }
  return apiBasePromise;
}

export async function apiUrl(path: string) { return `${await resolveApiBase()}${path}`; }
export function isTauriDesktop() { return isDesktop; }
export function clearApiBase() { apiBasePromise = null; }

export function setWorkspaceSessionToken(token: string | null) {
  workspaceSessionToken = token;
  try {
    if (token) sessionStorage.setItem("jsongui:session-token", token);
    else sessionStorage.removeItem("jsongui:session-token");
  } catch { /* storage optional */ }
}

function getWorkspaceSessionToken() {
  if (workspaceSessionToken) return workspaceSessionToken;
  try { return sessionStorage.getItem("jsongui:session-token"); } catch { return null; }
}

export interface WorkspaceResponse {
  workspaceId: string;
  workspace: Omit<DetectedPluginProject, "rootPath" | "issues"> & { schemaVersion: number; generatedPackage?: string; integrationMode: "generated-source" };
  manifest: Omit<DetectedPluginProject, "rootPath"> & { schemaVersion: number };
  guiIndex: { schemaVersion: number; guis: WorkspaceGuiSummary[] };
  sessionToken?: string;
}

export interface WorkspaceChangeEvent extends WorkspaceEvent {
  type: "workspace.changed";
}

export async function bootstrapSessionToken(): Promise<void> {
  const response = await fetch(await apiUrl("/api/v1/session"), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Cannot initialize JsonGui local session");
  const body = await response.json() as { sessionToken?: string };
  if (!body.sessionToken) throw new Error("JsonGui local session token is missing");
  setWorkspaceSessionToken(body.sessionToken);
}

export interface ApiProblem {
  status: number;
  code: string;
  message: string;
  detail?: string;
  issues: Array<{ path: string; message: string }>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ApiProblem["issues"];
  constructor(problem: ApiProblem) { super(problem.message); this.name = "ApiError"; this.status = problem.status; this.code = problem.code; this.issues = problem.issues; }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<{ data: T; etag: string | null }> {
  const controller = new AbortController();
  const token = getWorkspaceSessionToken();
  const headers = { Accept: "application/json", ...(token ? { "X-JsonGui-Token": token } : {}), ...init.headers };
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(await apiUrl(path), { ...init, signal: controller.signal, headers });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as Partial<ApiProblem>;
      throw new ApiError({ status: response.status, code: body.code ?? "REQUEST_FAILED", message: body.detail ?? body.message ?? `Request failed (${response.status})`, issues: body.issues ?? [] });
    }
    return { data: await response.json() as T, etag: response.headers.get("etag") };
  } finally { window.clearTimeout(timeout); }
}

export interface JsonSkillSummary { id: string; files: Array<{ name: string; bytes: number }>; fileCount: number; bytes: number; }
export function listJsonSkills() { return request<JsonSkillSummary[]>("/api/v1/json-skills"); }

export interface CatalogResponse {
  version: string;
  minecraftVersion: string;
  edition: "java";
  items: Array<{ id: string; name: string; material: string; category: "Tools" | "Decoration" | "Combat" | "Food" | "Redstone" | "Utility" | "Misc"; icon: string; maxStack: number; description: string }>;
}

export function getCatalog(version?: string) { return request<CatalogResponse>(version ? `/api/v1/catalog/versions/${encodeURIComponent(version)}` : "/api/v1/catalog/current"); }
export function getProject(id: string) { return request<unknown>(`/api/v1/projects/${encodeURIComponent(id)}`); }
export function createProject(document: unknown) { return request<unknown>("/api/v1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(document) }); }
export function putProject(id: string, document: unknown, etag: string) { return request<unknown>(`/api/v1/projects/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": etag }, body: JSON.stringify(document) }); }
export function getCanonicalExport(id: string) { return request<unknown>(`/api/v1/projects/${encodeURIComponent(id)}/export`); }
export function connectWorkspace(rootPath: string) { return request<WorkspaceResponse>("/api/v1/workspaces/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rootPath }) }); }
export function getCurrentWorkspace() { return request<WorkspaceResponse>("/api/v1/workspaces/current"); }
export function getWorkspace(workspaceId: string) { return request<WorkspaceResponse>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}`); }
export function rescanWorkspace(workspaceId: string) { return request<WorkspaceResponse>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/rescan`, { method: "POST" }); }
export function listWorkspaceGuis(workspaceId: string) { return request<WorkspaceGuiSummary[]>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/guis`); }
export function getWorkspaceGui(workspaceId: string, guiId: string) { return request<ProjectDocument>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/guis/${encodeURIComponent(guiId)}`); }
export function createWorkspaceGui(workspaceId: string, project: ProjectDocument) { return request<ProjectDocument>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/guis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project) }); }
export function putWorkspaceGui(workspaceId: string, guiId: string, project: ProjectDocument, etag: string) { return request<ProjectDocument>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/guis/${encodeURIComponent(guiId)}`, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": etag }, body: JSON.stringify(project) }); }
export function deleteWorkspaceGui(workspaceId: string, guiId: string, etag: string) { return request<{ success: true }>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/guis/${encodeURIComponent(guiId)}`, { method: "DELETE", headers: { "If-Match": etag } }); }
export function subscribeWorkspace(workspaceId: string, onEvent: (event: WorkspaceChangeEvent) => void) {
  const token = getWorkspaceSessionToken();
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  let source: EventSource | null = null;
  let closed = false;
  void apiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/events${query}`).then((url) => {
    if (closed) return;
    source = new EventSource(url);
    source.addEventListener("workspace.changed", (event) => {
      try { onEvent(JSON.parse((event as MessageEvent).data) as WorkspaceChangeEvent); } catch { /* malformed events ignored */ }
    });
  });
  return () => { closed = true; source?.close(); };
}
