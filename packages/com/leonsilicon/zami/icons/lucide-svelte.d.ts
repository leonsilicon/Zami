// The types of `lucide-svelte` in the Zami app: lucide-react-native's icons, which also
// take a `className` for their size and color (see icon.tsx).
// oxlint-disable-next-line flatcap/public-entrypoints -- it stands in for lucide-svelte, every one of whose icons is an export.
export * from "lucide-react-native";

declare module "lucide-react-native" {
  interface LucideProps {
    /** Tailwind classes: `w-*`/`h-*` size the icon, a `text-*` color colors it. */
    className?: string;
  }
}
