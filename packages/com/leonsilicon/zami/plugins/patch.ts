// `zam.zami.patch`: hooks on any function, a method of an object (a store's state, the
// Matrix client) or a top-level function of one of Zam's modules (what `require` returned for
// it; the patch replaces the module's own name, so it applies to the module's own calls too).
import { addLayer, originalValue, type Disposable } from "#layers";

type AnyFunction = (this: unknown, ...args: unknown[]) => unknown;

function functionAt(target: object, method: string): AnyFunction {
  const value = originalValue(target, method);
  if (typeof value !== "function") throw new Error(`"${method}" isn't a function to patch`);
  return value as AnyFunction;
}

export interface Patcher {
  /** Runs `hook` first: return an array to call the function with those arguments. */
  before(
    target: object,
    method: string,
    hook: (args: unknown[], self: unknown) => unknown[] | void,
  ): Disposable;
  /** Runs `hook` after: return something other than `undefined` to return that instead. */
  after(
    target: object,
    method: string,
    hook: (result: unknown, args: unknown[], self: unknown) => unknown,
  ): Disposable;
  /** Runs `hook` in the function's place; `original(...args)` calls what it replaced. */
  instead(
    target: object,
    method: string,
    hook: (args: unknown[], original: (...args: unknown[]) => unknown, self: unknown) => unknown,
  ): Disposable;
}

/** The patcher for one plugin: a hook that throws is reported and skipped. */
export function createPatcher(report: (error: unknown) => void): Patcher {
  return {
    before(target, method, hook) {
      functionAt(target, method);
      return addLayer(
        target,
        method,
        (below) =>
          function (this: unknown, ...args: unknown[]) {
            let next = args;
            try {
              const changed = hook(args, this);
              if (Array.isArray(changed)) next = changed;
            } catch (error) {
              report(error);
            }
            return (below as AnyFunction).apply(this, next);
          },
      );
    },
    after(target, method, hook) {
      functionAt(target, method);
      return addLayer(
        target,
        method,
        (below) =>
          function (this: unknown, ...args: unknown[]) {
            const result = (below as AnyFunction).apply(this, args);
            try {
              const changed = hook(result, args, this);
              return changed === undefined ? result : changed;
            } catch (error) {
              report(error);
              return result;
            }
          },
      );
    },
    instead(target, method, hook) {
      functionAt(target, method);
      return addLayer(
        target,
        method,
        (below) =>
          function (this: unknown, ...args: unknown[]) {
            return hook(args, (...callArgs) => (below as AnyFunction).apply(this, callArgs), this);
          },
      );
    },
  };
}
