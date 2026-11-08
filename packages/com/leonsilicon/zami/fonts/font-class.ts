// Which Tailwind classes choose a text's font family, without React Native.

// Tailwind's family utilities that choose their own family, with any variant or `!`:
// `font-mono` and arbitrary `font-[…]`. `font-sans` doesn't: on React Native it's the
// system's font (src/app.zami.css), which the app's font replaces as it does for all text.
const FAMILY_CLASS = /(?:^|[\s:!])font-(?:mono|serif|\[)/;

// Tailwind's size utilities, with any variant or `!`: `text-xs` … `text-9xl` and lengths
// in brackets (`text-[10px]`, `text-[0.625rem]`), not bracketed colors (`text-[#fff]`).
const SIZE_CLASS =
  /(?:^|[\s:!])text-(?:xs|sm|base|lg|xl|[2-9]xl|\[(?:length:)?[\d.]+(?:px|rem|em|%)?\])(?=$|\s)/;

/** Whether `className` sets a font size. */
export function classChoosesSize(className: string | undefined): boolean {
  return className !== undefined && SIZE_CLASS.test(className);
}

/** Whether `className` picks a font family other than the app's. */
export function classChoosesFamily(className: string | undefined): boolean {
  return className !== undefined && FAMILY_CLASS.test(className);
}
