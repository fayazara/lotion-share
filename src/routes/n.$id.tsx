import { createFileRoute, notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { eq } from "drizzle-orm"
import { db, schema } from "@/db"
import { NOTE_ID } from "@/lib/api"
import { renderMarkdown } from "@/lib/render"
import type { NoteStyle, Palette } from "@/db/schema"
import noteCss from "../note.css?url"
import lightCodeCss from "highlight.js/styles/github.css?url"
import darkCodeCss from "highlight.js/styles/github-dark.css?url"

/** A published note, read and rendered on the worker. */
const getNote = createServerFn()
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    if (!NOTE_ID.test(id)) return null
    const note = await db.query.notes.findFirst({ where: eq(schema.notes.id, id) })
    if (!note) return null
    const rendered = renderMarkdown(note.markdown, note.links ?? {})
    const file = (name: string | null) =>
      !name ? null : name.startsWith("https://") ? name : `/files/${note.id}/${name}`
    return {
      id: note.id,
      title: note.title,
      html: rendered.html,
      hasMermaid: rendered.hasMermaid,
      excerpt: rendered.excerpt,
      image: file(note.cover) ?? rendered.firstImage ?? null,
      cover: file(note.cover),
      coverPosition: note.coverPosition,
      coverCredit: note.coverCredit,
      coverCreditUrl: note.coverCreditUrl,
      icon: file(note.icon),
      style: note.style ?? {},
      updatedAt: note.updatedAt.toISOString(),
    }
  })

/** Lotion's own "Paper" theme, for notes published without one. */
const PAPER: Required<Pick<NoteStyle, "light" | "dark">> = {
  light: {
    background: "#FBFBFA",
    text: "#1F1F1D",
    secondary: "#6E6E6A",
    accent: "#007AFF",
    codeBackground: "#F3F3F1",
    inlineCode: "#EEEEEB",
    rule: "#E3E3E0",
  },
  dark: {
    background: "#1C1C1B",
    text: "#E8E7E3",
    secondary: "#9D9C97",
    accent: "#0A84FF",
    codeBackground: "#252524",
    inlineCode: "#2B2B2A",
    rule: "#343432",
  },
}

function isDark(palette: Palette): boolean {
  const value = parseInt(palette.background.slice(1), 16)
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
}

function variables(palette: Palette): string {
  return [
    `--bg:${palette.background}`,
    `--text:${palette.text}`,
    `--secondary:${palette.secondary}`,
    `--accent:${palette.accent}`,
    `--code-bg:${palette.codeBackground}`,
    `--inline-code:${palette.inlineCode}`,
    `--rule:${palette.rule}`,
    `color-scheme:${isDark(palette) ? "dark" : "light"}`,
  ].join(";")
}

/** The note's theme as CSS. A theme with one appearance uses it for both. */
function themeCss(style: NoteStyle): { css: string; mode: "both" | "light" | "dark" } {
  const custom = style.light || style.dark
  const light = custom ? (style.light ?? style.dark)! : PAPER.light
  const dark = custom ? (style.dark ?? style.light)! : PAPER.dark
  const base = `:root{${variables(light)}}`
  if (light === dark) return { css: base, mode: isDark(light) ? "dark" : "light" }
  return { css: `${base}@media (prefers-color-scheme: dark){:root{${variables(dark)}}}`, mode: "both" }
}

const MERMAID = `
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
const css = getComputedStyle(document.documentElement);
const dark = css.colorScheme === "dark";
mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  fontFamily: css.getPropertyValue("--note-font"),
  themeVariables: {
    darkMode: dark,
    background: css.getPropertyValue("--bg").trim(),
    primaryColor: css.getPropertyValue("--code-bg").trim(),
    primaryTextColor: css.getPropertyValue("--text").trim(),
    primaryBorderColor: css.getPropertyValue("--rule").trim(),
    lineColor: css.getPropertyValue("--secondary").trim(),
    textColor: css.getPropertyValue("--text").trim(),
  },
});
await mermaid.run({ querySelector: "pre.mermaid" });
`

export const Route = createFileRoute("/n/$id")({
  loader: async ({ params }) => {
    const note = await getNote({ data: params.id })
    if (!note) throw notFound()
    return note
  },
  head: ({ loaderData: note }) => {
    if (!note) return { meta: [{ title: "Not found" }] }
    const theme = themeCss(note.style)
    const meta = [
      { title: note.title },
      { name: "description", content: note.excerpt },
      { property: "og:title", content: note.title },
      { property: "og:description", content: note.excerpt },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: note.image ? "summary_large_image" : "summary" },
      { name: "generator", content: "Lotion" },
    ]
    if (note.image) meta.push({ property: "og:image", content: note.image })
    const codeSheets =
      theme.mode === "both"
        ? [
            { rel: "stylesheet", href: lightCodeCss, media: "(prefers-color-scheme: light)" },
            { rel: "stylesheet", href: darkCodeCss, media: "(prefers-color-scheme: dark)" },
          ]
        : [{ rel: "stylesheet", href: theme.mode === "dark" ? darkCodeCss : lightCodeCss }]
    return {
      meta,
      links: [{ rel: "stylesheet", href: noteCss }, ...codeSheets],
      styles: [{ children: theme.css }],
      scripts: note.hasMermaid ? [{ type: "module", children: MERMAID }] : [],
    }
  },
  component: NotePage,
  notFoundComponent: NotFound,
})

function NotePage() {
  const note = Route.useLoaderData()
  const updated = new Date(note.updatedAt)
  return (
    <div className="lotion-page">
      {note.cover ? (
        <header className="cover">
          <img src={note.cover} alt="" style={{ objectPosition: `50% ${note.coverPosition * 100}%` }} />
          {note.coverCredit ? (
            <a
              className="cover-credit"
              href={note.coverCreditUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              Photo by {note.coverCredit} on Unsplash
            </a>
          ) : null}
        </header>
      ) : null}
      <main className={`note${note.cover ? " has-cover" : ""}`}>
        {note.icon ? <img className="note-icon" src={note.icon} alt="" width={64} height={64} /> : null}
        <article className="note-body" dangerouslySetInnerHTML={{ __html: note.html }} />
        <footer className="note-footer">
          <span>
            Updated{" "}
            <time dateTime={note.updatedAt}>
              {updated.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}
            </time>
          </span>
          <a href="https://github.com/fayazara/lotion-share" target="_blank" rel="noopener noreferrer">
            Published with Lotion
          </a>
        </footer>
      </main>
    </div>
  )
}

function NotFound() {
  return (
    <div className="lotion-page">
      <main className="note not-found">
        <h1>This note isn’t here</h1>
        <p>It may have been unpublished, or the link is mistyped.</p>
      </main>
    </div>
  )
}
