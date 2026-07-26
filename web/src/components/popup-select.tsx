import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";

type Option = { value: string; label: string };

// Themed replacement for a native <select>: the closed control is a button and
// the open list is the catalog filter popup (native option lists can't be
// styled). Trigger reuses the caller's select className; the wrapper is
// position-relative so the popup anchors to it.
export function PopupSelect({
  id,
  name,
  value,
  options,
  onChange,
  className,
  ariaLabel,
}: {
  id?: string;
  name?: string;
  value: string;
  options: Option[];
  onChange?: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Popup idiom mirrors settings.tsx: close on click-outside or Escape.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocClick = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (
        !popRef.current?.contains(target) &&
        !btnRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    const active = popRef.current?.querySelector<HTMLButtonElement>(
      ".is-active",
    );
    (active ?? popRef.current?.querySelector("button"))?.focus();
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((option) => option.value === value);

  const choose = (next: string): void => {
    setOpen(false);
    btnRef.current?.focus();
    if (next !== value) {
      onChange?.(next);
    }
  };

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const items = popRef.current
      ? Array.from(popRef.current.querySelectorAll("button"))
      : [];
    if (items.length === 0) {
      return;
    }
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  };

  return (
    <div className="popup-select">
      <button
        ref={btnRef}
        id={id}
        className={`popup-select-trigger${className ? ` ${className}` : ""}`}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{current?.label ?? ""}</span>
      </button>
      <div
        ref={popRef}
        className={`library-filter-pop${open ? " is-open" : ""}`}
        role="menu"
        onKeyDown={onMenuKey}
      >
        {options.map((option) => (
          <button
            key={option.value}
            className={`library-filter-option${
              option.value === value ? " is-active" : ""
            }`}
            type="button"
            role="menuitemradio"
            aria-checked={option.value === value}
            onClick={() => choose(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {/* Hidden input carries value into FormData for uncontrolled forms. */}
      {name ? <input type="hidden" name={name} value={value} /> : null}
    </div>
  );
}
