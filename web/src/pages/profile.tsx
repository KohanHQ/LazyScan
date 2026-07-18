import {
  useEffect,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import { Pencil } from "lucide-react";
import {
  getMyProfile,
  getMyStats,
  updateMyProfile,
  uploadAvatar,
} from "@/api/profile";
import type {
  Profile,
  ProfileStats,
  ProfileUpdate,
  ProfileVisibility,
} from "@/api/profile";
import { getLibrary } from "@/api/library";
import type { LibraryEntry } from "@/api/library";
import { Badges } from "@/components/react/badges";
import { Cover } from "@/components/react/cover";
import { MangaCard } from "@/components/react/manga-card";
import { Page } from "@/components/react/page";
import { PageHeading } from "@/components/react/page-heading";
import { PopupSelect } from "@/components/react/popup-select";
import { RequireSession } from "@/components/react/require-session";
import { ErrorState, Loading } from "@/components/react/states";
import { navigateTo } from "@/router";
import { bootstrapSession } from "@/state/session";
import { resolveAvatar } from "@/utils/avatar";

export function ProfilePage(): ReactElement {
  return (
    <RequireSession loginMessage="Log in to view your profile.">
      {() => <ProfileContent />}
    </RequireSession>
  );
}

type ViewState =
  | { kind: "loading" }
  | { kind: "profile"; profile: Profile }
  | { kind: "error"; message: string };

function ProfileContent(): ReactElement {
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    let ignore = false;
    getMyProfile()
      .then((profile) => {
        if (!ignore) {
          setState({ kind: "profile", profile });
        }
      })
      .catch((error) => {
        if (!ignore) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "Unable to load profile.",
          });
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  switch (state.kind) {
    case "loading":
      return <Loading message="Loading profile" />;
    case "error":
      return <ErrorState message={state.message} />;
    case "profile":
      return <ProfileView profile={state.profile} />;
  }
}

function ProfileView({ profile }: { profile: Profile }): ReactElement {
  const name = profile.displayName || profile.username || "User";
  return (
    <Page title="Profile">
      <section className="manage-panel">
        <div className="profile-head">
          <Cover
            url={resolveAvatar(profile.avatarUrl, name)}
            seed={name}
            placeholderClass="profile-avatar profile-avatar-placeholder"
            imgClassName="profile-avatar"
          />
          <div className="profile-identity">
            <p className="profile-username">{name}</p>
            <p className="profile-meta">@{profile.username ?? "user"}</p>
            <Badges badges={profile.badges} />
          </div>
          <button
            className="secondary-button profile-edit-button"
            type="button"
            aria-label="Edit profile"
            onClick={() => navigateTo("/profile/edit")}
          >
            <Pencil className="icon" size={20} aria-hidden="true" />
            <span>Edit</span>
          </button>
        </div>
      </section>
      <StatsPanel />
      <FavoritesPanel shelfVisibility={profile.shelfVisibility} />
    </Page>
  );
}

function FavoritesPanel({
  shelfVisibility,
}: {
  shelfVisibility: ProfileVisibility;
}): ReactElement | null {
  const [favorites, setFavorites] = useState<LibraryEntry[] | null>(null);

  useEffect(() => {
    let ignore = false;
    getLibrary("favorite")
      .then((entries) => {
        if (!ignore) {
          setFavorites(entries);
        }
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, []);

  if (!favorites || !favorites.length) {
    return null;
  }

  // Own favorites are always shown on your own profile (visibility only governs
  // what others see); a chip notes whether they are publicly visible.
  const chip =
    shelfVisibility === "public" ? (
      <span className="profile-shelf-chip is-public">Public</span>
    ) : (
      <span className="profile-shelf-chip">Only you</span>
    );

  return (
    <section className="manage-panel">
      <p className="eyebrow profile-shelf-heading">Favorites {chip}</p>
      <div className="manga-grid">
        {favorites.map((entry) => (
          <MangaCard key={entry.manga.id} manga={entry.manga} />
        ))}
      </div>
    </section>
  );
}

function StatsPanel(): ReactElement {
  const [stats, setStats] = useState<ProfileStats | null | "error">(null);

  useEffect(() => {
    let ignore = false;
    getMyStats()
      .then((result) => {
        if (!ignore) {
          setStats(result);
        }
      })
      .catch(() => {
        if (!ignore) {
          setStats("error");
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <section
      className="manage-panel profile-stats"
      aria-label="Reading stats"
    >
      {stats === null ? (
        <Loading message="Loading stats" />
      ) : stats === "error" ? (
        <>
          <p className="eyebrow">Reading stats</p>
          <p className="profile-meta">Stats are unavailable right now.</p>
        </>
      ) : (
        <>
          <p className="eyebrow">Reading stats</p>
          <div className="profile-stat-grid">
            <div className="profile-stat">
              <span className="profile-stat-value">{stats.titlesRead}</span>
              <span className="profile-stat-label">Titles read</span>
            </div>
            <div className="profile-stat">
              <span className="profile-stat-value">{stats.chaptersRead}</span>
              <span className="profile-stat-label">Chapters read</span>
            </div>
            <div className="profile-stat">
              <span className="profile-stat-value">{stats.pagesRead}</span>
              <span className="profile-stat-label">Pages read</span>
            </div>
          </div>
          <p className="eyebrow profile-most-read-heading">Most read</p>
          {stats.mostReadManga.length ? (
            <ul className="profile-most-read">
              {stats.mostReadManga.map((entry) => (
                <li key={entry.manga.id}>
                  <span className="profile-most-read-title">
                    {entry.manga.title}
                  </span>
                  <span className="profile-most-read-count">
                    {entry.readChapters}{" "}
                    {entry.readChapters === 1 ? "chapter" : "chapters"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="profile-meta">
              No reads yet — finish a chapter to see it here.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function ProfileEditPage(): ReactElement {
  return (
    <RequireSession loginMessage="Log in to edit your profile.">
      {() => <ProfileEditContent />}
    </RequireSession>
  );
}

function ProfileEditContent(): ReactElement {
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    let ignore = false;
    getMyProfile()
      .then((profile) => {
        if (!ignore) {
          setState({ kind: "profile", profile });
        }
      })
      .catch((error) => {
        if (!ignore) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "Unable to load profile.",
          });
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  switch (state.kind) {
    case "loading":
      return <Loading message="Loading profile" />;
    case "error":
      return <ErrorState message={state.message} />;
    case "profile":
      return <ProfileEditForm profile={state.profile} />;
  }
}

function ProfileEditForm({ profile }: { profile: Profile }): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [profileVisibility, setProfileVisibility] = useState(
    profile.profileVisibility
  );
  const [shelfVisibility, setShelfVisibility] = useState(profile.shelfVisibility);

  // Avatar upload is exclusive to the instance owner (the API 403s everyone
  // else); the owner badge is the UI's ownership signal.
  const isOwner = profile.badges.some((badge) => badge.code === "owner");

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    const displayName = String(data.get("displayName") || "").trim();
    const patch: ProfileUpdate = {
      displayName: displayName || null,
      profileVisibility: data.get("profileVisibility") as ProfileVisibility,
      shelfVisibility: data.get("shelfVisibility") as ProfileVisibility,
    };

    setError(null);
    setBusy(true);

    // Avatar upload and profile patch are two independent server actions. Run
    // both and report per-half so a mixed failure isn't one undifferentiated
    // message. Avatar goes first (it sets avatar_url) but a failure no
    // longer aborts the patch — each is reported on its own.
    const avatarEntry = data.get("avatarFile");
    const avatarFile =
      avatarEntry instanceof File && avatarEntry.size > 0 ? avatarEntry : null;

    let avatarError: string | null = null;
    if (avatarFile) {
      try {
        await uploadAvatar(avatarFile);
      } catch (uploadError) {
        avatarError =
          uploadError instanceof Error ? uploadError.message : "Avatar upload failed.";
      }
    }

    let patchError: string | null = null;
    try {
      await updateMyProfile(patch);
    } catch (saveError) {
      patchError =
        saveError instanceof Error ? saveError.message : "Unable to save profile.";
    }

    const avatarUploaded = Boolean(avatarFile) && avatarError === null;

    if (avatarError === null && patchError === null) {
      // Both succeeded: re-bootstrap so the sidebar reflects the saved
      // name/avatar without a reload, then leave the form.
      void bootstrapSession();
      navigateTo("/profile");
      return;
    }

    // Partial or total failure: if the avatar did land, refresh the session so
    // the sidebar shows it, then stay and say which half failed.
    if (avatarUploaded) {
      void bootstrapSession();
    }
    const avatarFailed = Boolean(avatarFile) && avatarError !== null;
    let message: string;
    if (avatarFailed && patchError !== null) {
      message = `Profile save and avatar upload both failed. ${patchError}`;
    } else if (avatarFailed) {
      message = `Profile saved, but avatar upload failed. ${avatarError}`;
    } else {
      // Patch failed; avatar succeeded or none was picked.
      message = avatarUploaded
        ? `Avatar uploaded, but saving your profile failed. ${patchError}`
        : (patchError ?? "Unable to save profile.");
    }
    setError(message);
    setBusy(false);
  };

  return (
    <>
      <PageHeading eyebrow="Profile" title="Edit profile" />
      <section className="manage-panel" aria-labelledby="profile-title">
        <button
          className="secondary-button"
          type="button"
          onClick={() => navigateTo("/profile")}
        >
          ← Back to profile
        </button>
        <form className="manage-form" noValidate onSubmit={onSubmit}>
          <label>
            <span>Username</span>
            <input
              name="username"
              type="text"
              defaultValue={profile.username ?? ""}
              disabled
            />
            <small>Auto-generated and cannot be changed.</small>
          </label>
          <label>
            <span>Display name</span>
            <input
              name="displayName"
              type="text"
              maxLength={100}
              defaultValue={profile.displayName ?? ""}
            />
            <small>Your avatar is generated from your display name.</small>
          </label>
          {isOwner ? (
            <label>
              <span>Custom avatar (owner)</span>
              <input
                name="avatarFile"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
              />
              <small>
                PNG, JPEG, WebP, or GIF up to 10MB. Animated GIFs are kept as-is.
                Replaces the generated avatar; uploaded on save.
              </small>
            </label>
          ) : null}
          <label>
            <span>Profile visibility</span>
            <PopupSelect
              name="profileVisibility"
              ariaLabel="Profile visibility"
              value={profileVisibility}
              options={[
                { value: "public", label: "Public — others can find your profile" },
                { value: "private", label: "Private — hidden from username lookup" },
              ]}
              onChange={(value) =>
                setProfileVisibility(value as ProfileVisibility)
              }
            />
            <small>Private hides your profile from username lookups.</small>
          </label>
          <label>
            <span>Library shelf</span>
            <PopupSelect
              name="shelfVisibility"
              ariaLabel="Library shelf"
              value={shelfVisibility}
              options={[
                { value: "private", label: "Private — keep your favorites to yourself" },
                { value: "public", label: "Public — show favorites on your profile" },
              ]}
              onChange={(value) => setShelfVisibility(value as ProfileVisibility)}
            />
            <small>
              Controls whether your favorites appear on your public profile.
              Reading stats stay private.
            </small>
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Saving" : "Save changes"}
          </button>
        </form>
      </section>
    </>
  );
}
