<div align="center">

# JsonGui

**A visual Minecraft inventory GUI editor for plugin developers.**

Design menus in the browser, configure their items and actions, then export a predictable JSON document that can be consumed by a Java plugin.

> **Status:** Early beta. The editor and schema may change while the project is under active development.

</div>

## Overview

Building an inventory GUI directly in code is precise, but repeatedly compiling, reloading the server, joining the game, opening the menu, and checking every slot makes visual iteration unnecessarily slow. JsonGui moves that part of the workflow into a visual editor.

The project is intended for **developers creating custom Minecraft plugins**, not as another generic server menu plugin. You design the interface visually, export its structure as JSON, and decide how your own plugin interprets the resulting data.

JsonGui currently provides a React-based editor and a small local API used for project persistence, catalog data, validation, and canonical JSON export.

## Why this project exists

AI is useful for generating plugin logic, but it is unreliable at arranging a polished inventory interface from text alone. A generated menu may technically work while still having poor spacing, inconsistent visual hierarchy, awkward item placement, or a layout that is difficult to evaluate without launching Minecraft.

JsonGui was created to separate **visual composition** from **runtime implementation**:

1. Arrange the GUI in a visual environment where mistakes are immediately visible.
2. Export a structured, machine-readable description of the result.
3. Give that data to your plugin code—or to an AI coding assistant—to implement the actual behavior.

This is not an attempt to replace Java, Paper, Spigot, Bukkit, DeluxeMenus, or similar tools. It solves a narrower problem: making the design and iteration of custom inventory interfaces faster and easier to inspect.

## Why JSON instead of YAML?

YAML is often convenient for configuration written and maintained manually by server administrators. That is not the primary workflow of JsonGui.

JsonGui targets data that is:

- produced by a visual editor;
- validated by an API;
- exchanged with plugin code and development tools;
- loaded, modified, and exported repeatedly;
- expected to preserve a clear and predictable structure.

JSON is therefore an intentional choice. It maps directly to objects and arrays in most programming languages, has strict syntax, is widely supported by tooling, and is straightforward for code or AI agents to parse and regenerate.

The goal is not to claim that JSON is universally better than YAML. YAML remains more pleasant for many hand-authored configurations. JsonGui simply optimizes for **programmatic interchange and visual editing**, rather than for manually writing every slot in a text file.

## What JsonGui is—and is not

| JsonGui is | JsonGui is not |
| --- | --- |
| A visual editor for Minecraft inventory layouts | A complete replacement for plugin code |
| A JSON authoring and export tool | A drop-in menu plugin for server owners |
| A way to preview slots before testing in-game | A guarantee that generated behavior is correct |
| A bridge between interface design and implementation | A replacement for DeluxeMenus, zMenu, or other configuration-driven menu systems |

## Current features

- Visual container and slot editor.
- Minecraft item catalog with search, filtering, sorting, and quick placement.
- Drag-and-drop item positioning.
- Item properties such as material, amount, display metadata, and action data.
- Multiple supported container layouts.
- Direct slot-number mapping between the canvas and exported JSON.
- Optional player-inventory preview that is not included in the export.
- Undo and redo history.
- Local backup behavior when the API is unavailable.
- Server-backed project saving with conflict awareness.
- Connect Plugin Project: local Paper/Spigot/Bukkit project scan, `.jsongui` workspace, multi-GUI explorer, and file-change notices.
- JSON preview, validation status, clipboard copy, and file download.

## Example workflow

1. Start the local API and web editor.
2. Select the required Minecraft container type and size.
3. Search the item catalog and place items into slots.
4. Configure item properties and actions.
5. Review the layout visually instead of discovering spacing problems in-game.
6. Export the validated JSON document.
7. Load the JSON from your own Java plugin or provide it to an AI coding assistant as an implementation contract.
8. Test the finished behavior on the server.

JsonGui shortens the visual feedback loop; it does not remove the need for proper runtime testing.

## Export format

The export is designed as a compact contract between the editor and plugin code. Its main fields include the GUI type, title, row count, and an array of configured items.

