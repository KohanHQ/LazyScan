import { navigateTo } from "@/router";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Subtle enter animation for freshly-rendered content (route swaps, tab switches).
// Web Animations re-triggers on every call without a reflow hack and is a no-op
// when the user prefers reduced motion.
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

// Renders a cover image, or a letter placeholder when there is no URL. When a
// URL is present the <img> carries fallback data so a dead URL can be swapped
// for the same placeholder via wireCoverFallbacks (covers can 404 if storage
// or the public domain is misconfigured).
export function renderCover(opts: {
  url: string | null;
  seed: string;
  placeholderClass: string;
  imgAttrs?: string;
}): string {
  const letter = escapeHtml((opts.seed.slice(0, 1) || "?").toUpperCase());
  const placeholder = `<div class="${opts.placeholderClass}" aria-hidden="true">${letter}</div>`;
  if (!opts.url) {
    return placeholder;
  }
  return `<img src="${escapeHtml(opts.url)}" alt="" ${opts.imgAttrs ?? ""} data-cover-fallback="${letter}" data-cover-class="${escapeHtml(opts.placeholderClass)}" />`;
}

export function wireCoverFallbacks(container: HTMLElement): void {
  container
    .querySelectorAll<HTMLImageElement>("img[data-cover-fallback]")
    .forEach((img) => {
      const replaceWithPlaceholder = (): void => {
        const placeholder = document.createElement("div");
        placeholder.className = img.dataset.coverClass ?? "cover-placeholder";
        placeholder.setAttribute("aria-hidden", "true");
        placeholder.textContent = img.dataset.coverFallback ?? "?";
        img.replaceWith(placeholder);
      };
      img.addEventListener("error", replaceWithPlaceholder);
      // The image may have already failed before this listener attached (a
      // cached error fires during innerHTML parsing, before wiring runs), so the
      // future "error" event never comes. A finished load with zero natural
      // width means it failed — swap the placeholder in immediately.
      if (img.complete && img.naturalWidth === 0) {
        replaceWithPlaceholder();
      }
    });
}

// Wires click (and, when `keyboard` is set, Enter/Space) navigation on every
// element matching `selector` within `scope`. `getPath` derives the target from
// the element (return null/empty to skip). Replaces the per-page card/row click
// wiring; keyboard activation matches the previous card behavior.
export function wireClickableRows(
  scope: HTMLElement,
  selector: string,
  getPath: (element: HTMLElement) => string | null | undefined,
  options: { keyboard?: boolean } = {}
): void {
  const { keyboard = false } = options;
  scope.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const activate = (): void => {
      const path = getPath(element);
      if (path) {
        navigateTo(path);
      }
    };

    element.addEventListener("click", activate);

    if (keyboard) {
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          if (event.key !== "Enter") {
            event.preventDefault();
          }
          activate();
        }
      });
    }
  });
}

export function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
