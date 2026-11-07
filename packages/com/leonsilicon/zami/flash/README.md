# @-/com.leonsilicon.zami.flash

Zam's Flash player for React Native. Zam plays a SWF with Ruffle in an iframe of
`static/flash-sandbox/` (sandbox="allow-scripts": an opaque origin, no network), and
hands it Ruffle's wasm and the SWF over a MessagePort. Here the sandbox is a WebView:

- **The page** (`page.ts`) is Zam's `flash-sandbox/` for a WebView: the same CSP, with
  `file:` for its own scripts and Ruffle's wasm; the same Ruffle settings (no
  networking, no script access, no navigation); and the same messages, as JSON over
  the WebView's bridge (`init` with the SWF as base64, `suspend`; the page's `ready`,
  its `wasm` requests by name, and `error`s for the log).
- **Ruffle** comes from Zam's `static/ruffle/` (their Zami versions): Zami's Metro
  transformer makes its scripts strings, and its two wasm builds are assets. On first
  use in a run, `prepareSandbox()` writes the page and Ruffle's scripts to
  `<cache>/zami-flash/`; `provideRuffleWasm(name)` copies a build there (downloading it
  from the dev server in development) when the page asks for it, as Zam's FlashEmbed
  answers the iframe's request with the bytes. The page then reads it from disk.
- **`FlashSandbox`** is the WebView: it may read only that directory, has a
  non-persistent data store, opens no windows, plays sound without a tap
  (`allow="autoplay"`), and refuses every load but its page. A refused navigation of
  the page is reported as `onNavigate`, for Zam's "the frame left our page". Its handle's
  `postMessage(message)` is the frame's `postMessage`: an ArrayBuffer in the message
  travels as base64.

```tsx
<FlashSandbox
  ref={frame}
  onLoad={() => frame.current?.postMessage({ type: "init", swf })}
  onMessage={(msg) => msg.type === "ready" && setReady(true)}
  className="w-full aspect-video"
/>
```
