import { Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { t } from "$lib/i18n";
import { qrModulePath, qrViewBoxSize } from "$lib/utils/qrCode";

interface QrSymbol {
    /** Side length, in modules. */
    size: number;
    /** Row-major bit matrix, non-zero = dark. */
    data: ArrayLike<number>;
}

// Zami: not ported: the encoder. Zam uses the `qrcode` package
// (`QRCode.create([{ mode: "byte", data: bytes }], { errorCorrectionLevel: "L" })`,
// whose `.modules` is this `QrSymbol`), which isn't installed in Zami yet, so no
// symbol is made and the component shows its "could not render" text. Once it is,
// return `qr.modules` here.
function createQrSymbol(_bytes: Uint8ClampedArray): QrSymbol | null {
    return null;
}

export default function QrCodeImage({
    bytes,
    label = t("qrCodeImage.qrCodeForDeviceVerification"),
}: {
    bytes: Uint8ClampedArray;
    label?: string;
}) {
    // `QRCode.create` is synchronous, so this stays a plain derived value. Error
    // correction "L" keeps the symbol small: the Matrix payload is ~100 bytes
    // and a denser symbol is harder to scan on a phone at arm's length.
    const symbol = (() => {
        // An empty payload does NOT throw: the encoder happily emits a valid
        // 21x21 symbol with real finder patterns, so the catch below never fires
        // and the user would stare at a code that can never verify. Refuse it
        // here, symmetrically with `toQrPayloadBytes` on the scanning side.
        if (bytes.length === 0) return null;
        try {
            const modules = createQrSymbol(bytes);
            if (!modules) return null;
            const box = qrViewBoxSize(modules.size);
            const path = qrModulePath(modules.size, modules.data);
            return path && box ? { path, box } : null;
        } catch (e) {
            // Log the raw encoder error the way crypto.ts's
            // `verificationFailureText` does: the copy below is deliberately
            // vague, so without this a bug report has nothing to go on.
            console.warn("[matrix] could not encode the verification QR", e);
            return null;
        }
    })();

    if (symbol)
        return (
            // Fixed light background with dark modules in BOTH themes: an inverted
            // QR (light modules on a dark field) is rejected by many scanners.
            <View
                role="img"
                accessibilityLabel={label}
                className="h-48 w-48 rounded bg-white p-2"
            >
                {/* Zami: react-native-svg has no `shape-rendering="crispEdges"`. */}
                <Svg
                    width="100%"
                    height="100%"
                    viewBox={`0 0 ${symbol.box} ${symbol.box}`}
                >
                    <Path d={symbol.path} fill="#000000" />
                </Svg>
            </View>
        );
    return (
        <Text role="alert" className="text-xs text-discord-danger">
            {t("qrCodeImage.couldNotRenderTheVerificationCode")}
        </Text>
    );
}
