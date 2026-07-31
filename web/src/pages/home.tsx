import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactElement,
} from "react";
import { Funnel } from "lucide-react";
import {
  listManga,
  listMangaTags,
  listPopularManga,
  listRecentlyUpdatedManga,
  MANGA_STATUSES,
} from "@/api/manga";
import type { ListMangaParams, Manga, MangaStatus } from "@/api/manga";
import { getReadingHistory } from "@/api/reader";
import type { MangaHistoryEntry } from "@/api/reader";
import { statusLabel } from "@/components/manga-card";
import { Cover } from "@/components/cover";
import { MangaCard } from "@/components/manga-card";
import { PopupSelect } from "@/components/popup-select";
import { CardGridSkeleton, Empty, ErrorState } from "@/components/states";
import { animateIn } from "@/lib/animate-in";
import { clickable } from "@/lib/clickable";
import { usePopupDismiss } from "@/lib/use-popup-dismiss";
import {
  historyChapterLabel,
  historyProgressPercent,
} from "@/pages/history";
import { getSession } from "@/state/session";

const PAGE_SIZE = 50;
const HERO_SIZE = 10;
const HERO_INTERVAL_MS = 6000;
const RAIL_SIZE = 10;
// Floor for one carousel step (card 132px + the copy's 14px gap, base.css). The
// live stride widens to fit 6 whole cards in the container; this is the minimum.
const RAIL_STRIDE_PX = 146;
const RAIL_GAP_PX = 14;
const RAIL_VISIBLE = 6;
const CAROUSEL_STEP_MS = 3500;
const CAROUSEL_TRANSITION_MS = 450;

type HomeData = {
  firstPage: Manga[];
  heroItems: Manga[];
  heroKind: "popular" | "new";
  updates: Manga[];
  continueEntries: MangaHistoryEntry[];
};

