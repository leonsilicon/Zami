import { Alert } from "react-native";

export interface ConfirmAlertOptions {
  /** The confirming button's text. Defaults to "OK", as the browser's. */
  confirmText?: string;
  /** The cancelling button's text. Defaults to "Cancel". */
  cancelText?: string;
  /** Show the confirming button as destructive (red on iOS), as for a delete. */
  destructive?: boolean;
}

/**
 * `confirm(message)` as a native alert: resolves true when the user confirms, and false
 * when they cancel or dismiss it. Pass the button texts translated (`t("common.delete")`).
 */
export function confirmAlert(
  message: string,
  { confirmText = "OK", cancelText = "Cancel", destructive = false }: ConfirmAlertOptions = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      message,
      undefined,
      [
        { text: cancelText, style: "cancel", onPress: () => resolve(false) },
        {
          text: confirmText,
          style: destructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
