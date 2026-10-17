/*
 * What Frame knows about popular packages.
 *
 * Frame doesn't load packages from node_modules. Instead this table stands in for
 * the ones that shape how a page looks: React's hooks, Next.js and React Router
 * links and images, next/font, framer-motion, Radix primitives, icon sets, and the
 * class helpers clsx, tailwind-merge, and class-variance-authority. A hook returns
 * its initial state, a link renders an <a>, and an overlay such as a dialog's
 * content renders nothing, the way the page looks before anyone interacts with it.
 * Imports from any other package evaluate to UNKNOWN.
 */

import type { Evaluator } from './evaluate';
import { Closure, isRecord, Lit, Native, prim, toText, truthy, Unknown, UNKNOWN, type Value } from './values';
import { joinClasses, mergeClasses } from './tailwind';

/** How a known component renders. Natives with one of these work as JSX tags. */
export type KnownComponent =
  /** Renders as an HTML element. `props` rewrites the props first, such as Link's `to` to `href`. */
  | {
      kind: 'element';
      tag: string;
      props?: (props: Record<string, Value>, ev: Evaluator) => Record<string, Value>;
      /** With `asChild`, merge into the child instead, as Radix does. */
      asChild?: boolean;
    }
  /** Renders its children only, such as a context provider or a router. */
  | { kind: 'transparent' }
  /** Renders nothing, such as <Head> or a closed dialog's content. */
  | { kind: 'hidden' }
  /** Radix Slot: merges its props into its only child. */
  | { kind: 'slot' }
  | { kind: 'routes' }
  | { kind: 'route' }
  | { kind: 'outlet' }
  | { kind: 'icon'; library: string; name: string }
  | { kind: 'placeholder'; name: string }
  /** An object with members, such as `motion` or a Radix namespace import. */
  | { kind: 'namespace'; member: (key: string) => Value }
  | { kind: 'constructor'; member?: (key: string) => Value }
  /** A React context. As a tag it provides `value` to its children. */
  | { kind: 'context'; context: Context; member: (key: string) => Value }
  | { kind: 'consumer'; context: Context };

/** A React context created with createContext. Providers push values while their children render. */
export class Context {
  values: Value[] = [];
  constructor(readonly fallback: Value) {}
  get current() {
    return this.values.length ? this.values[this.values.length - 1] : this.fallback;
  }
}

const fn = (name: string, call: (args: Value[], ev: Evaluator) => Value) => new Native(name, call);
const component = (name: string, known: KnownComponent) =>
  new Native(name, () => UNKNOWN, known);
const noop = fn('noop', () => undefined);
const record = (entries: Record<string, Value>): Record<string, Value> => entries;

const transparent = (name: string) => component(name, { kind: 'transparent' });
const hidden = (name: string) => component(name, { kind: 'hidden' });
const element = (
  name: string,
  tag: string,
  props?: (props: Record<string, Value>, ev: Evaluator) => Record<string, Value>,
  asChild = false,
) => component(name, { kind: 'element', tag, props, asChild });

/** Drops props that only mean something to the component. */
function omit(props: Record<string, Value>, names: string[]) {
  const result = { ...props };
  for (const name of names) delete result[name];
  return result;
}

/** A link target as a string. Accepts objects like `{ pathname: '/about' }`. */
function hrefOf(value: Value): Value {
  const target = prim(value);
  if (isRecord(target)) return target.pathname ?? '#';
  return value;
}

function createContext(fallback: Value) {
  const context = new Context(fallback);
  const native: Native = new Native('Context', () => UNKNOWN, {
    kind: 'context',
    context,
    member: (key) =>
      key === 'Provider'
        ? component('Provider', { kind: 'context', context, member: () => UNKNOWN })
        : key === 'Consumer'
          ? component('Consumer', { kind: 'consumer', context })
          : UNKNOWN,
  });
  return native;
}

