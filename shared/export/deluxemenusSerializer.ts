import type { DeluxeMenusDocument, DeluxeMenusItem } from "./deluxemenusTypes";

function serializeValue(value: unknown, indent: number = 0): string {
  const pad = " ".repeat(indent);
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    if (value === "") return '""';
    if (/^[0-9]+$/.test(value)) return `"${value}"`;
    if (/^(true|false|null|yes|no|on|off)$/i.test(value)) return `"${value}"`;
    if (/[:{}[\] ,&*?|>!%@`#-]/.test(value) || value.includes("\n") || value.trim() !== value) {
      return `'${value.replace(/'/g, "''")}'`;
    }
    return `"${value}"`;
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map(item => `${pad}- ${serializeValue(item, 0)}`).join("\n");
  }
  if (typeof value === "object") return serializeObject(value as Record<string, unknown>, indent);
  return String(value);
}

function serializeObject(obj: Record<string, unknown>, indent: number = 0): string {
  const pad = " ".repeat(indent);
  const lines: string[] = [];

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
      const items = value as Record<string, DeluxeMenusItem>;
      const sortedItemIds = Object.keys(items).sort((a, b) => {
        const itemA = items[a];
        const itemB = items[b];
        const slotA = itemA?.slot !== undefined ? itemA.slot : (itemA?.slots?.[0] ?? 0);
        const slotB = itemB?.slot !== undefined ? itemB.slot : (itemB?.slots?.[0] ?? 0);
        return slotA - slotB;
      });

      for (const itemId of sortedItemIds) {
        const item = items[itemId];
        lines.push(`${pad}  ${itemId}:`);
        const itemKeys = Object.keys(item);
        const sortedItemKeys = [...itemOrder.filter(k => k in item), ...itemKeys.filter(k => !itemOrder.includes(k))];

        for (const itemKey of sortedItemKeys) {
          if (!(itemKey in item)) continue;
          const itemValue = item[itemKey as keyof DeluxeMenusItem];
          if (itemValue === undefined || itemValue === null) continue;
          if (itemKey === "lore" && Array.isArray(itemValue) && itemValue.length === 0) continue;

          if (itemKey === "lore" && Array.isArray(itemValue)) {
            lines.push(`${pad}    ${itemKey}:`);
            for (const loreLine of itemValue) {
              lines.push(`${pad}      - ${serializeValue(loreLine)}`);
            }
          } else if (itemKey.endsWith("_commands") && Array.isArray(itemValue)) {
            lines.push(`${pad}    ${itemKey}:`);
            for (const cmd of itemValue) {
              lines.push(`${pad}      - ${serializeValue(cmd)}`);
            }
          } else if (Array.isArray(itemValue)) {
            lines.push(`${pad}    ${itemKey}:`);
            for (const v of itemValue) {
              lines.push(`${pad}      - ${serializeValue(v)}`);
            }
          } else {
            lines.push(`${pad}    ${itemKey}: ${serializeValue(itemValue as unknown)}`);
          }
        }
      }
    } else if (key === "open_command" && Array.isArray(value)) {
      lines.push(`${pad}${key}:`);
      for (const cmd of value) {
        lines.push(`${pad}  - ${serializeValue(cmd)}`);
      }
    } else if (Array.isArray(value)) {
      lines.push(`${pad}${key}:`);
      for (const v of value) {
        lines.push(`${pad}  - ${serializeValue(v)}`);
      }
    } else if (typeof value === "object") {
      lines.push(`${pad}${key}:`);
      lines.push(serializeObject(value as Record<string, unknown>, indent + 2));
    } else {
      lines.push(`${pad}${key}: ${serializeValue(value)}`);
    }
  }

  return lines.join("\n");
}

export function serializeDeluxeMenus(document: DeluxeMenusDocument): string {
  const yaml = serializeObject(document as unknown as Record<string, unknown>, 0);
  return yaml + "\n";
}
