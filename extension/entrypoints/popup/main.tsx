// Plan 09-06: the @wxt-dev/module-react popup entrypoint, mounting App
// into index.html's #root. Replaces Phase 8's vanilla debug harness
// (08-03-PLAN.md) entirely -- see index.html's own header comment.
//
// D-12/plan 11-07: theme resolution happens HERE, before the first
// ReactDOM render -- index.html no longer hardcodes `data-theme` (see its
// own header comment). resolveTheme() is async (chrome.storage has no
// synchronous read API, unlike web's own localStorage-backed
// themeInitScript), so there is a brief unstyled flash on a cold popup
// open before the first paint -- an accepted trade-off for a MV3 popup,
// not present in the web app. watchMirroredTheme() keeps the stamped
// theme live afterward, without requiring a popup reopen.
import "./style.css";
import { createRoot } from "react-dom/client";
import App from "./App";
import { resolveTheme, watchMirroredTheme } from "../../lib/theme/theme-mirror";

const rootEl = document.getElementById("root");

async function bootstrap(): Promise<void> {
  const theme = await resolveTheme();
  document.body.setAttribute("data-theme", theme);

  watchMirroredTheme((nextTheme) => {
    document.body.setAttribute("data-theme", nextTheme);
  });

  if (rootEl !== null) {
    createRoot(rootEl).render(<App />);
  }
}

void bootstrap();