export function HomePage(): ReactElement {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Hero ranking, updates rail, and continue rail must not break the page: each
    // resolves to [] on failure. Continue reading is user-tied; anonymous (or
    // pre-session-bootstrap) loads resolve empty — app.ts re-renders the route
    // once the session lands, so the rail appears on hard loads too. Fetch double
    // the rail size because fully-finished entries are filtered out below.
    const popularPromise = listPopularManga(HERO_SIZE).catch(() => [] as Manga[]);
    const updatesPromise = listRecentlyUpdatedManga(RAIL_SIZE).catch(
      () => [] as Manga[]
    );
    const continuePromise: Promise<MangaHistoryEntry[]> = getSession().user
      ? getReadingHistory({ limit: RAIL_SIZE * 2, offset: 0 }).catch(
          () => [] as MangaHistoryEntry[]
        )
      : Promise.resolve([] as MangaHistoryEntry[]);

    void (async () => {
      // First page decides between the empty state and the paged library shell.
      let firstPage: Manga[];
      try {
        firstPage = await listManga({ limit: PAGE_SIZE, offset: 0 });
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Unable to load manga."
          );
        }
        return;
      }

      // Real popularity when there are reads in the window; otherwise fall back
      // to the newest titles so a cold catalog still gets a hero. Padding a thin
      // ranking with unranked titles was tried and reverted (2026-06-04): the
      // ranking must not be diluted.
      const popular = await popularPromise;
      const updates = await updatesPromise;
      // Only resumable entries: hide a title whose pinned position is the last
      // page of its chapter with nothing ready after it. Entries with an unknown
      // page count (0, pages since removed) stay visible.
      const continueEntries = (await continuePromise)
        .filter(
          (entry) =>
            entry.hasNextChapter ||
            entry.chapterPageCount === 0 ||
            entry.pageNumber < entry.chapterPageCount
        )
        .slice(0, RAIL_SIZE);

      if (cancelled) {
        return;
      }
      setData({
        firstPage,
        heroItems: (popular.length > 0 ? popular : firstPage).slice(0, HERO_SIZE),
        heroKind: popular.length > 0 ? "popular" : "new",
        updates,
        continueEntries,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Drive the immersive home chrome (transparent topbar + full-bleed hero). Only
  // set when a hero actually mounts; the shell resets it to "false" on every
  // navigation, so it never leaks to other routes.
  const hasHero = data !== null && data.firstPage.length > 0;
  useEffect(() => {
    if (hasHero) {
      document.querySelector(".app-shell")?.setAttribute("data-hero", "true");
    }
  }, [hasHero]);

  // The shell's navigation fade already ran while this page was still loading, so
  // the skeleton→content swap would otherwise slam in with no transition.
  const loaded = data !== null;
  useEffect(() => {
    if (loaded) {
      const main = document.querySelector("main");
      if (main) {
        animateIn(main);
      }
    }
  }, [loaded]);

  if (error !== null) {
    return <ErrorState message={error} />;
  }

  if (data === null) {
    return (
      <>
        <section className="page-heading">
          <div>
            <h1>Library</h1>
          </div>
        </section>
        <CardGridSkeleton count={12} />
      </>
    );
  }

  if (data.firstPage.length === 0) {
    return (
      <>
        <section className="page-heading">
          <div>
            <h1>Library</h1>
          </div>
        </section>
        <Empty
          title="No manga yet"
          message="Create manga through the API or management tooling to populate the catalog."
        />
      </>
    );
  }

  // Hero leads (full-bleed under the transparent topbar), then the personal
  // "Continue reading" rail, the global "Recently updated" rail, and the
  // library header + grid (MangaDex-style ordering).
  return (
    <>
      <Hero items={data.heroItems} kind={data.heroKind} />
      <Rail
        role="continue-rail"
        eyebrow="Continue reading"
        title="Pick up where you left off"
        cards={data.continueEntries.map((entry) => (
          <ResumeCard key={entry.mangaId} entry={entry} />
        ))}
      />
      <Rail
        role="recent-rail"
        eyebrow="Recently updated"
        title="Fresh chapters"
        carousel
        cards={data.updates.map((manga) => (
          <RailCard key={manga.id} manga={manga} eager />
        ))}
      />
      <Library firstPage={data.firstPage} />
    </>
  );
}

// Horizontal card rail (e.g. "Recently updated"). Renders nothing when there are
// no cards, so an empty feed leaves no gap between the hero and the library.
// Rails fade + rise into view on scroll (.rail-reveal in base.css); without
// IntersectionObserver or under reduced motion they render visible outright.
// `carousel` opts a rail into the infinite auto-stepping variant: one card
// stride every few seconds with a slide transition, wrapping silently at the
// copy-2 boundary. Geometry is pure arithmetic from the stride — the only
// measurement is the container width, padded with two spare copies.
function Rail(props: {
  role: string;
  eyebrow: string;
  title: string;
  cards: ReactElement[];
  carousel?: boolean;
}): ReactElement | null {
  const sectionRef = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(
    () =>
      !HAS_OBSERVER ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [viewportWidth, setViewportWidth] = useState(0);
  const [position, setPosition] = useState(0);
  const [instant, setInstant] = useState(false);
  const [hoverPause, setHoverPause] = useState(false);
  const [focusPause, setFocusPause] = useState(false);
  const [offscreen, setOffscreen] = useState(false);
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const total = props.cards.length;
  const carouselOn =
    props.carousel === true && !reduceMotion && viewportWidth > 0 && total > 1;
  const paused = hoverPause || focusPause || offscreen;

  // Stride widens so 6 whole cards span the container; below the 146px floor
  // (narrow viewports) cards stay 132px and simply fewer of them fit.
  const stride = Math.max(
    RAIL_STRIDE_PX,
    Math.floor(viewportWidth / RAIL_VISIBLE)
  );
  // Content width is arithmetic (total × stride), never measured. copyCount
  // covers the viewport plus two spare loops, so even a badly wrong viewport
  // reading cannot leave a gap at any position.
  const contentWidth = total * stride;
  const copyCount = Math.max(
    2,
    Math.ceil(viewportWidth / Math.max(contentWidth, 1)) + 2
  );

  // Reveal observer: one-shot, disconnects once the rail has faded in.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !HAS_OBSERVER || revealed) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [revealed]);

  // The only DOM read the carousel needs; re-read on resize. Measured on the
  // section, not the viewport — the viewport's own width derives from this.
  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (props.carousel !== true || !section) {
      return;
    }
    const measure = (): void => setViewportWidth(section.clientWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [props.carousel]);

  // Auto-step one stride per tick while visible and unpaused.
  useEffect(() => {
    if (!carouselOn || paused) {
      return;
    }
    const id = window.setInterval(
      () => setPosition((p) => p + 1),
      CAROUSEL_STEP_MS
    );
    return () => window.clearInterval(id);
  }, [carouselOn, paused]);

  // Silent wrap: at position === total the track shows copy 2's first card
  // exactly where copy 1's was — pixel-identical to position 0 — so after the
  // slide finishes, jump back with the transition off. The next tick is
  // seconds away, so the 500ms reset always lands first.
  useEffect(() => {
    if (position !== total) {
      return;
    }
    const timer = window.setTimeout(() => {
      setInstant(true);
      setPosition(0);
    }, CAROUSEL_TRANSITION_MS + 50);
    return () => window.clearTimeout(timer);
  }, [position, total]);

  useEffect(() => {
    if (!instant) {
      return;
    }
    const raf = requestAnimationFrame(() => setInstant(false));
    return () => cancelAnimationFrame(raf);
  }, [instant]);

  // Off-screen pause: an auto-stepping rail past the fold is spent battery.
  // Separate observer from the reveal one — different lifetimes.
  useEffect(() => {
    const section = sectionRef.current;
    if (!carouselOn || !section || !HAS_OBSERVER) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setOffscreen(!entries.some((entry) => entry.isIntersecting));
      },
      { threshold: 0.15 }
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [carouselOn]);

  if (props.cards.length === 0) {
    return null;
  }
  return (
    <section
      ref={sectionRef}
      className={`mb-7 rail-reveal${revealed ? " is-visible" : ""}`}
      aria-label={props.eyebrow}
      data-role={props.role}
    >
      <div className="mb-3">
        <p className="eyebrow">{props.eyebrow}</p>
        <h2>{props.title}</h2>
      </div>
      {/* max-width, not width: caps the window at exactly 6 strides, yet still
          shrinks to the container when that is narrower than 6 stride floors. */}
      {carouselOn ? (
        <div
          className="rail-carousel"
          style={
            {
              maxWidth: `${stride * RAIL_VISIBLE}px`,
              "--rail-card-w": `${stride - RAIL_GAP_PX}px`,
            } as CSSProperties
          }
          onMouseEnter={() => setHoverPause(true)}
          onMouseLeave={() => setHoverPause(false)}
          onFocus={() => setFocusPause(true)}
          onBlur={() => setFocusPause(false)}
        >
          <div
            className={`rail-carousel-track${instant ? " is-instant" : ""}`}
            style={{
              width: `${copyCount * contentWidth}px`,
              transform: `translateX(${-position * stride}px)`,
            }}
          >
            {Array.from({ length: copyCount }, (_, index) => (
              <div
                className="rail-carousel-copy"
                key={index}
                style={{ width: `${contentWidth}px` }}
                aria-hidden={index > 0 || undefined}
                inert={index > 0}
              >
                {props.cards}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rail-track">
          {props.cards}
        </div>
      )}
    </section>
  );
}

// Compact rail card: cover + clamped title. Navigates to the manga detail page,
// same as the grid cards. `eager` loads covers immediately — the carousel's
// duplicated copies sit outside the window, where lazy loading never fires.
function RailCard({ manga, eager = false }: { manga: Manga; eager?: boolean }): ReactElement {
  return (
    <article
      className="rail-card"
      aria-label={manga.title}
      {...clickable(`/manga/${encodeURIComponent(manga.id)}`)}
    >
      <div className="rail-cover">
        <Cover
          url={manga.coverUrl}
          seed={manga.title}
          placeholderClass="cover-placeholder"
          loading={eager ? "eager" : "lazy"}
        />
      </div>
      <h3 className="rail-title">{manga.title}</h3>
    </article>
  );
}

// Resume card: cover + title + chapter/percent line. Opens the reader at the
// pinned chapter (progress restore picks the exact page).
function ResumeCard({ entry }: { entry: MangaHistoryEntry }): ReactElement {
  const percent = historyProgressPercent(entry);
  const sub =
    percent !== null
      ? `${historyChapterLabel(entry)} · ${percent}%`
      : historyChapterLabel(entry);
  return (
    <article
      className="rail-card"
      aria-label={`Continue reading ${entry.title}`}
      {...clickable(
        `/manga/${encodeURIComponent(entry.mangaId)}/chapter/${encodeURIComponent(entry.chapterId)}`
      )}
    >
      <div className="rail-cover">
        <Cover url={entry.coverUrl} seed={entry.title} placeholderClass="cover-placeholder" />
      </div>
      <h3 className="rail-title">{entry.title}</h3>
      <p className="rail-sub">{sub}</p>
    </article>
  );
}

// Featured hero rotator. Shows one title at a time over a blurred, gradient-faded
// cover; `‹ ›` step through the set. `kind` is "popular" when backed by real
// read-count ranking and "new" when it has fallen back to the newest titles, so
// the eyebrow never claims a ranking it does not have.
function Hero({
  items,
  kind,
}: {
  items: Manga[];
  kind: "popular" | "new";
}): ReactElement | null {
  // Slides are stacked absolutely. Rather than crossfading both (which dips below
  // full opacity mid-transition and flashes the backdrop through), the incoming
  // slide fades in ON TOP of the still-opaque outgoing one: `prev` keeps the
  // outgoing slide active at z-index 1 until the incoming (z-index 2) has fully
  // covered it. z-index is bounded to 0/1/2 so it never climbs above the nav.
  const [slide, setSlide] = useState({ current: 0, prev: null as number | null });
  const pausedRef = useRef(false);
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const advance = (delta: number): void => {
    setSlide((s) => {
      const next = (s.current + delta + items.length) % items.length;
      return next === s.current ? s : { current: next, prev: s.current };
    });
  };

  // Drop the outgoing slide once the incoming has fully covered it (no visible
  // change). Stepping again first re-arms the timeout via the dep.
  useEffect(() => {
    if (slide.prev === null) {
      return;
    }
    const timer = window.setTimeout(
      () => setSlide((s) => ({ ...s, prev: null })),
      650
    );
    return () => window.clearTimeout(timer);
  }, [slide]);

  // Auto-advance unless the user prefers reduced motion. Paused on hover/focus so
  // it doesn't move out from under a reader.
  useEffect(() => {
    if (items.length <= 1) {
      return;
    }
    if (reduceMotion) {
      return;
    }
    const timer = window.setInterval(() => {
      if (!pausedRef.current) {
        advance(1);
      }
    }, HERO_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [items.length, reduceMotion]);

  if (items.length === 0) {
    return null;
  }

  const eyebrow = kind === "popular" ? "Popular this week" : "New titles";

  return (
    <section
      className="hero"
      aria-label={eyebrow}
      data-role="hero"
      onMouseEnter={() => {
        pausedRef.current = true;
      }}
      onMouseLeave={() => {
        pausedRef.current = false;
      }}
      onFocus={() => {
        pausedRef.current = true;
      }}
      onBlur={() => {
        pausedRef.current = false;
      }}
    >
      <div className="hero-stage" data-role="hero-stage">
        {items.map((manga, index) => (
          <HeroSlide
            key={manga.id}
            manga={manga}
            eyebrow={eyebrow}
            active={index === slide.current || index === slide.prev}
            current={index === slide.current}
            zIndex={index === slide.current ? 2 : index === slide.prev ? 1 : 0}
          />
        ))}
      </div>
    </section>
  );
}

function HeroSlide(props: {
  manga: Manga;
  eyebrow: string;
  active: boolean;
  current: boolean;
  zIndex: number;
}): ReactElement {
  const { manga } = props;
  // No genre data in the model; surface author/artist instead.
  const credits = [manga.author, manga.artist].filter(Boolean).join(", ");
  return (
    <article
      className={`hero-slide${props.active ? " is-active" : ""}`}
      style={{ zIndex: props.zIndex }}
      aria-hidden={props.current ? undefined : true}
      aria-label={manga.title}
      {...clickable(`/manga/${encodeURIComponent(manga.id)}`)}
    >
      <div
        className="hero-bg"
        style={
          manga.coverUrl
            ? { backgroundImage: `url("${manga.coverUrl}")` }
            : undefined
        }
        aria-hidden="true"
      />
      <div className="hero-fade" aria-hidden="true" />
      <div className="hero-content">
        <div className="hero-cover">
          <Cover url={manga.coverUrl} seed={manga.title} placeholderClass="cover-placeholder" />
        </div>
        <div className="min-w-0 text-[#f5f3ee]">
          <p className="mb-2 text-[0.72rem] font-bold tracking-[0.12em] text-[rgba(245,243,238,0.72)] uppercase">{props.eyebrow}</p>
          <h2 className="hero-title">{manga.title}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-[999px] bg-[rgba(245,243,238,0.16)] px-2.5 py-1 text-[0.68rem] font-bold tracking-[0.08em] text-[#f5f3ee] uppercase">{statusLabel(manga.status)}</span>
          </div>
          {credits ? <p className="hero-credits">{credits}</p> : null}
          {manga.description ? <p className="hero-desc">{manga.description}</p> : null}
        </div>
      </div>
    </article>
  );
}

const HAS_OBSERVER = "IntersectionObserver" in window;

const ADVANCED_DEFAULTS = {
  author: "",
  artist: "",
  publisher: "",
  year: "",
  sort: "created_at",
  order: "desc",
};

type AdvancedFields = typeof ADVANCED_DEFAULTS;

// Library heading + search/filters + paged grid. Server-side paging over
// GET /manga via limit/offset, seeded with the already-fetched first page.
function Library({ firstPage }: { firstPage: Manga[] }): ReactElement {
  const [items, setItems] = useState<Manga[]>(firstPage);
  const [message, setMessage] = useState<string | null>(null);
  // A failed page fetch during infinite scroll; drives an inline retry affordance
  // that re-attempts the same page without resetting the loaded list.
  const [pageError, setPageError] = useState<string | null>(null);
  const [moreHidden, setMoreHidden] = useState(
    HAS_OBSERVER || firstPage.length < PAGE_SIZE
  );
  const [statusFilter, setStatusFilter] = useState<MangaStatus | "">("");
  const [tagFilter, setTagFilter] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [popOpen, setPopOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [adv, setAdv] = useState<AdvancedFields>(ADVANCED_DEFAULTS);

  // Query control flow lives in refs: `seq` guards search vs scroll races so a
  // newer query's results never mix with an older one's, and the
  // IntersectionObserver callback outlives any single render.
  const seqRef = useRef(0);
  const termRef = useRef("");
  const offsetRef = useRef(firstPage.length);
  const loadingRef = useRef(false);
  const doneRef = useRef(firstPage.length < PAGE_SIZE);
  const statusRef = useRef<MangaStatus | "">("");
  const tagRef = useRef("");
  // Advanced fields apply on Search/Clear, not per keystroke — `adv` is the
  // draft, this ref is what queries actually use.
  const advRef = useRef<AdvancedFields>(ADVANCED_DEFAULTS);
  // Tags fetch once per page view, on the popup's first open (the catalog rarely
  // changes tags mid-session). Reset on failure so the next open retries.
  const tagsRequestedRef = useRef(false);
  const debounceRef = useRef<number | undefined>(undefined);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const filterPopRef = useRef<HTMLDivElement>(null);
  const advBtnRef = useRef<HTMLButtonElement>(null);
  const advPanelRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const queryParams = (): ListMangaParams => ({
    limit: PAGE_SIZE,
    offset: offsetRef.current,
    ...(termRef.current ? { search: termRef.current } : {}),
    ...(statusRef.current ? { status: statusRef.current } : {}),
    ...(tagRef.current ? { tag: tagRef.current } : {}),
    ...(advRef.current.author ? { author: advRef.current.author } : {}),
    ...(advRef.current.artist ? { artist: advRef.current.artist } : {}),
    ...(advRef.current.publisher ? { publisher: advRef.current.publisher } : {}),
    ...(advRef.current.year ? { year: advRef.current.year } : {}),
    ...(advRef.current.sort ? { sort: advRef.current.sort } : {}),
    ...(advRef.current.order ? { order: advRef.current.order } : {}),
  });

  // The button is only a fallback when IntersectionObserver is unavailable;
  // with it, the sentinel drives infinite scroll and the button stays hidden.
  const syncMore = (): void => {
    setMoreHidden(HAS_OBSERVER || doneRef.current || loadingRef.current);
  };

  const loadFirst = async (nextTerm: string): Promise<void> => {
    const mySeq = ++seqRef.current;
    termRef.current = nextTerm;
    offsetRef.current = 0;
    doneRef.current = false;
    loadingRef.current = true;
    setPageError(null);
    syncMore();
    try {
      const list = await listManga(queryParams());
      if (mySeq !== seqRef.current) {
        return;
      }
      if (list.length === 0) {
        setItems([]);
        setMessage("No titles match your filters.");
        doneRef.current = true;
        return;
      }
      setMessage(null);
      setItems(list);
      offsetRef.current = list.length;
      doneRef.current = list.length < PAGE_SIZE;
    } catch (queryError) {
      if (mySeq !== seqRef.current) {
        return;
      }
      setItems([]);
      setMessage(
        queryError instanceof Error ? queryError.message : "Search failed."
      );
      doneRef.current = true;
    } finally {
      if (mySeq === seqRef.current) {
        loadingRef.current = false;
        syncMore();
      }
    }
  };

  const loadMore = async (): Promise<void> => {
    if (loadingRef.current || doneRef.current) {
      return;
    }
    const mySeq = seqRef.current;
    loadingRef.current = true;
    syncMore();
    try {
      const list = await listManga(queryParams());
      if (mySeq !== seqRef.current) {
        return;
      }
      setItems((current) => [...current, ...list]);
      offsetRef.current += list.length;
      doneRef.current = list.length < PAGE_SIZE;
    } catch (queryError) {
      if (mySeq !== seqRef.current) {
        return;
      }
      // Halt auto-loading (so the observer doesn't retry-loop) and surface an
      // inline retry that re-arms this same page.
      doneRef.current = true;
      setPageError(
        queryError instanceof Error ? queryError.message : "Couldn't load more titles."
      );
    } finally {
      if (mySeq === seqRef.current) {
        loadingRef.current = false;
        syncMore();
      }
    }
  };

  // Clears the error and re-arms the halted page fetch, keeping the loaded list.
  const retryLoadMore = (): void => {
    setPageError(null);
    doneRef.current = false;
    void loadMore();
  };

  // Latest loadMore for the mount-once observer below.
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !HAS_OBSERVER) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreRef.current();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // "/" focuses the library search (unless typing in a field).
  useEffect(() => {
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== "/" || event.defaultPrevented) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      const search = searchInputRef.current;
      if (search) {
        event.preventDefault();
        search.focus();
      }
    };
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, []);

  // Clear a pending search debounce on unmount.
  useEffect(() => () => window.clearTimeout(debounceRef.current), []);

  const onSearchInput = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.target.value.trim();
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => void loadFirst(next), 300);
  };

  // Status filter popup anchored to the search bar's filter icon; the advanced
  // panel dismisses the same way (click-outside + Escape).
  usePopupDismiss(popOpen, [filterPopRef, filterBtnRef], () => setPopOpen(false));
  usePopupDismiss(advOpen, [advPanelRef, advBtnRef], () => setAdvOpen(false));

  const toggleFilterPop = (): void => {
    if (popOpen) {
      setPopOpen(false);
      return;
    }
    if (!tagsRequestedRef.current) {
      tagsRequestedRef.current = true;
      void listMangaTags()
        .then(setTags)
        .catch(() => {
          tagsRequestedRef.current = false;
        });
    }
    setPopOpen(true);
  };

  const chooseStatus = (next: MangaStatus | ""): void => {
    setPopOpen(false);
    if (next === statusRef.current) {
      return;
    }
    statusRef.current = next;
    setStatusFilter(next);
    void loadFirst(termRef.current);
  };

  const chooseTag = (next: string): void => {
    setPopOpen(false);
    if (next === tagRef.current) {
      return;
    }
    tagRef.current = next;
    setTagFilter(next);
    void loadFirst(termRef.current);
  };

  const applyAdvanced = (): void => {
    advRef.current = {
      author: adv.author.trim(),
      artist: adv.artist.trim(),
      publisher: adv.publisher.trim(),
      year: adv.year.trim(),
      sort: adv.sort,
      order: adv.order,
    };
    void loadFirst(termRef.current);
  };

  const clearAdvanced = (): void => {
    setAdv(ADVANCED_DEFAULTS);
    advRef.current = ADVANCED_DEFAULTS;
    void loadFirst(termRef.current);
  };

  // The funnel tints whenever any filter (status or tag) is active.
  const filterActive = statusFilter !== "" || tagFilter !== "";
  const countText =
    message !== null ? "" : `${items.length} title${items.length === 1 ? "" : "s"}`;

  return (
    <>
      <section className="page-heading">
        <div>
          <h1>Library</h1>
          <p className="heading-meta" data-role="count">
            {countText}
          </p>
        </div>
        <div className="heading-aside">
          <div className="inline-flex items-center gap-2">
            <div className="relative inline-flex">
              <input
                ref={searchInputRef}
                className="library-search"
                type="search"
                placeholder="Search"
                aria-label="Search manga"
                autoComplete="off"
                onChange={onSearchInput}
              />
              <kbd className="search-kbd" aria-hidden="true">
                /
              </kbd>
              <button
                ref={filterBtnRef}
                className={`library-filter${filterActive ? " is-active" : ""}`}
                type="button"
                aria-label="Filter by status"
                aria-haspopup="true"
                aria-expanded={popOpen}
                onClick={toggleFilterPop}
              >
                <Funnel className="icon" size={20} aria-hidden="true" />
              </button>
              {/* Plain toggle buttons (aria-pressed), not a menu: the popup mixes a
                  status single-select with a tag group, so ARIA menu semantics
                  (roving focus, menuitemradio) don't fit — downgrade over-claims. */}
              <div
                ref={filterPopRef}
                className={`library-filter-pop${popOpen ? " is-open" : ""}`}
              >
                <button
                  className={`library-filter-option${statusFilter === "" ? " is-active" : ""}`}
                  type="button"
                  aria-pressed={statusFilter === ""}
                  onClick={() => chooseStatus("")}
                >
                  All status
                </button>
                {MANGA_STATUSES.map((status) => (
                  <button
                    key={status}
                    className={`library-filter-option${statusFilter === status ? " is-active" : ""}`}
                    type="button"
                    aria-pressed={statusFilter === status}
                    onClick={() => chooseStatus(status)}
                  >
                    {statusLabel(status)}
                  </button>
                ))}
                <div
                  className="library-filter-tags"
                  data-role="tag-options"
                  hidden={tags.length === 0}
                >
                  <p className="mb-1.5 text-[0.75rem] font-bold text-text-secondary uppercase">Tags</p>
                  <div className="library-filter-tag-list">
                    <button
                      className={`library-filter-tag${tagFilter === "" ? " is-active" : ""}`}
                      type="button"
                      aria-pressed={tagFilter === ""}
                      onClick={() => chooseTag("")}
                    >
                      All
                    </button>
                    {tags.map((tag) => (
                      <button
                        key={tag}
                        className={`library-filter-tag${tagFilter === tag ? " is-active" : ""}`}
                        type="button"
                        aria-pressed={tagFilter === tag}
                        onClick={() => chooseTag(tag)}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <button
              ref={advBtnRef}
              className={`library-advanced-btn${advOpen ? " is-active" : ""}`}
              type="button"
              aria-label="Advanced search"
              aria-expanded={advOpen}
              onClick={() => setAdvOpen((open) => !open)}
            >
              Advanced
            </button>
          </div>
          <div ref={advPanelRef} className="library-advanced-panel" hidden={!advOpen}>
            <div className="mb-3 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[0.75rem] font-bold text-text-secondary" htmlFor="adv-author">Author</label>
                <input
                  id="adv-author"
                  className="library-advanced-input"
                  type="text"
                  placeholder="Any author"
                  value={adv.author}
                  onChange={(e) => setAdv({ ...adv, author: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[0.75rem] font-bold text-text-secondary" htmlFor="adv-artist">Artist</label>
                <input
                  id="adv-artist"
                  className="library-advanced-input"
                  type="text"
                  placeholder="Any artist"
                  value={adv.artist}
                  onChange={(e) => setAdv({ ...adv, artist: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[0.75rem] font-bold text-text-secondary" htmlFor="adv-publisher">Publisher</label>
                <input
                  id="adv-publisher"
                  className="library-advanced-input"
                  type="text"
                  placeholder="Any publisher"
                  value={adv.publisher}
                  onChange={(e) => setAdv({ ...adv, publisher: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[0.75rem] font-bold text-text-secondary" htmlFor="adv-year">Year</label>
                <input
                  id="adv-year"
                  className="library-advanced-input"
                  type="text"
                  placeholder="2020 or 2020-2024"
                  value={adv.year}
                  onChange={(e) => setAdv({ ...adv, year: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[0.75rem] font-bold text-text-secondary" htmlFor="adv-sort">Sort</label>
                <PopupSelect
                  id="adv-sort"
                  className="library-advanced-select"
                  ariaLabel="Sort"
                  value={adv.sort}
                  options={[
                    { value: "created_at", label: "Newest" },
                    { value: "updated_at", label: "Updated" },
                    { value: "title", label: "Title" },
                    { value: "published_year", label: "Year" },
                  ]}
                  onChange={(value) => setAdv({ ...adv, sort: value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[0.75rem] font-bold text-text-secondary" htmlFor="adv-order">Order</label>
                <PopupSelect
                  id="adv-order"
                  className="library-advanced-select"
                  ariaLabel="Order"
                  value={adv.order}
                  options={[
                    { value: "desc", label: "Descending" },
                    { value: "asc", label: "Ascending" },
                  ]}
                  onChange={(value) => setAdv({ ...adv, order: value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="library-advanced-clear"
                type="button"
                onClick={clearAdvanced}
              >
                Clear
              </button>
              <button
                className="library-advanced-submit"
                type="button"
                onClick={applyAdvanced}
              >
                Search
              </button>
            </div>
          </div>
        </div>
      </section>
      <section className="manga-grid" aria-label="Manga list" data-role="grid">
        {message !== null ? (
          <p className="library-empty">{message}</p>
        ) : (
          items.map((manga) => <MangaCard key={manga.id} manga={manga} />)
        )}
      </section>
      <div ref={sentinelRef} className="h-px" aria-hidden="true" />
      {pageError !== null ? (
        <>
          <ErrorState message={pageError} />
          <button
            className="secondary-button library-more"
            type="button"
            onClick={retryLoadMore}
          >
            Retry
          </button>
        </>
      ) : (
        <button
          className="secondary-button library-more"
          type="button"
          hidden={moreHidden}
          onClick={() => void loadMore()}
        >
          Load more
        </button>
      )}
    </>
  );
}
