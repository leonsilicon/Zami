const STORAGE_KEY = "zami-muted-phrases";

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

function readMutedPhrases(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

const state = $state({ phrases: readMutedPhrases() });
const terms = $derived(
  state.phrases
    .split("\n")
    .map((line) => normalize(line.trim()))
    .filter(Boolean),
);

export const contentFilter = {
  get phrases(): string {
    return state.phrases;
  },
};

export function setMutedPhrases(phrases: string): void {
  state.phrases = phrases;
  try {
    localStorage.setItem(STORAGE_KEY, phrases);
  } catch {
    // Keep the current session’s filter if device storage is unavailable.
  }
}

export function matchesMutedPhrase(text: string): boolean {
  if (terms.length === 0 || !text) return false;
  const value = normalize(text);
  return terms.some((term) => value.includes(term));
}
