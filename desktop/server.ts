import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { readConfig, writeConfig, type DesktopConfig } from "./config";
import { askAboutView, AskViewError, streamAskAboutView } from "../src/server/askView";
import { fetchSentinelImage, fetchSentinelScenes, SentinelError } from "../src/server/sentinel";

type StartOptions = {
  /** Directory containing the built Vite frontend (the app's `dist/`). */
  frontendDir: string;
  /** Absolute path to the standalone settings page. */
  settingsHtmlPath: string;
  /** Absolute path to the JSON file holding user-supplied API keys. */
  configPath: string;
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

async function parseBody(req: IncomingMessage): Promise<any> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Mirrors the four API routes defined as Vite dev middleware in `vite.config.ts`,
 * plus two desktop-only routes for reading/writing the local key config. The
 * Sentinel and Ask AI handlers call the exact same `src/server/*` functions the
 * web app uses, with `env` sourced from the local config rather than `.env`.
 */
async function handleApi(
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
  opts: StartOptions,
): Promise<void> {
  const env = (): DesktopConfig => readConfig(opts.configPath);

  // ---- Desktop settings (read/write pasted keys) ----------------------------
  if (pathname === "/api/desktop/settings") {
    if (req.method === "GET") {
      sendJson(res, 200, readConfig(opts.configPath));
      return;
    }
    if (req.method === "POST") {
      const body = await parseBody(req);
      const saved = writeConfig(opts.configPath, body as DesktopConfig);
      sendJson(res, 200, { ok: true, config: saved });
      return;
    }
    sendJson(res, 405, { error: "Use GET or POST for settings." });
    return;
  }

  // ---- Sentinel image -------------------------------------------------------
  if (pathname === "/api/sentinel-image") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Use POST for Sentinel image requests." });
      return;
    }
    try {
      const image = await fetchSentinelImage(await parseBody(req), env());
      res.statusCode = 200;
      res.setHeader("content-type", image.contentType);
      res.end(Buffer.from(image.bytes));
    } catch (error) {
      const status = error instanceof SentinelError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Sentinel request failed.";
      sendJson(res, status, { error: message });
    }
    return;
  }

  // ---- Sentinel scene search ------------------------------------------------
  if (pathname === "/api/sentinel-scenes") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Use POST for Sentinel scene searches." });
      return;
    }
    try {
      const scenes = await fetchSentinelScenes(await parseBody(req), env());
      sendJson(res, 200, { scenes });
    } catch (error) {
      const status = error instanceof SentinelError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Sentinel scene search failed.";
      sendJson(res, status, { error: message });
    }
    return;
  }

  // ---- Ask AI (streaming) ---------------------------------------------------
  if (pathname === "/api/ask-view-stream") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Use POST for Ask View stream requests." });
      return;
    }
    function writeSse(event: string, data: unknown) {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
    try {
      const body = await parseBody(req);
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream; charset=utf-8");
      res.setHeader("cache-control", "no-cache, no-transform");
      res.setHeader("connection", "keep-alive");
      await streamAskAboutView(body, env(), (event) => writeSse(event.type, event));
      res.end();
    } catch (error) {
      const status = error instanceof AskViewError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Ask View stream failed.";
      if (!res.headersSent) {
        sendJson(res, status, { error: message });
        return;
      }
      writeSse("error", { type: "error", error: message });
      res.end();
    }
    return;
  }

  // ---- Ask AI (non-streaming) -----------------------------------------------
  if (pathname === "/api/ask-view") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Use POST for Ask View requests." });
      return;
    }
    try {
      const result = await askAboutView(await parseBody(req), env());
      sendJson(res, 200, result);
    } catch (error) {
      const status = error instanceof AskViewError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Ask View request failed.";
      sendJson(res, status, { error: message });
    }
    return;
  }

  sendJson(res, 404, { error: "Unknown API route." });
}

async function serveStatic(pathname: string, res: ServerResponse, frontendDir: string): Promise<void> {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const root = path.normalize(frontendDir);
  const filePath = path.normalize(path.join(root, rel));

  // Guard against path traversal outside the frontend directory.
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isFile()) {
      const data = await readFile(filePath);
      res.statusCode = 200;
      res.setHeader(
        "content-type",
        CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
      );
      res.end(data);
      return;
    }
  } catch {
    // fall through to SPA fallback / 404
  }

  // SPA fallback: serve index.html for extensionless routes.
  if (!path.extname(rel)) {
    try {
      const index = await readFile(path.join(root, "index.html"));
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(index);
      return;
    } catch {
      // fall through
    }
  }

  res.statusCode = 404;
  res.end("Not found");
}

export function startServer(opts: StartOptions): Promise<number> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);

      if (pathname.startsWith("/api/")) {
        await handleApi(pathname, req, res, opts);
        return;
      }

      if (pathname === "/settings.html") {
        const html = await readFile(opts.settingsHtmlPath);
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(html);
        return;
      }

      await serveStatic(pathname, res, opts.frontendDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Server error";
      if (!res.headersSent) {
        sendJson(res, 500, { error: message });
      } else {
        res.end();
      }
    }
  });

  return new Promise((resolve) => {
    // Port 0 lets the OS assign a free ephemeral port, avoiding conflicts.
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(port);
    });
  });
}
