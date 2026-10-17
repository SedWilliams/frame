/*
 * Static evaluator.
 *
 * Frame never runs project code. To draw a page it evaluates the parts of the
 * source that decide what renders: props and their defaults, module constants,
 * `.map` over literal arrays, conditionals, template strings, class helpers such
 * as `cn()` and `cva()`, and the initial values of hooks like useState. Anything
 * it can't know, such as fetched data, a browser API, or a function from an
 * unknown package, evaluates to UNKNOWN, and the renderer draws a placeholder.
 *
 * The rules lean toward showing more of the page. An `if` with an unknown test
 * skips an early return, and an unknown `cond && <X />` shows the element.
 *
 * Strings that come straight from a literal are wrapped in Lit, which remembers
 * where they came from so text drawn from data can be edited in place.
 */

import * as t from '@babel/types';
import type { EditorNode } from './model';
import { propertyKey, type FileInfo } from './parse';
import { knownImport } from './known';
import {
  Closure,
  isRecord,
  JSXValue,
  Lit,
  Native,
  prim,
  Rendered,
  Scope,
  toText,
  truthy,
  Unknown,
  UNKNOWN,
  type Value,
} from './values';

export * from './values';

export type Framework = 'next-app' | 'next-pages' | 'vite' | 'react-router' | 'unknown';

/** What the evaluator needs from the workspace. */
export interface Program {
  info(path: string): FileInfo | undefined;
  /** An edited string literal, if there is one at this offset. */
  literal(path: string, start: number): string | undefined;
  /** The current tree node for a JSX origin, edits included. */
  node(path: string, origin: number): EditorNode | undefined;
  /** The project file an import points to. */
  resolve(from: string, spec: string): string | undefined;
  /** The value of a non-code import, such as a CSS module's class map or an image's URL. */
  assetImport(path: string, imported: string, local: string): Value | undefined;
  /** A URL the canvas can load for a path in the page, or undefined to drop it. */
  publicUrl(url: string): string | undefined;
  route: string;
  framework: Framework;
}

/** Thrown when evaluation runs past its step budget, such as in an endless loop. */
export class BudgetError extends Error {}

/** Signals a `return` while executing statements. */
interface Completion {
  returned: boolean;
  broke?: boolean;
  value: Value;
}

export class Evaluator {
  steps = 0;
  depth = 0;
  /** Fonts from next/font, by the class name the page uses for them. */
  readonly fonts = new Map<string, { family: string; variable?: string }>();
  private modules = new Map<string, Scope>();
  private globals: Scope;

  constructor(
    readonly program: Program,
    readonly budget = 400_000,
  ) {
    this.globals = new Scope(undefined, '');
    for (const [name, value] of Object.entries(globalValues(this))) this.globals.define(name, value);
  }

  private tick() {
    if (++this.steps > this.budget) throw new BudgetError('This page took too long to evaluate.');
  }

