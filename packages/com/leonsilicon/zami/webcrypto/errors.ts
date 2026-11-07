/** The DOMException names WebCrypto rejects with (it rejects with TypeErrors too). */
export type CryptoErrorName =
  | "DataError"
  | "InvalidAccessError"
  | "NotSupportedError"
  | "OperationError"
  | "SyntaxError";

type DOMExceptionConstructor = new (message: string, name: string) => Error;

/**
 * Stands in for DOMException where there's none, as in Hermes: an Error with the name a
 * browser's DOMException would have, which is what callers check.
 */
class CryptoError extends Error {
  constructor(message: string, name: CryptoErrorName) {
    super(message);
    this.name = name;
  }
}

/** The error WebCrypto rejects with: the platform's DOMException when it has one. */
export function cryptoError(name: CryptoErrorName, message: string): Error {
  const { DOMException } = globalThis as { DOMException?: DOMExceptionConstructor };
  return DOMException === undefined
    ? new CryptoError(message, name)
    : new DOMException(message, name);
}
