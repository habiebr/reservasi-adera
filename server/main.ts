import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import { publicRoutes } from "./routes/public.ts";
import { bookingRoutes } from "./routes/booking.ts";
import { webhookRoutes } from "./routes/webhook.ts";
import { adminRoutes } from "./routes/admin.ts";

const app = new Hono();

/**
 * Who may put this app inside an iframe. The wizard asks for a NIK, so leaving that open to
 * any site invites a clickjacked page collecting identities under someone else's branding.
 *
 * `EMBED_ORIGINS` is a comma-separated allow-list (the app's own origin is always allowed).
 * Left unset, no header goes out and framing stays open — an existing deploy that quietly
 * relied on it keeps working instead of breaking on upgrade.
 */
const embedOrigins = (Deno.env.get("EMBED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const frameAncestors = embedOrigins.length > 0
  ? `frame-ancestors 'self' ${embedOrigins.join(" ")}`
  : null;

if (frameAncestors) {
  app.use("*", async (c, next) => {
    await next();
    // Only pages can be framed; skipping the API keeps the header off JSON responses.
    if ((c.res.headers.get("content-type") ?? "").includes("text/html")) {
      c.res.headers.set("Content-Security-Policy", frameAncestors);
    }
  });
  console.log(`embed allowed from: ${embedOrigins.join(", ")}`);
}

/**
 * Cache rules for the SPA. index.html went out with no Cache-Control, no ETag and no
 * Last-Modified at all, which leaves browsers free to hold on to it — and a stale shell
 * points at a stale hashed bundle, so a deployed fix can keep not existing for whoever
 * already had the page. The shell must therefore be revalidated every time.
 *
 * Its assets are the opposite: Vite stamps a content hash into every filename, so a given
 * URL can never change meaning and may be kept for a year.
 */
app.use("*", async (c, next) => {
  await next();
  if (c.req.path.startsWith("/assets/")) {
    c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else if ((c.res.headers.get("content-type") ?? "").includes("text/html")) {
    c.res.headers.set("Cache-Control", "no-cache");
  }
});

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api", publicRoutes);
app.route("/api/booking", bookingRoutes);
app.route("/api/webhooks", webhookRoutes);
app.route("/api/admin", adminRoutes);

// Built SPA (web/dist): serve real files (assets, logo, favicon, …) when they exist —
// serveStatic calls next() on a miss — then fall back to index.html for SPA routes.
app.use("*", serveStatic({ root: "./web/dist" }));
app.get("*", serveStatic({ root: "./web/dist", path: "index.html" }));

const port = Number(Deno.env.get("PORT") ?? 8300);
Deno.serve({ port }, app.fetch);
console.log(`reservasi-adera listening on :${port}`);
