// Standalone Node 22 HTTP server & exported request handler
// for Taskmarket Live Market Visualizer (TSK-BRK611AN, MIT).
// Zero external dependencies. Server-side API fetching + TTL/SWR cache + gzip.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { getSnapshot, getCachedMeta, CACHE_TTL_MS } from "./src/snapshot.mjs";
import { renderHtml, VALID_VIEWS } from "./src/render-html.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");
const OG_DIR = path.join(PUBLIC_DIR, "og");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || "").replace(/\/+$/, "");
const WARM_MIN_INTERVAL_MS = 60_000;
let lastWarmAt = 0;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

const COMPRESSIBLE = new Set([".css", ".js", ".json", ".svg", ".txt", ".ttf", ".html"]);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
};

function resolveOrigin(req) {
  if (PUBLIC_ORIGIN) return PUBLIC_ORIGIN;
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`).split(",")[0].trim();
  return `${proto}://${host}`;
}

function sendBody(req, res, statusCode, contentType, bodyBuf, extraHeaders = {}, allowGzip = true) {
  const buf = Buffer.isBuffer(bodyBuf) ? bodyBuf : Buffer.from(String(bodyBuf), "utf8");
  const acceptEnc = String(req.headers["accept-encoding"] || "");
  const headers = {
    ...SECURITY_HEADERS,
    "Content-Type": contentType,
    Vary: "Accept-Encoding",
    ...extraHeaders,
  };

  if (allowGzip && buf.length >= 1024 && acceptEnc.includes("gzip")) {
    const gz = zlib.gzipSync(buf, { level: 6 });
    headers["Content-Encoding"] = "gzip";
    headers["Content-Length"] = String(gz.length);
    res.writeHead(statusCode, headers);
    if (req.method === "HEAD") return res.end();
    return res.end(gz);
  }

  headers["Content-Length"] = String(buf.length);
  res.writeHead(statusCode, headers);
  if (req.method === "HEAD") return res.end();
  return res.end(buf);
}

function serveStaticFile(req, res, filePath, cacheControl) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) {
    return sendBody(req, res, 403, "text/plain; charset=utf-8", "Forbidden", {}, false);
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return sendBody(req, res, 404, "text/plain; charset=utf-8", "Not found", {}, false);
  }
  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  const data = fs.readFileSync(resolved);
  return sendBody(req, res, 200, mime, data, { "Cache-Control": cacheControl }, COMPRESSIBLE.has(ext));
}

