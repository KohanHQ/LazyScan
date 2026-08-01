import {
  DoorOpen,
  Heart,
  History,
  Inbox,
  Library,
  MessageSquare,
  Pencil,
  Rss,
  Settings,
  User,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Cover } from "@/components/cover";
import { navigateTo } from "@/router";
import { getSession, logout } from "@/state/session";
import { useSession } from "@/state/hooks";
import { resolveAvatar } from "@/utils/avatar";

// .sidebar-link survives to carry the button's font scale and border reset:
// unlayered `button { font: inherit }` beats any Tailwind font utility.
const LINK =
  "sidebar-link flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-accent hover:text-accent-fg focus-visible:bg-surface-accent focus-visible:text-accent-fg";
const LINK_ON = "bg-surface-accent text-accent-fg";
const LINK_OFF = "bg-transparent text-text-label";

function isActive(path: string, route: string): boolean {
  if (route === "/") {
    return path === "/" || path.startsWith("/manga");
  }
  return path === route || path.startsWith(`${route}/`);
}

export function Sidebar({ path }: { path: string }): ReactElement {
  const session = useSession();

  const navItem = (route: string, label: string, icon: ReactNode): ReactElement => {
    const active = isActive(path, route);
    return (
      <button
        className={`${LINK} ${active ? LINK_ON : LINK_OFF}`}
        type="button"
        title={label}
        aria-current={active ? "page" : undefined}
        onClick={() => navigateTo(route)}
      >
        <span className="inline-flex flex-none" aria-hidden="true">
          {icon}
        </span>
        <span className="whitespace-nowrap">{label}</span>
      </button>
    );
  };

  // Account avatar (authenticated only) links to the profile. A custom avatar
  // (owner-only upload) wins; otherwise it derives from the display name's
  // first word.
  const accountName = session.user
    ? session.user.displayName || session.user.username || session.user.email
    : "";

  const authLabel = session.user ? "Logout" : "Login";

  return (
    <>
      <nav className="flex flex-col gap-1" aria-label="Primary">
        {navItem("/", "Library", <Library className="icon" size={20} />)}
        {navItem("/forum", "Forum", <MessageSquare className="icon" size={20} />)}
        {session.user
          ? navItem("/feed", "Feed", <Rss className="icon" size={20} />)
          : null}
        {session.user
          ? navItem("/favorites", "Favorites", <Heart className="icon" size={20} />)
          : null}
        {session.user
          ? navItem("/status", "Tracking", <Inbox className="icon" size={20} />)
          : null}
        {session.user
          ? navItem("/history", "History", <History className="icon" size={20} />)
          : null}
        {session.user
          ? navItem("/manage", "Manage", <Pencil className="icon" size={20} />)
          : null}
        {session.user
          ? navItem("/user", "Find user", <User className="icon" size={20} />)
          : null}
        {session.user?.role === "superuser"
          ? navItem("/settings", "Settings", <Settings className="icon" size={20} />)
          : null}
      </nav>
      <div className="mt-auto flex flex-col gap-1 pt-3">
        {session.user ? (
          <button
            className={`${LINK} ${LINK_OFF} sidebar-account`}
            type="button"
            title={accountName}
            onClick={() => navigateTo("/profile")}
          >
            {/* .sidebar-avatar stays: it is the hook for the
                `.sidebar-avatar .user-avatar` rule sizing Cover's output. */}
            <span
              className="sidebar-avatar inline-flex size-6 flex-none"
              aria-hidden="true"
            >
              <Cover
                url={resolveAvatar(session.user.avatarUrl, accountName)}
                seed={accountName}
                placeholderClass="user-avatar"
                imgClassName="user-avatar"
              />
            </span>
            <span className="whitespace-nowrap">{accountName}</span>
          </button>
        ) : null}
        <button
          className={`${LINK} ${LINK_OFF} sidebar-door`}
          type="button"
          title={authLabel}
          aria-label={authLabel}
          onClick={async () => {
            if (getSession().user) {
              await logout();
              navigateTo("/");
            } else {
              navigateTo("/login");
            }
          }}
        >
          <span className="inline-flex flex-none" aria-hidden="true">
            <DoorOpen className="icon" size={20} />
          </span>
          <span className="whitespace-nowrap">{authLabel}</span>
        </button>
        <p className="sidebar-copy">© 2026 LazyScan</p>
      </div>
    </>
  );
}
