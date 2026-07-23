import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, afterEach } from "node:test";
import { WorkspaceStore } from "../workspace-store.mjs";
import { CatalogStore } from "../catalog-store.mjs";
import { validateProject } from "../schema.mjs";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots = [];
async function pluginFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "jsongui-workspace-plugin-")); roots.push(root);
  await mkdir(path.join(root, "src/main/java/dev/example"), { recursive: true });
  await mkdir(path.join(root, "src/main/resources"), { recursive: true });
  await writeFile(path.join(root, "build.gradle"), "plugins { id 'java' }\ndependencies { compileOnly 'io.papermc.paper:paper-api:1.21.8' }");
  await writeFile(path.join(root, "src/main/resources/plugin.yml"), "name: Fixture\nmain: dev.example.Main\n");
  await writeFile(path.join(root, "src/main/java/dev/example/Main.java"), "package dev.example; class Main extends JavaPlugin {}");
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

test("initializes relative .jsongui workspace and GUI ETags", async () => {
  const plugin = await pluginFixture();
  const data = await mkdtemp(path.join(tmpdir(), "jsongui-workspace-data-")); roots.push(data);
  const seed = JSON.parse(await readFile(path.join(repo, "shared/seed-v1.json"), "utf8"));
  const catalogs = new CatalogStore({ root: data, seed: seed.catalog }); await catalogs.initialize();
  const store = new WorkspaceStore({ containers: seed.containers });
  const connected = await store.connect(plugin);
  assert.equal(connected.workspaceId.length, 32);
  assert.equal(connected.workspace.rootPath, undefined);
  assert.equal(connected.manifest.mainClass, "dev.example.Main");
  const workspace = JSON.parse(await readFile(path.join(plugin, ".jsongui/workspace.json"), "utf8"));
  assert.equal(workspace.sourceRoots[0], "src/main/java");
  assert.equal(JSON.stringify(workspace).includes(plugin), false);

  const project = { ...seed.project, id: "main-menu", catalogVersion: seed.catalog.version };
  const created = await store.createGui(connected.workspaceId, project, catalogs);
  assert.ok(created.etag);
  const read = await store.readGui(connected.workspaceId, "main-menu");
  assert.deepEqual(read.project.placements, []);
  await assert.rejects(() => store.putGui(connected.workspaceId, "main-menu", { ...project, title: "stale" }, '"bad"', catalogs), (error) => error.code === "PRECONDITION");
  const disk = JSON.parse(await readFile(path.join(plugin, ".jsongui/guis/main-menu.json"), "utf8"));
  assert.equal(disk.title, seed.project.title);
});