  /** A file's module scope: its imports and top-level declarations, evaluated on first use. */
  module(path: string): Scope {
    let scope = this.modules.get(path);
    if (scope) return scope;
    scope = new Scope(this.globals, path);
    this.modules.set(path, scope);
    const info = this.program.info(path);
    if (!info) return scope;
    const moduleScope = scope;
    for (const [local, binding] of info.imports)
      moduleScope.defineLazy(local, () => this.importValue(path, binding.source, binding.imported, local));
    const done = new Map<t.Node, Scope>();
    for (const [name, node] of info.topLevel) {
      moduleScope.defineLazy(name, () => {
        if (t.isVariableDeclarator(node)) {
          // One declarator can bind several names through a pattern. Evaluate it once.
          let bound = done.get(node);
          if (!bound) {
            bound = new Scope(undefined, path);
            done.set(node, bound);
            const value = node.init ? this.evaluate(node.init, moduleScope) : undefined;
            this.bind(node.id, value, bound);
          }
          return bound.get(name);
        }
        if (t.isFunctionDeclaration(node)) return new Closure(node, moduleScope, name);
        if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) return new Closure(node, moduleScope, name);
        if (t.isTSEnumDeclaration(node)) {
          const members: { [key: string]: Value } = {};
          node.members.forEach((member, i) => {
            const key = t.isIdentifier(member.id) ? member.id.name : member.id.value;
            members[key] = member.initializer ? this.evaluate(member.initializer, moduleScope) : i;
          });
          return members;
        }
        if (t.isExpression(node)) return this.evaluate(node, moduleScope);
        return new Unknown(name);
      });
    }
    return scope;
  }

  /** A file's export by name, following re-exports. */
  exportOf(path: string, name: string, depth = 0): Value {
    const info = this.program.info(path);
    if (!info || depth > 20) return new Unknown(name);
    if (name === '*') {
      const namespace: { [key: string]: Value } = {};
      for (const exported of info.exports.keys()) namespace[exported] = this.exportOf(path, exported, depth + 1);
      return namespace;
    }
    const binding = info.exports.get(name);
    if (binding) {
      if ('local' in binding) return this.module(path).get(binding.local);
      return this.importValue(path, binding.from, binding.imported, name, depth + 1);
    }
    for (const from of info.starExports) {
      const target = this.program.resolve(path, from);
      if (target && this.program.info(target)?.exports.has(name)) return this.exportOf(target, name, depth + 1);
    }
    return new Unknown(name);
  }

  private importValue(from: string, spec: string, imported: string, local: string, depth = 0): Value {
    const target = this.program.resolve(from, spec);
    if (target) {
      const asset = this.program.assetImport(target, imported, local);
      if (asset !== undefined) return asset;
      return this.exportOf(target, imported, depth);
    }
    return knownImport(spec, imported, this) ?? new Unknown(local);
  }

  /** Calls a function value. Unknown callees give UNKNOWN. */
  call(callee: Value, args: Value[], self?: Value): Value {
    this.tick();
    if (callee instanceof Native) return callee.call(args, this, self);
    if (callee instanceof Closure) return this.callClosure(callee, args);
    return UNKNOWN;
  }

  callClosure(closure: Closure, args: Value[]): Value {
    if (this.depth > 120) return UNKNOWN;
    this.depth++;
    try {
      const scope = new Scope(closure.scope, closure.scope.file);
      closure.fn.params.forEach((param, i) => {
        if (t.isRestElement(param)) this.bind(param.argument, args.slice(i), scope);
        else if (!t.isTSParameterProperty(param)) this.bind(param, args[i], scope);
      });
      const body = closure.fn.body;
      if (!t.isBlockStatement(body)) return this.evaluate(body, scope);
      return this.exec(body.body, scope).value;
    } finally {
      this.depth--;
    }
  }

  /** Runs statements until a return. Only the ones that shape a render are supported. */
  exec(statements: t.Statement[], scope: Scope): Completion {
    // Function declarations are hoisted.
    for (const statement of statements)
      if (t.isFunctionDeclaration(statement) && statement.id)
        scope.define(statement.id.name, new Closure(statement, scope, statement.id.name));
    for (const statement of statements) {
      this.tick();
      const result = this.statement(statement, scope);
      if (result?.returned || result?.broke) return result;
    }
    return { returned: false, value: undefined };
  }

  private statement(statement: t.Statement, scope: Scope): Completion | undefined {
    if (t.isReturnStatement(statement))
      return { returned: true, value: statement.argument ? this.evaluate(statement.argument, scope) : undefined };
    if (t.isVariableDeclaration(statement)) {
      for (const declarator of statement.declarations)
        this.bind(declarator.id, declarator.init ? this.evaluate(declarator.init, scope) : undefined, scope);
      return;
    }
    if (t.isExpressionStatement(statement)) {
      this.evaluate(statement.expression, scope);
      return;
    }
    if (t.isBlockStatement(statement)) return this.exec(statement.body, new Scope(scope, scope.file));
    if (t.isIfStatement(statement)) {
      const test = truthy(this.evaluate(statement.test, scope));
      // Unknown: skip branches that return early, such as loading or error states,
      // and run the rest, such as `if (x) content = <A />`.
      const take =
        test === undefined ? (containsReturn(statement.consequent) ? false : true) : test;
      const branch = take ? statement.consequent : statement.alternate;
      if (!branch) return;
      return t.isBlockStatement(branch)
        ? this.exec(branch.body, new Scope(scope, scope.file))
        : this.exec([branch], new Scope(scope, scope.file));
    }
    if (t.isSwitchStatement(statement)) {
      const value = prim(this.evaluate(statement.discriminant, scope));
      let index = statement.cases.findIndex(
        (c) => c.test && !(value instanceof Unknown) && prim(this.evaluate(c.test, scope)) === value,
      );
      if (index < 0) index = statement.cases.findIndex((c) => !c.test);
      if (index < 0) index = value instanceof Unknown ? 0 : -1;
      if (index < 0) return;
      const inner = new Scope(scope, scope.file);
      for (const c of statement.cases.slice(index)) {
        const result = this.exec(c.consequent, inner);
        if (result.returned) return result;
        if (result.broke) return;
      }
      return;
    }
    if (t.isBreakStatement(statement)) return { returned: false, broke: true, value: undefined };
    if (t.isForOfStatement(statement)) {
      const iterable = prim(this.evaluate(statement.right, scope));
      if (!Array.isArray(iterable)) return;
      for (const item of iterable.slice(0, 1000)) {
        const inner = new Scope(scope, scope.file);
        const left = statement.left;
        if (t.isVariableDeclaration(left)) this.bind(left.declarations[0].id, item, inner);
        const result = t.isBlockStatement(statement.body)
          ? this.exec(statement.body.body, inner)
          : this.exec([statement.body], inner);
        if (result.returned) return result;
        if (result.broke) break;
      }
      return;
    }
    if (t.isForStatement(statement)) {
      const inner = new Scope(scope, scope.file);
      if (t.isVariableDeclaration(statement.init)) this.statement(statement.init, inner);
      else if (statement.init) this.evaluate(statement.init, inner);
      for (let i = 0; i < 1000; i++) {
        if (statement.test && truthy(this.evaluate(statement.test, inner)) !== true) break;
        const result = t.isBlockStatement(statement.body)
          ? this.exec(statement.body.body, new Scope(inner, inner.file))
          : this.exec([statement.body], new Scope(inner, inner.file));
        if (result.returned) return result;
        if (result.broke) break;
        if (statement.update) this.evaluate(statement.update, inner);
      }
      return;
    }
    if (t.isTryStatement(statement)) return this.exec(statement.block.body, new Scope(scope, scope.file));
    // Everything else, such as loops over unknown data or throws, is skipped.
  }

  /** Binds a destructuring pattern. Unknown values fall back to the pattern's defaults. */
  bind(pattern: t.Node, value: Value, scope: Scope): void {
    if (t.isIdentifier(pattern)) {
      scope.define(pattern.name, value);
      return;
    }
    if (t.isAssignmentPattern(pattern)) {
      const missing = value === undefined || value instanceof Unknown;
      this.bind(pattern.left, missing ? this.evaluate(pattern.right, scope) : value, scope);
      return;
    }
    if (t.isObjectPattern(pattern)) {
      const source = prim(value);
      const used = new Set<string>();
      for (const prop of pattern.properties) {
        if (t.isRestElement(prop)) {
          const rest: { [key: string]: Value } = {};
          if (isRecord(source)) for (const [k, v] of Object.entries(source)) if (!used.has(k)) rest[k] = v;
          this.bind(prop.argument, source instanceof Unknown ? UNKNOWN : rest, scope);
          continue;
        }
        let key = propertyKey(prop);
        if (key === undefined && prop.computed) {
          const computed = prim(this.evaluate(prop.key, scope));
          if (typeof computed === 'string' || typeof computed === 'number') key = String(computed);
        }
        if (key === undefined) continue;
        used.add(key);
        this.bind(prop.value, source instanceof Unknown ? UNKNOWN : this.member(source, key), scope);
      }
      return;
    }
    if (t.isArrayPattern(pattern)) {
      const source = prim(value);
      pattern.elements.forEach((element, i) => {
        if (!element) return;
        if (t.isRestElement(element))
          this.bind(element.argument, Array.isArray(source) ? source.slice(i) : UNKNOWN, scope);
        else this.bind(element, Array.isArray(source) ? source[i] : UNKNOWN, scope);
      });
      return;
    }
    if (t.isTSParameterProperty(pattern)) this.bind(pattern.parameter, value, scope);
  }

  /** Property access on any value. Missing properties of known objects are undefined. */
  member(object: Value, key: string | number, optional = false): Value {
    const value = prim(object);
    if (value instanceof Unknown) return UNKNOWN;
    if (value === null || value === undefined) return optional ? undefined : UNKNOWN;
    if (typeof value === 'string') return stringMember(value, key);
    if (typeof value === 'number') return numberMember(value, key);
    if (Array.isArray(value)) {
      if (key === 'length') return value.length;
      if (typeof key === 'number' || /^\d+$/.test(key)) return value[Number(key)];
      return arrayMember(value, String(key));
    }
    if (isRecord(value)) return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
    if (value instanceof Native) {
      const known = value.component;
      return known && 'member' in known && known.member ? known.member(String(key)) : UNKNOWN;
    }
    return UNKNOWN;
  }

  evaluate(node: t.Node, scope: Scope): Value {
    this.tick();
    switch (node.type) {
      case 'StringLiteral': {
        const edited = this.program.literal(scope.file, node.start!);
        return new Lit(edited ?? node.value, { kind: 'literal', file: scope.file, start: node.start! });
      }
      case 'NumericLiteral':
        return node.value;
      case 'BooleanLiteral':
        return node.value;
      case 'NullLiteral':
        return null;
      case 'BigIntLiteral':
        return Number(node.value);
      case 'RegExpLiteral':
        return UNKNOWN;
      case 'TemplateLiteral': {
        if (!node.expressions.length) {
          const quasi = node.quasis[0];
          const edited = this.program.literal(scope.file, quasi.start!);
          return new Lit(edited ?? quasi.value.cooked ?? quasi.value.raw, {
            kind: 'literal',
            file: scope.file,
            start: quasi.start!,
          });
        }
        let text = '';
        node.quasis.forEach((quasi, i) => {
          text += this.program.literal(scope.file, quasi.start!) ?? quasi.value.cooked ?? quasi.value.raw;
          if (i < node.expressions.length) text += toText(this.evaluate(node.expressions[i], scope));
        });
        return text;
      }
      case 'Identifier':
        if (node.name === 'undefined') return undefined;
        return scope.get(node.name);
      case 'ThisExpression':
        return UNKNOWN;
      case 'ParenthesizedExpression':
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSNonNullExpression':
      case 'TSTypeAssertion':
      case 'TypeCastExpression':
      case 'TSInstantiationExpression':
        return this.evaluate(node.expression, scope);
      case 'ArrayExpression': {
        const items: Value[] = [];
        for (const element of node.elements) {
          if (!element) items.push(undefined);
          else if (t.isSpreadElement(element)) {
            const spread = prim(this.evaluate(element.argument, scope));
            if (Array.isArray(spread)) items.push(...spread);
            else if (typeof spread === 'string') items.push(...spread);
          } else items.push(this.evaluate(element, scope));
        }
        return items;
      }
      case 'ObjectExpression': {
        const result: { [key: string]: Value } = {};
        for (const prop of node.properties) {
          if (t.isSpreadElement(prop)) {
            const spread = prim(this.evaluate(prop.argument, scope));
            if (isRecord(spread)) Object.assign(result, spread);
            continue;
          }
          let key = propertyKey(prop);
          if (key === undefined && prop.computed) {
            const computed = prim(this.evaluate(prop.key, scope));
            if (typeof computed === 'string' || typeof computed === 'number') key = String(computed);
          }
          if (key === undefined) continue;
          result[key] = t.isObjectMethod(prop)
            ? new Closure(prop, scope, key)
            : this.evaluate(prop.value as t.Expression, scope);
        }
        return result;
      }
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
        return new Closure(node, scope, t.isFunctionExpression(node) ? node.id?.name : undefined);
      case 'JSXElement':
      case 'JSXFragment': {
        const editor = this.program.node(scope.file, node.start!);
        return editor ? new JSXValue(editor, scope) : UNKNOWN;
      }
      case 'MemberExpression':
      case 'OptionalMemberExpression': {
        const object = this.evaluate(node.object, scope);
        const optional = node.type === 'OptionalMemberExpression';
        const key = node.computed
          ? prim(this.evaluate(node.property, scope))
          : t.isIdentifier(node.property)
            ? node.property.name
            : t.isPrivateName(node.property)
              ? undefined
              : undefined;
        if (typeof key !== 'string' && typeof key !== 'number') return UNKNOWN;
        return this.member(object, key, optional);
      }
      case 'CallExpression':
      case 'OptionalCallExpression': {
        const callee = node.callee;
        let self: Value;
        let fn: Value;
        if (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) {
          self = this.evaluate(callee.object, scope);
          const key = callee.computed
            ? prim(this.evaluate(callee.property, scope))
            : t.isIdentifier(callee.property)
              ? callee.property.name
              : undefined;
          if (typeof key !== 'string' && typeof key !== 'number') return UNKNOWN;
          if (node.type === 'OptionalCallExpression' && (prim(self) === null || prim(self) === undefined))
            return undefined;
          fn = this.member(self, key, t.isOptionalMemberExpression(callee));
        } else {
          if (t.isV8IntrinsicIdentifier(callee)) return UNKNOWN;
          fn = this.evaluate(callee, scope);
        }
        if (node.optional && (fn === null || fn === undefined)) return undefined;
        const args: Value[] = [];
        for (const arg of node.arguments) {
          if (t.isSpreadElement(arg)) {
            const spread = prim(this.evaluate(arg.argument, scope));
            if (Array.isArray(spread)) args.push(...spread);
          } else if (!t.isArgumentPlaceholder(arg)) args.push(this.evaluate(arg, scope));
        }
        return this.call(fn, args, self);
      }
      case 'NewExpression': {
        const callee = this.evaluate(node.callee, scope);
        if (callee instanceof Native && callee.component?.kind === 'constructor')
          return callee.call(
            node.arguments.map((arg) => (t.isExpression(arg) ? this.evaluate(arg, scope) : UNKNOWN)),
            this,
          );
        return UNKNOWN;
      }
      case 'ConditionalExpression': {
        const test = truthy(this.evaluate(node.test, scope));
        return this.evaluate(test === false ? node.alternate : node.consequent, scope);
      }
      case 'LogicalExpression': {
        const left = this.evaluate(node.left, scope);
        const test = truthy(left);
        if (node.operator === '&&') return test === false ? left : this.evaluate(node.right, scope);
        if (node.operator === '||') return test === true ? left : this.evaluate(node.right, scope);
        const value = prim(left);
        if (value instanceof Unknown) return this.evaluate(node.right, scope);
        return value === null || value === undefined ? this.evaluate(node.right, scope) : left;
      }
      case 'BinaryExpression': {
        if (t.isPrivateName(node.left)) return UNKNOWN;
        return binary(node.operator, this.evaluate(node.left, scope), this.evaluate(node.right, scope));
      }
      case 'UnaryExpression': {
        if (node.operator === 'typeof') {
          const value = prim(this.evaluate(node.argument, scope));
          if (value instanceof Unknown) return UNKNOWN;
          if (value instanceof Closure || value instanceof Native) return 'function';
          return value === null ? 'object' : Array.isArray(value) ? 'object' : typeof value;
        }
        if (node.operator === 'void') return undefined;
        const value = prim(this.evaluate(node.argument, scope));
        if (value instanceof Unknown) return node.operator === '!' ? UNKNOWN : UNKNOWN;
        if (node.operator === '!') return !value;
        if (node.operator === '-') return -Number(value);
        if (node.operator === '+') return Number(value);
        if (node.operator === '~') return ~Number(value);
        return UNKNOWN;
      }
      case 'SequenceExpression': {
        let last: Value;
        for (const expression of node.expressions) last = this.evaluate(expression, scope);
        return last;
      }
      case 'AssignmentExpression': {
        const right = this.evaluate(node.right, scope);
        if (t.isIdentifier(node.left)) {
          const current = scope.get(node.left.name);
          const value =
            node.operator === '='
              ? right
              : binary(node.operator.slice(0, -1) as t.BinaryExpression['operator'], current, right);
          scope.set(node.left.name, value);
          return value;
        }
        if (t.isMemberExpression(node.left) && node.operator === '=') {
          const target = prim(this.evaluate(node.left.object, scope));
          const key = node.left.computed
            ? prim(this.evaluate(node.left.property, scope))
            : t.isIdentifier(node.left.property)
              ? node.left.property.name
              : undefined;
          if (isRecord(target) && (typeof key === 'string' || typeof key === 'number')) target[key] = right;
          else if (Array.isArray(target) && typeof key === 'number') target[key] = right;
        }
        return right;
      }
      case 'UpdateExpression': {
        if (!t.isIdentifier(node.argument)) return UNKNOWN;
        const current = Number(prim(scope.get(node.argument.name)));
        const next = node.operator === '++' ? current + 1 : current - 1;
        scope.set(node.argument.name, next);
        return node.prefix ? next : current;
      }
      case 'TaggedTemplateExpression':
      case 'AwaitExpression':
      case 'YieldExpression':
      case 'ClassExpression':
      case 'ImportExpression':
      case 'MetaProperty':
        return UNKNOWN;
      default:
        return UNKNOWN;
    }
  }
}

