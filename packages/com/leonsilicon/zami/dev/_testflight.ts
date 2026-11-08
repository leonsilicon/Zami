#!/usr/bin/env node
// Upload Zami to TestFlight: `vpx _testflight` from anywhere in the repo.
//
//   vpx _testflight               build for the App Store and upload
//   vpx _testflight --export-only build and export the .ipa, without uploading
//
// Needs an App Store Connect API key (ASC_KEY_ID, ASC_ISSUER_ID, and ASC_KEY_PATH or
// ASC_KEY_P8) and one of the team's distribution certificates in the keychain. On
// GitHub Actions it writes the build number to the job summary.
import { appendFileSync } from "node:fs";
import { ascKeyFromEnv, runTestflight } from "#testflight";

const upload = !process.argv.includes("--export-only");
const version = await runTestflight({ key: ascKeyFromEnv(), upload });
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    upload
      ? `Uploaded Zami build ${version} to TestFlight. It reaches testers once App Store Connect has processed it.\n`
      : `Exported Zami build ${version}.\n`,
  );
}
