import { createFileRoute } from "@tanstack/react-router"
import { eq } from "drizzle-orm"
import { env } from "cloudflare:workers"
import { z } from "zod"
import { db, schema } from "@/db"
import { FILE_NAME, NOTE_ID, authorized, error, fileKey, json, pruneFiles } from "@/lib/api"
import { bareLinks, fetchPreview } from "@/lib/render"
import type { LinkPreview } from "@/db/schema"

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const palette = z.object({
  background: hex,
  text: hex,
  secondary: hex,
  accent: hex,
  codeBackground: hex,
  inlineCode: hex,
  rule: hex,
})

const fileName = z.string().regex(FILE_NAME)

const noteBody = z.object({
  title: z.string().trim().min(1).max(300),
  markdown: z.string().max(2_000_000),
  /** Every file the note uses, uploaded or not. Others are deleted. */
  files: z.array(fileName).max(500).default([]),
  cover: z
    .object({
      /** One of `files`, or an https address. */
      source: z.union([fileName, z.string().url().startsWith("https://")]),
      position: z.number().min(0).max(1).default(0.5),
      credit: z.string().max(200).optional(),
      creditUrl: z.string().url().optional(),
    })
    .nullable()
    .default(null),
  /** One of `files`: the note's icon as an image. */
  icon: fileName.nullable().default(null),
  style: z
    .object({
      light: palette.optional(),
      dark: palette.optional(),
    })
    .default({}),
})

/** Previews for the note's link cards, reusing what was read last time. */
async function previews(markdown: string, previous: Record<string, LinkPreview>) {
  const links = bareLinks(markdown).slice(0, 30)
  const entries = await Promise.all(
    links.map(async (link) => [link, previous[link] ?? (await fetchPreview(link))] as const)
  )
  return Object.fromEntries(entries.filter((entry): entry is [string, LinkPreview] => entry[1] !== null))
}

/** Which of `names` aren't in R2 yet, for the app to upload. */
async function missingFiles(id: string, names: string[]) {
  const heads = await Promise.all(names.map((name) => env.FILES.head(fileKey(id, name))))
  return names.filter((_, index) => !heads[index])
}

/**
 * /api/v1/notes/:id
 *
 * - GET    the note as published
 * - PUT    publish it, or update it in place. Answers with its address and
 *          the files still to upload (PUT each to `./files/:name`).
 * - DELETE unpublish it and delete its files.
 */
export const Route = createFileRoute("/api/v1/notes/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        authorized(request, async () => {
          if (!NOTE_ID.test(params.id)) return error(400, "That isn't a note ID.")
          const note = await db.query.notes.findFirst({ where: eq(schema.notes.id, params.id) })
          if (!note) return error(404, "No note is published with that ID.")
          return json({ ...note, url: `${new URL(request.url).origin}/n/${note.id}` })
        }),

      PUT: ({ request, params }) =>
        authorized(request, async () => {
          if (!NOTE_ID.test(params.id)) return error(400, "That isn't a note ID.")
          let body: unknown
          try {
            body = await request.json()
          } catch {
            return error(400, "The body isn't JSON.")
          }
          const parsed = noteBody.safeParse(body)
          if (!parsed.success) return error(400, "Validation failed", { issues: parsed.error.issues })
          const input = parsed.data
          const files = [...new Set(input.files)]
          const inFiles = (name: string | null | undefined) => !name || name.startsWith("https://") || files.includes(name)
          if (!inFiles(input.cover?.source) || !inFiles(input.icon)) {
            return error(400, "The cover and icon must be among the note's files.")
          }

          const existing = await db.query.notes.findFirst({ where: eq(schema.notes.id, params.id) })
          const links = await previews(input.markdown, existing?.links ?? {})
          const values = {
            title: input.title,
            markdown: input.markdown,
            cover: input.cover?.source ?? null,
            coverPosition: input.cover?.position ?? 0.5,
            coverCredit: input.cover?.credit ?? null,
            coverCreditUrl: input.cover?.creditUrl ?? null,
            icon: input.icon,
            style: input.style,
            links,
            files,
            updatedAt: new Date(),
          }
          await db
            .insert(schema.notes)
            .values({ id: params.id, ...values })
            .onConflictDoUpdate({ target: schema.notes.id, set: values })

          await pruneFiles(params.id, new Set(files))
          return json(
            {
              id: params.id,
              url: `${new URL(request.url).origin}/n/${params.id}`,
              missing: await missingFiles(params.id, files),
            },
            existing ? 200 : 201
          )
        }),

      DELETE: ({ request, params }) =>
        authorized(request, async () => {
          if (!NOTE_ID.test(params.id)) return error(400, "That isn't a note ID.")
          await db.delete(schema.notes).where(eq(schema.notes.id, params.id))
          await pruneFiles(params.id)
          return new Response(null, { status: 204 })
        }),
    },
  },
})
