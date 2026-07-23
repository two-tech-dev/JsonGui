import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

const MAX_FILE_BYTES = 512 * 1024;
const MAX_SOURCE_FILES = 256;
const MAX_DEPTH = 12;

export const DEFAULT_IGNORED_NAMES = new Set([
  ".git", ".gradle", ".idea", ".jsongui", "build", "target", "out", "bin", "node_modules",
  "logs", "credentials", "secrets",
]);

const SENSITIVE_NAMES = [".env", "gradle.properties"];
const SENSITIVE_SUFFIXES = [".pem", ".key"];

function toRelative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

export function isIgnoredPath(relativePath) {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  return parts.some((part) => {
    const lower = part.toLowerCase();
    return DEFAULT_IGNORED_NAMES.has(lower)
      || SENSITIVE_NAMES.includes(lower)
      || lower.startsWith(".env.")
      || SENSITIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
  });
}

function issue(code, message, severity = "warning") {
  return { code, message, severity };
}

async function readText(file, maxBytes = MAX_FILE_BYTES) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) return null;
  if (info.size > maxBytes) return null;
  return readFile(file, "utf8");
}

async function readCandidate(root, name) {
  const file = path.join(root, name);
  try { return await readText(file); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

function yamlScalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed.replace(/\s+#.*$/, "").trim();
}

function parseTopLevelYaml(text) {
  const values = new Map();
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s/.test(raw) || /^\s*#/.test(raw)) continue;
    const match = raw.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (match && match[2]) values.set(match[1].toLowerCase(), yamlScalar(match[2]));
  }
  return values;
}

function findVersion(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function detectVersions(buildText) {
  if (!buildText) return {};
  const javaVersion = findVersion(buildText, [
    /JavaLanguageVersion\.of\s*\(\s*(\d{1,2})\s*\)/,
    /(?:source|target)Compatibility\s*=\s*JavaVersion\.VERSION_(\d{1,2})/,
    /(?:source|target)Compatibility\s*=\s*["']?(\d{1,2})["']?/,
    /jvmToolchain\s*\(\s*(\d{1,2})\s*\)/,
    /jvmToolchain\s*=\s*(\d{1,2})/,
  ]);
  const minecraftVersion = findVersion(buildText, [
    /(?:paper|spigot|bukkit)(?:-api)?\s*[:=].*?(1\.\d+(?:\.\d+)?)/i,
    /(?:paper-api|spigot-api|bukkit).{0,120}?(1\.\d+(?:\.\d+)?)/i,
  ]);
  return { javaVersion, minecraftVersion };
}

function detectMavenVersions(text) {
  if (!text) return {};
  const property = (name) => findVersion(text, [new RegExp(`<${name}>\\s*([^<]+?)\\s*</${name}>`, "i")]);
  const javaVersion = property("maven.compiler.release") ?? property("maven.compiler.target") ?? property("java.version");
  const minecraftVersion = findVersion(text, [
    /<(?:artifactId)>\s*(?:paper-api|spigot-api|bukkit)\s*<\/artifactId>[\s\S]{0,300}?<version>\s*(1\.\d+(?:\.\d+)?)/i,
  ]);
  return { javaVersion, minecraftVersion };
}

function platformFromText(text) {
  if (!text) return "unknown";
  if (/paper(?:weight|-api|\s*plugin)/i.test(text)) return "paper";
  if (/spigot(?:-api)?/i.test(text)) return "spigot";
  if (/bukkit/i.test(text)) return "bukkit";
  return "unknown";
}

async function sourceFiles(root, sourceRoots) {
  const found = [];
  async function walk(dir, depth) {
    if (found.length >= MAX_SOURCE_FILES || depth > MAX_DEPTH) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) { if (error?.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      if (found.length >= MAX_SOURCE_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);
      const relative = toRelative(root, absolute);
      if (isIgnoredPath(relative)) continue;
      if (entry.isDirectory()) await walk(absolute, depth + 1);
      else if (entry.isFile() && (entry.name.endsWith(".java") || entry.name.endsWith(".kt"))) found.push(absolute);
    }
  }
  for (const sourceRoot of sourceRoots) await walk(path.join(root, sourceRoot), 0);
  return found;
}

function sourceFacts(file, text) {
  const packageMatch = text.match(/^\s*package\s+([A-Za-z_][\w.]*)/m);
  const javaMain = text.match(/(?:public\s+)?class\s+(\w+)\s+extends\s+JavaPlugin\b/);
  const kotlinMain = text.match(/class\s+(\w+)\s*:\s*JavaPlugin\s*\(/);
  const className = javaMain?.[1] ?? kotlinMain?.[1];
  return {
    packageName: packageMatch?.[1],
    mainClass: className && packageMatch?.[1] ? `${packageMatch[1]}.${className}` : undefined,
    isMain: Boolean(className),
    language: file.endsWith(".kt") ? "kotlin" : "java",
  };
}

function metadataFromYaml(text, file, forcedPlatform) {
  if (!text) return undefined;
  const values = parseTopLevelYaml(text);
  const mainClass = values.get("main");
  const apiVersion = values.get("api-version") ?? values.get("api_version");
  return {
    file,
    mainClass,
    apiVersion,
    platform: forcedPlatform ?? platformFromText(text),
  };
}

function pickPlatform(metadata, buildText) {
  if (metadata?.platform && metadata.platform !== "unknown") return metadata.platform;
  return platformFromText(buildText);
}

function pickVersion(label, metadataValue, buildValue, issues) {
  if (metadataValue && buildValue && metadataValue !== buildValue) {
    issues.push(issue("VERSION_CONFLICT", `${label} metadata (${metadataValue}) conflicts with build descriptor (${buildValue}); metadata used.`));
  }
  return metadataValue ?? buildValue;
}

async function existsDirectory(root, relative) {
  try {
    const info = await lstat(path.join(root, relative));
    return info.isDirectory() && !info.isSymbolicLink();
  } catch { return false; }
}

export async function scanPluginProject(rootPath) {
  const root = await realpath(rootPath);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw Object.assign(new Error("Plugin root must be a real directory"), { code: "INVALID_PLUGIN_ROOT" });

  const issues = [];
  const [gradle, gradleKts, pom, settingsGradle, settingsGradleKts, pluginYaml, paperPluginYaml, bungeeYaml, velocityJson] = await Promise.all([
    readCandidate(root, "build.gradle"),
    readCandidate(root, "build.gradle.kts"),
    readCandidate(root, "pom.xml"),
    readCandidate(root, "settings.gradle"),
    readCandidate(root, "settings.gradle.kts"),
    readCandidate(root, "src/main/resources/plugin.yml"),
    readCandidate(root, "src/main/resources/paper-plugin.yml"),
    readCandidate(root, "src/main/resources/bungee.yml"),
    readCandidate(root, "src/main/resources/velocity-plugin.json"),
  ]);

  const sourceRoots = [];
  for (const relative of ["src/main/java", "src/main/kotlin"]) if (await existsDirectory(root, relative)) sourceRoots.push(relative);
  const resourceRoot = await existsDirectory(root, "src/main/resources") ? "src/main/resources" : undefined;
  const buildSystem = gradleKts ? "gradle-kotlin" : gradle ? "gradle" : pom ? "maven" : "unknown";
  const buildText = gradleKts ?? gradle ?? pom ?? "";
  const metadata = paperPluginYaml ? metadataFromYaml(paperPluginYaml, "src/main/resources/paper-plugin.yml", "paper")
    : pluginYaml ? metadataFromYaml(pluginYaml, "src/main/resources/plugin.yml")
      : bungeeYaml ? metadataFromYaml(bungeeYaml, "src/main/resources/bungee.yml", "unknown")
        : velocityJson ? (() => {
          try {
            const data = JSON.parse(velocityJson);
            return { file: "src/main/resources/velocity-plugin.json", mainClass: typeof data.main === "string" ? data.main : undefined, apiVersion: undefined, platform: "unknown" };
          } catch { issues.push(issue("INVALID_METADATA", "velocity-plugin.json is not valid JSON.")); return undefined; }
        })() : undefined;

  const files = await sourceFiles(root, sourceRoots);
  const facts = [];
  for (const file of files) {
    const text = await readText(file);
    if (text !== null) facts.push(sourceFacts(file, text));
  }
  const languages = new Set(facts.map((entry) => entry.language));
  if (sourceRoots.includes("src/main/java")) languages.add("java");
  if (sourceRoots.includes("src/main/kotlin")) languages.add("kotlin");
  const language = languages.size === 0 ? "unknown" : languages.size === 1 ? [...languages][0] : "mixed";
  const sourceMain = facts.find((entry) => entry.isMain)?.mainClass;
  const mainClass = metadata?.mainClass ?? sourceMain;
  if (!mainClass) issues.push(issue("MAIN_CLASS_UNKNOWN", "No plugin main class found in metadata or JavaPlugin source."));
  const basePackage = mainClass?.includes(".") ? mainClass.slice(0, mainClass.lastIndexOf(".")) : facts.find((entry) => entry.packageName)?.packageName;
  const buildVersions = buildSystem === "maven" ? detectMavenVersions(pom) : detectVersions(buildText);
  const minecraftVersion = pickVersion("Minecraft/API version", metadata?.apiVersion, buildVersions.minecraftVersion, issues);
  const platform = pickPlatform(metadata, buildText);
  const javaVersion = buildVersions.javaVersion;

  const settings = settingsGradleKts ?? settingsGradle;
  if (settings && /\binclude\s*(?:\(|\s)[^\n]+/m.test(settings)) issues.push(issue("MULTI_MODULE_UNSUPPORTED", "Root module scanned; child Gradle modules were not selected automatically.", "info"));
  if (buildSystem === "unknown") issues.push(issue("BUILD_SYSTEM_UNKNOWN", "No Gradle or Maven build descriptor found."));
  if (!resourceRoot) issues.push(issue("RESOURCE_ROOT_UNKNOWN", "src/main/resources was not found."));

  return {
    projectName: path.basename(root),
    rootPath: root,
    platform,
    language,
    buildSystem,
    ...(javaVersion ? { javaVersion } : {}),
    ...(minecraftVersion ? { minecraftVersion } : {}),
    sourceRoots,
    ...(resourceRoot ? { resourceRoot } : {}),
    ...(mainClass ? { mainClass } : {}),
    ...(basePackage ? { basePackage } : {}),
    ...(metadata?.file ? { metadataFile: metadata.file } : {}),
    issues,
  };
}
