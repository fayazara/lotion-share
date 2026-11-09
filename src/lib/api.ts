import { env } from "cloudflare:workers"
import pkg from "../../package.json"

/**
 * The HTTP API the Lotion app speaks. Bump `API_VERSION` only for changes an
 * older app can't handle; Lotion tells its user to update a worker whose
 * version is older than the one it needs.
 */
export const API_VERSION = 1

/** The template's own version, from package.json. */
export const TEMPLATE_VERSION: string = pkg.version

/** The migrations bundled with this version of the worker. */
export const BUNDLED_MIGRATIONS = Object.keys(import.meta.glob("/drizzle/*.sql")).length

/** Note IDs are chosen by the app: lowercase letters and digits. */
export const NOTE_ID = /^[a-z0-9]{8,32}$/

/** File names are chosen by the app: a hash and an extension. */
export const FILE_NAME = /^[A-Za-z0-9_-]{1,80}(\.[A-Za-z0-9]{1,10})?$/

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  })
}

export function error(status: number, message: string, extra?: object): Response {
  return json({ error: message, ...extra }, status)
}

/**
 * Whether the request carries the shared token. Both sides are hashed first
 * so the comparison takes the same time whatever the token's length.
 */
export async function isAuthorized(request: Request): Promise<boolean> {
  const secret = env.LOTION_TOKEN
  const header = request.headers.get("authorization") ?? ""
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!secret || !match) return false
  const encoder = new TextEncoder()
  const [given, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(match[1].trim())),
    crypto.subtle.digest("SHA-256", encoder.encode(secret)),
  ])
  // Workers add `timingSafeEqual` to SubtleCrypto; the DOM types don't know it.
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean }
  return subtle.timingSafeEqual(given, expected)
}

/** Runs `handler` only for requests with the token; a 401 otherwise. */
export async function authorized(
  request: Request,
  handler: () => Promise<Response> | Response
): Promise<Response> {
  if (!env.LOTION_TOKEN) {
    return error(500, "This worker has no LOTION_TOKEN secret. Run `pnpm run setup` again.")
  }
  if (!(await isAuthorized(request))) return error(401, "The token is missing or wrong.")
  return handler()
}

/** The R2 key of one of a note's files. */
export function fileKey(noteId: string, name: string): string {
  return `notes/${noteId}/${name}`
}

/** Deletes every file of a note except those in `keep`. */
export async function pruneFiles(noteId: string, keep: Set<string> = new Set()) {
  const prefix = `notes/${noteId}/`
  let cursor: string | undefined
  do {
    const listing = await env.FILES.list({ prefix, cursor })
    const stale = listing.objects
      .map((object) => object.key)
      .filter((key) => !keep.has(key.slice(prefix.length)))
    if (stale.length) await env.FILES.delete(stale)
    cursor = listing.truncated ? listing.cursor : undefined
  } while (cursor)
}
