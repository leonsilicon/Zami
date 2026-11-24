import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

const program = ["program"];

export default function codemod(root: SgRoot): string | null {
  return editNodes(root, [
    {
      kinds: program,
      contains: "function getSyncDbName(",
      from: `function getSyncDbName(userId: string, deviceId: string): string {`,
      to: `/**
 * Clearing a room's stored members when it has none throws in the SDK's
 * IndexedDB backend (its delete range is built from the keys it finds), and
 * the store answers any failure by deleting the whole saved sync. Two loads
 * of one room's members race into that: both see the stored copy, and the
 * second clear finds nothing. So clears run one at a time, and only for a
 * room that still has a copy.
 */
function keepSyncCacheOnMemberClear(store: IndexedDBStore): void {
    const clear = store.clearOutOfBandMembers;
    let queue: Promise<unknown> = Promise.resolve();
    store.clearOutOfBandMembers = (roomId: string): Promise<void> => {
        const cleared = queue.then(async () => {
            if ((await store.getOutOfBandMembers(roomId)) !== null)
                await clear(roomId);
        });
        queue = cleared.catch(() => {});
        return cleared;
    };
}

function getSyncDbName(userId: string, deviceId: string): string {`,
      marker: "function keepSyncCacheOnMemberClear(",
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
    if (store) keepSyncCacheOnMemberClear(store);
`,
      marker: "if (store) keepSyncCacheOnMemberClear(store);",
    },
  ]);
}
