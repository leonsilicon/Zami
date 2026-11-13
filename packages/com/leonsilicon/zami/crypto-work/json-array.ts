// Room key lists (a key export, tens of MB for a large account) handled without one
// JSON.parse of the whole text.
import { createYielder } from "#yield";

/**
 * How many times `"key":` occurs in `json`: for a list of exported room keys and the key
 * "session_id", how many keys it holds. Inside a JSON string a quote is escaped (`\"`), so
 * the pattern only matches a real key.
 */
export async function countJsonKey(json: string, key: string, budgetMs = 8): Promise<number> {
  const needle = `"${key}":`;
  const maybeYield = createYielder(budgetMs);
  let count = 0;
  for (let i = json.indexOf(needle); i >= 0; i = json.indexOf(needle, i + needle.length)) {
    count++;
    if ((count & 1023) === 0) {
      const turn = maybeYield();
      if (turn) await turn;
    }
  }
  return count;
}

/** A part of a JSON array: itself a JSON array of whole elements. */
export interface JsonArrayPiece {
  text: string;
  count: number;
}

// Where one object element ends and the next begins.
const BETWEEN_OBJECTS = /\}\s*,\s*\{/g;

/**
 * Split the text of a JSON array of objects into pieces of about `targetChars`, each a JSON
 * array of whole elements, in order, giving the event loop a turn between pieces. Each piece
 * is checked with JSON.parse. A cut only ever falls between two elements: anywhere else (in a
 * string, or between objects nested deeper) it would leave a piece with an unclosed string or
 * bracket, which fails the check. Null when the text isn't such an array or a check fails: the
 * caller then handles the text whole, as before.
 */
export async function splitJsonArray(
  json: string,
  targetChars: number,
  budgetMs = 8,
): Promise<JsonArrayPiece[] | null> {
  const open = json.indexOf("[");
  const close = json.lastIndexOf("]");
  if (open < 0 || close < open) return null;
  if (json.slice(0, open).trim() !== "" || json.slice(close + 1).trim() !== "") return null;
  const maybeYield = createYielder(budgetMs);
  const pieces: JsonArrayPiece[] = [];
  const between = new RegExp(BETWEEN_OBJECTS);
  let from = open + 1;
  for (;;) {
    let cut = close;
    let next = -1;
    if (from + targetChars < close) {
      between.lastIndex = from + targetChars;
      const match = between.exec(json);
      if (match && match.index < close) {
        cut = match.index + 1;
        next = match.index + match[0].length - 1;
      }
    }
    const text = `[${json.slice(from, cut)}]`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;
    pieces.push({ text, count: parsed.length });
    if (next < 0) return pieces;
    from = next;
    const turn = maybeYield();
    if (turn) await turn;
  }
}
