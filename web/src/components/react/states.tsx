import type { ReactElement } from "react";

// React counterparts of components/states.ts; they replace it once the last
// vanilla page is converted.
export function Loading({ message = "Loading" }: { message?: string }): ReactElement {
  return (
    <div className="state-block" role="status">
      {message}
    </div>
  );
}

export function Empty(props: { title: string; message: string }): ReactElement {
  return (
    <section className="state-block state-block-strong state-empty">
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
