// The shell's config plugin: each native build brings Zam's web app up to date
// (`vpx _web build`, which only rebuilds what changed) and puts it in the app as
// `zami-web/`, where the shell's native module serves it from.
import { join, relative, resolve } from "node:path";
import configPlugins, { type ConfigPlugin } from "expo/config-plugins";

// expo/config-plugins is CommonJS: its names come off the default export.
const { withAppBuildGradle, withXcodeProject } = configPlugins;

const PHASE_NAME = "[Zami] Bundle Zam's web app";
const GRADLE_MARKER = "// Zami: Zam's web app";

/** `_web`'s script, and the directory its build lands in (holding `zami-web/`). */
function webPaths(projectRoot: string): { bin: string; out: string } {
  const repoRoot = resolve(projectRoot, "../..");
  return {
    bin: join(repoRoot, "packages/com/leonsilicon/zami/web/_web.ts"),
    out: join(projectRoot, ".build/web"),
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

interface ShellScriptPhase {
  name?: string;
  alwaysOutOfDate?: number;
}

function phases(project: {
  hash: { project: { objects: Record<string, unknown> } };
}): ShellScriptPhase[] {
  const objects = project.hash.project.objects.PBXShellScriptBuildPhase ?? {};
  return Object.values(objects).filter(
    (phase): phase is ShellScriptPhase => typeof phase === "object" && phase !== null,
  );
}

const withWebAppIos: ConfigPlugin = (config) =>
  withXcodeProject(config, (config) => {
    const project = config.modResults;
    const iosDir = config.modRequest.platformProjectRoot;
    const { bin, out } = webPaths(config.modRequest.projectRoot);
    const quotedName = JSON.stringify(PHASE_NAME);
    if (phases(project).some((phase) => phase.name === quotedName)) return config;
    const script = [
      "set -e",
      // The Node that builds the JS bundle (expo prebuild writes .xcode.env).
      'if [ -f "$PROJECT_DIR/.xcode.env" ]; then . "$PROJECT_DIR/.xcode.env"; fi',
      'if [ -f "$PROJECT_DIR/.xcode.env.local" ]; then . "$PROJECT_DIR/.xcode.env.local"; fi',
      'NODE="${NODE_BINARY:-$(command -v node)}"',
      'export PATH="$(dirname "$NODE"):$PATH"',
      `"$NODE" "$PROJECT_DIR"/${shellQuote(relative(iosDir, bin))} build >/dev/null`,
      `SRC="$PROJECT_DIR"/${shellQuote(relative(iosDir, out))}/zami-web`,
      'DEST="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/zami-web"',
      'mkdir -p "$DEST"',
      'rsync -a --delete "$SRC/" "$DEST/"',
    ].join("\n");
    project.addBuildPhase(
      [],
      "PBXShellScriptBuildPhase",
      PHASE_NAME,
      project.getFirstTarget().uuid,
      {
        shellPath: "/bin/sh",
        shellScript: script,
      },
    );
    // It reads files Xcode doesn't know about: run it on every build.
    for (const phase of phases(project)) {
      if (phase.name === quotedName) phase.alwaysOutOfDate = 1;
    }
    return config;
  });

const withWebAppAndroid: ConfigPlugin = (config) =>
  withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(GRADLE_MARKER)) return config;
    const appDir = join(config.modRequest.platformProjectRoot, "app");
    const { bin, out } = webPaths(config.modRequest.projectRoot);
    config.modResults.contents += `
${GRADLE_MARKER} (vpx _web build), which @-/com.leonsilicon.zami.shell serves from the assets.
def zamiWebApp = tasks.register("zamiWebApp", Exec) {
    commandLine "node", file(${JSON.stringify(relative(appDir, bin))}).absolutePath, "build"
}
preBuild.dependsOn(zamiWebApp)
android.sourceSets.main.assets.srcDirs += [file(${JSON.stringify(relative(appDir, out))})]
`;
    return config;
  });

/** Builds Zam's web app with each native build and bundles it as `zami-web/`. */
export const withZamiShell: ConfigPlugin = (config) => withWebAppAndroid(withWebAppIos(config));
