# @-/com.leonsilicon.zami.webcrypto

WebCrypto's `crypto.subtle`, for Hermes, which has none, in pure JS on
[@noble/ciphers](https://github.com/paulmillr/noble-ciphers) and
[@noble/hashes](https://github.com/paulmillr/noble-hashes). It covers what Zam's logic
(`src/**/*.zami.ts`) and matrix-js-sdk (`lib/`) call, and nothing else:

| Algorithm | Methods                                 | Used by                                                                      |
| --------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| SHA-256   | `digest`; the hash of HMAC, HKDF        | attachments, file transfers, plugin files; OAuth's PKCE                      |
| SHA-512   | `digest`; the hash of PBKDF2            | key backup passphrases, key export files                                     |
| AES-CTR   | `importKey` (raw), `encrypt`, `decrypt` | attachments, key export files; secret storage                                |
| AES-GCM   | `importKey` (raw), `encrypt`, `decrypt` | file transfers                                                               |
| HMAC      | `importKey` (raw), `sign`, `verify`     | key export files; secret storage                                             |
| HKDF      | `importKey` (raw), `deriveBits`         | call media keys (import only); secret storage                                |
| PBKDF2    | `importKey` (raw), `deriveBits`         | key export files; key backup passphrases (`deriveRecoveryKeyFromPassphrase`) |

```ts
import { installWebCrypto } from "@-/com.leonsilicon.zami.webcrypto";

installWebCrypto(); // defines crypto.subtle, unless the platform has its own
```

`subtle` and `CryptoKey` are exported too. It behaves as WebCrypto does: every method is
async (a bad argument rejects, never throws) and copies its byte inputs when called; it
takes ArrayBuffers, TypedArrays and DataViews and resolves to ArrayBuffers; names match
in any case; keys are `CryptoKey`s whose secret nothing outside the package can read;
and errors are TypeErrors or DOMExceptions (where there's no DOMException, Errors) with
WebCrypto's names. The tests in `__tests__/` hold all of it up against Node's WebCrypto.

Anything else rejects with `NotSupportedError`: other algorithms and hashes, key formats
other than `raw` (Zam builds an attachment's JWK itself), `exportKey`, `generateKey`,
`deriveKey`, `wrapKey`, AES-GCM tags shorter than 128 bits or ivs shorter than 8 bytes,
and HMAC key lengths that aren't whole bytes.

In pure JS on Hermes, which has no JIT, the expensive operations are slow: a megabyte
takes most of a second to encrypt or hash, and a key file's 500,000 PBKDF2 iterations take
minutes. So it's also an Expo module (`ios/ZamiWebCryptoModule.swift`). When the app has
it, digests, HMAC, AES-CTR and PBKDF2 run in CommonCrypto, off the JS thread, after the
JS side has checked every argument as before. Without it (in Node, and on Android for now),
everything runs on @noble, on the JS thread; PBKDF2 yields to the event loop as it goes.
`__tests__/native.test.ts` runs the native path with a stand-in module on `node:crypto`.
