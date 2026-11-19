// How a plugin changes any component: every React element the app creates passes through
// here on its way to React (`installElementHooks` wraps the JSX runtime's `jsx`/`jsxs`
// and `React.createElement`), and an element whose type has patches is created with that
// type's "slot" instead: a component that draws the type's current patches around it.
//
// With no slot and no interceptor it's one boolean test per element. A slot, once made,
// stays for the session, so adding and removing patches of a type afterwards only
// re-renders its slots: React never sees the element's type change, which would remount
// everything the parent drew. What a slot can't reach is an element created before it
// existed (its parent must render again), which is why plugins that patch components
// load before the app's first render (#early).
import {
  cloneElement,
  Component,
  createElement,
  isValidElement,
  useSyncExternalStore,
} from "react";
import type { ComponentType, ReactElement, ReactNode } from "react";

type ElementType = unknown;
type Props = Record<string, unknown>;
type PropsChange = (props: Props) => Props | void;
type Wrap = (Original: ComponentType<Props>) => ElementType;
export type Interceptor = (
  type: ElementType,
  props: Props,
) => { type?: ElementType; props?: Props } | void;

// React's own, kept from before they're wrapped: what's drawn inside a slot must not come
// back through the hook, or a slot would draw itself.
const rawCreateElement = createElement;

const MEMO = Symbol.for("react.memo");
const FORWARD_REF = Symbol.for("react.forward_ref");

interface Entry<T> {
  id: number;
  owner: string;
  value: T;
}

/** What a slot draws, replaced whole on every change (a `useSyncExternalStore` snapshot). */
interface SlotSnapshot {
  /** The patches composed around the type, or the type itself with none. */
  render: ElementType;
  changes: readonly Entry<PropsChange>[];
  version: number;
}

interface Slot {
  type: ElementType;
  name: string;
  /** What elements of `type` are created with. */
  component: ComponentType<Props>;
  /** Draws the type itself: the `Original` the first wrap gets. */
  original: ComponentType<Props>;
  wraps: Entry<Wrap>[];
  changes: Entry<PropsChange>[];
  snapshot: SlotSnapshot;
  listeners: Set<() => void>;
}

const slots = new Map<ElementType, Slot>();
const interceptors: Entry<Interceptor>[] = [];
let active = false;
let nextId = 1;

let reportError = (owner: string, what: string, error: unknown): void => {
  console.error(`[plugin ${owner}] ${what} threw`, error);
};
let onLateSlot: ((owner: string, name: string) => void) | null = null;
let appRendered = false;

/** Where a patch's errors go (the host names the plugin in a toast). */
export function setPatchErrorReporter(report: typeof reportError): void {
  reportError = report;
}

/**
 * Called when a type gets its first patch after the app has rendered: elements of it
 * that already exist stay unpatched until their parents render again.
 */
export function setLateSlotListener(listener: typeof onLateSlot): void {
  onLateSlot = listener;
}

/** The app's first render has been committed. */
export function markAppRendered(): void {
  appRendered = true;
}

/** Names given to types (a component asked for by name): a release build's functions
 *  have minified names, which say nothing in a message. */
const givenNames = new WeakMap<object, string>();

/** Calls `type` by `name` in messages and in its slot's display name. */
export function nameType(type: ElementType, name: string): void {
  if ((typeof type === "object" || typeof type === "function") && type !== null)
    givenNames.set(type, name);
}

export function typeName(type: ElementType): string {
  if (typeof type === "string") return type;
  if ((typeof type === "object" || typeof type === "function") && type !== null) {
    const given = givenNames.get(type);
    if (given !== undefined) return given;
  }
  if (typeof type === "function") {
    const named = type as { displayName?: string; name?: string };
    return named.displayName || named.name || "Component";
  }
  if (typeof type === "object" && type !== null) {
    const wrapped = type as { displayName?: string; type?: unknown; render?: unknown };
    if (wrapped.displayName) return wrapped.displayName;
    if (wrapped.type !== undefined) return typeName(wrapped.type);
    if (wrapped.render !== undefined) return typeName(wrapped.render);
  }
  return "Component";
}

