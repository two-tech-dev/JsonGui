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
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(path, { ...init, signal: controller.signal, headers: { Accept: "application/json", ...init.headers } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as Partial<ApiProblem>;
      throw new ApiError({ status: response.status, code: body.code ?? "REQUEST_FAILED", message: body.detail ?? body.message ?? `Request failed (${response.status})`, issues: body.issues ?? [] });
    }
    return { data: await response.json() as T, etag: response.headers.get("etag") };
  } finally { window.clearTimeout(timeout); }
}

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
export function getCanonicalExport(id: string, includePrompts = true) { return request<unknown>(`/api/v1/projects/${encodeURIComponent(id)}/export?includePrompts=${includePrompts}`); }
