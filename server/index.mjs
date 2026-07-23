import { createServer } from "node:http";
import { readFile, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { CatalogStore } from "./catalog-store.mjs";
import { ProjectStore } from "./project-store.mjs";
import { WorkspaceStore } from "./workspace-store.mjs";
import { WorkspaceWatcher } from "./workspace-watcher.mjs";
import { LIMITS, PROJECT_RE, ValidationError, canonicalExport, problem } from "./schema.mjs";
import { exportDeluxeMenus } from "./deluxemenus.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const allowedOrigins = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "tauri://localhost",
  "https://tauri.localhost",
  "http://tauri.localhost",
]);

// Build texture map: itemName → PNG filename (from models + actual PNG files)
async function buildTextureMap(resourceRoot) {
  const map = new Map();
  const itemDir = path.join(resourceRoot, "item");

  // 1. Scan all PNGs in item/ dir for direct lookup
  try {
    const pngs = await readdir(itemDir);
    for (const png of pngs) {
      if (!png.endsWith(".png")) continue;
      map.set(png.replace(".png", ""), png);
    }
  } catch { /* item dir may not exist */ }

  // 2. Read models/item/*.json → map model name to texture PNG
  const itemModelDir = path.join(resourceRoot, "models", "item");
  try {
    const files = await readdir(itemModelDir);
    await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => {
      try {
        const model = JSON.parse(await readFile(path.join(itemModelDir, file), "utf8"));
        const texture = model.textures?.layer0;
        if (!texture) return;
        const texName = texture.replace(/^minecraft:(item|block)\//, "");
        const itemName = file.replace(".json", "");
        if (map.has(texName)) map.set(itemName, map.get(texName));
      } catch { /* skip */ }
    }));
  } catch { /* models dir may not exist */ }

  // 3. Read models/block/*.json → map block name to texture PNG
  const blockModelDir = path.join(resourceRoot, "models", "block");
  try {
    const files = await readdir(blockModelDir);
    await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => {
      try {
        const model = JSON.parse(await readFile(path.join(blockModelDir, file), "utf8"));
        const texRef = model.textures?.all ?? model.textures?.bottom ?? model.textures?.side ?? model.textures?.particle;
        if (!texRef) return;
        const texName = texRef.replace(/^minecraft:(item|block)\//, "");
        const blockName = file.replace(".json", "");
        if (map.has(texName)) map.set(blockName, map.get(texName));
      } catch { /* skip */ }
    }));
  } catch { /* models dir may not exist */ }

  console.info(`Texture map loaded: ${map.size} entries`);
  return map;
}
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function send(response, status, body, headers = {}) {
  response.writeHead(status, { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'", ...response.originHeaders, ...headers });
  response.end(body === undefined || typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function sendProblem(response, status, code, message, issues, requestId) {
  send(response, status, problem(status, code, message, issues, requestId), { "Content-Type": "application/problem+json; charset=utf-8", "Cache-Control": "no-store" });
}

async function readBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > LIMITS.body) throw Object.assign(new Error("Request body is too large"), { code: "BODY_TOO_LARGE" }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("Malformed JSON"), { code: "BAD_JSON" }); }
}

function methodNotAllowed(response, requestId) { sendProblem(response, 405, "METHOD_NOT_ALLOWED", "Method is not supported", [], requestId); }
function originHeaders(request) {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, If-Match, X-JsonGui-Token",
    "Vary": "Origin",
  };
}

function validOrigin(request) { const origin = request.headers.origin; return !origin || allowedOrigins.has(origin); }

