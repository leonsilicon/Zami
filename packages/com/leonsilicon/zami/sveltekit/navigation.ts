// `$app/navigation`, for the single page Zam has: navigating only changes `page.url`.
import { ORIGIN, page } from "#page.svelte";

function toUrl(url: string | URL): URL {
  return new URL(url, page.url.href.startsWith(ORIGIN) ? page.url : `${ORIGIN}/`);
}

export async function goto(
  url: string | URL,
  options: { replaceState?: boolean; state?: Record<string, unknown> } = {},
): Promise<void> {
  page.url = toUrl(url);
  page.route = { id: page.url.pathname };
  if (options.state !== undefined) page.state = options.state;
}

export function replaceState(url: string | URL, state: Record<string, unknown>): void {
  page.url = toUrl(url === "" ? page.url : url);
  page.state = state;
}
