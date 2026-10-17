/*
 * Tailwind class handling.
 *
 * joinClasses and mergeClasses stand in for clsx and tailwind-merge when the
 * evaluator meets `cn(...)`, so the canvas resolves conflicts the way the app
 * would. applyTailwind is the writer behind the Design panel in Tailwind
 * projects: it turns a style edit such as `paddingTop: 32` into `pt-8`, removes
 * the classes that set the same thing, and leaves classes with variants such as
 * `md:` or `hover:` alone unless it was asked to write that variant.
 *
 * Class names stay compatible with Tailwind 3 and 4. Where the two versions name
 * a size differently, the writer uses an arbitrary value such as `rounded-[4px]`.
 */

import { isRecord, prim, truthy, Unknown, type Value } from './values';

/** clsx semantics: strings, arrays, and objects of class to condition, falsy values dropped. */
export function joinClasses(values: Value[]): string {
  const out: string[] = [];
  const add = (value: Value) => {
    const v = prim(value);
    if (!v || v instanceof Unknown) return;
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'number') out.push(String(v));
    else if (Array.isArray(v)) v.forEach(add);
    else if (isRecord(v)) for (const [key, condition] of Object.entries(v)) if (truthy(condition) !== false) out.push(key);
  };
  values.forEach(add);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

export interface ParsedClass {
  raw: string;
  /** Variant prefix including the trailing colon, such as `md:hover:`. */
  variant: string;
  /** The utility without variants, `!`, or a leading minus. */
  utility: string;
  negative: boolean;
  group?: string;
}

/** Splits `md:hover:-mt-4` into its variant prefix and utility, ignoring colons inside brackets. */
export function parseClass(raw: string): ParsedClass {
  let depth = 0;
  let split = -1;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === ':' && depth === 0) split = i;
  }
  const variant = raw.slice(0, split + 1);
  let utility = raw.slice(split + 1).replace(/^!/, '').replace(/!$/, '');
  const negative = utility.startsWith('-');
  if (negative) utility = utility.slice(1);
  return { raw, variant, utility, negative, group: groupOf(utility) };
}

const sides: Record<string, string> = { t: 'top', r: 'right', b: 'bottom', l: 'left', s: 'start', e: 'end', x: 'x', y: 'y' };

