export interface MinecraftTextSegment {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  obfuscated?: boolean;
}

const colors: Record<string, string> = { "0": "#000000", "1": "#0000aa", "2": "#00aa00", "3": "#00aaaa", "4": "#aa0000", "5": "#aa00aa", "6": "#ffaa00", "7": "#aaaaaa", "8": "#555555", "9": "#5555ff", a: "#55ff55", b: "#55ffff", c: "#ff5555", d: "#ff55ff", e: "#ffff55", f: "#ffffff" };

type Style = Omit<MinecraftTextSegment, "text">;

export function parseMinecraftText(input: string): MinecraftTextSegment[] {
  const source = input.replace(/<\/?#([\da-f]{6})>/gi, "&#$1").replace(/\[COLOR=#([\da-f]{6})\]/gi, "&#$1").replace(/\[\/COLOR\]/gi, "&r");
  const result: MinecraftTextSegment[] = [];
  let text = "";
  let style: Style = {};
  const flush = () => {
    if (text) result.push({ text, ...style });
    text = "";
  };
  const color = (value: string) => {
    flush();
    style = { color: value };
  };
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "&" || index === source.length - 1) {
      text += source[index];
      continue;
    }
    const hex = source.slice(index + 1, index + 8);
    if (/^#[\da-f]{6}$/i.test(hex)) {
      color(hex.toLowerCase());
      index += 7;
      continue;
    }
    const expandedHex = source.slice(index + 1, index + 14);
    if (/^x(&[\da-f]){6}$/i.test(expandedHex)) {
      color(`#${expandedHex.replace(/[&x]/gi, "")}`.toLowerCase());
      index += 13;
      continue;
    }
    const code = source[index + 1].toLowerCase();
    if (code in colors) color(colors[code]);
    else if (code === "r") {
      flush();
      style = {};
    } else if (code === "k") { flush(); style = { ...style, obfuscated: true }; }
    else if (code === "l") { flush(); style = { ...style, bold: true }; }
    else if (code === "m") { flush(); style = { ...style, strikethrough: true }; }
    else if (code === "n") { flush(); style = { ...style, underline: true }; }
    else if (code === "o") { flush(); style = { ...style, italic: true }; }
    else {
      text += input[index];
      continue;
    }
    index += 1;
  }
  flush();
  return result;
}
