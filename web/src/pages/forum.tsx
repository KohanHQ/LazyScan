import type { ReactElement } from "react";
import { MessageSquare } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { Empty } from "@/components/states";

// Forum placeholder: the sidebar item exists so the surface is discoverable,
// but the feature itself is not built yet.
export function ForumPage(): ReactElement {
  return (
    <>
      <PageHeading eyebrow="Community" title="Forum" />
      <Empty
        title="Forum coming soon"
        message="Discussions are not open yet. Check back later."
        icon={<MessageSquare className="icon" size={20} />}
      />
    </>
  );
}
