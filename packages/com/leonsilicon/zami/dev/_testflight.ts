#!/usr/bin/env node
// Upload Zami to TestFlight: `vpx _testflight` from anywhere in the repo.
//
//   vpx _testflight                     build the app "Zami" and upload it
//   vpx _testflight --variant staging   the same for "(S) Zami" (apps/zami/app.config.ts)
//   vpx _testflight --export-only       stop after the signed .ipa
//
// Needs an App Store Connect API key (ASC_KEY_ID, ASC_ISSUER_ID, and ASC_KEY_PATH or
// ASC_KEY_P8) and one of the team's distribution certificates in the keychain. On
// GitHub Actions it writes the build number to the job summary.
import { appendFileSync } from "node:fs";
import { ascKeyFromEnv, runTestflight, variantFromArgs } from "#testflight";

const args = process.argv.slice(2);
const upload = !args.includes("--export-only");
const variant = variantFromArgs(args);
const version = await runTestflight({ key: ascKeyFromEnv(), upload, variant });
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    upload
      ? `Uploaded the ${variant} build ${version} to TestFlight. It reaches testers once App Store Connect has processed it.\n`
      : `Exported the ${variant} build ${version}.\n`,
  );
}
