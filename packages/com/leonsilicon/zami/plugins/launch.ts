// Apply the account's registered home before Zam restores its last room. While the
// session opens, show a spinner. The mounted shell owns the first interactive screen.
import { patchComponent } from "#components";
import { landOnHome, pruneHomes, readHome } from "#home";
import LaunchSplash from "#launch-splash";
import { importModule, requireModule } from "#registry";

interface Account {
  userId: string;
}

interface AuthModule {
  auth: { userId: string | null };
  loadStoredSession(): Account | null;
}

/** The account that's signed in, or about to be restored. */
export function activeUserId(): string | null {
  try {
    const module = requireModule("$lib/stores/auth.svelte") as unknown as AuthModule;
    return module.auth.userId ?? module.loadStoredSession()?.userId ?? null;
  } catch {
    return null;
  }
}

async function applyRegisteredHome(): Promise<void> {
  await importModule("$lib/stores/auth.svelte");
  const userId = activeUserId();
  // Adding an account or returning from OAuth shows the sign-in form.
  const parameters = new URLSearchParams(location.search);
  if (!userId || parameters.has("add") || parameters.has("state")) return;
  const home = readHome(localStorage, userId);
  if (home) landOnHome(localStorage, userId, home);
}

async function pruneSignedOutHomes(): Promise<void> {
  const module = await importModule("$lib/stores/accounts.svelte");
  const { registry } = module.accountsState as { registry: { accounts: Account[] } };
  const userIds = registry.accounts.map((account) => account.userId);
  if (userIds.length > 0 || !activeUserId()) pruneHomes(localStorage, userIds);
}

/** Prepares session restore and keeps the splash available until the shell mounts. */
export async function startLaunch(): Promise<void> {
  // Remove the obsolete HTML snapshot cache. An older tab can hold the database
  // open, so its deletion runs independently of startup.
  try {
    indexedDB.deleteDatabase("zami-launch");
  } catch {
    // Storage may be unavailable.
  }

  try {
    await applyRegisteredHome();
  } catch (error) {
    console.error("[zami] couldn't restore the registered home", error);
  }

  try {
    const { t } = (await importModule("$lib/i18n/index")) as {
      t(this: void, key: string): string;
    };
    const splash = "$lib/components/layout/Splash.svelte";
    const login = "$lib/components/layout/LoginView.svelte";
    await Promise.all([importModule(splash), importModule(login)]);
    patchComponent(
      splash,
      (Original) => (anchor, props) =>
        LaunchSplash(anchor, { Original, label: t("common.loading"), props }),
    );
    patchComponent(login, (Original) => (anchor, props) => {
      void pruneSignedOutHomes().catch((error: unknown) => {
        console.error("[zami] couldn't remove homes for signed-out accounts", error);
      });
      return Original(anchor, props);
    });
  } catch (error) {
    console.error("[zami] couldn't prepare the startup views", error);
  }
}