export async function handleRequest(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendBody(req, res, 405, "application/json; charset=utf-8", JSON.stringify({ error: "Method not allowed" }), {
        Allow: "GET, HEAD",
      });
    }

    const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = urlObj.pathname;

    // 1. Static assets under /assets/*
    if (pathname.startsWith("/assets/")) {
      const rel = decodeURIComponent(pathname.slice("/assets/".length));
      const isImmutable = rel.startsWith("fonts/") || rel.startsWith("brand/");
      const cc = isImmutable ? "public, max-age=31536000, immutable" : "public, max-age=300, stale-while-revalidate=600";
      return serveStaticFile(req, res, path.join(PUBLIC_DIR, rel), cc);
    }

    // 2. Per-view OG images under /og/:name.png (fallback to default.png)
    if (pathname.startsWith("/og/")) {
      const fileName = path.basename(decodeURIComponent(pathname.slice("/og/".length)));
      const candidate = path.join(OG_DIR, fileName);
      const target = fileName.endsWith(".png") && fs.existsSync(candidate) ? candidate : path.join(OG_DIR, "default.png");
      return serveStaticFile(req, res, target, "public, max-age=3600, stale-while-revalidate=86400");
    }

    // 3. Favicon convenience
    if (pathname === "/favicon.ico" || pathname === "/favicon.png") {
      return serveStaticFile(req, res, path.join(PUBLIC_DIR, "brand", "taskmarket-mark.png"), "public, max-age=86400");
    }

    // 4. Health check
    if (pathname === "/api/health") {
      const meta = getCachedMeta();
      const body = JSON.stringify({
        ok: true,
        service: "taskmarket-live-visualizer",
        cached: meta.cached,
        dataAsOf: meta.dataAsOf,
        cacheAgeSeconds: meta.ageMs != null ? Math.round(meta.ageMs / 1000) : null,
        cacheTtlSeconds: Math.round(CACHE_TTL_MS / 1000),
      });
      return sendBody(req, res, 200, "application/json; charset=utf-8", body, {
        "Cache-Control": "no-store",
        ...(meta.dataAsOf ? { "X-Data-As-Of": meta.dataAsOf } : {}),
      });
    }

    // 5. Scheduled / on-demand warm endpoint (throttled to >= 60s between forced upstream refreshes)
    if (pathname === "/api/warm") {
      const now = Date.now();
      const force = now - lastWarmAt >= WARM_MIN_INTERVAL_MS;
      if (force) lastWarmAt = now;
      const snap = await getSnapshot({ forceRefresh: force });
      const body = JSON.stringify({
        ok: true,
        refreshed: force,
        dataAsOf: snap.dataAsOf,
        fetchedMs: snap.fetchedMs,
        totalTasks: snap.scopes?.all?.totalTasks || 0,
        cacheTtlSeconds: snap.cacheTtlSeconds,
      });
      return sendBody(req, res, 200, "application/json; charset=utf-8", body, {
        "Cache-Control": "no-store",
        "X-Data-As-Of": snap.dataAsOf,
      });
    }

    // 6. Full verifiable JSON snapshot (same-origin)
    if (pathname === "/api/snapshot") {
      const snap = await getSnapshot();
      return sendBody(req, res, 200, "application/json; charset=utf-8", JSON.stringify(snap), {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        "X-Data-As-Of": snap.dataAsOf,
      });
    }

    // 7. SSR HTML views: / and /v/:view
    let view = "overview";
    if (pathname === "/" || pathname === "/index.html") {
      const qView = urlObj.searchParams.get("view");
      if (qView && VALID_VIEWS.includes(qView)) view = qView;
    } else if (pathname.startsWith("/v/")) {
      const slug = pathname.slice(3).replace(/\/+$/, "");
      if (!VALID_VIEWS.includes(slug)) {
        return sendBody(req, res, 404, "text/plain; charset=utf-8", "Unknown visualizer view");
      }
      view = slug;
    } else {
      return sendBody(req, res, 404, "text/plain; charset=utf-8", "Not found");
    }

    const snap = await getSnapshot();
    const hasViewOg = fs.existsSync(path.join(OG_DIR, `${view}.png`));
    const html = renderHtml(snap, {
      view,
      origin: resolveOrigin(req),
      hasViewOg,
    });

    return sendBody(req, res, 200, "text/html; charset=utf-8", html, {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      "X-Data-As-Of": snap.dataAsOf,
    });
  } catch (err) {
    console.error("[server] request error:", err);
    return sendBody(
      req,
      res,
      502,
      "application/json; charset=utf-8",
      JSON.stringify({ ok: false, error: "Upstream data temporarily unavailable" }),
      { "Cache-Control": "no-store" }
    );
  }
}

export function createAppServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res);
  });
}

const isDirectMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectMain) {
  const server = createAppServer();
  server.listen(PORT, HOST, () => {
    console.log(`[taskmarket-live-visualizer] listening on http://${HOST}:${PORT}`);
    // Pre-warm cache on boot and schedule periodic background refresh (< 1 hour)
    getSnapshot().catch((e) => console.error("[boot warm] failed:", e?.message || e));
    const timer = setInterval(() => {
      getSnapshot({ forceRefresh: true }).catch((e) => console.error("[scheduled warm] failed:", e?.message || e));
    }, Math.max(300_000, Math.min(1_800_000, CACHE_TTL_MS)));
    timer.unref();
  });
}
