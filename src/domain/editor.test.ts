import { describe, expect, it } from "vitest";
import { CONTAINERS, FALLBACK_ITEMS, buildExport, canonicalExportToProject, getFilteredItems, initialState, isValidContainerSlot, reducer, trimForContainer } from "./editor";

describe("GUI Forge editor domain", () => {
  it("starts with an empty demo-free project and no fake fallback catalog", () => {
    expect(FALLBACK_ITEMS).toHaveLength(0);
    expect(Object.keys(initialState.placements)).toHaveLength(0);
    expect(initialState.itemDefaults).toEqual({});
  });

  it("validates container slots and trims outside range", () => {
    expect(isValidContainerSlot(0, CONTAINERS[0])).toBe(true);
    expect(isValidContainerSlot(54, CONTAINERS[0])).toBe(false);
    const placements = { 10: { slot: 10, itemId: "minecraft:compass", amount: 1, displayName: "Compass", lore: [], action: { type: "prompt_only" as const } }, 40: { slot: 40, itemId: "minecraft:paper", amount: 1, displayName: "Paper", lore: [], action: { type: "prompt_only" as const } } };
    expect(Object.keys(trimForContainer(placements, CONTAINERS[1])).map(Number)).toEqual([10]);
  });

  it("exports sorted valid JSON without preview-only player inventory", () => {
    const state = { ...initialState, catalog: [{ id: "minecraft:compass", name: "Compass", material: "COMPASS", category: "Tools" as const, icon: "compass", maxStack: 1, description: "" }], placements: { 10: { slot: 10, itemId: "minecraft:compass", amount: 1, displayName: "Compass", lore: [], action: { type: "prompt_only" as const } } } };
    const json = JSON.parse(buildExport(state)) as { cancelItemMovement: boolean; container: { bukkitType: string; slots: number }; items: Array<{ slot: number; material: string }> };
    expect(json.cancelItemMovement).toBe(true);
    expect(json.container.bukkitType).toBe("CHEST");
    expect(json.items.map((entry) => entry.slot)).toEqual([10]);
    expect(json.items[0]).not.toHaveProperty("prompt");
  });

  it("imports canonical JSON export into current project metadata", () => {
    const catalog = [{ id: "minecraft:allay_spawn_egg", name: "Allay Spawn Egg", material: "ALLAY_SPAWN_EGG", category: "Utility" as const, icon: "allay_spawn_egg", maxStack: 64, description: "" }];
    const project = canonicalExportToProject({ format: "gui-forge/minecraft-java-gui", formatVersion: 1, catalogVersion: "catalog-v1", container: { id: "single-chest", bukkitType: "CHEST", rows: 3, slots: 27 }, title: "Cac", items: [{ slot: 20, itemId: "minecraft:allay_spawn_egg", material: "ALLAY_SPAWN_EGG", amount: 1, displayName: "Allay Spawn Egg", lore: [], action: { type: "prompt_only" } }] }, { id: "main-menu", revision: 4, description: "Menu chính" }, catalog);
    expect(project).toMatchObject({ schemaVersion: 1, id: "main-menu", revision: 4, catalogVersion: "catalog-v1", title: "Cac", containerId: "single-chest", itemDefaults: {} });
    expect(project.placements).toEqual([expect.objectContaining({ slot: 20, includeInExport: true })]);
    expect(project.placements[0]).not.toHaveProperty("prompt");
  });

  it("rejects invalid canonical export items", () => {
    const catalog = [{ id: "minecraft:allay_spawn_egg", name: "Allay Spawn Egg", material: "ALLAY_SPAWN_EGG", category: "Utility" as const, icon: "allay_spawn_egg", maxStack: 1, description: "" }];
    const source = { format: "gui-forge/minecraft-java-gui", formatVersion: 1, catalogVersion: "catalog-v1", container: { id: "single-chest", bukkitType: "CHEST", rows: 3, slots: 27 }, title: "Cac", items: [{ slot: 27, itemId: "minecraft:allay_spawn_egg", material: "ALLAY_SPAWN_EGG", amount: 2, displayName: "Allay Spawn Egg", lore: [], action: { type: "prompt_only" } }] };
    expect(() => canonicalExportToProject(source, { id: "main-menu", revision: 1, description: "" }, catalog)).toThrow("Slot 1 không hợp lệ");
  });

  it("rejects canonical material, amount, duplicate slot, and unknown item errors", () => {
    const catalog = [{ id: "minecraft:allay_spawn_egg", name: "Allay Spawn Egg", material: "ALLAY_SPAWN_EGG", category: "Utility" as const, icon: "allay_spawn_egg", maxStack: 1, description: "" }];
    const base = { format: "gui-forge/minecraft-java-gui", formatVersion: 1, catalogVersion: "catalog-v1", container: { id: "single-chest", bukkitType: "CHEST", rows: 3, slots: 27 }, title: "Cac" };
    const item = { slot: 2, itemId: "minecraft:allay_spawn_egg", material: "ALLAY_SPAWN_EGG", amount: 1, displayName: "Allay Spawn Egg", lore: [], action: { type: "prompt_only" } };
    const convert = (items: unknown[], itemsCatalog = catalog) => canonicalExportToProject({ ...base, items }, { id: "main-menu", revision: 1, description: "" }, itemsCatalog);
    expect(() => convert([{ ...item, material: "DIAMOND" }])).toThrow("Material");
    expect(() => convert([{ ...item, amount: 2 }])).toThrow("Số lượng");
    expect(() => convert([item, item])).toThrow("trùng");
    expect(() => convert([{ ...item, itemId: "minecraft:missing", material: "MISSING" }], [])).toThrow("không có trong catalog");
  });

  it("rejects canonical action material outside catalog", () => {
    const catalog = [{ id: "minecraft:allay_spawn_egg", name: "Allay Spawn Egg", material: "ALLAY_SPAWN_EGG", category: "Utility" as const, icon: "allay_spawn_egg", maxStack: 64, description: "" }];
    const source = { format: "gui-forge/minecraft-java-gui", formatVersion: 1, catalogVersion: "catalog-v1", container: { id: "single-chest", bukkitType: "CHEST", rows: 3, slots: 27 }, title: "Cac", items: [{ slot: 2, itemId: "minecraft:allay_spawn_egg", material: "ALLAY_SPAWN_EGG", amount: 1, displayName: "Allay Spawn Egg", lore: [], action: { type: "give_item", material: "DIAMOND", amount: 1 } }] };
    expect(() => canonicalExportToProject(source, { id: "main-menu", revision: 1, description: "" }, catalog)).toThrow("Action material");
  });

  it("filters full catalog by registry ID and favorites/recent tabs", () => {
    const catalog = [{ id: "minecraft:diamond", name: "Diamond", material: "DIAMOND", category: "Misc" as const, icon: "minecraft:diamond", maxStack: 64, description: "" }, { id: "minecraft:bread", name: "Bread", material: "BREAD", category: "Food" as const, icon: "minecraft:bread", maxStack: 64, description: "" }];
    expect(getFilteredItems({ ...initialState, catalog, query: "minecraft:diamond" }).map((item) => item.id)).toEqual(["minecraft:diamond"]);
    expect(getFilteredItems({ ...initialState, catalog, libraryTab: "Favorites", favorites: ["minecraft:bread"] }).map((item) => item.id)).toEqual(["minecraft:bread"]);
  });

  it("keeps external canonical imports dirty", () => {
    const project = { schemaVersion: 1 as const, id: "main-menu", revision: 1, catalogVersion: "catalog-v1", title: "Cac", description: "", containerId: "single-chest", itemDefaults: {}, placements: [], updatedAt: "2026-01-01T00:00:00.000Z" };
    expect(reducer(initialState, { type: "HYDRATE", project, catalog: [], dirty: true }).dirty).toBe(true);
    expect(reducer(initialState, { type: "HYDRATE", project, catalog: [] }).dirty).toBe(false);
  });

  it("keeps drawer drafts local until saving placement details", () => {
    const state = { ...initialState, catalog: [{ id: "minecraft:compass", name: "Compass", material: "COMPASS", category: "Tools" as const, icon: "compass", maxStack: 1, description: "" }], placements: { 10: { slot: 10, itemId: "minecraft:compass", amount: 1, displayName: "Compass", lore: [], action: { type: "prompt_only" as const } } }, editorTarget: { kind: "placement" as const, slot: 10 } };
    const drafted = reducer(state, { type: "SET_DRAFT_LORE", lore: ["Line one"] });
    expect(drafted.dirty).toBe(false);
    const saved = reducer(drafted, { type: "SAVE_ITEM" });
    expect(saved.placements[10].lore).toEqual(["Line one"]);
    expect(saved.dirty).toBe(true);
  });

  it("deletes placed item through reducer", () => {
    const state = { ...initialState, catalog: [{ id: "minecraft:compass", name: "Compass", material: "COMPASS", category: "Tools" as const, icon: "compass", maxStack: 1, description: "" }], placements: { 10: { slot: 10, itemId: "minecraft:compass", amount: 1, displayName: "Compass", lore: [], action: { type: "prompt_only" as const } } } };
    const next = reducer(state, { type: "REMOVE_ITEM", slot: 10 });
    expect(next.placements).toEqual({});
    expect(next.toast?.message).toContain("Slot 10");
  });
});
