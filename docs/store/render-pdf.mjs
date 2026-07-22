// Renders publishing-guide.html -> PASSKEY-VAULT-PUBLISHING.pdf
// Run from extension/ (playwright dep): node ../docs/store/render-pdf.mjs
import { createRequire } from "node:module";
// resolve playwright from extension/'s node_modules regardless of cwd
const require = createRequire(new URL("../../extension/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
import * as path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("file://" + path.join(HERE, "publishing-guide.html"), { waitUntil: "networkidle" });
await page.pdf({
  path: path.join(HERE, "PASSKEY-VAULT-PUBLISHING.pdf"),
  format: "A4",
  printBackground: true,
  margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
});
console.log("wrote PASSKEY-VAULT-PUBLISHING.pdf");
await browser.close();
