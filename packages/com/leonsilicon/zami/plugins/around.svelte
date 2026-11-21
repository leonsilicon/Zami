<!--
  One of Zam's components with a plugin's DOM drawn before and after it: what
  `zam.zami.components.around` puts in its place.
-->
<script>
    import DomHost from "#dom-host";

    let { Original, before, after, props } = $props();
</script>

{#if before}<DomHost render={before} {props} />{/if}
<Original {...props} />
{#if after}<DomHost render={after} {props} />{/if}
