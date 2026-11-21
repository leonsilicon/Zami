// The types of around.svelte: a Svelte 5 component, which is a function of an anchor node
// and its props.
type Render = (el: HTMLElement, props: Record<string, unknown>) => void | (() => void);
declare const Around: (
  anchor: Node,
  props: {
    Original: unknown;
    before: Render | undefined;
    after: Render | undefined;
    props: Record<string, unknown>;
  },
) => void;
export default Around;
