import type { JsonGuiExport, ExportValidationResult, ExportValidationIssue, DeluxeMenusExportOptions } from "./deluxemenusTypes";
import { DELUXEMENUS_SUPPORTED_INVENTORY_TYPES, DELUXEMENUS_VALID_SIZES } from "./deluxemenusTypes";

export function validateDeluxeMenusExport(
  input: JsonGuiExport,
  options: DeluxeMenusExportOptions = {}
): ExportValidationResult {
  const issues: ExportValidationIssue[] = [];

  if (input.container.bukkitId === "CHEST") {
    if (!DELUXEMENUS_VALID_SIZES.includes(input.container.slots as typeof DELUXEMENUS_VALID_SIZES[number])) {
      issues.push({
        path: "container.slots",
        message: `Chest size must be one of: ${DELUXEMENUS_VALID_SIZES.join(", ")}. Got ${input.container.slots}.`,
        severity: "error",
      });
    }
  } else if (!DELUXEMENUS_SUPPORTED_INVENTORY_TYPES.has(input.container.bukkitId)) {
    issues.push({
      path: "container.bukkitId",
      message: `Inventory type '${input.container.bukkitId}' is not supported by DeluxeMenus.`,
      severity: "error",
    });
  }

  const slotGroups = new Map<number, typeof input.items>();
  for (const item of input.items) {
    const itemRecord = item as unknown as Record<string, unknown>;
    const itemSlots = itemRecord["slots"] !== undefined && Array.isArray(itemRecord["slots"]) 
      ? (itemRecord["slots"] as number[]) 
      : [item.slot];
    for (const s of itemSlots) {
      const list = slotGroups.get(s) || [];
      list.push(item);
      slotGroups.set(s, list);
    }
  }

  for (const [slotNum, items] of slotGroups.entries()) {
    if (items.length > 1) {
      const allHavePriorityAndViewReq = items.every(item => item.priority !== undefined && item.viewRequirement !== undefined);
      if (!allHavePriorityAndViewReq) {
        issues.push({
          path: `items[${slotNum}]`,
          message: `Duplicate slot ${slotNum} without priority and view_requirement. Items will overlap or override unpredictably.`,
          severity: "warning",
        });
      }
    }
  }

  const checkPapi = (textVal: string, keyPath: string) => {
    if (textVal && /%[a-zA-Z0-9_]+%/.test(textVal)) {
      issues.push({
        path: keyPath,
        message: `Value contains PlaceholderAPI placeholder. Ensure the expansion is installed on the server.`,
        severity: "warning",
      });
    }
  };

  const checkDelay = (actionList: string[] | undefined, pathPrefix: string) => {
    if (!actionList) return;
    for (let i = 0; i < actionList.length; i++) {
      const cmd = actionList[i];
      const delayMatch = cmd.match(/<delay=([^>]+)>/);
      if (delayMatch) {
        const val = delayMatch[1];
        if (!/^\d+$/.test(val)) {
          issues.push({
            path: `${pathPrefix}[${i}]`,
            message: `Action delay must be a non-negative integer. Got '${val}'.`,
            severity: "error",
          });
        }
      }
    }
  };

  for (const item of input.items) {
    const itemRecord = item as unknown as Record<string, unknown>;
    const itemSlots = itemRecord["slots"] !== undefined && Array.isArray(itemRecord["slots"]) 
      ? (itemRecord["slots"] as number[]) 
      : [item.slot];
    
    for (const s of itemSlots) {
      if (s < 0) {
        issues.push({
          path: `items[${item.slot}]`,
          message: `Slot ${s} cannot be negative.`,
          severity: "error",
        });
      } else if (s >= input.container.slots) {
        issues.push({
          path: `items[${item.slot}]`,
          message: `Slot ${s} exceeds container size (${input.container.slots} slots).`,
          severity: "error",
        });
      }
    }

    if (!item.material) {
      issues.push({
        path: `items[${item.slot}].material`,
        message: `Material is required.`,
        severity: "error",
      });
    }

    if (!item.displayName) {
      issues.push({
        path: `items[${item.slot}].displayName`,
        message: `Item at slot ${item.slot} has no display name.`,
        severity: "warning",
      });
    } else {
      checkPapi(item.displayName, `items[${item.slot}].displayName`);
    }

    if (item.lore) {
      for (let i = 0; i < item.lore.length; i++) {
        checkPapi(item.lore[i], `items[${item.slot}].lore[${i}]`);
      }
    }

    if (item.action) {
      if (item.action.command) {
        checkPapi(item.action.command, `items[${item.slot}].action.command`);
      }
      if (item.action.message) {
        checkPapi(item.action.message, `items[${item.slot}].action.message`);
      }
    }

    if (itemRecord["leftClickCommands"]) checkDelay(itemRecord["leftClickCommands"] as string[], `items[${item.slot}].leftClickCommands`);
    if (itemRecord["rightClickCommands"]) checkDelay(itemRecord["rightClickCommands"] as string[], `items[${item.slot}].rightClickCommands`);
    if (itemRecord["shiftLeftClickCommands"]) checkDelay(itemRecord["shiftLeftClickCommands"] as string[], `items[${item.slot}].shiftLeftClickCommands`);
    if (itemRecord["shiftRightClickCommands"]) checkDelay(itemRecord["shiftRightClickCommands"] as string[], `items[${item.slot}].shiftRightClickCommands`);
    if (itemRecord["middleClickCommands"]) checkDelay(itemRecord["middleClickCommands"] as string[], `items[${item.slot}].middleClickCommands`);

    if (item.action.type === "prompt_only") {
      issues.push({
        path: `items[${item.slot}].action`,
        message: `Item has no runtime action.`,
        severity: "warning",
      });
    }
  }

  if (options.openCommand) {
    if (options.openCommand.includes(" ") || options.openCommand.includes("/")) {
      issues.push({
        path: "open_command",
        message: `Open command must be a single word without slashes or spaces.`,
        severity: "error",
      });
    }
  } else {
    issues.push({
      path: "open_command",
      message: `No open command defined. Menu will not be accessible via command.`,
      severity: "warning",
    });
  }

  if (options.registerCommand && !options.openCommand) {
    issues.push({
      path: "register_command",
      message: `register_command is enabled but no open_command is defined.`,
      severity: "error",
    });
  }

  return {
    valid: issues.filter(i => i.severity === "error").length === 0,
    issues,
  };
}
