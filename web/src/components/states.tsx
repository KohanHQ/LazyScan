import type { ReactElement, ReactNode } from "react";

export function Loading({ message = "Loading" }: { message?: string }): ReactElement {
  return (
    <div
      className="state-loading flex min-h-[40vh] items-center justify-center p-7 text-text-secondary"
      role="status"
      aria-label={message}
    >
      <span className="state-loading-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

export function Empty(props: {
  title: string;
  message: string;
  icon?: ReactNode;
}): ReactElement {
  return (
    <section className="rounded-lg border border-border bg-surface p-7 text-center text-text-secondary">
      {props.icon ? (
        <div
          className="mb-2 flex justify-center text-text-muted [&_.icon]:size-10"
          aria-hidden="true"
        >
          {props.icon}
        </div>
      ) : null}
      <h2 className="text-text">{props.title}</h2>
      <p>{props.message}</p>
    </section>
  );
}

export function ErrorState({ message }: { message: string }): ReactElement {
  return (
    <section
      className="rounded-lg border border-danger-border bg-danger-surface p-7 text-text-secondary"
      role="alert"
    >
      <h2 className="text-text">Something went wrong</h2>
      <p>{message}</p>
    </section>
  );
}

// Card-grid loading placeholder: cover + title blocks with a shimmer sweep
// (components.css). Mirrors .manga-grid's layout so the swap doesn't shift the page;
// the grid class carries the delayed reveal so fast fetches never flash it.
export function CardGridSkeleton({
  count = 10,
}: {
  count?: number;
}): ReactElement {
  // .skeleton-block stays as the hook for the shimmer ::after sweep in components.css.
  const block = "skeleton-block relative overflow-hidden bg-surface-raised";
  return (
    <section
      className="manga-grid skeleton-grid"
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          className="overflow-hidden rounded-lg border border-border bg-surface"
          key={index}
          aria-hidden="true"
        >
          <div className={`${block} aspect-[3/4]`} />
          <div className={`${block} mx-3.5 mt-3 h-2.5 rounded-[5px]`} />
          <div
            className={`${block} mx-3.5 mt-3 mb-3.5 h-2.5 w-[55%] rounded-[5px]`}
          />
        </div>
      ))}
    </section>
  );
}
