import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

const program = ["program"];

export default function codemod(root: SgRoot): string | null {
  return editNodes(root, [
    {
      kinds: program,
      contains: "function getSyncDbName(",
      from: `function getSyncDbName(userId: string, deviceId: string): string {`,
      to: `const SAVED_SYNC_TOKEN_KEY = "zami_saved_sync_token";

/**
 * Zami's shell asks the server what changed since the saved sync as a launch
 * starts, before the app has loaded, and hands the answer over when the SDK
 * asks from that token. So the token of what the store has saved is kept
 * where the shell can read it, and the SDK's first sync request doesn't wait
 * for anything but the saved sync.
 */
function connectAtLaunch(
    store: IndexedDBStore,
    userId: string,
    deviceId: string,
): void {
    // The SDK holds its first sync request until its options are written:
    // a turn of the event loop, which the launch's own work on the main
    // thread keeps it waiting for. Nothing reads them before the next launch.
    const storeClientOptions = store.storeClientOptions;
    store.storeClientOptions = (options): Promise<void> => {
        void storeClientOptions(options);
        return Promise.resolve();
    };
    const save = store.save.bind(store);
    store.save = (force?: boolean): Promise<void> => {
        if (!force && !store.wantsSave()) return Promise.resolve();
        // Both take the sync as it is now: the token is of what gets saved.
        const saved = save(true);
        const token = store.getSavedSyncToken();
        return saved.then(async () => {
            // Sliding sync keeps another store, and has no such request.
            const saving = isSlidingSyncEnabled(userId) ? null : await token;
            try {
                const tokens: Record<string, string> =
                    JSON.parse(
                        localStorage.getItem(SAVED_SYNC_TOKEN_KEY) ?? "null",
                    ) ?? {};
                const key = \`\${userId}|\${deviceId}\`;
                if (saving) tokens[key] = saving;
                else delete tokens[key];
                localStorage.setItem(
                    SAVED_SYNC_TOKEN_KEY,
                    JSON.stringify(tokens),
                );
            } catch {
                // No storage: the shell's request goes unsent or unused.
            }
        });
    };
}

function getSyncDbName(userId: string, deviceId: string): string {`,
      marker: "function connectAtLaunch(",
    },
    {
      kinds: program,
      contains: "function createAuthenticatedClient(",
      from: `              dbName: getSyncDbName(opts.userId, opts.deviceId),
          })
        : null;
`,
      to: `              dbName: getSyncDbName(opts.userId, opts.deviceId),
          })
        : null;
    if (store) connectAtLaunch(store, opts.userId, opts.deviceId);
`,
      marker: "if (store) connectAtLaunch(store, opts.userId, opts.deviceId);",
    },
  ]);
}
