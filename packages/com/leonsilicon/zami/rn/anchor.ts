/** What a `View` ref holds that this needs. */
interface Measurable {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
}

/**
 * A view's on-screen box as the element Zam's anchoring helpers expect: they take an
 * `HTMLElement` and only call its `getBoundingClientRect()` (`openProfileCard(userId,
 * el)`, popover placement). Resolves once React Native has measured the view.
 *
 *   anchorElement(rowRef.current).then((el) => openProfileCard(userId, el));
 */
export function anchorElement(view: Measurable | null): Promise<HTMLElement> {
  return new Promise((resolve) => {
    const box = (x: number, y: number, width: number, height: number) =>
      ({
        getBoundingClientRect: () => ({
          x,
          y,
          left: x,
          top: y,
          width,
          height,
          right: x + width,
          bottom: y + height,
          toJSON: () => ({ x, y, width, height }),
        }),
      }) as unknown as HTMLElement;
    if (view === null) resolve(box(0, 0, 0, 0));
    else view.measureInWindow((x, y, width, height) => resolve(box(x, y, width, height)));
  });
}
