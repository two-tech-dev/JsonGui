import { describe, expect, it } from "vitest";
import { parseMinecraftText } from "./minecraftText";

describe("parseMinecraftText", () => {
  it("parses legacy and hex colors", () => {
    expect(parseMinecraftText("&aGreen &#12AbefHex")).toEqual([
      { text: "Green ", color: "#55ff55" },
      { text: "Hex", color: "#12abef" },
    ]);
  });

  it("parses Birdflop hex variants", () => {
    expect(parseMinecraftText("&x&1&2&a&b&e&fOne <#abcdef>Two [COLOR=#123456]Three[/COLOR]Plain")).toEqual([
      { text: "One ", color: "#12abef" },
      { text: "Two ", color: "#abcdef" },
      { text: "Three", color: "#123456" },
      { text: "Plain" },
    ]);
  });

  it("applies formats and resets them on color or reset", () => {
    expect(parseMinecraftText("&lBold&cRed&rPlain")).toEqual([
      { text: "Bold", bold: true },
      { text: "Red", color: "#ff5555" },
      { text: "Plain" },
    ]);
  });

  it("preserves invalid codes", () => {
    expect(parseMinecraftText("literal &z &#123")).toEqual([{ text: "literal &z &#123" }]);
  });
});
