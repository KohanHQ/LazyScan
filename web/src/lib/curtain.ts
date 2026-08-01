// Full-screen curtain wipe for home↔auth navigation. The panel (.route-curtain
// in components.css) sweeps left→right with a 30° leading edge (skewX(-30deg)); the
// route commits at full cover so the page swap is never visible. WAAPI like the
// shell's animateIn — compositor-only, no layout work.
//
// The 60vh side overhang (components.css) covers the skew's horizontal offset, so the
// panel fully covers the viewport at translateX(0) and is fully off-screen at
// translateX(±100%).

const COVER_MS = 440;
// Held at full cover (the cover animation fills forwards) while React commits
// and paints the new route. Raise this if a heavier route ever flashes.
const DWELL_MS = 120;
const REVEAL_MS = 480;
// Both halves of the wipe share easeInOutCubic: the cover decelerates into
// the hold and the reveal accelerates out of it, so the wipe reads as one
// continuous pass instead of accelerate → hard stop → re-accelerate.
const EASE = "cubic-bezier(0.65, 0, 0.35, 1)";
const SKEW = " skewX(-30deg)";

let active = false;

export function curtainWipe(midpoint: () => void): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    midpoint();
    return;
  }
  // A second navigation mid-wipe commits instantly instead of queueing.
  if (active) {
    midpoint();
    return;
  }
  active = true;

  const el = document.createElement("div");
  el.className = "route-curtain";
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);

  const done = () => {
    el.remove();
    active = false;
  };

  const cover = el.animate(
    [
      { transform: `translateX(-100%)${SKEW}` },
      { transform: `translateX(0%)${SKEW}` },
    ],
    { duration: COVER_MS, easing: EASE, fill: "forwards" }
  );
  cover.oncancel = done;
  cover.onfinish = () => {
    midpoint();
    const reveal = el.animate(
      [
        { transform: `translateX(0%)${SKEW}` },
        { transform: `translateX(100%)${SKEW}` },
      ],
      {
        delay: DWELL_MS,
        duration: REVEAL_MS,
        easing: EASE,
        fill: "forwards",
      }
    );
    reveal.onfinish = done;
    reveal.oncancel = done;
  };
}
