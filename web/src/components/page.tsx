import type { ReactElement, ReactNode } from "react";
import { PageHeading } from "@/components/page-heading";

// Standard heading + a page-width content container. Trap: `.page-stack` (default)
// widens any `.manage-panel` inside it — forms wanting the narrow column pass
// stack={false}.
export function Page(props: {
  title: string;
  eyebrow?: string;
  meta?: ReactNode;
  aside?: ReactNode;
  stack?: boolean;
  className?: string;
  children: ReactNode;
}): ReactElement {
  const { stack = true, className = "" } = props;
  const containerClass = ["page-content", stack ? "page-stack" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <PageHeading
        title={props.title}
        eyebrow={props.eyebrow}
        meta={props.meta}
        aside={props.aside}
      />
      <div className={containerClass}>{props.children}</div>
    </>
  );
}
