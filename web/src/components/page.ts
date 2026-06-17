import { renderPageHeading } from "@/components/page-heading";

// Shared page shell: a standard `renderPageHeading` plus a content container that
// sits at the normal page width (inside `.app-main`'s max-width) and, by default,
// stacks its sections with consistent vertical spacing (`.page-stack`).
//
// Use this for content pages so width/heading/spacing stay consistent without each
// page re-deriving them. Forms that want the narrow centered `.manage-panel`
// column should NOT use the stack (pass `stack: false`, or just render a
// `renderPageHeading` + `.manage-panel` directly) — `.page-stack` intentionally
// widens any `.manage-panel` inside it to full width.
//
// Escaping matches `renderPageHeading`: `title`/`eyebrow` are escaped there;
// `meta`/`aside`/`body` are trusted HTML built by the caller.
export function renderPage(options: {
  title: string;
  eyebrow?: string;
  meta?: string;
  aside?: string;
  body: string;
  // Wrap the body in the standard vertical stack (default true). Set false for
  // pages that manage their own layout.
  stack?: boolean;
  // Extra classes on the content container for special cases.
  className?: string;
}): string {
  const { body, stack = true, className = "" } = options;
  const containerClass = ["page-content", stack ? "page-stack" : "", className]
    .filter(Boolean)
    .join(" ");

  return `
    ${renderPageHeading({
      title: options.title,
      eyebrow: options.eyebrow,
      meta: options.meta,
      aside: options.aside,
    })}
    <div class="${containerClass}">${body}</div>
  `;
}
