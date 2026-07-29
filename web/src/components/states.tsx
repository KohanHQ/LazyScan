import type { ReactElement, ReactNode } from "react";

export function Loading({ message = "Loading" }: { message?: string }): ReactElement {
  return (
    <div className="state-block state-loading" role="status">
      {message}
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
    <section className="state-block state-block-strong state-empty">
      {props.icon ? (
        <div className="state-empty-icon" aria-hidden="true">
          {props.icon}
        </div>
      ) : null}
      <h2>{props.title}</h2>
      <p>{props.message}</p>
    </section>
  );
}

export function ErrorState({ message }: { message: string }): ReactElement {
  return (
    <section className="state-block state-error" role="alert">
      <h2>Something went wrong</h2>
      <p>{message}</p>
    </section>
  );
}

// Card-grid loading placeholder: cover + title blocks with a shimmer sweep
// (base.css). Mirrors .manga-grid's layout so the swap doesn't shift the page;
// the grid class carries the delayed reveal so fast fetches never flash it.
export function CardGridSkeleton({
  count = 10,
}: {
  count?: number;
}): ReactElement {
  return (
    <section
      className="manga-grid skeleton-grid"
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-card" key={index} aria-hidden="true">
          <div className="skeleton-block skeleton-cover" />
          <div className="skeleton-block skeleton-line" />
          <div className="skeleton-block skeleton-line skeleton-line-short" />
        </div>
      ))}
    </section>
  );
}
