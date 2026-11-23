<!--
  Show a spinner while the session opens. Let Zam display its message when the
  session is already open in another tab.
-->
<script>
    let { Original, label, props } = $props();
</script>

{#if props.message != null}
    <Original {...props} />
{:else}
    <div
        data-zami-launch-splash
        style="display: flex; align-items: center; justify-content: center; min-height: 100vh; min-height: 100dvh; background: var(--zam-bg-tertiary); color: var(--zam-text-muted);"
    >
        <div
            class="animate-spin"
            role="status"
            aria-label={label}
            style="width: 1.25rem; height: 1.25rem; border: 2px solid currentColor; border-top-color: transparent; border-radius: 9999px;"
        ></div>
    </div>
{/if}
