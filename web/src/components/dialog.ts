import { escapeHtml } from "@/utils/dom";

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

// In-app modal dialogs replacing native window.confirm/alert. Each call mounts
// an overlay, traps focus on its buttons, and resolves on choice. ESC and a
// backdrop click cancel; Enter confirms.
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(options.title ?? "Confirm")}">
        ${options.title ? `<h2 class="dialog-title">${escapeHtml(options.title)}</h2>` : ""}
        <p class="dialog-message">${escapeHtml(options.message)}</p>
        <div class="dialog-actions">
          <button class="secondary-button" type="button" data-dialog="cancel">${escapeHtml(options.cancelLabel ?? "Cancel")}</button>
          <button class="${options.danger ? "danger-button" : "primary-button"}" type="button" data-dialog="confirm">${escapeHtml(options.confirmLabel ?? "Confirm")}</button>
        </div>
      </div>
    `;

    const settle = (result: boolean): void => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(result);
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        settle(false);
      } else if (event.key === "Enter") {
        settle(true);
      }
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        settle(false);
      }
    });
    overlay
      .querySelector<HTMLElement>("[data-dialog='cancel']")
      ?.addEventListener("click", () => settle(false));
    overlay
      .querySelector<HTMLElement>("[data-dialog='confirm']")
      ?.addEventListener("click", () => settle(true));

    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    overlay.querySelector<HTMLButtonElement>("[data-dialog='confirm']")?.focus();
  });
}

export function alertDialog(message: string, title?: string): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.innerHTML = `
      <div class="dialog" role="alertdialog" aria-modal="true" aria-label="${escapeHtml(title ?? "Notice")}">
        ${title ? `<h2 class="dialog-title">${escapeHtml(title)}</h2>` : ""}
        <p class="dialog-message">${escapeHtml(message)}</p>
        <div class="dialog-actions">
          <button class="primary-button" type="button" data-dialog="ok">OK</button>
        </div>
      </div>
    `;

    const settle = (): void => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve();
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" || event.key === "Enter") {
        settle();
      }
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        settle();
      }
    });
    overlay
      .querySelector<HTMLElement>("[data-dialog='ok']")
      ?.addEventListener("click", settle);

    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    overlay.querySelector<HTMLButtonElement>("[data-dialog='ok']")?.focus();
  });
}
