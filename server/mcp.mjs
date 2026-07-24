import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { CatalogStore } from "./catalog-store.mjs";
import { ProjectStore } from "./project-store.mjs";
import { ValidationError, canonicalExport } from "./schema.mjs";
import { JsonSkillStore } from "./json-skill-store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.resolve(process.env.GUI_FORGE_DATA_ROOT ?? path.join(root, "data"));
const seedFile = path.resolve(process.env.GUI_FORGE_SEED_FILE ?? path.join(root, "shared", "seed-v1.json"));
const seed = JSON.parse(await readFile(seedFile, "utf8"));
const jsonSkills = new JsonSkillStore({ root: path.resolve(process.env.GUI_FORGE_JSON_SKILL_ROOT ?? path.join(root, "JsonSkill")) });
const catalogs = new CatalogStore({ root: dataRoot, seed: seed.catalog });
await catalogs.initialize();
const projects = new ProjectStore({ root: dataRoot, seed: seed.project, catalogs, containers: seed.containers, jsonSkills });
await projects.initialize();

const tools = [
  { name: "projects_list", description: "List JsonGui projects", inputSchema: { type: "object", additionalProperties: false } },
  { name: "projects_get", description: "Get editable JsonGui project, ETag, and selected JsonSkill instructions when configured", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "projects_create", description: "Create validated JsonGui project; selected JsonSkill guides safe Minecraft GUI layout", inputSchema: { type: "object", properties: { document: { type: "object" } }, required: ["document"], additionalProperties: false } },
  { name: "projects_update", description: "Replace complete project using ETag from projects_get; selected JsonSkill instructions are returned", inputSchema: { type: "object", properties: { id: { type: "string" }, document: { type: "object" }, etag: { type: "string" } }, required: ["id", "document", "etag"], additionalProperties: false } },
  { name: "projects_patch", description: "Patch project fields or items by slot using ETag; use this for small changes without resending complete GUI", inputSchema: { type: "object", properties: { id: { type: "string" }, etag: { type: "string" }, patch: { type: "object", properties: { project: { type: "object" }, items: { type: "array", items: { type: "object" } }, removeSlots: { type: "array", items: { type: "integer" } } }, additionalProperties: false } }, required: ["id", "etag", "patch"], additionalProperties: false } },
  { name: "projects_export", description: "Export canonical GUI JSON and selected JsonSkill instructions without changing canonical export", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "catalog_get", description: "Get Minecraft item catalog for valid materials and containers", inputSchema: { type: "object", properties: { version: { type: "string" } }, additionalProperties: false } },
];

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("Arguments must be an object"), { code: "INVALID_ARGUMENTS" });
  return value;
}

async function withJsonSkill(result) { const project = result.project; return project?.jsonSkillId ? { ...result, jsonSkill: await jsonSkills.get(project.jsonSkillId) } : result; }

async function callTool(name, rawArguments) {
  const args = requireObject(rawArguments ?? {});
  if (name === "projects_list") return { projects: await projects.list() };
  if (name === "projects_get") return withJsonSkill(await projects.get(args.id));
  if (name === "projects_create") return withJsonSkill(await projects.create(args.document));
  if (name === "projects_update") return withJsonSkill(await projects.put(args.id, args.document, args.etag));
  if (name === "projects_patch") {
    const current = await projects.get(args.id);
    const patch = requireObject(args.patch);
    const document = { ...current.project, ...requireObject(patch.project ?? {}) };
    delete document.id;
    document.id = current.project.id;
    const placements = new Map(current.project.placements.map((item) => [item.slot, item]));
    for (const slot of patch.removeSlots ?? []) placements.delete(slot);
    for (const item of patch.items ?? []) {
      if (!Number.isInteger(item.slot)) throw Object.assign(new Error("Each patched item needs integer slot"), { code: "INVALID_ARGUMENTS" });
      placements.set(item.slot, { ...placements.get(item.slot), ...item });
    }
    document.placements = [...placements.values()];
    return withJsonSkill(await projects.put(args.id, document, args.etag));
  }
  if (name === "projects_export") {
    const loaded = await projects.export(args.id);
    return { export: canonicalExport(loaded.project, loaded.catalog, seed.containers), ...(loaded.project.jsonSkillId ? { jsonSkill: await jsonSkills.get(loaded.project.jsonSkillId) } : {}) };
  }
  if (name === "catalog_get") {
    const loaded = args.version ? await catalogs.getVersion(args.version) : await catalogs.getCurrent();
    if (!loaded) throw Object.assign(new Error("Catalog not found"), { code: "CATALOG_NOT_FOUND" });
    return loaded;
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: "TOOL_NOT_FOUND" });
}

function toolResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function toolError(error) {
  const code = error instanceof ValidationError ? "VALIDATION_FAILED" : error?.code === "ENOENT" ? "NOT_FOUND" : error?.code ?? "INTERNAL_ERROR";
  return { content: [{ type: "text", text: JSON.stringify({ code, message: error?.message ?? "Unknown error", ...(error?.issues ? { issues: error.issues } : {}) }) }], isError: true };
}

async function handle(message) {
  if (message.method === "notifications/initialized") return null;
  if (message.method === "initialize") return { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "jsongui", version: "0.1.1" } };
  if (message.method === "ping") return {};
  if (message.method === "tools/list") return { tools };
  if (message.method === "tools/call") {
    try { return toolResult(await callTool(message.params?.name, message.params?.arguments)); }
    catch (error) { return toolError(error); }
  }
  throw Object.assign(new Error(`Method not found: ${message.method}`), { rpcCode: -32601 });
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  let message;
  try {
    message = JSON.parse(line);
    const result = await handle(message);
    if (message.id !== undefined && result !== null) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
  } catch (error) {
    if (message?.id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: error?.rpcCode ?? -32603, message: error?.message ?? "Internal error" } })}\n`);
    process.stderr.write(`${error?.stack ?? error}\n`);
  }
}
