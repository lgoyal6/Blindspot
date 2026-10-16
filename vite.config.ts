import { existsSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Connect, type Plugin } from "vite";

/**
 * Entry ownership (docs/CONTRACTS.md):
 *   ui mode     -> ui.html     (Person A fixture preview)
 *   public mode -> public-demo.html (read-only saved replay)
 *   engine mode -> engine.html (Person B engine harness)
 *   default     -> index.html  (Person C composed app)
 * Each mode builds only its own entry so missing future entries never break
 * another owner's independent preview.
 */
const ENTRY_BY_MODE: Record<string, string> = {
  ui: "ui.html",
  public: "public-demo.html",
  engine: "engine.html",
};

function entryForMode(mode: string): string {
  return ENTRY_BY_MODE[mode] ?? "index.html";
}

/** SPA fallback so /control/:id and /reports/:id deep links reach the mode's entry HTML. */
function spaFallback(entry: string): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const url = req.url ?? "/";
    const isNavigation = req.headers.accept?.includes("text/html") ?? false;
    const isFile = /\.[a-z0-9]+(?:\?.*)?$/i.test(url);
    if (isNavigation && !isFile && !url.startsWith("/@") && !url.startsWith("/api/")) {
      req.url = `/${entry}`;
    }
    next();
  };
  return {
    name: "blindspot-spa-fallback",
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

export default defineConfig(({ mode }) => {
  const entry = entryForMode(mode);
  const entryPath = resolve(import.meta.dirname, entry);
  if (!existsSync(entryPath)) {
    throw new Error(
      `Entry ${entry} does not exist yet. Use the mode that matches an existing entry ` +
        `(ui -> ui.html, engine -> engine.html, default -> index.html).`,
    );
  }
  return {
    plugins: [react(), spaFallback(entry)],
    build: {
      rollupOptions: { input: entryPath },
    },
  };
});
