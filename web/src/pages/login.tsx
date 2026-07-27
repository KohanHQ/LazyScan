import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { Eye, EyeOff } from "lucide-react";
import * as authApi from "@/api/auth";
import { ApiClientError } from "@/api/client";
import { navigateTo } from "@/router";
import * as session from "@/state/session";
import bundledLoginArt from "../../assets/login.webp";

// Baked at build time; swap the image by overwriting the same R2 key (no rebuild).
const loginArt = import.meta.env.VITE_LOGIN_ART_URL || bundledLoginArt;

type AuthMode = "login" | "register";

const RESEND_COOLDOWN_SECONDS = 60;

type ViewState =
  | { kind: "form" }
  | { kind: "verify"; email: string; cooldownActive: boolean }
  | { kind: "forgot" }
  | { kind: "reset"; email: string };

export function LoginPage({ mode }: { mode: AuthMode }): ReactElement {
  const [view, setView] = useState<ViewState>({ kind: "form" });

  if (view.kind === "verify") {
    return (
      <VerifyView email={view.email} cooldownActive={view.cooldownActive} />
    );
  }

  if (view.kind === "forgot") {
    return <ForgotView onSent={(email) => setView({ kind: "reset", email })} />;
  }

  if (view.kind === "reset") {
    return (
      <ResetView email={view.email} onDone={() => setView({ kind: "form" })} />
    );
  }

  return (
    <AuthForm
      mode={mode}
      onVerify={(email, cooldownActive) =>
        setView({ kind: "verify", email, cooldownActive })
      }
      onForgot={() => setView({ kind: "forgot" })}
    />
  );
}

function AuthForm({
  mode,
  onVerify,
  onForgot,
}: {
  mode: AuthMode;
  onVerify: (email: string, cooldownActive: boolean) => void;
  onForgot: () => void;
}): ReactElement {
  const isRegister = mode === "register";
  const title = isRegister ? "Create account" : "Login";
  const actionLabel = isRegister ? "Register" : "Login";
  const switchPath = isRegister ? "/login" : "/register";
  const switchLabel = isRegister
    ? "Already have an account?"
    : "Need an account?";
  const switchAction = isRegister ? "Login" : "Register";

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") || "");
    const password = String(formData.get("password") || "");

    setError(null);
    setBusy(true);
    try {
      if (isRegister) {
        // Register sets no session; the code was just emailed, so the resend
        // cooldown is already running server-side.
        await session.register({ email, password });
        onVerify(email, true);
        return;
      }
      await session.login({ email, password });
      navigateTo("/");
    } catch (authError) {
      if (
        authError instanceof ApiClientError &&
        authError.code === "EMAIL_NOT_VERIFIED"
      ) {
        onVerify(email, false);
        return;
      }
      setError(
        authError instanceof Error ? authError.message : "Authentication failed."
      );
    } finally {
      setBusy(false);
    }
  };

  const busyLabel = isRegister ? "Registering" : "Logging in";

  return (
    <div className="auth-screen">
      <img
        className="auth-art"
        src={loginArt}
        alt=""
        aria-hidden="true"
        decoding="async"
      />
      <section className="auth-panel" aria-labelledby="auth-title">
        <div>
          <h1 id="auth-title">{title}</h1>
        </div>
        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            <span>Password</span>
            <div className="password-field">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={isRegister ? "new-password" : "current-password"}
                required
                minLength={8}
              />
              <button
                className="password-toggle"
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((reveal) => !reveal)}
              >
                {showPassword ? (
                  <EyeOff className="icon" size={20} aria-hidden="true" />
                ) : (
                  <Eye className="icon" size={20} aria-hidden="true" />
                )}
              </button>
            </div>
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? busyLabel : actionLabel}
          </button>
        </form>
        {isRegister ? null : (
          <p className="auth-switch">
            <button className="text-button" type="button" onClick={onForgot}>
              Forgot password?
            </button>
          </p>
        )}
        <p className="auth-switch">
          {switchLabel}{" "}
          <button
            className="text-button"
            type="button"
            onClick={() => navigateTo(switchPath)}
          >
            {switchAction}
          </button>
        </p>
      </section>
    </div>
  );
}

