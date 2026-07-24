import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { JsonSkillStore } from "../json-skill-store.mjs";

test("JsonSkillStore lists and combines sorted nonrecursive markdown", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "json-skill-"));
  await mkdir(path.join(root, "minecraft-standard", "nested"), { recursive: true });
  await writeFile(path.join(root, "minecraft-standard", "b.md"), "B");
  await writeFile(path.join(root, "minecraft-standard", "a.md"), "A");
  await writeFile(path.join(root, "minecraft-standard", "nested", "ignored.md"), "ignored");
  const store = new JsonSkillStore({ root });
  assert.deepEqual((await store.list()).map((skill) => skill.id), ["minecraft-standard"]);
  const skill = await store.get("minecraft-standard");
  assert.deepEqual(skill.files.map((file) => file.name), ["a.md", "b.md"]);
  assert.ok(skill.content.indexOf("A") < skill.content.indexOf("B"));
  await rm(root, { recursive: true, force: true });
});

test("JsonSkillStore rejects invalid IDs, symlinks, and limits", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "json-skill-"));
  const outside = await mkdtemp(path.join(tmpdir(), "json-skill-outside-"));
  const store = new JsonSkillStore({ root });
  await assert.rejects(store.get("../outside"), /Invalid JsonSkill ID/);
  await symlink(outside, path.join(root, "linked"), "junction");
  await assert.rejects(store.get("linked"), /not found/);
  await mkdir(path.join(root, "large"));
  await writeFile(path.join(root, "large", "large.md"), Buffer.alloc(32 * 1024 + 1));
  await assert.rejects(store.get("large"), /too large/);
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});
