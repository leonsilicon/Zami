// The parity agents inside the Zami app (debug builds on iOS only), chosen by the
// `ZamiParity` launch argument the runner starts the app with:
//
// - "native": the Zami app as usual, plus an agent that measures React Native's host views
//   and drives the views' recipes through their props.
// - "reference": no Zami code at all, but a WebView showing upstream Zam's web build in the
//   safe area, the way Zam runs on a phone; the agent in that build (web.ts) does the rest.
import { requireNativeModule } from "expo";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  DevSettings,
  Dimensions,
  Platform,
  Settings,
  StatusBar,
  TurboModuleRegistry,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { initialWindowMetrics } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import {
  LAUNCH_ARGS,
  type Driver,
  type Dump,
  type Insets,
  type ParityNode,
  type Rect,
  type Target,
  type WebParityConfig,
} from "#protocol";
import {
  byReadingOrder,
  describeTarget,
  intersect,
  normalizeText,
  pick,
  pickOnTop,
  round,
  runAgent,
  sleep,
  waitUntil,
  type Candidate,
} from "#agent";

export type ParityMode = "native" | "reference";

/** The mode the runner launched the app in, if any (debug builds on iOS only). */
export function parityMode(): ParityMode | undefined {
  if (!__DEV__ || Platform.OS !== "ios") return undefined;
  const mode: unknown = Settings.get(LAUNCH_ARGS.mode);
  return mode === "native" || mode === "reference" ? mode : undefined;
}

/** The root to register: `App` as usual, or what the parity mode calls for. */
export function parityRoot(App: ComponentType): ComponentType {
  switch (parityMode()) {
    case "reference": {
      return ParityReference;
    }
    case "native": {
      return function ParityApp() {
        return (
          <ParityNative>
            <App />
          </ParityNative>
        );
      };
    }
    default: {
      return App;
    }
  }
}

function launchArg(name: string): string {
  const value: unknown = Settings.get(name);
  if (typeof value !== "string") throw new Error(`The parity runner didn't pass -${name}`);
  return value;
}

function insets(): Insets {
  const metrics = initialWindowMetrics?.insets;
  return {
    top: metrics?.top ?? 0,
    right: metrics?.right ?? 0,
    bottom: metrics?.bottom ?? 0,
    left: metrics?.left ?? 0,
  };
}

function screenWindow(): { width: number; height: number; scale: number } {
  const { width, height, scale } = Dimensions.get("window");
  return { width, height, scale };
}

// ---------------------------------------------------------------------------------------
// The React tree, through the DevTools hook React Native installs in debug builds.

interface Fiber {
  tag: number;
  type: unknown;
  elementType: unknown;
  memoizedProps: Record<string, unknown> | string | null;
  memoizedState: unknown;
  stateNode: { node?: unknown } | null;
  alternate: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
}

interface FiberRoot {
  current: Fiber;
}

interface DevToolsHook {
  onCommitFiberRoot?: (rendererId: number, root: FiberRoot, ...rest: unknown[]) => void;
}

const HOST_COMPONENT = 5;
const HOST_TEXT = 6;
const OFFSCREEN = 22;

const roots = new Set<FiberRoot>();
let lastCommit = Date.now();

function watchCommits(): void {
  const hook = (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook })
    .__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) throw new Error("No React DevTools hook: the parity agent needs a debug build");
  const original = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = (rendererId, root, ...rest) => {
    roots.add(root);
    lastCommit = Date.now();
    original?.call(hook, rendererId, root, ...rest);
  };
}

interface NativeDOM {
  getBoundingClientRect(node: unknown, includeTransform: boolean): [number, number, number, number];
}

const nativeDOM = TurboModuleRegistry.get<NativeDOM & import("react-native").TurboModule>(
  "NativeDOMCxx",
);

function rectOf(fiber: Fiber): Rect | undefined {
  const node = fiber.stateNode?.node;
  if (node === undefined || !nativeDOM) return undefined;
  const [x, y, width, height] = nativeDOM.getBoundingClientRect(node, true);
  return { x, y, width, height };
}

function propsOf(fiber: Fiber): Record<string, unknown> {
  return typeof fiber.memoizedProps === "object" && fiber.memoizedProps !== null
    ? fiber.memoizedProps
    : {};
}

