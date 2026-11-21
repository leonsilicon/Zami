// The types of launch-splash.svelte: a Svelte 5 component, which is a function of an anchor
// node and its props.
declare const LaunchSplash: (
  anchor: Node,
  props: {
    Original: (anchor: Node, props: Record<string, unknown>) => unknown;
    /** What a screen reader says of the spinner. */
    label: string;
    props: Record<string, unknown>;
  },
) => void;
export default LaunchSplash;
