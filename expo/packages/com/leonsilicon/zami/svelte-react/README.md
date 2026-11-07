# @-/com.leonsilicon.zami.svelte-react

`useRune(read, deps?)` lets a React component read Svelte 5 runes, such as Zam's
`.svelte.ts` stores, and re-render when any of them change:

```tsx
const toasts = useRune(() => toastsState.toasts);
```
