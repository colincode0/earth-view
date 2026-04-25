import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { fetchSentinelImage, SentinelError } from "./src/server/sentinel";

const dirname = path.dirname(fileURLToPath(import.meta.url));

type SentinelDevEnv = {
  COPERNICUS_CLIENT_ID?: string;
  COPERNICUS_CLIENT_SECRET?: string;
  SENTINELHUB_CLIENT_ID?: string;
  SENTINELHUB_CLIENT_SECRET?: string;
};

function sentinelDevApi(env: SentinelDevEnv): Plugin {
  return {
    name: "sentinel-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/sentinel-image", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "Use POST for Sentinel image requests." }));
          return;
        }

        try {
          const chunks: Uint8Array[] = [];

          for await (const chunk of req) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          }

          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const image = await fetchSentinelImage(body, env);

          res.statusCode = 200;
          res.setHeader("content-type", image.contentType);
          res.end(Buffer.from(image.bytes));
        } catch (error) {
          const status = error instanceof SentinelError ? error.status : 500;
          const message = error instanceof Error ? error.message : "Sentinel request failed.";

          res.statusCode = status;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, dirname, "");

  return {
    plugins: [react(), sentinelDevApi(env)],
    resolve: {
      alias: {
        "@": path.resolve(dirname, "./src"),
      },
    },
  };
});
