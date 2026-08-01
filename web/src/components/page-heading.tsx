import type { ReactElement, ReactNode } from "react";

export function PageHeading(props: {
  title: string;
  eyebrow?: string;
  meta?: ReactNode;
  aside?: ReactNode;
}): ReactElement {
  return (
    <section className="page-heading">
      <div>
        {props.eyebrow ? (
          <p className="mt-0 mb-1.5 text-[0.78rem] font-extrabold tracking-normal text-accent-fg uppercase">
            {props.eyebrow}
          </p>
        ) : null}
        <h1>{props.title}</h1>
        {props.meta}
      </div>
      {props.aside ? (
        <div className="flex items-center gap-3.5">{props.aside}</div>
      ) : null}
    </section>
  );
}
