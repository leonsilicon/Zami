#!/usr/bin/env node
// Develop Zami: `vpx _dev` from anywhere in the repo.
//
//   vpx _dev [ios]       build Zam's web app and the native app if needed, install and launch
//                        on the iOS simulator, then serve JS
//   vpx _dev android     the same on an Android emulator or device
//   vpx _dev start       only the dev server (Metro), for an app that's already installed
//
// Anything after the target goes to the Expo CLI, e.g. `vpx _dev ios --device "iPhone Duo"`.
import { runDev, type DevTarget } from "#dev";

const [first, ...rest] = process.argv.slice(2);
const targets: DevTarget[] = ["ios", "android", "start"];
const target = targets.includes(first as DevTarget) ? (first as DevTarget) : "ios";
const args = target === first ? rest : process.argv.slice(2);

process.exit(runDev(target, args));
