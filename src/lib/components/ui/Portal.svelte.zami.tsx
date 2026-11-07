import { Portal as RootPortal } from "@-/com.leonsilicon.zami.rn";
import type { ReactNode } from "react";

interface Props {
    children?: ReactNode;
}

// Zam's Portal moves its node to the end of `document.body`; here the app root's
// <PortalHost /> renders the children instead, above the whole app. Portals nest: a
// Portal inside one renders its children as another layer there.
export default function Portal({ children }: Props) {
    return <RootPortal>{children}</RootPortal>;
}
