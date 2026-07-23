import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { scanPluginProject } from "../plugin-scanner.mjs";

const roots = [];
async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), "jsongui-scanner-"));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

test("scans Paper Java Gradle project from metadata and source", async () => {
  const root = await fixture({
    "build.gradle": "java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }\ndependencies { compileOnly(\"io.papermc.paper:paper-api:1.21.8-R0.1-SNAPSHOT\") }",
    "src/main/resources/plugin.yml": "name: MagicHeroes\nmain: com.example.magic.MagicPlugin\napi-version: '1.21'\n",
    "src/main/java/com/example/magic/MagicPlugin.java": "package com.example.magic; public class MagicPlugin extends JavaPlugin {}",
  });
  const scanned = await scanPluginProject(root);
  assert.equal(scanned.platform, "paper");
  assert.equal(scanned.language, "java");
  assert.equal(scanned.buildSystem, "gradle");
  assert.equal(scanned.javaVersion, "21");
  assert.equal(scanned.minecraftVersion, "1.21");
  assert.equal(scanned.mainClass, "com.example.magic.MagicPlugin");
  assert.deepEqual(scanned.sourceRoots, ["src/main/java"]);
});

test("scans Kotlin Gradle DSL and Maven Spigot projects", async () => {
  const kotlin = await fixture({
    "build.gradle.kts": "kotlin { jvmToolchain(21) }\ndependencies { compileOnly(\"io.papermc.paper:paper-api:1.21.4-R0.1-SNAPSHOT\") }",
    "src/main/resources/paper-plugin.yml": "name: KotlinPlugin\nmain: dev.example.KotlinPlugin\napi-version: 1.21\n",
    "src/main/kotlin/dev/example/KotlinPlugin.kt": "package dev.example\nclass KotlinPlugin : JavaPlugin()",
  });
  const kotlinScan = await scanPluginProject(kotlin);
  assert.equal(kotlinScan.language, "kotlin");
  assert.equal(kotlinScan.buildSystem, "gradle-kotlin");
  assert.equal(kotlinScan.platform, "paper");
  assert.equal(kotlinScan.javaVersion, "21");

  const maven = await fixture({
    "pom.xml": "<project><properties><maven.compiler.release>17</maven.compiler.release></properties><dependencies><dependency><artifactId>spigot-api</artifactId><version>1.20.4-R0.1-SNAPSHOT</version></dependency></dependencies></project>",
    "src/main/resources/plugin.yml": "name: Spigot\nmain: dev.example.SpigotMain\n",
    "src/main/java/dev/example/SpigotMain.java": "package dev.example; class SpigotMain extends JavaPlugin {}",
  });
  const mavenScan = await scanPluginProject(maven);
  assert.equal(mavenScan.buildSystem, "maven");
  assert.equal(mavenScan.platform, "spigot");
  assert.equal(mavenScan.javaVersion, "17");
  assert.equal(mavenScan.minecraftVersion, "1.20.4");
});

test("does not follow ignored or symlink source entries", async () => {
  const root = await fixture({
    "settings.gradle": "include ':child'",
    ".git/Hidden.java": "package secret; class Hidden extends JavaPlugin {}",
    "src/main/java/a/Main.java": "package a; class Main extends JavaPlugin {}",
  });
  const outside = await fixture({ "Outside.java": "package outside; class Outside extends JavaPlugin {}" });
  await symlink(path.join(outside, "Outside.java"), path.join(root, "src/main/java/a/linked.java"));
  const scanned = await scanPluginProject(root);
  assert.equal(scanned.mainClass, "a.Main");
  assert.ok(scanned.issues.some((entry) => entry.code === "MULTI_MODULE_UNSUPPORTED"));
});
