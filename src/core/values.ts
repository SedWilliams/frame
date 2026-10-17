/*
 * Values the evaluator works with, and the scopes that hold them.
 *
 * Kept apart from the evaluator so the table of known packages can build values
 * without an import cycle.
 */

import type * as t from '@babel/types';
import type { EditorNode } from './model';
import type { Evaluator } from './evaluate';
import type { KnownComponent } from './known';

/** Where an editable string came from. */
export type TextSource =
  | { kind: 'literal'; file: string; start: number }
  | { kind: 'attr'; file: string; nodeId: string; attr: string }
  | { kind: 'text'; file: string; nodeId: string };

/** A string with its origin, so edits can be written back. */
export class Lit {
  constructor(
    readonly value: string,
    readonly source: TextSource,
  ) {}
  toString() {
    return this.value;
  }
}

/** A function from project source, closed over the scope it was defined in. */
export class Closure {
  constructor(
    readonly fn: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration | t.ObjectMethod,
    readonly scope: Scope,
    readonly name?: string,
  ) {}
}

/** A built-in function. With `component` set it also works as a JSX tag. */
export class Native {
  constructor(
    readonly name: string,
    readonly call: (args: Value[], ev: Evaluator, self?: Value) => Value,
    readonly component?: KnownComponent,
  ) {}
}

/** JSX waiting to be rendered with the scope it was written in. */
export class JSXValue {
  constructor(
    readonly node: EditorNode,
    readonly scope: Scope,
  ) {}
}

/** Already-rendered output, such as a page passed to its layout as `children`. */
export class Rendered {
  constructor(readonly nodes: unknown[]) {}
}

/** A value Frame can't know. `hint` names it for placeholders. */
export class Unknown {
  constructor(readonly hint?: string) {}
}
export const UNKNOWN = new Unknown();

export type Value =
  | undefined
  | null
  | boolean
  | number
  | string
  | Lit
  | Closure
  | Native
  | JSXValue
  | Rendered
  | Unknown
  | Value[]
  | { [key: string]: Value };

export const isRecord = (value: Value): value is { [key: string]: Value } =>
  value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

/** The plain value behind a Lit. */
export const prim = (value: Value): Value => (value instanceof Lit ? value.value : value);

/** Truthiness, or undefined when the value is unknown. */
export function truthy(value: Value): boolean | undefined {
  if (value instanceof Unknown) return undefined;
  return !!prim(value);
}

/** String conversion for concatenation and templates. Unknown parts become empty. */
export function toText(value: Value): string {
  const v = prim(value);
  if (v instanceof Unknown) return '';
  if (Array.isArray(v)) return v.map(toText).join(',');
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'object') return '';
  return String(v);
}

interface Binding {
  value?: Value;
  thunk?: () => Value;
  busy?: boolean;
}

export class Scope {
  private vars = new Map<string, Binding>();
  constructor(
    readonly parent: Scope | undefined,
    readonly file: string,
  ) {}
  define(name: string, value: Value) {
    this.vars.set(name, { value });
  }
  defineLazy(name: string, thunk: () => Value) {
    this.vars.set(name, { thunk });
  }
  private find(name: string): Binding | undefined {
    for (let scope: Scope | undefined = this; scope; scope = scope.parent) {
      const binding = scope.vars.get(name);
      if (binding) return binding;
    }
  }
  has(name: string) {
    return !!this.find(name);
  }
  get(name: string): Value {
    const binding = this.find(name);
    if (!binding) return UNKNOWN;
    if (binding.thunk) {
      // A binding that needs itself while being computed is a cycle. Unknown breaks it.
      if (binding.busy) return UNKNOWN;
      binding.busy = true;
      try {
        binding.value = binding.thunk();
      } finally {
        binding.busy = false;
        binding.thunk = undefined;
      }
    }
    return binding.value;
  }
  set(name: string, value: Value) {
    const binding = this.find(name);
    if (binding) {
      binding.thunk = undefined;
      binding.value = value;
    }
  }
}

