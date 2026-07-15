#!/usr/bin/env node
// extension/e2e-fixtures/adversarial-iframe/serve.mjs
//
// Minimal, dependency-free two-origin static server for the SC #5
// adversarial-iframe fixture (10-07-PLAN.md). Launch it TWICE, once per
// origin, so the cross-origin boundary the fixture exercises is a REAL
// browser origin boundary (scheme+host+port) -- same-origin serving would
// not exercise the boundary at all:
//
//   node serve.mjs 8791 A   # Origin A -- http://127.0.0.1:8791
//   node serve.mjs 8792 B   # Origin B -- http://localhost:8792
//
// Using `127.0.0.1` for one origin and `localhost` for the other gives two
// genuinely distinct hostnames (a clearer signal than "same host, two
// ports" alone), while both are safely loopback-only.
//
// Serves this directory's static files as-is; unknown paths 404. No
// external dependencies -- only Node's built-in `http`/`fs`/`path`.
//
// Deliberately does NOT set `X-Frame-Options` and does NOT send a
// `frame-ancestors` CSP directive -- the whole point of this fixture is
// that `top.html` (Origin A) embeds a genuinely cross-origin `<iframe>`
// (Origin B's attacker-frame.html); blocking the embed would defeat the
// fixture's purpose. This server is a local-only test harness, never
// intended to face the network.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.argv[2]) || 8791;
const LABEL = process.argv[3] || "?";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const urlPath = new URL(req.url ?? "/", "http://internal").pathname;
  // Strip any ".." path-traversal segments before joining against DIR --
  // this server only ever needs to serve files inside its own directory.
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(DIR, safePath === "/" ? "/top.html" : safePath);

  try {
    const body = await readFile(filePath);
    res.setHeader("Content-Type", MIME[extname(filePath)] ?? "application/octet-stream");
    res.writeHead(200);
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Not found: ${safePath}`);
  }
});

server.listen(PORT, () => {
  console.log(
    `[adversarial-iframe] Origin ${LABEL} serving ${DIR} at http://localhost:${PORT} and http://127.0.0.1:${PORT}`,
  );
  console.log(`[adversarial-iframe] Origin ${LABEL} -- top page: http://localhost:${PORT}/top.html`);
});
