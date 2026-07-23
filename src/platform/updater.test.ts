import { describe, expect, it } from "vitest";
import { canCheckForUpdates, checkForUpdate } from "./updater";

describe("desktop updater adapter", () => {
  it("does nothing in browser mode", async () => {
    expect(canCheckForUpdates()).toBe(false);
    await expect(checkForUpdate()).resolves.toBeNull();
  });
});
