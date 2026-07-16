import { useState, type ReactElement } from "react";

// ponytail: Stage 2 coexistence probe — delete when pages/home.ts converts (Stage 5).
// Each element gates one risk the rewrite plan flagged: token-backed utilities in
// both themes, `border` rendering without preflight, the data-theme dark variant,
// base.css's element rules under a utility-styled <button>, and a live state update.
export function ReactProbe(): ReactElement {
  const [count, setCount] = useState(0);

  return (
    <div className="m-8 rounded-lg border border-border bg-surface p-6 text-text">
      <h2 className="text-accent-fg">React probe</h2>
      <p className="text-text-secondary dark:text-accent-fg">
        This line turns mint in dark mode via the data-theme variant.
      </p>
      <button
        className="rounded-md border border-accent bg-accent px-4 py-2 text-text-on-accent"
        type="button"
        onClick={() => setCount(count + 1)}
      >
        Clicked {count}
      </button>
    </div>
  );
}
