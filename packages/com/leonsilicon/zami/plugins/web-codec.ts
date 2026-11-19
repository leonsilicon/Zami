// How values cross between the app and a web context's page: copied, as `postMessage`
// copies them, into JSON. The same code has to run on both sides (the app's Hermes and the
// page's browser engine), and the page gets code as text, so the codec is JavaScript
// source: the app evaluates it once (`codec()`), and the page's bridge embeds it
// (#web-bridge). Hermes keeps no source for its functions, so `toString()` of a function
// written here in TypeScript would give the page nothing to run.
//
// What it copies: JSON values, `undefined`, `NaN`, the infinities, `-0`, bigints, Dates,
// RegExps, Errors (name, message, stack), Maps, Sets, ArrayBuffers, typed arrays and
// DataViews, nested in arrays and objects however deep, with cycles and repeated
// references kept (an object that appears twice arrives as one object). Anything else (a
// function, a symbol, a Blob, a class instance's prototype) is the page's or the app's
// alone: functions and symbols throw a DataCloneError, as `postMessage` does, and an
// object arrives as a plain object of its own enumerable properties.
//
// Bytes travel as base64, a third larger than they are. A typed array or DataView sends
// only the bytes it views and arrives over a buffer of its own: sending a small view of a
// large buffer (a WebAssembly memory's) doesn't send the buffer, and two views of one
// buffer no longer share it.

/** The copy codec: `encode` to a JSON value, `decode` back. */
export interface Codec {
  /** Throws a DataCloneError for what can't be copied. */
  encode(value: unknown): unknown;
  /** `buffers`, when given, collects every ArrayBuffer made for the result (to transfer). */
  decode(encoded: unknown, buffers?: ArrayBuffer[]): unknown;
}

/**
 * The codec as a JavaScript expression (an immediately called function). It is written
 * for both engines: no syntax or built-in newer than Hermes has, and nothing it reads
 * from outside itself but the globals both have.
 */
