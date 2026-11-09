import { createFileRoute } from "@tanstack/react-router"
import { eq } from "drizzle-orm"
import { env } from "cloudflare:workers"
import { db, schema } from "@/db"
import { FILE_NAME, NOTE_ID, authorized, error, fileKey, json } from "@/lib/api"

/**
 * PUT /api/v1/notes/:id/files/:name — one of a published note's files, as the
 * raw body. Only files the note lists are accepted, so nothing is orphaned.
 */
export const Route = createFileRoute("/api/v1/notes/$id/files/$name")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        authorized(request, async () => {
          if (!NOTE_ID.test(params.id) || !FILE_NAME.test(params.name)) return error(400, "That isn't a file name.")
          const note = await db.query.notes.findFirst({
            where: eq(schema.notes.id, params.id),
            columns: { files: true },
          })
          if (!note) return error(404, "Publish the note before uploading its files.")
          if (!note.files.includes(params.name)) return error(409, "The note doesn't list that file.")
          if (!request.body) return error(400, "The body is empty.")

          const object = await env.FILES.put(fileKey(params.id, params.name), request.body, {
            httpMetadata: { contentType: request.headers.get("content-type") ?? "application/octet-stream" },
          })
          return json({ name: params.name, size: object.size }, 201)
        }),
    },
  },
})
