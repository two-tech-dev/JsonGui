import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const processes = [
  spawn(process.execPath, [path.join(root, "index.mjs")], { stdio: "inherit" }),
  spawn(process.execPath, [path.join(root, "..", "node_modules", "vite", "bin", "vite.js")], { stdio: "inherit" }),
];

let shuttingDown = false;
const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of processes) child.kill();
  process.exitCode = code;
};

for (const child of processes) {
  child.once("error", () => shutdown(1));
  child.once("exit", (code) => {
    if (!shuttingDown && code !== 0) shutdown(code ?? 1);
  });
}

process.once("SIGINT", () => shutdown());
process.once("SIGTERM", () => shutdown());
