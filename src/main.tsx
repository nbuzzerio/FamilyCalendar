import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';
import { applyTheme, readTheme } from './theme';

import { initialize } from "./sync/database";
import { start } from "./sync/engine";
import { downloadJSON, rawBackup } from "./backup";

applyTheme(readTheme());

const root = createRoot(document.getElementById('root')!);
async function openCalendar() {
  try {
    await initialize();
    root.render(<StrictMode><App /></StrictMode>);
    start();
  } catch (error) {
    root.render(<main><h1>Family Calendar</h1><p role="alert">Calendar storage could not open. {String(error)}</p>
      <button onClick={() => { try { downloadJSON(JSON.stringify(rawBackup(localStorage), null, 2)); } catch (e) { window.alert(String(e)); } }}>Export original browser data</button>
      <button onClick={() => location.reload()}>Retry</button></main>);
  }
}
void openCalendar();
window.addEventListener("storage", e => {
  if (e.key === null || e.key.startsWith("family-calendar.")) void initialize().catch(e => window.alert(String(e)));
});