function flatStyle(fiber: Fiber): Record<string, unknown> {
  const flatten = (style: unknown): Record<string, unknown> => {
    if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
    return typeof style === "object" && style !== null ? (style as Record<string, unknown>) : {};
  };
  return flatten(propsOf(fiber).style);
}

function hostType(fiber: Fiber): string {
  return typeof fiber.type === "string" ? fiber.type : "";
}

function componentName(fiber: Fiber): string | undefined {
  const type = fiber.type as { displayName?: string; name?: string; render?: { name?: string } };
  if (typeof type === "function" || (typeof type === "object" && type !== null)) {
    return type.displayName ?? type.name ?? type.render?.name;
  }
  return undefined;
}

function textOf(fiber: Fiber): string {
  let text = "";
  const visit = (current: Fiber | null): void => {
    for (let child = current; child; child = child.sibling) {
      if (child.tag === HOST_TEXT && typeof child.memoizedProps === "string") {
        text += child.memoizedProps;
      } else {
        visit(child.child);
      }
    }
  };
  visit(fiber.child);
  return normalizeText(text);
}

function colorString(color: unknown): string | undefined {
  if (typeof color === "string") return color;
  // Processed colors are ARGB integers.
  if (typeof color === "number") {
    const argb = color >>> 0;
    const alpha = ((argb >>> 24) & 255) / 255;
    return `rgba(${(argb >>> 16) & 255}, ${(argb >>> 8) & 255}, ${argb & 255}, ${Math.round(alpha * 1000) / 1000})`;
  }
  return undefined;
}

function weightOf(weight: unknown): number {
  if (weight === "bold") return 700;
  if (weight === undefined || weight === "normal") return 400;
  return Number(weight);
}

/** A side's padding plus border, from a flattened style. */
function edge(style: Record<string, unknown>, side: "Top" | "Right" | "Bottom" | "Left"): number {
  const first = (...keys: string[]): number => {
    for (const key of keys) if (typeof style[key] === "number") return style[key];
    return 0;
  };
  const axis = side === "Top" || side === "Bottom" ? "Vertical" : "Horizontal";
  const logical = side === "Left" ? ["paddingStart"] : side === "Right" ? ["paddingEnd"] : [];
  return (
    first(`padding${side}`, ...logical, `padding${axis}`, "padding") +
    first(`border${side}Width`, "borderWidth")
  );
}

/** The box inside a view's padding and border, where its text sits. */
function contentOf(rect: Rect, style: Record<string, unknown>): Rect {
  const left = edge(style, "Left");
  const top = edge(style, "Top");
  return {
    x: rect.x + left,
    y: rect.y + top,
    width: Math.max(0, rect.width - left - edge(style, "Right")),
    height: Math.max(0, rect.height - top - edge(style, "Bottom")),
  };
}

function alignOf(style: Record<string, unknown>): ParityNode["align"] {
  switch (style.textAlign) {
    case "center": {
      return "center";
    }
    case "right": {
      return "right";
    }
    default: {
      return "left";
    }
  }
}

interface Walk {
  candidates: Candidate<Fiber>[];
  /** Nested texts (a link in a sentence), which recipes can press but dumps leave out. */
  runs: Candidate<Fiber>[];
  components: Set<string>;
}

const PRESS_PROPS = ["onPress", "onClick"] as const;

