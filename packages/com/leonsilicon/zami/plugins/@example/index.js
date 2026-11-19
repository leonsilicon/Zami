// What a plugin can do with `zam.zami`, Zami's additions to Zam's plugin API. To try it,
// load this folder in Settings > Plugins. See ../README.md.

// (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
const ADD_WASM = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100,
  100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11,
];

export default {
  onload(zam) {
    const zami = zam.zami;
    if (!zami) {
      console.warn(
        "Zami showcase: this isn't Zami (zam.zami is missing), so there's nothing to show.",
      );
      return;
    }
    const { createElement: h, useEffect, useState } = zami.React;
    const { Text, View } = zami.ReactNative;

    // 1. A function of the app's, patched: count the messages the timeline store takes in.
    let received = 0;
    const counters = new Set();
    zami.patch.after(zami.stores.messages, "appendMessage", () => {
      received++;
      for (const update of counters) update();
    });

    // 2. A component over the whole app: the count, in a corner.
    function Counter() {
      const [, render] = useState(0);
      useEffect(() => {
        const update = () => render((n) => n + 1);
        counters.add(update);
        return () => counters.delete(update);
      }, []);
      if (received === 0) return null;
      // Classes work where the app itself uses them (its stylesheet is compiled when the
      // app is built), so the theme's colours are classes and the rest is a style.
      return h(
        View,
        {
          pointerEvents: "none",
          className: "bg-zam-accent",
          style: {
            position: "absolute",
            right: 12,
            top: 96,
            borderRadius: 999,
            paddingHorizontal: 8,
            paddingVertical: 2,
          },
        },
        h(Text, { className: "text-xs font-semibold text-white" }, `${received} new`),
      );
    }
    zami.ui.addLayer(Counter);

    // 3. A component of the app's, patched: a line above the sign-in screen. (Zami loads a
    //    plugin that patches components before the first render from the next launch on,
    //    which is how a patch can reach the first screen.)
    zami.components.wrap("LoginView", (Original) => {
      function LoginViewWithNote(props) {
        return h(
          View,
          { className: "flex-1" },
          h(
            Text,
            {
              className: "text-xs text-zam-textMuted",
              style: { paddingTop: 64, textAlign: "center" },
            },
            "Sign-in screen patched by Zami showcase",
          ),
          h(Original, props),
        );
      }
      return LoginViewWithNote;
    });

    // 4. A stylesheet: theme variables (the accent as a fill and as text, which Zam's
    //    classes read as RGB channels), and a rule for one of the app's classes.
    zami.styles.add(`
      :root { --zam-accent-fill-rgb: 232 89 12; --zam-accent-text-rgb: 255 146 72; }
      .message-highlight { background-color: rgb(232 89 12 / 0.2); }
    `);

    // 5. WebAssembly, which the app's own JavaScript runtime doesn't have, in a web page.
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
  },
};
