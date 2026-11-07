// Shared by the tests, which hold this package's subtle up against Node's.
import { expect } from "vite-plus/test";
import type { Subtle } from "#subtle";

/** Node's own WebCrypto, typed as ours: it takes everything ours does. */
export const node = globalThis.crypto.subtle as unknown as Subtle;

/** A subtle (ours or Node's) that takes anything, for calls that should reject. */
export type Loose = { [Method in keyof Subtle]: (...args: unknown[]) => Promise<unknown> };
export const loose = (subtle: Subtle): Loose => subtle as unknown as Loose;

/** Reproducible pseudo-random bytes (xorshift32). */
export function bytes(length: number, seed = 1): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  let state = Math.imul(seed, 0x9e37_79b1) >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out[i] = state & 0xff;
  }
  return out;
}

export function hex(data: ArrayBuffer | Uint8Array): string {
  return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString("hex");
}

export function fromHex(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(text.replaceAll(/\s+/g, ""), "hex"));
}

export const utf8 = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

/** What a promise rejects with; fails if it fulfills. */
export async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected a rejection");
}

/** Both reject, with the same kind of error: a TypeError, or a DOMException of a name. */
export async function expectSameRejection(
  ours: Promise<unknown>,
  nodes: Promise<unknown>,
): Promise<void> {
  const [mine, theirs] = await Promise.all([rejection(ours), rejection(nodes)]);
  expect({ name: mine.name, class: mine.constructor }).toEqual({
    name: theirs.name,
    class: theirs.constructor,
  });
}

/** Rejects with a DOMException of this name, as WebCrypto does. */
export async function expectDOMException(promise: Promise<unknown>, name: string): Promise<void> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(DOMException);
  expect(error.name).toBe(name);
}
