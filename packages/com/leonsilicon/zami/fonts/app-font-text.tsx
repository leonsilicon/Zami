// Every Text and TextInput in the app gets the app's font (appFontFamily()) unless it
// chooses its own, as every element inherits the root's `font-family` on the web. React
// Native has no default font to set, and its Text is a plain function, so the JSX runtime
// hands each <Text>/<TextInput> element to a thin wrapper that adds the family. A Text
// nested in another inherits its parent's font, so only outermost ones get it.
//
// The wrapper reads two contexts (the family, which AppFontProvider at the root provides,
// and React Native's own "inside a Text" flag) and renders the element as it was, with
// its props, ref included, passed on; only when a family applies does it add a style.
import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  unstable_TextAncestorContext as TextAncestorContext,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { appFontFamily, subscribeAppFont } from "#app-font";
import { classChoosesFamily } from "#font-class";

type Create = (type: unknown, ...rest: unknown[]) => unknown;
type Runtime = Record<"jsx" | "jsxs" | "jsxDEV", Create | undefined>;

interface FontProps {
  className?: string;
  style?: StyleProp<TextStyle>;
}

const AppFontContext = createContext<string | null>(null);

/**
 * Provides the app's font to every Text and TextInput below it. The app renders it once,
 * around everything (portals included); its text re-renders when the font changes.
 */
export function AppFontProvider({ children }: { children?: ReactNode }): ReactNode {
  const family = useSyncExternalStore(subscribeAppFont, appFontFamily);
  return createElement(AppFontContext, { value: family }, children);
}

function choosesOwnFamily({ className, style }: FontProps): boolean {
  if (classChoosesFamily(className)) return true;
  return style != null && StyleSheet.flatten(style)?.fontFamily != null;
}

function withAppFont(Component: ComponentType<FontProps>, name: string, nestable: boolean) {
  function AppFont(props: FontProps) {
    const family = useContext(AppFontContext);
    const nested = useContext(TextAncestorContext);
    if (family === null || (nestable && nested) || choosesOwnFamily(props)) {
      return createElement(Component, props);
    }
    // Before the element's own style, which its classes join (Uniwind puts them first).
    return createElement(Component, { ...props, style: [{ fontFamily: family }, props.style] });
  }
  AppFont.displayName = name;
  return AppFont;
}

let installed = false;

/**
 * Gives every Text and TextInput below an AppFontProvider the app's font. Call once, at
 * startup, before anything renders.
 */
export function installAppFont(): void {
  if (installed) return;
  installed = true;
  const wrappers = new Map<unknown, unknown>([
    [Text, withAppFont(Text as ComponentType<FontProps>, "Text", true)],
    [TextInput, withAppFont(TextInput as ComponentType<FontProps>, "TextInput", false)],
  ]);
  // The automatic JSX runtime's modules (development and production builds), which
  // compiled code reads a function from at each element.
  const runtimes = [
    require("react/jsx-runtime") as Runtime,
    require("react/jsx-dev-runtime") as Runtime,
  ];
  for (const runtime of runtimes) {
    for (const key of ["jsx", "jsxs", "jsxDEV"] as const) {
      const original = runtime[key];
      if (typeof original !== "function") continue;
      runtime[key] = (type, ...rest) => original(wrappers.get(type) ?? type, ...rest);
    }
  }
}
