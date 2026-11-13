// Components whose code runs the first time they're shown, not when the app starts.
import { createElement, type ComponentType } from "react";

/**
 * A component that loads its module the first time it renders:
 *
 * ```tsx
 * const AppSettings = lazyComponent(
 *   () => require("$lib/components/layout/AppSettings.svelte") as typeof import("$lib/components/layout/AppSettings.svelte"),
 * );
 * ```
 *
 * Metro still bundles the module; what waits is evaluating it and everything it imports,
 * which a static `import` does before the app's first frame. For screens most launches
 * never open (settings, a call, a QR scanner). Unlike `React.lazy` it renders at once,
 * with no Suspense boundary: the module loads synchronously during that first render.
 */
export function lazyComponent<P extends object>(
  load: () => { default: ComponentType<P> },
): ComponentType<P> {
  let component: ComponentType<P> | undefined;
  function Lazy(props: P) {
    component ??= load().default;
    return createElement(component, props);
  }
  return Lazy;
}
