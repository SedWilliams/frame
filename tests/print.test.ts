/*
 * Unit tests for the minimal-diff printer in src/core/print.ts.
 *
 * Each test parses a snippet, edits its tree the way the editor would, prints it,
 * and checks two things: the output still parses, and only the edited span of the
 * file changed. `changed` reports the part of the output that differs from the
 * input, so most assertions read as before-and-after pairs.
 */

import { describe, expect, it } from 'vitest';
import { parse } from '@babel/parser';
import { parseFile, type FileInfo } from '../src/core/parse';
import { printFile } from '../src/core/print';
import {
  createNode,
  findNode,
  insertNodes,
  mapNode,
  moveNodes,
  removeNodes,
  unwrapNode,
  updateNode,
  wrapNodes,
  uid,
  type EditorNode,
} from '../src/core/model';

/** Fails the test if `code` isn't parseable TSX. */
function valid(code: string) {
  expect(() => parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
  return code;
}

/** The largest root, which is the component's returned JSX in these snippets. */
function mainRoot(info: FileInfo): [number, EditorNode] {
  return [...info.roots.entries()].sort((a, b) => countAll(b[1]) - countAll(a[1]))[0];
}
const countAll = (node: EditorNode): number => 1 + node.children.reduce((n, c) => n + countAll(c), 0);

/** Prints `source` after applying `change` to its main root. */
function edit(source: string, change: (root: EditorNode) => EditorNode, extra: Partial<{ literals: Record<number, string>; addedImports: string[] }> = {}) {
  const info = parseFile('Page.tsx', source);
  const [offset, root] = mainRoot(info);
  return valid(printFile(info, { path: 'Page.tsx', base: source, roots: { [offset]: change(root) }, literals: extra.literals ?? {}, addedImports: extra.addedImports }));
}

/** The differing middle of two strings: [removed, added]. */
function changed(before: string, after: string): [string, string] {
  let start = 0;
  while (start < before.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return [before.slice(start, before.length - end), after.slice(start, after.length - end)];
}

/** The first node matching a predicate, depth first. */
function find(root: EditorNode, test: (node: EditorNode) => boolean): EditorNode {
  const stack = [root];
  while (stack.length) {
    const node = stack.shift()!;
    if (test(node)) return node;
    stack.unshift(...node.children);
  }
  throw new Error('node not found');
}

const card = `import { useState } from 'react';
const base = { padding: 12 };

export default function Card({ title }: { title: string }) {
  const [count, setCount] = useState(0);
  // Keep this comment and the event handler.
  return (
    <main className="card" style={{ ...base, color: 'red' }}>
      <h1 onClick={() => setCount(count + 1)}>Hello world</h1>
      {/* a comment child */}
      <p>{title}</p>
      <Button onClick={() => setCount(0)} />
    </main>
  );
}
export const untouched = 42;
`;

describe('printing without edits', () => {
  it('returns the source byte for byte', () => {
    const info = parseFile('Card.tsx', card);
    expect(printFile(info, { path: 'Card.tsx', base: card, roots: {}, literals: {} })).toBe(card);
    const [offset, root] = mainRoot(info);
    // A copy of the tree with the same content prints the same too.
    expect(printFile(info, { path: 'Card.tsx', base: card, roots: { [offset]: { ...root, children: [...root.children] } }, literals: {} })).toBe(card);
  });
});

describe('style edits', () => {
  it('changes one value in place and keeps the quote style', () => {
    const out = edit(card, (root) => updateNode(root, root.id, { style: { ...root.style } }));
    expect(out).toBe(card);
    const recolored = edit('const A = () => <div style={{ padding: 12, color: "red" }} />;', (root) => updateNode(root, root.id, { style: { padding: 12, color: '#fff' } }));
    expect(changed('const A = () => <div style={{ padding: 12, color: "red" }} />;', recolored)).toEqual(['red', '#fff']);
  });

  it('overrides a value after a spread without dropping the spread', () => {
    const out = edit(card, (root) => updateNode(root, root.id, { style: { color: 'blue' } }));
    expect(changed(card, out)).toEqual(['red', 'blue']);
    expect(out).toContain('style={{ ...base, color: \'blue\' }}');
  });

  it('appends and removes keys with matching separators', () => {
    const src = 'const A = () => <div style={{ padding: 12, color: "red" }} />;';
    const added = edit(src, (root) => updateNode(root, root.id, { style: { padding: 12, color: 'red', margin: 4 } }));
    expect(changed(src, added)).toEqual(['', ', margin: "4"'.replace('"4"', '4')]);
    const removed = edit(src, (root) => updateNode(root, root.id, { style: { color: 'red' } }));
    expect(removed).toContain('style={{ color: "red" }}');
    const emptied = edit(src, (root) => updateNode(root, root.id, { style: {} }));
    expect(emptied).toBe('const A = () => <div />;');
  });

  it('adds a key to a multi-line object on its own line', () => {
    const src = `const A = () => (
  <div
    style={{
      padding: 12,
      color: 'red',
    }}
  />
);`;
    const out = edit(src, (root) => updateNode(root, root.id, { style: { padding: 12, color: 'red', gap: 8 } }));
    expect(out).toContain(`      color: 'red',\n      gap: 8,\n    }}`);
  });

  it('adds a style attribute to an element that has none', () => {
    const src = 'const A = () => <h1 className="title">Hi</h1>;';
    const out = edit(src, (root) => updateNode(root, root.id, { style: { fontSize: 42 } }));
    expect(changed(src, out)).toEqual(['', " style={{ fontSize: 42 }}"]);
  });

  it('wraps a style variable instead of replacing it', () => {
    const src = 'const A = () => <div style={base} onClick={go}>Hi</div>;';
    const out = edit(src, (root) => updateNode(root, root.id, { style: { color: '#112233' } }));
    expect(out).toContain('style={{ ...base, color: "#112233" }}');
    expect(out).toContain('onClick={go}');
  });

  it('prints hidden layers as display: none and restores them', () => {
    const src = 'const A = () => <p style={{ display: "flex" }}>Hello</p>;';
    const hidden = edit(src, (root) => updateNode(root, root.id, { hidden: true }));
    expect(hidden).toContain('display: "none"');
    expect(edit(src, (root) => updateNode(root, root.id, { hidden: false }))).toBe(src);
  });
});

describe('text and attribute edits', () => {
  it('replaces text and keeps the line breaks around it', () => {
    const src = `const A = () => (
  <h1>
    Good spaces.
  </h1>
);`;
    const out = edit(src, (root) => updateNode(root, root.id, { text: 'Better living.' }));
    expect(changed(src, out)).toEqual(['Good spaces', 'Better living']);
  });

  it('escapes text JSX would misread', () => {
    const src = 'const A = () => <p>Hi</p>;';
    const out = edit(src, (root) => updateNode(root, root.id, { text: 'Use {braces} & <tags>' }));
    expect(out).toContain(`<p>{"Use {braces} & <tags>"}</p>`);
  });

  it('changes, adds, and removes attributes in place', () => {
    const src = 'const A = () => <a className="a" href="/x" target="_blank">Go</a>;';
    expect(changed(src, edit(src, (root) => updateNode(root, root.id, { attrs: { ...root.attrs, className: 'b' } })))).toEqual(['a', 'b']);
    expect(edit(src, (root) => updateNode(root, root.id, { attrs: { className: 'a', href: '/x' } }))).toBe('const A = () => <a className="a" href="/x">Go</a>;');
    expect(edit(src, (root) => updateNode(root, root.id, { attrs: { ...root.attrs, id: 'cta' } }))).toBe('const A = () => <a className="a" href="/x" target="_blank" id="cta">Go</a>;');
  });

  it('renames layers through data-layer and tags through both ends', () => {
    const src = 'const A = () => <h2 className="t">Hi</h2>;';
    expect(edit(src, (root) => updateNode(root, root.id, { name: 'Title' }))).toBe('const A = () => <h2 className="t" data-layer="Title">Hi</h2>;');
    expect(edit(src, (root) => updateNode(root, root.id, { tag: 'h3' }))).toBe('const A = () => <h3 className="t">Hi</h3>;');
  });

  it('wraps a styled run of mixed text in a span', () => {
    const src = 'const A = () => <div>Hello <strong>world</strong></div>;';
    const out = edit(src, (root) => mapNode(root, root.children[0].id, (n) => ({ ...n, style: { color: 'blue' } })));
    expect(out).toContain('<span style={{ color: "blue" }}>Hello </span><strong>world</strong>');
  });
});

describe('structure edits', () => {
  it('reorders children and keeps comments and handlers', () => {
    const out = edit(card, (root) => {
      const [h1, , p] = root.children;
      return moveNodes(root, [p.id], root.id, root.children.indexOf(h1));
    });
    expect(out.indexOf('<p>{title}</p>')).toBeLessThan(out.indexOf('<h1 onClick'));
    expect(out).toContain('{/* a comment child */}');
    expect(out).toContain('onClick={() => setCount(count + 1)}');
    expect(out.split('return')[0]).toBe(card.split('return')[0]);
    expect(out.endsWith('export const untouched = 42;\n')).toBe(true);
  });

  it('inserts a new element with the indentation of its siblings', () => {
    const out = edit(card, (root) => insertNodes(root, root.id, 1, [{ ...createNode('heading'), text: 'New' }]));
    expect(out).toContain(`</h1>\n      <h2 style={{ fontSize: 36, fontWeight: 600 }}>New</h2>\n      {/* a comment child */}`);
  });

  it('deletes a child with its line', () => {
    const out = edit(card, (root) => removeNodes(root, new Set([root.children[2].id])));
    expect(out).not.toContain('<p>{title}</p>');
    expect(out).toContain('{/* a comment child */}\n      <Button');
  });

  it('groups siblings in a new frame and ungroups them again', () => {
    const src = `const A = () => (
  <main>
    <h1>One</h1>
    <p>Two</p>
  </main>
);`;
    const wrapper = { id: uid(), kind: 'element' as const, tag: 'div', attrs: {}, style: { display: 'flex' }, children: [] };
    let grouped!: EditorNode;
    const out = edit(src, (root) => (grouped = wrapNodes(root, root.children.map((c) => c.id), wrapper)));
    expect(out).toBe(`const A = () => (
  <main>
    <div style={{ display: "flex" }}>
      <h1>One</h1>
      <p>Two</p>
    </div>
  </main>
);`);
    const back = edit(src, () => unwrapNode(grouped, wrapper.id));
    expect(back).toBe(src);
  });

  it('gives a self-closing element its first child', () => {
    const src = 'const A = () => <section className="s" />;';
    const out = edit(src, (root) => insertNodes(root, root.id, 0, [{ ...createNode('text') }]));
    expect(out).toBe(`const A = () => <section className="s">\n  <p>Text</p>\n</section>;`);
  });

  it('keeps a moved multi-line subtree indented for its new place', () => {
    const src = `const A = () => (
  <main>
    <section>
      <div
        className="x"
      >
        Hi
      </div>
    </section>
    <footer />
  </main>
);`;
    const out = edit(src, (root) => {
      const div = find(root, (n) => n.tag === 'div');
      return moveNodes(root, [div.id], root.id, 2);
    });
    expect(out).toContain(`    <footer />\n    <div\n      className="x"\n    >\n      Hi\n    </div>\n  </main>`);
  });
});

describe('logic stays as written', () => {
  it('edits JSX inside a .map without touching the callback', () => {
    const src = 'const A = () => <ul>{items.map((item) => <li key={item.id} className="a">{item.title}</li>)}</ul>;';
    const out = edit(src, (root) => {
      const li = find(root, (n) => n.tag === 'li');
      return updateNode(root, li.id, { attrs: { className: 'b' } });
    });
    expect(changed(src, out)).toEqual(['a', 'b']);
  });

  it('edits data literals the text came from', () => {
    const src = "const items = [{ title: 'Fast' }];\nconst A = () => <ul>{items.map((i) => <li>{i.title}</li>)}</ul>;";
    const offset = src.indexOf("'Fast'");
    const out = edit(src, (root) => root, { literals: { [offset]: "Quick 'n easy" } });
    expect(changed(src, out)).toEqual(["Fast", "Quick \\'n easy"]);
  });

  it('edits a JSX root nested in an attribute of another', () => {
    const src = 'const A = () => <Card icon={<Star size={4} className="a" />} title="x" />;';
    const info = parseFile('Page.tsx', src);
    const starOffset = src.indexOf('<Star');
    const star = info.roots.get(starOffset)!;
    const out = printFile(info, { path: 'Page.tsx', base: src, roots: { [starOffset]: updateNode(star, star.id, { attrs: { className: 'b' } }) }, literals: {} });
    expect(changed(src, out)).toEqual(['a', 'b']);
  });

  it('keeps hooks, handlers, children expressions, and code after the export', () => {
    const out = edit(card, (root) => updateNode(root, root.children[0].id, { text: 'Changed {text} & "quotes"', style: { fontSize: 42 } }));
    expect(out).toContain('onClick={() => setCount(count + 1)}');
    expect(out).toContain('{title}');
    expect(out).toContain('<Button onClick={() => setCount(0)} />');
    expect(out).toContain('fontSize: 42');
    expect(out).toContain('export const untouched = 42;');
    const reopened = parseFile('Card.tsx', out);
    const [, root] = mainRoot(reopened);
    expect(root.children[0].text).toBe('Changed {text} & "quotes"');
  });

  it('adds imports after the last import', () => {
    const out = edit(card, (root) => root, { addedImports: ["import { Badge } from './Badge';"] });
    expect(out.startsWith("import { useState } from 'react';\nimport { Badge } from './Badge';\nconst base")).toBe(true);
  });
});

describe('round trips', () => {
  it('reads its own output back as the same tree', () => {
    let source = card;
    for (const text of ['One', 'Two', 'Three']) {
      source = edit(source, (root) => updateNode(root, root.children[0].id, { text }));
      const [, root] = mainRoot(parseFile('Card.tsx', source));
      expect(root.children[0].text).toBe(text);
    }
    expect(findNode).toBeDefined();
  });
});
