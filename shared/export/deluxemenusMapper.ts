import type { JsonGuiAction, JsonGuiContainer, JsonGuiExport, DeluxeMenusDocument, DeluxeMenusItem, DeluxeMenusExportOptions, ExportValidationResult, ExportValidationIssue } from "./deluxemenusTypes";
import { DELUXEMENUS_SUPPORTED_INVENTORY_TYPES, DELUXEMENUS_VALID_SIZES } from "./deluxemenusTypes";

function escapeYamlValue(value: string): string {
  if (value === "") return '""';
  if (/^[0-9]+$/.test(value)) return `"${value}"`;
  if (/^(true|false|null|yes|no|on|off)$/i.test(value)) return `"${value}"`;
  if (/[:{}[\] ,&*?|>!%@`#-]/.test(value) || value.trim() !== value) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `"${value}"`;
}

function sanitizeMenuId(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    || "menu";
}

function generateItemId(slot: number, existingIds: Set<string>): string {
  const id = `item_${slot}`;
  if (!existingIds.has(id)) return id;
  let counter = 1;
  while (existingIds.has(`${id}_${counter}`)) counter++;
  return `${id}_${counter}`;
}

function normalizeDeluxeMenusMaterial(material: string): string {
  if (!material) return "STONE";
  if (/[:%-]/.test(material) || /^(head|basehead|texture|hdb|itemsadder|oraxen|mmoitems|executableitems|executableblocks|simpleitemgenerator|placeholder|main_hand|off_hand|armor_)/i.test(material)) {
    return material;
  }
  return material.toUpperCase();
}

function mapJsonGuiActionToDeluxeMenus(action: JsonGuiAction, issues: ExportValidationIssue[], path: string): string[] {
  switch (action.type) {
    case "open_gui":
      return [`[openguimenu] ${action.guiId || ""}`];
    case "run_command":
    case "player_command":
      return [`[player] ${(action.command || "").replace(/^\/+/, "")}`];
    case "console_command":
      return [`[console] ${(action.command || "").replace(/^\/+/, "")}`];
    case "send_message":
      return [`[message] ${action.message || ""}`];
    case "close_inventory":
    case "close":
      return ["[close]"];
    case "give_item":
      return [`[give] ${action.material || ""} ${action.amount || 1}`];
    case "teleport":
      issues.push({ path, message: "Teleport action cannot be represented by DeluxeMenus without a player command; export skipped.", severity: "warning" });
      return [];
    case "refresh":
      return ["[refresh]"];
    case "connect":
      return [`[connect] ${action.server || ""}`];
    case "sound": {
      const soundName = action.sound || "";
      const volume = action.volume !== undefined ? action.volume : 1;
      const pitch = action.pitch !== undefined ? action.pitch : 1;
      if (action.volume === undefined || action.pitch === undefined) {
        issues.push({
          path,
          message: `Sound action missing volume or pitch. Defaulting to 1.`,
          severity: "warning"
        });
      }
      return [`[sound] ${soundName} ${volume} ${pitch}`];
    }
    case "prompt_only":
      return [];
    default:
      issues.push({
        path,
        message: `Action type '${action.type}' is not supported by DeluxeMenus`,
        severity: "warning"
      });
      return [];
  }
}

function mapContainerToInventoryType(container: JsonGuiContainer): string | undefined {
  if (container.bukkitId === "CHEST") return undefined;
  if (DELUXEMENUS_SUPPORTED_INVENTORY_TYPES.has(container.bukkitId)) {
    return container.bukkitId;
  }
  return undefined;
}

function resolveBukkitId(container: { bukkitId?: string; bukkitType?: string }): string {
  return container.bukkitId ?? container.bukkitType ?? "";
}

export function mapJsonGuiToDeluxeMenus(
  input: JsonGuiExport,
  options: DeluxeMenusExportOptions = {}
): { document: DeluxeMenusDocument; validation: ExportValidationResult } {
  const issues: ExportValidationIssue[] = [];
  const usedIds = new Set<string>();

  const bukkitId = resolveBukkitId(input.container);
  const inventoryType = mapContainerToInventoryType({ ...input.container, bukkitId });
  let size: number | undefined;

  if (bukkitId === "CHEST") {
    size = input.container.slots;
    if (!DELUXEMENUS_VALID_SIZES.includes(size as typeof DELUXEMENUS_VALID_SIZES[number])) {
      issues.push({ path: "size", message: `Invalid chest size ${size}. Must be one of: ${DELUXEMENUS_VALID_SIZES.join(", ")}`, severity: "error" });
    }
  } else if (inventoryType === undefined) {
    issues.push({ path: "container", message: `Container type '${bukkitId}' is not supported by DeluxeMenus`, severity: "error" });
  }

  const items: Record<string, DeluxeMenusItem> = {};

  for (const item of input.items) {
    if (item.slot < 0 || item.slot >= input.container.slots) {
      issues.push({ path: `items[${item.slot}]`, message: `Slot ${item.slot} is outside container range (0-${input.container.slots - 1})`, severity: "error" });
      continue;
    }

    const itemId = generateItemId(item.slot, usedIds);
    usedIds.add(itemId);

    const dmItem: DeluxeMenusItem = {
      material: normalizeDeluxeMenusMaterial(item.material),
      slot: item.slot,
    };

    if (item.priority !== undefined) {
      dmItem.priority = item.priority;
    }

    if (item.viewRequirement !== undefined) {
      dmItem.view_requirement = item.viewRequirement;
    }

    const itemRecord = item as unknown as Record<string, unknown>;
    if (itemRecord["damage"] !== undefined) {
      dmItem.damage = itemRecord["damage"] as number;
    }

    if (itemRecord["update"] !== undefined) {
      dmItem.update = itemRecord["update"] as boolean;
    }

    if (itemRecord["itemFlags"] !== undefined) {
      dmItem.item_flags = itemRecord["itemFlags"] as string[];
    }

    if (itemRecord["hideTooltip"] !== undefined) {
      dmItem.hide_tooltip = itemRecord["hideTooltip"] as boolean;
    }

    if (itemRecord["enchantmentGlintOverride"] !== undefined) {
      dmItem.enchantment_glint_override = itemRecord["enchantmentGlintOverride"] as boolean;
    }

    if (itemRecord["unbreakable"] !== undefined) {
      dmItem.unbreakable = itemRecord["unbreakable"] as boolean;
    }

    if (itemRecord["leftClickRequirement"] !== undefined) {
      dmItem.left_click_requirement = itemRecord["leftClickRequirement"] as Record<string, unknown>;
    }

    if (itemRecord["rightClickRequirement"] !== undefined) {
      dmItem.right_click_requirement = itemRecord["rightClickRequirement"] as Record<string, unknown>;
    }

    if (itemRecord["shiftLeftClickRequirement"] !== undefined) {
      dmItem.shift_left_click_requirement = itemRecord["shiftLeftClickRequirement"] as Record<string, unknown>;
    }

    if (itemRecord["shiftRightClickRequirement"] !== undefined) {
      dmItem.shift_right_click_requirement = itemRecord["shiftRightClickRequirement"] as Record<string, unknown>;
    }

    if (itemRecord["leftClickCommands"] !== undefined) dmItem.left_click_commands = itemRecord["leftClickCommands"] as string[];
    if (itemRecord["rightClickCommands"] !== undefined) {
      dmItem.right_click_commands = itemRecord["rightClickCommands"] as string[];
    }

    if (itemRecord["shiftLeftClickCommands"] !== undefined) {
      dmItem.shift_left_click_commands = itemRecord["shiftLeftClickCommands"] as string[];
    }

    if (itemRecord["shiftRightClickCommands"] !== undefined) {
      dmItem.shift_right_click_commands = itemRecord["shiftRightClickCommands"] as string[];
    }

    if (itemRecord["middleClickCommands"] !== undefined) {
      dmItem.middle_click_commands = itemRecord["middleClickCommands"] as string[];
    }

    if (itemRecord["slots"] !== undefined && Array.isArray(itemRecord["slots"])) {
      dmItem.slots = itemRecord["slots"] as number[];
      delete dmItem.slot;
    }

    if (itemRecord["modelData"] !== undefined) dmItem.model_data = itemRecord["modelData"] as number;
    if (itemRecord["modelDataComponent"] !== undefined) dmItem.model_data_component = itemRecord["modelDataComponent"] as Record<string, unknown>;
    if (itemRecord["itemModel"] !== undefined) dmItem.item_model = itemRecord["itemModel"] as string;
    if (itemRecord["hideAttributes"] !== undefined) dmItem.hide_attributes = itemRecord["hideAttributes"] as boolean;
    if (itemRecord["hideEnchantments"] !== undefined) dmItem.hide_enchantments = itemRecord["hideEnchantments"] as boolean;
    if (itemRecord["enchantments"] !== undefined) dmItem.enchantments = itemRecord["enchantments"] as string[];

    if (itemRecord["bannerMeta"] !== undefined) {
      (dmItem as unknown as Record<string, unknown>)["banner_meta"] = itemRecord["bannerMeta"];
    }

    if (item.amount && item.amount !== 1) {
      dmItem.amount = item.amount;
    }

    if (item.displayName) {
      dmItem.display_name = item.displayName;
    } else {
      issues.push({ path: `items[${itemId}]`, message: `Item at slot ${item.slot} has no display name`, severity: "warning" });
    }

    if (item.lore && item.lore.length > 0) {
      dmItem.lore = item.lore;
    }

    const actionPath = `items[${itemId}].action`;
    const actions = mapJsonGuiActionToDeluxeMenus(item.action, issues, actionPath);
    if (actions.length > 0) {
      dmItem.left_click_commands = [...(dmItem.left_click_commands ?? []), ...actions];
    } else if (item.action.type === "prompt_only" && !dmItem.left_click_commands?.length) {
      issues.push({ path: `items[${itemId}]`, message: `Item at slot ${item.slot} has no runtime action (prompt only)`, severity: "warning" });
    }

    items[itemId] = dmItem;
  }

  if (!options.openCommand) {
    issues.push({ path: "open_command", message: "No open command defined. The menu will not be accessible via command.", severity: "warning" });
  }

  const document: DeluxeMenusDocument = {
    menu_title: input.title,
    items,
  };

  let openCommandValue: string | string[] | undefined;
  if (options.openCommand) {
    const rawCmds = options.openCommand.split(",").map(c => c.trim()).filter(Boolean);
    const uniqueCmds = Array.from(new Set(rawCmds));
    if (uniqueCmds.length > 1) {
      openCommandValue = uniqueCmds;
    } else if (uniqueCmds.length === 1) {
      openCommandValue = uniqueCmds[0];
    } else {
      if (options.emitEmptyOpenCommand !== false) {
        openCommandValue = [];
      }
    }
  } else {
    if (options.emitEmptyOpenCommand !== false) {
      openCommandValue = [];
    }
  }

  if (openCommandValue !== undefined) {
    document.open_command = openCommandValue;
  }

  if (options.registerCommand) {
    document.register_command = true;
  }

  if (inventoryType) {
    document.inventory_type = inventoryType;
  }

  if (size !== undefined) {
    document.size = size;
  }

  if (input.updateInterval !== undefined) document.update_interval = input.updateInterval;
  if (input.openRequirement !== undefined) document.open_requirement = input.openRequirement;
  if (input.openCommands !== undefined) document.open_commands = input.openCommands;
  if (input.closeCommands !== undefined) document.close_commands = input.closeCommands;

  return {
    document,
    validation: {
      valid: issues.filter(i => i.severity === "error").length === 0,
      issues,
    },
  };
}

export function generateExternalMenuSnippet(menuId: string): string {
  return `gui_menus:\n  ${menuId}:\n    file: ${menuId}.yml`;
}

export { escapeYamlValue, sanitizeMenuId };
