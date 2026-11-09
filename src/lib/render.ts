import { Marked, type Tokens } from "marked"
import markedAlert from "marked-alert"
import { gfmHeadingId, getHeadingList } from "marked-gfm-heading-id"
import { markedHighlight } from "marked-highlight"
import hljs from "highlight.js/lib/common"
import type { LinkPreview } from "@/db/schema"

/**
 * Turns a note's Markdown into the HTML of its public page, reading it the way
 * Lotion does: a link alone on its line is an embed or a card, `[TOC]` is a
 * table of contents, `![[Note]]` is another note, ```mermaid is a diagram,
 * and images, videos, audio and PDFs show as themselves.
 */
export type Rendered = {
  html: string
  hasMermaid: boolean
  /** The first image, for link previews of the page itself. */
  firstImage?: string
  /** A sentence or two of plain text, for link previews of the page itself. */
  excerpt: string
}

const TOC_MARKERS = new Set(["[toc]", "[[toc]]", "[[_toc_]]", "${toc}"])
const TOC_PLACEHOLDER = "<!--lotion-toc-->"

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp", "avif", "svg"])
const VIDEO = new Set(["mp4", "mov", "m4v", "webm"])
const AUDIO = new Set(["mp3", "m4a", "wav", "aac", "aiff", "aif", "flac", "ogg", "caf", "opus"])

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function extension(source: string): string {
  const path = source.split(/[?#]/)[0]
  const dot = path.lastIndexOf(".")
  return dot < 0 ? "" : path.slice(dot + 1).toLowerCase()
}

function fileName(source: string): string {
  const path = decodeURIComponent(source.split(/[?#]/)[0])
  return path.slice(path.lastIndexOf("/") + 1)
}

/** A web address with nothing else on its line. */
export function isBareLink(line: string): boolean {
  return /^https?:\/\/\S+$/i.test(line.trim())
}

/** Every link that stands alone on its line, outside code: the cards to preview. */
export function bareLinks(markdown: string): string[] {
  const links = new Set<string>()
  eachLine(markdown, (line, inCode) => {
    if (!inCode && isBareLink(line) && !embedFor(line.trim()) && !mediaKind(line.trim())) links.add(line.trim())
  })
  return [...links]
}

function eachLine(markdown: string, visit: (line: string, inCode: boolean) => string | void): string {
  let fence: string | null = null
  return markdown
    .split("\n")
    .map((line) => {
      const opener = /^\s*(`{3,}|~{3,})/.exec(line)
      if (fence) {
        if (opener && opener[1][0] === fence[0] && opener[1].length >= fence.length && line.trim() === opener[1]) {
          fence = null
        }
        return visit(line, true) ?? line
      }
      if (opener) {
        fence = opener[1]
        return visit(line, true) ?? line
      }
      return visit(line, false) ?? line
    })
    .join("\n")
}

function mediaKind(source: string): "image" | "video" | "audio" | "pdf" | null {
  const ext = extension(source)
  if (IMAGE.has(ext)) return "image"
  if (VIDEO.has(ext)) return "video"
  if (AUDIO.has(ext)) return "audio"
  if (ext === "pdf") return "pdf"
  return null
}

function media(source: string, alt: string): string {
  const src = escapeHtml(source)
  switch (mediaKind(source)) {
    case "video":
      return `<figure class="media"><video src="${src}" controls playsinline preload="metadata"></video></figure>`
    case "audio":
      return `<figure class="media audio"><audio src="${src}" controls preload="metadata"></audio>${
        alt ? `<figcaption>${escapeHtml(alt)}</figcaption>` : ""
      }</figure>`
    case "pdf":
      return `<figure class="media pdf"><iframe src="${src}" title="${escapeHtml(alt || fileName(source))}" loading="lazy"></iframe></figure>`
    default:
      return `<figure class="media"><img src="${src}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"></figure>`
  }
}

// MARK: Embeds — the same providers Lotion plays inline.

type Embed = { src: string; height: number; name: string; video?: boolean }

function seconds(time: string): number | null {
  if (/^\d+$/.test(time)) return Number(time)
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(time)
  if (!match || !match[0]) return null
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
}

export function embedFor(source: string): Embed | null {
  let url: URL
  try {
    url = new URL(source)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "")
  const parts = url.pathname.split("/").filter(Boolean)
  const item = (name: string) => url.searchParams.get(name)

  let youtube: string | null = null
  if (host === "youtu.be" && parts[0]) youtube = parts[0]
  if (host.endsWith("youtube.com") || host === "youtube-nocookie.com") {
    if (parts[0] === "watch") youtube = item("v")
    if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "") && parts[1]) youtube = parts[1]
  }
  if (youtube && /^[\w-]{6,}$/.test(youtube)) {
    let src = `https://www.youtube-nocookie.com/embed/${youtube}?rel=0&playsinline=1&modestbranding=1`
    const start = seconds(item("t") ?? item("start") ?? "")
    if (start) src += `&start=${start}`
    return { src, height: 0, name: "YouTube", video: true }
  }
  if (host === "vimeo.com") {
    const id = parts.find((part) => /^\d+$/.test(part))
    if (id) return { src: `https://player.vimeo.com/video/${id}?dnt=1`, height: 0, name: "Vimeo", video: true }
  }
  if (host === "player.vimeo.com" && parts[0] === "video" && parts[1]) {
    return { src: `https://player.vimeo.com/video/${parts[1]}?dnt=1`, height: 0, name: "Vimeo", video: true }
  }
  if (host.endsWith("loom.com") && ["share", "embed"].includes(parts[0] ?? "") && parts[1]) {
    return { src: `https://www.loom.com/embed/${parts[1]}?hide_owner=true`, height: 0, name: "Loom", video: true }
  }
  if (host === "open.spotify.com") {
    const rest = parts[0]?.startsWith("intl-") ? parts.slice(1) : parts
    if (rest.length >= 2 && ["track", "album", "playlist", "episode", "show", "artist"].includes(rest[0])) {
      const compact = rest[0] === "track" || rest[0] === "episode"
      return {
        src: `https://open.spotify.com/embed/${rest[0]}/${rest[1]}?utm_source=lotion`,
        height: compact ? 152 : 352,
        name: "Spotify",
      }
    }
  }
  if (host === "music.apple.com" || host === "podcasts.apple.com") {
    const embed = new URL(url)
    embed.hostname = `embed.${host}`
    const single = item("i") !== null || parts.includes("song")
    return {
      src: embed.toString(),
      height: single ? 175 : 450,
      name: host.startsWith("music") ? "Apple Music" : "Apple Podcasts",
    }
  }
  if (host.endsWith("figma.com") && ["file", "design", "proto", "board", "slides"].includes(parts[0] ?? "")) {
    return {
      src: `https://www.figma.com/embed?embed_host=lotion&url=${encodeURIComponent(source)}`,
      height: 450,
      name: "Figma",
    }
  }
  if (host === "codepen.io") {
    const rest = parts[0] === "team" ? parts.slice(1) : parts
    if (rest.length >= 3 && ["pen", "full", "details"].includes(rest[1])) {
      const owner = parts[0] === "team" ? `team/${rest[0]}` : rest[0]
      return { src: `https://codepen.io/${owner}/embed/${rest[2]}?default-tab=result`, height: 400, name: "CodePen" }
    }
  }
  return null
}

function embedHtml(embed: Embed): string {
  const src = escapeHtml(embed.src)
  const allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
  if (embed.video) {
    return `<figure class="embed video"><iframe src="${src}" title="${embed.name}" allow="${allow}" allowfullscreen loading="lazy"></iframe></figure>`
  }
  return `<figure class="embed"><iframe src="${src}" title="${embed.name}" height="${embed.height}" allow="${allow}" loading="lazy"></iframe></figure>`
}

function linkCard(source: string, preview: LinkPreview | undefined): string {
  let host = source
  try {
    host = new URL(source).hostname.replace(/^www\./, "")
  } catch {}
  const title = preview?.title || host
  const description = preview?.description
  const image = preview?.image
  return `<a class="link-card" href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">
<span class="link-card-text">
<span class="link-card-title">${escapeHtml(title)}</span>
${description ? `<span class="link-card-description">${escapeHtml(description)}</span>` : ""}
<span class="link-card-host">${escapeHtml(preview?.siteName || host)}</span>
</span>
${image ? `<span class="link-card-image"><img src="${escapeHtml(image)}" alt="" loading="lazy"></span>` : ""}
</a>`
}

function fileCard(label: string, target: string): string {
  const ext = extension(target).toUpperCase()
  return `<a class="file-card" href="${escapeHtml(target)}" download="${escapeHtml(label || fileName(target))}">
<span class="file-card-badge">${escapeHtml(ext || "FILE")}</span>
<span class="file-card-name">${escapeHtml(label || fileName(target))}</span>
<span class="file-card-action">Download</span>
</a>`
}

/** Rewrites the lines Lotion reads as rich blocks into HTML blocks. */
function preprocess(markdown: string, links: Record<string, LinkPreview>) {
  let hasMermaid = false
  let mermaid: string[] | null = null
  let mermaidFence = ""
  const out: string[] = []
  let fence: string | null = null

  // Front matter is the note's own business.
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "")

  for (const line of body.split("\n")) {
    if (mermaid) {
      if (line.trim() === mermaidFence) {
        out.push(`<pre class="mermaid">${escapeHtml(mermaid.join("\n"))}</pre>`, "")
        mermaid = null
      } else {
        mermaid.push(line)
      }
      continue
    }
    const opener = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(line)
    if (fence) {
      if (opener && line.trim() === opener[1] && opener[1][0] === fence[0] && opener[1].length >= fence.length) {
        fence = null
      }
      out.push(line)
      continue
    }
    if (opener) {
      if (opener[2].toLowerCase() === "mermaid") {
        hasMermaid = true
        mermaid = []
        mermaidFence = opener[1]
        continue
      }
      fence = opener[1]
      out.push(line)
      continue
    }

    const trimmed = line.trim()
    if (TOC_MARKERS.has(trimmed.toLowerCase())) {
      out.push("", TOC_PLACEHOLDER, "")
      continue
    }
    const noteRef = /^!\[\[([^[\]]+)\]\]$/.exec(trimmed)
    if (noteRef) {
      out.push("", `<div class="note-ref"><span class="note-ref-icon">↗</span>${escapeHtml(noteRef[1])}</div>`, "")
      continue
    }
    if (isBareLink(trimmed)) {
      const embed = embedFor(trimmed)
      if (embed) {
        out.push("", embedHtml(embed), "")
        continue
      }
      if (mediaKind(trimmed)) {
        out.push("", media(trimmed, ""), "")
        continue
      }
      out.push("", linkCard(trimmed, links[trimmed]), "")
      continue
    }
    // `[report.zip](/files/…/abc.zip)`: a file beside the note.
    const file = /^\[([^\]]*)\]\(<?([^)>\s]+)>?\)$/.exec(trimmed)
    if (file && !file[2].includes("://") && !file[2].startsWith("#") && extension(file[2])) {
      const kind = mediaKind(file[2])
      out.push("", kind === "pdf" ? media(file[2], file[1]) + fileCard(file[1], file[2]) : fileCard(file[1], file[2]), "")
      continue
    }
    out.push(line)
  }
  if (mermaid) out.push(`<pre class="mermaid">${escapeHtml(mermaid.join("\n"))}</pre>`)
  return { text: out.join("\n"), hasMermaid }
}

function tocHtml(): string {
  const headings = getHeadingList().filter((heading) => heading.level <= 3)
  if (!headings.length) return ""
  const top = Math.min(...headings.map((heading) => heading.level))
  const items = headings
    .map(
      (heading) =>
        `<li class="toc-${heading.level - top}"><a href="#${escapeHtml(heading.id)}">${heading.text}</a></li>`
    )
    .join("")
  return `<nav class="toc"><ul>${items}</ul></nav>`
}

function plainText(html: string): string {
  return html
    .replace(/<(script|style|pre|figure|nav)[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function renderMarkdown(markdown: string, links: Record<string, LinkPreview> = {}): Rendered {
  let firstImage: string | undefined
  const marked = new Marked(
    markedHighlight({
      emptyLangClass: "hljs",
      langPrefix: "hljs language-",
      highlight(code, lang) {
        const language = hljs.getLanguage(lang) ? lang : "plaintext"
        return hljs.highlight(code, { language }).value
      },
    }),
    gfmHeadingId(),
    markedAlert(),
    {
      gfm: true,
      breaks: false,
      renderer: {
        image({ href, text }: Tokens.Image) {
          if (!firstImage && mediaKind(href) === "image") firstImage = href
          return media(href, text)
        },
        link(this: { parser: { parseInline: (tokens: Tokens.Generic[]) => string } }, token: Tokens.Link) {
          const inner = this.parser.parseInline(token.tokens)
          const href = escapeHtml(token.href)
          const external = /^https?:\/\//i.test(token.href)
          const title = token.title ? ` title="${escapeHtml(token.title)}"` : ""
          return `<a href="${href}"${title}${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${inner}</a>`
        },
      },
    }
  )

  const { text, hasMermaid } = preprocess(markdown, links)
  let html = marked.parse(text, { async: false }) as string
  if (html.includes(TOC_PLACEHOLDER)) html = html.split(TOC_PLACEHOLDER).join(tocHtml())
  if (!firstImage) firstImage = /<img src="([^"]+)"/.exec(html)?.[1]

  // The first heading is the note's title, already shown in the page's head.
  const excerpt = plainText(html.replace(/^\s*<h1[\s\S]*?<\/h1>/, "")).slice(0, 200)
  return { html, hasMermaid, firstImage, excerpt }
}

// MARK: Link previews

function metaContent(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
      "i"
    )
    const match = pattern.exec(html)
    const value = match?.[1] ?? match?.[2]
    if (value) return decodeEntities(value.trim())
  }
  return undefined
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
}

/** Reads a page's title, description and image, for its card. */
export async function fetchPreview(address: string): Promise<LinkPreview | null> {
  try {
    const response = await fetch(address, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; LotionShare/1.0; +https://github.com/fayazara/lotion-share)", accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("html")) return null
    // The head is enough; don't read a whole page.
    const reader = response.body?.getReader()
    if (!reader) return null
    let html = ""
    const decoder = new TextDecoder()
    while (html.length < 200_000) {
      const { done, value } = await reader.read()
      if (done) break
      html += decoder.decode(value, { stream: true })
      if (html.includes("</head>")) break
    }
    await reader.cancel().catch(() => {})

    const title = metaContent(html, ["og:title", "twitter:title"]) ?? decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? "")
    let image = metaContent(html, ["og:image", "og:image:url", "twitter:image"])
    if (image) {
      try {
        image = new URL(image, response.url).toString()
      } catch {
        image = undefined
      }
    }
    return {
      title: title || undefined,
      description: metaContent(html, ["og:description", "description", "twitter:description"]),
      image,
      siteName: metaContent(html, ["og:site_name"]),
    }
  } catch {
    return null
  }
}
