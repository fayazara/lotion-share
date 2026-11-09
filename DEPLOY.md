# Deploying Lotion Share

These are the steps for a coding agent (Claude Code, Codex, OpenCode, …)
setting up Lotion Share on its user's own Cloudflare account, or updating a
copy that's already deployed. Follow them in order. Each step says what to do
if something goes wrong.

Lotion Share is a Cloudflare Worker that publishes notes from the
[Lotion](https://github.com/fayazara/Lotion) Mac app. Published notes go in a
D1 database, and their images and files go in an R2 bucket. The app talks to the
worker with one shared token, kept as a Worker secret.

Everything runs on the **user's** account, and on the Workers free plan.

## 0. Is this a new setup or an update?

- If you're inside a clone of this repo and `lotion.deploy.json` exists, this is
  an **update**. Go to [Updating](#updating).
- Otherwise it's a **new setup**. Start at step 1.

## 1. Get the code

Requirements: `git`, Node.js 20 or newer, and `pnpm` (if it's missing, run
`corepack enable`, or `npm install -g pnpm`).

Ask the user whether they want a **fork** on their GitHub account (recommended:
their deployment's settings get committed, and updating is a merge) or just a
local **clone**.

**Fork**, with the GitHub CLI (`gh`):

```bash
gh repo fork fayazara/lotion-share --clone
cd lotion-share
```

`gh` names the user’s fork `origin` and this template `upstream`.

**Clone**, with no GitHub account needed:

```bash
git clone https://github.com/fayazara/lotion-share.git
cd lotion-share
git remote rename origin upstream
```

Either way, `upstream` must point at `https://github.com/fayazara/lotion-share`.
Check with `git remote -v`. Updates come from there.

## 2. Install

```bash
pnpm install
```

## 3. Sign in to Cloudflare

```bash
pnpm exec cf auth whoami
```

If this doesn't show `"authenticated": true`, ask the user to run
`pnpm exec cf auth login` themselves (it opens a browser), then check again. If
they don't have a Cloudflare account yet, the sign-in page lets them make one,
free.

## 4. Deploy

```bash
pnpm run deploy
```

This one command does everything, and is safe to run again:

- creates the D1 database and R2 bucket (or reuses them if they exist)
- writes their names and IDs to `lotion.deploy.json`
- applies the database migrations
- creates a random token and saves it as the Worker secret `LOTION_TOKEN`
- deploys the worker and prints its URL and the token

Options:

- `-- --name <worker-name>`: on the first run only, to call the worker
  something other than `lotion-share`. The name becomes part of its URL.
- `-- --account <account-id>`: if the login has more than one account, the
  script stops and lists them. **Ask the user which one to use**, then run again
  with this option. It's remembered after that.

Use `pnpm run deploy`. `pnpm deploy` is a different, built-in pnpm command.

If a step fails, read the error. Most failures are one of these:

| Error | What to do |
| --- | --- |
| Not signed in | Step 3. |
| More than one account | Ask the user, then pass `--account`. |
| A `workers.dev` subdomain isn't set up | Ask the user to open Workers & Pages in the Cloudflare dashboard once, which sets one up, then run again. |
| A name is taken | Run again with `-- --name <another-name>` (first run only), or edit the names in `lotion.deploy.json`. |

## 5. Hand over the URL and token

The script ends by printing:

```
  Worker URL  https://lotion-share.<subdomain>.workers.dev
  Token       <a long random string>
```

Give both to the user and tell them:

> In Lotion, open **Settings → Cloud**, paste the Worker URL and the token,
> and click **Verify connection**.

The token is shown only once and isn't saved anywhere on disk. Don't write it
to a file, a commit or a log. If it's lost, make a new one with
`pnpm run deploy -- --rotate-token`; the old one stops working.

## 6. Save the deployment (forks)

If the user has a fork, commit `lotion.deploy.json` and push:

```bash
git add -f lotion.deploy.json
git commit -m "Add my Lotion Share deployment"
git push origin main
```

It holds only names and IDs, no secrets. The template ignores this file (hence
`-f`) and never ships one, so updates won’t conflict with it.

## Updating

When Lotion says the worker is out of date, or the user asks to update:

```bash
git fetch upstream
git merge upstream/main
pnpm install
pnpm run deploy
```

If the merge has conflicts, keep the user's `lotion.deploy.json` and any
changes they've made deliberately, and take upstream's version of everything
else. If the user has a fork, push afterwards (`git push origin main`).

`pnpm run deploy` applies new migrations and redeploys. It keeps the existing
token, so Lotion stays connected. There's nothing to paste again.

## Optional: a custom domain

To publish notes under the user's own domain (it must already be on their
Cloudflare account), add a route in `cloudflare.config.ts` under
`worker.triggers`. Look up the current syntax in the Cloudflare docs for
`cloudflare.config.ts`. Then run `pnpm run deploy` and give the user the new
URL to paste into Lotion.

## What's deployed

| Resource | Name | Holds |
| --- | --- | --- |
| Worker | `lotion-share` | the API and the published pages |
| D1 database | `lotion-share-db` | published notes |
| R2 bucket | `lotion-share-files` | their images, files, covers and icons |
| Secret | `LOTION_TOKEN` | the shared token |

To remove everything, delete those from the Cloudflare dashboard.
