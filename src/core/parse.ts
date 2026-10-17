/*
 * Source file analysis.
 *
 * parseFile reads one module with Babel and records what the rest of Frame needs:
 * imports and exports for resolving components across files, the components the
 * file defines and the props they take, module-level bindings for the evaluator,
 * and an EditorNode tree for every JSX root. It also indexes the JSX and expression
 * AST nodes by source offset, which is how trees, the evaluator, and the printer
 * find their way back into the source.
 *
 * Results depend only on the path and the text, so callers cache them by text.
 */

import { parse } from '@babel/parser';
import * as t from '@babel/types';
import type { EditorNode, Style } from './model';

export interface ImportBinding {
  local: string;
  source: string;
  /** `default`, `*` for a namespace import, or the imported name. */
  imported: string;
}

export type ExportBinding = { local: string } | { from: string; imported: string };

/** One prop a component takes, for the instance panel. */
export interface PropInfo {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'node' | 'unknown';
  /** Choices for enum props: string literal unions and cva variants. */
  options?: string[];
  default?: string | number | boolean;
}

export interface ComponentInfo {
  /** Local name in this file. An anonymous default export gets `default`. */
  name: string;
  fn: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration;
  props: PropInfo[];
  /** The component destructures className or spreads its other props, so callers can style it. */
  acceptsClassName: boolean;
  acceptsStyle: boolean;
}

export interface FileInfo {
  path: string;
  source: string;
  ast?: t.File;
  /** Parse error shown in place of the file. */
  error?: string;
  imports: Map<string, ImportBinding>;
  exports: Map<string, ExportBinding>;
  starExports: string[];
  /** `import './styles.css'` and other imports without bindings. */
  sideEffectImports: string[];
  /** Module-level declarations by the names they bind. */
  topLevel: Map<string, t.Node>;
  components: Map<string, ComponentInfo>;
  /** Pristine trees for every JSX root, by origin offset. */
  roots: Map<number, EditorNode>;
  /** JSX elements, fragments, texts, and containers by start offset. */
  nodes: Map<number, t.Node>;
  /** Expressions that trees refer to by offset: attribute values, spreads, and `{...}` children. */
  exprs: Map<number, t.Expression>;
  /** The file's preferred string quote, from its imports. */
  quote: "'" | '"';
  /** One level of indentation: a tab or some spaces. */
  indentUnit: string;
}

const jsFile = /\.(jsx?|mjs|cjs)$/i;

export function parseModule(source: string, path: string): t.File {
  const typescript = /\.(tsx?|mts|cts)$/i.test(path);
  const plugins: ('jsx' | 'typescript')[] = /\.(ts|mts|cts)$/i.test(path)
    ? ['typescript']
    : typescript
      ? ['jsx', 'typescript']
      : ['jsx'];
  try {
    return parse(source, { sourceType: 'module', plugins });
  } catch (error) {
    // Plenty of .js files carry TypeScript-only syntax through tooling. Try once more.
    if (jsFile.test(path))
      return parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    throw error;
  }
}

/** Visits every AST node depth-first, parents before children. Return false to skip a subtree. */
export function walk(node: t.Node, visit: (node: t.Node, parent?: t.Node) => boolean | void) {
  (function go(current: t.Node, parent?: t.Node) {
    if (visit(current, parent) === false) return;
    for (const key of t.VISITOR_KEYS[current.type] || []) {
      const value = (current as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child === 'object' && 'type' in child) go(child, current);
      } else if (value && typeof value === 'object' && 'type' in value) go(value as t.Node, current);
    }
  })(node);
}

/** Value of a string, number, or expression-free template literal. Undefined for anything dynamic. */
export function literalValue(node: t.Node | null | undefined): string | number | undefined {
  if (t.isStringLiteral(node) || t.isNumericLiteral(node)) return node.value;
  if (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument))
    return -node.argument.value;
  if (t.isTemplateLiteral(node) && node.expressions.length === 0)
    return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
}

