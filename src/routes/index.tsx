import { createFileRoute } from "@tanstack/react-router"
import noteCss from "../note.css?url"

/**
 * The worker's home page. Published notes are only reachable by their own
 * links, so there's no list here — just a sign that the worker is running.
 */
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Lotion Share" }, { name: "robots", content: "noindex" }],
    links: [{ rel: "stylesheet", href: noteCss }],
  }),
  component: Home,
})

function Home() {
  return (
    <div className="lotion-page">
      <main className="note not-found">
        <h1>Lotion Share is running</h1>
        <p>
          This worker publishes notes from{" "}
          <a href="https://github.com/fayazara/Lotion" style={{ color: "var(--accent)" }}>
            Lotion
          </a>
          . Each note lives at its own link.
        </p>
      </main>
    </div>
  )
}
