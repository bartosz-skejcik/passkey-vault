// Plan 09-06: the @wxt-dev/module-react popup entrypoint, mounting App
// into index.html's #root. Replaces Phase 8's vanilla debug harness
// (08-03-PLAN.md) entirely -- see index.html's own header comment.
import "./style.css";
import { createRoot } from "react-dom/client";
import App from "./App";

const rootEl = document.getElementById("root");
if (rootEl !== null) {
  createRoot(rootEl).render(<App />);
}