function walk(): Walk {
  const result: Walk = { candidates: [], runs: [], components: new Set() };
  const screen = { x: 0, y: 0, ...Dimensions.get("window") };

  const visit = (fiber: Fiber | null, clip: Rect | undefined, opacity: number): void => {
    for (let current = fiber; current; current = current.sibling) {
      // A hidden Suspense or Activity subtree stays mounted but isn't shown.
      if (current.tag === OFFSCREEN && current.memoizedState !== null) continue;
      const name = componentName(current);
      if (name !== undefined) result.components.add(name);

      let childClip = clip;
      let childOpacity = opacity;
      if (current.tag === HOST_COMPONENT) {
        const props = propsOf(current);
        const style = flatStyle(current);
        if (style.display === "none") continue;
        childOpacity *= typeof style.opacity === "number" ? style.opacity : 1;
        const type = hostType(current);
        const rect = rectOf(current);
        const visible = rect && clip && intersect(rect, clip);
        if (visible && childOpacity >= 0.01) {
          const label = props.accessibilityLabel ?? props["aria-label"];
          // A text, or an empty text field's placeholder (which Zam measures as text too).
          const placeholder =
            type.includes("TextInput") &&
            typeof props.placeholder === "string" &&
            (props.value ?? props.defaultValue ?? "") === ""
              ? props.placeholder
              : "";
          const content =
            type === "RCTText" || type === "RCTParagraph" ? textOf(current) : placeholder;
          if (content !== "" && rect) {
            const fontSize = typeof style.fontSize === "number" ? style.fontSize : 14;
            const lineHeight =
              typeof style.lineHeight === "number" ? style.lineHeight : fontSize * 1.2;
            const inner = contentOf(rect, style);
            const shown = clip && intersect(inner, clip);
            if (shown) {
              result.candidates.push({
                handle: current,
                node: {
                  kind: "text",
                  key: `text:${normalizeText(content)}`,
                  rect: round(shown),
                  align: alignOf(style),
                  lines: Math.max(1, Math.round(inner.height / lineHeight)),
                  color: colorString(
                    content === placeholder ? props.placeholderTextColor : style.color,
                  ),
                  fontSize,
                  fontWeight: weightOf(style.fontWeight),
                },
              });
            }
          }
          if (typeof label === "string" && label !== "") {
            result.candidates.push({
              handle: current,
              node: { kind: "control", key: `label:${label}`, rect: round(visible) },
            });
          } else if (
            type.includes("TextInput") &&
            typeof props.placeholder === "string" &&
            props.placeholder !== ""
          ) {
            result.candidates.push({
              handle: current,
              node: {
                kind: "input",
                key: `placeholder:${props.placeholder}`,
                rect: round(visible),
              },
            });
          }
        }
        // Scroll views and `overflow: hidden` clip what's inside them.
        if (rect && (type === "RCTScrollView" || style.overflow === "hidden")) {
          childClip = childClip && intersect(childClip, rect);
        }
        // Text's own runs are part of its candidate; a recipe can still press one.
        if (type === "RCTText" || type === "RCTParagraph") {
          if (visible) addRuns(current.child, visible, result.runs);
          continue;
        }
      }
      if (childClip) visit(current.child, childClip, childOpacity);
    }
  };
  for (const root of roots) visit(root.current, screen, 1);
  return result;
}

function addRuns(fiber: Fiber | null, rect: Rect, runs: Candidate<Fiber>[]): void {
  for (let current = fiber; current; current = current.sibling) {
    if (current.tag === HOST_COMPONENT && hostType(current) === "RCTVirtualText") {
      const content = textOf(current);
      if (content !== "") {
        runs.push({ handle: current, node: { kind: "text", key: `text:${content}`, rect } });
      }
    }
    addRuns(current.child, rect, runs);
  }
}

function targets(): Candidate<Fiber>[] {
  const { candidates, runs } = walk();
  return [...candidates, ...runs];
}

/** The target, once it's on screen (a drawer may still be sliding in): 5 s at most. */
async function locate(target: Target): Promise<Fiber> {
  await waitUntil(
    () => pick(targets(), target) !== undefined,
    5000,
    `Zami to show ${describeTarget(target)}`,
  );
  const found = await pickOnTop(targets(), target, ({ handle, node }) =>
    isOnTop(handle, node.rect),
  );
  if (!found) throw new Error(`Zami shows no ${describeTarget(target)}`);
  return found.handle;
}

interface FabricUIManager {
  findNodeAtPoint(
    node: unknown,
    x: number,
    y: number,
    callback: (handle: Fiber | null | undefined) => void,
  ): void;
}

function firstHost(fiber: Fiber | null): Fiber | undefined {
  for (let current = fiber; current; current = current.sibling) {
    if (current.tag === HOST_COMPONENT) return current;
    const found = firstHost(current.child);
    if (found) return found;
  }
  return undefined;
}

