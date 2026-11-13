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
minutes. So it's also an Expo module, with the same functions on both platforms:
`ios/ZamiWebCryptoModule.swift` (CommonCrypto, and CryptoKit for AES-GCM) and
`android/…/ZamiWebCryptoModule.kt` (javax.crypto, with PBKDF2 written out over the
platform's HMAC, since Java's own takes the password as characters). When the app has it,
digests, HMAC, AES-CTR, AES-GCM and PBKDF2 run natively, off the JS thread (on a queue of
their own, so a long one holds up no other module's async functions), after the JS side
has checked every argument as before.

What stays on @noble, on the JS thread: everything in Node and the tests, HKDF (a few
hashes of a few bytes), AES-GCM with an iv that isn't 12 bytes (no caller uses one; the
platforms' GCM takes 12), and AES-GCM in a build of the app from before the module had it.
A native call that fails for a reason of its own (a key size a provider refuses, say) is
computed on @noble instead, so the result never depends on the platform; it's only slower.
PBKDF2 on @noble yields to the event loop as it goes; the rest are single calls, so a
megabyte on @noble holds the thread for most of a second. `__tests__/native.test.ts` runs
the native path with a stand-in module on `node:crypto`.
