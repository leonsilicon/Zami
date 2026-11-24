import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

export default function codemod(root: SgRoot): string | null {
  if (root.filename().endsWith("/livekitCall.ts")) {
    return editNodes(root, [
      {
        kinds: ["function_declaration"],
        contains: "async function leaveVoiceCallInternal()",
        from: "        for (const el of call.audioEls) el.remove();\n        call.audioEls.clear();",
        to: "        for (const track of call.elByTrack.keys()) detachRemoteAudio(call, track);",
        marker:
          "\n        for (const track of call.elByTrack.keys()) detachRemoteAudio(call, track);",
      },
      {
        kinds: ["function_declaration"],
        contains: "async function joinVoiceCall(",
        from: "            for (const el of call.audioEls) el.remove();\n            call.audioEls.clear();",
        to: "            for (const track of call.elByTrack.keys()) detachRemoteAudio(call, track);",
        marker:
          "\n            for (const track of call.elByTrack.keys()) detachRemoteAudio(call, track);",
      },
      {
        kinds: ["function_declaration"],
        contains: "function attachRemoteAudio(",
        from: "        () => track.attach(el),",
        to: `        () => {
            if (activeVoice === call && call.elByTrack.get(track) === el) track.attach(el);
        },`,
        marker: "if (activeVoice === call && call.elByTrack.get(track) === el) track.attach(el);",
      },
      {
        kinds: ["function_declaration"],
        contains: "function detachRemoteAudio(",
        from: "    el.srcObject = null;\n    el.remove();",
        to: "    el.pause();\n    el.srcObject = null;\n    el.remove();",
        marker: "    el.pause();\n    el.srcObject = null;",
      },
    ]);
  }

  return editNodes(root, [
    {
      kinds: ["program"],
      contains: "function ensureContext()",
      from: "let sinkId: string | null = null;",
      to: `let sinkId: string | null = null;
const pendingTones = new Map<OscillatorNode, boolean>();

function closeSoundContext(): void {
    if (!ctx) return;
    const closing = ctx;
    ctx = null;
    master = null;
    ringGain = null;
    pendingTones.clear();
    void closing.close().catch(() => {});
}

// iOS can freeze the audio clock on backgrounding before a short cue ends.
// Drop those cues before WebKit can resume them on the next foreground.
if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
        const capacitor = (window as Window & { Capacitor?: { getPlatform?(): string } }).Capacitor;
        if (!document.hidden || capacitor?.getPlatform?.() !== "ios") return;
        // Leave an incoming ringtone alone.
        if (![...pendingTones.values()].includes(true)) closeSoundContext();
    });
}`,
      marker: "function closeSoundContext()",
    },
    {
      kinds: ["function_declaration"],
      contains: "function scheduleSegments(",
      from: "        out?.push(osc);",
      to: `        if (dest === master || dest === ringGain) {
            pendingTones.set(osc, out !== undefined);
            osc.onended = () => {
                if (pendingTones.delete(osc) && pendingTones.size === 0)
                    closeSoundContext();
            };
        }
        out?.push(osc);`,
      marker: "pendingTones.set(osc, out !== undefined)",
    },
    {
      kinds: ["function_declaration"],
      contains: "function startRingtone()",
      from: `            if (!ctx || stopping.length === 0) return;
            const t = ctx.currentTime;`,
      to: `            if (!ctx || !stopping.some((osc) => pendingTones.has(osc))) return;
            const t = ctx.currentTime;`,
      marker: "stopping.some((osc) => pendingTones.has(osc))",
    },
    {
      kinds: ["function_declaration"],
      contains: "function startRingtone()",
      from: `            for (const osc of stopping) {
                try {`,
      to: `            for (const osc of stopping) {
                if (!pendingTones.has(osc)) continue;
                pendingTones.set(osc, false);
                try {`,
      marker: "pendingTones.set(osc, false)",
    },
    {
      kinds: ["function_declaration"],
      contains: "function playPing()",
      from: `    // Its own context, closed once the sound is over. The shared call-sound
    // context stays open (running, silent) for the life of the app, and an
    // output stream held open like that makes Windows turn other apps' volume
    // down (its communications ducking) — a ping would dip the user's video
    // until restart. A stream that lives for half a second leaves nothing to
    // duck.`,
      to: "    // Keep message pings independent of the shared call-sound context.",
      marker: "Keep message pings independent",
    },
  ]);
}
