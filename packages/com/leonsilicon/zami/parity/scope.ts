// What view recipes can reach in the app they run in. Every import names an upstream
// module: Zam's build (Vite) resolves it to Zam's file and the Zami app (Metro) to its
// `.zami.` version, so a recipe changes the same state in both apps. `$lib` is Zam's
// tree, which the bundlers resolve, not a dependency.
/* oxlint-disable flatcap/no-undeclared-dependencies */
export { t } from "$lib/i18n";
export { getClient } from "$lib/matrix/client";
export { auth, saveSession } from "$lib/stores/auth.svelte";
export { openInviteDialog } from "$lib/stores/inviteDialog.svelte";
export {
  closeModal,
  closeSidebar,
  interfaceState,
  openAppSettingsTab,
  openComposerActions,
  openComposerPicker,
  openModal,
  openSidebar,
} from "$lib/stores/interface.svelte";
export { openShareLocationDialog } from "$lib/stores/locationDialog.svelte";
export { openEncryptionSetup } from "$lib/stores/onboarding.svelte";
export { openCreatePollDialog } from "$lib/stores/pollDialog.svelte";
export {
  navigateToRoom,
  openDraftDm,
  roomsState,
  setActiveRoom,
  setActiveSpace,
  showSpaceHome,
} from "$lib/stores/rooms.svelte";
export { roomSettingsTabLabel } from "$lib/utils/roomSettingsNav";
export { settingsTabLabel } from "$lib/utils/settingsNav";
