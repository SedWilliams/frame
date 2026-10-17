/*
 * CSS values the Design panel reads and writes: shadows, gradients, background
 * layers, and filters. Readers take computed values, as the browser reports
 * them. Writers produce values Frame puts back into styles or classes.
 */

/** Splits on a separator outside parentheses. */
export function splitTop(value: string, separator = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const c of value) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === separator && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += c;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export interface Shadow {
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

/** Shadows from a box-shadow or text-shadow value. */
export function parseShadows(value: string | undefined): Shadow[] {
  if (!value || value === 'none') return [];
  return splitTop(value).map((part) => {
    const inset = /\binset\b/.test(part);
    const color = /(rgba?|hsla?|oklch|oklab|color)\([^)]*\)|#[0-9a-f]{3,8}\b/i.exec(part)?.[0] ?? 'rgba(0, 0, 0, 0.25)';
    const numbers = part.replace(color, '').replace('inset', '').trim().split(/\s+/).map((n) => parseFloat(n)).filter((n) => Number.isFinite(n));
    const [x = 0, y = 0, blur = 0, spread = 0] = numbers;
    return { inset, x, y, blur, spread, color };
  });
}

export function formatShadows(shadows: Shadow[], text = false): string | null {
  if (!shadows.length) return null;
  return shadows
    .map((s) => (text ? `${s.x}px ${s.y}px ${s.blur}px ${s.color}` : `${s.inset ? 'inset ' : ''}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${s.color}`))
    .join(', ');
}

export interface GradientStop {
  color: string;
  /** Percent along the gradient. */
  at: number;
}

export interface Paint {
  type: 'solid' | 'linear' | 'radial' | 'conic' | 'image';
  color?: string;
  angle?: number;
  stops?: GradientStop[];
  url?: string;
  /** For images: cover, contain, or a tiling size. */
  size?: string;
}

/** Background layers from computed background-image, topmost first. */
export function parseBackgroundImage(value: string | undefined): Paint[] {
  if (!value || value === 'none') return [];
  return splitTop(value).flatMap((layer): Paint[] => {
    const url = /^url\(["']?([^"')]+)["']?\)$/.exec(layer);
    if (url) return [{ type: 'image', url: url[1] }];
    const gradient = /^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/s.exec(layer);
    if (!gradient) return [];
    const type = gradient[2] as 'linear' | 'radial' | 'conic';
    const args = splitTop(gradient[3]);
    let angle = 180;
    if (type === 'linear' && args.length && /deg|turn|^to /.test(args[0])) {
      const first = args.shift()!;
      angle = first.startsWith('to ') ? ({ 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to bottom right': 135, 'to bottom left': 225, 'to top left': 315 } as Record<string, number>)[first] ?? 180 : first.endsWith('turn') ? parseFloat(first) * 360 : parseFloat(first);
    } else if (type !== 'linear' && args.length && !/^(rgba?|hsla?|#|oklch|oklab|color)/.test(args[0])) args.shift();
    const stops = args.map((arg, i, all) => {
      const color = /(rgba?|hsla?|oklch|oklab|color)\([^)]*\)|#[0-9a-f]{3,8}\b|^[a-z]+/i.exec(arg)?.[0] ?? '#000000';
      const at = parseFloat(arg.slice(color.length));
      return { color, at: Number.isFinite(at) ? at : Math.round((i / Math.max(1, all.length - 1)) * 100) };
    });
    // A gradient between two copies of one color is how a solid fill stacks above another.
    if (type === 'linear' && stops.length === 2 && stops[0].color === stops[1].color) return [{ type: 'solid', color: stops[0].color }];
    return [{ type, angle, stops }];
  });
}

export function formatPaint(paint: Paint): string {
  if (paint.type === 'image') return `url(${paint.url})`;
  if (paint.type === 'solid') return `linear-gradient(${paint.color}, ${paint.color})`;
  const stops = (paint.stops ?? []).map((s) => `${s.color} ${Math.round(s.at)}%`).join(', ');
  if (paint.type === 'linear') return `linear-gradient(${Math.round(paint.angle ?? 180)}deg, ${stops})`;
  if (paint.type === 'radial') return `radial-gradient(circle, ${stops})`;
  return `conic-gradient(from ${Math.round(paint.angle ?? 0)}deg, ${stops})`;
}

/** The blur radius in a filter or backdrop-filter value, or 0. */
export function parseBlur(value: string | undefined): number {
  const m = /blur\(([\d.]+)px\)/.exec(value ?? '');
  return m ? Number(m[1]) : 0;
}

/** A computed length as a number of pixels, or undefined for auto, normal, and the like. */
export function px(value: string | undefined): number | undefined {
  if (!value) return;
  const n = parseFloat(value);
  return /px$/.test(value) && Number.isFinite(n) ? n : value === '0' ? 0 : undefined;
}
