/**
 * Built-in Rietvalei emblem (sprout, water drop and field in a circle), used on invoices until
 * the owner uploads the real logo file. Paths use a 0–100 viewBox and are shared by the web
 * preview (SVG) and the PDF renderer (pdf-lib drawSvgPath).
 */
export const LOGO_DARK = "#0E4D2E";
export const LOGO_LIME = "#8DC63F";

export type LogoPart = { d: string; fill?: string; stroke?: string; width?: number };

export const LOGO_PARTS: LogoPart[] = [
  // outer double ring
  { d: "M50 3 A47 47 0 1 1 49.99 3 Z", stroke: LOGO_DARK, width: 3.2 },
  { d: "M50 7.5 A42.5 42.5 0 1 1 49.99 7.5 Z", stroke: LOGO_LIME, width: 1.6 },
  // lime arc above the field
  { d: "M24 54 A26.5 26.5 0 1 1 76 54", stroke: LOGO_LIME, width: 3.4 },
  // field (dark, curved horizon)
  { d: "M23.6 54 Q50 41 76.4 54 A26.6 26.6 0 0 1 23.6 54 Z", fill: LOGO_DARK },
  // stem
  { d: "M50 51 C49.4 45 50.6 40 50 34", stroke: LOGO_DARK, width: 2.2 },
  // water drop
  { d: "M50 49 C52.5 55.5 58 58.5 58 64 A8 8 0 0 1 42 64 C42 58.5 47.5 55.5 50 49 Z", fill: "#FFFFFF" },
  // leaves
  { d: "M50 34 C45.6 29 45.6 23 50 17.5 C54.4 23 54.4 29 50 34 Z", fill: LOGO_LIME },
  { d: "M48.6 35 C43 36.4 36.6 34 34.6 27 C41.2 26 46.4 29 48.6 35 Z", fill: LOGO_LIME },
  { d: "M51.4 35 C57 36.4 63.4 34 65.4 27 C58.8 26 53.6 29 51.4 35 Z", fill: LOGO_LIME },
];

export function logoSvg(size = 64): string {
  const parts = LOGO_PARTS.map((p) => `<path d="${p.d}" fill="${p.fill ?? "none"}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.width}" stroke-linecap="round"` : ""}/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${parts}</svg>`;
}