function containsReturn(node: t.Node): boolean {
  if (t.isReturnStatement(node)) return true;
  if (t.isFunction(node)) return false;
  if (t.isBlockStatement(node)) return node.body.some(containsReturn);
  if (t.isIfStatement(node)) return containsReturn(node.consequent) || (!!node.alternate && containsReturn(node.alternate));
  return false;
}

function binary(operator: string, leftValue: Value, rightValue: Value): Value {
  const left = prim(leftValue);
  const right = prim(rightValue);
  if (left instanceof Unknown || right instanceof Unknown) {
    // Concatenation with an unknown still shows the known part, as in `${count} items`.
    if (operator === '+' && (typeof left === 'string' || typeof right === 'string')) return toText(left) + toText(right);
    return UNKNOWN;
  }
  const l = left as never;
  const r = right as never;
  switch (operator) {
    case '+':
      return typeof left === 'string' || typeof right === 'string' || typeof left === 'object' || typeof right === 'object'
        ? toText(left) + toText(right)
        : Number(left) + Number(right);
    case '-':
      return l - r;
    case '*':
      return l * r;
    case '/':
      return l / r;
    case '%':
      return l % r;
    case '**':
      return Number(left) ** Number(right);
    case '===':
      return left === right;
    case '!==':
      return left !== right;
    case '==':
      return left == right;
    case '!=':
      return left != right;
    case '<':
      return l < r;
    case '>':
      return l > r;
    case '<=':
      return l <= r;
    case '>=':
      return l >= r;
    case '&':
      return l & r;
    case '|':
      return l | r;
    case '^':
      return l ^ r;
    case '<<':
      return l << r;
    case '>>':
      return l >> r;
    case '>>>':
      return l >>> r;
    case 'in':
      return isRecord(right) && typeof left === 'string' ? left in right : UNKNOWN;
    default:
      return UNKNOWN;
  }
}

