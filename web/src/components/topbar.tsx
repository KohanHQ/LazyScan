import { Moon, Sun } from "lucide-react";
import { useState, type ReactElement } from "react";
import { getTheme, toggleTheme, type ThemeMode } from "@/state/theme";

// Topbar holds only the theme toggle; the account avatar + login/logout live in
// the sidebar footer.
export function Topbar(): ReactElement {
  const [theme, setTheme] = useState<ThemeMode>(getTheme);
  return (
    <div className="topbar-actions">
      <button
        className="topbar-icon-button"
        type="button"
        aria-label="Toggle dark mode"
        onClick={() => setTheme(toggleTheme())}
      >
        {theme === "dark" ? (
          <Sun className="icon" size={20} />
        ) : (
          <Moon className="icon" size={20} />
        )}
      </button>
    </div>
  );
}
