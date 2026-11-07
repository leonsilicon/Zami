// The browser globals Zam's code reads (window, document, navigator, location), which
// Metro points at Zami's stand-ins in Zam's tree. Defined before any of Zam's modules
// load, after the polyfills they may use.
import { installBrowserGlobals } from "@-/com.leonsilicon.zami.browser";

installBrowserGlobals();
