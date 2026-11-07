import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import { useEffect, useState } from "react";
import Avatar from "$lib/components/ui/Avatar.svelte";
import { auth } from "$lib/stores/auth.svelte";
import { accountMediaBlobUrl } from "$lib/stores/mediaAuth.svelte";
import type { StoredAccount } from "$lib/utils/accounts";

interface Props {
    account: StoredAccount;
    size?: number;
}

/**
 * Zami: expo-image can't load a `blob:` URL, so the blob behind the one
 * `accountMediaBlobUrl` made is read back (React Native's fetch resolves its own
 * blob URLs) into a `data:` URL, which it can, and the blob URL is let go.
 */
async function blobUrlToDataUrl(url: string): Promise<string | null> {
    try {
        const blob = await (await fetch(url)).blob();
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    } finally {
        URL.revokeObjectURL(url);
    }
}

export default function AccountAvatar({ account, size = 32 }: Props) {
    // The active account's media goes through the shared healer. Any other
    // account's cached avatar lives on ITS homeserver and needs ITS token, so
    // it is fetched as that account instead of going out token-less (or with
    // the active account's token, which is refused for a foreign origin).
    const isActive = useRune(() => account.userId === auth.userId, [account]);
    const [fetched, setFetched] = useState<string | null>(null);

    useEffect(() => {
        const url = account.avatarUrl;
        setFetched(null);
        if (isActive || !url) return;
        let cancelled = false;
        void accountMediaBlobUrl(url, account).then(async (u) => {
            if (cancelled) {
                if (u) URL.revokeObjectURL(u);
                return;
            }
            const made = u ? await blobUrlToDataUrl(u) : null;
            if (!cancelled) setFetched(made);
        });
        return () => {
            cancelled = true;
        };
    }, [account, isActive]);

    return (
        <Avatar
            src={isActive ? (account.avatarUrl ?? null) : fetched}
            name={account.displayName ?? account.userId}
            id={account.userId}
            size={size}
        />
    );
}
