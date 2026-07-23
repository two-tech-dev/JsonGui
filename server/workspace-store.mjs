import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, open, readFile, readdir, rename, rm, unlink, realpath } from "node:fs/promises";
import path from "node:path";
import { etagFor, validateProject } from "./schema.mjs";
import { scanPluginProject } from "./plugin-scanner.mjs";

const GUI_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const WORKSPACE_SCHEMA_VERSION = 1;
const GUI_INDEX_SCHEMA_VERSION = 1;
const WORKSPACE_DIR = ".jsongui";
const RESERVED_DIRS = ["guis", "behaviors", "mappings", "snapshots", "patches"];

async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }
async function atomicJson(file, value, backup = false) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const handle = await open(temp, "wx");
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  if (backup) { try { await copyFile(file, file.replace(/\.json$/, ".bak.json")); } catch { /* first write */ } }
  try { await rename(temp, file); } catch (error) { try { await unlink(temp); } catch { /* cleanup */ } throw error; }
}

function containment(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
async function assertNoSymlink(root, candidate) {
  if (!containment(root, candidate)) throw Object.assign(new Error("Path escapes workspace root"), { code: "PATH_FORBIDDEN" });
  const parts = path.relative(root, candidate).split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw Object.assign(new Error("Workspace path cannot contain symlinks"), { code: "PATH_FORBIDDEN" });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
  }
}
function safeGuiId(id) { return typeof id === "string" && GUI_ID_RE.test(id); }
function workspaceId(root) { return createHash("sha256").update(root).digest("hex").slice(0, 32); }
function relativePath(value) { return value.split(path.sep).join("/"); }
function defaultWorkspace(project) {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    projectName: project.projectName,
    platform: project.platform,
    language: project.language,
    buildSystem: project.buildSystem,
    sourceRoots: project.sourceRoots,
    ...(project.resourceRoot ? { resourceRoot: project.resourceRoot } : {}),
    ...(project.generatedPackage ? { generatedPackage: project.generatedPackage } : {}),
    integrationMode: "generated-source",
  };
}
function defaultManifest(project) {
  const allowed = ["projectName", "platform", "language", "buildSystem", "javaVersion", "minecraftVersion", "sourceRoots", "resourceRoot", "mainClass", "basePackage", "metadataFile", "issues"];
  return { schemaVersion: 1, ...Object.fromEntries(allowed.filter((key) => project[key] !== undefined).map((key) => [key, project[key]])) };
}