/**
 * The function to call for a component's output, or null for one that can't be called
 * inline (a class, a native component's name).
 */
export function renderFunction(type: ElementType): ((props: Props) => ReactNode) | null {
  if (typeof type === "function") {
    const prototype = (type as { prototype?: { isReactComponent?: unknown } }).prototype;
    return prototype?.isReactComponent ? null : (type as (props: Props) => ReactNode);
  }
  if (typeof type === "object" && type !== null) {
    const exotic = type as {
      $$typeof?: symbol;
      type?: unknown;
      render?: (props: Props, ref: unknown) => ReactNode;
    };
    if (exotic.$$typeof === MEMO) return renderFunction(exotic.type);
    if (exotic.$$typeof === FORWARD_REF && exotic.render) {
      const render = exotic.render;
      return (props) => render(props, props.ref ?? null);
    }
  }
  return null;
}

interface BoundaryProps {
  slot: Slot;
  wrap: Entry<Wrap>;
  /** What the wrap made, and what it was given to draw (its `Original`). */
  render: ElementType;
  fallback: ComponentType<Props>;
  props: Props;
}

/**
 * A patch that throws while rendering must not take the app down with it: the patch is
 * dropped (its plugin is told) and what it wrapped draws in its place. One boundary per
 * patch, so the one that threw is the one dropped.
 */
class PatchBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    const { slot, wrap } = this.props;
    const index = slot.wraps.indexOf(wrap);
    if (index === -1) return;
    slot.wraps.splice(index, 1);
    reportError(wrap.owner, `the patch of ${slot.name}`, error);
    update(slot);
  }

  override render(): ReactNode {
    const { render, fallback, props } = this.props;
    return rawCreateElement((this.state.failed ? fallback : render) as ComponentType<Props>, props);
  }
}

/** What each guarded patch draws, for a patch of the output of the one before it. */
const guarded = new WeakMap<object, ElementType>();

function compose(slot: Slot): ElementType {
  let current: ElementType = slot.type;
  let original = slot.original;
  for (const wrap of slot.wraps) {
    let render: ElementType;
    try {
      render = wrap.value(original);
    } catch (error) {
      reportError(wrap.owner, `the patch of ${slot.name}`, error);
      continue;
    }
    if (render === undefined || render === null) continue;
    const fallback = original;
    const Guarded = (props: Props): ReactNode =>
      rawCreateElement(PatchBoundary, { slot, wrap, render, fallback, props });
    Guarded.displayName = `Patched(${slot.name})`;
    guarded.set(Guarded, render);
    current = Guarded;
    original = Guarded;
  }
  return current;
}

function update(slot: Slot): void {
  slot.snapshot = {
    render: compose(slot),
    changes: [...slot.changes],
    version: slot.snapshot.version + 1,
  };
  for (const listener of slot.listeners) listener();
}

function slotFor(type: ElementType, owner: string): Slot {
  const existing = slots.get(type);
  if (existing) return existing;
  const name = typeName(type);
  const slot: Slot = {
    type,
    name,
    component: null as unknown as ComponentType<Props>,
    original: (props) => rawCreateElement(type as ComponentType<Props>, props),
    wraps: [],
    changes: [],
    snapshot: { render: type, changes: [], version: 0 },
    listeners: new Set(),
  };
  const subscribe = (listener: () => void) => {
    slot.listeners.add(listener);
    return () => slot.listeners.delete(listener);
  };
  const getSnapshot = () => slot.snapshot;
  const ZamiSlot = (props: Props): ReactNode => {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    let next = props;
    for (const change of snapshot.changes) {
      try {
        const changed = change.value(next);
        if (changed !== undefined && changed !== null && typeof changed === "object")
          next = changed;
      } catch (error) {
        reportError(change.owner, `the props patch of ${name}`, error);
      }
    }
    return rawCreateElement(snapshot.render as ComponentType<Props>, next);
  };
  ZamiSlot.displayName = `Zami(${name})`;
  slot.original.displayName = name;
  slot.component = ZamiSlot;
  slots.set(type, slot);
  active = true;
  if (appRendered) onLateSlot?.(owner, name);
  return slot;
}

