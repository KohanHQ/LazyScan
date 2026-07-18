import type { ReactElement, ReactNode } from "react";

// React counterpart of components/page-heading.ts; it replaces that file once the
// last vanilla page is converted.
export function PageHeading(props: {
  title: string;
  eyebrow?: string;
  meta?: ReactNode;
  aside?: ReactNode;
}): ReactElement {
  return (
    <section className="page-heading">
      <div>
        {props.eyebrow ? <p className="eyebrow">{props.eyebrow}</p> : null}
        <h1>{props.title}</h1>
        {props.meta}
      </div>
      {props.aside ? <div className="heading-aside">{props.aside}</div> : null}
    </section>
  );
}
