// Subtle enter animation for a freshly-rendered route. Web Animations re-triggers
// on every call without a reflow hack and is a no-op under reduced motion.
export function animateIn(el: HTMLElement): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  el.animate(
    [
      { opacity: 0, transform: "translateY(6px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 200, easing: "ease-out" }
  );
}
