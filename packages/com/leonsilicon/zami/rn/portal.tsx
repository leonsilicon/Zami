import { Fragment, useId, useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

// Zam's Portal moves its content to the end of `document.body`, so overlays (dialogs,
// sheets, menus) paint above the whole app. Here the app root renders a <PortalHost />
// last, and each <Portal> renders its children there instead of in place, in the order
// the portals mounted.

const portals = new Map<string, ReactNode>();
const listeners = new Set<() => void>();
let snapshot: Array<[string, ReactNode]> = [];

function update(): void {
  snapshot = [...portals];
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Renders `children` above the whole app, in the root's <PortalHost />. It hands them over
 * in a layout effect, so the host shows them in the same frame (a controlled TextInput
 * in a dialog doesn't lag a render behind).
 */
export function Portal({ children }: { children: ReactNode }): null {
  const id = useId();
  useLayoutEffect(() => {
    portals.set(id, children);
    update();
  }, [id, children]);
  useLayoutEffect(
    () => () => {
      portals.delete(id);
      update();
    },
    [id],
  );
  return null;
}

/** Where <Portal> content renders: put it last in the app's root view. */
export function PortalHost(): ReactNode {
  const entries = useSyncExternalStore(subscribe, () => snapshot);
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {entries.map(([id, children]) => (
        <Fragment key={id}>{children}</Fragment>
      ))}
    </View>
  );
}
