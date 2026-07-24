import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_FILES = 16;
const MAX_FILE_BYTES = 32 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024;

function forbidden(message) { return Object.assign(new Error(message), { code: "JSON_SKILL_INVALID" }); }

export class JsonSkillStore {
  constructor({ root }) { this.root = path.resolve(root); }
  async directory(id) {
    if (typeof id !== "string" || !ID_RE.test(id)) throw forbidden("Invalid JsonSkill ID");
    const directory = path.join(this.root, id);
    const info = await lstat(directory).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (!info || !info.isDirectory() || info.isSymbolicLink()) throw Object.assign(new Error("JsonSkill was not found"), { code: "JSON_SKILL_NOT_FOUND" });
    const realRoot = await realpath(this.root);
    const realDirectory = await realpath(directory);
    if (path.relative(realRoot, realDirectory).startsWith("..") || path.isAbsolute(path.relative(realRoot, realDirectory))) throw forbidden("JsonSkill path escapes root");
    return directory;
  }
  async files(id) {
    const directory = await this.directory(id);
    const entries = await readdir(directory, { withFileTypes: true });
    const names = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
    if (names.length > MAX_FILES) throw forbidden("JsonSkill has too many markdown files");
    let total = 0;
    const files = [];
    for (const name of names) {
      const file = path.join(directory, name);
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) throw forbidden("JsonSkill markdown file is invalid or too large");
      total += info.size;
      if (total > MAX_TOTAL_BYTES) throw forbidden("JsonSkill is too large");
      files.push({ name, bytes: info.size, file });
    }
    return files;
  }
  async list() {
    const entries = await readdir(this.root, { withFileTypes: true }).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
    const skills = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !ID_RE.test(entry.name)) continue;
      try { const files = await this.files(entry.name); skills.push({ id: entry.name, files: files.map(({ name, bytes }) => ({ name, bytes })), fileCount: files.length, bytes: files.reduce((total, file) => total + file.bytes, 0) }); } catch { }
    }
    return skills.sort((a, b) => a.id.localeCompare(b.id));
  }
  async get(id) {
    const files = await this.files(id);
    const content = (await Promise.all(files.map(async ({ name, bytes, file }) => ({ name, bytes, content: await readFile(file, "utf8") })))).map(({ name, bytes, content }) => ({ name, bytes, content }));
    return { id, files: content.map(({ name, bytes }) => ({ name, bytes })), content: content.map(({ name, content: text }) => `# ${name}\n\n${text}`).join("\n\n") };
  }
  async exists(id) { try { await this.directory(id); return true; } catch (error) { if (error.code === "JSON_SKILL_NOT_FOUND") return false; throw error; } }
}

export { ID_RE, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES };
