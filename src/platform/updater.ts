export interface UpdateInfo {
  currentVersion: string;
  version: string;
  notes?: string;
  date?: string;
}

export type UpdateProgress = { phase: "downloading"; percent?: number } | { phase: "installing" };

const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function canCheckForUpdates() {
  return isDesktop;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isDesktop) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 10_000 });
  if (!update) return null;
  const { currentVersion, version, body, date } = update;
  return { currentVersion, version, notes: body, date };
}

export async function downloadInstallAndRelaunch(onProgress: (progress: UpdateProgress) => void) {
  if (!isDesktop) throw new Error("Cập nhật chỉ hỗ trợ trong JsonGui Desktop.");
  const [{ check }, { relaunch }] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process"),
  ]);
  const update = await check({ timeout: 10_000 });
  if (!update) return false;
  let downloaded = 0;
  let contentLength: number | undefined;
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        downloaded = 0;
        contentLength = event.data.contentLength;
        onProgress({ phase: "downloading", percent: contentLength ? 0 : undefined });
      }
      if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        onProgress({ phase: "downloading", percent: contentLength ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : undefined });
      }
      if (event.event === "Finished") onProgress({ phase: "installing" });
    }, { timeout: 120_000 });

    await relaunch();
    return true;
  } finally {
    await update.close();
  }
}
