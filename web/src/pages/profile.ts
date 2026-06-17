import { ApiClientError } from "@/api/client";
import {
  getMyProfile,
  getMyStats,
  updateMyProfile,
  uploadAvatar,
} from "@/api/profile";
import type { Profile, ProfileStats, ProfileUpdate, ProfileVisibility } from "@/api/profile";
import { getLibrary } from "@/api/library";
import { renderError, renderLoading } from "@/components/states";
import { renderLoginRequired } from "@/components/auth-required";
import { renderBadges } from "@/components/badges";
import { icons } from "@/components/icons";
import { renderMangaCard } from "@/components/manga-card";
import { renderPage } from "@/components/page";
import { renderPageHeading } from "@/components/page-heading";
import { navigateTo } from "@/router";
import { bootstrapSession } from "@/state/session";
import { clearFormError, setFormError, setSubmitBusy } from "@/utils/form";
import {
  escapeHtml,
  renderCover,
  wireClickableRows,
  wireCoverFallbacks,
} from "@/utils/dom";
import { resolveAvatar } from "@/utils/avatar";

// =========================================================================
// Profile view — the actual profile (avatar, badges, your favorites, reading
// stats). Reached by clicking the account avatar. Editing lives separately at
// /profile/edit.
// =========================================================================

export async function renderProfilePage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderLoading("Loading profile");

  let profile: Profile;
  try {
    profile = await getMyProfile();
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      renderLoginRequired(container, "Log in to view your profile.");
      return;
    }
    container.innerHTML = renderError(
      error instanceof Error ? error.message : "Unable to load profile."
    );
    return;
  }

  renderView(container, profile);
  void loadFavorites(container, profile.shelfVisibility);
  void loadStats(container);
}

function renderView(container: HTMLElement, profile: Profile): void {
  const name = profile.displayName || profile.username || "User";
  const avatar = renderCover({
    url: resolveAvatar(profile.avatarUrl, name),
    seed: name,
    placeholderClass: "profile-avatar profile-avatar-placeholder",
    imgAttrs: 'class="profile-avatar"',
  });

  const badges = renderBadges(profile.badges);

  const body = `
    <section class="manage-panel">
      <div class="profile-head">
        ${avatar}
        <div class="profile-identity">
          <p class="profile-username">${escapeHtml(name)}</p>
          <p class="profile-meta">@${escapeHtml(profile.username ?? "user")}</p>
          ${badges}
        </div>
        <button class="secondary-button profile-edit-button" type="button" data-action="edit" aria-label="Edit profile">
          ${icons.edit()}<span>Edit</span>
        </button>
      </div>
    </section>
    <section class="manage-panel profile-stats" data-role="stats" aria-label="Reading stats">
      ${renderLoading("Loading stats")}
    </section>
    <section class="manage-panel" data-role="favorites" hidden></section>
  `;

  container.innerHTML = renderPage({ title: "Profile", body });

  wireCoverFallbacks(container);
  container
    .querySelector<HTMLElement>("[data-action='edit']")
    ?.addEventListener("click", () => navigateTo("/profile/edit"));
}

// Your own favorites are always shown on your own profile (visibility only
// governs what others see); a chip notes whether they are publicly visible. The
// panel is omitted entirely when you have no favorites.
async function loadFavorites(
  container: HTMLElement,
  shelfVisibility: ProfileVisibility
): Promise<void> {
  const panel = container.querySelector<HTMLElement>("[data-role='favorites']");
  if (!panel) {
    return;
  }

  let favorites;
  try {
    favorites = await getLibrary("favorite");
  } catch {
    return;
  }

  if (!favorites.length) {
    panel.remove();
    return;
  }

  const chip =
    shelfVisibility === "public"
      ? `<span class="profile-shelf-chip is-public">Public</span>`
      : `<span class="profile-shelf-chip">Only you</span>`;

  panel.hidden = false;
  panel.innerHTML = `
    <p class="eyebrow profile-shelf-heading">Favorites ${chip}</p>
    <div class="manga-grid">${favorites
      .map((entry) => renderMangaCard(entry.manga, "library"))
      .join("")}</div>
  `;

  wireCoverFallbacks(panel);
  wireClickableRows(
    panel,
    "[data-manga-id]",
    (card) => {
      const id = card.dataset.mangaId;
      return id ? `/manga/${encodeURIComponent(id)}` : null;
    },
    { keyboard: true }
  );
}

// Reading stats are private (own profile only). Loaded after the header so a
// slow stats query never blocks the page; a failure degrades to a quiet note.
async function loadStats(container: HTMLElement): Promise<void> {
  const panel = container.querySelector<HTMLElement>("[data-role='stats']");
  if (!panel) {
    return;
  }

  let stats: ProfileStats;
  try {
    stats = await getMyStats();
  } catch {
    panel.innerHTML = `
      <p class="eyebrow">Reading stats</p>
      <p class="profile-meta">Stats are unavailable right now.</p>
    `;
    return;
  }

  const mostRead = stats.mostReadManga.length
    ? `
      <ul class="profile-most-read">
        ${stats.mostReadManga
          .map(
            (entry) => `
          <li>
            <span class="profile-most-read-title">${escapeHtml(entry.manga.title)}</span>
            <span class="profile-most-read-count">${entry.readChapters} ${entry.readChapters === 1 ? "chapter" : "chapters"}</span>
          </li>
        `
          )
          .join("")}
      </ul>
    `
    : `<p class="profile-meta">No reads yet — finish a chapter to see it here.</p>`;

  panel.innerHTML = `
    <p class="eyebrow">Reading stats</p>
    <div class="profile-stat-grid">
      <div class="profile-stat">
        <span class="profile-stat-value">${stats.titlesRead}</span>
        <span class="profile-stat-label">Titles read</span>
      </div>
      <div class="profile-stat">
        <span class="profile-stat-value">${stats.chaptersRead}</span>
        <span class="profile-stat-label">Chapters read</span>
      </div>
      <div class="profile-stat">
        <span class="profile-stat-value">${stats.pagesRead}</span>
        <span class="profile-stat-label">Pages read</span>
      </div>
    </div>
    <p class="eyebrow profile-most-read-heading">Most read</p>
    ${mostRead}
  `;
}

