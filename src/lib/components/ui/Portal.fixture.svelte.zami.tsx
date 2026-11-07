import { Text, View } from "react-native";
import { t } from "$lib/i18n";
import Portal from "$lib/components/ui/Portal.svelte";

// The marker view stands in for a transformed ancestor (the mobile drawer):
// what a portal changes is where its content renders, not its layout.
export default function PortalFixture() {
    return (
        <View testID="origin">
            <Portal>
                <View testID="portaled">
                    <Text>{t("portal.fixture.hello")}</Text>
                </View>
            </Portal>
        </View>
    );
}
