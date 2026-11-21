<!--
  A component that draws what a plugin's `render(el, props)` puts in `el` (a `display:
  contents` element, so it adds no box), and runs its cleanup when it's taken down or before
  it runs again: it runs again when a prop it read changes.
-->
<script>
    let { render, props } = $props();
    let el;
    $effect(() => {
        const cleanup = render(el, props);
        return () => {
            if (typeof cleanup === "function") cleanup();
        };
    });
</script>

<div bind:this={el} style="display: contents"></div>
