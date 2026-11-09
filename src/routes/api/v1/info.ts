import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { API_VERSION, BUNDLED_MIGRATIONS, TEMPLATE_VERSION, authorized, json } from "@/lib/api"

/**
 * GET /api/v1/info — what Lotion's "Verify connection" calls. It needs the
 * token, so a 200 means the URL and the token are both right. It also says
 * which version is deployed, and whether the database is behind the code.
 */
export const Route = createFileRoute("/api/v1/info")({
  server: {
    handlers: {
      GET: ({ request }) =>
        authorized(request, async () => {
          let applied = 0
          let notes = 0
          try {
            const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first<{ n: number }>()
            applied = row?.n ?? 0
          } catch {
            // No migrations applied yet: the bookkeeping table doesn't exist.
          }
          try {
            const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM notes").first<{ n: number }>()
            notes = row?.n ?? 0
          } catch {}
          return json({
            app: "lotion-share",
            apiVersion: API_VERSION,
            version: TEMPLATE_VERSION,
            migrations: { applied, bundled: BUNDLED_MIGRATIONS, pending: Math.max(0, BUNDLED_MIGRATIONS - applied) },
            notes,
          })
        }),
    },
  },
})
