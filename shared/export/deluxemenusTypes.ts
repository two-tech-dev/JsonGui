export type DeluxeMenusClickType = "left_click" | "right_click" | "shift_left_click" | "shift_right_click" | "middle_click";

export type DeluxeMenusActionType =
  | "[openguimenu]"
  | "[player]"
  | "[console]"
  | "[close]"
  | "[message]"
  | "[sound]"
  | "[refresh]"
  | "[connect]"
  | "[broadcast]"
  | "[give]"
  | "[take]"
  | "[bungee]"
  | "[paywall]"
  | "[jsonmessage]";

export interface DeluxeMenusAction {
  type: DeluxeMenusActionType;
  value?: string;
}

export interface DeluxeMenusItem {
  material: string;
  amount?: number;
  damage?: number;
  model_data?: number;
  model_data_component?: Record<string, unknown>;
  item_model?: string;
  slot?: number;
  slots?: number[];
  priority?: number;
  update?: boolean;
  display_name?: string;
  lore?: string[];
  enchantments?: string[];
  item_flags?: string[];
  hide_tooltip?: boolean;
  enchantment_glint_override?: boolean;
  unbreakable?: boolean;
  hide_attributes?: boolean;
  hide_enchantments?: boolean;
  left_click_commands?: string[];
  right_click_commands?: string[];
  shift_left_click_commands?: string[];
  shift_right_click_commands?: string[];
  middle_click_commands?: string[];
  view_requirement?: Record<string, unknown>;
  left_click_requirement?: Record<string, unknown>;
  right_click_requirement?: Record<string, unknown>;
  shift_left_click_requirement?: Record<string, unknown>;
  shift_right_click_requirement?: Record<string, unknown>;
}

export interface DeluxeMenusDocument {
  menu_title: string;
  open_command?: string | string[];
  register_command?: boolean;
  inventory_type?: string;
  size?: number;
  update_interval?: number;
  open_requirement?: Record<string, unknown>;
  open_commands?: string[];
  close_commands?: string[];
  items: Record<string, DeluxeMenusItem>;
}

export type JsonGuiActionType =
  | "prompt_only"
  | "close_inventory"
  | "open_gui"
  | "run_command"
  | "give_item"
  | "teleport"
  | "send_message"
  | "player_command"
  | "console_command"
  | "sound"
  | "refresh"
  | "connect"
  | "close";

export interface JsonGuiAction {
  type: JsonGuiActionType;
  guiId?: string;
  command?: string;
  message?: string;
  material?: string;
  amount?: number;
  world?: string;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  pitch?: number;
  sound?: string;
  volume?: number;
  server?: string;
}

export interface JsonGuiPlacedItem {
  slot: number;
  itemId: string;
  material: string;
  amount: number;
  displayName: string;
  lore: string[];
  prompt: string;
  action: JsonGuiAction;
  developerNotes?: string;
  includeInExport?: boolean;
  damage?: number;
  modelData?: number;
  modelDataComponent?: Record<string, unknown>;
  itemModel?: string;
  priority?: number;
  update?: boolean;
  slots?: number[];
  enchantments?: string[];
  itemFlags?: string[];
  hideTooltip?: boolean;
  enchantmentGlintOverride?: boolean;
  unbreakable?: boolean;
  hideAttributes?: boolean;
  hideEnchantments?: boolean;
  rightClickCommands?: string[];
  shiftLeftClickCommands?: string[];
  shiftRightClickCommands?: string[];
  middleClickCommands?: string[];
  viewRequirement?: Record<string, unknown>;
  leftClickRequirement?: Record<string, unknown>;
  rightClickRequirement?: Record<string, unknown>;
  shiftLeftClickRequirement?: Record<string, unknown>;
  shiftRightClickRequirement?: Record<string, unknown>;
}

export interface JsonGuiMenuConfig {
  updateInterval?: number;
  openCommands?: string[];
  closeCommands?: string[];
  openRequirement?: Record<string, unknown>;
}

export interface JsonGuiContainer {
  id: string;
  bukkitId: string;
  slots: number;
  rows: number;
  columns: number;
  kind: "grid" | "hopper" | "special";
  compatibility: "Direct" | "Special" | "Unavailable";
}

export interface JsonGuiExport extends JsonGuiMenuConfig {
  format: string;
  formatVersion: number;
  catalogVersion: string;
  container: JsonGuiContainer;
  title: string;
  items: JsonGuiPlacedItem[];
}

export interface ExportValidationIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export interface ExportValidationResult {
  valid: boolean;
  issues: ExportValidationIssue[];
}

export interface DeluxeMenusExportOptions {
  menuId?: string;
  openCommand?: string;
  registerCommand?: boolean;
  includePrompts?: boolean;
  includeDeveloperNotes?: boolean;
  emitEmptyOpenCommand?: boolean;
}

export const DELUXEMENUS_SUPPORTED_INVENTORY_TYPES = new Set([
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

export const DELUXEMENUS_VALID_SIZES = [9, 18, 27, 36, 45, 54] as const;
