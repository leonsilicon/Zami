// First, so the launch timeline starts as early as the app's JS does.
import "@-/com.leonsilicon.zami.startup";
import "#polyfills";
import "#blob";
import "#globals";
import "#fonts";
import "#media";
import "#calls";
import "#notifications";
import { parityRoot } from "@-/com.leonsilicon.zami.parity/native";
import { registerRootComponent } from "expo";
import { LogBox } from "react-native";
import { Root } from "#root";

// Zam logs many warnings (push rule notices, sync diagnostics). They still reach Metro's
// console; the toasts they'd stack over the composer don't help on a phone screen.
if (__DEV__) LogBox.ignoreAllLogs();

// `vpx _parity` launches debug builds as Zam's reference or with its agent; otherwise Root.
registerRootComponent(parityRoot(Root));
