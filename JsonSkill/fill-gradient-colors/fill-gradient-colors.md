# Fill - Gradient Colors

## Required style questions

Before creating or updating GUI, ask user all of these questions in one short message:

1. Which gradient palette should be used? Ask for start and end colors, or permission to choose colors from GUI purpose.
2. Which Minecraft gradient syntax should be written into title and item names? Offer `&#rrggbb`, `&x&r&r&g&g&b&b`, `<#rrggbb>`, and `[COLOR=#rrggbb]`.
3. Should title and item names use bold (`&l`)?
4. Should title and item names use italic (`&o`)?

Do not assume a gradient syntax, bold, or italic choice while user is available. If user explicitly asks AI to decide, use `&#rrggbb`, enable bold for interactive item names, and disable italic unless GUI is intentionally decorative, magical, or roleplay-focused.

## Palette decision

If user gives no palette and permits AI choice, choose a restrained two-color gradient that fits GUI purpose: aqua to blue for information or navigation, green to lime for safe progress, gold to orange for rewards or shops, purple to pink for magic, red to dark red only for destructive or dangerous actions. Do not use more than three gradient colors in one GUI.

## Empty slots

Fill every empty container slot with a valid colored Bukkit pane material matching palette, such as `LIGHT_BLUE_STAINED_GLASS_PANE`, `BLUE_STAINED_GLASS_PANE`, `LIME_STAINED_GLASS_PANE`, `PURPLE_STAINED_GLASS_PANE`, or `PINK_STAINED_GLASS_PANE`. Never use generic `STAINED_GLASS_PANE`: it is not a valid modern Paper material. First confirm selected pane material exists in pinned catalog. Use a smooth palette gradient across GUI, normally left to right or from border toward center. Fillers are decorative only: use `action.type` `prompt_only`, set `locked` true, give amount 1, and do not place them where they hide a meaningful action. Keep explicit empty slots only when user asks for open spacing or inventory behavior.

## Title

Write GUI title with selected Minecraft gradient syntax. Keep title short, usually 12 to 24 visible characters. Apply `&l` only when user enables bold and `&o` only when user enables italic. Gradient must follow selected palette and remain readable against Minecraft inventory background.

## Item names

Every interactive item display name must use selected gradient syntax, direction, palette, bold choice, and italic choice consistently. When bold is enabled, add `&l`; when italic is enabled, add `&o`. Apply gradient color codes per character or short character groups. Names must begin with a clear action or noun, such as `Open Shop`, `Claim Reward`, or `Back`.

## Lore

Lore must explain actual item purpose in concise player-facing language. First line states result of clicking or using item. Later lines state cost, cooldown, destination, permission, or warning when relevant. Use gray secondary text (`&7`) and a restrained accent color for important state. Do not add filler lore, AI notes, implementation instructions, or vague text such as `Click me!` without explaining outcome.

## Layout and visual composition

Arrange GUI for visual balance, not only functional slot assignment. Build one clear focal point for primary action, then place secondary actions around it with consistent spacing. Prefer horizontal symmetry for chest menus. Center odd item counts; distribute even item counts evenly around center. Keep at least one filler slot between unrelated action groups when space permits.

Use rows as visual hierarchy: top row for identity or status, middle rows for primary content, bottom row for navigation and destructive controls. Group related actions into aligned rows or mirrored clusters. Keep repeated item types, naming patterns, and lore lengths visually consistent. Do not scatter actions randomly, crowd one side, create accidental gaps, or mix navigation into main content.

Use gradient glass panes as deliberate borders, dividers, frames, or smooth background patterns. Gradient direction must be consistent across whole inventory. Prefer border-to-center, left-to-right, or mirrored edge gradients; do not alternate colors randomly. Decorative pane pattern must support action hierarchy instead of competing with it.

Keep navigation predictable: back on lower-left, close or cancel on lower-right when those actions exist. Put dangerous action away from safe primary action and use red visual treatment. Do not make glass panes look interactive; their lore should be empty unless user requests decoration text.

Before saving, inspect full slot map as composition. Reposition items until layout looks centered, aligned, evenly spaced, and intentional. If multiple valid layouts exist, choose most readable and visually polished one, not first available slots.

## Validation

When changing only some items, use MCP `projects_patch` with current ETag instead of `projects_update`. Patch `items` by slot, use `removeSlots` to delete slots, and use `project` only for top-level fields such as title. Before saving, ensure all slots are valid, selected gradient syntax is used consistently, bold and italic flags match user answers, interactive item names follow selected palette, every interactive item has descriptive lore, every filler is locked, and title matches selected gradient palette.
