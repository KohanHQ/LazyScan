import * as authApi from "@/api/auth";
import { ApiClientError } from "@/api/client";
import { icons } from "@/components/icons";
import { navigateTo } from "@/router";
import * as session from "@/state/session";
import { getTheme, toggleTheme } from "@/state/theme";
import { clearFormError, setFormError, setSubmitBusy } from "@/utils/form";
import loginArt from "../../assets/login.png";

type AuthMode = "login" | "register";

const RESEND_COOLDOWN_SECONDS = 60;

export function renderLoginPage(container: HTMLElement, mode: AuthMode): void {
  const isRegister = mode === "register";
  const title = isRegister ? "Create account" : "Login";
  const actionLabel = isRegister ? "Register" : "Login";
  const switchPath = isRegister ? "/login" : "/register";
  const switchLabel = isRegister
    ? "Already have an account?"
    : "Need an account?";
  const switchAction = isRegister ? "Login" : "Register";

  container.innerHTML = `
    <div class="auth-screen">
      <button class="auth-theme-toggle" type="button" data-action="toggle-theme" aria-label="Toggle theme">${getTheme() === "dark" ? icons.sun() : icons.moon()}</button>
      <img class="auth-art" src="${loginArt}" alt="" aria-hidden="true" />
      <section class="auth-panel" aria-labelledby="auth-title">
        <div>
          <h1 id="auth-title">${title}</h1>
        </div>
        <form class="auth-form">
          <label>
            <span>Email</span>
            <input name="email" type="email" autocomplete="email" required />
          </label>
          <label>
            <span>Password</span>
            <div class="password-field">
              <input name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" required minlength="8" />
              <button class="password-toggle" type="button" data-action="toggle-password" aria-label="Show password" aria-pressed="false">${icons.eye()}</button>
            </div>
          </label>
          <p class="form-error" hidden></p>
          <button class="primary-button" type="submit">${actionLabel}</button>
        </form>
        <p class="auth-switch">
          ${switchLabel}
          <button class="text-button" type="button" data-route="${switchPath}">${switchAction}</button>
        </p>
      </section>
    </div>
  `;

  container
    .querySelector<HTMLButtonElement>("[data-route]")
    ?.addEventListener("click", () => {
      navigateTo(switchPath);
    });

  const themeToggle = container.querySelector<HTMLButtonElement>(
    "[data-action='toggle-theme']",
  );
  themeToggle?.addEventListener("click", () => {
    const next = toggleTheme();
    themeToggle.innerHTML = next === "dark" ? icons.sun() : icons.moon();
  });

  const passwordInput = container.querySelector<HTMLInputElement>(
    "input[name='password']",
  );
  const passwordToggle = container.querySelector<HTMLButtonElement>(
    "[data-action='toggle-password']",
  );
  passwordToggle?.addEventListener("click", () => {
    if (!passwordInput) {
      return;
    }
    const reveal = passwordInput.type === "password";
    passwordInput.type = reveal ? "text" : "password";
    passwordToggle.innerHTML = reveal ? icons.eyeOff() : icons.eye();
    passwordToggle.setAttribute(
      "aria-label",
      reveal ? "Hide password" : "Show password",
    );
    passwordToggle.setAttribute("aria-pressed", String(reveal));
  });

  container
    .querySelector<HTMLFormElement>(".auth-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();

      const form = event.currentTarget as HTMLFormElement;
      const formData = new FormData(form);
      const email = String(formData.get("email") || "");
      const password = String(formData.get("password") || "");

      clearFormError(form);
      setSubmitBusy(form, true, isRegister ? "Registering" : "Logging in");

      try {
        if (isRegister) {
          // Hard verify: register sets no session. The code was just
          // emailed, so the resend cooldown is already running server-side.
          await session.register({ email, password });
          renderVerifyView(container, email, true);
          return;
        }
        await session.login({ email, password });
        navigateTo("/");
      } catch (authError) {
        if (
          authError instanceof ApiClientError &&
          authError.code === "EMAIL_NOT_VERIFIED"
        ) {
          // Unverified account at login: no fresh code was sent, so resend
          // is available immediately.
          renderVerifyView(container, email, false);
          return;
        }
        setFormError(
          form,
          authError instanceof Error
            ? authError.message
            : "Authentication failed.",
        );
      } finally {
        setSubmitBusy(form, false, actionLabel, actionLabel);
      }
    });
}

