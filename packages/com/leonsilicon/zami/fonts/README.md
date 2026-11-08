# @-/com.leonsilicon.zami.fonts

Fonts for Zam's code in React Native, which has none of the web's: no `@font-face`, no
`FontFace`, no WOFF2, and no font that text inherits from the root.

- **WOFF2** (`./convert`, no React Native): `toSfnt(bytes)` turns a TrueType, OpenType or
  WOFF2 file into the TrueType/OpenType file iOS (expo-font) and Android (Typeface) load,
  with its extension. `woff2ToSfnt` decodes WOFF2 (Brotli, with the pure-JS `brotli`, and
  the `glyf`/`loca` and `hmtx` transforms); WOFF2 collections and WOFF 1 aren't supported.
- **Zam's bundled fonts:** `vpx _fonts` writes Zam's `static/fonts/*.zami.woff2` (Inter,
  Atkinson Hyperlegible) as TrueType, with their licenses, to `apps/zami/assets/fonts`.
  Rerun it when a sync changes them, and commit the output. The app loads them at startup
  (`apps/zami/fonts.ts`) with `loadFontFamilies`: expo-font, under the family names Zam's
  font stacks use (Inter is a variable font; `fontWeight` picks its named instances).
- **The app's font** (`./app-font`, no React Native): on the web Zam sets the chosen font
  as a CSS stack on the root (`--zam-font-family`) and everything inherits it. Here
  `applyMessageFont` (`src/lib/utils/messageDisplay.zami.ts`) calls `setAppFontStack`, and
  the app renders the stack's first family it has loaded (`setFontLoaded`) or the
  platform has installed (`setFontsInstalled`), or the system font, as a browser falls
  back past a family it doesn't have. With no font picked, the stack is Zam's own
  (`DEFAULT_FONT_STACK`, from `src/app.css`), so on iOS the app draws Helvetica Neue,
  as Safari draws Zam (`IOS_INSTALLED_FONTS`, which the app marks installed on iOS).
- **Every Text and TextInput** takes that family (`installAppFont()`, which the app calls
  first), unless it picks its own (a `font-mono`/`font-sans`/`font-serif`/`font-[…]`
  class or a `fontFamily` style) or is nested in another Text, whose font it inherits.
  It also takes the web's default size, 16px (React Native's is 14), unless it sets one
  (a `text-xs` … `text-9xl` or `text-[<length>]` class, or a `fontSize` style): on the
  web, Zam's text with no size class is 16px.
  React Native has no default font to set and its Text is a plain function, so the JSX
  runtime (`react/jsx-runtime`, `react/jsx-dev-runtime`) hands those elements to a wrapper
  that puts the family before their own style.
- **Custom fonts:** Zam's upload (`src/lib/utils/customFont.zami.ts`) registers a FontFace
  on the web. Here `registerCustomFont(name, bytes)` writes it to the app's documents
  (`fonts/`, decoding WOFF2) and loads it with expo-font under a name from its contents
  (expo-font loads a family name only once), which the app's font then renders for `name`;
  `unregisterCustomFont(name)` drops it.

The tests decode Atkinson Hyperlegible (SIL OFL, `__tests__/fixtures`) and compare it
table by table and glyph by glyph with what fontTools decodes.
