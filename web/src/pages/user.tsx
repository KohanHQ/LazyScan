import {
  useEffect,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import { ApiClientError } from "@/api/client";
import { getProfileByUsername } from "@/api/profile";
import type { PublicProfile } from "@/api/profile";
import { Badges } from "@/components/badges";
import { Cover } from "@/components/cover";
import { MangaCard } from "@/components/manga-card";
import { Page } from "@/components/page";
import { PageHeading } from "@/components/page-heading";
import { RequireSession } from "@/components/require-session";
import { ErrorState, Loading } from "@/components/states";
import { navigateTo } from "@/router";
import { formatDate } from "@/utils/format";
import { resolveAvatar } from "@/utils/avatar";

// Username lookup and public profiles are auth-gated; the API stays the real
// authority.
export function UserPage({ username }: { username?: string }): ReactElement {
  return (
    <RequireSession loginMessage="Log in to look up users.">
      {() => <UserContent username={username} />}
    </RequireSession>
  );
}

type ViewState =
  | { kind: "loading" }
  | { kind: "profile"; profile: PublicProfile }
  | { kind: "lookup"; prefill: string; note: string }
  | { kind: "error"; message: string };

function UserContent({ username }: { username?: string }): ReactElement {
  const [state, setState] = useState<ViewState>(
    username ? { kind: "loading" } : { kind: "lookup", prefill: "", note: "" }
  );

  useEffect(() => {
    if (!username) {
      setState({ kind: "lookup", prefill: "", note: "" });
      return;
    }
    let ignore = false;
    setState({ kind: "loading" });
    getProfileByUsername(username)
      .then((profile) => {
        if (!ignore) {
          setState({ kind: "profile", profile });
        }
      })
      .catch((error) => {
        if (ignore) {
          return;
        }
        if (error instanceof ApiClientError && error.status === 404) {
          setState({
            kind: "lookup",
            prefill: username,
            note: `No user found for "${username}".`,
          });
          return;
        }
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "Unable to load profile.",
        });
      });
    return () => {
      ignore = true;
    };
  }, [username]);

  switch (state.kind) {
    case "loading":
      return <Loading message="Loading profile" />;
    case "error":
      return <ErrorState message={state.message} />;
    case "lookup":
      return <LookupView prefill={state.prefill} note={state.note} />;
    case "profile":
      return <ProfileView profile={state.profile} />;
  }
}

function LookupView({
  prefill,
  note,
}: {
  prefill: string;
  note: string;
}): ReactElement {
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const value = String(
      new FormData(event.currentTarget).get("username") || ""
    ).trim();
    if (value) {
      navigateTo(`/user/${encodeURIComponent(value)}`);
    }
  };
  return (
    <>
      <PageHeading eyebrow="Profiles" title="Find a user" />
      <section className="manage-panel">
        {note ? <p className="form-error">{note}</p> : null}
        <form className="user-lookup-form" onSubmit={onSubmit}>
          <label>
            <span>Username</span>
            <input
              name="username"
              type="text"
              required
              minLength={3}
              maxLength={30}
              defaultValue={prefill}
              placeholder="username"
              autoComplete="off"
            />
          </label>
          <button className="primary-button" type="submit">
            View profile
          </button>
        </form>
      </section>
    </>
  );
}

function ProfileView({ profile }: { profile: PublicProfile }): ReactElement {
  const name = profile.displayName || profile.username || "User";
  return (
    <Page
      eyebrow="Profile"
      title={profile.username || "User"}
      aside={
        <button
          className="secondary-button"
          type="button"
          onClick={() => navigateTo("/user")}
        >
          ← Find another user
        </button>
      }
    >
      <section className="manage-panel">
        <div className="profile-head">
          <Cover
            url={resolveAvatar(profile.avatarUrl, name)}
            seed={name}
            placeholderClass="profile-avatar profile-avatar-placeholder"
            imgClassName="profile-avatar"
          />
          <div>
            <p className="profile-username">{name}</p>
            <p className="profile-meta">Joined {formatDate(profile.createdAt)}</p>
            <Badges badges={profile.badges} />
          </div>
        </div>
      </section>
      {profile.shelf.visible ? (
        <section className="manage-panel">
          <p className="eyebrow">Favorites</p>
          {profile.shelf.favorites.length ? (
            <div className="manga-grid">
              {profile.shelf.favorites.map((manga) => (
                <MangaCard key={manga.id} manga={manga} />
              ))}
            </div>
          ) : (
            <p className="profile-meta">No favorites yet.</p>
          )}
        </section>
      ) : null}
    </Page>
  );
}
