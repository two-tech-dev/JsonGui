import { describe, expect, it } from "vitest";
import { CONTAINERS, FALLBACK_ITEMS, buildExport, getFilteredItems, initialState, isValidContainerSlot, reducer, trimForContainer } from "./editor";

describe("GUI Forge editor domain", () => {
  it("starts with an empty demo-free project and no fake fallback catalog", () => {
    expect(FALLBACK_ITEMS).toHaveLength(0);
    expect(Object.keys(initialState.placements)).toHaveLength(0);
    expect(initialState.itemDefaults).toEqual({});
  });

  it("validates container slots and trims outside range", () => {
    expect(isValidContainerSlot(0, CONTAINERS[0])).toBe(true);
    expect(isValidContainerSlot(54, CONTAINERS[0])).toBe(false);
    const placements = { 10: { slot: 10, itemId: "minecraft:compass", amount: 1, displayName: "Compass", lore: [], prompt: "", action: { type: "prompt_only" as const } }, 40: { slot: 40, itemId: "minecraft:paper", amount: 1, displayName: "Paper", lore: [], prompt: "", action: { type: "prompt_only" as const } } };
    expect(Object.keys(trimForContainer(placements, CONTAINERS[1])).map(Number)).toEqual([10]);
  });

  it("exports sorted valid JSON without preview-only player inventory", () => {
    const state = { ...initialState, catalog: [{ id: "minecraft:compass", name: "Compass", material: "COMPASS", category: "Tools" as const, icon: "compass", maxStack: 1, description: "" }], placements: { 10: { slot: 10, itemId: "minecraft:compass", amount: 1, displayName: "Compass", lore: [], prompt: "Open quests", action: { type: "prompt_only" as const } } } };
    const json = JSON.parse(buildExport(state)) as { container: { bukkitType: string; slots: number }; items: Array<{ slot: number; material: string; prompt?: string }> };
    expect(json.container.bukkitType).toBe("CHEST");
    expect(json.items.map((entry) => entry.slot)).toEqual([10]);
    expect(json.items[0].prompt).toBe("Open quests");
  });

  it("filters full catalog by registry ID and favorites/recent tabs", () => {
    const catalog = [{ id: "minecraft:diamond", name: "Diamond", material: "DIAMOND", category: "Misc" as const, icon: "minecraft:diamond", maxStack: 64, description: "" }, { id: "minecraft:bread", name: "Bread", material: "BREAD", category: "Food" as const, icon: "minecraft:bread", maxStack: 64, description: "" }];
    expect(getFilteredItems({ ...initialState, catalog, query: "minecraft:diamond" }).map((item) => item.id)).toEqual(["minecraft:diamond"]);
    expect(getFilteredItems({ ...initialState, catalog, libraryTab: "Favorites", favorites: ["minecraft:bread"] }).map((item) => item.id)).toEqual(["minecraft:bread"]);
  });

  it("keeps drawer drafts local until saving placement details", () => {
    const state = { ...initialState, catalog: [{ id: "minecraft:compass", name: "Compass", material: "COMPASS", category: "Tools" as const, icon: "compass", maxStack: 1, description: "" }], placements: { 10: { slot: 10, itemId: "minecraft:compass", amount: 1, displayName: "Compass", lore: [], prompt: "", action: { type: "prompt_only" as const } } }, promptTarget: { kind: "placement" as const, slot: 10 } };
    const drafted = reducer(state, { type: "SET_DRAFT_LORE", lore: ["Line one"] });
    expect(drafted.dirty).toBe(false);
    const saved = reducer(drafted, { type: "SAVE_PROMPT" });
    expect(saved.placements[10].lore).toEqual(["Line one"]);
    expect(saved.dirty).toBe(true);
  });

  it("deletes placed item through reducer", () => {
    const state = { ...initialState, catalog: [{ id: "minecraft:compass", name: "Compass", material: "COMPASS", category: "Tools" as const, icon: "compass", maxStack: 1, description: "" }], placements: { 10: { slot: 10, itemId: "minecraft:compass", amount: 1, displayName: "Compass", lore: [], prompt: "", action: { type: "prompt_only" as const } } } };
    const next = reducer(state, { type: "REMOVE_ITEM", slot: 10 });
    expect(next.placements).toEqual({});
    expect(next.toast?.message).toContain("Slot 10");
  });
});
