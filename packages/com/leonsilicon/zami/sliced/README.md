# @-/com.leonsilicon.zami.sliced

Long loops of Zam's code, cut into slices that give the event loop a turn every few
milliseconds. React Native draws and handles touches only between tasks of the JS event
loop, and a promise chain never gives up its turn, so a loop over a whole room's history
or a whole song holds the screen frozen until it ends. Each of these runs for a slice
(8 ms by default), then waits for a later turn with `setTimeout(0)` (not a microtask: on
bridgeless React Native even `setImmediate` is one) and carries on.

- `createSlicer({ sliceMs })`: the time budget for any such loop. Check `due` as it goes
  and `await pause()` when it's true:

  ```ts
  const slicer = createSlicer();
  for (const item of items) {
    if (slicer.due) await slicer.pause();
    work(item);
  }
  ```

  `nextTurn()` waits for a later turn once.

- `createIndexSearch({ redacted, normalize, matches, limit })`: the local message index's
  search (`src/lib/utils/eventIndex`'s `resolveEntries`, then `searchEntries`), fed one
  block at a time (`add`) and resolved with `results()`, with the same results: each
  message once with its latest edit's text, redactions dropped, the newest `limit`
  matches. It keeps only the newest `limit` matches as it goes (a heap), so a broad query
  over a long history never sorts everything. `prepareEntry` gives an entry its search
  body (`n`, the normalized body, only where that differs from the body in lower case)
  when the index writes it, so a search compares words against stored text rather than
  normalizing every message each time; entries written before that are normalized during
  the search, a slice at a time. `__tests__/index-search.test.ts` holds it up against
  upstream's functions on messy histories.

- `audioToWavSliced(channels, sampleRate)`: spessasynth_core's `audioToWav` with
  `normalizeAudio`, byte for byte: a rendered song is millions of samples, which Hermes
  takes seconds to scan and convert in one go (90 seconds of stereo: about 1.5 s with
  V8's interpreter alone).

## Web Workers

Zam runs some work in Web Workers, which React Native doesn't have. The Metro transformer
replaces `new Worker(…)` with a throw (`@-/com.leonsilicon.zami.metro`), so those features
fail (or take their non-worker path) rather than run their work on the app's one JS
thread: JPEG XL decoding (`jxl`), progressive JPEG encoding of uploads
(`progressiveJpegUpload`), tracker module rendering (`tracker`), the GPU noise suppressor
(`fastenhancerGpu`), the file-transfer sink's OPFS writer (`fileTransferSink`), and the
real-time MIDI player's bank preparation (`midiStream`). The one exception is the MIDI
render worker,
whose `render` the app calls on its own thread (`src/lib/utils/midiSoundBank.zami.ts`):
its sound bank's Opus samples are decoded a few at a time, its synthesis and its WAV
encoding run a slice at a time, and only spessasynth_core's parse of the sound bank stays
one call. Anything else moved onto the thread later needs the same treatment.
