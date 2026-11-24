// Which chunk each module of the web app is built into.
//
// `zam.zami` makes every module of Zam one a plugin can import on its own (registry.ts), and
// a bundler gives each such module a chunk of its own: about 900 of them, of which the app
// loads 860 as it starts, a request each. In the app those are answered one at a time by the
// shell's scheme handler, with no cache between launches, so they were most of the time it
// took to start.
//
// The modules the app always loads are grouped again here, as upstream's build has them:
// - `boot`: what SvelteKit's client entry imports (Zam's client hooks and all they import),
//   which runs before Zam's `init` hook;
// - `app`: what the routes import, which runs after it. (`init` loads the language, and
//   modules read it as they're evaluated, so the two must stay apart.)
// Each has its packages (`-vendor`) apart from Zam's own code, so both download and compile
// at once. A module that's only ever imported on request keeps a chunk of its own: grouped,
// it would run with the group, before anything asked for it.

/** The part of Rollup's module graph this reads (`manualChunks`' second argument). */
export interface ModuleGraph {
  getModuleIds: (this: void) => Iterable<string>;
  getModuleInfo: (
    this: void,
    id: string,
  ) => { isEntry: boolean; importedIds: readonly string[] } | null;
}

/** One of the route nodes SvelteKit generates (`nodes/0.js`, …), which it imports on request. */
const NODE_ENTRY = /\/generated\/client-optimized\/nodes\/\d+\.js$/;
/** SvelteKit's client entries: its own start-up code, and the app's manifest and hooks. */
const BOOT_ENTRY = /\/(?:generated\/client-optimized\/app|runtime\/client\/entry)\.js$/;

function isPackage(id: string): boolean {
  // (A virtual module is a bundler's or a package's own, never Zam's.)
  return id.startsWith("\0") || id.includes("/node_modules/");
}

/** The chunk of each module the app loads as it starts; other modules aren't in it. */
export function startupChunks(graph: ModuleGraph): Map<string, string> {
  const chunks = new Map<string, string>();
  const entries = [...graph.getModuleIds()].filter((id) => graph.getModuleInfo(id)?.isEntry);

  /** Puts everything `roots` import, and haven't been given a chunk, in `stage`'s chunks. */
  function group(stage: string, roots: string[]): void {
    const seen = new Set<string>();
    const pending = [...roots];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      if (seen.has(id)) continue;
      seen.add(id);
      const info = graph.getModuleInfo(id);
      if (!info) continue;
      // An entry keeps its own chunk: SvelteKit names and loads those itself.
      if (!info.isEntry && !chunks.has(id)) {
        chunks.set(id, isPackage(id) ? `${stage}-vendor` : stage);
      }
      pending.push(...info.importedIds);
    }
  }

  const boot = entries.filter((id) => BOOT_ENTRY.test(id));
  const nodes = entries.filter((id) => NODE_ENTRY.test(id));
  // Another build (the server's, a worker's) has neither: its chunks stay as they are.
  if (boot.length === 0 || nodes.length === 0) return chunks;
  group("boot", boot);
  group("app", nodes);
  return chunks;
}

/** Rollup's `output.manualChunks` for the web app. */
export function manualStartupChunks(): (id: string, graph: ModuleGraph) => string | undefined {
  // One graph per build (the client's, then the server's): each is grouped once.
  const grouped = new WeakMap<ModuleGraph["getModuleInfo"], Map<string, string>>();
  return (id, graph) => {
    // A bundler that doesn't list its modules here: its chunks stay as they are. (The web
    // build checks that the app's didn't: @-/com.leonsilicon.zami.web.)
    if (typeof graph.getModuleIds !== "function") return undefined;
    let chunks = grouped.get(graph.getModuleInfo);
    if (!chunks) {
      chunks = startupChunks(graph);
      grouped.set(graph.getModuleInfo, chunks);
    }
    return chunks.get(id);
  };
}
