export const SCREENSHOT_APP_ID = "com.leonsilicon.zami.screenshots";
export const SCREENSHOT_SCHEME = "zami-screenshots";

export const studioName = "Fieldwork Studio";
export const studioId = "!fieldwork:screenshots.invalid";
export const conversationName = "Weekend";
export const conversationId = "!weekend:screenshots.invalid";

export const screenshotScenes = [
  { id: "conversation", ready: { text: "I’ll bring the printed maps." } },
  { id: "spaces", ready: { text: "Your rooms", role: "AXHeading" } },
  { id: "privacy", ready: { text: "Muted phrases", role: "AXStaticText" } },
] as const;

export type ScreenshotScene = (typeof screenshotScenes)[number]["id"];

export function screenshotLink(scene: ScreenshotScene): string {
  return `${SCREENSHOT_SCHEME}://capture/${scene}`;
}

export function screenshotSceneFromLink(link: string): ScreenshotScene | undefined {
  try {
    const url = new URL(link);
    if (url.protocol !== `${SCREENSHOT_SCHEME}:` || url.host !== "capture") return;
    return screenshotScenes.find(({ id }) => url.pathname === `/${id}`)?.id;
  } catch {
    return undefined;
  }
}
