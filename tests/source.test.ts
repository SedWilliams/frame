/*
 * Unit tests for JSX import and export in src/source.ts and the tree operations in
 * src/model.ts.
 *
 * Most round-trip tests import a snippet, edit the tree, export, and then check two
 * things: the result still parses, and the code Frame should leave alone is still there.
 */

import { describe, expect, it } from 'vitest';
import { parse } from '@babel/parser';
import { exportSource, importSource } from '../src/source';
import { cloneNode, createNode, insertNode, moveNode, removeNode, updateNode } from '../src/model';
import { makeDemo } from '../src/demo';

// A component with a hook, a comment, a handler, a style spread, a custom component,
// and code after the export. Export has to keep all of it.
const source = `import { useState } from 'react';
const base = { padding: 12 };
export default function Card({ title }: { title: string }) {
  const [count, setCount] = useState(0);
  // Keep this comment and the event handler.
  return <main className="card" style={{ ...base, color: 'red' }}><h1 onClick={() => setCount(count + 1)}>Hello world</h1><p>{title}</p><Button onClick={() => setCount(0)} /></main>;
}
export const untouched = 42;`;

/** Fails the test if `code` isn't parseable TSX. */
function valid(code: string) {
  expect(() => parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
}

describe('JSX round trip', () => {
  it('preserves all code outside the edited JSX root and preserves dynamic behavior', () => {
    const project = importSource(source, 'Card.tsx');
    const heading = project.root.children[0];
    project.root = updateNode(project.root, heading.id, {
      text: 'Changed {text} & "quotes"',
      style: { fontSize: 42 },
    });
    const result = exportSource(project);
    expect(result.split('return ')[0]).toBe(source.split('return ')[0]);
    expect(result.endsWith(source.slice(source.indexOf(';\n}')))).toBe(true);
    expect(result).toContain('onClick={() => setCount(count + 1)}');
    expect(result).toContain('{title}');
    expect(result).toContain('<Button onClick={() => setCount(0)} />');
    expect(result).toContain('fontSize: 42');
    valid(result);
    const reopened = importSource(result);
    expect(reopened.root.children[0].text).toBe('Changed {text} & "quotes"');
    expect(reopened.root.children[0].opaque).not.toBe(true);
  });

  it('does not lose root attributes due to overlapping JSX source positions', () => {
    const result = exportSource(importSource(source));
    expect(result).toContain('className="card"');
    expect(result).toContain('...base');
    expect(result).toContain("color: 'red'");
    valid(result);
  });

  it('overrides style variables without dropping their values', () => {
    const project = importSource(
      'export default () => <div style={base} onClick={onClick}>Hi</div>',
    );
    project.root.style = { color: '#112233' };
    const code = exportSource(project);
    expect(code).toContain('...base');
    expect(code).toContain('color: "#112233"');
    expect(code).toContain('onClick={onClick}');
    valid(code);
  });

  it('places visual edits after style spreads', () => {
    const project = importSource('export default () => <div style={{color: "red", ...base}} />');
    project.root.style.color = 'blue';
    const code = exportSource(project);
    expect(code.indexOf('...base')).toBeLessThan(code.indexOf('color: "blue"'));
    valid(code);
  });

  it('prefers the named default export over a helper component', () => {
    const project = importSource(
      'function Helper() { return <span>Helper</span>; } const Page = () => <main>Page</main>; export default Page;',
    );
    expect(project.root.tag).toBe('main');
    expect(project.root.text).toBe('Page');
  });

  it('supports fragments and leaves dynamic expressions intact', () => {
    const project = importSource(
      'export default () => <><h1>Hello</h1>{items.map(item => <Card key={item.id} />)}</>;',
    );
    expect(project.root.tag).toBe('fragment');
    expect(project.root.children[1].opaque).toBe(true);
    const code = exportSource(project);
    expect(code).toContain('items.map(item => <Card key={item.id} />)');
    valid(code);
  });

  it('retains plain text children mixed with elements', () => {
    const project = importSource('export default () => <div>Hello <strong>world</strong>!</div>');
    const code = exportSource(project);
    expect(code).toContain('Hello <strong>world</strong>!');
    valid(code);
  });

  it('wraps a styled mixed-text child without losing its text', () => {
    const project = importSource('export default () => <div>Hello <strong>world</strong></div>');
    const text = project.root.children[0];
    project.root = updateNode(project.root, text.id, { style: { color: 'blue' } });
    const code = exportSource(project);
    valid(code);
    expect(code).toContain('<span style={{');
    expect(code).toContain('color: "blue"');
    expect(code).toContain('{"Hello "}');
    expect(code).toContain('<strong>world</strong>');
  });

  it('handles literal-expression text after more than one save', () => {
    let project = importSource('export default () => <h1>{"Hello"}</h1>');
    project.root.text = 'Second';
    project = importSource(exportSource(project));
    expect(project.root.text).toBe('Second');
    project.root.text = 'Third';
    expect(importSource(exportSource(project)).root.text).toBe('Third');
  });

  it('exports all inserted elements as valid JSX including void elements', () => {
    const project = importSource('export default () => <main />');
    for (const type of ['heading', 'text', 'button', 'frame', 'image', 'divider'] as const) {
      project.root = insertNode(project.root, project.root.id, createNode(type));
    }
    const code = exportSource(project);
    valid(code);
    expect(importSource(code).root.children).toHaveLength(6);
  });

  it('exports hidden elements without deleting their original content', () => {
    const project = importSource('export default () => <p style={{display: "flex"}}>Hello</p>');
    project.root.hidden = true;
    expect(exportSource(project)).toContain('display: "none"');
    project.root.hidden = false;
    expect(exportSource(project)).toContain('display: "flex"');
  });

  it('round-trips the full demo', () => {
    const project = makeDemo();
    const code = exportSource(project);
    valid(code);
    expect(importSource(code).root.children).toHaveLength(3);
    expect(code).toContain('src="/images/interior.jpg"');
  });

  it('rejects invalid files and opaque roots with a useful error', () => {
    expect(() => importSource('export const hi = 1')).toThrow('No JSX');
    expect(() => importSource('export default () => <App />')).toThrow('Open the file');
    expect(() => importSource('x'.repeat(1_000_001))).toThrow('too large');
  });
});

describe('tree operations', () => {
  // main > [section > [h1 A, p B], aside]
  const tree = () =>
    importSource('export default () => <main><section><h1>A</h1><p>B</p></section><aside /></main>')
      .root;
  it('reorders, reparents, and prevents cycles', () => {
    let root = tree();
    const [section, aside] = root.children;
    const [a, b] = section.children;
    root = moveNode(root, b.id, a.id);
    expect(root.children[0].children.map((n) => n.text)).toEqual(['B', 'A']);
    root = moveNode(root, a.id, aside.id, true);
    expect(root.children[1].children[0].text).toBe('A');
    expect(moveNode(root, aside.id, a.id, true)).toBe(root);
    expect(moveNode(root, root.id, aside.id)).toBe(root);
  });
  it('does not insert children into text or void nodes', () => {
    const root = tree();
    const text = root.children[0].children[0];
    expect(moveNode(root, root.children[1].id, text.id, true)).toBe(root);
    const image = createNode('image');
    const withImage = insertNode(root, root.id, image);
    expect(moveNode(withImage, root.children[1].id, image.id, true)).toBe(withImage);
  });
  it('duplicates with distinct IDs but preserves source origins', () => {
    const root = tree();
    const copy = cloneNode(root.children[0]);
    expect(copy.id).not.toBe(root.children[0].id);
    expect(copy.children[0].id).not.toBe(root.children[0].children[0].id);
    expect(copy.origin).toBe(root.children[0].origin);
  });
  it('blocks moving a locked node and removes nested nodes immutably', () => {
    const root = tree();
    const locked = updateNode(root, root.children[0].id, { locked: true });
    expect(moveNode(locked, locked.children[0].id, locked.children[1].id)).toBe(locked);
    expect(removeNode(root, root.children[0].children[0].id).children[0].children).toHaveLength(1);
    expect(root.children[0].children).toHaveLength(2);
  });
});
