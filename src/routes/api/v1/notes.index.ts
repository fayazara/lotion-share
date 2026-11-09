import { createFileRoute } from "@tanstack/react-router"
import { desc } from "drizzle-orm"
import { db, schema } from "@/db"
import { authorized, json } from "@/lib/api"

/** GET /api/v1/notes — every published note, newest change first. */
export const Route = createFileRoute("/api/v1/notes/")({
  server: {
    handlers: {
      GET: ({ request }) =>
        authorized(request, async () => {
          const origin = new URL(request.url).origin
          const rows = await db
            .select({ id: schema.notes.id, title: schema.notes.title, updatedAt: schema.notes.updatedAt })
            .from(schema.notes)
            .orderBy(desc(schema.notes.updatedAt))
          return json({
            notes: rows.map((row) => ({ ...row, url: `${origin}/n/${row.id}` })),
          })
        }),
    },
  },
})
