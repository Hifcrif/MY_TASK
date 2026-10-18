"use strict";
// Local test server (npm run dev): serves public/ and sends /api/... to the same handler Vercel uses.
// Not used on Vercel.
const http = require("http");
const fs = require("fs");
const path = require("path");
const handler = require("./lib/handler");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, "public");
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end("Bad request"); }
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(PUBLIC, "." + rel);
  if (rel.includes("\0") || !file.startsWith(PUBLIC + path.sep) || path.basename(file).startsWith(".")) { res.writeHead(404); return res.end("Not found"); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname.startsWith("/api/") || pathname === "/api") return handler(req, res);
  handler.securityHeaders(res);
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end("Method not allowed"); }
  serveStatic(req, res, pathname);
}).listen(PORT, () => console.log(`Local server on http://localhost:${PORT}`));
