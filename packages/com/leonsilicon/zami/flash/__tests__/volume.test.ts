/// <reference types="node" />
import { runInNewContext } from "node:vm";
import { expect, test } from "vite-plus/test";
import { FRAME_JS } from "#page";

test("restores volume after Ruffle loads and reports later menu changes once", async () => {
  const messages: { type: string; value?: number }[] = [];
  const listeners = new Map<string, (event: { data: string }) => void>();
  let poll = () => {};
  let loaded = () => {};
  const movie = new Promise<void>((resolve) => {
    loaded = resolve;
  });
  const player = {
    style: {},
    volume: 1,
    volumeSettings: { volume: 100, isMuted: true },
    ruffle: () => ({ load: () => movie }),
  };
  const page = {
    ReactNativeWebView: { postMessage: (data: string) => messages.push(JSON.parse(data)) },
    RufflePlayer: {} as { newest?: () => { createPlayer: () => typeof player } },
    addEventListener: (name: string, listener: (event: { data: string }) => void) => {
      listeners.set(name, listener);
    },
  };
  runInNewContext(FRAME_JS, {
    window: page,
    self: {},
    location: { href: "file:///sandbox/index.html" },
    URL,
    Promise,
    atob,
    setInterval: (callback: () => void) => {
      poll = callback;
    },
    document: {
      createElement: () => ({}),
      body: { appendChild: () => {} },
      head: {
        appendChild: (script: { onload: () => void }) => {
          page.RufflePlayer.newest = () => ({ createPlayer: () => player });
          script.onload();
        },
      },
    },
  });
  const send = (data: object) => listeners.get("message")?.({ data: JSON.stringify(data) });
  send({ type: "init", swf: "Rg==" });
  send({ type: "volume", value: 0.3 });
  expect(player.volume).toBe(0.3);
  player.volume = 1; // Ruffle resets its volume while loading the movie.
  loaded();
  await movie;
  await Promise.resolve();
  expect(player.volume).toBe(0.3);
  expect(player.volumeSettings).toEqual({ volume: 30, isMuted: false });
  send({ type: "volume", value: 5 });
  expect(player.volume).toBe(0.3);
  poll();
  player.volume = 0.6;
  poll();
  poll();
  expect(messages.filter((message) => message.type === "volume")).toEqual([
    { type: "volume", value: 0.6 },
  ]);
});
