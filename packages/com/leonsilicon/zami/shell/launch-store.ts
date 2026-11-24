// Where the shell keeps the launch page between launches (launch-frame.ts): natively, so a
// launch reads it at once and puts it in the script the page runs first. The page's own
// storage would need the page's code to have loaded.
import Storage from "expo-sqlite/kv-store";
import { MAX_LAUNCH_PAGE_LENGTH } from "#launch-frame";

const KEY = "zami.launchPage";

/** The saved launch page (its JSON), read synchronously as the shell starts. */
export function readLaunchPage(): string | null {
  try {
    return Storage.getItemSync(KEY);
  } catch {
    // No page: the launch shows the app's own spinner.
    return null;
  }
}

/** Keeps `page` for the next launch; null forgets the one that's kept. */
export function saveLaunchPage(page: string | null): void {
  const saved =
    page === null || page.length > MAX_LAUNCH_PAGE_LENGTH
      ? Storage.removeItemAsync(KEY)
      : Storage.setItemAsync(KEY, page);
  void saved.catch((error: unknown) => {
    console.warn("[zami-shell] couldn't save the launch page", error);
  });
}
