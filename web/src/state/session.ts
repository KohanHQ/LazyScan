import * as authApi from "@/api/auth";
import type {
  AuthCredentials,
  CurrentUser,
  RegisterResult,
  VerifyEmailInput,
} from "@/api/auth";

type SessionState = {
  user: CurrentUser | null;
  isBootstrapping: boolean;
};

type SessionListener = (state: SessionState) => void;

const listeners = new Set<SessionListener>();

let state: SessionState = {
  user: null,
  isBootstrapping: true,
};

function setState(nextState: SessionState): void {
  state = nextState;
  for (const listener of listeners) {
    listener(state);
  }
}

export function getSession(): SessionState {
  return state;
}

export function subscribeSession(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Resolves once session bootstrap has settled (user known or confirmed absent).
// Fires synchronously if already settled; otherwise waits for the first
// post-bootstrap state and then unsubscribes. Lets auth-gated pages render
// correctly on a hard load without getting stuck before bootstrap resolves.
export function onSessionReady(listener: SessionListener): void {
  if (!state.isBootstrapping) {
    listener(state);
    return;
  }

  const unsubscribe = subscribeSession((next) => {
    if (!next.isBootstrapping) {
      unsubscribe();
      listener(next);
    }
  });
}

export async function bootstrapSession(): Promise<void> {
  try {
    const user = await authApi.getCurrentUser();
    setState({ user, isBootstrapping: false });
  } catch {
    setState({ user: null, isBootstrapping: false });
  }
}

export async function login(credentials: AuthCredentials): Promise<void> {
  await authApi.login(credentials);
  const user = await authApi.getCurrentUser();
  setState({ user, isBootstrapping: false });
}

// Register no longer bootstraps the session (hard verify: the API sets no
// cookie). The caller routes to the verify view; verifyEmail completes the
// login.
export function register(credentials: AuthCredentials): Promise<RegisterResult> {
  return authApi.register(credentials);
}

export async function verifyEmail(input: VerifyEmailInput): Promise<void> {
  await authApi.verifyEmail(input);
  const user = await authApi.getCurrentUser();
  setState({ user, isBootstrapping: false });
}

export async function logout(): Promise<void> {
  await authApi.logout();
  setState({ user: null, isBootstrapping: false });
}
