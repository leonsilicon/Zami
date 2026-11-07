# @-/com.leonsilicon.zami.rn

React Native building blocks that Zami's translated components share in place of web
features Zam relies on.

- `Portal` / `PortalHost`: Zam's `Portal` moves its content to the end of
  `document.body`. Here the app root renders `<PortalHost />` last, and each `<Portal>`
  renders its children there. Portal content doesn't see React context from where the
  `<Portal>` is, so read stores (`useRune`) rather than context inside it.
- `Html`: renders what Zam puts in `{@html …}` (message `formatted_body`, Zam's own
  generated HTML, room topics) as nested `Text`s and `View`s, in Zam's message-body
  look. DOMPurify needs a DOM, so on React Native Zam's `sanitize()` returns its input
  unchanged; `Html` is the allowlist, mirroring `src/lib/utils/sanitizeHtml.zami.ts`
  (`html-tree.ts` parses with htmlparser2, keeps the spec's tags and per-tag attributes,
  drops scripts, styles and `<mx-reply>` with their content, and unwraps the rest).
  - `resolveMxc` resolves `mxc://` image sources (anything else is dropped, so an
    `<img>` that can't load, such as twemoji's, shows its alt text). Pass a stable
    function such as Zam's `mxcToHttp`: the HTML is parsed again when it changes.
  - `className` takes the text classes, applied to every run of text, plus
    `[&_a]:…` classes for links (by default `text-discord-accent`), `emoji-only` (large
    emoji) and `whitespace-pre-wrap` (keep spaces and newlines, as topics do).
  - `onLinkPress` gets each pressed link's `href`; without it, `openLink` opens it.
  - `numberOfLines` flattens the blocks into one clamped `Text`, one line per block.

## Form controls and other web stand-ins

React Native has none of these HTML elements and browser features, so translations use
these, which keep the element's props as close as React Native allows:

- `Select`: `<select>`. `value`, `options` (`{ value, label, key? }`, the `<option>`s),
  `onChange(value)`, `disabled`, `accessibilityLabel`, `nativeID` (its `id`) and
  `className` (the box's classes). It shows the selected label; a press lists the
  options above the app through `Portal`, beneath the box or above it, wherever more
  fit, and a pick or a press outside closes it.
- `Checkbox`: `<label><input type="checkbox"> text</label>`. `checked`,
  `onChange(checked)`, `label` (a string is a `Text` styled by `labelClassName`, by
  default `text-sm text-discord-textPrimary`; any other node renders as it is),
  `accessibilityLabel`, `disabled` and `className` (the `<label>`'s layout classes; it's
  a row, by default `items-center gap-2`). `accessibilityRole="checkbox"`.
- `Range`: `<input type="range">`. `value`, `min`/`max`/`step` (HTML's defaults: 0,
  100, 1), `onChange(value)` (`oninput`), `onChangeEnd(value)` (`onchange`),
  `disabled`, `accessibilityLabel` and `className`. A tap or a sideways drag sets it
  (react-native-gesture-handler; a vertical swipe still scrolls); VoiceOver and
  TalkBack step it by `step`.
- `SvgIcon`: an inline `<svg fill="currentColor"><path d="…" /></svg>`. `d` (or `Path`
  children, for more than one path), `viewBox` (default `0 0 24 24`), `size` and
  `className`: `w-*`/`h-*` size it and its `text-*` color fills it, as `currentColor`
  would (Zam's primary text color without one). Screen readers skip it.
- `pickedFile(asset)`: `<input type="file">` → `expo-image-picker` or
  `expo-document-picker`, then this: the picked asset as the `File` the input gives,
  named, typed and dated like it, whose `arrayBuffer()` works and which keeps the
  asset's `uri`.
- `confirmAlert(message, { confirmText, cancelText, destructive })`: `confirm()` as a
  native alert, resolving true when confirmed. Pass the button texts translated.
- `Spin` / `Pulse`: Tailwind's `animate-spin` and `animate-pulse`, which Uniwind doesn't
  support. Give them the element's other classes (`<Spin className="w-4 h-4 border-2 …
  rounded-full" />`) or wrap what animates (`<Spin><Loader2 size={16} /></Spin>`).
- `anchorElement(view)`: a view's on-screen box as the `HTMLElement` Zam's anchoring helpers
  read (`openProfileCard(userId, el)` only calls `getBoundingClientRect()`).
