import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import { publicRoutes } from "./routes/public.ts";
import { bookingRoutes } from "./routes/booking.ts";
import { webhookRoutes } from "./routes/webhook.ts";
import { adminRoutes } from "./routes/admin.ts";

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api", publicRoutes);
app.route("/api/booking", bookingRoutes);
app.route("/api/webhooks", webhookRoutes);
app.route("/api/admin", adminRoutes);

// Built SPA (web/dist). Anything that is not /api falls back to index.html.
app.use("/assets/*", serveStatic({ root: "./web/dist" }));
app.use("/favicon.ico", serveStatic({ root: "./web/dist" }));
app.get("*", serveStatic({ root: "./web/dist", path: "index.html" }));

const port = Number(Deno.env.get("PORT") ?? 8300);
Deno.serve({ port }, app.fetch);
console.log(`reservasi-adera listening on :${port}`);
