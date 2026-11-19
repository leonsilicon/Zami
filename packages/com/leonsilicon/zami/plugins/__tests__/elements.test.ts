import { createRequire } from "node:module";
import { describe, expect, it } from "vite-plus/test";
import {
  addInterceptor,
  changeOutput,
  changeProps,
  findElement,
  installElementHooks,
  isPatched,
  mapElements,
  nameType,
  renderFunction,
  typeName,
  wrapComponent,
  type ElementRuntimes,
} from "#elements";

// The CommonJS exports objects, as Metro's modules see them: an ES namespace is read-only.
const require = createRequire(import.meta.url);
const react = require("react") as ElementRuntimes["react"] & typeof import("react");
const jsxRuntime = require("react/jsx-runtime") as ElementRuntimes["jsxRuntime"];

const rawJsx = jsxRuntime.jsx;
installElementHooks({ react, jsxRuntime });

type Props = Record<string, unknown>;
const typeOf = (element: unknown) => (element as { type: unknown }).type;
const propsOf = (element: unknown) => (element as { props: Props }).props;

describe("the element hook", () => {
  it("wraps the runtimes once", () => {
    const hooked = jsxRuntime.jsx;
    expect(hooked).not.toBe(rawJsx);
    installElementHooks({ react, jsxRuntime });
    expect(jsxRuntime.jsx).toBe(hooked);
  });

  it("leaves an unpatched type alone", () => {
    const Plain = () => null;
    expect(typeOf(jsxRuntime.jsx(Plain, { a: 1 }))).toBe(Plain);
    expect(typeOf(react.createElement(Plain, { a: 1 }))).toBe(Plain);
    expect(isPatched(Plain)).toBe(false);
  });

  it("creates a patched type's elements with its slot, and keeps doing so", () => {
    const Target = () => null;
    const undo = wrapComponent(Target, "p", (Original) => Original);
    const slot = typeOf(jsxRuntime.jsx(Target, {}));
    expect(slot).not.toBe(Target);
    expect(typeName(slot)).toBe("Zami(Target)");
    expect(typeOf(jsxRuntime.jsxs(Target, {}))).toBe(slot);
    expect(typeOf(react.createElement(Target, null))).toBe(slot);
    // The slot outlives the patch: the element's type never changes back under React.
    undo();
    expect(typeOf(jsxRuntime.jsx(Target, {}))).toBe(slot);
    expect(isPatched(Target)).toBe(true);
  });

  it("keeps the key and props of a patched element", () => {
    const Target = () => null;
    changeProps(Target, "p", (props) => ({ ...props, added: true }));
    const element = jsxRuntime.jsx(Target, { a: 1 }, "k") as unknown as { key: string };
    expect(element.key).toBe("k");
    // The slot changes the props when it renders, not the element's own.
    expect(propsOf(element)).toEqual({ a: 1 });
  });

  it("lets an interceptor change the type and props, and removes one that throws", () => {
    const From = () => null;
    const To = () => null;
    const undo = addInterceptor("p", (type, props) =>
      type === From ? { type: To, props: { ...props, seen: true } } : undefined,
    );
    const element = jsxRuntime.jsx(From, { a: 1 });
    expect(typeOf(element)).toBe(To);
    expect(propsOf(element)).toEqual({ a: 1, seen: true });
    undo();
    expect(typeOf(jsxRuntime.jsx(From, {}))).toBe(From);

    let calls = 0;
    addInterceptor("p", () => {
      calls++;
      throw new Error("boom");
    });
    expect(typeOf(jsxRuntime.jsx(From, {}))).toBe(From);
    expect(typeOf(jsxRuntime.jsx(From, {}))).toBe(From);
    expect(calls).toBe(1);
  });
});

describe("renderFunction", () => {
  it("finds the function behind memo and forwardRef, and none for a class", () => {
    const Plain = (props: Props) => String(props.text);
    expect(renderFunction(Plain)).toBe(Plain);
    expect(renderFunction(react.memo(Plain))).toBe(Plain);
    const Forwarded = react.forwardRef<unknown, Props>(
      (props, ref) => `${String(props.text)}:${typeof ref}`,
    );
    expect(renderFunction(Forwarded)?.({ text: "a", ref: "r" })).toBe("a:string");
    class Classy extends react.Component {
      override render() {
        return null;
      }
    }
    expect(renderFunction(Classy)).toBeNull();
    expect(renderFunction("RCTView")).toBeNull();
  });
});

describe("changeOutput", () => {
  it("refuses a component whose output can't be read", () => {
    class Classy extends react.Component {
      override render() {
        return null;
      }
    }
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(String(args[0]));
    try {
      changeOutput(Classy, "p", (output) => output);
    } finally {
      console.error = original;
    }
    expect(errors.join("\n")).toContain("the patch of Classy");
  });
});

describe("the tree helpers", () => {
  const h = react.createElement;
  const tree = h("a", null, h("b", { id: 1 }), [h("c", { key: "x", id: 2 }), "text"], null);

  it("finds the first match, depth first", () => {
    expect(findElement(tree, (element) => element.type === "c")?.props).toEqual({ id: 2 });
    expect(findElement(tree, (element) => element.type === "z")).toBeNull();
    expect(findElement("text", () => true)).toBeNull();
  });

  it("maps matches and keeps what didn't change", () => {
    const replaced = h("d", null);
    const mapped = mapElements(tree, (element) => (element.type === "c" ? replaced : undefined));
    expect(findElement(mapped, (element) => element.type === "d")).toBe(replaced);
    expect(findElement(mapped, (element) => element.type === "c")).toBeNull();
    expect(findElement(mapped, (element) => element.type === "b")?.props).toEqual({ id: 1 });
    expect(mapElements(tree, () => undefined)).toBe(tree);
  });
});

describe("typeName", () => {
  it("prefers the name a type was asked for by", () => {
    const a = () => null;
    expect(typeName(a)).toBe("a");
    nameType(a, "RoomList");
    expect(typeName(a)).toBe("RoomList");
    expect(typeName(react.memo(a))).toBe("RoomList");
    expect(typeName("RCTView")).toBe("RCTView");
  });
});
