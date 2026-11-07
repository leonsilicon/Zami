import { Pressable, Text, TextInput } from "react-native";
import { t } from "$lib/i18n";
// Test-only host for ModalDialog: `mount()` cannot construct a snippet, so
// the children live here. Not referenced by application code.
import ModalDialog from "./ModalDialog.svelte";

export default function ModalDialogFixture({
    onClose,
    labelledBy = undefined,
    label = undefined,
    handlesEscape = true,
    layerClass = undefined,
    panelClass = undefined,
    onKeydown = undefined,
    nominate = false,
}: {
    onClose: () => void;
    labelledBy?: string;
    label?: string;
    handlesEscape?: boolean;
    layerClass?: string;
    panelClass?: string;
    onKeydown?: (event: KeyboardEvent) => void;
    nominate?: boolean;
}) {
    return (
        <ModalDialog
            onClose={onClose}
            labelledBy={labelledBy}
            label={label}
            handlesEscape={handlesEscape}
            layerClass={layerClass}
            panelClass={panelClass}
            onKeydown={onKeydown}
        >
            <Text nativeID="fixture-title" accessibilityRole="header">
                {t("modalDialog.fixture.fixtureDialog")}
            </Text>
            <Pressable nativeID="fixture-close" accessibilityRole="button">
                <Text>{t("common.close")}</Text>
            </Pressable>
            {/* Zami: `data-autofocus` (the focus trap's first-focus hint) → autoFocus. */}
            {nominate ? (
                <TextInput nativeID="fixture-search" autoFocus />
            ) : (
                <TextInput nativeID="fixture-search" />
            )}
        </ModalDialog>
    );
}
