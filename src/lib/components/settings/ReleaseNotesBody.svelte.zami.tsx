import { Html } from "@-/com.leonsilicon.zami.rn";
import { parseMarkdown } from "$lib/utils/markdown";
import { sanitizeMatrixHtml } from "$lib/utils/sanitizeHtml";

export default function ReleaseNotesBody({ body }: { body: string }) {
    // First-party notes, but routed through the SAME parseMarkdown →
    // sanitizeMatrixHtml pipeline as user messages so the {@html} invariant
    // holds. Never {@html} the raw string.
    const html = body
        ? sanitizeMatrixHtml(parseMarkdown(body).formattedBody)
        : "";

    // Zami: not ported: the `whats-new-prose` styles for headings, lists, links,
    // code and pre blocks; Html styles its tags itself.
    return (
        <Html
            html={html}
            className="text-sm leading-relaxed text-discord-textPrimary"
        />
    );
}
