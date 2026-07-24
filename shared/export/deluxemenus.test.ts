import { describe, it, expect } from "vitest";
import { mapJsonGuiToDeluxeMenus, generateExternalMenuSnippet, serializeDeluxeMenus, validateDeluxeMenusExport } from "../export/index";
import type { JsonGuiExport } from "../export/deluxemenusTypes";
import { parse } from "yaml";

function makeTestExport(overrides: Partial<JsonGuiExport> = {}): JsonGuiExport {
  return {
    format: "gui-forge/minecraft-java-gui",
    formatVersion: 1,
    catalogVersion: "minecraft-java-1.21.8",
    container: {
      id: "single-chest",
      bukkitId: "CHEST",
      slots: 27,
      rows: 3,
      columns: 9,
      kind: "grid",
      compatibility: "Direct",
    },
    title: "Main Menu",
    items: [],
    ...overrides,
  };
}

function makeTestItem(overrides: Partial<JsonGuiExport["items"][0]> = {}) {
  return {
    slot: 0,
    itemId: "minecraft:compass",
    material: "COMPASS",
    amount: 1,
    displayName: "Compass",
    lore: [],
    action: { type: "prompt_only" as const },
    ...overrides,
  };
}

describe("DeluxeMenus mapper", () => {
  it("maps CHEST 3 rows to size 27", () => {
    const input = makeTestExport({
      container: {
        id: "single-chest",
        bukkitId: "CHEST",
        slots: 27,
        rows: 3,
        columns: 9,
        kind: "grid",
        compatibility: "Direct",
      },
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.size).toBe(27);
  });

  it("maps CHEST 6 rows to size 54", () => {
    const input = makeTestExport({
      container: {
        id: "double-chest",
        bukkitId: "CHEST",
        slots: 54,
        rows: 6,
        columns: 9,
        kind: "grid",
        compatibility: "Direct",
      },
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.size).toBe(54);
  });

  it("preserves slot 0 exactly", () => {
    const input = makeTestExport({
      items: [makeTestItem({ slot: 0 })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.slot).toBe(0);
  });

  it("preserves last slot exactly", () => {
    const input = makeTestExport({
      items: [makeTestItem({ slot: 26 })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_26.slot).toBe(26);
  });

  it("omits amount when equal to 1", () => {
    const input = makeTestExport({
      items: [makeTestItem({ amount: 1 })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.amount).toBeUndefined();
  });

  it("includes amount when greater than 1", () => {
    const input = makeTestExport({
      items: [makeTestItem({ amount: 5 })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.amount).toBe(5);
  });

  it("maps display name and lore", () => {
    const input = makeTestExport({
      items: [makeTestItem({ displayName: "Diamond Sword", lore: ["A sharp blade"] })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.display_name).toBe("Diamond Sword");
    expect(document.items.item_0.lore).toEqual(["A sharp blade"]);
  });

  it("maps open_gui to [openguimenu]", () => {
    const input = makeTestExport({
      items: [makeTestItem({ action: { type: "open_gui", guiId: "combat-menu" } })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.left_click_commands).toEqual(["[openguimenu] combat-menu"]);
  });

  it("maps run_command to [player] without slash", () => {
    const input = makeTestExport({
      items: [makeTestItem({ action: { type: "run_command", command: "/say hello" } })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.left_click_commands).toEqual(["[player] say hello"]);
  });

  it("maps close_inventory to [close]", () => {
    const input = makeTestExport({
      items: [makeTestItem({ action: { type: "close_inventory" } })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.left_click_commands).toEqual(["[close]"]);
  });

  it("maps send_message to [message]", () => {
    const input = makeTestExport({
      items: [makeTestItem({ action: { type: "send_message", message: "Hello!" } })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.left_click_commands).toEqual(["[message] Hello!"]);
  });

  it("maps give_item to [give]", () => {
    const input = makeTestExport({
      items: [makeTestItem({ action: { type: "give_item", material: "DIAMOND", amount: 3 } })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.left_click_commands).toEqual(["[give] DIAMOND 3"]);
  });

  it("warns when action is absent", () => {
    const input = makeTestExport({
      items: [makeTestItem({ action: { type: "prompt_only" } })],
    });
    const { validation } = mapJsonGuiToDeluxeMenus(input);
    expect(validation.issues.some(i => i.message.includes("no runtime action"))).toBe(true);
  });

  it("generates unique identifiers for duplicate slots", () => {
    const input = makeTestExport({
      items: [makeTestItem({ slot: 5 }), makeTestItem({ slot: 5 })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    const ids = Object.keys(document.items);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("warns on unsupported container", () => {
    const input = makeTestExport({
      container: {
        id: "creative",
        bukkitId: "CREATIVE",
        slots: 0,
        rows: 0,
        columns: 0,
        kind: "special",
        compatibility: "Unavailable",
      },
    });
    const { validation } = mapJsonGuiToDeluxeMenus(input);
    expect(validation.issues.some(i => i.message.includes("not supported"))).toBe(true);
  });

  it("warns when no open command", () => {
    const input = makeTestExport();
    const { validation } = mapJsonGuiToDeluxeMenus(input, {});
    expect(validation.issues.some(i => i.message.includes("No open command"))).toBe(true);
  });

  it("validates CHEST size", () => {
    const input = makeTestExport({
      container: {
        id: "single-chest",
        bukkitId: "CHEST",
        slots: 13,
        rows: 2,
        columns: 9,
        kind: "grid",
        compatibility: "Direct",
      },
    });
    const { validation } = mapJsonGuiToDeluxeMenus(input);
    expect(validation.issues.some(i => i.severity === "error" && i.message.includes("Invalid chest size"))).toBe(true);
  });

  it("validates negative slots", () => {
    const input = makeTestExport({
      items: [makeTestItem({ slot: -1 })],
    });
    const { validation } = mapJsonGuiToDeluxeMenus(input);
    expect(validation.issues.some(i => i.severity === "error" && i.message.includes("outside container range"))).toBe(true);
  });

  it("validates slots exceeding size", () => {
    const input = makeTestExport({
      items: [makeTestItem({ slot: 30 })],
    });
    const { validation } = mapJsonGuiToDeluxeMenus(input);
    expect(validation.issues.some(i => i.severity === "error" && i.message.includes("outside container range"))).toBe(true);
  });

  it("sets register_command when option is true", () => {
    const input = makeTestExport();
    const { document } = mapJsonGuiToDeluxeMenus(input, { registerCommand: true });
    expect(document.register_command).toBe(true);
  });

  it("does not set register_command when option is false", () => {
    const input = makeTestExport();
    const { document } = mapJsonGuiToDeluxeMenus(input, { registerCommand: false });
    expect(document.register_command).toBeUndefined();
  });

  it("maps BARREL to inventory_type", () => {
    const input = makeTestExport({
      container: {
        id: "barrel",
        bukkitId: "BARREL",
        slots: 27,
        rows: 3,
        columns: 9,
        kind: "grid",
        compatibility: "Direct",
      },
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.inventory_type).toBe("BARREL");
    expect(document.size).toBeUndefined();
  });

  it("preserves PlaceholderAPI placeholders", () => {
    const input = makeTestExport({
      items: [makeTestItem({ displayName: "%player_name%'s Menu" })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.display_name).toBe("%player_name%'s Menu");
  });
});

describe("DeluxeMenus serializer", () => {
  it("produces valid YAML-like output", () => {
    const input = makeTestExport({
      items: [makeTestItem({ action: { type: "open_gui", guiId: "test" } })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input, { openCommand: "menu", registerCommand: true });
    const yaml = serializeDeluxeMenus(document);
    expect(yaml).toContain("menu_title:");
    expect(yaml).toContain("size: 27");
    expect(yaml).toContain("item_0:");
    expect(yaml).toContain("left_click_commands:");
    expect(yaml).toContain("'[openguimenu] test'");
  });

  it("handles special characters in display name", () => {
    const input = makeTestExport({
      items: [makeTestItem({ displayName: "Item: #1 'Special' \"Test\"" })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    const yaml = serializeDeluxeMenus(document);
    expect(yaml).toContain("display_name:");
  });

  it("handles empty lore", () => {
    const input = makeTestExport({
      items: [makeTestItem({ lore: [] })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    const yaml = serializeDeluxeMenus(document);
    expect(yaml).not.toContain("lore:");
  });

  it("handles multiple lore lines", () => {
    const input = makeTestExport({
      items: [makeTestItem({ lore: ["Line 1", "Line 2", "Line 3"] })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    const yaml = serializeDeluxeMenus(document);
    expect(yaml).toContain("- 'Line 1'");
    expect(yaml).toContain("- 'Line 2'");
    expect(yaml).toContain("- 'Line 3'");
  });

  it("handles Unicode and Vietnamese", () => {
    const input = makeTestExport({
      items: [makeTestItem({ displayName: "Mật ong", lore: ["Giảm 10% giá"] })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    const yaml = serializeDeluxeMenus(document);
    expect(yaml).toContain("Mật ong");
    expect(yaml).toContain("Giảm 10% giá");
  });

  it("quotes YAML action strings to prevent flow sequence", () => {
    const input = makeTestExport({
      items: [makeTestItem({ action: { type: "run_command", command: "warp spawn" } })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    const yaml = serializeDeluxeMenus(document);
    expect(yaml).toContain("'[player] warp spawn'");
  });

  it("ends with newline", () => {
    const { document } = mapJsonGuiToDeluxeMenus(makeTestExport());
    const yaml = serializeDeluxeMenus(document);
    expect(yaml.endsWith("\n")).toBe(true);
  });
});

describe("DeluxeMenus validation", () => {
  it("reports error for invalid CHEST size", () => {
    const input = makeTestExport({
      container: {
        id: "test",
        bukkitId: "CHEST",
        slots: 13,
        rows: 2,
        columns: 9,
        kind: "grid",
        compatibility: "Direct",
      },
    });
    const result = validateDeluxeMenusExport(input);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.severity === "error")).toBe(true);
  });

  it("reports error for unsupported inventory type", () => {
    const input = makeTestExport({
      container: {
        id: "creative",
        bukkitId: "CREATIVE",
        slots: 0,
        rows: 0,
        columns: 0,
        kind: "special",
        compatibility: "Unavailable",
      },
    });
    const result = validateDeluxeMenusExport(input);
    expect(result.valid).toBe(false);
  });

  it("reports error for negative slot", () => {
    const input = makeTestExport({
      items: [makeTestItem({ slot: -1 })],
    });
    const result = validateDeluxeMenusExport(input);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.severity === "error" && i.message.includes("negative"))).toBe(true);
  });

  it("reports error for slot exceeding size", () => {
    const input = makeTestExport({
      items: [makeTestItem({ slot: 30 })],
    });
    const result = validateDeluxeMenusExport(input);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.severity === "error" && i.message.includes("exceeds"))).toBe(true);
  });

  it("reports error for missing material", () => {
    const input = makeTestExport({
      items: [makeTestItem({ material: "" })],
    });
    const result = validateDeluxeMenusExport(input);
    expect(result.valid).toBe(false);
  });

  it("reports warning for duplicate slot", () => {
    const input = makeTestExport({
      items: [makeTestItem({ slot: 5 }), makeTestItem({ slot: 5 })],
    });
    const result = validateDeluxeMenusExport(input);
    expect(result.issues.some(i => i.severity === "warning" && i.message.includes("Duplicate"))).toBe(true);
  });

  it("reports warning for missing display name", () => {
    const input = makeTestExport({
      items: [makeTestItem({ displayName: "" })],
    });
    const result = validateDeluxeMenusExport(input);
    expect(result.issues.some(i => i.severity === "warning" && i.message.includes("display name"))).toBe(true);
  });

  it("reports error for open command with slash", () => {
    const input = makeTestExport();
    const result = validateDeluxeMenusExport(input, { openCommand: "/menu" });
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.severity === "error" && i.message.includes("slashes"))).toBe(true);
  });

  it("reports error for open command with spaces", () => {
    const input = makeTestExport();
    const result = validateDeluxeMenusExport(input, { openCommand: "my menu" });
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.severity === "error" && i.message.includes("spaces"))).toBe(true);
  });

  it("reports warning for missing open command", () => {
    const input = makeTestExport();
    const result = validateDeluxeMenusExport(input, {});
    expect(result.issues.some(i => i.severity === "warning" && i.message.includes("No open command"))).toBe(true);
  });

});

describe("External menu snippet", () => {
  it("generates correct config snippet", () => {
    const snippet = generateExternalMenuSnippet("main-menu");
    expect(snippet).toContain("gui_menus:");
    expect(snippet).toContain("main-menu:");
    expect(snippet).toContain("file: main-menu.yml");
  });
});

describe("Advanced Mapper", () => {
  it("maps BARREL to inventory_type without size", () => {
    const input = makeTestExport({
      container: { id: "barrel", bukkitId: "BARREL", slots: 27, rows: 3, columns: 9, kind: "grid", compatibility: "Direct" },
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.inventory_type).toBe("BARREL");
    expect(document.size).toBeUndefined();
  });

  it("preserves vanilla material uppercase", () => {
    const input = makeTestExport({ items: [makeTestItem({ material: "diamond" })] });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.material).toBe("DIAMOND");
  });

  it("does not uppercase custom material like head-player", () => {
    const input = makeTestExport({ items: [makeTestItem({ material: "head-%player_name%" })] });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.material).toBe("head-%player_name%");
  });

  it("does not uppercase custom material like mmoitems", () => {
    const input = makeTestExport({ items: [makeTestItem({ material: "mmoitems-weapon:Sword" })] });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.material).toBe("mmoitems-weapon:Sword");
  });

  it("generates stable deterministic IDs for duplicate slots", () => {
    const input = makeTestExport({
      items: [makeTestItem({ slot: 5 }), makeTestItem({ slot: 5 }), makeTestItem({ slot: 5 })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    const ids = Object.keys(document.items);
    expect(ids).toEqual(["item_5", "item_5_1", "item_5_2"]);
  });

  it("allows multiple items in same slot", () => {
    const input = makeTestExport({
      items: [makeTestItem({ slot: 5, displayName: "A" }), makeTestItem({ slot: 5, displayName: "B" })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(Object.keys(document.items).length).toBe(2);
  });

  it("preserves priority 0", () => {
    const input = makeTestExport({
      items: [makeTestItem({ slot: 5, priority: 0 })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_5.priority).toBe(0);
  });

  it("maps console_command", () => {
    const input = makeTestExport({
      items: [makeTestItem({ action: { type: "console_command", command: "/say hello" } })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.left_click_commands).toEqual(["[console] say hello"]);
  });

  it("maps refresh action", () => {
    const input = makeTestExport({
      items: [makeTestItem({ action: { type: "refresh" } })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.left_click_commands).toEqual(["[refresh]"]);
  });

  it("maps connect action", () => {
    const input = makeTestExport({
      items: [makeTestItem({ action: { type: "connect", server: "lobby" } })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.left_click_commands).toEqual(["[connect] lobby"]);
  });

  it("maps sound action with defaults and warns", () => {
    const input = makeTestExport({
      items: [makeTestItem({ action: { type: "sound", sound: "ENTITY_PLAYER_LEVELUP" } })],
    });
    const { document, validation } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.left_click_commands).toEqual(["[sound] ENTITY_PLAYER_LEVELUP 1 1"]);
    expect(validation.issues.some(i => i.message.includes("Sound action missing volume"))).toBe(true);
  });

  it("maps view requirement object", () => {
    const input = makeTestExport({
      items: [makeTestItem({
        viewRequirement: { requirements: { perm: { type: "has permission", permission: "vip" } } },
      })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.view_requirement).toBeDefined();
    expect((document.items.item_0.view_requirement as unknown as Record<string, unknown>).requirements).toBeDefined();
  });

  it("reports error for register_command without open_command", () => {
    const input = makeTestExport();
    const result = validateDeluxeMenusExport(input, { registerCommand: true });
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.message.includes("register_command"))).toBe(true);
  });

  it("does not report error for duplicate slots if priority and view requirement exist", () => {
    const input = makeTestExport({
      items: [
        makeTestItem({ slot: 5, priority: 0, viewRequirement: { requirements: { a: { type: "has permission", permission: "a" } } } }),
        makeTestItem({ slot: 5, priority: 1, viewRequirement: { requirements: { b: { type: "has permission", permission: "b" } } } }),
      ],
    });
    const result = validateDeluxeMenusExport(input);
    expect(result.issues.some(i => i.message.includes("Duplicate slot 5"))).toBe(false);
  });
});

describe("YAML Serialization Safety", () => {
  it("can be parsed back to an object", () => {
    const input = makeTestExport({
      items: [makeTestItem({ action: { type: "run_command", command: "say test" } })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input, { openCommand: "menu" });
    const yamlString = serializeDeluxeMenus(document);
    const parsed = parse(yamlString) as Record<string, unknown>;
    expect(parsed.menu_title).toBe("Main Menu");
    expect(parsed.size).toBe(27);
  });

  it("does not parse [player] string as array", () => {
    const input = makeTestExport({
      items: [makeTestItem({ action: { type: "run_command", command: "warp spawn" } })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    const yamlString = serializeDeluxeMenus(document);
    const parsed = parse(yamlString) as Record<string, unknown>;
    const items = parsed.items as Record<string, Record<string, unknown>>;
    expect(Array.isArray(items.item_0["left_click_commands"])).toBe(true);
    expect((items.item_0["left_click_commands"] as string[])[0]).toBe("[player] warp spawn");
  });

  it("handles colon in display name without breaking YAML", () => {
    const input = makeTestExport({
      items: [makeTestItem({ displayName: "Player: Status" })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    const yamlString = serializeDeluxeMenus(document);
    const parsed = parse(yamlString) as Record<string, unknown>;
    const items = parsed.items as Record<string, Record<string, unknown>>;
    expect(items.item_0["display_name"]).toBe("Player: Status");
  });

  it("does not let # turn into a comment", () => {
    const input = makeTestExport({
      items: [makeTestItem({ displayName: "Top #1 Player" })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    const yamlString = serializeDeluxeMenus(document);
    expect(yamlString).toContain("#1 Player");
    const parsed = parse(yamlString) as Record<string, unknown>;
    const items = parsed.items as Record<string, Record<string, unknown>>;
    expect(items.item_0["display_name"]).toBe("Top #1 Player");
  });

  it("escapes single and double quotes", () => {
    const input = makeTestExport({
      items: [makeTestItem({ displayName: "It's a \"test\"" })],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    const yamlString = serializeDeluxeMenus(document);
    const parsed = parse(yamlString) as Record<string, unknown>;
    const items = parsed.items as Record<string, Record<string, unknown>>;
    expect(items.item_0["display_name"]).toBe("It's a \"test\"");
  });

  it("ends with newline", () => {
    const { document } = mapJsonGuiToDeluxeMenus(makeTestExport());
    expect(serializeDeluxeMenus(document).endsWith("\n")).toBe(true);
  });

  it("contains no undefined values", () => {
    const { document } = mapJsonGuiToDeluxeMenus(makeTestExport());
    const yamlString = serializeDeluxeMenus(document);
    expect(yamlString).not.toContain("undefined");
  });
});

describe("Checklist K tests", () => {
  it("51-56: outputs correct sizes for all chest rows", () => {
    const sizes = [9, 18, 27, 36, 45, 54];
    for (let r = 1; r <= 6; r++) {
      const input = makeTestExport({
        container: {
          id: `chest-${r}`,
          bukkitId: "CHEST",
          slots: r * 9,
          rows: r,
          columns: 9,
          kind: "grid",
          compatibility: "Direct",
        },
      });
      const { document } = mapJsonGuiToDeluxeMenus(input);
      expect(document.size).toBe(sizes[r - 1]);
    }
  });

  it("57-59: validates slots for size 9", () => {
    const inputOk0 = makeTestExport({
      container: { id: "single", bukkitId: "CHEST", slots: 9, rows: 1, columns: 9, kind: "grid", compatibility: "Direct" },
      items: [makeTestItem({ slot: 0 })],
    });
    expect(validateDeluxeMenusExport(inputOk0).valid).toBe(true);

    const inputOk8 = makeTestExport({
      container: { id: "single", bukkitId: "CHEST", slots: 9, rows: 1, columns: 9, kind: "grid", compatibility: "Direct" },
      items: [makeTestItem({ slot: 8 })],
    });
    expect(validateDeluxeMenusExport(inputOk8).valid).toBe(true);

    const inputErr = makeTestExport({
      container: { id: "single", bukkitId: "CHEST", slots: 9, rows: 1, columns: 9, kind: "grid", compatibility: "Direct" },
      items: [makeTestItem({ slot: 9 })],
    });
    expect(validateDeluxeMenusExport(inputErr).valid).toBe(false);
  });

  it("60-61: validates slots for size 54", () => {
    const inputOk53 = makeTestExport({
      container: { id: "double", bukkitId: "CHEST", slots: 54, rows: 6, columns: 9, kind: "grid", compatibility: "Direct" },
      items: [makeTestItem({ slot: 53 })],
    });
    expect(validateDeluxeMenusExport(inputOk53).valid).toBe(true);

    const inputErr54 = makeTestExport({
      container: { id: "double", bukkitId: "CHEST", slots: 54, rows: 6, columns: 9, kind: "grid", compatibility: "Direct" },
      items: [makeTestItem({ slot: 54 })],
    });
    expect(validateDeluxeMenusExport(inputErr54).valid).toBe(false);
  });

  it("62: outputs open_command: [] if option enabled and command empty", () => {
    const input = makeTestExport();
    const { document } = mapJsonGuiToDeluxeMenus(input, { openCommand: "", emitEmptyOpenCommand: true });
    expect(document.open_command).toEqual([]);
  });

  it("63: outputs open_command as scalar if one command", () => {
    const input = makeTestExport();
    const { document } = mapJsonGuiToDeluxeMenus(input, { openCommand: "menu", emitEmptyOpenCommand: true });
    expect(document.open_command).toBe("menu");
  });

  it("64: outputs open_command as array if multiple commands", () => {
    const input = makeTestExport();
    const { document } = mapJsonGuiToDeluxeMenus(input, { openCommand: "menu, shop, test", emitEmptyOpenCommand: true });
    expect(document.open_command).toEqual(["menu", "shop", "test"]);
  });

  it("65: open_command and open_commands are distinct", () => {
    const input = makeTestExport();
    (input as unknown as Record<string, unknown>)["openCommands"] = ["[sound] BLOCK_BEACON_ACTIVATE"];
    const { document } = mapJsonGuiToDeluxeMenus(input, { openCommand: "menu" });
    expect(document.open_command).toBe("menu");
    expect(document.open_commands).toEqual(["[sound] BLOCK_BEACON_ACTIVATE"]);
  });

  it("66-68: supports slots arrays and validates them", () => {
    const input = makeTestExport({
      container: { id: "single", bukkitId: "CHEST", slots: 9, rows: 1, columns: 9, kind: "grid", compatibility: "Direct" },
      items: [makeTestItem({ slots: [0, 1, 2, 3, 4, 5, 6, 7, 8] } as unknown as JsonGuiExport["items"][0])],
    });
    const { document, validation } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(validation.valid).toBe(true);

    const inputErr = makeTestExport({
      container: { id: "single", bukkitId: "CHEST", slots: 9, rows: 1, columns: 9, kind: "grid", compatibility: "Direct" },
      items: [makeTestItem({ slots: [0, 9] } as unknown as JsonGuiExport["items"][0])],
    });
    const result = validateDeluxeMenusExport(inputErr);
    expect(result.valid).toBe(false);
  });

  it("69-70: preserves priority: 0 and multiple items per slot", () => {
    const input = makeTestExport({
      items: [
        makeTestItem({ slot: 5, priority: 0 }),
        makeTestItem({ slot: 5, priority: 1 }),
      ],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_5.priority).toBe(0);
    expect(document.items.item_5_1.priority).toBe(1);
  });

  it("71-72: normalizes materials and head syntax correctly", () => {
    const input = makeTestExport({
      items: [
        makeTestItem({ slot: 0, material: "head-extended_clip" }),
        makeTestItem({ slot: 1, material: "hdb-123" }),
        makeTestItem({ slot: 2, material: "stone" }),
      ],
    });
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.material).toBe("head-extended_clip");
    expect(document.items.item_1.material).toBe("hdb-123");
    expect(document.items.item_2.material).toBe("STONE");
  });

  it("73-74: action delay parsing and validation", () => {
    const input = makeTestExport({
      items: [
        makeTestItem({ slot: 0 } as unknown as JsonGuiExport["items"][0]),
      ],
    });
    (input.items[0] as unknown as Record<string, unknown>).leftClickCommands = ["[message] Test <delay=20>"];
    expect(validateDeluxeMenusExport(input).valid).toBe(true);

    (input.items[0] as unknown as Record<string, unknown>).leftClickCommands = ["[message] Test <delay=-20>"];
    expect(validateDeluxeMenusExport(input).valid).toBe(false);

    (input.items[0] as unknown as Record<string, unknown>).leftClickCommands = ["[message] Test <delay=abc>"];
    expect(validateDeluxeMenusExport(input).valid).toBe(false);
  });

  it("75-77: click requirement structures", () => {
    const input = makeTestExport({
      items: [
        makeTestItem({ slot: 0 } as unknown as JsonGuiExport["items"][0]),
      ],
    });
    (input.items[0] as unknown as Record<string, unknown>).leftClickRequirement = {
      requirements: {
        has_money: {
          type: "has money",
          amount: 100,
        },
      },
      deny_commands: ["[message] Fail"],
    };
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect(document.items.item_0.left_click_requirement).toEqual({
      requirements: {
        has_money: {
          type: "has money",
          amount: 100,
        },
      },
      deny_commands: ["[message] Fail"],
    });
  });

  it("78-79: banner_meta and enchantments mapping support", () => {
    const input = makeTestExport({
      items: [
        makeTestItem({ slot: 0 } as unknown as JsonGuiExport["items"][0]),
      ],
    });
    (input.items[0] as unknown as Record<string, unknown>).bannerMeta = ["RED;BASE", "WHITE;CREEPER"];
    (input.items[0] as unknown as Record<string, unknown>).enchantments = ["SILK_TOUCH;1"];
    const { document } = mapJsonGuiToDeluxeMenus(input);
    expect((document.items.item_0 as unknown as Record<string, unknown>)["banner_meta"]).toEqual(["RED;BASE", "WHITE;CREEPER"]);
    expect(document.items.item_0.enchantments).toEqual(["SILK_TOUCH;1"]); // enchantments is mapped
  });
});
