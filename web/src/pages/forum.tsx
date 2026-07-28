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
        <ol className="forum-list">
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
    <li
      className="forum-row"
      aria-label={`Open ${category.name}`}
      {...clickable(`/forum/${encodeURIComponent(category.slug)}`)}
    >
      <div className="forum-row-body">
        <h3>{category.name}</h3>
        {category.description !== null ? (
          <p className="forum-row-desc">{category.description}</p>
        ) : null}
      </div>
      <p className="forum-row-meta">
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
