# Minecraft GUI Standard

## Hierarchy

Use one primary action per screen. Put title in first row, primary actions in center, navigation in bottom row. Keep destructive actions separate from confirmation actions. Use consistent back, close, and help slots across related menus.

## Spacing and slots

Use 9-column rows. Leave empty slots between unrelated groups. Reserve borders for neutral fillers only when they improve grouping. Do not place clickable controls in slots that look decorative. Keep primary controls near center and avoid dense full-grid layouts unless inventory browsing requires it.

## Naming, lore, and colors

Use short verb-led display names such as `Open Shop` and `Back`. Lore explains outcome, cost, cooldown, or permission in one idea per line. Use Minecraft formatting consistently: green for safe confirm, red for destructive action, yellow for warning, aqua for information, gray for secondary detail. Never use color as only meaning.

## Accessibility

Repeat state in text, not only item material or color. Keep labels distinct for screen readers and players with color-vision differences. Use familiar materials only when label and lore still explain action. Avoid rapid animation, unreadable obfuscated text, and excessive decorative lore.

## Safety

Make destructive actions explicit and require confirmation for irreversible changes. Label commands, transfers, and teleports with destination or effect. Do not imply permissions user may not have. Keep cancel and back actions visible. Validate slot bounds, item amounts, and target GUI IDs before export.