// Third auth view (not a route): entered after register, or after login
// rejects with EMAIL_NOT_VERIFIED. Verify success auto-logs-in (the API
// sets the session cookie on verify, not on register).
function renderVerifyView(
  container: HTMLElement,
  email: string,
  cooldownActive: boolean,
): void {
  container.innerHTML = `
    <div class="auth-screen">
      <button class="auth-theme-toggle" type="button" data-action="toggle-theme" aria-label="Toggle theme">${getTheme() === "dark" ? icons.sun() : icons.moon()}</button>
      <img class="auth-art" src="${loginArt}" alt="" aria-hidden="true" />
      <section class="auth-panel" aria-labelledby="auth-title">
        <div>
          <h1 id="auth-title">Verify your email</h1>
          <p class="auth-hint">Enter the 6-digit code sent to <strong></strong>.</p>
        </div>
        <form class="auth-form">
          <label>
            <span>Verification code</span>
            <input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" required />
          </label>
          <p class="form-error" hidden></p>
          <button class="primary-button" type="submit">Verify</button>
        </form>
        <p class="auth-switch">
          Didn't get it?
          <button class="text-button" type="button" data-action="resend">Resend code</button>
        </p>
        <p class="auth-switch">
          Wrong address?
          <button class="text-button" type="button" data-action="change-email">Change email</button>
        </p>
      </section>
    </div>
  `;

  // Interpolating the email into innerHTML would be an injection vector;
  // textContent is inert.
  const emailSlot = container.querySelector<HTMLElement>(".auth-hint strong");
  if (emailSlot) {
    emailSlot.textContent = email;
  }

  const themeToggle = container.querySelector<HTMLButtonElement>(
    "[data-action='toggle-theme']",
  );
  themeToggle?.addEventListener("click", () => {
    const next = toggleTheme();
    themeToggle.innerHTML = next === "dark" ? icons.sun() : icons.moon();
  });

  container
    .querySelector<HTMLButtonElement>("[data-action='change-email']")
    ?.addEventListener("click", () => {
      navigateTo("/register");
    });

  const form = container.querySelector<HTMLFormElement>(".auth-form");
  const resendButton = container.querySelector<HTMLButtonElement>(
    "[data-action='resend']",
  );

  if (resendButton && cooldownActive) {
    startResendCooldown(resendButton);
  }

  resendButton?.addEventListener("click", async () => {
    resendButton.disabled = true;
    try {
      await authApi.resendVerification(email);
      if (form) {
        clearFormError(form);
      }
      startResendCooldown(resendButton);
    } catch (resendError) {
      resendButton.disabled = false;
      if (form) {
        setFormError(
          form,
          resendError instanceof Error
            ? resendError.message
            : "Could not resend the code.",
        );
      }
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const code = String(formData.get("code") || "");

    clearFormError(form);
    setSubmitBusy(form, true, "Verifying");

    try {
      await session.verifyEmail({ email, code });
      navigateTo("/");
    } catch (verifyError) {
      setFormError(
        form,
        verifyError instanceof Error
          ? verifyError.message
          : "Verification failed.",
      );
    } finally {
      setSubmitBusy(form, false, "Verify", "Verify");
    }
  });
}

// Ticks the resend button down once per second; self-clears if the view is
// re-rendered out from under it (innerHTML swap disconnects the button).
function startResendCooldown(button: HTMLButtonElement): void {
  let remaining = RESEND_COOLDOWN_SECONDS;
  button.disabled = true;
  button.textContent = `Resend code (${remaining}s)`;

  const timer = window.setInterval(() => {
    remaining -= 1;
    if (!button.isConnected || remaining <= 0) {
      window.clearInterval(timer);
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = "Resend code";
      }
      return;
    }
    button.textContent = `Resend code (${remaining}s)`;
  }, 1000);
}
