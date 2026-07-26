import { useEffect, useRef, type RefObject } from "react";

// Shared popup dismiss idiom: while `open`, close on a click outside every
// given ref (popup + its trigger) and, unless disabled, on Escape. Surfaces
// that own Escape themselves (the reader's keydown priority order) or have no
// Escape behavior (home's advanced panel) pass { escape: false }.
export function usePopupDismiss(
  open: boolean,
  refs: RefObject<HTMLElement | null>[],
  onClose: () => void,
  options: { escape?: boolean } = {}
): void {
  const { escape = true } = options;
  // Latest values for the listeners, so the effect only re-runs on open/escape
  // and never leaks a stale closure (refs arrays and callbacks are fresh per render).
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocClick = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (refsRef.current.every((ref) => !ref.current?.contains(target))) {
        onCloseRef.current();
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    };
    document.addEventListener("click", onDocClick);
    if (escape) {
      document.addEventListener("keydown", onKey);
    }
    return () => {
      document.removeEventListener("click", onDocClick);
      if (escape) {
        document.removeEventListener("keydown", onKey);
      }
    };
  }, [open, escape]);
}
