import {
  useLayoutEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";

// Shared multiline composer input: the border/focus chrome lives on the shell
// so the counter sits inside it, and the textarea auto-grows instead of
// scrolling. Controlled; `name` keeps FormData-based submits working.
export function ComposerTextarea({
  value,
  onChange,
  maxLength,
  placeholder,
  ariaLabel,
  disabled,
  rows = 3,
  id,
  name,
  hint,
  action,
}: {
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  rows?: number;
  id?: string;
  name?: string;
  hint?: string;
  action?: ReactNode;
}): ReactElement {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keyed on value so programmatic resets shrink back too (a cleared draft
  // after submit); "auto" first so the height can go down, not only up.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input === null) {
      return;
    }
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [value]);

  const nearLimit = value.length >= maxLength * 0.9;

  return (
    <div className="composer-shell">
      <textarea
        ref={inputRef}
        id={id}
        name={name}
        className="composer-input"
        aria-label={ariaLabel}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="composer-footer">
        {hint !== undefined ? <span className="composer-hint">{hint}</span> : null}
        <span className={nearLimit ? "composer-count is-warn" : "composer-count"}>
          {value.length} / {maxLength}
        </span>
        {action ?? null}
      </div>
    </div>
  );
}
