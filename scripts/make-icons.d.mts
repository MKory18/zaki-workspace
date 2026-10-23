/** The default theme's surface colour, `#RRGGBB`: what the icons are drawn on. */
export const BACKGROUND: string;

/** The maskable safe zone: a circle of this radius, as a fraction of the icon size, around the centre. */
export const SAFE_ZONE: number;

export interface IconSpec {
  /** Path from the repository root. */
  file: string;
  /** Width and height in pixels. */
  size: number;
  /** `any`: rounded tile with transparent corners. `maskable`: full-bleed, mark inside the safe zone. `apple`: full-bleed and opaque. */
  kind: "any" | "maskable" | "apple";
}

/** The icons the script writes. */
export const OUTPUTS: readonly IconSpec[];

/** Draws one icon (PNG bytes) from src/app/icon.svg. */
export function renderIcon(spec: Pick<IconSpec, "size" | "kind">): Promise<Buffer>;

/** Draws and writes every icon in OUTPUTS. */
export function main(): Promise<void>;