export async function createApp({ dataRoot = path.join(repoRoot, "data"), distRoot = path.join(repoRoot, "dist"), seedFile = path.join(repoRoot, "shared", "seed-v1.json"), resourceRoot = repoRoot } = {}) {
  const seed = await json(seedFile);
  const catalogs = new CatalogStore({ root: dataRoot, seed: seed.catalog });
  await catalogs.initialize();
  const projects = new ProjectStore({ root: dataRoot, seed: seed.project, catalogs, containers: seed.containers });
  await projects.initialize();

  // Build texture map: itemName → actual PNG filename
  const textureMap = await buildTextureMap(resourceRoot);
  const workspaces = new WorkspaceStore({ containers: seed.containers });
  const sessionToken = randomUUID();
  const workspaceWatchers = new Map();
  const workspaceClients = new Map();
  const authorized = (request) => {
    const queryToken = new URL(request.url, "http://127.0.0.1").searchParams.get("token");
    return request.headers["x-jsongui-token"] === sessionToken || request.headers.authorization === `Bearer ${sessionToken}` || queryToken === sessionToken;
  };
  const workspaceIdFromPath = (pathname) => pathname.match(/^\/api\/v1\/workspaces\/([a-f0-9]{32})(?:\/|$)/)?.[1];
  const workspaceEvents = (id, event) => {
    for (const response of workspaceClients.get(id) ?? []) {
      response.write(`event: ${event.type}\\ndata: ${JSON.stringify(event)}\\n\\n`);
    }
  };
  const ensureWorkspaceWatcher = async (id) => {
    if (workspaceWatchers.has(id)) return;
    const session = workspaces.session(id);
    const current = await workspaces.get(id);
    const watcher = new WorkspaceWatcher({
      root: session.root,
      sourceRoots: current.manifest.sourceRoots ?? [],
      resourceRoot: current.manifest.resourceRoot,
      onChange: (event) => workspaceEvents(id, event),
    }).start();
    workspaceWatchers.set(id, watcher);
  };

  async function api(request, response, pathname, requestId) {
    if (!validOrigin(request)) return sendProblem(response, 403, "ORIGIN_NOT_ALLOWED", "Origin is not allowed", [], requestId);
    if (request.method === "OPTIONS") return send(response, 204, undefined, originHeaders(request));
    if (pathname === "/api/v1/session") {
      if (request.method !== "GET") return methodNotAllowed(response, requestId);
      return send(response, 200, { sessionToken }, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    }
    const workspaceId = workspaceIdFromPath(pathname);
    const isWorkspaceConnect = pathname === "/api/v1/workspaces/connect";
    const requiresSession = pathname.startsWith("/api/v1/") && !pathname.startsWith("/api/v1/assets/") && pathname !== "/api/v1/health";
    if (requiresSession && !authorized(request)) {
      return sendProblem(response, 401, "SESSION_TOKEN_REQUIRED", "JsonGui session token is required", [], requestId);
    }
    if (isWorkspaceConnect) {
      if (request.method !== "POST") return methodNotAllowed(response, requestId);
      if (!request.headers["content-type"]?.includes("application/json")) return sendProblem(response, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json", [], requestId);
      const body = await readBody(request);
      const connected = await workspaces.connect(body?.rootPath);
      await ensureWorkspaceWatcher(connected.workspaceId);
      return send(response, 201, { ...connected, sessionToken }, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    }
    if (pathname === "/api/v1/workspaces/current") {
      if (request.method !== "GET") return methodNotAllowed(response, requestId);
      const [id] = workspaceWatchers.keys();
      if (!id) return sendProblem(response, 404, "WORKSPACE_NOT_FOUND", "No plugin workspace is connected", [], requestId);
      return send(response, 200, await workspaces.get(id), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    }
    if (workspaceId) {
      const suffix = pathname.slice(`/api/v1/workspaces/${workspaceId}`.length);
      if (suffix === "/events") {
        if (request.method !== "GET") return methodNotAllowed(response, requestId);
        await ensureWorkspaceWatcher(workspaceId);
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        response.write("retry: 1000\\n\\n");
        const clients = workspaceClients.get(workspaceId) ?? new Set();
        clients.add(response);
        workspaceClients.set(workspaceId, clients);
        request.on("close", () => { clients.delete(response); if (clients.size === 0) workspaceClients.delete(workspaceId); });
        return true;
      }
      if (suffix === "" || suffix === "/") {
        if (request.method !== "GET") return methodNotAllowed(response, requestId);
        return send(response, 200, await workspaces.get(workspaceId), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      }
      if (suffix === "/rescan") {
        if (request.method !== "POST") return methodNotAllowed(response, requestId);
        const scanned = await workspaces.rescan(workspaceId);
        const oldWatcher = workspaceWatchers.get(workspaceId); oldWatcher?.close(); workspaceWatchers.delete(workspaceId);
        await ensureWorkspaceWatcher(workspaceId);
        workspaceEvents(workspaceId, { type: "workspace.changed", changes: [{ path: "workspace", kind: "rescan" }] });
        return send(response, 200, scanned, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      }
      if (suffix === "/guis" && request.method === "GET") {
        return send(response, 200, await workspaces.listGuis(workspaceId), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      }
      if (suffix === "/guis" && request.method === "POST") {
        if (!request.headers["content-type"]?.includes("application/json")) return sendProblem(response, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json", [], requestId);
        const created = await workspaces.createGui(workspaceId, await readBody(request), catalogs);
        workspaceEvents(workspaceId, { type: "workspace.changed", changes: [{ path: `.jsongui/guis/${created.project.id}.json`, kind: "create" }] });
        return send(response, 201, created.project, { "Content-Type": "application/json; charset=utf-8", ETag: created.etag, "Cache-Control": "no-store" });
      }
      const gui = suffix.match(/^\/guis\/([a-z0-9][a-z0-9-]{0,63})$/);
      if (gui) {
        const guiId = gui[1];
        if (request.method === "GET") {
          const loaded = await workspaces.readGui(workspaceId, guiId);
          return send(response, 200, loaded.project, { "Content-Type": "application/json; charset=utf-8", ETag: loaded.etag, "Cache-Control": "no-store" });
        }
        if (request.method === "PUT") {
          if (!request.headers["content-type"]?.includes("application/json")) return sendProblem(response, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json", [], requestId);
          const expected = request.headers["if-match"];
          if (!expected) return sendProblem(response, 428, "PRECONDITION_REQUIRED", "If-Match is required to save a GUI", [], requestId);
          const saved = await workspaces.putGui(workspaceId, guiId, await readBody(request), expected, catalogs);
          workspaceEvents(workspaceId, { type: "workspace.changed", changes: [{ path: `.jsongui/guis/${guiId}.json`, kind: "change" }] });
          return send(response, 200, saved.project, { "Content-Type": "application/json; charset=utf-8", ETag: saved.etag, "Cache-Control": "no-store" });
        }
        if (request.method === "DELETE") {
          const expected = request.headers["if-match"];
          if (!expected) return sendProblem(response, 428, "PRECONDITION_REQUIRED", "If-Match is required to delete a GUI", [], requestId);
          await workspaces.deleteGui(workspaceId, guiId, expected);
          workspaceEvents(workspaceId, { type: "workspace.changed", changes: [{ path: `.jsongui/guis/${guiId}.json`, kind: "delete" }] });
          return send(response, 200, { success: true }, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        }
        return methodNotAllowed(response, requestId);
      }
      return false;
    }
    if (pathname.startsWith("/api/v1/assets/")) {
      if (request.method !== "GET") return methodNotAllowed(response, requestId);
      const filename = decodeURIComponent(pathname.slice("/api/v1/assets/".length));
      if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
        return sendProblem(response, 400, "BAD_REQUEST", "Invalid asset name", [], requestId);
      }
      const itemDir = path.join(resourceRoot, "item");
      const bareName = filename.replace(".png", "");
      // Use textureMap to find correct PNG for this item name
      const mappedPng = textureMap.get(bareName);
      const candidates = [filename];
      if (mappedPng && mappedPng !== filename) candidates.push(mappedPng);
      // Animated items: try _00 frame as default
      if (!mappedPng) candidates.push(bareName + "_00.png");
      for (const candidate of candidates) {
        try {
          const file = await stat(path.join(itemDir, candidate));
          if (file.isFile()) {
            const data = await readFile(path.join(itemDir, candidate));
            return send(response, 200, data, { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" });
          }
        } catch { /* try next candidate */ }
      }
      return sendProblem(response, 404, "NOT_FOUND", "Asset not found", [], requestId);
    }
    if (pathname === "/api/v1/health") {
      if (request.method !== "GET") return methodNotAllowed(response, requestId);
      const current = await catalogs.getCurrent();
      return send(response, 200, { status: "ok", apiVersion: 1, storage: "ok", catalog: { status: current.catalog.version === seed.catalog.version ? "seed" : "active", version: current.catalog.version, count: current.catalog.items.length } }, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    }
    if (pathname === "/api/v1/catalog/current" || pathname.startsWith("/api/v1/catalog/versions/")) {
      if (request.method !== "GET") return methodNotAllowed(response, requestId);
      const version = pathname === "/api/v1/catalog/current" ? undefined : decodeURIComponent(pathname.slice("/api/v1/catalog/versions/".length));
      const loaded = version ? await catalogs.getVersion(version) : await catalogs.getCurrent();
      if (!loaded) return sendProblem(response, 404, "CATALOG_NOT_FOUND", "Catalog version was not found", [], requestId);
      if (request.headers["if-none-match"] === loaded.etag) return send(response, 304, undefined, { ETag: loaded.etag });
      return send(response, 200, loaded.catalog, { "Content-Type": "application/json; charset=utf-8", ETag: loaded.etag, "Cache-Control": "no-cache" });
    }
    if (pathname === "/api/v1/projects" && request.method === "GET") {
      const list = await projects.list();
      return send(response, 200, list, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    }
    const matches = pathname.match(/^\/api\/v1\/projects(?:\/([a-z0-9][a-z0-9-]{0,63}))?(\/export)?$/);
    if (!matches) return false;
    const [, projectId, exportPath] = matches;
    if (!projectId) {
      if (request.method !== "POST") return methodNotAllowed(response, requestId);
      if (!request.headers["content-type"]?.includes("application/json")) return sendProblem(response, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json", [], requestId);
      const created = await projects.create(await readBody(request));
      return send(response, 201, created.project, { "Content-Type": "application/json; charset=utf-8", ETag: created.etag, Location: `/api/v1/projects/${created.project.id}`, "Cache-Control": "no-store" });
    }
    if (!PROJECT_RE.test(projectId)) return sendProblem(response, 404, "PROJECT_NOT_FOUND", "Project was not found", [], requestId);
    if (exportPath) {
      if (request.method !== "GET") return methodNotAllowed(response, requestId);
      const { project, catalog } = await projects.export(projectId);
      const urlObj = new URL(request.url, "http://127.0.0.1");
      const includePrompts = urlObj.searchParams.get("includePrompts") !== "false";
      const format = urlObj.searchParams.get("format") || "json";
      const openCommand = urlObj.searchParams.get("openCommand") || "";
      const registerCommand = urlObj.searchParams.get("registerCommand") === "true";
      
      if (format === "deluxemenus") {
        const yaml = exportDeluxeMenus(project, catalog, seed.containers, { 
          includePrompts, 
          openCommand, 
          registerCommand 
        });
        const safeFilename = project.title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-") || "menu";
        return send(response, 200, yaml, { 
          "Content-Type": "text/yaml; charset=utf-8", 
          "Content-Disposition": `attachment; filename="${safeFilename}.yml"`, 
          "Cache-Control": "no-store" 
        });
      }
      
      const exported = canonicalExport(project, catalog, seed.containers, { includePrompts });
      return send(response, 200, exported, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${projectId}.json"`, "Cache-Control": "no-store" });
    }
    if (request.method === "GET") {
      const loaded = await projects.get(projectId);
      return send(response, 200, loaded.project, { "Content-Type": "application/json; charset=utf-8", ETag: loaded.etag, "Cache-Control": "no-store" });
    }
    if (request.method === "PUT") {
      if (!request.headers["content-type"]?.includes("application/json")) return sendProblem(response, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json", [], requestId);
      const expected = request.headers["if-match"];
      if (!expected) return sendProblem(response, 428, "PRECONDITION_REQUIRED", "If-Match is required to save a project", [], requestId);
      const saved = await projects.put(projectId, await readBody(request), expected);
      return send(response, 200, saved.project, { "Content-Type": "application/json; charset=utf-8", ETag: saved.etag, "Cache-Control": "no-store" });
    }
    if (request.method === "DELETE") {
      const expected = request.headers["if-match"];
      if (!expected) return sendProblem(response, 428, "PRECONDITION_REQUIRED", "If-Match is required to delete a project", [], requestId);
      await projects.delete(projectId, expected);
      return send(response, 200, { success: true }, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    }
    return methodNotAllowed(response, requestId);
  }

  async function staticFile(response, pathname) {
    if (!distRoot || pathname.startsWith("/api/")) return false;
    const requested = pathname === "/" ? "/index.html" : pathname;
    const safe = path.resolve(distRoot, `.${requested}`);
    if (!safe.startsWith(`${path.resolve(distRoot)}${path.sep}`) && safe !== path.join(path.resolve(distRoot), "index.html")) return false;
    let target = safe;
    try { const file = await stat(target); if (!file.isFile()) return false; } catch { target = path.join(distRoot, "index.html"); }
    try { const data = await readFile(target); return send(response, 200, data, { "Content-Type": contentTypes[path.extname(target)] ?? "application/octet-stream", "Cache-Control": path.basename(target) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable" }); } catch { return false; }
  }

  const handler = async (request, response) => {
    const requestId = randomUUID(); const started = performance.now(); const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    response.originHeaders = originHeaders(request);
    try {
      if (pathname.startsWith("/api/")) { const result = await api(request, response, pathname, requestId); if (result === false) sendProblem(response, 404, "NOT_FOUND", "Route was not found", [], requestId); }
      else if (!(await staticFile(response, pathname))) sendProblem(response, 404, "NOT_FOUND", "Route was not found", [], requestId);
    } catch (error) {
      if (error instanceof ValidationError) sendProblem(response, 422, "VALIDATION_FAILED", error.message, error.issues, requestId);
      else if (error?.code === "ENOENT") sendProblem(response, 404, "NOT_FOUND", "Resource was not found", [], requestId);
      else if (error?.code === "EXISTS") sendProblem(response, 409, "PROJECT_EXISTS", error.message, [], requestId);
      else if (error?.code === "PRECONDITION") sendProblem(response, 412, "PRECONDITION_FAILED", error.message, [], requestId);
      else if (error?.code === "FORBIDDEN") sendProblem(response, 403, "FORBIDDEN", error.message, [], requestId);
      else if (error?.code === "CATALOG_NOT_FOUND") sendProblem(response, 409, "CATALOG_NOT_FOUND", error.message, [], requestId);
      else if (error?.code === "SESSION_TOKEN_REQUIRED") sendProblem(response, 401, "SESSION_TOKEN_REQUIRED", error.message, [], requestId);
      else if (error?.code === "WORKSPACE_NOT_FOUND") sendProblem(response, 404, "WORKSPACE_NOT_FOUND", error.message, [], requestId);
      else if (error?.code === "PLUGIN_ROOT_NOT_FOUND" || error?.code === "INVALID_PLUGIN_ROOT") sendProblem(response, 400, error.code, error.message, [], requestId);
      else if (error?.code === "PATH_FORBIDDEN") sendProblem(response, 403, "PATH_FORBIDDEN", error.message, [], requestId);
      else if (error?.code === "INVALID_GUI_ID") sendProblem(response, 422, "INVALID_GUI_ID", error.message, [], requestId);
      else if (error?.code === "BODY_TOO_LARGE") sendProblem(response, 413, "PAYLOAD_TOO_LARGE", error.message, [], requestId);
      else if (error?.code === "BAD_JSON") sendProblem(response, 400, "MALFORMED_JSON", error.message, [], requestId);
      else { console.error(`[${requestId}] ${request.method} ${pathname}`, error); sendProblem(response, 500, "INTERNAL_ERROR", "Internal server error", [], requestId); }
    } finally { console.info(`${request.method} ${pathname} ${response.statusCode} ${Math.round(performance.now() - started)}ms`); }
  };
  return {
    handler,
    close: async () => {
      for (const watcher of workspaceWatchers.values()) watcher.close();
      workspaceWatchers.clear();
      for (const clients of workspaceClients.values()) for (const client of clients) client.end();
      workspaceClients.clear();
      workspaces.close();
    }
  };
}

export async function listen({
  dataRoot = process.env.GUI_FORGE_DATA_ROOT ?? path.join(repoRoot, "data"),
  resourceRoot = process.env.GUI_FORGE_RESOURCE_ROOT ?? repoRoot,
  distRoot = path.join(resourceRoot, "dist"),
  port = Number(process.env.PORT ?? 8791),
} = {}) {
  const app = await createApp({
    dataRoot,
    distRoot,
    seedFile: path.join(resourceRoot, "shared", "seed-v1.json"),
    resourceRoot,
  });
  const server = createServer(app.handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("API did not bind a TCP port");
  const url = `http://127.0.0.1:${address.port}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await app.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
  return { url, close };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const api = await listen();
  console.info(`GUI_FORGE_API_READY=${api.url}`);
  const shutdown = () => api.close().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
