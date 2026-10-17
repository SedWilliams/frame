/*
 * Colors.
 *
 * Parses the color formats the canvas reports and projects write: hex, rgb(),
 * hsl(), named colors, and the oklch() and oklab() that Tailwind 4's palette
 * uses. The picker works in HSV and writes hex, with two extra digits for alpha.
 */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const named: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  orange: '#ffa500', purple: '#800080', gray: '#808080', grey: '#808080', silver: '#c0c0c0', navy: '#000080',
  teal: '#008080', maroon: '#800000', olive: '#808000', lime: '#00ff00', aqua: '#00ffff', fuchsia: '#ff00ff',
  pink: '#ffc0cb', brown: '#a52a2a', transparent: '#00000000', whitesmoke: '#f5f5f5', gold: '#ffd700',
};

const clamp = (n: number, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, n));

/** Parses a CSS color. Undefined for anything else, such as var() or currentColor. */
export function parseColor(input: string | undefined): RGBA | undefined {
  if (!input) return;
  const value = input.trim().toLowerCase();
  if (named[value]) return parseColor(named[value]);
  let m = /^#([0-9a-f]{3,8})$/.exec(value);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }
  m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
  if (m) {
    const channel = (v: string) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    return { r: channel(m[1]), g: channel(m[2]), b: channel(m[3]), a: alpha(m[4]) };
  }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
  if (m) return { ...hslToRgb(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100), a: alpha(m[4]) };
  m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(value);
  if (m) {
    const l = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : Number(m[1]);
    const c = m[2].endsWith('%') ? (parseFloat(m[2]) / 100) * 0.4 : Number(m[2]);
    const h = (Number(m[3]) * Math.PI) / 180;
    return { ...oklabToRgb(l, c * Math.cos(h), c * Math.sin(h)), a: alpha(m[4]) };
  }
  m = /^oklab\(\s*([\d.]+%?)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(value);
  if (m) {
    const l = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : Number(m[1]);
    return { ...oklabToRgb(l, Number(m[2]), Number(m[3])), a: alpha(m[4]) };
  }
}

function alpha(v: string | undefined) {
  if (v === undefined) return 1;
  return v.endsWith('%') ? parseFloat(v) / 100 : Number(v);
}

function hslToRgb(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}

function oklabToRgb(L: number, a: number, b: number) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255;
  const [r, g, bl] = linear.map((x) => clamp(gamma(x)));
  return { r, g, b: bl };
}

const hex2 = (n: number) => Math.round(clamp(n)).toString(16).padStart(2, '0');

/** `#rrggbb`, or `#rrggbbaa` when the color isn't opaque. */
export function toHex(color: RGBA): string {
  const base = `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;
  return color.a >= 0.999 ? base : `${base}${hex2(color.a * 255)}`;
}

/** Hex without the hash and alpha, as Figma shows it: `293D32`. */
export const hexLabel = (color: RGBA) => toHex({ ...color, a: 1 }).slice(1).toUpperCase();

export interface HSV {
  h: number;
  s: number;
  v: number;
  a: number;
}

export function rgbToHsv({ r, g, b, a }: RGBA): HSV {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max, a };
}

export function hsvToRgb({ h, s, v, a }: HSV): RGBA {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return { r: f(5), g: f(3), b: f(1), a };
}

/** Whether a value is a color the picker can show. */
export const isColor = (value: string | undefined) => !!parseColor(value);