/** Name of a plain `key: value` property. Undefined for spreads, methods, and computed keys. */
export function propertyKey(prop: t.Node): string | undefined {
  if (!t.isObjectProperty(prop) && !t.isObjectMethod(prop)) return;
  if (prop.computed) return t.isStringLiteral(prop.key) ? prop.key.value : undefined;
  if (t.isIdentifier(prop.key)) return prop.key.name;
  if (t.isStringLiteral(prop.key)) return prop.key.value;
  if (t.isNumericLiteral(prop.key)) return String(prop.key.value);
}

/** The name of a JSX tag as written: `div`, `Card`, `motion.div`, or `svg:use`. */
export function tagName(name: t.JSXOpeningElement['name']): string {
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXNamespacedName(name)) return `${name.namespace.name}:${name.name.name}`;
  return `${tagName(name.object)}.${name.property.name}`;
}

/** The attribute's name as written, including namespaced names such as `xlink:href`. */
export function attrName(attr: t.JSXAttribute): string {
  return t.isJSXNamespacedName(attr.name)
    ? `${attr.name.namespace.name}:${attr.name.name.name}`
    : attr.name.name;
}

/**
 * The text a JSXText child renders, following React's rules: whitespace that
 * touches a line break is dropped, and the remaining lines join with one space.
 */
export function cleanJSXText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((line, i) => {
    if (/[^ \t]/.test(line)) lastNonEmpty = i;
  });
  let text = '';
  lines.forEach((line, i) => {
    let trimmed = line.replace(/\t/g, ' ');
    if (i > 0) trimmed = trimmed.replace(/^ +/, '');
    if (i < lines.length - 1) trimmed = trimmed.replace(/ +$/, '');
    if (trimmed) text += i === lastNonEmpty ? trimmed : `${trimmed} `;
  });
  return text;
}

type JSXChild = t.JSXElement['children'][number];
const isJSX = (node: t.Node): node is t.JSXElement | t.JSXFragment =>
  t.isJSXElement(node) || t.isJSXFragment(node);

/** Parses a file and builds everything in FileInfo. A syntax error leaves the file empty with `error` set. */
export function parseFile(path: string, source: string): FileInfo {
  const info: FileInfo = {
    path,
    source,
    imports: new Map(),
    exports: new Map(),
    starExports: [],
    sideEffectImports: [],
    topLevel: new Map(),
    components: new Map(),
    roots: new Map(),
    nodes: new Map(),
    exprs: new Map(),
    quote: '"',
    indentUnit: /^\t/m.test(source) ? '\t' : /^ {4}\S/m.test(source) && !/^ {2}\S/m.test(source) ? '    ' : '  ',
  };
  if (!/\.(jsx?|tsx?|mjs|cjs|mts|cts)$/i.test(path)) return info;
  let ast: t.File;
  try {
    ast = parseModule(source, path);
  } catch (error) {
    info.error = error instanceof Error ? error.message : String(error);
    return info;
  }
  info.ast = ast;
  info.quote = preferredQuote(ast, source);
  readModule(info, ast);
  buildTrees(info, ast);
  findComponents(info, ast);
  return info;
}

/** The quote most of the file's JS strings use. JSX attribute strings don't count. Double when there are none. */
function preferredQuote(ast: t.File, source: string): "'" | '"' {
  let single = 0;
  let double = 0;
  walk(ast.program, (node, parent) => {
    if (!t.isStringLiteral(node) || t.isJSXAttribute(parent)) return;
    if (source[node.start!] === "'") single++;
    else double++;
  });
  return single > double ? "'" : '"';
}

