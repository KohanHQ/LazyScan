import { escapeHtml } from "@/utils/dom";

export function renderLoading(message = "Loading"): string {
  return `<div class="state-block" role="status">${escapeHtml(message)}</div>`;
}

// `icon` is a trusted inline-SVG string (e.g. from components/icons), injected
// as-is; `title`/`message` are still escaped.
export function renderEmpty(title: string, message: string, icon?: string): string {
  return `
    <section class="state-block state-block-strong state-empty">
      ${icon ? `<div class="state-empty-icon" aria-hidden="true">${icon}</div>` : ""}
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
    </section>
  `;
}

export function renderError(message: string): string {
  return `
    <section class="state-block state-error">
      <h2>Something went wrong</h2>
      <p>${escapeHtml(message)}</p>
    </section>
  `;
}
