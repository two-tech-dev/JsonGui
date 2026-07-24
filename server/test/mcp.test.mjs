import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("MCP initializes, lists tools, and reads project", async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "jsongui-mcp-"));
  const child = spawn(process.execPath, [path.join(root, "server", "mcp.mjs")], { cwd: root, env: { ...process.env, GUI_FORGE_DATA_ROOT: dataRoot }, stdio: ["pipe", "pipe", "pipe"] });
  const responses = [];
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
    const lines = output.split("\n");
    output = lines.pop();
    for (const line of lines) if (line) responses.push(JSON.parse(line));
  });
  const send = (id, method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`);
  const waitFor = async (id) => {
    while (!responses.some((entry) => entry.id === id)) await new Promise((resolve) => setTimeout(resolve, 10));
    return responses.find((entry) => entry.id === id);
  };
  send(1, "initialize", {});
  assert.equal((await waitFor(1)).result.serverInfo.name, "jsongui");
  send(2, "tools/list", {});
    assert.ok((await waitFor(2)).result.tools.some((tool) => tool.name === "projects_patch"));
  send(3, "tools/call", { name: "projects_get", arguments: { id: "main-menu" } });
  const loaded = (await waitFor(3)).result.structuredContent;
  assert.equal(loaded.project.id, "main-menu");
  loaded.project.jsonSkillId = "minecraft-standard";
  send(4, "tools/call", { name: "projects_update", arguments: { id: "main-menu", document: loaded.project, etag: loaded.etag } });
  const updated = (await waitFor(4)).result.structuredContent;
  assert.match(updated.jsonSkill.content, /Accessibility/);
  send(5, "tools/call", { name: "projects_patch", arguments: { id: "main-menu", etag: updated.etag, patch: { project: { title: "Patched" } } } });
  const patched = (await waitFor(5)).result.structuredContent;
  assert.equal(patched.project.title, "Patched");
  send(6, "tools/call", { name: "projects_export", arguments: { id: "main-menu" } });
  const exported = (await waitFor(6)).result.structuredContent;
  assert.equal(exported.export.format, "gui-forge/minecraft-java-gui");
  assert.equal("jsonSkillId" in exported.export, false);
  assert.match(exported.jsonSkill.content, /Safety/);
  child.stdin.end();
  await once(child, "exit");
  await rm(dataRoot, { recursive: true, force: true });
});
