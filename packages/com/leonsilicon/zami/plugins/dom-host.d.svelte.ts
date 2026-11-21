// The types of dom-host.svelte: a Svelte 5 component, which is a function of an anchor
// node and its props.
declare const DomHost: (
  anchor: Node,
  props: {
    render: (el: HTMLElement, props: Record<string, unknown>) => void | (() => void);
    props: Record<string, unknown>;
  },
) => void;
export default DomHost;
