import type { ReactElement, ReactNode } from "react";
import type { CurrentUser } from "@/api/auth";
import { Loading } from "@/components/states";
import { navigateTo } from "@/router";
import { useSession } from "@/state/hooks";

// Gates an auth-only page: loading while session bootstrap settles, the
// login-required block for anonymous visitors, else the page. The API stays the
// real guard; this only controls the affordance.
export function RequireSession(props: {
  loading?: string;
  loginMessage?: string;
  children: (user: CurrentUser) => ReactNode;
}): ReactElement {
  const session = useSession();

  if (session.isBootstrapping) {
    return <Loading message={props.loading ?? "Loading"} />;
  }

  if (!session.user) {
    return (
      <section className="state-block state-block-strong">
        <h2>Login required</h2>
        <p>{props.loginMessage ?? "Log in to continue."}</p>
        <button
          className="primary-button"
          type="button"
          onClick={() => navigateTo("/login")}
        >
          Login
        </button>
      </section>
    );
  }

  return <>{props.children(session.user)}</>;
}
