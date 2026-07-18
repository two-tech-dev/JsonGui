import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { CatalogStore } from "../catalog-store.mjs";
import { validateCatalog } from "../schema.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const FANDOM_API = "https://minecraft.fandom.com/api.php";
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MIN_FULL_CATALOG_ITEMS = 300;
const REQUIRED_IDS = [];

function argument(name) { const prefix = `--${name}=`; return process.argv.find((entry) => entry.startsWith(prefix))?.slice(prefix.length); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
async function atomicJson(file, value) { await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }); await rename(temp, file); }

async function fetchJson(url) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json", "User-Agent": "GUI-Forge-Catalog-Refresh/1.0 (local tool)" } });
  if (!response.ok) throw new Error(`Fandom request failed: ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error("Fandom response is too large");
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error("Fandom response is too large");
  return JSON.parse(text);
}

const MATERIAL_ALIASES = {
  "minecraft:grass_block": "GRASS_BLOCK",
  "minecraft:netherite_sword": "NETHERITE_SWORD",
  "minecraft:spawn_egg": "ZOMBIE_SPAWN_EGG",
};
function materialFromId(id) {
  const mapped = MATERIAL_ALIASES[id];
  if (mapped) return mapped;
  const material = id.replace(/^minecraft:/, "").replace(/[./-]/g, "_").toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(material)) throw new Error(`No Paper material mapping for ${id}`);
  return material;
}
function categoryForItem(id, source = "") {
  const value = `${id} ${source}`.toLowerCase();
  if (/(sword|axe|bow|crossbow|trident|mace|spear|shield|helmet|chestplate|leggings|boots|elytra|totem)/.test(value)) return "Combat";
  if (/(pickaxe|shovel|hoe|shears|fishing_rod|flint_and_steel|brush|spyglass|compass|clock|lead|name_tag|map|recovery_compass)/.test(value)) return "Tools";
  if (/(apple|bread|beef|porkchop|chicken|mutton|rabbit|cod|salmon|stew|soup|cookie|cake|carrot|potato|melon_slice|berries|chorus_fruit|honey|kelp|beetroot|rotten_flesh|pufferfish|tropical_fish)/.test(value)) return "Food";
  if (/(redstone|repeater|comparator|piston|observer|hopper|dispenser|dropper|lever|button|pressure_plate|daylight_detector|tripwire|target|rail|tnt|sculk_sensor|calibrated_sculk|copper_bulb)/.test(value)) return "Redstone";
  if (/(bucket|boat|minecart|chest|barrel|shulker|furnace|crafting|smithing|anvil|grindstone|loom|stonecutter|cartography|enchant|brewing|cauldron|beacon|end_crystal|ender_pearl|firework|potion|book|banner|sign|bed|music_disc|spawn_egg)/.test(value)) return "Utility";
  if (/(block|planks|log|wood|leaves|sapling|flower|coral|glass|wool|terracotta|concrete|brick|stone|dirt|sand|gravel|ore|deepslate|cobblestone|fence|door|trapdoor|slab|stairs|wall|lantern|torch|candle|painting|item_frame|pot|carpet)/.test(value)) return "Decoration";
  if (/tool|instrument/.test(value)) return "Tools";
  if (/weapon|combat|armor/.test(value)) return "Combat";
  if (/food|edible/.test(value)) return "Food";
  if (/redstone/.test(value)) return "Redstone";
  if (/utility|transport|brewing/.test(value)) return "Utility";
  if (/decoration|building|block/.test(value)) return "Decoration";
  return "Misc";
}
function iconKey(id) { return id.slice("minecraft:".length); }
function cellText(cell) { return cell.textContent.replace(/\s+/g, " ").trim(); }
function expandRow(cells, carry) {
  const expanded = []; let column = 0;
  const takeCarry = () => {
    while (carry[column]) {
      expanded[column] = carry[column].text;
      carry[column].remaining -= 1;
      if (carry[column].remaining === 0) delete carry[column];
      column += 1;
    }
  };
  for (const cell of cells) {
    takeCarry();
    const text = cellText(cell);
    const colspan = Math.max(1, Number(cell.getAttribute("colspan") ?? 1));
    const rowspan = Math.max(1, Number(cell.getAttribute("rowspan") ?? 1));
    for (let offset = 0; offset < colspan; offset += 1) {
      expanded[column + offset] = text;
      if (rowspan > 1) carry[column + offset] = { text, remaining: rowspan - 1 };
    }
    column += colspan;
  }
  takeCarry();
  return expanded;
}

function defaultStackSize(id) {
  if (id.endsWith("_sword") || id.endsWith("_pickaxe") || id.endsWith("_axe") || id.endsWith("_shovel") || id.endsWith("_hoe") || id.endsWith("_helmet") || id.endsWith("_chestplate") || id.endsWith("_leggings") || id.endsWith("_boots") || id.endsWith("_shield") || id.endsWith("_boat") || id.endsWith("_chest_boat") || ["minecraft:compass", "minecraft:totem_of_undying", "minecraft:spyglass", "minecraft:flint_and_steel", "minecraft:shears", "minecraft:bow", "minecraft:crossbow", "minecraft:trident", "minecraft:elytra", "minecraft:bucket", "minecraft:water_bucket", "minecraft:lava_bucket", "minecraft:milk_bucket", "minecraft:powder_snow_bucket", "minecraft:axolotl_bucket", "minecraft:tadpole_bucket", "minecraft:cod_bucket", "minecraft:salmon_bucket", "minecraft:tropical_fish_bucket", "minecraft:pufferfish_bucket", "minecraft:potion", "minecraft:splash_potion", "minecraft:lingering_potion", "minecraft:honey_bottle", "minecraft:saddle", "minecraft:cake", "minecraft:writable_book", "minecraft:written_book", "minecraft:enchanted_book"].includes(id)) {
    return 1;
  }
  if (["minecraft:ender_pearl", "minecraft:egg", "minecraft:snowball", "minecraft:bucket", "minecraft:honey_bottle"].includes(id) || id.endsWith("_sign") || id.endsWith("_banner")) {
    return 16;
  }
  return 64;
}

export function normalizeRows(rows, { minecraftVersion, revisionId, revisionTimestamp }) {
  const items = []; const seen = new Set(); const duplicates = [];
  for (const row of rows) {
    const id = row.id?.trim().toLowerCase(); const name = row.name?.trim();
    if (!id || !name || !/^minecraft:[a-z0-9_./-]+$/.test(id) || id === "minecraft:air") continue;
    if (seen.has(id)) { continue; }
    seen.add(id);
    const maxStack = Number.isInteger(row.maxStack) && row.maxStack >= 1 && row.maxStack <= 64 ? row.maxStack : defaultStackSize(id);
    items.push({ id, name, material: row.material?.trim() || materialFromId(id), category: categoryForItem(id, row.category), icon: iconKey(id), maxStack, description: row.description?.trim() || name });
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  const stable = JSON.stringify(items);
  return { schemaVersion: 1, version: `minecraft-java-${minecraftVersion}-fandom-r${revisionId}-${hash(stable).slice(0, 12)}`, minecraftVersion, paperVersion: minecraftVersion, edition: "java", source: { kind: "fandom", url: "https://minecraft.fandom.com/wiki/Java_Edition_data_values/Items", revisionId: String(revisionId), revisionTimestamp, contentHash: hash(stable), parserVersion: 2, itemCount: items.length, fetchedAt: new Date().toISOString() }, items };
}

export function parseItemHtml(html) {
  const document = new JSDOM(html, { runScripts: "outside-only", resources: undefined }).window.document;
  const rows = []; let context = "";
  for (const table of document.querySelectorAll("table")) {
    const precedingHeading = table.previousElementSibling?.closest("h2, h3, h4") ?? table.parentElement?.querySelector(":scope > h2, :scope > h3, :scope > h4");
    context = precedingHeading ? cellText(precedingHeading) : "";
    const carry = []; let header = null;
    for (const tr of table.querySelectorAll("tr")) {
      const cells = [...tr.children].filter((node) => node.matches("th, td"));
      if (!cells.length) continue;
      const expanded = expandRow(cells, carry);
      const texts = expanded.map((entry) => entry ?? "");
      const ids = texts.join(" ").match(/minecraft:[a-z0-9_./-]+/gi) ?? [];

      const firstText = texts[0]?.trim();
      const secondText = texts[1]?.trim();
      let rawId = "";
      if (ids.length) {
        rawId = ids[0];
      } else if (secondText && /^[a-z0-9_./-]+$/.test(secondText) && secondText !== "resource_location" && secondText !== "acacia_boat") {
        rawId = `minecraft:${secondText}`;
      }

      if (!rawId) {
        const headerText = texts.join(" ").toLowerCase();
        if ((/resource|registry|identifier|location/.test(headerText)) && /name|item|block/.test(headerText)) header = texts.map((entry) => entry.toLowerCase());
        continue;
      }

      if (!header || /bedrock/.test(context.toLowerCase())) continue;
      const idIndex = header.findIndex((entry) => /resource|registry|identifier|location/.test(entry));
      const nameIndex = header.findIndex((entry, index) => index !== idIndex && /name|item|block/.test(entry));
      if (idIndex < 0 || nameIndex < 0) continue;

      const stackIndex = header.findIndex((entry) => /stack/.test(entry));
      const rawStack = stackIndex >= 0 ? texts[stackIndex]?.trim() : "";
      const maxStack = (/^([1-9]|[1-5][0-9]|6[0-4])$/.test(rawStack)) ? Number(rawStack) : undefined;
      rows.push({ id: rawId, name: texts[nameIndex].replace(/\[[^\]]*\]/g, "").trim(), maxStack, category: context });
    }
  }
  return rows;
}

async function liveRevision(title) {
  const metadata = await fetchJson(`${FANDOM_API}?action=query&format=json&formatversion=2&prop=revisions&rvprop=ids%7Ctimestamp&titles=${encodeURIComponent(title)}`);
  const revision = metadata.query?.pages?.[0]?.revisions?.[0];
  if (!revision?.revid) throw new Error(`${title} page revision was not found`);
  const parsed = await fetchJson(`${FANDOM_API}?action=parse&format=json&formatversion=2&oldid=${revision.revid}&prop=text`);
  const html = typeof parsed.parse?.text === "string" ? parsed.parse.text : parsed.parse?.text?.["*"];
  return { revisionId: revision.revid, revisionTimestamp: revision.timestamp, html };
}

async function sourceRevision(source, revisionId, title) {
  if (source === "fandom") return liveRevision(title);
  if (source !== "cache" || !revisionId) throw new Error("Use --source=fandom or --source=cache --revision=<id>");
  const raw = JSON.parse(await readFile(path.join(root, "data", "catalog", "sources", `fandom-r${revisionId}.json`), "utf8"));
  return { revisionId: raw.revisionId, revisionTimestamp: raw.revisionTimestamp, html: raw.html };
}

async function main() {
  const source = argument("source") ?? "fandom";
  const minecraftVersion = argument("minecraft-version");
  const revisionId = argument("revision");
  if (minecraftVersion !== "1.21.8") throw new Error("Pass --minecraft-version=1.21.8 exactly");
  const seed = JSON.parse(await readFile(path.join(root, "shared", "seed-v1.json"), "utf8"));
  const store = new CatalogStore({ root: path.join(root, "data"), seed: seed.catalog });
  await store.initialize();

  // Fetch Items page
  const itemsRevision = await sourceRevision(source, revisionId, "Java Edition data values/Items");
  if (typeof itemsRevision.html !== "string") throw new Error("Fandom Items page did not provide HTML");
  const itemsRawFile = path.join(root, "data", "catalog", "sources", `fandom-r${itemsRevision.revisionId}.json`);
  if (source === "fandom") await atomicJson(itemsRawFile, { sourceUrl: "https://minecraft.fandom.com/wiki/Java_Edition_data_values/Items", revisionId: itemsRevision.revisionId, revisionTimestamp: itemsRevision.revisionTimestamp, html: itemsRevision.html, fetchedAt: new Date().toISOString() });

  // Fetch Blocks page
  const blocksRevision = await sourceRevision(source, revisionId, "Java Edition data values/Blocks");
  if (typeof blocksRevision.html !== "string") throw new Error("Fandom Blocks page did not provide HTML");
  const blocksRawFile = path.join(root, "data", "catalog", "sources", `fandom-blocks-r${blocksRevision.revisionId}.json`);
  if (source === "fandom") await atomicJson(blocksRawFile, { sourceUrl: "https://minecraft.fandom.com/wiki/Java_Edition_data_values/Blocks", revisionId: blocksRevision.revisionId, revisionTimestamp: blocksRevision.revisionTimestamp, html: blocksRevision.html, fetchedAt: new Date().toISOString() });

  const parsedItems = parseItemHtml(itemsRevision.html);
  const parsedBlocks = parseItemHtml(blocksRevision.html);
  const allParsed = [...parsedItems, ...parsedBlocks];

  const catalog = normalizeRows(allParsed, { minecraftVersion, revisionId: itemsRevision.revisionId, revisionTimestamp: itemsRevision.revisionTimestamp });
  catalog.source.rawHtmlHash = hash(itemsRevision.html + blocksRevision.html);
  catalog.source.normalizedSnapshotHash = hash(JSON.stringify(catalog.items));
  catalog.source.diagnostics = { parserVersion: 2, requiredIds: REQUIRED_IDS, rawBytes: Buffer.byteLength(itemsRevision.html) + Buffer.byteLength(blocksRevision.html) };
  try {
    validateCatalog(catalog);
  } catch (error) {
    if (error.issues) console.error("Validation issues:", JSON.stringify(error.issues, null, 2));
    throw error;
  }
  if (catalog.items.length < MIN_FULL_CATALOG_ITEMS) throw new Error(`Catalog is incomplete: ${catalog.items.length} items, expected at least ${MIN_FULL_CATALOG_ITEMS}`);
  for (const required of REQUIRED_IDS) if (!catalog.items.some((item) => item.id === required)) throw new Error(`Catalog missing required item: ${required}`);
  const current = await store.getCurrent();
  if (current && current.catalog.items.length >= MIN_FULL_CATALOG_ITEMS && catalog.items.length < Math.floor(current.catalog.items.length * 0.95)) throw new Error("Catalog item count dropped more than 5%; not promoting");
  await store.promote(catalog);
  console.info(`Promoted ${catalog.version} with ${catalog.items.length} items from Fandom`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
