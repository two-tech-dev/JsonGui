import { describe, expect, it } from "vitest";
import { defaultWorkspaceGui, hasAbsolutePath, workspaceGuiIdFromTitle, workspaceStorageKey, withoutRootPath } from "./workspace";

describe("workspace domain", () => {
  it("removes root paths from plugin metadata", () => {
    const safe = withoutRootPath({ rootPath: "C:\\MagicHeroes", projectName: "MagicHeroes" });
    expect(safe).toEqual({ projectName: "MagicHeroes" });
    expect(hasAbsolutePath(safe)).toBe(false);
    expect(hasAbsolutePath({ rootPath: "C:\\MagicHeroes" })).toBe(true);
  });

  it("creates stable GUI IDs and valid empty GUI documents", () => {
    expect(workspaceGuiIdFromTitle("Main Menu !")).toBe("main-menu");
    expect(workspaceStorageKey("abc", "active-gui")).toBe("jsongui:workspace:abc:active-gui");
    expect(defaultWorkspaceGui("main-menu", "catalog-v1")).toMatchObject({ id: "main-menu", catalogVersion: "catalog-v1", placements: [] });
  });
});
