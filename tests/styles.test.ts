/*
 * Unit tests for the Tailwind class writer and merger in src/core/tailwind.ts,
 * and the stylesheet helpers in src/core/cssfile.ts.
 */

import { describe, expect, it } from 'vitest';
import { applyTailwind, classFor, mergeClasses } from '../src/core/tailwind';
import {
  cssVariables,
  fixViewportHeight,
  forceColorScheme,
  inlineImports,
  removeVariable,
  scopeModule,
  setVariable,
  tailwindSource,
} from '../src/core/cssfile';

describe('applyTailwind', () => {
  it('replaces the class that sets a property in place', () => {
    expect(applyTailwind('flex p-4 text-sm', { padding: 24 })).toBe('flex p-6 text-sm');
    expect(applyTailwind('flex p-4 text-sm', { fontSize: 18 })).toBe('flex p-4 text-lg');
    expect(applyTailwind('w-full', { width: 320 })).toBe('w-80');
    expect(applyTailwind('w-full', { width: 333 })).toBe('w-[333px]');
  });

  it('keeps broader classes when setting one side, and removes narrower ones when setting all', () => {
    expect(applyTailwind('p-4', { paddingTop: 32 })).toBe('p-4 pt-8');
    expect(applyTailwind('px-4 pt-2 pb-2', { padding: 8 })).toBe('p-2');
    expect(applyTailwind('rounded-tl-lg rounded-md', { borderRadius: 8 })).toBe('rounded-lg');
  });

  it('leaves variants alone unless writing that variant', () => {
    expect(applyTailwind('p-4 md:p-8 hover:bg-red-500', { padding: 8, backgroundColor: '#ff0000' })).toBe('p-2 md:p-8 hover:bg-red-500 bg-[#ff0000]');
    expect(applyTailwind('p-4 md:p-8', { padding: 40 }, 'md:')).toBe('p-4 md:p-10');
  });

  it('writes colors, keywords, and arbitrary values Tailwind can read', () => {
    expect(applyTailwind('text-sm text-gray-500', { color: '#111827' })).toBe('text-sm text-[#111827]');
    expect(applyTailwind('', { color: 'var(--color-primary)' })).toBe('text-primary');
    expect(applyTailwind('', { boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)' })).toBe('shadow-[0_4px_12px_rgba(0,_0,_0,_0.15)]');
    expect(applyTailwind('flex flex-col', { flexDirection: 'row', justifyContent: 'space-between' })).toBe('flex flex-row justify-between');
    expect(applyTailwind('block', { display: 'none' })).toBe('hidden');
    expect(applyTailwind('font-sans', { fontFamily: "'Playfair Display', serif" })).toBe("font-['Playfair_Display',_serif]");
  });

  it('removes a property with null', () => {
    expect(applyTailwind('flex gap-4 items-center', { gap: null })).toBe('flex items-center');
    expect(classFor('flex gap-4 md:gap-8', 'gap')).toBe('gap-4');
  });
});

describe('mergeClasses', () => {
  it('lets later classes win like tailwind-merge', () => {
    expect(mergeClasses('px-2 py-1 p-3')).toBe('p-3');
    expect(mergeClasses('p-3 px-2')).toBe('p-3 px-2');
    expect(mergeClasses('text-sm text-red-500 text-lg')).toBe('text-red-500 text-lg');
    expect(mergeClasses('hover:bg-red-500 bg-blue-500 hover:bg-green-500')).toBe('bg-blue-500 hover:bg-green-500');
    expect(mergeClasses('flex block inline-flex')).toBe('inline-flex');
  });
});

describe('stylesheets', () => {
  it('scopes CSS modules and keeps :global', () => {
    expect(scopeModule('.card .title, :global(.dark) .card { color: red }', 'src/Card.module.css')).toBe(
      '.Card_m__card .Card_m__title, .dark .Card_m__card { color: red }',
    );
  });

  it('inlines local imports and hoists remote ones', () => {
    const files: Record<string, string> = { 'src/theme.css': ':root { --a: 1; }' };
    const out = inlineImports('@import "./theme.css";\n@import url("https://fonts.googleapis.com/css2?family=Inter");\nbody {}', 'src/index.css', (p) => files[p]);
    expect(out).toBe('@import url("https://fonts.googleapis.com/css2?family=Inter");\n:root { --a: 1; }\n\nbody {}');
  });

  it('turns Tailwind 3 directives into one import and drops what the browser build cannot load', () => {
    expect(tailwindSource('@tailwind base;\n@tailwind components;\n@tailwind utilities;\n@plugin "x";')).toBe('@import "tailwindcss";\n\n\n');
  });

  it('forces a color scheme and fixes viewport units', () => {
    expect(forceColorScheme('@media (prefers-color-scheme: dark) { a {} }', true)).toBe('@media (min-width: 0px) { a {} }');
    expect(forceColorScheme('@media (prefers-color-scheme: dark) { a {} }', false)).toBe('@media (max-width: -1px) { a {} }');
    expect(fixViewportHeight('.h { min-height: 100vh; height: 50dvh }', 800)).toBe('.h { min-height: 800px; height: 400px }');
  });

  it('reads, edits, adds, and removes custom properties', () => {
    const css = ':root {\n  --brand: #e86b47;\n  --radius: 8px;\n}\n.dark {\n  --brand: #ff8a65;\n}\n@theme inline {\n  --color-brand: var(--brand);\n}\n';
    const vars = cssVariables(css, 'a.css');
    expect(vars.map((v) => [v.name, v.value, v.mode])).toEqual([
      ['--brand', '#e86b47', 'light'],
      ['--radius', '8px', 'light'],
      ['--brand', '#ff8a65', 'dark'],
      ['--color-brand', 'var(--brand)', 'theme'],
    ]);
    const edited = setVariable(css, 'a.css', '--brand', '#000000', 'dark');
    expect(edited).toContain('--brand: #000000;\n}\n@theme');
    expect(setVariable(css, 'a.css', '--gap', '4px', 'light')).toContain(':root {\n  --gap: 4px;\n  --brand');
    expect(removeVariable(css, 'a.css', '--radius', 'light')).toBe(css.replace('  --radius: 8px;\n', ''));
  });
});
