export type ItemCategory = "Tools" | "Decoration" | "Combat" | "Food" | "Redstone" | "Utility" | "Misc";
export type PreviewMode = "editor" | "minecraft";
export type Overlay = "drawer" | "container" | "export" | "placed" | "library" | null;
export type EditorTarget = { kind: "library"; itemId: string } | { kind: "placement"; slot: number } | null;

export interface ContainerSpec { id: string; label: string; bukkitId: string; slots: number; rows: number; columns: number; kind: "grid" | "hopper" | "special"; compatibility: "Direct" | "Special" | "Unavailable"; category: "Storage" | "Processing" | "Utility" | "Entity"; role?: string; }
export interface ItemDefinition { id: string; name: string; material: string; category: ItemCategory; icon: string; maxStack: number; description: string; }
export type ItemAction =
  | { type: "prompt_only" }
  | { type: "close_inventory" }
  | { type: "open_gui"; guiId: string }
  | { type: "run_command"; command: string }
  | { type: "give_item"; material: string; amount: number }
  | { type: "teleport"; world: string; x: number; y: number; z: number; yaw?: number; pitch?: number }
  | { type: "send_message"; message: string };
export interface DeluxeMenusItemConfig {
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
export interface DeluxeMenusMenuConfig { openCommand?: string; registerCommand?: boolean; updateInterval?: number; openCommands?: string[]; closeCommands?: string[]; openRequirement?: Record<string, unknown>; }
export interface ItemDefault { action: ItemAction; developerNotes?: string; }
export interface PlacedItem extends DeluxeMenusItemConfig { slot: number; itemId: string; amount: number; displayName: string; lore: string[]; action: ItemAction; developerNotes?: string; includeInExport?: boolean; locked?: boolean; }
export interface ProjectDocument { schemaVersion: 1; id: string; revision: number; catalogVersion: string; title: string; description: string; containerId: string; jsonSkillId?: string; itemDefaults: Record<string, ItemDefault>; placements: PlacedItem[]; deluxeMenus?: DeluxeMenusMenuConfig; updatedAt: string; }

const IMPORT_LIMITS = { title: 120, displayName: 120, loreLine: 200, loreLines: 20, actionText: 500, enchantment: 120, itemFlag: 120, command: 500 };
const DELUXE_ITEM_KEYS = ["damage", "modelData", "modelDataComponent", "itemModel", "priority", "update", "slots", "enchantments", "itemFlags", "hideTooltip", "enchantmentGlintOverride", "unbreakable", "hideAttributes", "hideEnchantments", "rightClickCommands", "shiftLeftClickCommands", "shiftRightClickCommands", "middleClickCommands", "viewRequirement", "leftClickRequirement", "rightClickRequirement", "shiftLeftClickRequirement", "shiftRightClickRequirement"] as const;

function importObject(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function importText(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== "string" || (required && !value.trim())) throw new Error(`${label} không hợp lệ`);
  if (value.length > max) throw new Error(`${label} quá dài`);
  return value;
}
function importInteger(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${label} không hợp lệ`);
  return value as number;
}
function cloneDeluxeMenusItemConfig(value: Record<string, unknown> | DeluxeMenusItemConfig | undefined): DeluxeMenusItemConfig {
  if (!value) return {};
  const config: DeluxeMenusItemConfig = {};
  for (const key of DELUXE_ITEM_KEYS) if (value[key] !== undefined) (config as Record<string, unknown>)[key] = structuredClone(value[key]);
  return config;
}
function cloneDeluxeMenusMenuConfig(value: DeluxeMenusMenuConfig | undefined): DeluxeMenusMenuConfig {
  return value ? structuredClone(value) : {};
}
function validateStringList(value: unknown, label: string, maxLength: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 64 || value.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > maxLength)) throw new Error(`${label} không hợp lệ`);
  return value as string[];
}
function validateDeluxeMenusItemConfig(config: DeluxeMenusItemConfig, container?: ContainerSpec): void {
  const enchantments = validateStringList(config.enchantments, "DeluxeMenus enchantments", IMPORT_LIMITS.enchantment);
  if (enchantments?.some((entry) => !/^\S+;[1-9]\d*$/.test(entry))) throw new Error("Enchantment phải có dạng NAME;LEVEL");
  validateStringList(config.itemFlags, "DeluxeMenus item flags", IMPORT_LIMITS.itemFlag);
  validateStringList(config.rightClickCommands, "DeluxeMenus right click commands", IMPORT_LIMITS.command);
  validateStringList(config.shiftLeftClickCommands, "DeluxeMenus shift left commands", IMPORT_LIMITS.command);
  validateStringList(config.shiftRightClickCommands, "DeluxeMenus shift right commands", IMPORT_LIMITS.command);
  validateStringList(config.middleClickCommands, "DeluxeMenus middle click commands", IMPORT_LIMITS.command);
  for (const [label, value] of [["damage", config.damage], ["model data", config.modelData], ["priority", config.priority]] as const) if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new Error(`DeluxeMenus ${label} không hợp lệ`);
  if (config.update !== undefined && typeof config.update !== "boolean") throw new Error("DeluxeMenus update không hợp lệ");
  for (const value of [config.hideTooltip, config.enchantmentGlintOverride, config.unbreakable, config.hideAttributes, config.hideEnchantments]) if (value !== undefined && typeof value !== "boolean") throw new Error("DeluxeMenus appearance option không hợp lệ");
  if (config.itemModel !== undefined && (typeof config.itemModel !== "string" || !config.itemModel.trim() || config.itemModel.length > 240)) throw new Error("DeluxeMenus item model không hợp lệ");
  if (config.slots !== undefined && (!Array.isArray(config.slots) || config.slots.length === 0 || config.slots.some((slot) => !Number.isInteger(slot) || slot < 0 || (container && slot >= container.slots)))) throw new Error("DeluxeMenus slots không hợp lệ");
  for (const value of [config.modelDataComponent, config.viewRequirement, config.leftClickRequirement, config.rightClickRequirement, config.shiftLeftClickRequirement, config.shiftRightClickRequirement]) if (value !== undefined && !importObject(value)) throw new Error("DeluxeMenus requirement không hợp lệ");
}
function validateDeluxeMenusMenuConfig(config: DeluxeMenusMenuConfig): void {
  if (config.openCommand !== undefined && (typeof config.openCommand !== "string" || config.openCommand.includes("/") || /\s/.test(config.openCommand))) throw new Error("Open command không hợp lệ");
  if (config.registerCommand !== undefined && typeof config.registerCommand !== "boolean") throw new Error("Register command không hợp lệ");
  if (config.updateInterval !== undefined && (!Number.isInteger(config.updateInterval) || config.updateInterval < 1)) throw new Error("Update interval không hợp lệ");
  validateStringList(config.openCommands, "Open commands", IMPORT_LIMITS.command);
  validateStringList(config.closeCommands, "Close commands", IMPORT_LIMITS.command);
  if (config.openRequirement !== undefined && !importObject(config.openRequirement)) throw new Error("Open requirement không hợp lệ");
}
function importAction(value: unknown, catalogByMaterial: Map<string, ItemDefinition>): ItemAction {
  const action = importObject(value);
  if (!action || typeof action.type !== "string") throw new Error("Action không hợp lệ");
  const allowedFields: Record<string, string[]> = { prompt_only: ["type"], close_inventory: ["type"], open_gui: ["type", "guiId"], run_command: ["type", "command"], send_message: ["type", "message"], give_item: ["type", "material", "amount"], teleport: ["type", "world", "x", "y", "z", "yaw", "pitch"] };
  const allowed = allowedFields[action.type];
  if (!allowed) throw new Error("Action không được hỗ trợ");
  if (Object.keys(action).some((key) => !allowed.includes(key))) throw new Error("Action chứa trường không được hỗ trợ");
  switch (action.type) {
    case "prompt_only": return { type: "prompt_only" };
    case "close_inventory": return { type: "close_inventory" };
    case "open_gui": return { type: "open_gui", guiId: importText(action.guiId, "GUI ID", 120) };
    case "run_command": return { type: "run_command", command: importText(action.command, "Command", IMPORT_LIMITS.actionText) };
    case "send_message": return { type: "send_message", message: importText(action.message, "Message", IMPORT_LIMITS.actionText) };
    case "give_item": { const material = importText(action.material, "Action material", 120); if (!catalogByMaterial.has(material)) throw new Error("Action material không có trong catalog"); return { type: "give_item", material, amount: importInteger(action.amount, "Action amount", 1, 64) }; }
    case "teleport": { const finite = (entry: unknown, label: string) => { if (typeof entry !== "number" || !Number.isFinite(entry)) throw new Error(`${label} không hợp lệ`); return entry; }; return { type: "teleport", world: importText(action.world, "World", 120), x: finite(action.x, "X"), y: finite(action.y, "Y"), z: finite(action.z, "Z"), ...(action.yaw === undefined ? {} : { yaw: finite(action.yaw, "Yaw") }), ...(action.pitch === undefined ? {} : { pitch: finite(action.pitch, "Pitch") }) }; }
  }
  throw new Error("Action không được hỗ trợ");
}

export const CONTAINERS: ContainerSpec[] = [
  { id: "double-chest", label: "Generic 54", bukkitId: "CHEST", slots: 54, rows: 6, columns: 9, kind: "grid", compatibility: "Direct", category: "Storage" },
  { id: "single-chest", label: "Generic 27", bukkitId: "CHEST", slots: 27, rows: 3, columns: 9, kind: "grid", compatibility: "Direct", category: "Storage" },
  { id: "barrel", label: "Barrel", bukkitId: "BARREL", slots: 27, rows: 3, columns: 9, kind: "grid", compatibility: "Direct", category: "Storage" },
  { id: "shulker", label: "Shulker Box", bukkitId: "SHULKER_BOX", slots: 27, rows: 3, columns: 9, kind: "grid", compatibility: "Direct", category: "Storage" },
  { id: "hopper", label: "Hopper", bukkitId: "HOPPER", slots: 5, rows: 1, columns: 5, kind: "hopper", compatibility: "Direct", category: "Storage" },
  { id: "dispenser", label: "Dispenser", bukkitId: "DISPENSER", slots: 9, rows: 3, columns: 3, kind: "grid", compatibility: "Direct", category: "Utility" },
  { id: "dropper", label: "Dropper", bukkitId: "DROPPER", slots: 9, rows: 3, columns: 3, kind: "grid", compatibility: "Direct", category: "Utility" },
  { id: "furnace", label: "Furnace", bukkitId: "FURNACE", slots: 3, rows: 1, columns: 3, kind: "special", compatibility: "Special", category: "Processing", role: "Input · Fuel · Result" },
  { id: "blast-furnace", label: "Blast Furnace", bukkitId: "BLAST_FURNACE", slots: 3, rows: 1, columns: 3, kind: "special", compatibility: "Special", category: "Processing", role: "Input · Fuel · Result" },
  { id: "smoker", label: "Smoker", bukkitId: "SMOKER", slots: 3, rows: 1, columns: 3, kind: "special", compatibility: "Special", category: "Processing", role: "Input · Fuel · Result" },
  { id: "brewing", label: "Brewing Stand", bukkitId: "BREWING", slots: 5, rows: 1, columns: 5, kind: "special", compatibility: "Special", category: "Processing", role: "Bottles · Ingredient · Fuel" },
  { id: "anvil", label: "Anvil", bukkitId: "ANVIL", slots: 3, rows: 1, columns: 3, kind: "special", compatibility: "Special", category: "Processing", role: "Input · Input · Result" },
  { id: "grindstone", label: "Grindstone", bukkitId: "GRINDSTONE", slots: 3, rows: 1, columns: 3, kind: "special", compatibility: "Special", category: "Processing", role: "Input · Input · Result" },
  { id: "smithing", label: "Smithing Table", bukkitId: "SMITHING", slots: 4, rows: 1, columns: 4, kind: "special", compatibility: "Special", category: "Processing", role: "Template · Input · Material · Result" },
  { id: "workbench", label: "Crafting Table", bukkitId: "WORKBENCH", slots: 10, rows: 3, columns: 4, kind: "special", compatibility: "Special", category: "Utility", role: "Crafting · Result" },
  { id: "cartography", label: "Cartography Table", bukkitId: "CARTOGRAPHY", slots: 3, rows: 1, columns: 3, kind: "special", compatibility: "Special", category: "Utility", role: "Map · Paper · Result" },
  { id: "stonecutter", label: "Stonecutter", bukkitId: "STONECUTTER", slots: 2, rows: 1, columns: 2, kind: "special", compatibility: "Special", category: "Utility", role: "Input · Result" },
  { id: "enchanting", label: "Enchanting Table", bukkitId: "ENCHANTING", slots: 2, rows: 1, columns: 2, kind: "special", compatibility: "Special", category: "Utility", role: "Item · Lapis" },
  { id: "loom", label: "Loom", bukkitId: "LOOM", slots: 4, rows: 1, columns: 4, kind: "special", compatibility: "Special", category: "Utility", role: "Banner · Dye · Pattern · Result" },
  { id: "horse", label: "Horse Inventory", bukkitId: "HORSE", slots: 17, rows: 3, columns: 5, kind: "special", compatibility: "Special", category: "Entity", role: "Saddle · Armor · Storage" },
  { id: "merchant", label: "Villager Trading", bukkitId: "MERCHANT", slots: 3, rows: 1, columns: 3, kind: "special", compatibility: "Special", category: "Entity", role: "Input · Input · Result" },
  { id: "creative", label: "Creative Inventory", bukkitId: "CREATIVE", slots: 0, rows: 0, columns: 0, kind: "special", compatibility: "Unavailable", category: "Utility" },
];

export function isCanonicalGuiExport(value: unknown): boolean { const data = importObject(value); return data?.format === "gui-forge/minecraft-java-gui" && data.formatVersion === 1; }
export function canonicalExportToProject(value: unknown, base: Pick<ProjectDocument, "id" | "revision" | "description">, catalog: ItemDefinition[]): ProjectDocument {
  const data = importObject(value);
  if (!data || !isCanonicalGuiExport(data)) throw new Error("Định dạng JsonGui export không được hỗ trợ");
  const catalogVersion = importText(data.catalogVersion, "Catalog version", 200); const title = importText(data.title, "Tiêu đề GUI", IMPORT_LIMITS.title);
  const sourceContainer = importObject(data.container); const containerId = typeof sourceContainer?.id === "string" ? sourceContainer.id : ""; const container = CONTAINERS.find((entry) => entry.id === containerId);
  if (!container || container.compatibility === "Unavailable" || sourceContainer?.bukkitType !== container.bukkitId || sourceContainer.rows !== container.rows || sourceContainer.slots !== container.slots) throw new Error("Container không hợp lệ");
  if (!Array.isArray(data.items) || data.items.length > container.slots) throw new Error("Danh sách item không hợp lệ");
  const catalogById = new Map(catalog.map((item) => [item.id, item])); const catalogByMaterial = new Map(catalog.map((item) => [item.material, item])); const slots = new Set<number>();
  const placements = data.items.map((entry, index) => {
    const item = importObject(entry); if (!item) throw new Error(`Item ${index + 1} không hợp lệ`);
    const slot = importInteger(item.slot, `Slot ${index + 1}`, 0, container.slots - 1); if (slots.has(slot)) throw new Error(`Slot ${slot} bị trùng`); slots.add(slot);
    const itemId = importText(item.itemId, `Item ID ${index + 1}`, 200); const definition = catalogById.get(itemId); if (!definition) throw new Error(`Item ${itemId} không có trong catalog`); if (item.material !== definition.material) throw new Error(`Material của ${itemId} không khớp catalog`);
    const amount = importInteger(item.amount, `Số lượng item ${index + 1}`, 1, definition.maxStack); const displayName = importText(item.displayName, `Tên item ${index + 1}`, IMPORT_LIMITS.displayName);
    if (!Array.isArray(item.lore) || item.lore.length > IMPORT_LIMITS.loreLines) throw new Error(`Lore item ${index + 1} không hợp lệ`);
    const lore = item.lore.map((line, loreIndex) => importText(line, `Lore ${index + 1}.${loreIndex + 1}`, IMPORT_LIMITS.loreLine));
    const deluxeMenus = cloneDeluxeMenusItemConfig(item); validateDeluxeMenusItemConfig(deluxeMenus, container);
    return { slot, itemId, amount, displayName, lore, action: importAction(item.action, catalogByMaterial), includeInExport: true, ...deluxeMenus } satisfies PlacedItem;
  });
  const sourceDeluxeMenus = importObject(data.deluxeMenus); const deluxeMenus = sourceDeluxeMenus ? structuredClone(sourceDeluxeMenus) as DeluxeMenusMenuConfig : undefined; if (deluxeMenus) validateDeluxeMenusMenuConfig(deluxeMenus);
  return { schemaVersion: 1, id: base.id, revision: base.revision, catalogVersion, title, description: base.description, containerId: container.id, itemDefaults: {}, placements, ...(deluxeMenus ? { deluxeMenus } : {}), updatedAt: new Date().toISOString() };
}

export const FALLBACK_ITEMS: ItemDefinition[] = [];
const defaultAction: ItemAction = { type: "prompt_only" };
export interface EditorState {
  projectId: string; revision: number; catalogVersion: string; catalog: ItemDefinition[]; title: string; description: string; jsonSkillId?: string; container: ContainerSpec; placements: Record<number, PlacedItem>; itemDefaults: Record<string, ItemDefault>; deluxeMenus: DeluxeMenusMenuConfig;
  favorites: string[]; recentItemIds: string[]; selectedSlot: number | null; selectedLibraryItemId: string | null; editorTarget: EditorTarget; query: string; category: ItemCategory | "All"; libraryTab: "All" | "Recent" | "Favorites";
  previewMode: PreviewMode; showSlotNumbers: boolean; showPlayerInventory: boolean; showRoles: boolean; zoom: 0.75 | 1 | 1.25 | 1.5; overlay: Overlay; drawerTab: "Details" | "DeluxeMenus" | "JSON";
  draftTitle: string; draftLore: string[]; draftDeveloperNotes: string; draftAction: ItemAction; draftDeluxeMenus: DeluxeMenusItemConfig;
  toast: { message: string; tone: "success" | "info" | "warning" | "error"; undo?: boolean } | null; dirty: boolean;
}
export const initialState: EditorState = {
  projectId: "main-menu", revision: 1, catalogVersion: "minecraft-java-1.21.8", catalog: FALLBACK_ITEMS, title: "Main Menu", description: "Menu chính cho server survival", container: CONTAINERS[0], placements: {}, itemDefaults: {}, deluxeMenus: {}, favorites: [], recentItemIds: [], selectedSlot: null, selectedLibraryItemId: null, editorTarget: null, query: "", category: "All", libraryTab: "All", previewMode: "editor", showSlotNumbers: true, showPlayerInventory: true, showRoles: true, zoom: 1, overlay: null, drawerTab: "Details", draftTitle: "", draftLore: [], draftDeveloperNotes: "", draftAction: defaultAction, draftDeluxeMenus: {}, toast: null, dirty: false,
};
export type Action =
  | { type: "HYDRATE"; project: ProjectDocument; catalog: ItemDefinition[]; dirty?: boolean }
  | { type: "LOAD_CATALOG"; catalog: ItemDefinition[]; version: string }
  | { type: "MARK_SAVED"; revision?: number }
  | { type: "SELECT_SLOT"; slot: number | null }
  | { type: "SELECT_LIBRARY"; itemId: string | null }
  | { type: "TOGGLE_FAVORITE"; itemId: string }
  | { type: "OPEN_EDITOR"; target: EditorTarget }
  | { type: "SET_QUERY"; query: string }
  | { type: "SET_CATEGORY"; category: EditorState["category"] }
  | { type: "SET_TAB"; tab: EditorState["libraryTab"] }
  | { type: "PLACE_ITEM"; slot: number; itemId: string; amount?: number }
  | { type: "MOVE_ITEM"; from: number; to: number }
  | { type: "REMOVE_ITEM"; slot: number }
  | { type: "SET_AMOUNT"; slot: number; amount: number }
  | { type: "SET_TITLE"; title: string }
  | { type: "SET_JSON_SKILL"; jsonSkillId?: string }
  | { type: "SET_DRAFT_TITLE"; title: string }
  | { type: "SET_DRAFT_LORE"; lore: string[] }
  | { type: "SET_DRAFT_NOTES"; notes: string }
  | { type: "SET_DRAFT_ACTION"; action: ItemAction }
  | { type: "SET_DRAFT_DELUXE_MENUS"; config: DeluxeMenusItemConfig }
  | { type: "SET_DELUXE_MENUS_MENU"; config: DeluxeMenusMenuConfig }
  | { type: "SAVE_ITEM" }
  | { type: "SET_OPTION"; option: "showSlotNumbers" | "showPlayerInventory" | "showRoles"; value: boolean }
  | { type: "SET_MODE"; mode: PreviewMode }
  | { type: "SET_ZOOM"; zoom: EditorState["zoom"] }
  | { type: "OPEN_OVERLAY"; overlay: Exclude<Overlay, null> }
  | { type: "CLOSE_OVERLAY" }
  | { type: "SET_DRAWER_TAB"; tab: EditorState["drawerTab"] }
  | { type: "SET_CONTAINER"; container: ContainerSpec }
  | { type: "SET_ITEM_LOCK"; slot: number; locked: boolean }
  | { type: "SET_ALL_ITEM_LOCKS"; locked: boolean }
  | { type: "RESET" }
  | { type: "TOAST"; toast: NonNullable<EditorState["toast"]> }
  | { type: "CLEAR_TOAST" }
  | { type: "RENAME_ITEM"; slot: number; name: string };

export function getItem(itemId: string, catalog: ItemDefinition[] = FALLBACK_ITEMS): ItemDefinition | undefined { return catalog.find((entry) => entry.id === itemId); }
export function isValidContainerSlot(slot: number, container: ContainerSpec): boolean { return Number.isInteger(slot) && slot >= 0 && slot < container.slots; }
export function getFilteredItems(state: EditorState): ItemDefinition[] { const tokens = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean); const favoriteIds = new Set(state.favorites); const recentIds = new Set(state.recentItemIds); return state.catalog.filter((entry) => { if (state.category !== "All" && entry.category !== state.category) return false; if (state.libraryTab === "Favorites" && !favoriteIds.has(entry.id)) return false; if (state.libraryTab === "Recent" && !recentIds.has(entry.id)) return false; const haystack = `${entry.id} ${entry.name} ${entry.material} ${entry.category} ${entry.description}`.toLowerCase(); return tokens.every((token) => haystack.includes(token)); }); }
export function trimForContainer(placements: Record<number, PlacedItem>, container: ContainerSpec): Record<number, PlacedItem> { return Object.fromEntries(Object.entries(placements).filter(([slot]) => Number.isInteger(Number(slot)) && Number(slot) < container.slots)); }
export function editorStateToProject(state: EditorState): ProjectDocument { return { schemaVersion: 1, id: state.projectId, revision: state.revision, catalogVersion: state.catalogVersion, title: state.title, description: state.description, containerId: state.container.id, ...(state.jsonSkillId ? { jsonSkillId: state.jsonSkillId } : {}), itemDefaults: state.itemDefaults, placements: Object.values(state.placements).sort((a, b) => a.slot - b.slot), ...(Object.keys(state.deluxeMenus).length ? { deluxeMenus: state.deluxeMenus } : {}), updatedAt: new Date().toISOString() }; }

export function categorizeItem(item: ItemDefinition): ItemCategory {
  const value = `${item.id} ${item.name} ${item.description}`.toLowerCase();
  if (/(sword|axe|bow|crossbow|trident|mace|spear|shield|helmet|chestplate|leggings|boots|elytra|totem)/.test(value)) return "Combat";
  if (/(pickaxe|shovel|hoe|shears|fishing_rod|flint_and_steel|brush|spyglass|compass|clock|lead|name_tag|map)/.test(value)) return "Tools";
  if (/(apple|bread|beef|porkchop|chicken|mutton|rabbit|cod|salmon|stew|soup|cookie|cake|carrot|potato|melon|berries|honey|kelp|beetroot|fish)/.test(value)) return "Food";
  if (/(redstone|repeater|comparator|piston|observer|hopper|dispenser|dropper|lever|button|pressure_plate|rail|tnt|sculk|copper_bulb)/.test(value)) return "Redstone";
  if (/(bucket|boat|minecart|chest|barrel|shulker|furnace|crafting|smithing|anvil|grindstone|loom|stonecutter|cartography|enchant|brewing|cauldron|beacon|potion|book|banner|sign|bed|spawn_egg)/.test(value)) return "Utility";
  if (/(block|planks|log|wood|leaves|sapling|flower|coral|glass|wool|terracotta|concrete|brick|stone|dirt|sand|gravel|ore|fence|door|trapdoor|slab|stairs|wall|lantern|torch|painting|frame|pot|carpet)/.test(value)) return "Decoration";
  return item.category;
}
export function projectToEditorState(project: ProjectDocument, catalog: ItemDefinition[]): EditorState {
  const container = CONTAINERS.find((entry) => entry.id === project.containerId) ?? CONTAINERS[0]; const placements = Object.fromEntries(project.placements.map((entry) => [entry.slot, entry])); const selectedSlot = project.placements[0]?.slot ?? null; const selected = selectedSlot === null ? undefined : placements[selectedSlot]; const categorizedCatalog = catalog.map((item) => ({ ...item, category: categorizeItem(item) }));
  return { ...initialState, projectId: project.id, revision: project.revision, catalogVersion: project.catalogVersion, catalog: categorizedCatalog, title: project.title, description: project.description, ...(project.jsonSkillId ? { jsonSkillId: project.jsonSkillId } : {}), container, placements, itemDefaults: project.itemDefaults ?? {}, deluxeMenus: cloneDeluxeMenusMenuConfig(project.deluxeMenus), selectedSlot, selectedLibraryItemId: selected?.itemId ?? null, editorTarget: selected ? { kind: "placement", slot: selected.slot } : null, draftTitle: selected?.displayName ?? "", draftLore: selected?.lore ?? [], draftDeveloperNotes: selected?.developerNotes ?? "", draftAction: selected?.action ?? defaultAction, draftDeluxeMenus: cloneDeluxeMenusItemConfig(selected), dirty: false };
}
export function buildExport(state: EditorState, options: { cancelItemMovement?: boolean } = {}): string {
  const items = Object.values(state.placements).filter((entry) => entry.includeInExport !== false && isValidContainerSlot(entry.slot, state.container)).sort((a, b) => a.slot - b.slot).map((entry) => { const definition = getItem(entry.itemId, state.catalog); const deluxeMenus = cloneDeluxeMenusItemConfig(entry); return { slot: entry.slot, itemId: entry.itemId, material: definition?.material ?? "UNKNOWN", amount: entry.amount, displayName: entry.displayName, lore: entry.lore, locked: entry.locked ?? true, action: entry.action, ...deluxeMenus }; });
  return JSON.stringify({ format: "gui-forge/minecraft-java-gui", formatVersion: 1, catalogVersion: state.catalogVersion, container: { id: state.container.id, bukkitType: state.container.bukkitId, rows: state.container.rows, slots: state.container.slots }, title: state.title, cancelItemMovement: options.cancelItemMovement ?? true, ...(Object.keys(state.deluxeMenus).length ? { deluxeMenus: state.deluxeMenus } : {}), items }, null, 2);
}

function draftForTarget(state: EditorState, target: EditorTarget): Pick<EditorState, "draftTitle" | "draftLore" | "draftDeveloperNotes" | "draftAction" | "draftDeluxeMenus"> {
  if (target?.kind === "placement") { const item = state.placements[target.slot]; return { draftTitle: item?.displayName ?? "", draftLore: item?.lore ?? [], draftDeveloperNotes: item?.developerNotes ?? "", draftAction: item?.action ?? defaultAction, draftDeluxeMenus: cloneDeluxeMenusItemConfig(item) }; }
  if (target?.kind === "library") { const definition = getItem(target.itemId, state.catalog); const defaults = state.itemDefaults[target.itemId]; return { draftTitle: definition?.name ?? "", draftLore: [], draftDeveloperNotes: defaults?.developerNotes ?? "", draftAction: defaults?.action ?? defaultAction, draftDeluxeMenus: {} }; }
  return { draftTitle: "", draftLore: [], draftDeveloperNotes: "", draftAction: defaultAction, draftDeluxeMenus: {} };
}
export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "HYDRATE": return { ...projectToEditorState(action.project, action.catalog), dirty: action.dirty ?? false };
    case "LOAD_CATALOG": return { ...state, catalog: action.catalog.map((item) => ({ ...item, category: categorizeItem(item) })), catalogVersion: action.version };
    case "MARK_SAVED": return { ...state, dirty: false, revision: action.revision ?? state.revision };
    case "SELECT_SLOT": { const target = action.slot !== null && state.placements[action.slot] ? { kind: "placement" as const, slot: action.slot } : null; const next = { ...state, selectedSlot: action.slot, selectedLibraryItemId: action.slot === null ? null : state.placements[action.slot]?.itemId ?? state.selectedLibraryItemId, editorTarget: target }; return { ...next, ...draftForTarget(next, target) }; }
    case "SELECT_LIBRARY": { if (!action.itemId) return { ...state, selectedLibraryItemId: null }; return { ...state, selectedLibraryItemId: action.itemId, recentItemIds: [action.itemId, ...state.recentItemIds.filter((id) => id !== action.itemId)].slice(0, 24) }; }
    case "TOGGLE_FAVORITE": return { ...state, favorites: state.favorites.includes(action.itemId) ? state.favorites.filter((id) => id !== action.itemId) : [...state.favorites, action.itemId] };
    case "OPEN_EDITOR": { const draft = draftForTarget(state, action.target); if (action.target?.kind === "placement") { const item = state.placements[action.target.slot]; return { ...state, selectedSlot: action.target.slot, selectedLibraryItemId: item?.itemId ?? null, editorTarget: action.target, overlay: "drawer", drawerTab: "Details", ...draft }; } if (action.target?.kind === "library") return { ...state, selectedLibraryItemId: action.target.itemId, editorTarget: action.target, overlay: "drawer", drawerTab: "Details", ...draft }; return { ...state, editorTarget: null, overlay: "drawer", drawerTab: "Details", ...draft }; }
    case "SET_QUERY": return { ...state, query: action.query };
    case "SET_CATEGORY": return { ...state, category: action.category };
    case "SET_TAB": return { ...state, libraryTab: action.tab };
    case "PLACE_ITEM": { if (!isValidContainerSlot(action.slot, state.container)) return state; const definition = getItem(action.itemId, state.catalog); if (!definition) return { ...state, toast: { message: "Item không tồn tại trong catalog đã chọn", tone: "error" } }; const defaults = state.itemDefaults[action.itemId] ?? { action: defaultAction }; const next: PlacedItem = { slot: action.slot, itemId: action.itemId, amount: Math.min(action.amount ?? 1, definition.maxStack), displayName: definition.name, lore: [], action: structuredClone(defaults.action), developerNotes: defaults.developerNotes ?? "", includeInExport: true, locked: true }; return { ...state, placements: { ...state.placements, [action.slot]: next }, selectedSlot: action.slot, selectedLibraryItemId: action.itemId, editorTarget: { kind: "placement", slot: action.slot }, dirty: true, ...draftForTarget({ ...state, placements: { ...state.placements, [action.slot]: next } }, { kind: "placement", slot: action.slot }) }; }
    case "MOVE_ITEM": { if (!isValidContainerSlot(action.to, state.container) || !state.placements[action.from]) return state; const placements = { ...state.placements }; const moving = placements[action.from]; const target = placements[action.to]; placements[action.to] = { ...moving, slot: action.to }; if (target) placements[action.from] = { ...target, slot: action.from }; else delete placements[action.from]; return { ...state, placements, selectedSlot: action.to, editorTarget: { kind: "placement", slot: action.to }, dirty: true, toast: { message: `Đã chuyển item sang Slot ${action.to}`, tone: "success", undo: true } }; }
    case "REMOVE_ITEM": { const removed = state.placements[action.slot]; const placements = { ...state.placements }; delete placements[action.slot]; return { ...state, placements, selectedSlot: null, selectedLibraryItemId: null, editorTarget: null, dirty: true, toast: { message: removed ? `Đã xóa ${removed.displayName} khỏi Slot ${action.slot}` : "Đã xóa item khỏi GUI", tone: "info", undo: true } }; }
    case "SET_AMOUNT": { const current = state.placements[action.slot]; const max = current ? getItem(current.itemId, state.catalog)?.maxStack ?? 64 : 64; return current ? { ...state, placements: { ...state.placements, [action.slot]: { ...current, amount: Math.max(1, Math.min(max, action.amount)) } }, dirty: true } : state; }
    case "SET_TITLE": return { ...state, title: action.title, dirty: true };
    case "SET_JSON_SKILL": return { ...state, jsonSkillId: action.jsonSkillId, dirty: true };
    case "SET_DRAFT_TITLE": return { ...state, draftTitle: action.title };
    case "SET_DRAFT_LORE": return { ...state, draftLore: action.lore };
    case "SET_DRAFT_NOTES": return { ...state, draftDeveloperNotes: action.notes };
    case "SET_DRAFT_ACTION": return { ...state, draftAction: action.action };
    case "SET_DRAFT_DELUXE_MENUS": return { ...state, draftDeluxeMenus: action.config };
    case "SET_DELUXE_MENUS_MENU": return { ...state, deluxeMenus: action.config, dirty: true };
    case "SAVE_ITEM": { const data = { displayName: state.draftTitle, lore: state.draftLore, developerNotes: state.draftDeveloperNotes }; if (state.editorTarget?.kind === "placement") { const current = state.placements[state.editorTarget.slot]; if (!current) return state; try { validateDeluxeMenusItemConfig(state.draftDeluxeMenus, state.container); } catch (error) { return { ...state, toast: { message: error instanceof Error ? error.message : "DeluxeMenus config không hợp lệ", tone: "error" } }; } return { ...state, placements: { ...state.placements, [state.editorTarget.slot]: { ...current, ...data, displayName: state.draftTitle || current.displayName, action: state.draftAction, ...cloneDeluxeMenusItemConfig(state.draftDeluxeMenus) } }, dirty: true, toast: { message: `Đã lưu cấu hình ${state.draftTitle || current.displayName}`, tone: "success" } }; } if (state.editorTarget?.kind === "library") { const definition = getItem(state.editorTarget.itemId, state.catalog); return { ...state, itemDefaults: { ...state.itemDefaults, [state.editorTarget.itemId]: { action: state.draftAction, developerNotes: state.draftDeveloperNotes } }, dirty: true, toast: { message: `Đã lưu cấu hình mặc định cho ${definition?.name ?? "item"}`, tone: "success" } }; } return state; }
    case "SET_OPTION": return { ...state, [action.option]: action.value };
    case "SET_MODE": return { ...state, previewMode: action.mode };
    case "SET_ZOOM": return { ...state, zoom: action.zoom };
    case "OPEN_OVERLAY": return { ...state, overlay: action.overlay };
    case "CLOSE_OVERLAY": return { ...state, overlay: null };
    case "SET_DRAWER_TAB": return { ...state, drawerTab: action.tab };
    case "SET_CONTAINER": { const placements = trimForContainer(state.placements, action.container); return { ...state, container: action.container, placements, selectedSlot: state.selectedSlot !== null && isValidContainerSlot(state.selectedSlot, action.container) ? state.selectedSlot : null, overlay: null, dirty: true, toast: { message: `Đã chuyển sang ${action.container.label} · ${action.container.slots} slots`, tone: "success" } }; }
    case "SET_ITEM_LOCK": { const current = state.placements[action.slot]; if (!current) return state; return { ...state, placements: { ...state.placements, [action.slot]: { ...current, locked: action.locked } }, dirty: true }; }
    case "SET_ALL_ITEM_LOCKS": return { ...state, placements: Object.fromEntries(Object.entries(state.placements).map(([slot, item]) => [slot, { ...item, locked: action.locked }])), dirty: true };
    case "RESET": return initialState;
    case "TOAST": return { ...state, toast: action.toast };
    case "CLEAR_TOAST": return { ...state, toast: null };
    case "RENAME_ITEM": { const current = state.placements[action.slot]; if (!current) return state; return { ...state, placements: { ...state.placements, [action.slot]: { ...current, displayName: action.name } }, dirty: true, draftTitle: state.selectedSlot === action.slot ? action.name : state.draftTitle, toast: { message: `Đã đổi tên thành: ${action.name}`, tone: "success" } }; }
  }
}
