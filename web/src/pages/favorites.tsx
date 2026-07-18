import {
  useEffect,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { Bookmark, Heart } from "lucide-react";
import { getLibrary, removeFromLibrary } from "@/api/library";
import type { LibraryEntry, LibraryList } from "@/api/library";
import { MangaCard } from "@/components/react/manga-card";
import { PageHeading } from "@/components/react/page-heading";
import { RequireSession } from "@/components/react/require-session";
import { Empty, ErrorState, Loading } from "@/components/react/states";

const TABS: { key: LibraryList; label: string }[] = [
  { key: "favorite", label: "Favorites" },
  { key: "queue", label: "Queue" },
];

function initialParam(key: string, fallback: string): string {
  return new URLSearchParams(window.location.search).get(key) || fallback;
}

export function FavoritesPage(): ReactElement {
  return (
    <RequireSession loginMessage="Log in to see your favorites.">
      {() => <FavoritesContent />}
    </RequireSession>
  );
}

function FavoritesContent(): ReactElement {
  const [tab, setTab] = useState<LibraryList>("favorite");
  const [sort, setSort] = useState(() => initialParam("sort", "newest"));
  // `year` is the raw text shown in the input; `committedYear` is what the list
  // query uses. Typing updates the URL only; commit (blur/Enter) reloads.
  const [year, setYear] = useState(() => initialParam("year", ""));
  const [committedYear, setCommittedYear] = useState(() =>
    initialParam("year", "")
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    setEntries(null);
    setError(null);
    getLibrary(tab, sort, committedYear || undefined)
      .then((list) => {
        if (!ignore) {
          setEntries(list);
        }
      })
      .catch((loadError) => {
        if (!ignore) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load your list."
          );
        }
      });
    return () => {
      ignore = true;
    };
  }, [tab, sort, committedYear, reloadKey]);

  function syncUrl(sortValue: string, yearValue: string): void {
    const url = new URL(window.location.href);
    if (sortValue && sortValue !== "newest") {
      url.searchParams.set("sort", sortValue);
    } else {
      url.searchParams.delete("sort");
    }
    if (yearValue) {
      url.searchParams.set("year", yearValue);
    } else {
      url.searchParams.delete("year");
    }
    window.history.replaceState({}, "", url.toString());
  }

  const onSortChange = (next: string): void => {
    const value = next || "newest";
    setSort(value);
    syncUrl(value, year.trim());
  };

  const onYearInput = (raw: string): void => {
    setYear(raw);
    syncUrl(sort, raw.trim());
  };

  const commitYear = (): void => {
    setCommittedYear(year.trim());
  };

  const onYearKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      commitYear();
    }
  };

  const onClear = (): void => {
    setSort("newest");
    setYear("");
    setCommittedYear("");
    syncUrl("newest", "");
  };

  const label = tab === "favorite" ? "Favorites" : "Queue";

  return (
    <>
      <PageHeading title="Favorites" />
      <div className="library-tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            className={`library-tab${entry.key === tab ? " is-active" : ""}`}
            type="button"
            role="tab"
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="library-filters">
        <div className="library-filter-group">
          <label className="library-filter-label" htmlFor="library-sort">
            Sort
          </label>
          <select
            className="library-filter-select"
            id="library-sort"
            value={sort}
            onChange={(event) => onSortChange(event.target.value)}
          >
            <option value="newest">Newest</option>
            <option value="title">Title (A-Z)</option>
            <option value="year">Year</option>
          </select>
        </div>
        <div className="library-filter-group">
          <label className="library-filter-label" htmlFor="library-year">
            Year
          </label>
          <input
            type="text"
            className="library-filter-input"
            id="library-year"
            placeholder="e.g. 2020 or 2020-2024"
            value={year}
            onChange={(event) => onYearInput(event.target.value)}
            onBlur={commitYear}
            onKeyDown={onYearKeyDown}
          />
        </div>
        <button
          className="library-filter-clear"
          type="button"
          onClick={onClear}
        >
          Clear
        </button>
      </div>
      <div className="library-content">
        {error !== null ? (
          <ErrorState message={error} />
        ) : entries === null ? (
          <Loading message="Loading" />
        ) : entries.length === 0 ? (
          tab === "favorite" ? (
            <Empty
              title="No favorites yet"
              message="Tap the heart on a title to save it here."
              icon={<Heart className="icon" size={20} />}
            />
          ) : (
            <Empty
              title="Queue is empty"
              message="Add titles to your queue from their detail page."
              icon={<Bookmark className="icon" size={20} />}
            />
          )
        ) : (
          <section className="manga-grid" aria-label={label}>
            {entries.map((entry) => (
              <div className="library-card" key={entry.manga.id}>
                <MangaCard manga={entry.manga} />
                <RemoveButton
                  list={tab}
                  mangaId={entry.manga.id}
                  onRemoved={() => setReloadKey((key) => key + 1)}
                />
              </div>
            ))}
          </section>
        )}
      </div>
    </>
  );
}

// Sits beside the card (not inside it), so its click never reaches the card's
// navigation. Disabled while the removal is in flight; re-enabled only on failure —
// success reloads the tab, unmounting this button.
function RemoveButton(props: {
  list: LibraryList;
  mangaId: string;
  onRemoved: () => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="library-remove"
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        removeFromLibrary(props.list, props.mangaId)
          .then(props.onRemoved)
          .catch(() => setBusy(false));
      }}
    >
      Remove
    </button>
  );
}
