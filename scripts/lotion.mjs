#!/usr/bin/env node
/**
 * Sets up and deploys Lotion Share on your own Cloudflare account, or updates
 * an existing deployment. Safe to run any number of times: it reuses what
 * already exists and only creates what's missing.
 *
 *   pnpm run deploy                          set up, or update and redeploy
 *   pnpm run deploy -- --account <id>        pick the account, if you have several
 *   pnpm run deploy -- --name <worker-name>  first run only: name the worker
 *   pnpm run deploy -- --rotate-token        make a new token (the old one stops working)
 *   pnpm run db:migrate                      apply migrations to the local dev database
 *
 * Names, IDs and the account are kept in `lotion.deploy.json`. Commit it in
 * your fork; the upstream template never touches it, so updates merge cleanly.
 * The token is never written to disk.
 */
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const deploymentFile = join(root, "lotion.deploy.json")
const cfBin = join(root, "node_modules", ".bin", "cf")

const LOCAL_DATABASE_ID = "4c0f1a3e-5b7d-4e2a-9c1f-6d8e0b2a7f35"

// MARK: Arguments

const argv = process.argv.slice(2)
const command = argv[0] && !argv[0].startsWith("--") ? argv.shift() : "deploy"
function option(name) {
  const index = argv.indexOf(`--${name}`)
  if (index < 0) return undefined
  const value = argv[index + 1]
  return value && !value.startsWith("--") ? value : true
}

// MARK: Output

const bold = (text) => `\x1b[1m${text}\x1b[0m`
const dim = (text) => `\x1b[2m${text}\x1b[0m`
const green = (text) => `\x1b[32m${text}\x1b[0m`
const step = (text) => console.log(`${green("→")} ${text}`)

function fail(message, hint) {
  console.error(`\n\x1b[31m✗ ${message}\x1b[0m`)
  if (hint) console.error(`\n${hint}`)
  process.exit(1)
}

// MARK: cf

/** Runs the cf CLI and returns its stdout, parsed as JSON when asked. */
function cf(args, { json = true, env = {}, allowFailure = false, inherit = false } = {}) {
  if (!existsSync(cfBin)) fail("The cf CLI isn't installed here.", "Run `pnpm install` first.")
  const result = spawnSync(cfBin, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
    // No stdin: cf then answers its own prompts the non-interactive way, instead of waiting.
    stdio: inherit ? ["ignore", "pipe", "inherit"] : ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  })
  if (inherit && result.stdout) process.stdout.write(result.stdout)
  if (result.status !== 0) {
    if (allowFailure) return null
    fail(`\`cf ${args.join(" ")}\` failed.`, (result.stderr || result.stdout || "").trim())
  }
  if (!json) return result.stdout
  try {
    return JSON.parse(result.stdout)
  } catch {
    return result.stdout
  }
}

// MARK: Deployment file

function readDeployment() {
  if (!existsSync(deploymentFile)) return null
  try {
    return JSON.parse(readFileSync(deploymentFile, "utf8"))
  } catch {
    fail("lotion.deploy.json isn't valid JSON.", "Fix it or delete it, then run this again.")
  }
}

function writeDeployment(deployment) {
  writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2) + "\n")
}

// MARK: Local migrations

function migrateLocal() {
  const id = readDeployment()?.databaseId ?? LOCAL_DATABASE_ID
  cf(["d1", "migrations", "apply", id, "--local", "--persist-to", ".cloudflare/state", "--dir", "drizzle"], {
    json: false,
    inherit: true,
  })
}

// MARK: Deploy

function chooseAccount(deployment) {
  const whoami = cf(["auth", "whoami"], { allowFailure: true })
  if (!whoami?.authenticated) {
    fail("You're not signed in to Cloudflare.", "Run `pnpm exec cf auth login` (it opens a browser), then run this again.")
  }
  const accounts = whoami.accounts ?? []
  const wanted = typeof option("account") === "string" ? option("account") : deployment.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID
  if (wanted) {
    const account = accounts.find((item) => item.id === wanted)
    if (!account) fail(`No account with the ID ${wanted} is available to this login.`, listAccounts(accounts))
    return account
  }
  if (accounts.length === 1) return accounts[0]
  if (!accounts.length) fail("This login has no Cloudflare accounts.")
  fail(
    "This login has more than one Cloudflare account.",
    `${listAccounts(accounts)}\n\nAsk which one to use, then run: pnpm run deploy -- --account <id>`
  )
}

function listAccounts(accounts) {
  return ["Accounts:", ...accounts.map((item) => `  ${item.name}  ${dim(item.id)}`)].join("\n")
}

