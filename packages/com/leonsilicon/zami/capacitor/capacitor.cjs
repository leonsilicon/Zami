// Every `@capacitor/*` specifier in the Zami app resolves here (Metro). `Capacitor`,
// `registerPlugin`, `WebPlugin` and `CapacitorException` come from capacitor.ts; any other
// export (`App`, `Browser`, `Preferences`, `PushNotifications`, …) is a plugin whose
// methods reject. CommonJS, so it can answer every plugin name without listing them.
const core = require("#capacitor");

const plugins = new Map();

module.exports = new Proxy(
  {},
  {
    get(_target, name) {
      if (name === "__esModule") return true;
      if (typeof name !== "string") return undefined;
      if (name in core) return core[name];
      if (!/^[A-Z]/.test(name)) return undefined;
      let plugin = plugins.get(name);
      if (plugin === undefined) plugins.set(name, (plugin = core.registerPlugin(name)));
      return plugin;
    },
  },
);
