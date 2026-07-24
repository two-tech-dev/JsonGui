import { copyFile, mkdir, open, readFile, rename, unlink, readdir } from "node:fs/promises";
import path from "node:path";
import { etagFor, ValidationError, validateProject } from "./schema.mjs";

async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }
async function atomicJson(file, value, backup = true) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temp, "wx");
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
  if (backup) { try { await copyFile(file, file.replace(/\.json$/, ".bak.json")); } catch { /* first write */ } }
  try { await rename(temp, file); } catch (error) { try { await unlink(temp); } catch { /* cleanup only */ } throw error; }
}
function catalogVersion(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new ValidationError("Project must be an object", [{ path: "project", message: "Must be an object" }]);
  if (typeof document.catalogVersion !== "string") throw new ValidationError("Project validation failed", [{ path: "catalogVersion", message: "Must be a string" }]);
  return document.catalogVersion;
}
function documentId(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new ValidationError("Project must be an object", [{ path: "project", message: "Must be an object" }]);
  return document.id;
}

export class ProjectStore {
  constructor({ root, seed, catalogs, containers, jsonSkills }) { this.root = root; this.seed = seed; this.catalogs = catalogs; this.containers = containers; this.jsonSkills = jsonSkills; this.projectsDir = path.join(root, "projects"); this.queues = new Map(); }
  async validateJsonSkill(project) { if (project.jsonSkillId && this.jsonSkills && !(await this.jsonSkills.exists(project.jsonSkillId))) throw new ValidationError("Project validation failed", [{ path: "jsonSkillId", message: "JsonSkill was not found" }]); }
  file(id) { return path.join(this.projectsDir, `${id}.json`); }
  async initialize() {
    await mkdir(this.projectsDir, { recursive: true });
    try {
      await this.get(this.seed.id);
    }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const loaded = await this.catalogs.getVersion(this.seed.catalogVersion);
      if (!loaded) throw Object.assign(new Error("Seed catalog not found"), { code: "CATALOG_NOT_FOUND" });
      await atomicJson(this.file(this.seed.id), validateProject(this.seed, loaded.catalog, this.containers), false);
    }
  }
  async get(id) {
    const file = this.file(id); let project;
    try { project = await readJson(file); }
    catch (error) {
      if (error?.code !== "ENOENT" || id !== this.seed.id) throw error;
      try { project = await readJson(file.replace(/\.json$/, ".bak.json")); } catch { throw error; }
    }
    const loaded = await this.catalogs.getVersion(catalogVersion(project));
    if (!loaded) throw Object.assign(new Error("Pinned catalog not found"), { code: "CATALOG_NOT_FOUND" });
    const canonical = validateProject(project, loaded.catalog, this.containers);
    return { project: canonical, etag: etagFor(canonical) };
  }
  async list() {
    try {
      const files = await readdir(this.projectsDir);
      const list = [];
      for (const name of files) {
        if (!name.endsWith(".json") || name.endsWith(".bak.json")) continue;
        try {
          const projectData = await readJson(path.join(this.projectsDir, name));
          list.push({
            id: projectData.id,
            title: projectData.title,
            description: projectData.description ?? "",
            catalogVersion: projectData.catalogVersion,
            containerId: projectData.containerId,
            placementsCount: (projectData.placements ?? []).length,
            updatedAt: projectData.updatedAt
          });
        } catch { /* skip corrupted file from listing */ }
      }
      return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } catch { return []; }
  }
  async create(document) {
    const id = documentId(document); const version = catalogVersion(document);
    return this.enqueue(id, async () => {
      try { await readFile(this.file(id)); throw Object.assign(new Error("Project already exists"), { code: "EXISTS" }); } catch (error) { if (error?.code !== "ENOENT") throw error; }
      const loaded = await this.catalogs.getVersion(version);
      if (!loaded) throw Object.assign(new Error("Pinned catalog not found"), { code: "CATALOG_NOT_FOUND" });
      await this.validateJsonSkill(document);
      const project = validateProject({ ...document, revision: 1, updatedAt: new Date().toISOString() }, loaded.catalog, this.containers);
      await atomicJson(this.file(project.id), project, false);
      return { project, etag: etagFor(project) };
    });
  }
  async put(id, document, expectedEtag) {
    const version = catalogVersion(document);
    return this.enqueue(id, async () => {
      const current = await this.get(id);
      if (current.etag !== expectedEtag) throw Object.assign(new Error("Project changed since it was loaded"), { code: "PRECONDITION" });
      const loaded = await this.catalogs.getVersion(version);
      if (!loaded) throw Object.assign(new Error("Pinned catalog not found"), { code: "CATALOG_NOT_FOUND" });
      await this.validateJsonSkill(document);
      const project = validateProject({ ...document, id, revision: current.project.revision + 1, updatedAt: new Date().toISOString() }, loaded.catalog, this.containers);
      await atomicJson(this.file(id), project);
      return { project, etag: etagFor(project) };
    });
  }
  async delete(id, expectedEtag) {
    if (id === this.seed.id) throw Object.assign(new Error("Cannot delete seed project"), { code: "FORBIDDEN" });
    return this.enqueue(id, async () => {
      const current = await this.get(id);
      if (current.etag !== expectedEtag) throw Object.assign(new Error("Project changed since it was loaded"), { code: "PRECONDITION" });
      await unlink(this.file(id));
      try { await unlink(this.file(id).replace(/\.json$/, ".bak.json")); } catch { /* ignore backup delete error */ }
      return { success: true };
    });
  }
  enqueue(id, operation) {
    const previous = this.queues.get(id) ?? Promise.resolve(); const current = previous.catch(() => {}).then(operation);
    const tracked = current.then(() => { if (this.queues.get(id) === tracked) this.queues.delete(id); }, () => { if (this.queues.get(id) === tracked) this.queues.delete(id); });
    this.queues.set(id, tracked); return current;
  }
  async export(id) { const { project } = await this.get(id); const loaded = await this.catalogs.getVersion(project.catalogVersion); return { project, catalog: loaded.catalog }; }
}