const native = (name: string, call: (args: Value[], ev: Evaluator) => Value) => new Native(name, call);

/** Calls a callback for each array item, the way Array.prototype methods do. */
function each(ev: Evaluator, fn: Value, item: Value, i: number, array: Value[]) {
  return ev.call(fn, [item, i, array]);
}

function arrayMember(array: Value[], key: string): Value {
  const m = (call: (args: Value[], ev: Evaluator) => Value) => native(key, call);
  switch (key) {
    case 'map':
      return m(([fn], ev) => array.map((item, i) => each(ev, fn, item, i, array)));
    case 'flatMap':
      return m(([fn], ev) =>
        array.flatMap((item, i) => {
          const value = prim(each(ev, fn, item, i, array));
          return Array.isArray(value) ? value : [value];
        }),
      );
    case 'filter':
      return m(([fn], ev) => array.filter((item, i) => truthy(each(ev, fn, item, i, array)) !== false));
    case 'find':
      return m(([fn], ev) => array.find((item, i) => truthy(each(ev, fn, item, i, array)) === true));
    case 'findIndex':
      return m(([fn], ev) => array.findIndex((item, i) => truthy(each(ev, fn, item, i, array)) === true));
    case 'some':
      return m(([fn], ev) => array.some((item, i) => truthy(each(ev, fn, item, i, array)) === true));
    case 'every':
      return m(([fn], ev) => array.every((item, i) => truthy(each(ev, fn, item, i, array)) === true));
    case 'forEach':
      return m(([fn], ev) => {
        array.forEach((item, i) => each(ev, fn, item, i, array));
        return undefined;
      });
    case 'reduce':
      return m(([fn, initial], ev) => {
        let accumulator = initial;
        array.forEach((item, i) => (accumulator = ev.call(fn, [accumulator, item, i, array])));
        return accumulator;
      });
    case 'slice':
      return m(([start, end]) => array.slice(prim(start) as number, prim(end) as number | undefined));
    case 'concat':
      return m((args) => array.concat(...args.map((arg) => (Array.isArray(prim(arg)) ? (prim(arg) as Value[]) : [arg]))));
    case 'join':
      return m(([separator]) => array.map(toText).join(separator === undefined ? ',' : toText(separator)));
    case 'includes':
      return m(([value]) => array.some((item) => prim(item) === prim(value)));
    case 'indexOf':
      return m(([value]) => array.findIndex((item) => prim(item) === prim(value)));
    case 'at':
      return m(([index]) => array.at(Number(prim(index))));
    case 'reverse':
    case 'toReversed':
      return m(() => [...array].reverse());
    case 'sort':
    case 'toSorted':
      return m(([fn], ev) =>
        [...array].sort((a, b) =>
          fn === undefined ? toText(a).localeCompare(toText(b)) : Number(prim(ev.call(fn, [a, b]))) || 0,
        ),
      );
    case 'flat':
      return m(() => array.flatMap((item) => (Array.isArray(prim(item)) ? (prim(item) as Value[]) : [item])));
    case 'push':
      return m((args) => array.push(...args));
    case 'keys':
      return m(() => array.map((_, i) => i));
    case 'entries':
      return m(() => array.map((item, i) => [i, item]));
    case 'fill':
      return m(([value]) => array.fill(value));
    default:
      return UNKNOWN;
  }
}