const react = (): Record<string, Value> => ({
  useState: fn('useState', ([initial], ev) => [
    initial instanceof Closure || initial instanceof Native ? ev.call(initial, []) : initial,
    noop,
  ]),
  useReducer: fn('useReducer', ([, initial, init], ev) => [init ? ev.call(init, [initial]) : initial, noop]),
  useMemo: fn('useMemo', ([factory], ev) => ev.call(factory, [])),
  useCallback: fn('useCallback', ([callback]) => callback),
  useRef: fn('useRef', ([initial]) => ({ current: initial })),
  useEffect: noop,
  useLayoutEffect: noop,
  useInsertionEffect: noop,
  useImperativeHandle: noop,
  useDebugValue: noop,
  useId: fn('useId', () => ':frame:'),
  useTransition: fn('useTransition', () => [false, noop]),
  useDeferredValue: fn('useDeferredValue', ([value]) => value),
  useOptimistic: fn('useOptimistic', ([value]) => [value, noop]),
  useActionState: fn('useActionState', ([, initial]) => [initial, noop, false]),
  useFormStatus: fn('useFormStatus', () => ({ pending: false })),
  useSyncExternalStore: fn('useSyncExternalStore', () => UNKNOWN),
  useContext: fn('useContext', ([context]) =>
    context instanceof Native && context.component?.kind === 'context' ? context.component.context.current : UNKNOWN,
  ),
  use: fn('use', ([value]) =>
    value instanceof Native && value.component?.kind === 'context' ? value.component.context.current : UNKNOWN,
  ),
  createContext: fn('createContext', ([fallback]) => createContext(fallback)),
  forwardRef: fn('forwardRef', ([render]) => render),
  memo: fn('memo', ([render]) => render),
  lazy: fn('lazy', () => component('Lazy', { kind: 'placeholder', name: 'Lazy component' })),
  createElement: fn('createElement', () => UNKNOWN),
  cloneElement: fn('cloneElement', ([element]) => element),
  isValidElement: fn('isValidElement', () => true),
  Fragment: transparent('Fragment'),
  StrictMode: transparent('StrictMode'),
  Suspense: transparent('Suspense'),
  Profiler: transparent('Profiler'),
  Children: record({
    map: fn('map', ([children, callback], ev) => {
      const list = prim(children);
      const items = Array.isArray(list) ? list : list === undefined || list === null ? [] : [children];
      return items.map((item, i) => ev.call(callback, [item, i]));
    }),
    toArray: fn('toArray', ([children]) => (Array.isArray(prim(children)) ? children : [children])),
    count: fn('count', ([children]) => (Array.isArray(prim(children)) ? (prim(children) as Value[]).length : 1)),
    only: fn('only', ([children]) => children),
  }),
});