/** Which property a utility sets, as a group name. Undefined for utilities Frame doesn't track. */
export function groupOf(utility: string): string | undefined {
  let m: RegExpExecArray | null;
  if ((m = /^([pm])([xytrblse]?)-/.exec(utility))) return m[1] + m[2];
  if ((m = /^space-([xy])-/.exec(utility))) return `space-${m[1]}`;
  if ((m = /^gap-([xy])-/.exec(utility))) return `gap-${m[1]}`;
  if (/^gap-/.test(utility)) return 'gap';
  if ((m = /^(size|w|h|min-w|max-w|min-h|max-h|basis|z|order)-/.exec(utility))) return m[1];
  if (/^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents|table|table-row|table-cell|flow-root|list-item)$/.test(utility))
    return 'display';
  if (/^(static|fixed|absolute|relative|sticky)$/.test(utility)) return 'position';
  if ((m = /^inset-([xy])-/.exec(utility))) return `inset-${m[1]}`;
  if (/^inset-/.test(utility)) return 'inset';
  if ((m = /^(top|right|bottom|left|start|end)-/.exec(utility))) return m[1];
  if (/^flex-(row|col|row-reverse|col-reverse)$/.test(utility)) return 'flex-direction';
  if (/^flex-(wrap|nowrap|wrap-reverse)$/.test(utility)) return 'flex-wrap';
  if (/^flex-(1|auto|initial|none|\d+|\[.+\])$/.test(utility)) return 'flex';
  if (/^(grow|flex-grow)(-|$)/.test(utility)) return 'grow';
  if (/^(shrink|flex-shrink)(-|$)/.test(utility)) return 'shrink';
  if (/^justify-(start|end|center|between|around|evenly|stretch|normal|end-safe|center-safe|baseline)$/.test(utility)) return 'justify';
  if (/^justify-items-/.test(utility)) return 'justify-items';
  if (/^justify-self-/.test(utility)) return 'justify-self';
  if (/^items-/.test(utility)) return 'items';
  if (/^self-/.test(utility)) return 'self';
  if (/^content-(start|end|center|between|around|evenly|stretch|normal|baseline)$/.test(utility)) return 'align-content';
  if ((m = /^place-(content|items|self)-/.exec(utility))) return `place-${m[1]}`;
  if ((m = /^(grid-cols|grid-rows|grid-flow|auto-cols|auto-rows|col|row)-/.exec(utility))) return m[1];
  if (/^text-(left|center|right|justify|start|end)$/.test(utility)) return 'text-align';
  if (/^text-(xs|sm|base|lg|xl|[2-9]xl)(\/.+)?$/.test(utility)) return 'font-size';
  if (/^text-\[(length:|size:)?(-?\d|\.\d|calc|clamp|min\(|max\()/.test(utility)) return 'font-size';
  if (/^text-(wrap|nowrap|balance|pretty)$/.test(utility)) return 'text-wrap';
  if (/^(truncate|text-ellipsis|text-clip)$/.test(utility)) return 'text-overflow';
  if (/^text-/.test(utility)) return 'color';
  if (/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(utility) || /^font-\[\d+\]$/.test(utility))
    return 'font-weight';
  if (/^font-(stretch|features)/.test(utility)) return undefined;
  if (/^font-/.test(utility)) return 'font-family';
  if (/^(italic|not-italic)$/.test(utility)) return 'font-style';
  if (/^leading-/.test(utility)) return 'leading';
  if (/^tracking-/.test(utility)) return 'tracking';
  if (/^(uppercase|lowercase|capitalize|normal-case)$/.test(utility)) return 'text-transform';
  if (/^(underline|overline|line-through|no-underline)$/.test(utility)) return 'text-decoration';
  if (/^whitespace-/.test(utility)) return 'whitespace';
  if (/^line-clamp-/.test(utility)) return 'line-clamp';
  if (/^bg-(linear|gradient|radial|conic)(-|$)/.test(utility) || /^bg-none$/.test(utility) || /^bg-\[(url|linear-gradient|radial-gradient|conic-gradient|image:)/.test(utility))
    return 'bg-image';
  if (/^bg-(cover|contain|auto)$/.test(utility)) return 'bg-size';
  if (/^bg-(center|top|bottom|left|right|left-top|left-bottom|right-top|right-bottom|top-left|top-right|bottom-left|bottom-right)$/.test(utility))
    return 'bg-position';
  if (/^bg-(repeat|no-repeat|repeat-x|repeat-y|repeat-round|repeat-space)$/.test(utility)) return 'bg-repeat';
  if (/^bg-(fixed|local|scroll|clip-|origin-|blend-)/.test(utility)) return undefined;
  if (/^bg-/.test(utility)) return 'bg-color';
  if (/^rounded(-(none|xs|sm|md|lg|xl|[2-4]xl|full|\[.+\]))?$/.test(utility)) return 'rounded';
  if ((m = /^rounded-(tl|tr|br|bl|ss|se|es|ee)(-|$)/.exec(utility))) return `rounded-${m[1]}`;
  if ((m = /^rounded-([trblse])(-|$)/.exec(utility))) return `rounded-${m[1]}`;
  if (/^border(-(0|2|4|8|\d+|\[\d*\.?\d+(px|rem|em)\]|\[length:.+\]))?$/.test(utility)) return 'border-w';
  if ((m = /^border-([xytrblse])(-(0|2|4|8|\d+|\[\d*\.?\d+(px|rem|em)\]))?$/.exec(utility))) return `border-w-${m[1]}`;
  if (/^border-(solid|dashed|dotted|double|hidden|none)$/.test(utility)) return 'border-style';
  if (/^border-(collapse|separate|spacing)/.test(utility)) return undefined;
  if (/^border-([xytrblse])-/.test(utility)) return undefined;
  if (/^border-/.test(utility)) return 'border-color';
  if (/^outline(-(0|1|2|4|8|\[\d+px\]))?$/.test(utility)) return 'outline-w';
  if (/^outline-offset-/.test(utility)) return 'outline-offset';
  if (/^outline-(solid|dashed|dotted|double|none|hidden)$/.test(utility)) return 'outline-style';
  if (/^outline-/.test(utility)) return 'outline-color';
  if (/^shadow(-(2xs|xs|sm|md|lg|xl|2xl|inner|none|\[.+\]))?$/.test(utility)) return 'shadow';
  if (/^opacity-/.test(utility)) return 'opacity';
  if (/^mix-blend-/.test(utility)) return 'mix-blend';
  if (/^blur(-|$)/.test(utility)) return 'blur';
  if (/^backdrop-blur(-|$)/.test(utility)) return 'backdrop-blur';
  if (/^rotate-/.test(utility)) return 'rotate';
  if ((m = /^scale-([xy])-/.exec(utility))) return `scale-${m[1]}`;
  if (/^scale-/.test(utility)) return 'scale';
  if ((m = /^translate-([xy])-/.exec(utility))) return `translate-${m[1]}`;
  if ((m = /^overflow-([xy])-/.exec(utility))) return `overflow-${m[1]}`;
  if (/^overflow-/.test(utility)) return 'overflow';
  if (/^object-(contain|cover|fill|none|scale-down)$/.test(utility)) return 'object-fit';
  if (/^object-/.test(utility)) return 'object-position';
  if (/^aspect-/.test(utility)) return 'aspect';
  if (/^cursor-/.test(utility)) return 'cursor';
  if (/^(visible|invisible|collapse)$/.test(utility)) return 'visibility';
  if (/^box-(border|content)$/.test(utility)) return 'box-sizing';
  if (/^(list-none|list-disc|list-decimal)$/.test(utility)) return 'list-style';
  void sides;
}

/** Groups a later class overrides besides its own, as tailwind-merge resolves them. */
const covers: Record<string, string[]> = {
  p: ['px', 'py', 'pt', 'pr', 'pb', 'pl', 'ps', 'pe'],
  px: ['pr', 'pl', 'ps', 'pe'],
  py: ['pt', 'pb'],
  m: ['mx', 'my', 'mt', 'mr', 'mb', 'ml', 'ms', 'me'],
  mx: ['mr', 'ml', 'ms', 'me'],
  my: ['mt', 'mb'],
  gap: ['gap-x', 'gap-y'],
  size: ['w', 'h'],
  inset: ['inset-x', 'inset-y', 'top', 'right', 'bottom', 'left', 'start', 'end'],
  'inset-x': ['left', 'right', 'start', 'end'],
  'inset-y': ['top', 'bottom'],
  rounded: ['rounded-t', 'rounded-r', 'rounded-b', 'rounded-l', 'rounded-s', 'rounded-e', 'rounded-tl', 'rounded-tr', 'rounded-br', 'rounded-bl', 'rounded-ss', 'rounded-se', 'rounded-es', 'rounded-ee'],
  'rounded-t': ['rounded-tl', 'rounded-tr'],
  'rounded-r': ['rounded-tr', 'rounded-br'],
  'rounded-b': ['rounded-br', 'rounded-bl'],
  'rounded-l': ['rounded-tl', 'rounded-bl'],
  'border-w': ['border-w-x', 'border-w-y', 'border-w-t', 'border-w-r', 'border-w-b', 'border-w-l', 'border-w-s', 'border-w-e'],
  'border-w-x': ['border-w-l', 'border-w-r', 'border-w-s', 'border-w-e'],
  'border-w-y': ['border-w-t', 'border-w-b'],
  overflow: ['overflow-x', 'overflow-y'],
  flex: ['grow', 'shrink', 'basis'],
  scale: ['scale-x', 'scale-y'],
};

const conflicts = (group: string, other: string) => group === other || !!covers[group]?.includes(other);

/** tailwind-merge's job, simplified: later classes win over earlier ones that set the same thing. */
export function mergeClasses(classes: string): string {
  const kept: ParsedClass[] = [];
  for (const raw of classes.split(/\s+/).filter(Boolean)) {
    const parsed = parseClass(raw);
    for (let i = kept.length - 1; i >= 0; i--) {
      const earlier = kept[i];
      if (earlier.raw === raw) kept.splice(i, 1);
      else if (parsed.group && earlier.group && earlier.variant === parsed.variant && conflicts(parsed.group, earlier.group))
        kept.splice(i, 1);
    }
    kept.push(parsed);
  }
  return kept.map((c) => c.raw).join(' ');
}

/* The writer. */

const scale = new Set([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96]);

/** An arbitrary value, with spaces as underscores the way Tailwind reads them. */
const arbitrary = (value: string) => `[${value.trim().replace(/_/g, '\\_').replace(/\s+/g, '_')}]`;

const px = (value: string | number): number | undefined => {
  if (typeof value === 'number') return value;
  const m = /^(-?\d*\.?\d+)px$/.exec(value.trim());
  return m ? Number(m[1]) : value.trim() === '0' ? 0 : undefined;
};

/** A spacing-scale class such as `pt-8`, `-mt-1`, `w-px`, or `w-[13px]`. */
function spacing(prefix: string, value: string | number, keywords: Record<string, string> = {}): string {
  const raw = String(value).trim();
  if (keywords[raw] !== undefined) return keywords[raw] ? `${prefix}-${keywords[raw]}` : prefix;
  const n = px(value);
  if (n !== undefined) {
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs === 1) return `${sign}${prefix}-px`;
    if (scale.has(abs / 4)) return `${sign}${prefix}-${abs / 4}`;
    return `${sign}${prefix}-[${abs}px]`;
  }
  if (raw === '100%') return `${prefix}-full`;
  const fraction = { '50%': '1/2', '33.333333%': '1/3', '66.666667%': '2/3', '25%': '1/4', '75%': '3/4' }[raw];
  if (fraction) return `${prefix}-${fraction}`;
  if (raw.startsWith('-')) return `-${prefix}-${arbitrary(raw.slice(1))}`;
  return `${prefix}-${arbitrary(raw)}`;
}

const sizeKeywords: Record<string, string> = {
  auto: 'auto',
  'fit-content': 'fit',
  'max-content': 'max',
  'min-content': 'min',
  '100%': 'full',
  none: 'none',
};

function color(prefix: string, value: string, typed = false): string {
  const v = value.trim();
  if (v === 'transparent' || v === 'currentColor' || v === 'currentcolor' || v === 'inherit')
    return `${prefix}-${v === 'transparent' ? 'transparent' : v === 'inherit' ? 'inherit' : 'current'}`;
  if (/^#fff(fff)?$/i.test(v)) return `${prefix}-white`;
  if (/^#000(000)?$/i.test(v)) return `${prefix}-black`;
  // A theme color variable such as var(--color-primary) has a class of its own.
  const token = /^var\(--color-([\w-]+)\)$/.exec(v);
  if (token) return `${prefix}-${token[1]}`;
  if (typed && v.startsWith('var(')) return `${prefix}-[color:${v.replace(/\s+/g, '_')}]`;
  return `${prefix}-${arbitrary(v)}`;
}

const fontSizes: Record<number, string> = { 12: 'xs', 14: 'sm', 16: 'base', 18: 'lg', 20: 'xl', 24: '2xl', 30: '3xl', 36: '4xl', 48: '5xl', 60: '6xl', 72: '7xl', 96: '8xl', 128: '9xl' };
const fontWeights: Record<number, string> = { 100: 'thin', 200: 'extralight', 300: 'light', 400: 'normal', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black' };
const leadings: Record<string, string> = { '1': 'none', '1.25': 'tight', '1.375': 'snug', '1.5': 'normal', '1.625': 'relaxed', '2': 'loose' };
const trackings: Record<string, string> = { '-0.05em': 'tighter', '-0.025em': 'tight', '0em': 'normal', '0': 'normal', '0.025em': 'wide', '0.05em': 'wider', '0.1em': 'widest' };
const radii: Record<number, string> = { 0: 'none', 6: 'md', 8: 'lg', 12: 'xl', 16: '2xl', 24: '3xl' };

const keywordClass = (map: Record<string, string>) => (value: string | number) => map[String(value).trim()];

/**
 * For each style property the Design panel writes: the group its classes belong
 * to, and how to turn a value into a class. An undefined class means the value
 * can't be written as a class.
 */
const writers: Record<string, { group: string; write: (value: string | number) => string | undefined }> = {
  display: { group: 'display', write: (v) => (v === 'none' ? 'hidden' : /^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|contents|table|flow-root)$/.test(String(v)) ? String(v) : undefined) },
  position: { group: 'position', write: (v) => (/^(static|fixed|absolute|relative|sticky)$/.test(String(v)) ? String(v) : undefined) },
  flexDirection: { group: 'flex-direction', write: keywordClass({ row: 'flex-row', column: 'flex-col', 'row-reverse': 'flex-row-reverse', 'column-reverse': 'flex-col-reverse' }) },
  flexWrap: { group: 'flex-wrap', write: keywordClass({ wrap: 'flex-wrap', nowrap: 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' }) },
  justifyContent: { group: 'justify', write: keywordClass({ 'flex-start': 'justify-start', start: 'justify-start', 'flex-end': 'justify-end', end: 'justify-end', center: 'justify-center', 'space-between': 'justify-between', 'space-around': 'justify-around', 'space-evenly': 'justify-evenly', stretch: 'justify-stretch', normal: 'justify-normal' }) },
  alignItems: { group: 'items', write: keywordClass({ 'flex-start': 'items-start', start: 'items-start', 'flex-end': 'items-end', end: 'items-end', center: 'items-center', baseline: 'items-baseline', stretch: 'items-stretch' }) },
  alignSelf: { group: 'self', write: keywordClass({ auto: 'self-auto', 'flex-start': 'self-start', start: 'self-start', 'flex-end': 'self-end', end: 'self-end', center: 'self-center', stretch: 'self-stretch', baseline: 'self-baseline' }) },
  alignContent: { group: 'align-content', write: keywordClass({ 'flex-start': 'content-start', 'flex-end': 'content-end', center: 'content-center', 'space-between': 'content-between', 'space-around': 'content-around', stretch: 'content-stretch' }) },
  gap: { group: 'gap', write: (v) => spacing('gap', v) },
  rowGap: { group: 'gap-y', write: (v) => spacing('gap-y', v) },
  columnGap: { group: 'gap-x', write: (v) => spacing('gap-x', v) },
  gridTemplateColumns: { group: 'grid-cols', write: (v) => gridTracks('grid-cols', v) },
  gridTemplateRows: { group: 'grid-rows', write: (v) => gridTracks('grid-rows', v) },
  flex: { group: 'flex', write: (v) => ({ '1 1 0%': 'flex-1', '1 1 0px': 'flex-1', '1': 'flex-1', '1 1 auto': 'flex-auto', auto: 'flex-auto', '0 1 auto': 'flex-initial', none: 'flex-none', '0 0 auto': 'flex-none' })[String(v).trim()] ?? `flex-${arbitrary(String(v))}` },
  flexGrow: { group: 'grow', write: (v) => (Number(v) === 1 ? 'grow' : Number(v) === 0 ? 'grow-0' : `grow-${arbitrary(String(v))}`) },
  flexShrink: { group: 'shrink', write: (v) => (Number(v) === 1 ? 'shrink' : Number(v) === 0 ? 'shrink-0' : `shrink-${arbitrary(String(v))}`) },
  flexBasis: { group: 'basis', write: (v) => spacing('basis', v, { auto: 'auto', '0%': '0' }) },
  width: { group: 'w', write: (v) => spacing('w', v, { ...sizeKeywords, '100vw': 'screen' }) },
  height: { group: 'h', write: (v) => spacing('h', v, { ...sizeKeywords, '100vh': 'screen', '100dvh': 'dvh' }) },
  minWidth: { group: 'min-w', write: (v) => spacing('min-w', v, sizeKeywords) },
  maxWidth: { group: 'max-w', write: (v) => spacing('max-w', v, sizeKeywords) },
  minHeight: { group: 'min-h', write: (v) => spacing('min-h', v, { ...sizeKeywords, '100vh': 'screen', '100dvh': 'dvh' }) },
  maxHeight: { group: 'max-h', write: (v) => spacing('max-h', v, { ...sizeKeywords, '100vh': 'screen' }) },
  top: { group: 'top', write: (v) => spacing('top', v, { auto: 'auto' }) },
  right: { group: 'right', write: (v) => spacing('right', v, { auto: 'auto' }) },
  bottom: { group: 'bottom', write: (v) => spacing('bottom', v, { auto: 'auto' }) },
  left: { group: 'left', write: (v) => spacing('left', v, { auto: 'auto' }) },
  inset: { group: 'inset', write: (v) => spacing('inset', v, { auto: 'auto' }) },
  zIndex: { group: 'z', write: (v) => (/^(0|10|20|30|40|50|auto)$/.test(String(v)) ? `z-${v}` : `z-${arbitrary(String(v))}`) },
  fontSize: {
    group: 'font-size',
    write: (v) => {
      const n = px(v);
      return n !== undefined && fontSizes[n] ? `text-${fontSizes[n]}` : `text-${arbitrary(n !== undefined ? `${n}px` : String(v))}`;
    },
  },
  fontWeight: { group: 'font-weight', write: (v) => (fontWeights[Number(v)] ? `font-${fontWeights[Number(v)]}` : `font-${arbitrary(String(v))}`) },
  fontFamily: {
    group: 'font-family',
    write: (v) => {
      const family = String(v).trim();
      if (/^(ui-)?sans-serif|^system-ui/.test(family)) return 'font-sans';
      if (/^(ui-)?serif/.test(family)) return 'font-serif';
      if (/^(ui-)?monospace/.test(family)) return 'font-mono';
      const token = /^var\(--font-([\w-]+)\)$/.exec(family);
      if (token) return `font-${token[1]}`;
      return `font-${arbitrary(family.replace(/"/g, "'"))}`;
    },
  },
  fontStyle: { group: 'font-style', write: (v) => (v === 'italic' ? 'italic' : 'not-italic') },
  lineHeight: {
    group: 'leading',
    write: (v) => {
      const raw = String(v).trim();
      if (leadings[raw]) return `leading-${leadings[raw]}`;
      return `leading-${arbitrary(typeof v === 'number' && v > 4 ? `${v}px` : raw)}`;
    },
  },
  letterSpacing: { group: 'tracking', write: (v) => (trackings[String(v).trim()] ? `tracking-${trackings[String(v).trim()]}` : `tracking-${arbitrary(typeof v === 'number' ? `${v}px` : String(v))}`) },
  textAlign: { group: 'text-align', write: (v) => (/^(left|center|right|justify|start|end)$/.test(String(v)) ? `text-${v}` : undefined) },
  textTransform: { group: 'text-transform', write: keywordClass({ uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize', none: 'normal-case' }) },
  textDecoration: { group: 'text-decoration', write: (v) => ({ underline: 'underline', 'line-through': 'line-through', overline: 'overline', none: 'no-underline' })[String(v).split(' ')[0]] },
  textDecorationLine: { group: 'text-decoration', write: (v) => ({ underline: 'underline', 'line-through': 'line-through', overline: 'overline', none: 'no-underline' })[String(v)] },
  whiteSpace: { group: 'whitespace', write: (v) => `whitespace-${v}` },
  color: { group: 'color', write: (v) => color('text', String(v), true) },
  backgroundColor: { group: 'bg-color', write: (v) => color('bg', String(v)) },
  backgroundImage: { group: 'bg-image', write: (v) => (v === 'none' ? 'bg-none' : `bg-${arbitrary(String(v))}`) },
  backgroundSize: { group: 'bg-size', write: (v) => (/^(cover|contain|auto)$/.test(String(v)) ? `bg-${v}` : `bg-size-${arbitrary(String(v))}`) },
  backgroundPosition: { group: 'bg-position', write: (v) => (/^(center|top|bottom|left|right)$/.test(String(v)) ? `bg-${v}` : `bg-position-${arbitrary(String(v))}`) },
  backgroundRepeat: { group: 'bg-repeat', write: (v) => (v === 'no-repeat' ? 'bg-no-repeat' : `bg-${v}`) },
  borderRadius: {
    group: 'rounded',
    write: (v) => {
      const n = px(v);
      if (n !== undefined && radii[n]) return `rounded-${radii[n]}`;
      if (n !== undefined && n >= 9999) return 'rounded-full';
      if (String(v).trim() === '50%' || String(v).trim() === '9999px') return 'rounded-full';
      return `rounded-${arbitrary(n !== undefined ? `${n}px` : String(v))}`;
    },
  },
  borderTopLeftRadius: { group: 'rounded-tl', write: (v) => `rounded-tl-${arbitrary(px(v) !== undefined ? `${px(v)}px` : String(v))}` },
  borderTopRightRadius: { group: 'rounded-tr', write: (v) => `rounded-tr-${arbitrary(px(v) !== undefined ? `${px(v)}px` : String(v))}` },
  borderBottomRightRadius: { group: 'rounded-br', write: (v) => `rounded-br-${arbitrary(px(v) !== undefined ? `${px(v)}px` : String(v))}` },
  borderBottomLeftRadius: { group: 'rounded-bl', write: (v) => `rounded-bl-${arbitrary(px(v) !== undefined ? `${px(v)}px` : String(v))}` },
  borderWidth: { group: 'border-w', write: (v) => borderWidth('border', v) },
  borderTopWidth: { group: 'border-w-t', write: (v) => borderWidth('border-t', v) },
  borderRightWidth: { group: 'border-w-r', write: (v) => borderWidth('border-r', v) },
  borderBottomWidth: { group: 'border-w-b', write: (v) => borderWidth('border-b', v) },
  borderLeftWidth: { group: 'border-w-l', write: (v) => borderWidth('border-l', v) },
  borderColor: { group: 'border-color', write: (v) => color('border', String(v)) },
  borderStyle: { group: 'border-style', write: (v) => (/^(solid|dashed|dotted|double|none|hidden)$/.test(String(v)) ? `border-${v}` : undefined) },
  outlineWidth: { group: 'outline-w', write: (v) => (px(v) === 1 ? 'outline' : `outline-${arbitrary(`${px(v) ?? v}px`)}`) },
  outlineColor: { group: 'outline-color', write: (v) => color('outline', String(v)) },
  outlineStyle: { group: 'outline-style', write: (v) => `outline-${v}` },
  outlineOffset: { group: 'outline-offset', write: (v) => (px(v) !== undefined && px(v)! < 0 ? `-outline-offset-${arbitrary(`${-px(v)!}px`)}` : `outline-offset-${arbitrary(`${px(v) ?? v}px`)}`) },
  boxShadow: { group: 'shadow', write: (v) => (v === 'none' ? 'shadow-none' : `shadow-${arbitrary(String(v))}`) },
  opacity: {
    group: 'opacity',
    write: (v) => {
      const percent = Math.round(Number(v) * 100);
      return Number.isFinite(percent) && percent % 5 === 0 ? `opacity-${percent}` : `opacity-${arbitrary(String(v))}`;
    },
  },
  mixBlendMode: { group: 'mix-blend', write: (v) => `mix-blend-${v}` },
  overflow: { group: 'overflow', write: (v) => (/^(hidden|visible|auto|scroll|clip)$/.test(String(v)) ? `overflow-${v}` : undefined) },
  overflowX: { group: 'overflow-x', write: (v) => `overflow-x-${v}` },
  overflowY: { group: 'overflow-y', write: (v) => `overflow-y-${v}` },
  objectFit: { group: 'object-fit', write: (v) => `object-${v}` },
  objectPosition: { group: 'object-position', write: (v) => (/^(center|top|bottom|left|right)$/.test(String(v)) ? `object-${v}` : `object-${arbitrary(String(v))}`) },
  aspectRatio: { group: 'aspect', write: (v) => (String(v) === '1 / 1' || String(v) === '1' ? 'aspect-square' : String(v) === '16 / 9' ? 'aspect-video' : `aspect-${arbitrary(String(v).replace(/\s/g, ''))}`) },
  rotate: { group: 'rotate', write: (v) => rotate(v) },
  visibility: { group: 'visibility', write: (v) => (v === 'hidden' ? 'invisible' : v === 'visible' ? 'visible' : undefined) },
  boxSizing: { group: 'box-sizing', write: (v) => (v === 'border-box' ? 'box-border' : 'box-content') },
  cursor: { group: 'cursor', write: (v) => `cursor-${v}` },
  filter: { group: 'blur', write: (v) => { const m = /^blur\((.+)\)$/.exec(String(v).trim()); return m ? `blur-${arbitrary(m[1])}` : undefined; } },
  backdropFilter: { group: 'backdrop-blur', write: (v) => { const m = /^blur\((.+)\)$/.exec(String(v).trim()); return m ? `backdrop-blur-${arbitrary(m[1])}` : undefined; } },
  scale: { group: 'scale', write: (v) => scaleClass(v) },
};
for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
  const short = side[0].toLowerCase();
  writers[`padding${side}`] = { group: `p${short}`, write: (v) => spacing(`p${short}`, v) };
  writers[`margin${side}`] = { group: `m${short}`, write: (v) => spacing(`m${short}`, v, { auto: 'auto' }) };
}
writers.paddingInline = { group: 'px', write: (v) => spacing('px', v) };
writers.paddingBlock = { group: 'py', write: (v) => spacing('py', v) };
writers.marginInline = { group: 'mx', write: (v) => spacing('mx', v, { auto: 'auto' }) };
writers.marginBlock = { group: 'my', write: (v) => spacing('my', v, { auto: 'auto' }) };
writers.padding = { group: 'p', write: (v) => spacing('p', v) };
writers.margin = { group: 'm', write: (v) => spacing('m', v, { auto: 'auto' }) };

function borderWidth(prefix: string, value: string | number) {
  const n = px(value);
  if (n === 1) return prefix;
  if (n === 0 || n === 2 || n === 4 || n === 8) return `${prefix}-${n}`;
  return `${prefix}-${arbitrary(n !== undefined ? `${n}px` : String(value))}`;
}

function gridTracks(prefix: string, value: string | number) {
  const m = /^repeat\((\d+),\s*minmax\(0(px)?,\s*1fr\)\)$/.exec(String(value).trim());
  if (m) return `${prefix}-${m[1]}`;
  if (String(value) === 'none') return `${prefix}-none`;
  return `${prefix}-${arbitrary(String(value))}`;
}

function rotate(value: string | number) {
  const deg = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(deg)) return undefined;
  const sign = deg < 0 ? '-' : '';
  const abs = Math.abs(deg);
  return [0, 1, 2, 3, 6, 12, 45, 90, 180].includes(abs) ? `${sign}rotate-${abs}` : `${sign}rotate-${arbitrary(`${abs}deg`)}`;
}

function scaleClass(value: string | number) {
  const [x, y = x] = String(value).trim().split(/\s+/).map(Number);
  if (x === -1 && y === 1) return '-scale-x-100';
  if (x === 1 && y === -1) return '-scale-y-100';
  if (x === y && Number.isFinite(x)) return x === 1 ? 'scale-100' : `scale-${arbitrary(String(x))}`;
  return undefined;
}

/** Whether every property in an edit has a class writer. */
export function canWriteTailwind(props: string[]) {
  return props.every((prop) => prop in writers);
}

/**
 * Applies a style edit to a class string. `null` removes the property's classes.
 * A new class takes the place of the first class it replaces, so a change reads
 * as a one-word diff. Classes for other variants are left alone.
 */
export function applyTailwind(classes: string, edit: Record<string, string | number | null>, variant = ''): string {
  const list = classes.split(/\s+/).filter(Boolean).map(parseClass);
  for (const [prop, value] of Object.entries(edit)) {
    const writer = writers[prop];
    if (!writer) continue;
    const next = value === null || value === '' ? undefined : writer.write(value);
    let at = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      if (c.variant === variant && c.group && conflicts(writer.group, c.group)) {
        list.splice(i, 1);
        at = i;
      }
    }
    if (next) {
      const parsed = parseClass(variant + next);
      if (at >= 0) list.splice(at, 0, parsed);
      else list.push(parsed);
    }
  }
  return list.map((c) => c.raw).join(' ');
}

/** The base (no variant) class that currently sets a property's group, if any. */
export function classFor(classes: string, prop: string, variant = ''): string | undefined {
  const writer = writers[prop];
  if (!writer) return;
  return classes
    .split(/\s+/)
    .filter(Boolean)
    .map(parseClass)
    .reverse()
    .find((c) => c.variant === variant && c.group === writer.group)?.raw;
}
