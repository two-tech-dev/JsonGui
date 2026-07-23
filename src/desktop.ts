export async function pickPluginFolder(): Promise<string | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false, title: "Connect Plugin Project" });
  return typeof selected === "string" ? selected : null;
}
