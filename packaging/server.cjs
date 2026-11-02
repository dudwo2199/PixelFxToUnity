const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFile } = require("node:child_process");

const HOST = "127.0.0.1";
const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const PORT_FILE = path.join(ROOT, ".server-port");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${HOST}`);
  if (url.pathname === "/__health") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("PixelFx server ready");
    return;
  }
  if (url.pathname === "/__shutdown" && request.method === "POST") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("Stopping PixelFx server");
    setTimeout(() => server.close(() => process.exit(0)), 100);
    return;
  }

  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { response.writeHead(400); response.end("Bad request"); return; }
  if (pathname === "/") pathname = "/index.html";
  const file = path.resolve(DIST, `.${pathname}`);
  const relative = path.relative(DIST, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    response.writeHead(403); response.end("Forbidden"); return;
  }
  let target = file;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    if (!path.extname(pathname)) target = path.join(DIST, "index.html");
    else { response.writeHead(404); response.end("Not found"); return; }
  }
  const type = MIME[path.extname(target).toLowerCase()] || "application/octet-stream";
  response.writeHead(200, {
    "content-type": type,
    "content-length": fs.statSync(target).size,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  fs.createReadStream(target).pipe(response);
});

server.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

server.listen(0, HOST, () => {
  const port = server.address().port;
  const url = `http://${HOST}:${port}/`;
  fs.writeFileSync(PORT_FILE, String(port), "utf8");
  if (process.env.PIXELFX_NO_OPEN !== "1") {
    execFile("rundll32.exe", ["url.dll,FileProtocolHandler", url], { windowsHide: true }, () => {});
  }
});

process.on("exit", () => {
  try { fs.unlinkSync(PORT_FILE); } catch {}
});
