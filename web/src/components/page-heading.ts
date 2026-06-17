import { escapeHtml } from "@/utils/dom";

// Shared `<section class="page-heading">` markup. `title` is escaped; `eyebrow`,
// `meta`, and `aside` are optional. `meta`/`aside` are treated as trusted HTML so
// callers can pass rich content (counts, search boxes, action buttons); `eyebrow`
// is escaped plain text.
export function renderPageHeading(options: {
  title: string;
  eyebrow?: string;
  meta?: string;
  aside?: string;
}): string {
  const eyebrow = options.eyebrow
    ? `<p class="eyebrow">${escapeHtml(options.eyebrow)}</p>`
    : "";
  const meta = options.meta ?? "";
  const aside = options.aside ? `<div class="heading-aside">${options.aside}</div>` : "";

  return `
    <section class="page-heading">
      <div>
        ${eyebrow}
        <h1>${escapeHtml(options.title)}</h1>
        ${meta}
      </div>
      ${aside}
    </section>
  `;
}
