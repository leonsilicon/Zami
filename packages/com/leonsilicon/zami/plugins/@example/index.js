// What a plugin can do with `zam.zami`, the Zami app's additions to Zam's plugin API. To try
// it, load this folder in Settings > Plugins. See ../README.md.
//
// The app runs Zam's own web app, so a plugin has the whole browser too (the DOM, CSS,
// WebAssembly, Workers, canvas); `zam.zami` adds what Zam doesn't give it.

// (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
const ADD_WASM = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100,
  100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11,
];

export default {
  async onload(zam) {
    const zami = zam.zami;
    if (!zami) {
      console.warn("Zami showcase: this isn't the Zami app (zam.zami is missing).");
      return;
    }

    // 1. A layer over the whole app: a badge in a corner, drawn with the DOM and the
    //    theme's own classes.
    let badge = null;
    zami.ui.addLayer((layer) => {
      badge = document.createElement("div");
      badge.dataset.zamiShowcase = "badge";
      badge.className = "bg-zam-accent text-white text-xs font-semibold";
      badge.style.cssText =
        "position:absolute;right:12px;top:96px;border-radius:999px;padding:2px 8px;";
      badge.hidden = true;
      layer.append(badge);
      return () => {
        badge = null;
      };
    });

    // 2. A function of the app's, patched: count the messages the timeline store takes in.
    //    The patch replaces the module's own function, so the store's own calls go through it.
    let received = 0;
    const messages = await zami.import("$lib/stores/messages.svelte");
    zami.patch.after(messages, "appendMessage", () => {
      received++;
      if (badge) {
        badge.hidden = false;
        badge.textContent = `${received} new`;
      }
    });

    // 3. A store, followed: Zam's stores are Svelte runes, and `runes.watch` calls back
    //    whenever what the getter read changes.
    const rooms = zami.stores.rooms;
    zami.runes.watch(
      () => rooms.roomsState.activeRoomId,
      (roomId) => {
        if (badge) badge.title = roomId ? `In ${roomId}` : "";
      },
    );

    // 4. A component of the app's, patched: a line under the profile in the room list.
    //    (A plugin that patches components loads before the first render from the next
    //    launch on, so its patches reach everything the app draws.)
    zami.components.around("ProfileFooter", {
      after(el) {
        const line = document.createElement("p");
        line.dataset.zamiShowcase = "footer";
        line.className = "text-xs text-zam-textMuted";
        line.style.cssText = "padding:4px 12px;text-align:center;";
        line.textContent = zami.app.early
          ? "Patched by Zami showcase (loaded early)"
          : "Patched by Zami showcase";
        el.append(line);
      },
    });

    // 5. Theme variables, over the theme's own (the accent as a fill and as text, which
    //    Zam's classes read as RGB channels).
    zami.styles.setVariables({
      "--zam-accent-fill-rgb": "232 89 12",
      "--zam-accent-text-rgb": "255 146 72",
    });

    // 6. WebAssembly, in a page of the plugin's own.
    zam.commands.register({
      name: "wasm",
      description: "Add two numbers in WebAssembly",
      argKind: "text",
      async run({ roomId, arg }) {
        const [a, b] = arg.split(/[\s+,]+/).map(Number);
        const page = zami.web.open();
        try {
          const sum = await page.run(
            "const { instance } = await WebAssembly.instantiate(args[0]); return instance.exports.add(args[1], args[2]);",
            new Uint8Array(ADD_WASM),
            a || 0,
            b || 0,
          );
          await zam.matrix.sendMessage(roomId, {
            msgtype: "m.text",
            body: `${a || 0} + ${b || 0} = ${sum} (WebAssembly)`,
          });
        } finally {
          page.dispose();
        }
      },
    });

    // 7. The app's native side: its Expo modules, called from the page.
    zam.commands.register({
      name: "native",
      description: "What the Zami app's native side says",
      argKind: "none",
      async run({ roomId }) {
        const modules = await zami.native.modules();
        const installed = await zami.native.call("ExpoApplication", "getInstallationTimeAsync");
        await zam.matrix.sendMessage(roomId, {
          msgtype: "m.text",
          body:
            `Running on ${zami.platform}, installed ${new Date(installed).toISOString()}, ` +
            `with ${Object.keys(modules).length} native modules (${Object.keys(modules).join(", ")})`,
        });
      },
    });
  },
};