/** Imports, exports, and module-level bindings. */
function readModule(info: FileInfo, ast: t.File) {
  for (const statement of ast.program.body) {
    if (t.isImportDeclaration(statement)) {
      if (statement.importKind === 'type') continue;
      if (!statement.specifiers.length) info.sideEffectImports.push(statement.source.value);
      for (const spec of statement.specifiers) {
        if (t.isImportSpecifier(spec) && spec.importKind === 'type') continue;
        const imported = t.isImportDefaultSpecifier(spec)
          ? 'default'
          : t.isImportNamespaceSpecifier(spec)
            ? '*'
            : t.isIdentifier(spec.imported)
              ? spec.imported.name
              : spec.imported.value;
        info.imports.set(spec.local.name, {
          local: spec.local.name,
          source: statement.source.value,
          imported,
        });
      }
      continue;
    }
    if (t.isExportAllDeclaration(statement)) {
      info.starExports.push(statement.source.value);
      continue;
    }
    if (t.isExportNamedDeclaration(statement)) {
      if (statement.exportKind === 'type') continue;
      for (const spec of statement.specifiers) {
        const exported = t.isIdentifier(spec.exported) ? spec.exported.name : spec.exported.value;
        if (statement.source) {
          const imported = t.isExportSpecifier(spec)
            ? spec.local.name
            : t.isExportDefaultSpecifier(spec)
              ? 'default'
              : '*';
          info.exports.set(exported, { from: statement.source.value, imported });
        } else if (t.isExportSpecifier(spec)) info.exports.set(exported, { local: spec.local.name });
      }
      if (statement.declaration) {
        for (const name of declaredNames(statement.declaration))
          info.exports.set(name, { local: name });
        addTopLevel(info, statement.declaration);
      }
      continue;
    }
    if (t.isExportDefaultDeclaration(statement)) {
      const declaration = statement.declaration;
      if (
        (t.isFunctionDeclaration(declaration) || t.isClassDeclaration(declaration)) &&
        declaration.id
      ) {
        info.exports.set('default', { local: declaration.id.name });
        addTopLevel(info, declaration);
      } else if (t.isIdentifier(declaration)) {
        info.exports.set('default', { local: declaration.name });
      } else {
        // An anonymous default export binds a name nothing else can use.
        info.exports.set('default', { local: 'default' });
        info.topLevel.set('default', declaration);
      }
      continue;
    }
    addTopLevel(info, statement);
  }
}

function declaredNames(node: t.Node): string[] {
  if ((t.isFunctionDeclaration(node) || t.isClassDeclaration(node)) && node.id) return [node.id.name];
  if (t.isVariableDeclaration(node))
    return node.declarations.flatMap((d) => Object.keys(t.getBindingIdentifiers(d.id)));
  if ((t.isTSEnumDeclaration(node) || t.isTSInterfaceDeclaration(node) || t.isTSTypeAliasDeclaration(node)) && node.id)
    return [node.id.name];
  return [];
}

function addTopLevel(info: FileInfo, node: t.Node) {
  if (t.isVariableDeclaration(node)) {
    for (const declarator of node.declarations)
      for (const name of Object.keys(t.getBindingIdentifiers(declarator.id)))
        info.topLevel.set(name, declarator);
  } else for (const name of declaredNames(node)) info.topLevel.set(name, node);
}

/**
 * Builds a tree for every JSX root. Roots are JSX expressions that aren't
 * children of other JSX: return values, consts, call arguments, attribute values.
 */
function buildTrees(info: FileInfo, ast: t.File) {
  const claimed = new Set<number>();
  walk(ast.program, (node) => {
    if (!isJSX(node)) return;
    if (!claimed.has(node.start!)) {
      const tree = toEditor(info, node, claimed);
      info.roots.set(node.start!, tree);
    }
    // Attribute values can hold more roots, so keep walking into this JSX.
  });
}

