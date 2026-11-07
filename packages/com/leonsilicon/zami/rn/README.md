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
  - `onImagePress(src, element, images)` gets each pressed image (an `<img>` that isn't
    a custom emoji or in a spoiler, as Zam's `bodyImageGallery` takes) with every `<img>`
    in the HTML, for paging them in the Lightbox; without it, images take no press.
  - `numberOfLines` flattens the blocks into one clamped `Text`, one line per block.

## Form controls and other web stand-ins

React Native has none of these HTML elements and browser features, so translations use
these, which keep the element's props as close as React Native allows:

- `Select`: `<select>`. `value`, `options` (`{ value, label, key? }`, the `<option>`s),
  `onChange(value)`, `disabled`, `accessibilityLabel`, `nativeID` (its `id`) and
  `className` (the box's classes). It shows the selected label, and like a `<select>`
  it's as wide as its longest option unless its classes size it (it then fills the box,
  or truncates in a narrower one). A press lists the options above the app through
  `Portal`, beneath the box or above it, wherever more fit, at least as wide as the box,
  and a pick or a press outside closes it.
- `Checkbox`: `<label><input type="checkbox"> text</label>`. `checked`,
  `onChange(checked)`, `label` (a string is a `Text` styled by `labelClassName`, by
  default `text-sm text-discord-textPrimary`; any other node renders as it is),
  `accessibilityLabel`, `disabled`, `className` (the `<label>`'s layout classes; it's
  a row, by default `items-center gap-2`) and `inputClassName` (the `<input>`'s size,
  rounding and margins; by default the browser's `w-3.5 h-3.5 rounded-sm`).
  `accessibilityRole="checkbox"`.
- `Radio`: `<label><input type="radio" bind:group {value}> text</label>`, drawn as
  `Checkbox` draws its box. `value`, `group` (the `bind:group` value: it's checked when
  that's its `value`), `onChange(value)` (pressing it when unchecked), and `label`,
  `labelClassName`, `accessibilityLabel`, `disabled`, `className` and `inputClassName`
  (the circle's size and margins; by default `w-3.5 h-3.5`) as for `Checkbox`.
  `accessibilityRole="radio"`; put a group in a `View` with
  `accessibilityRole="radiogroup"`.
- `Details`: `<details><summary>…</summary>…</details>`. `summary` (a string is a
  `Text` styled by `summaryTextClassName`, by default `text-sm
  text-discord-textPrimary`, whose color and font size also give the disclosure
  triangle's; any other node renders as it is), `summaryClassName` (the `<summary>`'s
  layout; it's a row, by default `items-center gap-1`), `marker` (false for a
  `<summary>` upstream lays out as `flex`, which has no triangle), `className` (the
  `<details>`'s) and the body as `children`. Pressing the summary opens and closes it;
  it starts closed, or `open` with `onToggle(open)` controls it. A closed body stays
  mounted, hidden, as in a `<details>`.
- `Video`: `<video>`, an expo-video player. `src` (an authenticated Matrix media URL gets
  the account's token, as for `mediaSource`; none is an empty box), `poster` (a URL or a
  `videoFrameThumbnail` frame, shown until the first frame), `controls`, `autoplay`,
  `muted`, `loop`, `use` (a `use:` action on the element, such as Zam's
  `rememberVolume`: it gets the player as an `HTMLMediaElement` with `volume`, `muted`
  and `volumechange`), `className` and `style` (the box the player fills,
  object-contain), and its events: `onLoadedMetadata(player)` (seek through
  `player.currentTime`), `onResize(videoWidth, videoHeight)`, `onCanPlay` and
  `onError`. A new `src` gets a new player. With `controls`, touches on it are the
  player's rather than an enclosing `Pressable`'s; without, it takes none.
- `videoFrameThumbnail(src, maxW, maxH)`: upstream's `videoFrameUrl` (mediaAuth): the
  video's first frame fitted in the box, as an image source for `Image` or `poster`, or
  null (it didn't load within 15 s). A short-lived player grabs it natively; the latest
  50 are cached.
- `Range`: `<input type="range">`. `value`, `min`/`max`/`step` (HTML's defaults: 0,
  100, 1), `onChange(value)` (`oninput`), `onChangeEnd(value)` (`onchange`: a drag, tap
  or step that changed the value has ended), `disabled`, `accessibilityLabel`,
  `accessibilityValueText` (`aria-valuetext`), `ticks` (the values of its `<datalist>`,
  marked under the track) and `className`. A tap or a sideways drag sets it
  (react-native-gesture-handler; a vertical swipe still scrolls); VoiceOver and
  TalkBack step it by `step`.
- `SvgIcon`: an inline `<svg fill="currentColor"><path d="…" /></svg>`. `d` (or `Path`
  children, for more than one path), `viewBox` (default `0 0 24 24`), `size` and
  `className`: `w-*`/`h-*` size it and its `text-*` color is `currentColor` (Zam's
  primary text color without one). The `<svg>`'s `fill` (by default `currentColor`),
  `stroke`, `strokeWidth`, `strokeLinecap` and `strokeLinejoin` draw a stroked icon
  (`fill="none" stroke="currentColor" strokeWidth={2}`); paths can name `currentColor`
  too. Screen readers skip it.
- `pickedFile(asset)`: `<input type="file">` → `expo-image-picker` or
  `expo-document-picker`, then this: the picked asset as the `File` the input gives,
  named, typed and dated like it, which keeps the asset's `uri`. Its bytes are in memory
  (Zami's Blob polyfill makes `fetch(uri).blob()` an in-memory Blob), so it reads and
  slices as on the web.
- `confirmAlert(message, { confirmText, cancelText, destructive })`: `confirm()` as a
  native alert, resolving true when confirmed. Pass the button texts translated.
- `notificationPermission()` / `requestNotificationPermission()`:
  `Notification.permission` and `Notification.requestPermission()` through
  expo-notifications, as `"granted"`, `"default"` (the system will still prompt) or
  `"denied"`. The check is asynchronous, and `"unsupported"` when the system can't say;
  the request is `"denied"` if asking fails, as Zam's `requestNotificationPermission`
  has it.
- `Spin` / `Pulse`: Tailwind's `animate-spin` and `animate-pulse`, which Uniwind doesn't
  support. Give them the element's other classes (`<Spin className="w-4 h-4 border-2 …
  rounded-full" />`), which style the box that animates, so its margins and flex classes
  work as on the web; or wrap what animates (`<Spin><Loader2 size={16} /></Spin>`), where
  `className` places the wrapper (it keeps what it wraps centred, so it turns in place
  even when a `stretch` parent widens it). Other view props (accessibility) pass through;
  a `Spin` takes no touches.
- `SettingAnchor` / `revealSettingAnchor(anchor, scrollView)`: Zam's settings search
  scrolls to a result's `[data-setting-anchor]` element and flashes it
  (`.message-highlight`). A panel renders that element as `<SettingAnchor anchor="…">`
  (a `View`, with the element's `className`), which registers itself while mounted;
  `revealSettingAnchor` scrolls the panel's scroll view (a `ScrollView` or
  `KeyboardAwareScrollView` ref) to put it at the top and flashes it, or returns false
  when it isn't rendered.
- `anchorElement(view)`: a view's on-screen box as the `HTMLElement` Zam's anchoring helpers
  read (`openProfileCard(userId, el)` only calls `getBoundingClientRect()`).

## DOM a plugin builds, and code loaded at run time

Zam's plugins build their UIs as DOM nodes (`render(el)` for popovers, panels and link
embeds), which here live in Zami's detached linkedom DOM
(`@-/com.leonsilicon.zami.browser`), and Zam loads their code with `import()` of a
`blob:` URL, which Hermes can't do.

- `DomView`: shows a DOM element and its subtree as React Native views. `node` (its own
  style and classes apply to the outer box), `textClassName` (the text classes it
  inherits, as CSS inherits them; by default `text-base text-discord-textPrimary`),
  `className`/`style` (the box around it), `onLinkPress(href)` (by default `openLink`)
  and `resolveMxc` (for `mxc://` image sources).
  - Elements: blocks are `View`s, and inline content is a run of `Text` (a wrapping row
    when it holds inline-blocks such as buttons or images); `display: flex`/`grid` lay
    out as flexbox (grid as wrapping rows), `display: none` and `hidden` drop them,
    `overflow: auto` scrolls. `img` is `Image` (with `mediaSource`), `svg` is
    react-native-svg (paths, circles, rects, lines, polylines, polygons, ellipses,
    groups), `video` is `Video`, `iframe` is a WebView, and `progress`/`meter` are bars.
  - Controls: `button`, `a[href]`, `summary` and `label` are pressable; so is any element
    with a `click` listener (`addEventListener` or `onclick`), a pressable `role`, a
    `tabindex` or `cursor: pointer`. Text inputs and textareas are `TextInput`s,
    checkboxes and radios `Checkbox`/`Radio`, `type="range"` `Range` and `select`
    `Select`.
  - Events go back to the nodes as the browser sends them: a press is a `click` (then the
    default action unless cancelled: a link opens, a submit button submits its form, a
    `summary` toggles its `details`, a `label` toggles or focuses its control); typing is
    `input` (and `change` on blur), Enter is `keydown` (and submits the form), checking is
    `click`, `input` and `change`, and a select or range sends `input` and `change`.
    `el.focus()` in the plugin's code focuses a text field. An element shown here gets a
    `getBoundingClientRect()` of its view, so a popover can be anchored to it.
  - Styles: a practical subset of inline CSS (`dom-style.ts`): the box (sizes, margins,
    padding, borders, radii, background color, opacity, `box-shadow`, `transform`,
    position), flexbox, text (color, font size, weight, style and monospace family, line
    height, letter spacing, alignment, decoration, transform, `white-space`, ellipsis and
    line clamps), `var(--x)` from Zam's theme, `calc()`/`min()`/`max()`/`clamp()` over px,
    em, rem, vw and vh, and space-separated `rgb()`/`hsl()`. Classes resolve through
    Uniwind, so Zam's own Tailwind classes work. Text properties inherit down the tree;
    tags keep Tailwind's preflight look (headings and links as plain text, unstyled
    buttons and fields), with bold, italic, monospace and the like for their tags.
  - It re-renders when the subtree changes (linkedom's `MutationObserver`, which reports
    added and removed nodes, attributes and text) and after every event it sends. A
    change only to a property (`el.style.color = …`, `input.checked`) made outside an
    event shows with the next change to the subtree.
  - Loading it fills two gaps of linkedom's that plugin code runs into: `<select>`'s
    `value` can be set and it has `selectedIndex`, and linkedom's `addEventListener` is
    wrapped to record which events each node listens for (that's how a `click` listener
    makes an element pressable).
- `DomMount`: a `<div>` made with `document` (Zam's) that `mount(el)` builds into, shown
  with `DomView` and kept in the document's body while mounted. `mount` returns the
  cleanup and runs once per mount, as a Svelte action does: give the `DomMount` a `key`
  to run it again (`{#key}`). The other props are `DomView`'s.
- `domGlobals(document)`: the names a plugin's code needs for that DOM that the browser
  has as globals: `Event`, `CustomEvent`, `InputEvent`, `KeyboardEvent`, `MouseEvent`,
  `PointerEvent`, `FocusEvent` and `EventTarget` (linkedom's, which its nodes dispatch),
  `MutationObserver` for the document, `CSS.escape` and `getComputedStyle` (the inline
  style).
- `importModule(source, { scope, url, load })`: `import()` of an ES module's source. It
  rewrites the module (parsed with acorn) to the body of an async function run with
  `new Function`: imports become awaited loads at the top, exports a module namespace of
  getters (live bindings, sorted, `[object Module]`), `import.meta` and `import()` the
  module's own. `scope` names what the code sees in place of globals (Zam passes its
  `window`, `document` and the rest, as Metro gives them to Zam's own code); the module
  may redeclare them. `load(specifier, referrer)` loads its imports; by default http(s)
  and `data:` URLs are fetched and evaluated (once each) and anything else rejects, as a
  module loaded from a `blob:` URL can't resolve them. A module that doesn't parse
  rejects with a SyntaxError. `compileModule(source)` is the rewrite alone.
