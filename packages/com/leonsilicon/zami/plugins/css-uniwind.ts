/// <reference types="expo/types" />
// Uniwind's store: where a `className` becomes a style. It isn't among the package's
// exports, so Metro resolves the path as a file (and says so in a warning when it
// bundles). Apart from #css-native so the tests can put a store of their own here.

/** What Uniwind's resolver returns for a `className` (its `StylesResult`). */
export interface UniwindStyles {
  styles: Record<string, unknown>;
  dependencies: number[];
  dependencySum: number;
}

/** The parts of the store the stylesheets reach into. */
export interface UniwindStore {
  resolveStyles?: (
    className: string,
    componentProps: unknown,
    state: unknown,
    context: unknown,
  ) => UniwindStyles;
  /** Resolved styles, per theme, by `className` (and the component's state). */
  cache?: Record<string, Map<string, unknown> | undefined>;
}

/** The store, or undefined if this Uniwind keeps none there. */
export function uniwindStore(): UniwindStore | undefined {
  try {
    // oxlint-disable-next-line typescript/no-require-imports -- not in the package's exports
    const module = require("uniwind/src/core/native/store") as { UniwindStore?: UniwindStore };
    return module.UniwindStore;
  } catch {
    return undefined;
  }
}
