import { icons } from "@/components/icons";
import { renderPageHeading } from "@/components/page-heading";
import { renderEmpty } from "@/components/states";

// Forum placeholder: the sidebar item exists so the surface is discoverable,
// but the feature itself is not built yet.
export function renderForumPage(container: HTMLElement): void {
  container.innerHTML = `
    ${renderPageHeading({ eyebrow: "Community", title: "Forum" })}
    ${renderEmpty(
      "Forum coming soon",
      "Discussions are not open yet. Check back later.",
      icons.forum()
    )}
  `;
}