function stringMember(value: string, key: string | number): Value {
  if (key === 'length') return value.length;
  if (typeof key === 'number' || /^\d+$/.test(String(key))) return value[Number(key)];
  const s = (call: (args: Value[]) => Value) => native(String(key), (args) => call(args.map(prim)));
  switch (key) {
    case 'toUpperCase':
    case 'toLocaleUpperCase':
      return s(() => value.toUpperCase());
    case 'toLowerCase':
    case 'toLocaleLowerCase':
      return s(() => value.toLowerCase());
    case 'trim':
      return s(() => value.trim());
    case 'trimStart':
      return s(() => value.trimStart());
    case 'trimEnd':
      return s(() => value.trimEnd());
    case 'split':
      return s(([separator, limit]) =>
        typeof separator === 'string' ? value.split(separator, limit as number | undefined) : [value],
      );
    case 'slice':
      return s(([a, b]) => value.slice(a as number, b as number | undefined));
    case 'substring':
      return s(([a, b]) => value.substring(a as number, b as number | undefined));
    case 'charAt':
      return s(([i]) => value.charAt(i as number));
    case 'at':
      return s(([i]) => value.at(i as number));
    case 'replace':
      return s(([a, b]) => (typeof a === 'string' && typeof b === 'string' ? value.replace(a, b) : UNKNOWN));
    case 'replaceAll':
      return s(([a, b]) => (typeof a === 'string' && typeof b === 'string' ? value.split(a).join(b) : UNKNOWN));
    case 'startsWith':
      return s(([a]) => value.startsWith(String(a)));
    case 'endsWith':
      return s(([a]) => value.endsWith(String(a)));
    case 'includes':
      return s(([a]) => value.includes(String(a)));
    case 'indexOf':
      return s(([a]) => value.indexOf(String(a)));
    case 'padStart':
      return s(([n, fill]) => value.padStart(n as number, fill === undefined ? ' ' : String(fill)));
    case 'padEnd':
      return s(([n, fill]) => value.padEnd(n as number, fill === undefined ? ' ' : String(fill)));
    case 'repeat':
      return s(([n]) => value.repeat(Math.min(100, Number(n))));
    case 'concat':
      return s((args) => value + args.map(toText).join(''));
    case 'toString':
    case 'valueOf':
      return s(() => value);
    case 'localeCompare':
      return s(([other]) => value.localeCompare(toText(other)));
    default:
      return UNKNOWN;
  }
}

