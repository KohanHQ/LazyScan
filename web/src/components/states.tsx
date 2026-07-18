import type { ReactElement, ReactNode } from "react";

export function Loading({ message = "Loading" }: { message?: string }): ReactElement {
  return (
    <div className="state-block state-loading" role="status">
      {message}
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
