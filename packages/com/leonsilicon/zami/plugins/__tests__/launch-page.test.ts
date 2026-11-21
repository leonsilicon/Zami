// Which saved launch page a launch shows.
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { launchPageFits, type LaunchPage } from "#launch-page";

const page: LaunchPage = {
  userId: "@alice:example.org",
  build: "/_app/immutable/entry/app.1.js",
  roomId: "!today:example.org",
  home: true,
  until: 5000,
  width: 390,
  height: 844,
  savedAt: 1000,
  html: "<div></div>",
  styles: [],
  stylesheets: [],
  rootAttributes: {},
};

const launch = {
  userId: page.userId,
  build: page.build,
  width: 390,
  home: { roomId: "!today:example.org" },
  now: 2000,
};

test("the page of the registered home is shown", () => {
  assert.equal(launchPageFits(page, launch), true);
});

test("another account's, another build's or another width's page isn't", () => {
  assert.equal(launchPageFits(page, { ...launch, userId: "@bob:example.org" }), false);
  assert.equal(launchPageFits(page, { ...launch, build: "/_app/immutable/entry/app.2.js" }), false);
  assert.equal(launchPageFits(page, { ...launch, width: 844 }), false);
});

test("a home that changed or expired doesn't show the old one", () => {
  assert.equal(launchPageFits(page, { ...launch, home: { roomId: "!tomorrow" } }), false);
  assert.equal(launchPageFits(page, { ...launch, now: 5000 }), false);
  // The home is gone (expired, or its plugin is off): the app lands where Zam left it.
  assert.equal(launchPageFits(page, { ...launch, home: null }), false);
});

test("without a home, the page is where the app was left", () => {
  const left = { ...page, home: false, until: null };
  assert.equal(launchPageFits(left, { ...launch, home: null }), true);
  assert.equal(launchPageFits(left, { ...launch, home: { roomId: "!elsewhere" } }), false);
});
