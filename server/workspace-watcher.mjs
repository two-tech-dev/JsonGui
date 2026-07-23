import { watch } from "node:fs";
import path from "node:path";
import { isIgnoredPath } from "./plugin-scanner.mjs";

const WATCH_FILES = new Set(["build.gradle", "build.gradle.kts", "pom.xml", "settings.gradle", "settings.gradle.kts"]);
const WATCH_METADATA = new Set(["plugin.yml", "paper-plugin.yml", "bungee.yml", "velocity-plugin.json"]);

export class WorkspaceWatcher {
  constructor({ root, sourceRoots = [], resourceRoot, onChange, debounceMs = 160 }) {
    this.root = root;
    this.sourceRoots = sourceRoots;
    this.resourceRoot = resourceRoot;
    this.onChange = onChange;
    this.debounceMs = debounceMs;
    this.watchers = [];
    this.pending = new Map();
    this.timer = null;
  }
  start() {
    const dirs = new Set([this.root, ...this.sourceRoots.map((entry) => path.join(this.root, entry)), ...(this.resourceRoot ? [path.join(this.root, this.resourceRoot)] : [])]);
    for (const directory of dirs) {
      try {
        const handle = watch(directory, { persistent: false }, (eventType, filename) => {
          const target = filename ? path.relative(this.root, path.join(directory, filename.toString())) : "";
          this.queue(eventType, target);
        });
        handle.on("error", () => {});
        this.watchers.push(handle);
      } catch { /* missing roots are reported by scanner */ }
    }
    return this;
  }
  queue(eventType, name) {
    const relative = name ? path.relative(this.root, path.resolve(this.root, name)).split(path.sep).join("/") : "";
    if (!relative || isIgnoredPath(relative)) return;
    const base = path.basename(relative);
    if (!WATCH_FILES.has(base) && !WATCH_METADATA.has(base) && !relative.startsWith("src/main/")) return;
    this.pending.set(relative, { path: relative, kind: eventType === "rename" ? "rename" : "change" });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const changes = [...this.pending.values()];
      this.pending.clear();
      this.timer = null;
      if (changes.length) this.onChange({ type: "workspace.changed", changes });
    }, this.debounceMs);
  }
  close() {
    clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    for (const handle of this.watchers) handle.close();
    this.watchers = [];
  }
}
