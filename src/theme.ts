export type Theme = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "family-calendar-theme";

export function readTheme(): Theme {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch { /* Appearance remains available when storage is blocked. */ }
  return "system";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function saveTheme(theme: Theme) {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}
