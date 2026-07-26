// Full-screen curtain wipe for home↔auth navigation. The panel (.route-curtain
// in base.css) sweeps left→right with a 30° leading edge (skewX(-30deg)); the
// route commits at full cover so the page swap is never visible. WAAPI like the
// shell's animateIn — compositor-only, no layout work.
//
// The 60vh side overhang (base.css) covers the skew's horizontal offset, so the
// panel fully covers the viewport at translateX(0) and is fully off-screen at
// translateX(±100%).

const COVER_MS = 420;
// Held at full cover (the cover animation fills forwards) while React commits
// and paints the new route.
const DWELL_MS = 140;
const REVEAL_MS = 460;
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
    { duration: COVER_MS, easing: "cubic-bezier(0.4, 0, 0.7, 1)", fill: "forwards" }
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
        easing: "cubic-bezier(0.3, 0, 0.2, 1)",
        fill: "forwards",
      }
    );
    reveal.onfinish = done;
    reveal.oncancel = done;
  };
}
