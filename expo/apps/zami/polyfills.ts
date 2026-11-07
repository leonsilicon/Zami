// Web platform APIs Zam's code expects a browser to have, which Hermes lacks. They're
// installed here, before any of Zam's modules load, so the copied files don't change.
import "react-native-get-random-values";
import "expo-sqlite/localStorage/install";
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
