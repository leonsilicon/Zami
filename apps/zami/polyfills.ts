// Web platform APIs Zam's code expects a browser to have, which Hermes lacks. They're
// installed here, before any of Zam's modules load, so the copied files don't change.
import "react-native-get-random-values";
import { installLocalStorage } from "@-/com.leonsilicon.zami.local-storage";
import { installWebCrypto } from "@-/com.leonsilicon.zami.webcrypto";
// i18n creates an Intl.PluralRules when it loads. Zam ships en, de, es, fr, ja and aii;
// CLDR has no plural data for aii, which then falls back to the default rule.
import "@formatjs/intl-getcanonicallocales/polyfill.js";
import "@formatjs/intl-locale/polyfill.js";
import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
import "@formatjs/intl-pluralrules/locale-data/de.js";
import "@formatjs/intl-pluralrules/locale-data/es.js";
import "@formatjs/intl-pluralrules/locale-data/fr.js";
import "@formatjs/intl-pluralrules/locale-data/ja.js";
// Zam formats relative timestamps (`<t:…:R>`) with Intl.RelativeTimeFormat.
import "@formatjs/intl-relativetimeformat/polyfill.js";
import "@formatjs/intl-relativetimeformat/locale-data/en.js";
import "@formatjs/intl-relativetimeformat/locale-data/de.js";
import "@formatjs/intl-relativetimeformat/locale-data/es.js";
import "@formatjs/intl-relativetimeformat/locale-data/fr.js";
import "@formatjs/intl-relativetimeformat/locale-data/ja.js";

// Hermes has crypto.getRandomValues (above) but no crypto.subtle, which matrix-js-sdk and
// Zam's logic use for encrypted attachments, secret storage, key backup passphrases and
// key export files.
installWebCrypto();

// localStorage, in expo-sqlite's database but served from memory: one query reads every item
// here, and changes are written in batches, never a query per call. Zam's settings read
// dozens of keys as they load, and some stores write on every event.
installLocalStorage();

// Zam's own polyfills (core-js built-ins, crypto.randomUUID), which Zam loads first in its
// SvelteKit client hook (src/hooks.client.ts); Zami has no hooks, so they load here.
import "$lib/polyfills";
