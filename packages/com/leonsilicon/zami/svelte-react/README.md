# @-/com.leonsilicon.zami.svelte-react

`useRune(read, deps?)` lets a React component read Svelte 5 runes, such as Zam's
`.svelte.ts` stores, and re-render when any of them change:

```tsx
const toasts = useRune(() => toastsState.toasts);
```

A primitive result re-renders only when it changes. An object result re-renders whenever
something `read` touched changes, because the same `$state` proxy, SDK array or `Room` can
hold new contents. When that isn't so, say how to compare, and React skips the render:

```tsx
// Replaced on edit or decryption, never mutated in place.
const content = useRune(() => event.getContent(), [event], { isEqual: sameObject });
// Rebuilt on every run from primitives and stable references.
const row = useRune(() => ({ name: room.name, unread: unreadCount(room) }), [room], {
  isEqual: shallowEqual,
});
```

The effect that watches is created when React subscribes, never during a render: a Svelte
effect created while another one runs is attached to it, and a render can run inside one.

`<PauseRunes paused={hidden}>` stops every `useRune` below it from watching while `hidden`
(the closed drawer): they keep what they last rendered, and read again when it turns false.
