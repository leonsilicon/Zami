import "#polyfills";
import "#blob";
import "#globals";
import "#fonts";
import "#media";
import "#calls";
import "#notifications";
import { registerRootComponent } from "expo";
import { LogBox } from "react-native";
import { Root } from "#root";

// Zam logs many warnings (push rule notices, sync diagnostics). They still reach Metro's
// console; the toasts they'd stack over the composer don't help on a phone screen.
if (__DEV__) LogBox.ignoreAllLogs();

registerRootComponent(Root);
