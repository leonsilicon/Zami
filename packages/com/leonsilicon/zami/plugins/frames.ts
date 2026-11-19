// `zam.frames` for the pages the app embeds in WebViews (a YouTube player, a plugin's own
// `<iframe>`). Zam's desktop app does this in Electron's main process; here whatever
// shows a WebView asks `frameRulesFor(url)` when it loads one and applies the answer:
// the script goes in as injected JavaScript, the referrer as the address of the page
// that holds the frame (or the request's Referer).

export interface FrameRule {
  urlPrefixes: string[];
  script?: string;
  referrer?: string;
}

interface OwnedRule extends FrameRule {
  owner: string;
}

const rules: OwnedRule[] = [];

/** An absolute http(s) URL that names at least a whole origin (`https://example.com/`). */
function namesOrigin(url: string): boolean {
  if (!/^https?:\/\/[^/?#\s]+\//i.test(url)) return false;
  try {
    void new URL(url);
    return true;
  } catch {
    return false;
  }
}

/** Whether `script` parses: one that doesn't would take every other rule's script with it. */
function parses(script: string): boolean {
  try {
    // oxlint-disable-next-line typescript/no-implied-eval, no-new-func -- parsed, never called
    new Function(script);
    return true;
  } catch {
    return false;
  }
}

/** Adds a plugin's rule. Returns what removes it. A rule that can't apply is refused. */
export function addFrameRule(owner: string, rule: FrameRule): () => void {
  const urlPrefixes = (rule.urlPrefixes ?? []).map(String);
  const refuse = (why: string): (() => void) => {
    console.error(`[zam] plugin ${owner}: frame rule refused (${why})`);
    return () => {};
  };
  if (urlPrefixes.length === 0 || !urlPrefixes.every(namesOrigin))
    return refuse('each URL prefix must name a whole origin, e.g. "https://example.com/"');
  if (rule.referrer !== undefined && !namesOrigin(String(rule.referrer)))
    return refuse('the referrer must be an absolute http(s) URL, e.g. "https://example.com/"');
  if (rule.script !== undefined && !parses(String(rule.script)))
    return refuse("its script doesn't parse");
  const owned: OwnedRule = {
    owner,
    urlPrefixes,
    ...(rule.script !== undefined && { script: String(rule.script) }),
    ...(rule.referrer !== undefined && { referrer: String(rule.referrer) }),
  };
  rules.push(owned);
  return () => {
    const index = rules.indexOf(owned);
    if (index !== -1) rules.splice(index, 1);
  };
}

export interface FrameSetup {
  /**
   * JavaScript for the WebView to inject into every frame it loads: each matching rule's
   * script, run only in the frames whose address the rule names.
   */
  script?: string;
  /** The first matching rule's referrer. */
  referrer?: string;
}

/** What the rules say for a frame about to load `url`. */
export function frameRulesFor(url: string | null | undefined): FrameSetup {
  if (!url) return {};
  const matching = rules.filter((rule) =>
    rule.urlPrefixes.some((prefix) => url.startsWith(prefix)),
  );
  if (matching.length === 0) return {};
  const scripts = matching
    .filter((rule) => rule.script !== undefined)
    .map(
      (rule) =>
        // Not wrapped in a function: a script's top-level `var`s are the page's globals.
        `if(${JSON.stringify(rule.urlPrefixes)}.some(function(p){return location.href.indexOf(p)===0})){try{\n${rule.script}\n}catch(e){console.error(e)}}`,
    );
  return {
    ...(scripts.length > 0 && { script: `${scripts.join("\n")}\ntrue;` }),
    referrer: matching.find((rule) => rule.referrer !== undefined)?.referrer,
  };
}
