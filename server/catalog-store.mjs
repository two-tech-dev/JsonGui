import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { etagFor, validateCatalog } from "./schema.mjs";

async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }
async function atomicJson(file, value) { await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); await rename(temp, file); }

export class CatalogStore {
  constructor({ root, seed }) { this.root = root; this.seed = seed; this.versionsDir = path.join(root, "catalog", "versions"); this.currentFile = path.join(root, "catalog", "current.json"); }
  async initialize() {
    await mkdir(this.versionsDir, { recursive: true });
    const seedFile = path.join(this.versionsDir, `${this.seed.version}.json`);
    let seedCatalog;
    try { seedCatalog = validateCatalog(await readJson(seedFile), { allowEmpty: true }); } catch { seedCatalog = validateCatalog(this.seed, { allowEmpty: true }); await atomicJson(seedFile, seedCatalog); }
    try {
      const current = await this.getCurrent();
      if (!current || (seedCatalog.items.length > 0 && current.catalog.items.length === 0)) await atomicJson(this.currentFile, { version: seedCatalog.version });
    } catch { await atomicJson(this.currentFile, { version: seedCatalog.version }); }
  }
  async getCurrent() { const pointer = await readJson(this.currentFile); return this.getVersion(pointer.version); }
  async getVersion(version) { if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(version)) return null; try { const catalog = validateCatalog(await readJson(path.join(this.versionsDir, `${version}.json`)), { allowEmpty: true }); return { catalog, etag: etagFor(catalog) }; } catch { return null; } }
  async promote(catalog) { validateCatalog(catalog); const versionFile = path.join(this.versionsDir, `${catalog.version}.json`); let existing; try { existing = validateCatalog(await readJson(versionFile)); } catch { await atomicJson(versionFile, catalog); } if (existing && JSON.stringify(existing) !== JSON.stringify(catalog)) throw new Error(`Catalog version already exists with different contents: ${catalog.version}`); await atomicJson(this.currentFile, { version: catalog.version }); return { catalog, etag: etagFor(catalog) }; }
}
