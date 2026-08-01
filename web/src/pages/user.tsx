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
import { linkify } from "@/lib/linkify";
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
        <form className="grid gap-3" onSubmit={onSubmit}>
          <label className="grid gap-[7px] font-extrabold text-text-label">
            <span>Username</span>
            {/* Input and submit share one box so they line up exactly (a bare
                <button> renders taller than the input from UA padding). */}
            <input
              className="h-11 min-h-11 w-full rounded-md border border-border-strong bg-surface-raised px-3 py-0 text-text focus-visible:border-accent-fg focus-visible:outline-3 focus-visible:outline-accent-fg"
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
          <button className="primary-button h-11 min-h-11 w-full" type="submit">
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
        <div className="mb-0 flex items-start gap-4">
          <Cover
            url={resolveAvatar(profile.avatarUrl, name)}
            seed={name}
            placeholderClass="flex size-14 items-center justify-center rounded-[50%] bg-accent-fg object-cover text-[1.4rem] font-extrabold text-text-on-accent"
            imgClassName="size-14 rounded-[50%] object-cover"
          />
          <div>
            <p className="m-0 text-[1.1rem] font-extrabold">{name}</p>
            {/* .profile-meta stays: its `margin-top: 4px` is beaten by the
                unlayered `h1,h2,h3,p { margin-top: 0 }` reset. */}
            <p className="profile-meta">Joined {formatDate(profile.createdAt)}</p>
            <Badges badges={profile.badges} />
          </div>
        </div>
        {/* .profile-bio stays: Tailwind emits an opaque var(--text) fallback
            outside its @supports guard, which color-mix-less browsers would paint. */}
        {profile.bio ? (
          <p className="profile-bio">{linkify(profile.bio)}</p>
        ) : null}
      </section>
      {profile.shelf.visible ? (
        <section className="manage-panel">
          <p className="eyebrow">Favorites</p>
          {profile.shelf.favorites.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4.5">
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