function findOrCreateDatabase(name, env) {
  const existing = cf(["d1", "list", "--name", name], { env })
  const match = Array.isArray(existing) ? existing.find((item) => item.name === name) : null
  if (match) {
    step(`Using the D1 database ${bold(name)}`)
    return match.uuid
  }
  step(`Creating the D1 database ${bold(name)}`)
  const created = cf(["d1", "create", "--name", name], { env })
  const id = created?.uuid ?? created?.result?.uuid
  if (!id) fail("Created the database, but couldn't read its ID.", JSON.stringify(created, null, 2))
  return id
}

function findOrCreateBucket(name, env) {
  const listing = cf(["r2", "buckets", "list", "--name-contains", name], { env })
  if ((listing?.buckets ?? []).some((bucket) => bucket.name === name)) {
    step(`Using the R2 bucket ${bold(name)}`)
    return
  }
  step(`Creating the R2 bucket ${bold(name)}`)
  cf(["r2", "buckets", "create", "--name", name], { env })
}

function hasTokenSecret(worker, env) {
  const secrets = cf(["workers", "secrets", "list", "--worker", worker], { env, allowFailure: true })
  const list = Array.isArray(secrets) ? secrets : (secrets?.result ?? [])
  return list.some((secret) => secret.name === "LOTION_TOKEN")
}

function deploy() {
  const previous = readDeployment()
  const deployment = previous ?? {}
  const account = chooseAccount(deployment)
  const env = { CLOUDFLARE_ACCOUNT_ID: account.id }
  console.log(`\n${bold("Lotion Share")} on ${bold(account.name)} ${dim(account.id)}\n`)

  if (!deployment.workerName) {
    const name = typeof option("name") === "string" ? option("name") : "lotion-share"
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) fail("Worker names are lowercase letters, digits and dashes.")
    deployment.workerName = name
  }
  deployment.accountId = account.id
  deployment.databaseName ??= `${deployment.workerName}-db`
  deployment.bucketName ??= `${deployment.workerName}-files`

  deployment.databaseId = findOrCreateDatabase(deployment.databaseName, env)
  writeDeployment(deployment)
  findOrCreateBucket(deployment.bucketName, env)

  step("Applying database migrations")
  cf(["d1", "migrations", "apply", deployment.databaseId, "--dir", "drizzle"], { env, json: false, inherit: true })

  const rotate = option("rotate-token") === true
  const newToken = rotate || !hasTokenSecret(deployment.workerName, env) ? randomBytes(32).toString("base64url") : null

  step(`Deploying the worker ${bold(deployment.workerName)}`)
  const deployArgs = ["deploy", "--message", `lotion-share ${readPackageVersion()}`]
  let secretsDir
  if (newToken) {
    // Uploaded with this version, from a file only this user can read, deleted right after.
    secretsDir = mkdtempSync(join(tmpdir(), "lotion-share-"))
    const secretsFile = join(secretsDir, "secrets.json")
    writeFileSync(secretsFile, JSON.stringify({ LOTION_TOKEN: newToken }), { mode: 0o600 })
    deployArgs.push("--secrets-file", secretsFile)
  }
  let output
  try {
    output = cf(deployArgs, { env, json: false, inherit: true })
  } finally {
    if (secretsDir) rmSync(secretsDir, { recursive: true, force: true })
  }

  const url = /https:\/\/[\w.-]+\.workers\.dev/.exec(output ?? "")?.[0] ?? deployment.url
  if (url) deployment.url = url
  writeDeployment(deployment)

  console.log(`\n${green("✓")} ${bold(previous ? "Lotion Share is up to date." : "Lotion Share is deployed.")}\n`)
  console.log(`  Worker URL  ${bold(url ?? "(see the deploy output above)")}`)
  if (newToken) {
    console.log(`  Token       ${bold(newToken)}`)
    console.log(dim("              Shown once. Paste it into Lotion now; it isn't saved anywhere else."))
  } else {
    console.log(`  Token       ${dim("unchanged — run `pnpm run deploy -- --rotate-token` for a new one")}`)
  }
  console.log(`\nIn Lotion: Settings → Cloud → paste the URL and token → Verify connection.`)
  if (!previous) {
    console.log(dim(`\nIn a fork, commit lotion.deploy.json (git add -f) so the next deploy reuses these resources.`))
  }
}

function readPackageVersion() {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version
}

switch (command) {
  case "deploy":
    deploy()
    break
  case "migrate":
    if (option("local") === true) {
      migrateLocal()
    } else {
      const deployment = readDeployment()
      if (!deployment?.databaseId) fail("There's no deployment yet.", "Run `pnpm run deploy` first.")
      cf(["d1", "migrations", "apply", deployment.databaseId, "--dir", "drizzle"], {
        env: { CLOUDFLARE_ACCOUNT_ID: deployment.accountId },
        json: false,
        inherit: true,
      })
    }
    break
  default:
    fail(`Unknown command: ${command}`, "Use `deploy` or `migrate`.")
}