/** Converts one JSX child to an editor node and registers its AST nodes. */
function toEditor(info: FileInfo, node: JSXChild, claimed: Set<number>): EditorNode {
  const start = node.start!;
  claimed.add(start);
  info.nodes.set(start, node);
  const id = `${info.path}:${start}`;
  const base = { id, origin: start, tag: '', style: {}, attrs: {}, children: [] };
  if (t.isJSXText(node)) return { ...base, kind: 'text', text: cleanJSXText(node.value) };
  if (t.isJSXExpressionContainer(node)) {
    const expression = node.expression;
    if (t.isJSXEmptyExpression(expression)) return { ...base, kind: 'expression', comment: true };
    const value = literalValue(expression);
    if (value !== undefined) return { ...base, kind: 'text', text: String(value) };
    info.exprs.set(expression.start!, expression);
    return {
      ...base,
      kind: 'expression',
      expr: expression.start!,
      children: islands(info, expression, claimed),
    };
  }
  if (t.isJSXSpreadChild(node)) {
    info.exprs.set(node.expression.start!, node.expression);
    return { ...base, kind: 'expression', expr: node.expression.start! };
  }
  if (t.isJSXFragment(node)) return { ...base, kind: 'fragment', children: childNodes(info, node.children, claimed) };

  const opening = node.openingElement;
  const tag = tagName(opening.name);
  const attrs: Record<string, string> = {};
  const style: Style = {};
  const dyn: NonNullable<EditorNode['dyn']> = {};
  let name: string | undefined;
  for (const attr of opening.attributes) {
    if (t.isJSXSpreadAttribute(attr)) {
      info.exprs.set(attr.argument.start!, attr.argument);
      (dyn.spreads ||= []).push(attr.argument.start!);
      continue;
    }
    const key = attrName(attr);
    const value = attr.value;
    const expression = t.isJSXExpressionContainer(value) ? value.expression : undefined;
    if (key === 'style' && expression && !t.isJSXEmptyExpression(expression)) {
      const staticOnly = readStyle(expression, style);
      if (!staticOnly) {
        info.exprs.set(expression.start!, expression);
        dyn.style = expression.start!;
      }
      continue;
    }
    const literal = t.isStringLiteral(value) ? value.value : literalValue(expression);
    if (key === 'data-layer' && typeof literal === 'string') {
      name = literal;
      continue;
    }
    if (typeof literal === 'string') attrs[key] = literal;
    else if (expression && !t.isJSXEmptyExpression(expression)) {
      info.exprs.set(expression.start!, expression);
      (dyn.attrs ||= {})[key] = expression.start!;
    } else if (value === null) {
      // `<input disabled />` means disabled={true}. Record it as a dynamic `true`.
      (dyn.attrs ||= {})[key] = -1;
    } else if (isJSX(value as t.Node)) {
      const element = value as t.JSXElement;
      info.exprs.set(element.start!, element);
      (dyn.attrs ||= {})[key] = element.start!;
    }
  }
  // An element whose children are all literal text edits as one string.
  const textOnly =
    node.children.some(
      (child) =>
        (t.isJSXText(child) && cleanJSXText(child.value)) ||
        (t.isJSXExpressionContainer(child) && literalValue(child.expression) !== undefined),
    ) &&
    node.children.every(
      (child) =>
        t.isJSXText(child) ||
        (t.isJSXExpressionContainer(child) && literalValue(child.expression) !== undefined),
    );
  if (textOnly) node.children.forEach((child) => info.nodes.set(child.start!, child));
  return {
    ...base,
    kind: 'element',
    tag,
    ...(name !== undefined ? { name } : {}),
    style,
    attrs,
    ...(Object.keys(dyn).length ? { dyn } : {}),
    ...(textOnly
      ? {
          text: node.children
            .map((child) =>
              t.isJSXText(child)
                ? cleanJSXText(child.value)
                : String(literalValue((child as t.JSXExpressionContainer).expression)),
            )
            .join(''),
        }
      : { children: childNodes(info, node.children, claimed) }),
  };
}

