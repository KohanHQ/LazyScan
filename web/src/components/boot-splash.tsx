import { useEffect, useState, type ReactElement } from "react";

const WORDMARK = "LAZYSCAN";
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%&@*+=-<>/\\";
const TICK_MS = 40;
// Letters lock left→right, one every 3 ticks: 8 × 3 × 40ms ≈ 0.96s full pass.
const TICKS_PER_LOCK = 3;
const FADE_MS = 300;

function scramble(locked: number): string {
  let out = "";
  for (let i = 0; i < WORDMARK.length; i += 1) {
    out +=
      i < locked
        ? WORDMARK[i]
        : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  }
  return out;
}

// Decorative boot overlay: scrambles into the wordmark, then holds until the
// session bootstrap settles (`done`) and fades out.
export function BootSplash({ done }: { done: boolean }): ReactElement | null {
  const [reduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [text, setText] = useState(() => (reduced ? WORDMARK : scramble(0)));
  const [settled, setSettled] = useState(reduced);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (reduced) {
      return;
    }
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      const locked = Math.floor(ticks / TICKS_PER_LOCK);
      if (locked >= WORDMARK.length) {
        window.clearInterval(timer);
        setText(WORDMARK);
        setSettled(true);
        return;
      }
      setText(scramble(locked));
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [reduced]);

  const leaving = done && settled;

  useEffect(() => {
    if (!leaving) {
      return;
    }
    const timer = window.setTimeout(() => setGone(true), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  if (gone) {
    return null;
  }
  return (
    <div className="boot-splash" data-leaving={leaving} aria-hidden="true">
      <span className="boot-splash-wordmark">{text}</span>
    </div>
  );
}