```json
{
  "type": "CHEST",
  "title": "&8Main Menu",
  "rows": 3,
  "items": [
    {
      "slot": 11,
      "material": "DIAMOND_SWORD",
      "amount": 1,
      "action": {
        "type": "open_gui",
        "value": "combat-menu"
      }
    }
  ]
}
```

The exact schema is still evolving during beta. Treat generated files as versioned application data rather than as a permanent public standard until a stable release is announced.

## Getting started

### Requirements

- Node.js — a current LTS release is recommended.
- npm.

### Install dependencies

```bash
npm install
```

### Run in development

Run web editor and API in separate terminals:

```bash
npm run dev:api
npm run dev
```

Vite will print the local editor address in the terminal. Desktop mode starts and stops API automatically:

```bash
npm run desktop:dev
```

Desktop build needs Windows Node sidecar staged first:

```bash
npm run desktop:build
```

Sidecar binary stays ignored. Release CI must stage it before packaging. Signed desktop release setup: [`docs/releasing.md`](docs/releasing.md).

### Plugin Workspace

Open **Workspace** in header, then use **Connect Plugin Project**. JsonGui scans `build.gradle`, `build.gradle.kts`, `pom.xml`, plugin metadata, and `src/main/{java,kotlin,resources}` without running Gradle or Maven. It creates `.jsongui/` inside selected plugin root.

Browser mode accepts a manually entered absolute path. Desktop mode has a native folder picker:

```bash
npm run desktop:dev
```

The current scanner selects root module only. Build execution, Behavior IR, AI, MCP, source generation, patches, and rollback are later phases.

### Production build

```bash
npm run build
```

### Start the API without watch mode

```bash
npm start
```

## Available scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run dev:api` | Start the local API in watch mode |
| `npm run build` | Type-check and build the web application |
| `npm start` | Start the API normally |
| `npm run catalog:refresh` | Refresh generated catalog data |
| `npm run lint` | Run ESLint |
| `npm test` | Run frontend/domain tests |
| `npm run test:server` | Run server tests |

## Architecture

```text
JsonGui/
├─ src/       React and TypeScript editor
├─ server/    Local API, validation, project storage, and export logic
├─ shared/    Shared project/schema data
├─ items/     Item catalog data
├─ models/    Visual item model assets
└─ item/      Item-related resources
```

The editor communicates with the local API to retrieve catalog data, save the active project, detect conflicting updates, and request a canonical export. Plugin Workspace adds a token-protected localhost API that scans a connected project and writes only inside `<plugin-root>/.jsongui/`. Workspace metadata stores relative paths; ignored secrets and symlinks are not followed. Native `fs.watch` events reach the browser through SSE. When the API is unavailable, the editor can continue using local backup data, although the resulting local JSON has not been server-validated.

## Planned direction

The long-term goal is to make JsonGui part of a smoother custom-plugin workflow. Possible future work includes:

- a dedicated Java API or companion plugin for loading exported GUI files;
- import and round-trip editing of existing JSON documents;
- schema versioning and migration support;
- reusable templates and components;
- richer action definitions;
- improved support for AI coding agents and MCP-based workflows;
- clearer integration examples for Paper, Spigot, and Bukkit projects.

These items describe the intended direction and should not be treated as implemented features.

## Design philosophy

JsonGui follows a few simple principles:

- **Visual decisions should be made visually.** Slot composition is easier to judge on a canvas than in a long configuration file.
- **Runtime behavior belongs to the plugin.** The editor describes the interface; the consuming project controls permissions, commands, events, persistence, and business logic.
- **Exported data should be predictable.** A strict format is easier to validate, transform, test, and consume programmatically.
- **AI should receive structured context.** A clear GUI document gives an AI coding assistant stronger constraints than a vague prompt asking it to invent both the layout and implementation.
- **The developer remains responsible for review.** Generated code and exported data must still be tested before production use.

## Contributing

The project is in an early stage, so focused bug reports and small, well-explained pull requests are especially useful.

Before opening a pull request:

```bash
npm run lint
npm test
npm run test:server
npm run build
```

When reporting an editor issue, include the container type, affected slot or item, reproduction steps, browser console output, and the exported JSON when relevant.

## Disclaimer

JsonGui is an independent development tool and is not affiliated with Mojang Studios or Microsoft. Minecraft names and assets belong to their respective owners.
