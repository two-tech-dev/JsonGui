import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { normalizeRows, parseItemHtml } from "../scripts/refresh-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("parses Java registry IDs from local fixture without executing scripts", async () => {
  delete globalThis.compromised;
  const html = await readFile(path.join(root, "server", "test", "fixtures", "item-table.html"), "utf8");
  const catalog = normalizeRows(parseItemHtml(html), { minecraftVersion: "1.21.8", revisionId: 123, revisionTimestamp: "2026-07-17T00:00:00.000Z" });
  assert.equal(globalThis.compromised, undefined);
  assert.deepEqual(catalog.items.map((entry) => entry.id), ["minecraft:barrier", "minecraft:compass", "minecraft:diamond"]);
  assert.equal(catalog.items.find((entry) => entry.id === "minecraft:compass")?.maxStack, 1);
  assert.equal(catalog.items.find((entry) => entry.id === "minecraft:compass")?.material, "COMPASS");
  assert.match(catalog.version, /^minecraft-java-1\.21\.8-fandom-r123-/);
});
