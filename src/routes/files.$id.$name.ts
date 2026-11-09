import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { FILE_NAME, NOTE_ID, fileKey } from "@/lib/api"

/**
 * GET /files/:id/:name — a published note's file, for anyone. Names are
 * content hashes, so a file never changes and can be cached for good.
 * Ranges are honored, so videos and audio can seek.
 */
export const Route = createFileRoute("/files/$id/$name")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!NOTE_ID.test(params.id) || !FILE_NAME.test(params.name)) {
          return new Response("Not found", { status: 404 })
        }
        const object = await env.FILES.get(fileKey(params.id, params.name), {
          range: request.headers,
          onlyIf: request.headers,
        })
        if (!object) return new Response("Not found", { status: 404 })

        const headers = new Headers()
        object.writeHttpMetadata(headers)
        headers.set("etag", object.httpEtag)
        headers.set("accept-ranges", "bytes")
        headers.set("cache-control", "public, max-age=31536000, immutable")
        headers.set("x-content-type-options", "nosniff")
        // Files open in the page; anything that could run script is downloaded instead.
        const type = headers.get("content-type") ?? ""
        if (/html|svg|xml|javascript/i.test(type)) {
          headers.set("content-security-policy", "sandbox")
          headers.set("content-disposition", "attachment")
        }

        if (!("body" in object)) return new Response(null, { status: 304, headers })
        const range = object.range as { offset?: number; length?: number } | undefined
        if (range && request.headers.has("range")) {
          const offset = range.offset ?? 0
          const length = range.length ?? object.size - offset
          headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`)
          headers.set("content-length", String(length))
          return new Response(object.body, { status: 206, headers })
        }
        headers.set("content-length", String(object.size))
        return new Response(object.body, { headers })
      },
    },
  },
})
