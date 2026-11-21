import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { runStartupPlugin } from "#startup";

test("early and regular startup share an in-flight plugin load", async () => {
  const plugin = { manifest: { id: "overlapping-load", name: "Overlapping load" } };
  const completed = Promise.withResolvers<boolean>();
  let loads = 0;
  const enable = () => {
    loads++;
    return completed.promise;
  };
  const disable = () => assert.fail("startup must leave the plugin enabled");

  const early = runStartupPlugin(plugin, enable, disable);
  const regular = runStartupPlugin(plugin, enable, disable);

  assert.equal(regular, early);
  completed.resolve(true);
  assert.equal(await regular, true);
  assert.equal(loads, 1);
});
