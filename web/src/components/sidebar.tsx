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
        className={`sidebar-link${active ? " sidebar-link-active" : ""}`}
        type="button"
        title={label}
        aria-current={active ? "page" : undefined}
        onClick={() => navigateTo(route)}
      >
        <span className="sidebar-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="sidebar-label">{label}</span>
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
      <nav className="sidebar-nav" aria-label="Primary">
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
      <div className="sidebar-footer">
        {session.user ? (
          <button
            className="sidebar-link sidebar-account"
            type="button"
            title={accountName}
            onClick={() => navigateTo("/profile")}
          >
            <span className="sidebar-icon sidebar-avatar" aria-hidden="true">
              <Cover
                url={resolveAvatar(session.user.avatarUrl, accountName)}
                seed={accountName}
                placeholderClass="user-avatar"
                imgClassName="user-avatar"
              />
            </span>
            <span className="sidebar-label">{accountName}</span>
          </button>
        ) : null}
        <button
          className="sidebar-link sidebar-door"
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
          <span className="sidebar-icon" aria-hidden="true">
            <DoorOpen className="icon" size={20} />
          </span>
          <span className="sidebar-label">{authLabel}</span>
        </button>
        <p className="sidebar-copy">© 2026 LazyScan</p>
      </div>
    </>
  );
}
