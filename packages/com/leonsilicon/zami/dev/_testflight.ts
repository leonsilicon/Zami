#!/usr/bin/env node
// Upload Zami to TestFlight: `vpx _testflight` from anywhere in the repo.
//
//   vpx _testflight               build for the App Store and upload
//   vpx _testflight --export-only build and export the .ipa, without uploading
//
// Needs an App Store Connect API key (ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH) and the
// team's distribution certificate in this Mac's keychain.
import { ascKeyFromEnv, runTestflight } from "#testflight";

runTestflight({ key: ascKeyFromEnv(), upload: !process.argv.includes("--export-only") });