export const CODEC_SOURCE = `(function () {
  "use strict";
  var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var tagOf = Object.prototype.toString;
  var own = Object.prototype.hasOwnProperty;

  function cloneError(what) {
    var error = new Error(what + " could not be cloned.");
    error.name = "DataCloneError";
    return error;
  }

  // btoa and atob take and give a "binary string" (a char per byte). The bytes become one
  // a chunk at a time: a call can't take millions of arguments.
  function toBase64(bytes) {
    if (typeof bytes.toBase64 === "function") return bytes.toBase64();
    if (typeof btoa === "function") {
      var binary = "";
      for (var at = 0; at < bytes.length; at += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
      }
      return btoa(binary);
    }
    var out = "";
    var i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      var triple = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += ALPHABET[triple >> 18] + ALPHABET[(triple >> 12) & 63] +
        ALPHABET[(triple >> 6) & 63] + ALPHABET[triple & 63];
    }
    var rest = bytes.length - i;
    if (rest === 1) {
      out += ALPHABET[bytes[i] >> 2] + ALPHABET[(bytes[i] & 3) << 4] + "==";
    } else if (rest === 2) {
      var pair = (bytes[i] << 8) | bytes[i + 1];
      out += ALPHABET[pair >> 10] + ALPHABET[(pair >> 4) & 63] + ALPHABET[(pair & 15) << 2] + "=";
    }
    return out;
  }

  var lookup = null;
  function fromBase64(text) {
    if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(text);
    if (typeof atob === "function") {
      var binary = atob(text);
      var bytes = new Uint8Array(binary.length);
      for (var at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
      return bytes;
    }
    if (lookup === null) {
      lookup = new Uint8Array(128);
      for (var c = 0; c < 64; c++) lookup[ALPHABET.charCodeAt(c)] = c;
    }
    var padding = text.length > 1 && text[text.length - 2] === "=" ? 2
      : text.length > 0 && text[text.length - 1] === "=" ? 1 : 0;
    var length = (text.length / 4) * 3 - padding;
    var out = new Uint8Array(length);
    var o = 0;
    for (var i = 0; i < text.length; i += 4) {
      var quad = (lookup[text.charCodeAt(i)] << 18) | (lookup[text.charCodeAt(i + 1)] << 12) |
        (lookup[text.charCodeAt(i + 2) & 127] << 6) | lookup[text.charCodeAt(i + 3) & 127];
      if (o < length) out[o++] = quad >> 16;
      if (o < length) out[o++] = (quad >> 8) & 255;
      if (o < length) out[o++] = quad & 255;
    }
    return out;
  }

  /** A buffer holding exactly these bytes (a decoder may hand out a view of a larger one). */
  function bufferOf(bytes) {
    return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  function setKey(object, key, value) {
    // An assignment to "__proto__" would set the prototype, not a property.
    if (key === "__proto__") {
      Object.defineProperty(object, key, {
        value: value, writable: true, enumerable: true, configurable: true,
      });
    } else object[key] = value;
  }

  function encode(value) {
    // Each object's number, in the order they're met: a second meeting sends the number.
    var seen = new Map();
    function enc(v) {
      if (v === null) return null;
      var type = typeof v;
      if (type === "string" || type === "boolean") return v;
      if (type === "number") {
        if (v !== v) return { $: "n", v: "NaN" };
        if (v === Infinity) return { $: "n", v: "Infinity" };
        if (v === -Infinity) return { $: "n", v: "-Infinity" };
        if (v === 0 && 1 / v < 0) return { $: "n", v: "-0" };
        return v;
      }
      if (type === "undefined") return { $: "u" };
      if (type === "bigint") return { $: "i", v: String(v) };
      if (type !== "object") throw cloneError(type === "function" ? "A function" : "A " + type);
      var known = seen.get(v);
      if (known !== undefined) return { $: "r", v: known };
      seen.set(v, seen.size);
      var i;
      if (Array.isArray(v)) {
        var list = new Array(v.length);
        for (i = 0; i < v.length; i++) list[i] = enc(v[i]);
        return list;
      }
      var tag = tagOf.call(v);
      if (tag === "[object ArrayBuffer]" || tag === "[object SharedArrayBuffer]") {
        return { $: "b", v: toBase64(new Uint8Array(v)) };
      }
      if (ArrayBuffer.isView(v)) {
        return {
          $: "t",
          c: tag.slice(8, -1),
          v: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)),
        };
      }
      if (tag === "[object Date]") {
        var time = v.getTime();
        return { $: "d", v: time !== time ? null : time };
      }
      if (tag === "[object RegExp]") return { $: "x", s: v.source, f: v.flags };
      if (tag === "[object Map]") {
        var pairs = [];
        v.forEach(function (item, key) {
          pairs.push([enc(key), enc(item)]);
        });
        return { $: "m", v: pairs };
      }
      if (tag === "[object Set]") {
        var items = [];
        v.forEach(function (item) {
          items.push(enc(item));
        });
        return { $: "s", v: items };
      }
      if (tag === "[object Error]" || tag === "[object DOMException]") {
        return {
          $: "e",
          n: String(v.name),
          m: String(v.message),
          s: typeof v.stack === "string" ? v.stack : null,
        };
      }
      if (tag !== "[object Object]") throw cloneError("A " + tag.slice(8, -1));
      var copy = {};
      var keys = Object.keys(v);
      for (i = 0; i < keys.length; i++) setKey(copy, keys[i], enc(v[keys[i]]));
      // "$" marks the codec's own objects, so an object with that key is wrapped.
      return own.call(copy, "$") ? { $: "o", v: copy } : copy;
    }
    return enc(value);
  }

  function decode(encoded, buffers) {
    // The objects made so far, numbered as encode numbered them.
    var objects = [];
    function fields(target, source) {
      var keys = Object.keys(source);
      for (var i = 0; i < keys.length; i++) setKey(target, keys[i], dec(source[keys[i]]));
      return target;
    }
    function bytesOf(text) {
      var buffer = bufferOf(fromBase64(text));
      if (buffers) buffers.push(buffer);
      return buffer;
    }
    function dec(e) {
      if (e === null || typeof e !== "object") return e;
      var i;
      if (Array.isArray(e)) {
        var list = new Array(e.length);
        objects.push(list);
        for (i = 0; i < e.length; i++) list[i] = dec(e[i]);
        return list;
      }
      if (!own.call(e, "$")) {
        var plain = {};
        objects.push(plain);
        return fields(plain, e);
      }
      switch (e.$) {
        case "u":
          return undefined;
        case "n":
          return e.v === "NaN" ? NaN : e.v === "Infinity" ? Infinity : e.v === "-Infinity" ? -Infinity : -0;
        case "i":
          return BigInt(e.v);
        case "r":
          return objects[e.v];
        case "o": {
          var wrapped = {};
          objects.push(wrapped);
          return fields(wrapped, e.v);
        }
        case "b": {
          var buffer = bytesOf(e.v);
          objects.push(buffer);
          return buffer;
        }
        case "t": {
          var View = root[e.c];
          if (typeof View !== "function") throw cloneError("A " + e.c + " (which this side lacks)");
          var view = new View(bytesOf(e.v));
          objects.push(view);
          return view;
        }
        case "d": {
          var date = new Date(e.v === null ? NaN : e.v);
          objects.push(date);
          return date;
        }
        case "x": {
          var pattern = new RegExp(e.s, e.f);
          objects.push(pattern);
          return pattern;
        }
        case "m": {
          var map = new Map();
          objects.push(map);
          for (i = 0; i < e.v.length; i++) {
            var key = dec(e.v[i][0]);
            map.set(key, dec(e.v[i][1]));
          }
          return map;
        }
        case "s": {
          var set = new Set();
          objects.push(set);
          for (i = 0; i < e.v.length; i++) set.add(dec(e.v[i]));
          return set;
        }
        case "e": {
          var error = new Error(e.m);
          error.name = e.n;
          if (e.s !== null) error.stack = e.s;
          objects.push(error);
          return error;
        }
        default:
          throw cloneError("A value of an unknown kind (" + e.$ + ")");
      }
    }
    return dec(encoded);
  }

  return { encode: encode, decode: decode };
})()`;

let instance: Codec | undefined;

/** The codec, for this side. */
export function codec(): Codec {
  // oxlint-disable-next-line typescript/no-implied-eval, no-new-func -- the source above, shared with the page
  instance ??= new Function(`return ${CODEC_SOURCE};`)() as Codec;
  return instance;
}
