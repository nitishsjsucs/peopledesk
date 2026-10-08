// Theme preference: "system" follows prefers-color-scheme; "light" and "dark" set data-theme on <html>.
// Stored in localStorage as a per-viewer convenience; storage can be unavailable, so every access is guarded.
export type ThemeChoice = "system" | "light" | "dark";
const KEY = "peopledesk-theme";

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // storage unavailable: the choice lasts for this page view only
  }
}

export function nextTheme(choice: ThemeChoice): ThemeChoice {
  return choice === "system" ? "dark" : choice === "dark" ? "light" : "system";
}
