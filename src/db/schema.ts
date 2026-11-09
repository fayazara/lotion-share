import { sql } from "drizzle-orm"
import { int, real, sqliteTable, text } from "drizzle-orm/sqlite-core"

/** Colors for one appearance of a note's theme, as `#rrggbb`. */
export type Palette = {
  background: string
  text: string
  secondary: string
  accent: string
  codeBackground: string
  inlineCode: string
  rule: string
}

/**
 * How a published note looks: the theme it was written in. Pages always use
 * the system font, whatever font the note is written in.
 */
export type NoteStyle = {
  light?: Palette
  dark?: Palette
}

/** What a link alone on its line shows as a card, read when it is published. */
export type LinkPreview = {
  title?: string
  description?: string
  image?: string
  siteName?: string
}

/**
 * One published note. `id` is chosen by the app, so publishing the same note
 * again updates it in place, at the same address.
 */
export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  markdown: text("markdown").notNull(),
  /** A file name among this note's files, or an `https://` address. */
  cover: text("cover"),
  coverPosition: real("cover_position").notNull().default(0.5),
  coverCredit: text("cover_credit"),
  coverCreditUrl: text("cover_credit_url"),
  /** A file name among this note's files: the icon, drawn as an image. */
  icon: text("icon"),
  style: text("style", { mode: "json" }).$type<NoteStyle>(),
  /** Link previews, keyed by address. */
  links: text("links", { mode: "json" }).$type<Record<string, LinkPreview>>(),
  /** The files this note uses, kept in R2 under `notes/<id>/`. */
  files: text("files", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  createdAt: int("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: int("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type Note = typeof notes.$inferSelect
export type NewNote = typeof notes.$inferInsert
