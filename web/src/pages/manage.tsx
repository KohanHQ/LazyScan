import { useEffect, useState, type ReactElement } from "react";
import { canManageManga, listManga } from "@/api/manga";
import type { Manga } from "@/api/manga";
import type { CurrentUser } from "@/api/auth";
import { MangaCard } from "@/components/manga-card";
import { PageHeading } from "@/components/page-heading";
import { RequireSession } from "@/components/require-session";
import { ErrorState, Loading } from "@/components/states";
import { navigateTo } from "@/router";

const PAGE_LIMIT = 100;

// Management hub: the single entry point for create/edit/delete. The public
// library and detail pages stay read-only; everything that mutates manga lives
// behind this auth gate. The API remains the real authority.
export function ManagePage(): ReactElement {
  return (
    <RequireSession loginMessage="Log in to manage manga.">
      {(user) => <ManageHub user={user} />}
    </RequireSession>
  );
}

type ViewState =
  | { kind: "loading" }
  | { kind: "ready"; manageable: Manga[] }
  | { kind: "error"; message: string };

function ManageHub({ user }: { user: CurrentUser }): ReactElement {
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    let ignore = false;
    setState({ kind: "loading" });
    void (async (): Promise<void> => {
      let list: Manga[] = [];
      try {
        // The hub filters by manageability client-side, so it needs every title,
        // not just the first page — page through until a short page is returned.
        for (let offset = 0; ; offset += PAGE_LIMIT) {
          const page = await listManga({ limit: PAGE_LIMIT, offset });
          list = list.concat(page);
          if (page.length < PAGE_LIMIT) {
            break;
          }
        }
      } catch (error) {
        if (!ignore) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "Unable to load manga.",
          });
        }
        return;
      }
      if (ignore) {
        return;
      }
      // Owners see their own titles; superusers see everything (mirrors the API).
      const manageable = list.filter((manga) => canManageManga(manga, user));
      setState({ kind: "ready", manageable });
    })();
    return () => {
      ignore = true;
    };
  }, [user]);

  if (state.kind === "loading") {
    return <Loading message="Loading manga" />;
  }
  if (state.kind === "error") {
    return <ErrorState message={state.message} />;
  }

  const { manageable } = state;
  return (
    <>
      <PageHeading
        title="Manage"
        meta={
          <p className="m-0 font-bold text-text-secondary">
            {manageable.length} title{manageable.length === 1 ? "" : "s"}
          </p>
        }
      />
      <section
        className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4.5"
        aria-label="Manageable manga"
      >
        {/* The "New manga" affordance lives as a dashed add-card at the front of
            the grid, so creating reads as part of the list.
            font-weight sits on the label span, not the button: the unlayered
            `button { font: inherit }` reset beats font utilities on a button. */}
        <button
          className="flex min-h-[260px] flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-dashed border-border bg-transparent text-text-label transition-[border-color,color] duration-200 ease-[ease] hover:border-primary hover:text-accent-fg focus-visible:border-accent-fg focus-visible:text-accent-fg focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent-fg"
          type="button"
          aria-label="New manga"
          onClick={() => navigateTo("/manage/manga/new")}
        >
          <span className="text-[2.6rem] leading-none font-normal" aria-hidden="true">
            +
          </span>
          <span className="font-bold">New manga</span>
        </button>
        {manageable.map((manga) => (
          <MangaCard key={manga.id} manga={manga} variant="manage" />
        ))}
      </section>
    </>
  );
}