export class WorkspaceStore {
  constructor({ containers }) {
    this.containers = containers;
    this.sessions = new Map();
    this.queues = new Map();
  }
  async connect(rootPath) {
    const canonical = await this.validateRoot(rootPath);
    const project = await scanPluginProject(canonical);
    const id = workspaceId(canonical);
    const session = this.sessions.get(id) ?? { id, root: canonical };
    this.sessions.set(id, session);
    await this.initialize(session, project);
    return this.get(id);
  }
  async validateRoot(rootPath) {
    if (typeof rootPath !== "string" || !rootPath.trim() || rootPath.length > 4096) throw Object.assign(new Error("Plugin root path is invalid"), { code: "INVALID_PLUGIN_ROOT" });
    let info;
    try { info = await lstat(rootPath); } catch { throw Object.assign(new Error("Plugin root was not found"), { code: "PLUGIN_ROOT_NOT_FOUND" }); }
    if (!info.isDirectory() || info.isSymbolicLink()) throw Object.assign(new Error("Plugin root must be a real directory"), { code: "INVALID_PLUGIN_ROOT" });
    const canonical = await realpath(rootPath);
    const canonicalInfo = await lstat(canonical);
    if (!canonicalInfo.isDirectory() || canonicalInfo.isSymbolicLink()) throw Object.assign(new Error("Plugin root must be a real directory"), { code: "INVALID_PLUGIN_ROOT" });
    return canonical;
  }
  session(id) {
    const session = this.sessions.get(id);
    if (!session) throw Object.assign(new Error("Workspace was not connected"), { code: "WORKSPACE_NOT_FOUND" });
    return session;
  }
  file(session, relative) {
    const candidate = path.resolve(session.root, relative);
    if (!containment(session.root, candidate)) throw Object.assign(new Error("Path escapes workspace root"), { code: "PATH_FORBIDDEN" });
    return candidate;
  }
  async metadataFile(session, name) { const file = this.file(session, path.join(WORKSPACE_DIR, name)); await assertNoSymlink(session.root, file); return file; }
  async guiFile(session, id) { if (!safeGuiId(id)) throw Object.assign(new Error("Invalid GUI ID"), { code: "INVALID_GUI_ID" }); const file = this.file(session, path.join(WORKSPACE_DIR, "guis", `${id}.json`)); await assertNoSymlink(session.root, file); return file; }
  async initialize(session, project) {
    await mkdir(this.file(session, WORKSPACE_DIR), { recursive: true });
    for (const dir of RESERVED_DIRS) await mkdir(this.file(session, path.join(WORKSPACE_DIR, dir)), { recursive: true });
    const workspaceFile = await this.metadataFile(session, "workspace.json");
    const manifestFile = await this.metadataFile(session, "manifest.json");
    const indexFile = await this.metadataFile(session, "gui-index.json");
    const agentFile = await this.metadataFile(session, "agent.json");
    try { await lstat(workspaceFile); } catch { await atomicJson(workspaceFile, defaultWorkspace(project)); }
    await atomicJson(manifestFile, defaultManifest(project));
    try { await lstat(agentFile); } catch { await atomicJson(agentFile, { schemaVersion: 1, enabled: false, skills: [] }); }
    const index = await this.index(session);
    await atomicJson(indexFile, index);
  }
  publicSession(session, project, index) {
    const workspace = defaultWorkspace(project);
    return { workspaceId: session.id, workspace, manifest: defaultManifest(project), guiIndex: index };
  }
  async get(id) {
    const session = this.session(id);
    const [workspace, manifest, index] = await Promise.all([
      this.metadataFile(session, "workspace.json").then(readJson),
      this.metadataFile(session, "manifest.json").then(readJson),
      this.index(session),
    ]);
    return { workspaceId: id, workspace, manifest, guiIndex: index };
  }
  async rescan(id) {
    const session = this.session(id);
    const project = await scanPluginProject(session.root);
    await this.initialize(session, project);
    return this.get(id);
  }
  async index(session) {
    const directory = this.file(session, path.join(WORKSPACE_DIR, "guis"));
    await assertNoSymlink(session.root, directory);
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { entries = []; }
    const guis = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.endsWith(".bak.json")) continue;
      const id = entry.name.slice(0, -5);
      if (!safeGuiId(id)) continue;
      try {
        const loaded = await this.readGui(session.id, id);
        guis.push({ id, title: loaded.project.title, file: relativePath(path.join(WORKSPACE_DIR, "guis", entry.name)), status: "valid", updatedAt: loaded.project.updatedAt, placementsCount: loaded.project.placements.length });
      } catch (error) {
        guis.push({ id, title: id, file: relativePath(path.join(WORKSPACE_DIR, "guis", entry.name)), status: "error", error: error.message });
      }
    }
    return { schemaVersion: GUI_INDEX_SCHEMA_VERSION, guis: guis.sort((a, b) => a.title.localeCompare(b.title)) };
  }
  async listGuis(id) { return (await this.index(this.session(id))).guis; }
  async readGui(id, guiId) {
    const session = this.session(id);
    const file = await this.guiFile(session, guiId);
    const project = await readJson(file);
    const catalogVersion = project.catalogVersion;
    const containers = this.containers;
    if (!project || typeof catalogVersion !== "string") throw Object.assign(new Error("GUI document is invalid"), { code: "INVALID_GUI" });
    // Workspace documents are validated by the caller with the loaded catalog.
    return { project, etag: etagFor(project) };
  }
  async createGui(id, project, catalogs) {
    const session = this.session(id);
    const guiId = project?.id;
    if (!safeGuiId(guiId)) throw Object.assign(new Error("Invalid GUI ID"), { code: "INVALID_GUI_ID" });
    return this.enqueue(`${id}:${guiId}`, async () => {
      try { await lstat(await this.guiFile(session, guiId)); throw Object.assign(new Error("GUI already exists"), { code: "EXISTS" }); } catch (error) { if (error?.code !== "ENOENT") throw error; }
      const loaded = await catalogs.getVersion(project.catalogVersion);
      if (!loaded) throw Object.assign(new Error("Pinned catalog not found"), { code: "CATALOG_NOT_FOUND" });
      const canonical = validateProject({ ...project, revision: 1, updatedAt: new Date().toISOString() }, loaded.catalog, this.containers);
      await atomicJson(await this.guiFile(session, guiId), canonical, false);
      await atomicJson(await this.metadataFile(session, "gui-index.json"), await this.index(session));
      return { project: canonical, etag: etagFor(canonical) };
    });
  }
  async putGui(id, guiId, project, expectedEtag, catalogs) {
    const session = this.session(id);
    return this.enqueue(`${id}:${guiId}`, async () => {
      const current = await this.readGui(id, guiId);
      if (current.etag !== expectedEtag) throw Object.assign(new Error("GUI changed since it was loaded"), { code: "PRECONDITION" });
      const loaded = await catalogs.getVersion(project.catalogVersion);
      if (!loaded) throw Object.assign(new Error("Pinned catalog not found"), { code: "CATALOG_NOT_FOUND" });
      const canonical = validateProject({ ...project, id: guiId, revision: current.project.revision + 1, updatedAt: new Date().toISOString() }, loaded.catalog, this.containers);
      await atomicJson(await this.guiFile(session, guiId), canonical, true);
      await atomicJson(await this.metadataFile(session, "gui-index.json"), await this.index(session));
      return { project: canonical, etag: etagFor(canonical) };
    });
  }
  async deleteGui(id, guiId, expectedEtag) {
    const session = this.session(id);
    return this.enqueue(`${id}:${guiId}`, async () => {
      const current = await this.readGui(id, guiId);
      if (current.etag !== expectedEtag) throw Object.assign(new Error("GUI changed since it was loaded"), { code: "PRECONDITION" });
      const file = await this.guiFile(session, guiId);
      await rm(file, { force: true });
      await rm(file.replace(/\.json$/, ".bak.json"), { force: true });
      await atomicJson(await this.metadataFile(session, "gui-index.json"), await this.index(session));
      return { success: true };
    });
  }
  disconnect(id) { this.sessions.delete(id); }
  close() { this.sessions.clear(); }
  enqueue(id, operation) {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    const tracked = current.then(() => { if (this.queues.get(id) === tracked) this.queues.delete(id); }, () => { if (this.queues.get(id) === tracked) this.queues.delete(id); });
    this.queues.set(id, tracked);
    return current;
  }
}

export { GUI_ID_RE, WORKSPACE_DIR };