/** Converts children, dropping whitespace-only text, which is formatting rather than content. */
function childNodes(info: FileInfo, children: JSXChild[], claimed: Set<number>): EditorNode[] {
  return children
    .filter((child) => !t.isJSXText(child) || cleanJSXText(child.value))
    .map((child) => toEditor(info, child, claimed));
}

/** The outermost JSX inside an expression, such as the element a `.map` callback returns. */
function islands(info: FileInfo, expression: t.Node, claimed: Set<number>): EditorNode[] {
  const found: EditorNode[] = [];
  walk(expression, (node) => {
    if (!isJSX(node)) return;
    found.push(toEditor(info, node, claimed));
    return false;
  });
  return found;
}

/**
 * Copies the literal entries of an inline style object into `style`. Returns true
 * when the object holds nothing else, so the expression needs no evaluation.
 */
function readStyle(expression: t.Expression, style: Style): boolean {
  if (!t.isObjectExpression(expression)) return false;
  let staticOnly = true;
  for (const prop of expression.properties) {
    const key = propertyKey(prop);
    const value = t.isObjectProperty(prop) ? literalValue(prop.value) : undefined;
    if (key && value !== undefined && !t.isObjectMethod(prop)) style[key] = value;
    else staticOnly = false;
  }
  return staticOnly;
}

/** The function behind a component declaration, unwrapping forwardRef, memo, and type casts. */
export function unwrapFunction(
  node: t.Node | null | undefined,
): t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration | undefined {
  if (!node) return;
  if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node) || t.isFunctionDeclaration(node))
    return node;
  if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node) || t.isTSNonNullExpression(node))
    return unwrapFunction(node.expression);
  if (t.isCallExpression(node)) {
    const callee = t.isMemberExpression(node.callee) ? node.callee.property : node.callee;
    if (t.isIdentifier(callee) && /^(forwardRef|memo|observer)$/.test(callee.name))
      return unwrapFunction(node.arguments[0] as t.Node);
  }
}

/** Capitalized functions at module level, and the anonymous default export. */
function findComponents(info: FileInfo, ast: t.File) {
  for (const [name, node] of info.topLevel) {
    if (name !== 'default' && !/^[A-Z]/.test(name)) continue;
    const init = t.isVariableDeclarator(node) ? node.init : node;
    const fn = unwrapFunction(init);
    if (!fn) continue;
    info.components.set(name, { name, fn, ...readProps(info, ast, fn, declaredPropsType(node)) });
  }
}

/**
 * A props type given outside the function: `forwardRef<El, Props>(...)`,
 * `memo<Props>(...)`, or `const Card: React.FC<Props> = ...`.
 */
function declaredPropsType(node: t.Node): t.TSType | undefined {
  if (t.isVariableDeclarator(node) && t.isIdentifier(node.id) && t.isTSTypeAnnotation(node.id.typeAnnotation)) {
    const type = node.id.typeAnnotation.typeAnnotation;
    if (t.isTSTypeReference(type) && type.typeParameters?.params.length) return type.typeParameters.params[0];
  }
  let call = t.isVariableDeclarator(node) ? node.init : node;
  while (t.isTSAsExpression(call) || t.isTSSatisfiesExpression(call)) call = call.expression;
  if (!t.isCallExpression(call) || !call.typeParameters) return;
  const callee = t.isMemberExpression(call.callee) ? call.callee.property : call.callee;
  const params = call.typeParameters.params;
  if (t.isIdentifier(callee, { name: 'forwardRef' })) return params[1];
  if (t.isIdentifier(callee, { name: 'memo' })) return params[0];
}