/** Next.js <Image>: a plain <img>, with `fill` turned into absolute positioning. */
function nextImage(props: Record<string, Value>): Record<string, Value> {
  const source = prim(props.src);
  const src = isRecord(source) ? source.src : props.src;
  const rest = omit(props, ['src', 'fill', 'priority', 'quality', 'placeholder', 'blurDataURL', 'loader', 'unoptimized', 'sizes', 'overrideSrc']);
  const style = isRecord(props.style) ? props.style : {};
  return truthy(props.fill)
    ? { ...omit(rest, ['width', 'height']), src, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', ...style } }
    : { ...rest, src };
}

const linkProps = ['prefetch', 'replace', 'scroll', 'shallow', 'passHref', 'legacyBehavior', 'locale'];

/** A next/font loader. Records the family so the canvas can load it from Google Fonts. */
function fontLoader(family: string) {
  return fn(family, ([options], ev) => {
    const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const variable = isRecord(options) ? toText(options.variable) || undefined : undefined;
    ev.fonts.set(`frame-font-${slug}`, { family, variable });
    if (variable) ev.fonts.set(`frame-font-${slug}-variable`, { family, variable });
    return {
      className: `frame-font-${slug}`,
      variable: variable ? `frame-font-${slug}-variable` : '',
      style: { fontFamily: `'${family}'` },
    };
  });
}

/** Motion components render as their element, without the animation props. */
const motionProps = [
  'initial', 'animate', 'exit', 'transition', 'variants', 'whileHover', 'whileTap', 'whileFocus',
  'whileDrag', 'whileInView', 'viewport', 'layout', 'layoutId', 'layoutScroll', 'drag', 'dragConstraints',
  'dragElastic', 'dragMomentum', 'dragSnapToOrigin', 'custom', 'inherit', 'onAnimationStart',
  'onAnimationComplete', 'onUpdate', 'transformTemplate',
];
const motion = component('motion', {
  kind: 'namespace',
  member: (tag) => element(`motion.${tag}`, tag, (props) => omit(props, motionProps)),
});

/** A Radix part, rendered by the role its name suggests. */
function radixPart(pkg: string, part: string): Value {
  const overlay = /dialog|popover|dropdown-menu|context-menu|hover-card|tooltip|select|menubar|toast|sheet|alert-dialog/.test(pkg);
  if (/^(Portal|Overlay|Viewport|Indicator|Arrow|ScrollUpButton|ScrollDownButton)$/.test(part)) return hidden(part);
  if (part === 'Content' || part.endsWith('Content')) return overlay || pkg.includes('navigation-menu') ? hidden(part) : element(part, 'div');
  if (part === 'Trigger' || part.endsWith('Trigger')) return element(part, 'button', (p) => omit(p, ['asChild']), true);
  if (part === 'Link') return element(part, 'a', (p) => omit(p, ['asChild', 'active']), true);
  if (part === 'Image') return element(part, 'img');
  if (part === 'Fallback' || part === 'Value' || part === 'Icon' || part === 'Thumb') return element(part, 'span');
  if (part === 'Title') return element(part, 'h2');
  if (part === 'Description') return element(part, 'p');
  if (part === 'Close' || part === 'Action' || part === 'Cancel') return element(part, 'button', (p) => omit(p, ['asChild']), true);
  if (pkg.includes('separator') || pkg.includes('progress') || pkg.includes('aspect-ratio') || pkg.includes('scroll-area'))
    return element(part, 'div', (p) => omit(p, ['decorative', 'orientation', 'ratio', 'value']));
  if (pkg.includes('label')) return element(part, 'label', (p) => omit(p, ['asChild']), true);
  if (pkg.includes('avatar') && part === 'Root') return element(part, 'span');
  if (pkg.includes('navigation-menu')) {
    if (part === 'Root') return element(part, 'nav', (p) => omit(p, ['delayDuration', 'value', 'defaultValue', 'onValueChange']));
    if (part === 'List') return element(part, 'ul');
    if (part === 'Item') return element(part, 'li', (p) => omit(p, ['value']));
  }
  if (/checkbox|switch|toggle|radio-group/.test(pkg) && (part === 'Root' || part === 'Item'))
    return element(part, part === 'Root' && pkg.includes('radio-group') ? 'div' : 'button', (p) => omit(p, ['checked', 'defaultChecked', 'onCheckedChange', 'pressed', 'value']));
  if (/tabs|accordion|collapsible/.test(pkg) && part !== 'Root')
    return element(part, part === 'Header' ? 'h3' : 'div', (p) => omit(p, ['value', 'forceMount']));
  if (overlay || part === 'Root' || part === 'Provider' || part === 'Group' || part === 'Sub') return transparent(part);
  return element(part, 'div', (p) => omit(p, ['asChild', 'value', 'orientation']), true);
}

function radix(pkg: string, imported: string): Value {
  if (imported === '*' || imported === 'default')
    return component(pkg, { kind: 'namespace', member: (part) => radixPart(pkg, part) });
  return radixPart(pkg, imported.replace(/^(Dialog|Popover|DropdownMenu|Tooltip|Select|Tabs|Accordion|NavigationMenu|Avatar|Label|Separator)?/, '') || 'Root');
}

/** class-variance-authority's cva. Returns a function from variant props to classes. */
function cva(base: Value, config: Value) {
  return fn('cva', ([props]) => {
    const options = isRecord(prim(config)) ? (prim(config) as Record<string, Value>) : {};
    const variants = isRecord(options.variants) ? options.variants : {};
    const defaults = isRecord(options.defaultVariants) ? options.defaultVariants : {};
    const given = isRecord(prim(props)) ? (prim(props) as Record<string, Value>) : {};
    const classes: Value[] = [base];
    const chosen: Record<string, Value> = {};
    for (const [name, choices] of Object.entries(variants)) {
      let value = prim(given[name]);
      if (value === undefined || value === null || value instanceof Unknown) value = prim(defaults[name]);
      if (typeof value === 'boolean') value = String(value);
      chosen[name] = value;
      if (isRecord(choices) && (typeof value === 'string' || typeof value === 'number')) classes.push(choices[String(value)]);
    }
    const compounds = Array.isArray(prim(options.compoundVariants)) ? (prim(options.compoundVariants) as Value[]) : [];
    for (const compound of compounds) {
      if (!isRecord(compound)) continue;
      const matches = Object.entries(compound).every(([name, wanted]) => {
        if (name === 'class' || name === 'className') return true;
        const value = prim(wanted);
        return Array.isArray(value) ? value.map(prim).includes(chosen[name] as never) : value === chosen[name];
      });
      if (matches) classes.push(compound.class, compound.className);
    }
    classes.push(given.class, given.className);
    return joinClasses(classes);
  });
}

const routerHooks = (ev: Evaluator): Record<string, Value> => ({
  useLocation: fn('useLocation', () => ({ pathname: ev.program.route, search: '', hash: '', state: null })),
  useNavigate: fn('useNavigate', () => noop),
  useParams: fn('useParams', () => ({})),
  useSearchParams: fn('useSearchParams', () => [{ get: fn('get', () => null) }, noop]),
  useMatch: fn('useMatch', () => null),
  useNavigation: fn('useNavigation', () => ({ state: 'idle' })),
  useLoaderData: fn('useLoaderData', () => UNKNOWN),
  useRouteError: fn('useRouteError', () => null),
  useOutletContext: fn('useOutletContext', () => UNKNOWN),
});

/** A React Router <Link> or <NavLink>, with function-valued className, style, and children resolved. */
function routerLink(nav: boolean) {
  return element(nav ? 'NavLink' : 'Link', 'a', (props, ev) => {
    const to = hrefOf(props.to);
    const active = nav && toText(to) === ev.program.route;
    const state = { isActive: active, isPending: false, isTransitioning: false };
    const resolve = (value: Value) =>
      value instanceof Closure || value instanceof Native ? ev.call(value, [state]) : value;
    return {
      ...omit(props, ['to', 'end', 'caseSensitive', 'replace', 'state', 'preventScrollReset', 'relative', 'reloadDocument', 'viewTransition', 'discover', 'prefetch']),
      href: to,
      className: resolve(props.className),
      style: resolve(props.style),
      children: resolve(props.children),
    };
  });
}

/**
 * The value of an import from a package, or undefined for packages Frame doesn't know.
 * `imported` is `default`, `*`, or a name.
 */
export function knownImport(spec: string, imported: string, ev: Evaluator): Value | undefined {
  const pick = (table: Record<string, Value>) =>
    imported === '*' || imported === 'default' ? (table.default ?? table) : (table[imported] ?? UNKNOWN);

  if (spec === 'react') {
    const table = react();
    return imported === '*' || imported === 'default' ? table : (table[imported] ?? UNKNOWN);
  }
  if (spec === 'react/jsx-runtime') return UNKNOWN;
  if (spec === 'react-dom' || spec === 'react-dom/client')
    return pick({ createPortal: fn('createPortal', () => undefined), flushSync: noop, createRoot: fn('createRoot', () => UNKNOWN) });

  if (spec === 'next/link')
    return element('Link', 'a', (props) => ({ ...omit(props, linkProps), href: hrefOf(props.href) }));
  if (spec === 'next/image' || spec === 'next/legacy/image') return element('Image', 'img', nextImage);
  if (spec === 'next/head' || spec === 'next/script') return hidden(spec === 'next/head' ? 'Head' : 'Script');
  if (spec === 'next/dynamic') return fn('dynamic', () => component('Dynamic', { kind: 'placeholder', name: 'Dynamic import' }));
  if (spec === 'next/font/google') return imported === 'default' || imported === '*' ? UNKNOWN : fontLoader(imported.replace(/_/g, ' '));
  if (spec === 'next/font/local') return fn('localFont', () => ({ className: '', variable: '', style: {} }));
  if (spec === 'next/navigation')
    return pick({
      usePathname: fn('usePathname', () => ev.program.route),
      useRouter: fn('useRouter', () => ({ push: noop, replace: noop, back: noop, refresh: noop, prefetch: noop })),
      useSearchParams: fn('useSearchParams', () => ({ get: fn('get', () => null), has: fn('has', () => false), toString: fn('toString', () => '') })),
      useParams: fn('useParams', () => ({})),
      useSelectedLayoutSegment: fn('useSelectedLayoutSegment', () => null),
      useSelectedLayoutSegments: fn('useSelectedLayoutSegments', () => []),
      redirect: noop,
      notFound: noop,
    });
  if (spec === 'next/router')
    return pick({ useRouter: fn('useRouter', () => ({ pathname: ev.program.route, asPath: ev.program.route, query: {}, push: noop, replace: noop, back: noop })) });

  if (spec === 'react-router-dom' || spec === 'react-router' || spec === 'react-router-dom/client') {
    const table: Record<string, Value> = {
      ...routerHooks(ev),
      Link: routerLink(false),
      NavLink: routerLink(true),
      Routes: component('Routes', { kind: 'routes' }),
      Route: component('Route', { kind: 'route' }),
      Outlet: component('Outlet', { kind: 'outlet' }),
      BrowserRouter: transparent('BrowserRouter'),
      HashRouter: transparent('HashRouter'),
      MemoryRouter: transparent('MemoryRouter'),
      Router: transparent('Router'),
      StaticRouter: transparent('StaticRouter'),
      RouterProvider: component('RouterProvider', { kind: 'placeholder', name: 'RouterProvider' }),
      Navigate: hidden('Navigate'),
      ScrollRestoration: hidden('ScrollRestoration'),
      Scripts: hidden('Scripts'),
      Meta: hidden('Meta'),
      Links: hidden('Links'),
      Form: element('Form', 'form', (props) => omit(props, ['method', 'action', 'navigate', 'fetcherKey', 'reloadDocument', 'replace', 'preventScrollReset'])),
      createBrowserRouter: fn('createBrowserRouter', () => UNKNOWN),
    };
    return imported === '*' ? table : (table[imported] ?? UNKNOWN);
  }

  if (spec === 'clsx' || spec === 'clsx/lite' || spec === 'classnames' || spec === 'classnames/dedupe')
    return fn('clsx', (args) => joinClasses(args));
  if (spec === 'tailwind-merge')
    return pick({
      twMerge: fn('twMerge', (args) => mergeClasses(joinClasses(args))),
      twJoin: fn('twJoin', (args) => joinClasses(args)),
      extendTailwindMerge: fn('extendTailwindMerge', () => fn('twMerge', (args) => mergeClasses(joinClasses(args)))),
    });
  if (spec === 'class-variance-authority' || spec === 'cva')
    return pick({
      cva: fn('cva', ([base, config]) => cva(base, config)),
      cx: fn('cx', (args) => joinClasses(args)),
      default: fn('cva', ([base, config]) => cva(base, config)),
    });

  if (spec === '@radix-ui/react-slot')
    return imported === 'Slottable' ? transparent('Slottable') : component('Slot', { kind: 'slot' });
  if (spec === 'radix-ui')
    return imported === 'Slot'
      ? component('Slot', { kind: 'namespace', member: (key) => (key === 'Slottable' ? transparent(key) : component('Slot', { kind: 'slot' })) })
      : component(imported, { kind: 'namespace', member: (part) => radixPart(imported.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(), part) });
  if (spec.startsWith('@radix-ui/react-') && !spec.endsWith('-icons')) return radix(spec.slice('@radix-ui/react-'.length), imported);

  if (spec === 'framer-motion' || spec === 'motion/react' || spec === 'motion/react-client' || spec === 'motion') {
    const motionValue = (value: Value) => value;
    const table: Record<string, Value> = {
      motion,
      m: motion,
      AnimatePresence: transparent('AnimatePresence'),
      LayoutGroup: transparent('LayoutGroup'),
      MotionConfig: transparent('MotionConfig'),
      LazyMotion: transparent('LazyMotion'),
      Reorder: component('Reorder', { kind: 'namespace', member: (key) => element(`Reorder.${key}`, key === 'Group' ? 'ul' : 'li', (props) => omit(props, [...motionProps, 'values', 'onReorder', 'axis', 'value', 'as'])) }),
      useScroll: fn('useScroll', () => ({ scrollX: 0, scrollY: 0, scrollXProgress: 0, scrollYProgress: 0 })),
      useTransform: fn('useTransform', ([, , output]) => (Array.isArray(prim(output)) ? (prim(output) as Value[])[0] : UNKNOWN)),
      useSpring: fn('useSpring', ([value]) => motionValue(value)),
      useMotionValue: fn('useMotionValue', ([value]) => motionValue(value)),
      useMotionTemplate: fn('useMotionTemplate', () => UNKNOWN),
      useInView: fn('useInView', () => true),
      useAnimation: fn('useAnimation', () => ({ start: noop, stop: noop, set: noop })),
      useAnimate: fn('useAnimate', () => [{ current: null }, noop]),
      useReducedMotion: fn('useReducedMotion', () => false),
      useMotionValueEvent: noop,
      animate: noop,
      stagger: fn('stagger', () => 0),
    };
    return imported === '*' ? table : (table[imported] ?? UNKNOWN);
  }

  if (spec === 'lucide-react' || spec === 'lucide-react/dynamic') {
    if (imported === '*' || imported === 'default')
      return component('lucide', { kind: 'namespace', member: (name) => component(name, { kind: 'icon', library: 'lucide', name }) });
    if (/^(createLucideIcon|icons|DynamicIcon)$/.test(imported)) return UNKNOWN;
    return component(imported, { kind: 'icon', library: 'lucide', name: imported.replace(/^Lucide/, '').replace(/Icon$/, '') || imported });
  }
  if (/^(react-icons\/|@heroicons\/react|@radix-ui\/react-icons|@tabler\/icons-react|@phosphor-icons\/react|react-feather|@iconify\/react)/.test(spec))
    return imported === '*' || imported === 'default'
      ? component('icons', { kind: 'namespace', member: (name) => component(name, { kind: 'icon', library: spec, name }) })
      : component(imported, { kind: 'icon', library: spec, name: imported });

  if (spec === 'next-themes')
    return pick({
      ThemeProvider: transparent('ThemeProvider'),
      useTheme: fn('useTheme', () => ({ theme: 'light', resolvedTheme: 'light', systemTheme: 'light', themes: ['light', 'dark'], setTheme: noop })),
    });
  if (spec === '@tanstack/react-query')
    return pick({
      QueryClient: new Native('QueryClient', () => ({}), { kind: 'constructor' }),
      QueryClientProvider: transparent('QueryClientProvider'),
      useQuery: fn('useQuery', () => ({ data: UNKNOWN, isLoading: false, isPending: false, isError: false, isSuccess: true, error: null, status: 'success' })),
      useSuspenseQuery: fn('useSuspenseQuery', () => ({ data: UNKNOWN })),
      useMutation: fn('useMutation', () => ({ mutate: noop, mutateAsync: noop, isPending: false })),
      useQueryClient: fn('useQueryClient', () => ({})),
    });
  if (spec === 'sonner' || spec === 'react-hot-toast')
    return pick({ Toaster: hidden('Toaster'), toast: fn('toast', () => undefined), default: fn('toast', () => undefined) });
  if (spec.startsWith('@vercel/analytics') || spec.startsWith('@vercel/speed-insights'))
    return hidden(imported === 'default' ? 'Analytics' : imported);
  if (spec === 'react-helmet' || spec === 'react-helmet-async')
    return pick({ Helmet: hidden('Helmet'), HelmetProvider: transparent('HelmetProvider') });
  if (spec === 'react-i18next' || spec === 'next-intl' || spec === 'next-i18next') {
    const translate = fn('t', ([key]) => (key instanceof Lit ? key : toText(key)));
    return pick({
      useTranslation: fn('useTranslation', () => ({ t: translate, i18n: { language: 'en' } })),
      useTranslations: fn('useTranslations', () => translate),
      Trans: transparent('Trans'),
      NextIntlClientProvider: transparent('NextIntlClientProvider'),
    });
  }
  return undefined;
}

