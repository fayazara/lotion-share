import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { bindings, defineConfig } from "cf/config"

/**
 * Cloudflare project config, read by the `cf` CLI and the Cloudflare Vite
 * plugin. This replaces wrangler.jsonc.
 *
 * Your own resource names and IDs live in `lotion.deploy.json`, which
 * `pnpm run setup` writes. This file never holds them, so pulling updates
 * from the upstream template never conflicts with your deployment.
 */
type Deployment = {
  workerName: string
  databaseName: string
  databaseId: string
  bucketName: string
}

const deploymentFile = resolve(process.cwd(), "lotion.deploy.json")

/** Placeholders for local dev, before setup has run. */
const localDefaults: Deployment = {
  workerName: "lotion-share",
  databaseName: "lotion-share-db",
  databaseId: "4c0f1a3e-5b7d-4e2a-9c1f-6d8e0b2a7f35",
  bucketName: "lotion-share-files",
}

const deployment: Deployment = existsSync(deploymentFile)
  ? { ...localDefaults, ...JSON.parse(readFileSync(deploymentFile, "utf8")) }
  : localDefaults

export default defineConfig({
  worker: {
    name: deployment.workerName,
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "@tanstack/react-start/server-entry",
    observability: {
      enabled: true,
    },
    env: {
      /** Published notes. */
      DB: bindings.d1({ name: deployment.databaseName, id: deployment.databaseId }),
      /** Images, files, covers and icons of published notes. */
      FILES: bindings.r2({ name: deployment.bucketName }),
      /** The shared token Lotion sends as `Authorization: Bearer …`. */
      LOTION_TOKEN: bindings.secret(),
    },
  },
})