function removable<T>(list: Entry<T>[], entry: Entry<T>, changed: () => void): () => void {
  return () => {
    const index = list.indexOf(entry);
    if (index === -1) return;
    list.splice(index, 1);
    changed();
  };
}

/** Draws `wrap(Original)` wherever `type` is drawn. Returns what removes the patch. */
export function wrapComponent(type: ElementType, owner: string, wrap: Wrap): () => void {
  const slot = slotFor(type, owner);
  const entry = { id: nextId++, owner, value: wrap };
  slot.wraps.push(entry);
  update(slot);
  return removable(slot.wraps, entry, () => update(slot));
}

/** Changes the props `type` is drawn with. Returns what removes the patch. */
export function changeProps(type: ElementType, owner: string, change: PropsChange): () => void {
  const slot = slotFor(type, owner);
  const entry = { id: nextId++, owner, value: change };
  slot.changes.push(entry);
  update(slot);
  return removable(slot.changes, entry, () => update(slot));
}

/**
 * Changes what `type` returns when it renders. The patch draws in the type's place and
 * calls it inline, so its hooks stay its own.
 */
export function changeOutput(
  type: ElementType,
  owner: string,
  change: (output: ReactNode, props: Props) => ReactNode,
): () => void {
  const name = typeName(type);
  return wrapComponent(type, owner, (Original) => {
    // The output is the type's own, or the earlier patch's: not that of what draws them
    // (the first wrap's `Original`, an earlier patch's boundary).
    const render = renderFunction(
      slots.get(type)?.original === Original ? type : (guarded.get(Original) ?? Original),
    );
    if (render === null)
      throw new Error(`${name} isn't a function component, so its output can't be changed`);
    const Output = (props: Props): ReactNode => {
      const output = render(props);
      try {
        return change(output, props);
      } catch (error) {
        reportError(owner, `the output patch of ${name}`, error);
        return output;
      }
    };
    Output.displayName = `Output(${name})`;
    return Output;
  });
}

/** Sees every element before React does. Returns what removes the interceptor. */
export function addInterceptor(owner: string, interceptor: Interceptor): () => void {
  const entry = { id: nextId++, owner, value: interceptor };
  interceptors.push(entry);
  active = true;
  return removable(interceptors, entry, () => {
    active = slots.size > 0 || interceptors.length > 0;
  });
}

/** Whether `type` has (or had) patches. */
export function isPatched(type: ElementType): boolean {
  return slots.has(type);
}

interface Resolved {
  type: ElementType;
  props: Props | null;
}
// Reused for every element: nothing keeps it past the call that reads it.
const resolved: Resolved = { type: null, props: null };

function resolve(type: ElementType, props: Props | null): Resolved {
  for (let i = 0; i < interceptors.length; i++) {
    const entry = interceptors[i]!;
    try {
      const change = entry.value(type, props ?? {});
      if (change) {
        if (change.type !== undefined) type = change.type;
        if (change.props !== undefined) props = change.props;
      }
    } catch (error) {
      // It would throw for the next thousand elements too.
      interceptors.splice(i--, 1);
      reportError(entry.owner, "the element interceptor (now removed)", error);
    }
  }
  const slot = slots.get(type);
  resolved.type = slot === undefined ? type : slot.component;
  resolved.props = props;
  return resolved;
}

type Jsx = (type: ElementType, props: Props, ...rest: unknown[]) => ReactElement;
type CreateElement = (
  type: ElementType,
  props: Props | null,
  ...children: unknown[]
) => ReactElement;

