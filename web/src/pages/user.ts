import { ApiClientError } from "@/api/client";
import { getProfileByUsername } from "@/api/profile";
import type { PublicProfile } from "@/api/profile";
import { renderError, renderLoading } from "@/components/states";
import { renderBadges } from "@/components/badges";
import { renderMangaCard } from "@/components/manga-card";
import { navigateTo } from "@/router";
import { requireSessionForPage } from "@/components/page-session";
import { renderPage } from "@/components/page";
import { renderPageHeading } from "@/components/page-heading";
import {
  escapeHtml,
  formatDate,
  renderCover,
  wireClickableRows,
  wireCoverFallbacks,
} from "@/utils/dom";
import { resolveAvatar } from "@/utils/avatar";

// Username lookup and public profiles are auth-gated: wait for session bootstrap,
// then require a logged-in user. The API stays the real authority.
export function renderUserPage(container: HTMLElement, username?: string): void {
  requireSessionForPage(container, window.location.pathname, {
    loginMessage: "Log in to look up users.",
    onReady: () => void loadUser(container, username),
  });
}

async function loadUser(
  container: HTMLElement,
  username?: string
): Promise<void> {
  if (!username) {
    renderLookup(container);
    return;
  }

  container.innerHTML = renderLoading("Loading profile");

  try {
    const profile = await getProfileByUsername(username);
    renderProfileView(container, profile);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      renderLookup(container, username, `No user found for "${username}".`);
      return;
    }
    container.innerHTML = renderError(
      error instanceof Error ? error.message : "Unable to load profile."
    );
  }
}

function lookupForm(prefill = ""): string {
  return `
    <form class="user-lookup-form">
      <label>
        <span>Username</span>
        <input name="username" type="text" required minlength="3" maxlength="30" value="${escapeHtml(prefill)}" placeholder="username" autocomplete="off" />
      </label>
      <button class="primary-button" type="submit">View profile</button>
    </form>
  `;
}

function wireLookup(container: HTMLElement): void {
  const form = container.querySelector<HTMLFormElement>(".user-lookup-form");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = String(new FormData(form).get("username") || "").trim();
    if (value) {
      navigateTo(`/user/${encodeURIComponent(value)}`);
    }
  });
}

function renderLookup(
  container: HTMLElement,
  prefill = "",
  note = ""
): void {
  container.innerHTML = `
    ${renderPageHeading({ eyebrow: "Profiles", title: "Find a user" })}
    <section class="manage-panel">
      ${note ? `<p class="form-error">${escapeHtml(note)}</p>` : ""}
      ${lookupForm(prefill)}
    </section>
  `;
  wireLookup(container);
}

function renderProfileView(container: HTMLElement, profile: PublicProfile): void {
  const name = profile.displayName || profile.username || "User";
  const avatar = renderCover({
    url: resolveAvatar(profile.avatarUrl, name),
    seed: name,
    placeholderClass: "profile-avatar profile-avatar-placeholder",
    imgAttrs: 'class="profile-avatar"',
  });

  const badges = renderBadges(profile.badges);

  // The shelf only renders when the owner has opted it public (the API decides;
  // an empty visible shelf still shows the section with an empty note).
  const shelf = profile.shelf.visible
    ? `
      <section class="manage-panel">
        <p class="eyebrow">Favorites</p>
        ${
          profile.shelf.favorites.length
            ? `<div class="manga-grid">${profile.shelf.favorites
                .map((manga) => renderMangaCard(manga, "library"))
                .join("")}</div>`
            : `<p class="profile-meta">No favorites yet.</p>`
        }
      </section>
    `
    : "";

  // Shared page shell (renderPage): same width/heading/stacking as the own
  // profile view — `.page-stack` widens the panels out of the narrow form
  // column. Only the lookup form page keeps the narrow column (it is a form).
  // Finding another user is a heading-aside back action to `/user`.
  const body = `
    <section class="manage-panel">
      <div class="profile-head">
        ${avatar}
        <div>
          <p class="profile-username">${escapeHtml(name)}</p>
          <p class="profile-meta">Joined ${escapeHtml(formatDate(profile.createdAt))}</p>
          ${badges}
        </div>
      </div>
    </section>
    ${shelf}
  `;
  container.innerHTML = renderPage({
    eyebrow: "Profile",
    title: profile.username || "User",
    aside: `<button class="secondary-button" type="button" data-action="lookup-another">← Find another user</button>`,
    body,
  });
  wireCoverFallbacks(container);
  wireClickableRows(
    container,
    "[data-manga-id]",
    (card) => {
      const id = card.dataset.mangaId;
      return id ? `/manga/${encodeURIComponent(id)}` : null;
    },
    { keyboard: true }
  );
  container
    .querySelector<HTMLElement>("[data-action='lookup-another']")
    ?.addEventListener("click", () => navigateTo("/user"));
}
