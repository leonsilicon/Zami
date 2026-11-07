// Which Tailwind classes choose a text's font family, without React Native.

// Tailwind's family utilities that choose their own family, with any variant or `!`:
// `font-mono` and arbitrary `font-[…]`. `font-sans` doesn't: on React Native it's the
// system's font (src/app.zami.css), which the app's font replaces as it does for all text.
const FAMILY_CLASS = /(?:^|[\s:!])font-(?:mono|serif|\[)/;

/** Whether `className` picks a font family other than the app's. */
export function classChoosesFamily(className: string | undefined): boolean {
  return className !== undefined && FAMILY_CLASS.test(className);
}
