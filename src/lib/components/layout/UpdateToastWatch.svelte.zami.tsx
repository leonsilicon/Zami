// Mobile counterpart to UpdateBanner. On mobile the inline banner lives in
// the sidebar's profile footer, which is a drawer — so a one-shot toast is
// the only update prompt. Fires once each time the phase turns actionable
// (available / downloaded / unsupported), reusing the banner's own label
// and action. Renders nothing; always mounted so it works in both layouts.
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useRef } from "react";
import {
    updateBannerState,
    bannerView,
    runBannerAction,
} from "$lib/stores/updateBanner.svelte";
import { interfaceState } from "$lib/stores/interface.svelte";
import { showToast } from "$lib/stores/toasts.svelte";
import { shouldFireUpdateToast } from "$lib/utils/updateToast";
import { settingsState } from "$lib/stores/settings.svelte";
import type { UpdatePhase } from "$lib/utils/updateStatus";

export default function UpdateToastWatch() {
    const prevPhase = useRef<UpdatePhase>("idle");

    const phase = useRune(() => updateBannerState.status.phase);
    const mobile = useRune(() => interfaceState.isMobile);
    const updateNagDisabled = useRune(() => settingsState.updateNagDisabled);
    useEffect(() => {
        if (
            !updateNagDisabled &&
            shouldFireUpdateToast(prevPhase.current, phase, mobile)
        ) {
            const view = bannerView();
            const action =
                view.action !== "none" && view.actionLabel
                    ? {
                          label: view.actionLabel,
                          run: () => void runBannerAction(),
                      }
                    : undefined;
            showToast(view.label, { tone: "accent", action });
        }
        prevPhase.current = phase;
    }, [phase, mobile, updateNagDisabled]);

    return null;
}
