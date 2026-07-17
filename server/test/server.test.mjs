import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let dataRoot; let server; let base;

beforeEach(async () => {
  dataRoot = await mkdtemp(path.join(tmpdir(), "gui-forge-"));
  const app = await createApp({ dataRoot, distRoot: null, seedFile: path.join(root, "shared", "seed-v1.json") });
  server = createServer(app.handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataRoot, { recursive: true, force: true }); });

async function api(pathname, init) { return fetch(`${base}${pathname}`, init); }

test("loads seed project and returns catalog ETag", async () => {
  const catalog = await api("/api/v1/catalog/current");
  assert.equal(catalog.status, 200); assert.ok(catalog.headers.get("etag"));
  const project = await api("/api/v1/projects/main-menu"); const body = await project.json();
  assert.equal(project.status, 200); assert.deepEqual(body.placements, []); assert.match(body.catalogVersion, /^minecraft-java-1\.21\.8/);
});

test("requires ETag, rejects stale writes, and returns canonical export", async () => {
  const loaded = await api("/api/v1/projects/main-menu"); const etag = loaded.headers.get("etag"); const project = await loaded.json();
  const missing = await api("/api/v1/projects/main-menu", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project) });
  assert.equal(missing.status, 428);
  project.title = "Saved Menu";
  project.placements = [{ slot: 10, itemId: "minecraft:compass", amount: 1, displayName: "Compass", lore: [], prompt: "", action: { type: "prompt_only" } }];
  const saved = await api("/api/v1/projects/main-menu", { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": etag }, body: JSON.stringify(project) });
  assert.equal(saved.status, 200); const savedBody = await saved.json(); const savedEtag = saved.headers.get("etag");
  const stale = await api("/api/v1/projects/main-menu", { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": etag }, body: JSON.stringify(project) });
  assert.equal(stale.status, 412);
  const exported = await api("/api/v1/projects/main-menu/export"); const json = await exported.json();
  assert.equal(exported.status, 200); assert.equal(json.format, "gui-forge/minecraft-java-gui"); assert.equal(json.container.slots, 54); assert.deepEqual(json.items.map((entry) => entry.slot), [10]);
});

test("rejects duplicate slots and leaves saved project untouched", async () => {
  const loaded = await api("/api/v1/projects/main-menu"); const etag = loaded.headers.get("etag"); const project = await loaded.json();
  project.placements.push({ slot: 0, itemId: "minecraft:compass", amount: 1, displayName: "Compass", lore: [], prompt: "", action: { type: "prompt_only" } }, { slot: 0, itemId: "minecraft:compass", amount: 1, displayName: "Compass", lore: [], prompt: "", action: { type: "prompt_only" } });
  const invalid = await api("/api/v1/projects/main-menu", { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": etag }, body: JSON.stringify(project) });
  assert.equal(invalid.status, 422);
  const disk = JSON.parse(await readFile(path.join(dataRoot, "projects", "main-menu.json"), "utf8"));
  assert.equal(disk.placements.length, 0);
});

test("supports projects list, creation, updates, and deletion", async () => {
  const catalog = await (await api("/api/v1/catalog/current")).json();
  const listBefore = await (await api("/api/v1/projects")).json();
  assert.ok(Array.isArray(listBefore));
  assert.equal(listBefore.length, 1);
  assert.equal(listBefore[0].id, "main-menu");

  const newProj = {
    schemaVersion: 1,
    id: "survival-shop",
    catalogVersion: catalog.version,
    title: "Survival Shop",
    description: "Shop for players",
    containerId: "double-chest",
    itemDefaults: {},
    placements: []
  };

  const created = await api("/api/v1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newProj) });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  const createdEtag = created.headers.get("etag");

  const listAfter = await (await api("/api/v1/projects")).json();
  assert.equal(listAfter.length, 2);

  const deletedSeed = await api("/api/v1/projects/main-menu", { method: "DELETE", headers: { "If-Match": "\"some-etag\"" } });
  assert.equal(deletedSeed.status, 403);

  const deletedWithoutEtag = await api("/api/v1/projects/survival-shop", { method: "DELETE" });
  assert.equal(deletedWithoutEtag.status, 428);

  const deletedWithStaleEtag = await api("/api/v1/projects/survival-shop", { method: "DELETE", headers: { "If-Match": "\"stale-etag\"" } });
  assert.equal(deletedWithStaleEtag.status, 412);

  const deleted = await api("/api/v1/projects/survival-shop", { method: "DELETE", headers: { "If-Match": createdEtag } });
  assert.equal(deleted.status, 200);

  const listFinal = await (await api("/api/v1/projects")).json();
  assert.equal(listFinal.length, 1);
});