// =========================================================================
// Profile edit — display name + visibility controls. Reached from the profile
// view's "Edit profile" action.
// =========================================================================

export async function renderProfileEditPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderLoading("Loading profile");

  let profile: Profile;
  try {
    profile = await getMyProfile();
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      renderLoginRequired(container, "Log in to edit your profile.");
      return;
    }
    container.innerHTML = renderError(
      error instanceof Error ? error.message : "Unable to load profile."
    );
    return;
  }

  renderEditForm(container, profile);
}

function visibilityOptions(
  selected: ProfileVisibility,
  options: { value: ProfileVisibility; label: string }[]
): string {
  return options
    .map(
      (option) =>
        `<option value="${option.value}"${
          option.value === selected ? " selected" : ""
        }>${escapeHtml(option.label)}</option>`
    )
    .join("");
}

function renderEditForm(container: HTMLElement, profile: Profile): void {
  // Avatar upload is exclusive to the instance owner (the API 403s everyone
  // else); the owner badge on the own profile is the UI's ownership signal.
  const isOwner = profile.badges.some((badge) => badge.code === "owner");

  container.innerHTML = `
    ${renderPageHeading({ eyebrow: "Profile", title: "Edit profile" })}
    <section class="manage-panel" aria-labelledby="profile-title">
      <button class="secondary-button" type="button" data-action="back">← Back to profile</button>
      <form class="manage-form" novalidate>
        <label>
          <span>Username</span>
          <input name="username" type="text" value="${escapeHtml(profile.username ?? "")}" disabled />
          <small>Auto-generated and cannot be changed.</small>
        </label>
        <label>
          <span>Display name</span>
          <input name="displayName" type="text" maxlength="100" value="${escapeHtml(profile.displayName ?? "")}" />
          <small>Your avatar is generated from your display name.</small>
        </label>
        ${
          isOwner
            ? `
        <label>
          <span>Custom avatar (owner)</span>
          <input name="avatarFile" type="file" accept="image/png,image/jpeg,image/webp" />
          <small>PNG, JPEG, or WebP up to 10MB. Replaces the generated avatar; uploaded on save.</small>
        </label>`
            : ""
        }
        <label>
          <span>Profile visibility</span>
          <select name="profileVisibility">
            ${visibilityOptions(profile.profileVisibility, [
              { value: "public", label: "Public — others can find your profile" },
              { value: "private", label: "Private — hidden from username lookup" },
            ])}
          </select>
          <small>Private hides your profile from username lookups.</small>
        </label>
        <label>
          <span>Library shelf</span>
          <select name="shelfVisibility">
            ${visibilityOptions(profile.shelfVisibility, [
              { value: "private", label: "Private — keep your favorites to yourself" },
              { value: "public", label: "Public — show favorites on your profile" },
            ])}
          </select>
          <small>Controls whether your favorites appear on your public profile. Reading stats stay private.</small>
        </label>
        <p class="form-error" hidden></p>
        <button class="primary-button" type="submit">Save changes</button>
      </form>
    </section>
  `;

  container
    .querySelector<HTMLElement>("[data-action='back']")
    ?.addEventListener("click", () => navigateTo("/profile"));

  const form = container.querySelector<HTMLFormElement>(".manage-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);

    // Username is immutable and the avatar is derived, so only the display name
    // and the two visibility flags are editable. Empty clears the display name.
    const displayName = String(data.get("displayName") || "").trim();
    const patch: ProfileUpdate = {
      displayName: displayName || null,
      profileVisibility: data.get("profileVisibility") as ProfileVisibility,
      shelfVisibility: data.get("shelfVisibility") as ProfileVisibility,
    };

    clearFormError(form);
    setSubmitBusy(form, true, "Saving");

    try {
      // Owner only: a picked avatar file uploads first (the API processes it
      // and sets the profile's avatar_url), then the regular patch saves.
      const avatarFile = data.get("avatarFile");
      if (avatarFile instanceof File && avatarFile.size > 0) {
        await uploadAvatar(avatarFile);
      }
      await updateMyProfile(patch);
      // Re-bootstrap the session so session-derived UI (the sidebar account
      // name and avatar) reflects the saved display name/avatar without a hard
      // reload — the sidebar re-renders on session state changes. Must cover the
      // display-name change too, not just the avatar.
      void bootstrapSession();
      // Return to the profile view, which reflects the saved changes (matches the
      // manga create/edit flows that redirect to the manga detail on success).
      navigateTo("/profile");
    } catch (saveError) {
      setFormError(
        form,
        saveError instanceof Error ? saveError.message : "Unable to save profile."
      );
      setSubmitBusy(form, false, "Saving", "Save changes");
    }
  });
}