export interface ElementRuntimes {
  /** The `react` module's exports (the object `React.createElement` is read from). */
  react: { createElement: CreateElement };
  /** `react/jsx-runtime`'s exports. */
  jsxRuntime: { jsx: Jsx; jsxs: Jsx };
  /** `react/jsx-dev-runtime`'s exports, which development bundles call instead. */
  jsxDevRuntime?: { jsxDEV?: Jsx } | null;
}

const hooked = new WeakSet<object>();

function hookJsx(jsx: Jsx): Jsx {
  return function zamiJsx(type, props, ...rest) {
    if (!active) return jsx(type, props, ...rest);
    const { type: nextType, props: nextProps } = resolve(type, props);
    return jsx(nextType, nextProps!, ...rest);
  };
}

/**
 * Routes every element through the hook. Compiled JSX reads `jsx` off the runtime's
 * exports at each call, so replacing the exports' functions reaches code that has
 * already been loaded. Call it before anything renders.
 */
export function installElementHooks({ react, jsxRuntime, jsxDevRuntime }: ElementRuntimes): void {
  if (!hooked.has(jsxRuntime)) {
    hooked.add(jsxRuntime);
    const { jsx, jsxs } = jsxRuntime;
    // Production's `jsx` takes exactly (type, props, key): no rest array per element.
    jsxRuntime.jsx = (type, props, key) => {
      if (!active) return jsx(type, props, key);
      const { type: nextType, props: nextProps } = resolve(type, props);
      return jsx(nextType, nextProps!, key);
    };
    jsxRuntime.jsxs = (type, props, key) => {
      if (!active) return jsxs(type, props, key);
      const { type: nextType, props: nextProps } = resolve(type, props);
      return jsxs(nextType, nextProps!, key);
    };
  }
  if (jsxDevRuntime?.jsxDEV && !hooked.has(jsxDevRuntime)) {
    hooked.add(jsxDevRuntime);
    jsxDevRuntime.jsxDEV = hookJsx(jsxDevRuntime.jsxDEV);
  }
  if (!hooked.has(react)) {
    hooked.add(react);
    const create = react.createElement;
    react.createElement = function zamiCreateElement(type, props, ...children) {
      if (!active) return create(type, props, ...children);
      const { type: nextType, props: nextProps } = resolve(type, props);
      return create(nextType, nextProps, ...children);
    };
  }
}

/** The first element in `tree` (depth first, through `children`) that `match` accepts. */
export function findElement(
  tree: ReactNode,
  match: (element: ReactElement) => boolean,
): ReactElement | null {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = findElement(child as ReactNode, match);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(tree)) return null;
  if (match(tree)) return tree;
  return findElement((tree.props as { children?: ReactNode }).children, match);
}

/**
 * `tree` with every element `change` returns something for replaced by that; an element
 * it returns `undefined` for stays, with its children mapped the same way.
 */
export function mapElements(
  tree: ReactNode,
  change: (element: ReactElement) => ReactNode | undefined,
): ReactNode {
  if (Array.isArray(tree)) {
    let mapped: ReactNode[] | undefined;
    tree.forEach((child, index) => {
      const next = mapElements(child as ReactNode, change);
      if (next !== child) (mapped ??= [...(tree as ReactNode[])])[index] = next;
    });
    return mapped ?? tree;
  }
  if (!isValidElement(tree)) return tree;
  const changed = change(tree);
  if (changed !== undefined) return changed;
  const children = (tree.props as { children?: ReactNode }).children;
  if (children === undefined || children === null) return tree;
  const next = mapElements(children, change);
  if (next === children) return tree;
  // As arguments, so React treats an array of them as the fixed children they were.
  return Array.isArray(next)
    ? cloneElement(tree, undefined, ...(next as ReactNode[]))
    : cloneElement(tree, undefined, next);
}
