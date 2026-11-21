# @-/com.leonsilicon.zami.configs.patches.codemods.zam.sliding-sync-off-at-sign-in

A codemod for upstream Zam's `src/lib/components/layout/LoginView.svelte`, applied when its
web app is built. Zam's sign-in form turns sliding sync on by default; sliding sync breaks
signing in to Beeper, so in the Zami app it starts off. The form's advanced options and
Debug settings still turn it on.

The component is parsed as HTML, so the edit is in the text of its `<script>`.
