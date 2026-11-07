# @-/com.leonsilicon.zami.keyboard

Hardware keyboard presses for Zami: an Expo module (iOS) that observes the app's key
events and sends each press and release, with its modifiers, as a DOM-style event
(`type`, `key`, `code`, `shiftKey`/`ctrlKey`/`altKey`/`metaKey`, `repeat`). React Native
reports none of that outside a text field, and Zam's shortcuts, keybind recording and
composer keys need it. `@-/com.leonsilicon.zami.browser` turns the events into `keydown` /
`keyup` on Zam's `window` and `document`.

```ts
const stop = addKeyListener((press) => console.log(press.type, press.key, press.code));
```
