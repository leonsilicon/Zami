// Components plugins draw over the whole app (`zam.zami.ui.addLayer`): the app's root
// renders `PluginLayers` last, above its own overlays.
import { Component, useSyncExternalStore } from "react";
import type { ComponentType, ReactNode } from "react";
import { StyleSheet, View } from "react-native";

interface Layer {
  id: number;
  owner: string;
  Component: ComponentType;
}

let layers: readonly Layer[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function set(next: readonly Layer[]): void {
  layers = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => layers;

let reportError = (owner: string, error: unknown): void => {
  console.error(`[plugin ${owner}] its layer threw`, error);
};

/** Where a layer's render errors go. */
export function setLayerErrorReporter(report: typeof reportError): void {
  reportError = report;
}

/** Draws `Component` over the app. Returns what removes it. */
export function addLayer(owner: string, Component: ComponentType): () => void {
  const layer = { id: nextId++, owner, Component };
  set([...layers, layer]);
  return () => {
    if (layers.includes(layer)) set(layers.filter((other) => other !== layer));
  };
}

/** A layer that throws is removed; the app and the other layers go on. */
class LayerBoundary extends Component<{ layer: Layer; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    const { layer } = this.props;
    reportError(layer.owner, error);
    set(layers.filter((other) => other !== layer));
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Every plugin's layers, each filling the window and passing touches through its gaps. */
export function PluginLayers(): ReactNode {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return current.map((layer) => (
    <View key={layer.id} style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <LayerBoundary layer={layer}>
        <layer.Component />
      </LayerBoundary>
    </View>
  ));
}
