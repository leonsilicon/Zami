import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
// oxlint-disable-next-line flatcap/no-unresolved-imports
import { readZamFile } from "@-/com.github.az4521.zam";
import { repoRoot } from "@-/com.leonsilicon.zami.paths";
import { beforeAll, expect, test } from "vite-plus/test";
import { discoverCodemods, runCodemod } from "#codemods";

let soundEffects: string;

beforeAll(() => {
  const codemod = discoverCodemods().find(({ name }) => name === "zam.call-audio-cleanup")!;
  const source = "src/lib/audio/soundEffects.ts";
  const dir = mkdtempSync(join(tmpdir(), "zami-call-audio-"));
  try {
    const file = join(dir, "soundEffects.ts");
    writeFileSync(file, readZamFile(repoRoot(), source));
    runCodemod(codemod, file, "typescript");
    soundEffects = stripTypeScriptTypes(readFileSync(file, "utf8")).replace(/^export /gm, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function soundEngine() {
  function param() {
    return {
      value: 0,
      setValueAtTime() {},
      linearRampToValueAtTime() {},
      exponentialRampToValueAtTime() {},
      cancelScheduledValues() {},
    };
  }

  class FakeAudioContext {
    state = "running";
    currentTime = 0;
    destination = {};
    tones: { onended?: () => void }[] = [];

    constructor() {
      contexts.push(this);
    }

    close() {
      this.state = "closed";
      return Promise.resolve();
    }

    createGain() {
      return { context: this, gain: param(), connect() {} };
    }

    createOscillator() {
      const tone = { frequency: param(), connect() {}, start() {}, stop() {}, onended: undefined };
      this.tones.push(tone);
      return tone;
    }
  }

  const contexts: FakeAudioContext[] = [];
  const document = Object.assign(new EventTarget(), { hidden: false });
  const sounds = runInNewContext(`${soundEffects}\n({ playCallSound, startRingtone })`, {
    AudioContext: FakeAudioContext,
    document,
    window: { Capacitor: { getPlatform: () => "ios" } },
    setTimeout() {},
  }) as {
    playCallSound(name: "selfJoin" | "selfLeave"): void;
    startRingtone(): { stop(): void };
  };

  return {
    sounds,
    contexts,
    hide: () => {
      document.hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

test("the hang-up cue releases audio only after the last overlapping tone", () => {
  const { sounds, contexts } = soundEngine();
  sounds.playCallSound("selfJoin");
  const [context] = contexts;
  const joinTones = context.tones.slice();
  sounds.playCallSound("selfLeave");
  for (const tone of joinTones) tone.onended?.();
  expect(context.state).toBe("running");
  for (const tone of context.tones.slice(joinTones.length)) tone.onended?.();
  expect(context.state).toBe("closed");
  sounds.playCallSound("selfJoin");
  expect(contexts).toHaveLength(2);
});

test("backgrounding iOS releases a canceled tone without stopping a live ringtone", () => {
  const { sounds, contexts, hide } = soundEngine();
  const ring = sounds.startRingtone();
  const [context] = contexts;
  hide();
  expect(context.state).toBe("running");
  ring.stop();
  sounds.playCallSound("selfLeave");
  hide();
  expect(context.state).toBe("closed");
  sounds.playCallSound("selfJoin");
  for (const tone of context.tones) tone.onended?.();
  expect(contexts[1].state).toBe("running");
});
