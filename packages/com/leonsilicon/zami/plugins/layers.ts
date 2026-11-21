// Patches of one value (a method of an object, or a top-level name of one of Zam's modules),
// stacked: each layer wraps what's below it, in the order they were added. Removing a layer
// rebuilds the stack from the original, so several plugins' patches of one function compose
// and come off in any order.
import { moduleIdOf, readName, writeName } from "#registry";

export interface Disposable {
  dispose(): void;
}

type Wrap = (below: unknown) => unknown;

interface Stack {
  original: unknown;
  layers: { wrap: Wrap }[];
  write(value: unknown): void;
  /** For an object's method that was inherited, not its own: take ours off again. */
  restore(): void;
}

const moduleStacks = new Map<string, Stack>();
const objectStacks = new WeakMap<object, Map<string, Stack>>();

function stackFor(target: object, name: string): Stack {
  const id = moduleIdOf(target);
  if (id !== undefined) {
    const key = `${id}\0${name}`;
    let stack = moduleStacks.get(key);
    if (!stack) {
      const original = readName(id, name);
      stack = {
        original,
        layers: [],
        write: (value) => writeName(id, name, value),
        restore: () => writeName(id, name, original),
      };
      moduleStacks.set(key, stack);
    }
    return stack;
  }
  let byName = objectStacks.get(target);
  if (!byName) objectStacks.set(target, (byName = new Map()));
  let stack = byName.get(name);
  if (!stack) {
    const record = target as Record<string, unknown>;
    const own = Object.prototype.hasOwnProperty.call(target, name);
    const original = record[name];
    stack = {
      original,
      layers: [],
      write: (value) => {
        record[name] = value;
      },
      restore: () => {
        if (own) record[name] = original;
        else delete record[name];
      },
    };
    byName.set(name, stack);
  }
  return stack;
}

function apply(stack: Stack): void {
  if (stack.layers.length === 0) {
    stack.restore();
    return;
  }
  let value = stack.original;
  for (const layer of stack.layers) value = layer.wrap(value);
  stack.write(value);
}

/** Puts `wrap` on top of the value at `target[name]` until the handle is disposed. */
export function addLayer(target: object, name: string, wrap: Wrap): Disposable {
  const stack = stackFor(target, name);
  const layer = { wrap };
  stack.layers.push(layer);
  apply(stack);
  return {
    dispose() {
      const index = stack.layers.indexOf(layer);
      if (index < 0) return;
      stack.layers.splice(index, 1);
      apply(stack);
    },
  };
}

/** The value at `target[name]` without any layer (what was there before the first patch). */
export function originalValue(target: object, name: string): unknown {
  const id = moduleIdOf(target);
  const stack =
    id !== undefined ? moduleStacks.get(`${id}\0${name}`) : objectStacks.get(target)?.get(name);
  if (stack) return stack.original;
  return id !== undefined ? readName(id, name) : (target as Record<string, unknown>)[name];
}
