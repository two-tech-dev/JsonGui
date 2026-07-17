import type { CSSProperties } from "react";

interface PixelItemIconProps { kind: string; size?: number; label?: string; material?: string; }

function hash(text: string) { return [...text].reduce((value, char) => (value * 33 + char.charCodeAt(0)) >>> 0, 5381); }

export function PixelItemIcon({ kind, size = 32, label, material }: PixelItemIconProps) {
  const assetName = `${kind.replace(/[./-]/g, "_")}.png`;
  const iconUrl = `/api/v1/assets/${encodeURIComponent(assetName)}`;

  const seed = hash(kind);
  const base = `hsl(${seed % 360} 46% 58%)`;
  const dark = `hsl(${seed % 360} 38% 30%)`;
  const light = `hsl(${seed % 360} 60% 78%)`;
  const style = { "--icon-base": base, "--icon-dark": dark, "--icon-light": light, display: "none" } as CSSProperties;
  const pixels = Array.from({ length: 6 }, (_, index) => ({ x: 3 + ((seed >>> (index * 3)) & 7), y: 3 + ((seed >>> (index * 5 + 1)) & 7), light: Boolean((seed >>> (index + 2)) & 1) }));

  return (
    <div style={{ display: "inline-block", verticalAlign: "middle" }}>
      <img
        className="pixel-icon-img"
        src={iconUrl}
        alt={`${label ?? kind}${material ? `, ${material}` : ""} icon`}
        width={size}
        height={size}
        style={{
          imageRendering: "pixelated",
          objectFit: "contain",
          display: "block"
        }}
        onError={(event) => {
          const img = event.currentTarget;
          img.style.display = "none";
          const fallback = img.nextElementSibling as HTMLElement | null;
          if (fallback) fallback.style.display = "block";
        }}
      />
      <svg className="pixel-icon-fallback" style={style} width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={`${label ?? kind} fallback icon`} shapeRendering="crispEdges">
        <rect width="16" height="16" fill="transparent" />
        <path d="M4 2h8v2h2v8h-2v2H4v-2H2V4h2z" fill="var(--icon-dark)" />
        <path d="M5 3h6v2h2v6h-2v2H5v-2H3V5h2z" fill="var(--icon-base)" />
        {pixels.map((pixel, index) => <rect key={index} x={pixel.x} y={pixel.y} width="2" height="2" fill={pixel.light ? "var(--icon-light)" : "var(--icon-dark)"} />)}
      </svg>
    </div>
  );
}