function numberMember(value: number, key: string | number): Value {
  switch (key) {
    case 'toFixed':
      return native('toFixed', ([digits]) => value.toFixed(Number(prim(digits)) || 0));
    case 'toString':
      return native('toString', () => String(value));
    case 'toLocaleString':
      return native('toLocaleString', () => value.toLocaleString('en-US'));
    default:
      return UNKNOWN;
  }
}

/** Globals the evaluator knows. Everything else is unknown. */
function globalValues(ev: Evaluator): Record<string, Value> {
  const record = (entries: Record<string, Value>) => entries;
  const date = (time: number) =>
    record({
      getFullYear: native('getFullYear', () => new Date(time).getFullYear()),
      getMonth: native('getMonth', () => new Date(time).getMonth()),
      getDate: native('getDate', () => new Date(time).getDate()),
      getDay: native('getDay', () => new Date(time).getDay()),
      getTime: native('getTime', () => time),
      toISOString: native('toISOString', () => new Date(time).toISOString()),
      toLocaleDateString: native('toLocaleDateString', () => new Date(time).toLocaleDateString('en-US')),
      toLocaleTimeString: native('toLocaleTimeString', () => new Date(time).toLocaleTimeString('en-US')),
    });
  const DateValue = new Native('Date', () => date(Date.now()), {
    kind: 'constructor',
    member: (key) => (key === 'now' ? native('now', () => Date.now()) : UNKNOWN),
  });
  void ev;
  return {
    undefined: undefined,
    NaN: NaN,
    Infinity: Infinity,
    Math: record({
      min: native('min', (args) => Math.min(...args.map((a) => Number(prim(a))))),
      max: native('max', (args) => Math.max(...args.map((a) => Number(prim(a))))),
      round: native('round', ([a]) => Math.round(Number(prim(a)))),
      floor: native('floor', ([a]) => Math.floor(Number(prim(a)))),
      ceil: native('ceil', ([a]) => Math.ceil(Number(prim(a)))),
      abs: native('abs', ([a]) => Math.abs(Number(prim(a)))),
      sqrt: native('sqrt', ([a]) => Math.sqrt(Number(prim(a)))),
      pow: native('pow', ([a, b]) => Math.pow(Number(prim(a)), Number(prim(b)))),
      random: native('random', () => 0.5),
      PI: Math.PI,
    }),
    JSON: record({
      stringify: native('stringify', ([value]) => {
        try {
          return JSON.stringify(plain(value));
        } catch {
          return UNKNOWN;
        }
      }),
      parse: native('parse', () => UNKNOWN),
    }),
    Object: record({
      keys: native('keys', ([value]) => (isRecord(prim(value)) ? Object.keys(prim(value) as object) : UNKNOWN)),
      values: native('values', ([value]) =>
        isRecord(prim(value)) ? Object.values(prim(value) as { [key: string]: Value }) : UNKNOWN,
      ),
      entries: native('entries', ([value]) =>
        isRecord(prim(value)) ? Object.entries(prim(value) as { [key: string]: Value }) : UNKNOWN,
      ),
      assign: native('assign', ([target, ...sources]) => {
        if (!isRecord(target)) return UNKNOWN;
        for (const source of sources) if (isRecord(source)) Object.assign(target, source);
        return target;
      }),
      fromEntries: native('fromEntries', ([entries]) => {
        const list = prim(entries);
        if (!Array.isArray(list)) return UNKNOWN;
        const result: { [key: string]: Value } = {};
        for (const entry of list) {
          const pair = prim(entry);
          if (Array.isArray(pair)) result[toText(pair[0])] = pair[1];
        }
        return result;
      }),
      freeze: native('freeze', ([value]) => value),
    }),
    Array: record({
      isArray: native('isArray', ([value]) => Array.isArray(prim(value))),
      from: native('from', ([source, fn], e) => {
        const value = prim(source);
        let items: Value[] = [];
        if (Array.isArray(value)) items = [...value];
        else if (typeof value === 'string') items = [...value];
        else if (isRecord(value) && typeof prim(value.length) === 'number')
          items = Array.from({ length: Math.min(1000, prim(value.length) as number) }, () => undefined);
        else return UNKNOWN;
        return fn === undefined ? items : items.map((item, i) => e.call(fn, [item, i]));
      }),
    }),
    String: native('String', ([value]) => toText(value)),
    Number: native('Number', ([value]) => Number(prim(value))),
    Boolean: native('Boolean', ([value]) => truthy(value) ?? UNKNOWN),
    parseInt: native('parseInt', ([value]) => parseInt(toText(value), 10)),
    parseFloat: native('parseFloat', ([value]) => parseFloat(toText(value))),
    isNaN: native('isNaN', ([value]) => Number.isNaN(Number(prim(value)))),
    encodeURIComponent: native('encodeURIComponent', ([value]) => encodeURIComponent(toText(value))),
    Date: DateValue,
    console: record({ log: native('log', () => undefined), warn: native('warn', () => undefined), error: native('error', () => undefined) }),
    process: record({ env: record({ NODE_ENV: 'development' }) }),
  };
}

/** A Value as plain JSON data, for JSON.stringify. */
function plain(value: Value): unknown {
  const v = prim(value);
  if (Array.isArray(v)) return v.map(plain);
  if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, plain(item)]));
  if (v instanceof Unknown || v instanceof Closure || v instanceof Native || v instanceof JSXValue || v instanceof Rendered)
    return null;
  return v;
}
