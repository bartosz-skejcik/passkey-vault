// Composes raw screenshots into 1280x800 store-listing frames (CWS/AMO).
// Run from extension/ (playwright dep lives there):
//   node ../docs/store/compose-frames.mjs
import { createRequire } from "node:module";
// resolve playwright from extension/'s node_modules regardless of cwd
const require = createRequire(new URL("../../extension/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
import * as fs from "node:fs";
import * as path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const RAW = path.join(HERE, "screenshots/raw");
const OUT = path.join(HERE, "screenshots/final");
fs.mkdirSync(OUT, { recursive: true });

// [rawFile, outFile, headline, sub, mode]
// mode "popup"  -> narrow shot centered on the right, text on the left
// mode "full"   -> page shot fills the frame under a slim caption bar
const FRAMES = [
  ["popup-list.png", "01-popup-vault.png",
    "Your vault, one click away",
    "Browse, search and fill logins, cards and live TOTP codes from the toolbar popup.",
    "popup"],
  ["inpage-github.png", "02-autofill.png",
    "Autofill on every site",
    "Click into a login field and pick an account — filled instantly, phishing-aware.",
    "full"],
  ["generator-signup.png", "03-generator.png",
    "Strong passwords, offered right on signup forms",
    "Characters or passphrases — generated locally, saved to your vault.",
    "full"],
  ["web-vault.png", "04-web-app.png",
    "A full web app on your own server",
    "One Docker container. Zero-knowledge encryption. Your data never leaves your control.",
    "full"],
  ["ceremony-signin.png", "05-signin.png",
    "Sign in your way",
    "Master password or a real passkey (PRF) — always through your own server.",
    "popup"],
];

function pageHtml(imgB64, headline, sub, mode) {
  const img = `data:image/png;base64,${imgB64}`;
  const shotStyle =
    mode === "popup"
      ? "height:640px;border-radius:14px;box-shadow:0 18px 50px rgba(15,60,55,.35);"
      : "width:1150px;border-radius:12px;box-shadow:0 18px 50px rgba(15,60,55,.35);";
  const layout =
    mode === "popup"
      ? `<div class="row">
           <div class="txt"><h1>${headline}</h1><p>${sub}</p><div class="brand">🔐 Passkey Vault</div></div>
           <img src="${img}" style="${shotStyle}">
         </div>`
      : `<div class="col">
           <div class="cap"><h1>${headline}</h1><p>${sub}</p></div>
           <img src="${img}" style="${shotStyle}">
         </div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;box-sizing:border-box}
    body{width:1280px;height:800px;overflow:hidden;
      font-family:-apple-system,'DM Sans',system-ui,sans-serif;
      background:radial-gradient(120% 140% at 15% 10%, #16857b 0%, #0f766e 45%, #0a5750 100%);
      display:flex;align-items:center;justify-content:center}
    .row{display:flex;align-items:center;gap:64px;padding:0 70px;width:100%}
    .txt{flex:1;color:#faf7f0}
    .txt h1{font-size:46px;line-height:1.15;letter-spacing:-.5px;margin-bottom:18px}
    .txt p{font-size:21px;line-height:1.5;opacity:.92}
    .brand{margin-top:34px;font-size:18px;opacity:.85}
    .col{display:flex;flex-direction:column;align-items:center;gap:26px;padding-top:8px}
    .cap{text-align:center;color:#faf7f0;max-width:1050px}
    .cap h1{font-size:36px;letter-spacing:-.4px;margin-bottom:8px}
    .cap p{font-size:19px;opacity:.92}
    img{display:block}
  </style></head><body>${layout}</body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
for (const [raw, out, headline, sub, mode] of FRAMES) {
  const rawPath = path.join(RAW, raw);
  if (!fs.existsSync(rawPath)) { console.warn("skip (missing raw):", raw); continue; }
  const b64 = fs.readFileSync(rawPath).toString("base64");
  await page.setContent(pageHtml(b64, headline, sub, mode), { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(OUT, out) });
  console.log("wrote", out);
}
await browser.close();