/** Props from the first parameter's destructuring pattern and type annotation. */
function readProps(info: FileInfo, ast: t.File, fn: ComponentInfo['fn'], declared?: t.TSType) {
  const props = new Map<string, PropInfo>();
  let acceptsClassName = false;
  let acceptsStyle = false;
  const param = fn.params[0];
  const pattern = t.isAssignmentPattern(param) ? param.left : param;
  if (t.isObjectPattern(pattern)) {
    for (const prop of pattern.properties) {
      if (t.isRestElement(prop)) {
        acceptsClassName = acceptsStyle = true;
        continue;
      }
      const key = propertyKey(prop);
      if (!key) continue;
      const value = t.isObjectProperty(prop) ? prop.value : undefined;
      const fallback = t.isAssignmentPattern(value)
        ? t.isBooleanLiteral(value.right)
          ? value.right.value
          : literalValue(value.right)
        : undefined;
      props.set(key, { name: key, type: 'unknown', ...(fallback !== undefined ? { default: fallback } : {}) });
    }
  } else if (t.isIdentifier(pattern)) {
    // `props.title` and friends, read from the body.
    const name = pattern.name;
    walk(fn.body, (node) => {
      if (
        t.isMemberExpression(node) &&
        t.isIdentifier(node.object, { name }) &&
        t.isIdentifier(node.property) &&
        !node.computed
      )
        props.set(node.property.name, props.get(node.property.name) || { name: node.property.name, type: 'unknown' });
      if (t.isSpreadElement(node) || t.isJSXSpreadAttribute(node)) {
        const argument = t.isSpreadElement(node) ? node.argument : node.argument;
        if (t.isIdentifier(argument, { name })) acceptsClassName = acceptsStyle = true;
      }
    });
  }
  const annotation = t.isIdentifier(pattern) || t.isObjectPattern(pattern) ? pattern.typeAnnotation : undefined;
  const type = t.isTSTypeAnnotation(annotation) ? annotation.typeAnnotation : declared;
  if (type) {
    const typed = readType(info, ast, type, new Set());
    for (const prop of typed.props) {
      const known = props.get(prop.name);
      props.set(prop.name, { ...prop, ...(known?.default !== undefined ? { default: known.default } : {}) });
    }
    if (typed.open) acceptsClassName = acceptsStyle = true;
  }
  if (props.has('className')) acceptsClassName = true;
  if (props.has('style')) acceptsStyle = true;
  return { props: [...props.values()], acceptsClassName, acceptsStyle };
}

/**
 * Props declared by a TypeScript type. `open` is set when the type extends HTML
 * attributes or another type Frame can't see into, so className is likely accepted.
 */
function readType(
  info: FileInfo,
  ast: t.File,
  type: t.TSType,
  seen: Set<string>,
): { props: PropInfo[]; open: boolean } {
  if (t.isTSTypeLiteral(type)) return { props: members(type.members), open: false };
  if (t.isTSIntersectionType(type)) {
    const parts = type.types.map((part) => readType(info, ast, part, seen));
    return { props: parts.flatMap((part) => part.props), open: parts.some((part) => part.open) };
  }
  if (t.isTSTypeReference(type)) {
    const name = t.isIdentifier(type.typeName) ? type.typeName.name : undefined;
    // VariantProps<typeof buttonVariants> lists cva's variants as enum props.
    if (name === 'VariantProps' && type.typeParameters?.params[0]) {
      const query = type.typeParameters.params[0];
      if (t.isTSTypeQuery(query) && t.isIdentifier(query.exprName))
        return { props: cvaVariants(info, query.exprName.name), open: false };
    }
    if (name && !seen.has(name)) {
      seen.add(name);
      const declaration = ast.program.body
        .map((statement) => (t.isExportNamedDeclaration(statement) ? statement.declaration : statement))
        .find(
          (statement) =>
            (t.isTSInterfaceDeclaration(statement) || t.isTSTypeAliasDeclaration(statement)) &&
            statement.id.name === name,
        );
      if (t.isTSInterfaceDeclaration(declaration)) {
        const inherited = (declaration.extends || []).map((heritage) =>
          t.isIdentifier(heritage.expression)
            ? readType(info, ast, t.tsTypeReference(heritage.expression, heritage.typeParameters), seen)
            : { props: [], open: true },
        );
        return {
          props: [...inherited.flatMap((part) => part.props), ...members(declaration.body.body)],
          open: inherited.some((part) => part.open),
        };
      }
      if (t.isTSTypeAliasDeclaration(declaration))
        return readType(info, ast, declaration.typeAnnotation, seen);
    }
    return { props: [], open: true };
  }
  return { props: [], open: false };
}

