# Lotion Share

Publish notes from [Lotion](https://github.com/fayazara/Lotion) to the web, on
your own Cloudflare account.

Lotion Share is a Cloudflare Worker you deploy yourself. It stores published
notes in **D1**, their images and files in **R2**, and serves each note as a
fast, themed page at its own link. Nobody else runs it, and nobody else holds
your notes. It fits within the Workers free plan.

## Set it up

You don't need to do this by hand. In Lotion, open **Settings → Cloud**, click
**Copy setup prompt**, and paste it into your coding agent (Claude Code, Codex,
OpenCode, …). The agent follows [DEPLOY.md](DEPLOY.md), runs one command, and
gives you a URL and a token to paste back into Lotion.

To do it yourself:

```bash
gh repo fork fayazara/lotion-share --clone   # or: git clone, see DEPLOY.md
cd lotion-share
pnpm install
pnpm exec cf auth login
pnpm run deploy
```

## What a published page shows

Each note gets its own page at `/n/<id>`, rendered on the worker and read the
way Lotion reads Markdown:

- the note's theme colors, following the reader's light or dark mode, set in the system font
- its cover photo (with the Unsplash credit) and its icon
- headings, lists, checklists, tables, callouts (`> [!TIP]`) and `[TOC]`
- code with syntax highlighting, and Mermaid diagrams
- YouTube, Vimeo, Loom, Spotify, Apple Music, Figma and CodePen embeds
- link cards, with the linked page's title, description and image
- images, video, audio, PDFs, and download cards for other files

Pages have Open Graph tags, so links to them unfurl in chat apps. There's no
index of notes: a note is only reachable by its link.

## Update it

Run the same prompt again, or:

```bash
git fetch upstream && git merge upstream/main
pnpm install
pnpm run deploy
```

Your token stays the same, so Lotion stays connected. Lotion's **Verify
connection** tells you when your worker is behind.

## How it works

| | |
| --- | --- |
| `pnpm run deploy` | Creates or reuses the D1 database and R2 bucket, applies migrations, sets the token secret, and deploys. Safe to run any number of times. |
| `lotion.deploy.json` | Your account, resource names and IDs, written by the deploy. Commit it in your fork with `git add -f`. The template ignores it and never ships one, so updates merge cleanly. |
| `LOTION_TOKEN` | The secret Lotion sends as `Authorization: Bearer …`. Made by the deploy and shown once. `pnpm run deploy -- --rotate-token` makes a new one. |

### API

Every `/api` route needs the token.

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/v1/info` | Checks the token, and reports the deployed version and any pending migrations. |
| `GET` | `/api/v1/notes` | Lists published notes. |
| `GET` | `/api/v1/notes/:id` | Returns one note as published. |
| `PUT` | `/api/v1/notes/:id` | Publishes or updates a note. The reply lists the files still to upload. |
| `PUT` | `/api/v1/notes/:id/files/:name` | Uploads one of a note's files, as the raw body. |
| `DELETE` | `/api/v1/notes/:id` | Unpublishes a note and deletes its files. |

These are public:

| Path | |
| --- | --- |
| `/n/:id` | A published note. |
| `/files/:id/:name` | Its files. They're immutable and cached for good. |

## Develop

```bash
pnpm install
cp .dev.vars.example .dev.vars   # LOTION_TOKEN="local-dev-token"
pnpm dev                         # http://localhost:3000, local D1 and R2
```

To point Lotion at it, set the Worker URL to `http://localhost:3000` and the
token to `local-dev-token`.

Built on TanStack Start, the [`cf` CLI](https://developers.cloudflare.com/cf/),
Drizzle and marked. See [AGENTS.md](AGENTS.md) for the patterns this codebase
follows.

## License

MIT