function related(a: Fiber, b: Fiber): boolean {
  const same = (x: Fiber, y: Fiber): boolean => x === y || x.alternate === y;
  for (let current: Fiber | null = a; current; current = current.return) {
    if (same(current, b)) return true;
  }
  for (let current: Fiber | null = b; current; current = current.return) {
    if (same(current, a)) return true;
  }
  return false;
}

/** The fiber a press on `fiber` goes to: the nearest one with a press handler. */
function pressableOf(fiber: Fiber): Fiber | undefined {
  for (let current: Fiber | null = fiber; current; current = current.return) {
    const props = propsOf(current);
    if (["onPress", "onLongPress", "onClick"].some((name) => typeof props[name] === "function")) {
      return current;
    }
  }
  return undefined;
}

/** Host views between `fiber` and the nearest ancestor it shares with `other`. */
function hostsToCommonAncestor(fiber: Fiber, other: Fiber): number {
  const ancestors = new Set<Fiber>();
  for (let current: Fiber | null = other; current; current = current.return) {
    ancestors.add(current);
    if (current.alternate) ancestors.add(current.alternate);
  }
  let hosts = 0;
  for (let current = fiber.return; current; current = current.return) {
    if (ancestors.has(current)) return hosts;
    if (current.tag === HOST_COMPONENT) hosts++;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Whether a tap at the middle of `rect` would reach `fiber` (Fabric's own hit test): the
 * hit is `fiber`, inside it, around it, goes to the same pressable (a row's overlay), or
 * is part of the same small widget (a text field over its placeholder). Something from
 * elsewhere in the tree on top (a page, a sheet, the drawer) covers it.
 */
async function isOnTop(fiber: Fiber, rect: Rect): Promise<boolean> {
  const fabric = (globalThis as { nativeFabricUIManager?: FabricUIManager }).nativeFabricUIManager;
  if (!fabric) return true;
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  for (const root of roots) {
    const host = firstHost(root.current.child);
    if (host?.stateNode?.node === undefined) continue;
    const hit = await new Promise<Fiber | null | undefined>((resolve) => {
      fabric.findNodeAtPoint(host.stateNode?.node, x, y, resolve);
    });
    if (!hit) continue;
    if (related(hit, fiber)) return true;
    const pressable = pressableOf(fiber);
    const hitPressable = pressableOf(hit);
    if (pressable && hitPressable && related(pressable, hitPressable)) return true;
    if (hostsToCommonAncestor(fiber, hit) <= 2) return true;
  }
  return false;
}

/** The nearest fiber at or above `fiber` with one of `props`, and that prop's function. */
function handlerAbove(
  fiber: Fiber,
  props: readonly string[],
): ((...args: unknown[]) => unknown) | undefined {
  for (let current: Fiber | null = fiber; current; current = current.return) {
    const ownProps = propsOf(current);
    for (const prop of props) {
      const handler = ownProps[prop];
      if (typeof handler === "function") return handler as (...args: unknown[]) => unknown;
    }
  }
  return undefined;
}

function pressEvent(): object {
  return {
    nativeEvent: { locationX: 0, locationY: 0, pageX: 0, pageY: 0, timestamp: Date.now() },
    preventDefault() {},
    stopPropagation() {},
    persist() {},
  };
}

const driver: Driver = {
  side: "zami",
  async press(target) {
    const handler = handlerAbove(await locate(target), PRESS_PROPS);
    if (!handler) throw new Error(`Zami's ${describeTarget(target)} can't be pressed`);
    await handler(pressEvent());
    await sleep(50);
  },
  async longPress(target) {
    const handler = handlerAbove(await locate(target), ["onLongPress"]);
    if (!handler) throw new Error(`Zami's ${describeTarget(target)} has no long press`);
    await handler(pressEvent());
    await sleep(50);
  },
  async fill(target, value) {
    const fiber = await locate(target);
    const onChangeText = handlerAbove(fiber, ["onChangeText"]);
    const onChange = handlerAbove(fiber, ["onChange"]);
    if (!onChangeText && !onChange) {
      throw new Error(`Zami's ${describeTarget(target)} isn't a text field`);
    }
    onChangeText?.(value);
    onChange?.({ nativeEvent: { text: value } });
    await sleep(50);
  },
  async waitFor(target, timeoutMs = 10_000) {
    await waitUntil(
      () => pick(targets(), target) !== undefined,
      timeoutMs,
      `Zami to show ${describeTarget(target)}`,
    );
  },
  exists(target) {
    return pick(targets(), target) !== undefined;
  },
  sleep,
};

async function settle(quietMs: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() - lastCommit < quietMs && Date.now() < deadline) await sleep(50);
}

/** What's on screen and not covered by something else (an open page, a sheet). */
async function dump(): Promise<Dump> {
  const { candidates, components } = walk();
  const shown: ParityNode[] = [];
  for (const { handle, node } of candidates) {
    if (await isOnTop(handle, node.rect)) shown.push(node);
  }
  return { nodes: byReadingOrder(shown), components: [...components].sort() };
}

/** The Zami app with the agent running beside it. */
export function ParityNative({ children }: { children: ReactNode }): ReactNode {
  useEffect(() => {
    const { width, height } = Dimensions.get("window");
    runAgent(launchArg(LAUNCH_ARGS.runner), {
      side: "zami",
      window: screenWindow,
      frame: () => ({ x: 0, y: 0, width, height }),
      insets,
      notes,
      driver,
      dump,
      settle,
      reload: () => DevSettings.reload("parity"),
    });
  }, []);
  return children;
}

/** Upstream Zam's web build, in the safe area as a phone browser lays it out. */
export function ParityReference(): ReactNode {
  const { width, height, scale } = screenWindow();
  const safe = insets();
  const frame: Rect = {
    x: safe.left,
    y: safe.top,
    width: width - safe.left - safe.right,
    height: height - safe.top - safe.bottom,
  };
  const [background, setBackground] = useState("#313338");
  const config: WebParityConfig = {
    runner: launchArg(LAUNCH_ARGS.runner),
    frame,
    insets: safe,
    scale,
  };
  const webStyle: StyleProp<ViewStyle> = {
    position: "absolute",
    left: frame.x,
    top: frame.y,
    width: frame.width,
    height: frame.height,
    backgroundColor: "transparent",
  };
  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      <StatusBar barStyle="light-content" />
      <WebView
        source={{ uri: launchArg(LAUNCH_ARGS.referenceUrl) }}
        style={webStyle}
        containerStyle={webStyle}
        injectedJavaScriptBeforeContentLoaded={`window.__ZAMI_PARITY__ = ${JSON.stringify(config)}; true;`}
        onMessage={(event) => {
          const message = JSON.parse(event.nativeEvent.data) as { background?: string };
          if (message.background !== undefined) setBackground(message.background);
        }}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        scrollEnabled={false}
        bounces={false}
        keyboardDisplayRequiresUserAction={false}
        // The runner grants the app the microphone, so Zam's audio settings list devices
        // as Zami's do, without WebKit's own prompt.
        mediaCapturePermissionGrantType="grant"
        hideKeyboardAccessoryView
        allowsInlineMediaPlayback
        webviewDebuggingEnabled
        originWhitelist={["*"]}
        cacheEnabled={false}
      />
    </View>
  );
}

/** What the agent noticed while starting, for the runner's log. */
const notes: string[] = [];

/**
 * No OS permission prompts in a parity run: Zam in a WebView can't raise one (it has no
 * Notification), and an alert over the app spoils its screenshots. iOS simulators have no
 * way to answer one ahead of time for notifications, so asking only reads the answer.
 */
function suppressPermissionPrompts(): void {
  try {
    const permissions = requireNativeModule<{
      getPermissionsAsync(): Promise<unknown>;
      requestPermissionsAsync(request: unknown): Promise<unknown>;
    }>("ExpoNotificationPermissionsModule");
    const read = (): Promise<unknown> => permissions.getPermissionsAsync();
    permissions.requestPermissionsAsync = read;
    if (permissions.requestPermissionsAsync !== read) {
      notes.push("Couldn't stop notification permission prompts");
    }
  } catch (error) {
    notes.push(`Couldn't stop notification permission prompts: ${String(error)}`);
  }
}

if (parityMode() !== undefined) suppressPermissionPrompts();
if (parityMode() === "native") watchCommits();
