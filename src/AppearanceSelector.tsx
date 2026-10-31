import { useState } from "react";
import { applyTheme, readTheme, saveTheme, type Theme } from "./theme";

export function AppearanceSelector() {
  const [theme, setTheme] = useState(readTheme);
  const [error, setError] = useState("");
  return <div className="appearance-selector">
    <label>Appearance
      <select value={theme} onChange={event => {
        const next = event.target.value as Theme;
        setTheme(next);
        applyTheme(next);
        try {
          saveTheme(next);
          setError("");
        } catch {
          setError("Appearance changed, but could not be saved. It may reset on reload.");
        }
      }}>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </label>
    {error && <p role="alert">{error}</p>}
  </div>;
}
