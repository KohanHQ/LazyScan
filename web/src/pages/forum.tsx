import { useEffect, useState, type ReactElement } from "react";
import { MessageSquare } from "lucide-react";
import { listForumCategories, type ForumCategory } from "@/api/forum";
import { PageHeading } from "@/components/page-heading";
import { Empty, ErrorState, Loading } from "@/components/states";
import { clickable } from "@/lib/clickable";
import { formatDate } from "@/utils/format";

// Forum index (/forum): the seeded category list. Public — reading needs no
// session; the composers live one level down.
export function ForumPage(): ReactElement {
  const [categories, setCategories] = useState<ForumCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    listForumCategories()
      .then((list) => {
        if (!ignore) {
          setCategories(list);
        }
      })
      .catch((loadError) => {
        if (!ignore) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load the forum."
          );
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  if (error !== null) {
    return (
      <>
        <PageHeading eyebrow="Community" title="Forum" />
        <ErrorState message={error} />
      </>
    );
  }

  if (categories === null) {
    return (
      <>
        <PageHeading eyebrow="Community" title="Forum" />
        <Loading message="Loading categories" />
      </>
    );
  }

  const threads = categories.reduce(
    (sum, category) => sum + category.threadCount,
    0
  );

  return (
    <>
      <PageHeading
        eyebrow="Community"
        title="Forum"
        meta={
          categories.length > 0 ? (
            <p className="heading-meta" data-role="count">
              {threads} thread{threads === 1 ? "" : "s"} across{" "}
              {categories.length} categor{categories.length === 1 ? "y" : "ies"}
            </p>
          ) : undefined
        }
      />
      {categories.length === 0 ? (
        <Empty
          title="No categories yet"
          message="Discussion categories will appear here once they are set up."
          icon={<MessageSquare className="icon" size={20} />}
        />
      ) : (
        <ol className="m-0 mb-2 grid list-none gap-2.5 p-0">
          {categories.map((category) => (
            <CategoryRow key={category.id} category={category} />
          ))}
        </ol>
      )}
    </>
  );
}

function CategoryRow({ category }: { category: ForumCategory }): ReactElement {
  return (
    // The narrow-screen stack is written as a raw media query: Tailwind's
    // `max-sm:`/`max-[640px]:` compile to `width < 640px` and would drop 640 itself.
    <li
      className="flex cursor-pointer items-center gap-4.5 rounded-lg border border-border bg-surface px-4 py-3.5 outline-none hover:border-accent-fg hover:bg-surface-accent focus-visible:border-accent-fg focus-visible:bg-surface-accent [@media(max-width:640px)]:flex-col [@media(max-width:640px)]:items-start [@media(max-width:640px)]:gap-2"
      aria-label={`Open ${category.name}`}
      {...clickable(`/forum/${encodeURIComponent(category.slug)}`)}
    >
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-1.5 wrap-anywhere">{category.name}</h3>
        {category.description !== null ? (
          <p className="m-0 text-[0.85rem] wrap-anywhere text-text-secondary">
            {category.description}
          </p>
        ) : null}
      </div>
      <p className="m-0 grid shrink-0 gap-0.5 text-right text-[0.8rem] text-text-secondary [@media(max-width:640px)]:text-left">
        <span>
          {category.threadCount} thread{category.threadCount === 1 ? "" : "s"}
        </span>
        <span>
          {category.lastActivityAt !== null
            ? `Active ${formatDate(category.lastActivityAt)}`
            : "No activity yet"}
        </span>
      </p>
    </li>
  );
}
