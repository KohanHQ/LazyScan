import { navigateTo } from "@/router";
import type { KeyboardEvent } from "react";

// Click + Enter/Space navigation props for card-style elements.
export function clickable(path: string): {
  tabIndex: number;
  role: "button";
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
} {
  const activate = (): void => navigateTo(path);
  return {
    tabIndex: 0,
    role: "button",
    onClick: activate,
    onKeyDown: (event) => {
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        if (event.key !== "Enter") {
          event.preventDefault();
        }
        activate();
      }
    },
  };
}
