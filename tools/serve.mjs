#!/usr/bin/env node
// Tiny static file server for the browser clients (no build step): node tools/serve.mjs [port]
// The page origin (http://localhost:8080 by default) must be in the matchmaker's allowed_cors_origins.

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.argv[2] ?? process.env.WEB_PORT ?? 8080);
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

http
  .createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
    // Only the browser-facing parts of the repo are served.
    if (path && !/^(index\.html|client[/\\]|games[/\\][a-z]+([/\\](index\.html|client\.js)?)?$)/.test(path)) {
      res.writeHead(404).end("not found");
      return;
    }
    let file = join(root, path);
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  })
  .listen(port, () => console.log(`Games at http://localhost:${port}/`));
