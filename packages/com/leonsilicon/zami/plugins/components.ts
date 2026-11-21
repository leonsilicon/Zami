// `zam.zami.components`: Zam's Svelte components, patched where the app draws them. A Svelte
// 5 component is a function of an anchor node and its props, and a component module's
// default export is a live binding, so a patch replaces the module's binding
// (instrument.ts): every parent that draws the component from then on draws the patch. A
// component already on screen keeps what it was drawn with until its parent draws it again,
// which is why a plugin that patches components loads before the app's first render
// (early.ts).
import Around from "#around";
import DomHost from "#dom-host";
import { addLayer, type Disposable } from "#layers";
import { importModule, isLoaded, moduleIds, normalizeId, requireModule } from "#registry";

/** A Svelte 5 component. */
export type Component = (anchor: Node, props: Record<string, unknown>) => unknown;

/** What a plugin draws into a component's element: return a cleanup, if any. */
export type Render = (el: HTMLElement, props: Record<string, unknown>) => void | (() => void);

/** The app's component modules (`$lib/components/layout/RoomList.svelte`, …). */
export function componentIds(): string[] {
  return moduleIds().filter((id) => id.endsWith(".svelte"));
}

function baseName(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1).replace(/\.svelte$/, "");
}

/** The app's components by name (`RoomList`). */
export function componentNames(): string[] {
  return [...new Set(componentIds().map(baseName))].toSorted();
}

/** The module of a component named by name (`"RoomList"`) or by module. */
export function resolveComponent(target: string): string {
  if (target.includes("/")) {
    const id = normalizeId(target);
    return id.endsWith(".svelte") ? id : `${id}.svelte`;
  }
  const matches = componentIds().filter((id) => baseName(id) === target);
  if (matches.length === 0) throw new Error(`Zam has no component ${target}`);
  // Two of the same name: the one under $lib/components.
  return matches.find((id) => id.startsWith("$lib/components/")) ?? matches[0]!;
}

export async function getComponent(target: string): Promise<Component> {
  const module = await importModule(resolveComponent(target));
  return module.default as Component;
}

/**
 * Draws `wrap(Original)` wherever the app draws the component, `Original` being what would
 * have been drawn without this patch. Applied once the component's module has loaded.
 */
export function patchComponent(
  target: string,
  wrap: (Original: Component) => Component,
): Disposable {
  const id = resolveComponent(target);
  let layer: Disposable | null = null;
  let disposed = false;
  const apply = (module: Record<string, unknown>) => {
    if (!disposed) layer = addLayer(module, "default", (below) => wrap(below as Component));
  };
  if (isLoaded(id)) apply(requireModule(id));
  else
    void importModule(id).then(apply, (error: unknown) => {
      console.error(`[zami] couldn't load ${id} to patch it`, error);
    });
  return {
    dispose() {
      disposed = true;
      layer?.dispose();
    },
  };
}

/** `props` with what `change` returns over it, read as the component reads each prop. */
export function changedProps(
  props: Record<string, unknown>,
  change: (props: Record<string, unknown>) => Record<string, unknown> | void,
): Record<string, unknown> {
  const overrides = () => change(props) ?? {};
  return new Proxy(props, {
    get(target, key, receiver) {
      if (typeof key === "string") {
        const changed = overrides();
        if (key in changed) return changed[key];
      }
      return Reflect.get(target, key, receiver);
    },
    has: (target, key) =>
      (typeof key === "string" && key in overrides()) || Reflect.has(target, key),
    ownKeys: (target) => [...new Set([...Reflect.ownKeys(target), ...Object.keys(overrides())])],
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === "string") {
        const changed = overrides();
        if (key in changed) return { configurable: true, enumerable: true, value: changed[key] };
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
}

/** A component that draws what `render` puts in its element. */
export function domComponent(render: Render): Component {
  return (anchor, props) => DomHost(anchor, { render, props });
}

/** `Original` with what `before` and `after` draw on either side of it. */
export function aroundComponent(
  Original: Component,
  sides: { before?: Render; after?: Render },
): Component {
  return (anchor, props) =>
    Around(anchor, { Original, before: sides.before, after: sides.after, props });
}
