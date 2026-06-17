// Small form helpers shared by the form pages — not a form abstraction. They
// operate on a `.form-error` element and the submit button inside a <form>.

export function setFormError(form: HTMLElement, message: string): void {
  const error = form.querySelector<HTMLElement>(".form-error");
  if (error) {
    error.hidden = false;
    error.textContent = message;
  }
}

export function clearFormError(form: HTMLElement): void {
  const error = form.querySelector<HTMLElement>(".form-error");
  if (error) {
    error.hidden = true;
    error.textContent = "";
  }
}

// Toggle the submit button's busy state. When busy, the button is disabled and
// shows `busyLabel`; when not, it is re-enabled and restored to `idleLabel`.
export function setSubmitBusy(
  form: HTMLElement,
  busy: boolean,
  busyLabel: string,
  idleLabel?: string
): void {
  const submit = form.querySelector<HTMLButtonElement>("button[type='submit']");
  if (!submit) {
    return;
  }
  submit.disabled = busy;
  submit.textContent = busy ? busyLabel : idleLabel ?? submit.textContent ?? "";
}
