import { navigateTo } from "@/router";

// Shared "Login required" block for auth-gated pages. The message varies per page;
// the markup and login wiring are identical everywhere it is used.
export function renderLoginRequired(
  container: HTMLElement,
  message = "Log in to continue."
): void {
  container.innerHTML = `
    <section class="state-block state-block-strong">
      <h2>Login required</h2>
      <p>${message}</p>
      <button class="primary-button" type="button" data-route="/login">Login</button>
    </section>
  `;
  container
    .querySelector<HTMLElement>("[data-route]")
    ?.addEventListener("click", () => navigateTo("/login"));
}