function VerifyView({
  email,
  cooldownActive,
}: {
  email: string;
  cooldownActive: boolean;
}): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [remaining, setRemaining] = useState(
    cooldownActive ? RESEND_COOLDOWN_SECONDS : 0
  );

  useEffect(() => {
    if (remaining <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setRemaining((value) => value - 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [remaining > 0]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") || "");

    setError(null);
    setBusy(true);
    try {
      // The API sets the session cookie on verify (not on register), so this
      // auto-logs-in.
      await session.verifyEmail({ email, code });
      navigateTo("/");
    } catch (verifyError) {
      setError(
        verifyError instanceof Error ? verifyError.message : "Verification failed."
      );
    } finally {
      setBusy(false);
    }
  };

  const onResend = async (): Promise<void> => {
    setResending(true);
    try {
      await authApi.resendVerification(email);
      setError(null);
      setRemaining(RESEND_COOLDOWN_SECONDS);
    } catch (resendError) {
      setError(
        resendError instanceof Error
          ? resendError.message
          : "Could not resend the code."
      );
    } finally {
      setResending(false);
    }
  };

  const counting = remaining > 0;

  return (
    <div className="auth-screen">
      <img
        className="auth-art"
        src={loginArt}
        alt=""
        aria-hidden="true"
        decoding="async"
      />
      <section className="auth-panel" aria-labelledby="auth-title">
        <div>
          <h1 id="auth-title">Verify your email</h1>
          <p className="auth-hint">
            Enter the 6-digit code sent to <strong>{email}</strong>.
          </p>
          <p className="auth-hint">Not in your inbox? Check your spam folder.</p>
        </div>
        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            <span>Verification code</span>
            <input
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Verifying" : "Verify"}
          </button>
        </form>
        <p className="auth-switch">
          Didn&apos;t get it?{" "}
          <button
            className="text-button"
            type="button"
            disabled={counting || resending}
            onClick={onResend}
          >
            {counting ? `Resend code (${remaining}s)` : "Resend code"}
          </button>
        </p>
        <p className="auth-switch">
          Wrong address?{" "}
          <button
            className="text-button"
            type="button"
            onClick={() => navigateTo("/register")}
          >
            Change email
          </button>
        </p>
      </section>
    </div>
  );
}

// The request always advances to the reset view with the same neutral copy,
// success or failure — the API answers uniformly, so the UI must too.
function ForgotView({
  onSent,
}: {
  onSent: (email: string) => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") || "");

    setBusy(true);
    try {
      await authApi.forgotPassword(email);
    } catch {
      // Deliberately swallowed: revealing the failure would leak account state.
    } finally {
      setBusy(false);
      onSent(email);
    }
  };

  return (
    <div className="auth-screen">
      <img
        className="auth-art"
        src={loginArt}
        alt=""
        aria-hidden="true"
        decoding="async"
      />
      <section className="auth-panel" aria-labelledby="auth-title">
        <div>
          <h1 id="auth-title">Forgot password</h1>
          <p className="auth-hint">
            Enter your email and we&apos;ll send a reset code.
          </p>
        </div>
        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Sending" : "Send reset code"}
          </button>
        </form>
        <p className="auth-switch">
          Remembered it?{" "}
          <button
            className="text-button"
            type="button"
            onClick={() => navigateTo("/login")}
          >
            Login
          </button>
        </p>
      </section>
    </div>
  );
}

function ResetView({
  email,
  onDone,
}: {
  email: string;
  onDone: () => void;
}): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const code = String(formData.get("code") || "");
    const newPassword = String(formData.get("newPassword") || "");

    setError(null);
    setBusy(true);
    try {
      await authApi.resetPassword({ email, code, newPassword });
      setDone(true);
    } catch (resetError) {
      setError(
        resetError instanceof Error ? resetError.message : "Password reset failed."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <img
        className="auth-art"
        src={loginArt}
        alt=""
        aria-hidden="true"
        decoding="async"
      />
      <section className="auth-panel" aria-labelledby="auth-title">
        <div>
          <h1 id="auth-title">Reset password</h1>
          <p className="auth-hint">
            If this account is registered, a reset code is on its way to your
            email.
          </p>
          <p className="auth-hint">Not in your inbox? Check your spam folder.</p>
        </div>
        {done ? (
          <>
            <p className="auth-hint">
              Password updated. Log in with your new password.
            </p>
            <button className="primary-button" type="button" onClick={onDone}>
              Back to login
            </button>
          </>
        ) : (
          <>
            <form className="auth-form" onSubmit={onSubmit}>
              <label>
                <span>Reset code</span>
                <input
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                />
              </label>
              <label>
                <span>New password</span>
                <div className="password-field">
                  <input
                    name="newPassword"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={8}
                  />
                  <button
                    className="password-toggle"
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((reveal) => !reveal)}
                  >
                    {showPassword ? (
                      <EyeOff className="icon" size={20} aria-hidden="true" />
                    ) : (
                      <Eye className="icon" size={20} aria-hidden="true" />
                    )}
                  </button>
                </div>
              </label>
              {error ? <p className="form-error">{error}</p> : null}
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? "Resetting" : "Reset password"}
              </button>
            </form>
            <p className="auth-switch">
              Wrong address?{" "}
              <button className="text-button" type="button" onClick={onDone}>
                Back to login
              </button>
            </p>
          </>
        )}
      </section>
    </div>
  );
}
