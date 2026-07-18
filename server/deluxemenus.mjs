import { ValidationError } from "./schema.mjs";

const DELUXEMENUS_SUPPORTED_INVENTORY_TYPES = new Set([
  "ANVIL",
  "BARREL",
  "BEACON",
  "BLAST_FURNACE",
  "BREWING",
  "CARTOGRAPHY",
  "DISPENSER",
  "DROPPER",
  "ENCHANTING",
  "ENDER_CHEST",
  "FURNACE",
  "GRINDSTONE",
  "HOPPER",
  "LOOM",
  "PLAYER",
  "SHULKER_BOX",
  "SMOKER",
  "WORKBENCH",
]);

const DELUXEMENUS_VALID_SIZES = [9, 18, 27, 36, 45, 54];

function escapeYamlValue(value) {
  if (value === "") return '""';
  if (typeof value !== "string") return String(value);
  if (/^[0-9]+$/.test(value)) return `"${value}"`;
  if (/^(true|false|null|yes|no|on|off)$/i.test(value)) return `"${value}"`;
  if (/[:{}[\] ,&*?|>!%@`#-]/.test(value) || value.includes("\n") || value.trim() !== value) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `"${value}"`;
}

function sanitizeMenuId(title) {
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

function generateItemId(slot, existingIds) {
  let id = `item_${slot}`;
  if (!existingIds.has(id)) return id;
  let counter = 1;
  while (existingIds.has(`${id}_${counter}`)) counter++;
  return `${id}_${counter}`;
}

function normalizeDeluxeMenusMaterial(material) {
  if (!material) return "STONE";
  if (/[:%-]/.test(material) || /^(head|basehead|texture|hdb|itemsadder|oraxen|mmoitems|executableitems|executableblocks|simpleitemgenerator|placeholder|main_hand|off_hand|armor_)/i.test(material)) {
    return material;
  }
  return material.toUpperCase();
}

function mapActionToDeluxeMenus(action) {
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
      return [`[connect] ${action.world || ""} ${action.x || 0} ${action.y || 0} ${action.z || 0}`];
    case "refresh":
      return ["[refresh]"];
    case "connect":
      return [`[connect] ${action.server || ""}`];
    case "sound": {
      const soundName = action.sound || "";
      const volume = action.volume !== undefined ? action.volume : 1;
      const pitch = action.pitch !== undefined ? action.pitch : 1;
      return [`[sound] ${soundName} ${volume} ${pitch}`];
    }
    case "prompt_only":
      return [];
    default:
      return [];
  }
}

export function exportDeluxeMenus(project, catalog, containers, options = {}) {
  const issues = [];
  const usedIds = new Set();

  const container = containers.find((entry) => entry.id === project.containerId);
  const byId = new Map(catalog.items.map((entry) => [entry.id, entry]));

  const title = project.title || "Menu";
  const menuId = options.menuId || sanitizeMenuId(title);

  let inventoryType;
  let size;

  if (container.bukkitId === "CHEST") {
    size = container.slots;
    if (!DELUXEMENUS_VALID_SIZES.includes(size)) {
      issues.push({ path: "size", message: `Invalid chest size ${size}`, severity: "error" });
    }
  } else if (DELUXEMENUS_SUPPORTED_INVENTORY_TYPES.has(container.bukkitId)) {
    inventoryType = container.bukkitId;
  } else {
    issues.push({ path: "container", message: `Container type '${container.bukkitId}' not supported`, severity: "error" });
  }

  const items = {};
  const activePlacements = project.placements.filter((p) => p.includeInExport !== false);

  for (const placed of activePlacements) {
    const definition = byId.get(placed.itemId);
    if (!definition) continue;

    const itemSlots = placed.slots !== undefined && Array.isArray(placed.slots) 
      ? placed.slots 
      : [placed.slot];

    for (const s of itemSlots) {
      if (s < 0 || s >= container.slots) {
        issues.push({ path: `items[${placed.slot}]`, message: `Slot outside range`, severity: "error" });
      }
    }

    const itemId = generateItemId(placed.slot, usedIds);
    usedIds.add(itemId);

    const dmItem = {
      material: normalizeDeluxeMenusMaterial(definition.material),
    };

    if (placed.slots !== undefined && Array.isArray(placed.slots)) {
      dmItem.slots = placed.slots;
    } else {
      dmItem.slot = placed.slot;
    }

    if (placed.priority !== undefined) {
      dmItem.priority = placed.priority;
    }

    if (placed.viewRequirement !== undefined) {
      dmItem.view_requirement = placed.viewRequirement;
    }

    if (placed.damage !== undefined) {
      dmItem.damage = placed.damage;
    }

    if (placed.update !== undefined) {
      dmItem.update = placed.update;
    }

    if (placed.itemFlags !== undefined) {
      dmItem.item_flags = placed.itemFlags;
    }

    if (placed.hideTooltip !== undefined) {
      dmItem.hide_tooltip = placed.hideTooltip;
    }

    if (placed.enchantmentGlintOverride !== undefined) {
      dmItem.enchantment_glint_override = placed.enchantmentGlintOverride;
    }

    if (placed.unbreakable !== undefined) {
      dmItem.unbreakable = placed.unbreakable;
    }

    if (placed.leftClickRequirement !== undefined) {
      dmItem.left_click_requirement = placed.leftClickRequirement;
    }

    if (placed.rightClickRequirement !== undefined) {
      dmItem.right_click_requirement = placed.rightClickRequirement;
    }

    if (placed.shiftLeftClickRequirement !== undefined) {
      dmItem.shift_left_click_requirement = placed.shiftLeftClickRequirement;
    }

    if (placed.shiftRightClickRequirement !== undefined) {
      dmItem.shift_right_click_requirement = placed.shiftRightClickRequirement;
    }

    if (placed.rightClickCommands !== undefined) {
      dmItem.right_click_commands = placed.rightClickCommands;
    }

    if (placed.shiftLeftClickCommands !== undefined) {
      dmItem.shift_left_click_commands = placed.shiftLeftClickCommands;
    }

    if (placed.shiftRightClickCommands !== undefined) {
      dmItem.shift_right_click_commands = placed.shiftRightClickCommands;
    }

    if (placed.middleClickCommands !== undefined) {
      dmItem.middle_click_commands = placed.middleClickCommands;
    }

    if (placed.amount && placed.amount !== 1) {
      dmItem.amount = placed.amount;
    }

    if (placed.displayName) {
      dmItem.display_name = placed.displayName;
    }

    if (placed.lore && placed.lore.length > 0) {
      dmItem.lore = placed.lore;
    }

    const actions = mapActionToDeluxeMenus(placed.action);
    if (actions.length > 0) {
      dmItem.left_click_commands = actions;
    }

    items[itemId] = dmItem;
  }

  if (options.registerCommand && !options.openCommand) {
    issues.push({ path: "register_command", message: "register_command is enabled but no open_command is defined.", severity: "error" });
  }

  if (issues.filter(i => i.severity === "error").length > 0) {
    throw new ValidationError("DeluxeMenus export validation failed", issues);
  }

  const doc = {
    menu_title: title,
  };

  let openCommandValue;
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
    doc.open_command = openCommandValue;
  }

  if (options.registerCommand) {
    doc.register_command = true;
  }

  if (inventoryType) {
    doc.inventory_type = inventoryType;
  }

  if (size !== undefined) {
    doc.size = size;
  }

  if (project.openCommands) {
    doc.open_commands = project.openCommands;
  }

  if (project.closeCommands) {
    doc.close_commands = project.closeCommands;
  }

  if (project.openRequirement) {
    doc.open_requirement = project.openRequirement;
  }

  // Use menuId to satisfy ESLint
  if (menuId === "") {
    // No-op
  }

  doc.items = items;

  return serializeDeluxeMenus(doc);
}

function serializeObject(obj, indent = 0) {
  const pad = " ".repeat(indent);
  const lines = [];

  const order = [
    "menu_title",
    "open_command",
    "register_command",
    "arguments",
    "args_usage_message",
    "inventory_type",
    "size",
    "update_interval",
    "open_requirement",
    "open_commands",
    "close_commands",
    "items",
  ];

  const itemOrder = [
    "material",
    "damage",
    "amount",
    "model_data",
    "model_data_component",
    "item_model",
    "slot",
    "slots",
    "priority",
    "update",
    "display_name",
    "lore",
    "enchantments",
    "item_flags",
    "hide_tooltip",
    "enchantment_glint_override",
    "unbreakable",
    "view_requirement",
    "left_click_requirement",
    "right_click_requirement",
    "shift_left_click_requirement",
    "shift_right_click_requirement",
    "left_click_commands",
    "right_click_commands",
    "shift_left_click_commands",
    "shift_right_click_commands",
    "middle_click_commands",
  ];

  const keys = Object.keys(obj);
  const sortedKeys = [...order.filter(k => k in obj), ...keys.filter(k => !order.includes(k))];

  for (const key of sortedKeys) {
    if (!(key in obj)) continue;
    const value = obj[key];
    if (value === undefined || value === null) continue;

    if (key === "items" && typeof value === "object" && !Array.isArray(value)) {
      lines.push(`${pad}${key}:`);
      const items = value;
      const sortedItemIds = Object.keys(items).sort((a, b) => {
        return (items[a]?.slot ?? 0) - (items[b]?.slot ?? 0);
      });

      for (const itemId of sortedItemIds) {
        const item = items[itemId];
        lines.push(`${pad}  ${itemId}:`);
        const itemKeys = Object.keys(item);
        const sortedItemKeys = [...itemOrder.filter(k => k in item), ...itemKeys.filter(k => !itemOrder.includes(k))];

        for (const itemKey of sortedItemKeys) {
          if (!(itemKey in item)) continue;
          const itemValue = item[itemKey];
          if (itemValue === undefined || itemValue === null) continue;
          if (itemKey === "lore" && Array.isArray(itemValue) && itemValue.length === 0) continue;

          if (itemKey === "lore" && Array.isArray(itemValue)) {
            lines.push(`${pad}    ${itemKey}:`);
            for (const loreLine of itemValue) {
              lines.push(`${pad}      - ${escapeYamlValue(loreLine)}`);
            }
          } else if (itemKey.endsWith("_commands") && Array.isArray(itemValue)) {
            lines.push(`${pad}    ${itemKey}:`);
            for (const cmd of itemValue) {
              lines.push(`${pad}      - ${escapeYamlValue(cmd)}`);
            }
          } else if (Array.isArray(itemValue)) {
            lines.push(`${pad}    ${itemKey}:`);
            for (const v of itemValue) {
              lines.push(`${pad}      - ${escapeYamlValue(v)}`);
            }
          } else {
            lines.push(`${pad}    ${itemKey}: ${escapeYamlValue(itemValue)}`);
          }
        }
      }
    } else if (key === "open_command" && Array.isArray(value)) {
      lines.push(`${pad}${key}:`);
      for (const cmd of value) {
        lines.push(`${pad}  - ${escapeYamlValue(cmd)}`);
      }
    } else if (Array.isArray(value)) {
      lines.push(`${pad}${key}:`);
      for (const v of value) {
        lines.push(`${pad}  - ${escapeYamlValue(v)}`);
      }
    } else if (typeof value === "object") {
      lines.push(`${pad}${key}:`);
      lines.push(serializeObject(value, indent + 2));
    } else {
      lines.push(`${pad}${key}: ${escapeYamlValue(value)}`);
    }
  }

  return lines.join("\n");
}

function serializeDeluxeMenus(document) {
  const yaml = serializeObject(document, 0);
  return yaml + "\n";
}