function members(list: t.TSTypeElement[]): PropInfo[] {
  const props: PropInfo[] = [];
  for (const member of list) {
    if (!t.isTSPropertySignature(member) || member.computed) continue;
    const name = t.isIdentifier(member.key) ? member.key.name : t.isStringLiteral(member.key) ? member.key.value : undefined;
    if (!name) continue;
    const type = member.typeAnnotation?.typeAnnotation;
    props.push({ name, ...describe(type) });
  }
  return props;
}

function describe(type: t.TSType | undefined): Pick<PropInfo, 'type' | 'options'> {
  if (!type) return { type: 'unknown' };
  if (t.isTSStringKeyword(type)) return { type: 'string' };
  if (t.isTSNumberKeyword(type)) return { type: 'number' };
  if (t.isTSBooleanKeyword(type)) return { type: 'boolean' };
  if (t.isTSUnionType(type)) {
    const options = type.types
      .filter((member): member is t.TSLiteralType => t.isTSLiteralType(member) && t.isStringLiteral(member.literal))
      .map((member) => (member.literal as t.StringLiteral).value);
    if (options.length) return { type: 'enum', options };
    const rest = type.types.filter((member) => !t.isTSUndefinedKeyword(member) && !t.isTSNullKeyword(member));
    if (rest.length === 1) return describe(rest[0]);
  }
  if (t.isTSTypeReference(type)) {
    const name = t.isIdentifier(type.typeName)
      ? type.typeName.name
      : t.isTSQualifiedName(type.typeName)
        ? type.typeName.right.name
        : '';
    if (/^(ReactNode|ReactElement|Element)$/.test(name)) return { type: 'node' };
  }
  return { type: 'unknown' };
}

/** Variant names and options from `const x = cva(base, { variants: {...} })`. */
function cvaVariants(info: FileInfo, name: string): PropInfo[] {
  const declarator = info.topLevel.get(name);
  const call = t.isVariableDeclarator(declarator) ? declarator.init : undefined;
  if (!t.isCallExpression(call)) return [];
  const config = call.arguments[1];
  if (!t.isObjectExpression(config)) return [];
  const variants = config.properties.find((prop) => propertyKey(prop) === 'variants');
  const defaults = config.properties.find((prop) => propertyKey(prop) === 'defaultVariants');
  if (!t.isObjectProperty(variants) || !t.isObjectExpression(variants.value)) return [];
  const defaultValues = new Map<string, string>();
  if (t.isObjectProperty(defaults) && t.isObjectExpression(defaults.value))
    for (const prop of defaults.value.properties) {
      const key = propertyKey(prop);
      const value = t.isObjectProperty(prop) ? literalValue(prop.value) : undefined;
      if (key && value !== undefined) defaultValues.set(key, String(value));
    }
  return variants.value.properties.flatMap((prop) => {
    const key = propertyKey(prop);
    if (!key || !t.isObjectProperty(prop) || !t.isObjectExpression(prop.value)) return [];
    const options = prop.value.properties.map(propertyKey).filter((option): option is string => !!option);
    const fallback = defaultValues.get(key);
    return [{ name: key, type: 'enum' as const, options, ...(fallback ? { default: fallback } : {}) }];
  });
}

/** Line and column (both 1-based) of an offset, for messages and editor links. */
export function lineColumn(source: string, offset: number) {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < source.length; i++)
    if (source.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  return { line, column: offset - last };
}
