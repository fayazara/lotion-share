import { drizzle } from "drizzle-orm/d1"
import { env } from "cloudflare:workers"
import * as schema from "./schema"

/**
 * Drizzle client bound to the `DB` D1 binding (see cloudflare.config.ts).
 * Server-only: never import this from a client component.
 */
export const db = drizzle(env.DB, { schema })

export { schema }
