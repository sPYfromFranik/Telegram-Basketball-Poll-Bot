# Telegram basketball attendance bot

Production-oriented Telegram attendance bot for a recurring basketball game. It runs entirely on Cloudflare Workers + D1, publishes a non-anonymous poll on a configurable schedule, maintains a configurable number of confirmed places and an ordered waiting list, and sends a final decision to the organizer. No VPS, always-on computer, or custom domain is required.

## What is included

- Strict TypeScript Worker with `/health` and secret-protected `/webhook` endpoints.
- D1 transactional ingestion, `update_id` deduplication, monotonic per-user ordering, immutable vote history, active-application sequence, queue reconciliation lock, and durable notification outbox.
- Native Telegram `close_date` plus periodic Cron reconciliation and `stopPoll` fallback.
- Commands: `/start`, `/help`, `/status`, `/my_status`, and organizer-only `/schedule`, `/disable_poll`, `/history`, `/create_poll`, `/close_poll`, `/reconcile`.
- Group waiting/promotion messages and ID-based HTML mentions when no username exists.
- Kyiv DST-safe scheduling based on `Intl` and the IANA `Europe/Kyiv` zone.
- Automated tests, a strict compiler check, and a Wrangler dry-run build.

## Deploy your own bot

### 1. Prerequisites

You need:

- a [Telegram](https://telegram.org/) account;
- a free [Cloudflare](https://dash.cloudflare.com/sign-up) account;
- [Git](https://git-scm.com/downloads) and Node.js 20 or newer;
- PowerShell 7 for the commands below. On Linux or macOS, use equivalent shell environment-variable syntax.

Clone the repository and install its dependencies:

```powershell
git clone https://github.com/sPYfromFranik/Telegram-Basketball-Poll-Bot.git
Set-Location Telegram-Basketball-Poll-Bot
npm install
npm test
npm run typecheck
npm run build
```

### 2. Create the Telegram bot

1. Open the official [@BotFather](https://t.me/BotFather) account and run `/newbot`.
2. Save the token securely. Never add it to this repository or `wrangler.toml`.
3. Add the new bot to your Telegram group and allow it to send messages and create polls.
4. Before registering a webhook, send `/start` to the bot privately and `/help` in the group.
5. Read the resulting updates to find the organizer user ID and group chat ID:

```powershell
$secureToken = Read-Host 'Telegram bot token' -AsSecureString
$botToken = ConvertFrom-SecureString $secureToken -AsPlainText
$updates = Invoke-RestMethod "https://api.telegram.org/bot$botToken/getUpdates"
$updates.result | ConvertTo-Json -Depth 10
Remove-Variable botToken,secureToken
```

Use the private message's `message.from.id` as `ORGANIZER_USER_ID` and the group message's `message.chat.id` as `TELEGRAM_CHAT_ID`.

### 3. Create the Cloudflare D1 database

Sign in and create the database:

```powershell
npx wrangler login
npm run db:create
```

Copy the returned `database_id` into the `[[d1_databases]]` section of `wrangler.toml`, replacing `00000000-0000-0000-0000-000000000000`. Then apply the schema:

```powershell
npm run db:migrate:remote
```

The non-secret defaults in `wrangler.toml` may be customized before deployment:

- `TIMEZONE`: an IANA time zone, for example `Europe/Kyiv`;
- `POLL_LOCATION`: default venue;
- `GAME_TIME`: default game time;
- `MAX_PLAYERS` and `MIN_PLAYERS`: default attendance limits.

### 4. Store secrets and deploy

Generate a webhook secret, then let Wrangler store all four values. Wrangler prompts for each value without adding it to Git:

```powershell
$webhookSecret = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put ORGANIZER_USER_ID
npm run deploy
```

Enter the generated `$webhookSecret` when prompted for `TELEGRAM_WEBHOOK_SECRET`. Save the `https://...workers.dev` URL printed by the deploy command and verify it:

```powershell
$workerUrl = 'https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev'
Invoke-RestMethod "$workerUrl/health"
```

### 5. Register the Telegram webhook

The included script registers `/webhook`, restricts Telegram updates to messages and poll answers, and uses the secret header checked by the Worker:

```powershell
$secureToken = Read-Host 'Telegram bot token' -AsSecureString
$env:TELEGRAM_BOT_TOKEN = ConvertFrom-SecureString $secureToken -AsPlainText
$env:TELEGRAM_WEBHOOK_SECRET = $webhookSecret
$env:WORKER_URL = $workerUrl
npm run webhook:set
npm run webhook:info
Remove-Item Env:TELEGRAM_BOT_TOKEN,Env:TELEGRAM_WEBHOOK_SECRET,Env:WORKER_URL
Remove-Variable secureToken,webhookSecret,workerUrl
```

The setup is complete when `webhook:info` reports the expected URL without a `last_error_message`. In the group, the organizer can now configure the recurring poll:

```text
/schedule 10.11.2026 12:00 12.11.2026 11:55 --location "Main court" --game-date 12.11.2026 --game-time 20:30 --max 18 --min 10
```

Dates in that command are examples—replace them with future dates. Run `/create_poll` to create the configured poll immediately, or wait for its scheduled opening time.

For troubleshooting, backups, production checks, and a suggested BotFather command list, see [DEPLOYMENT.md](DEPLOYMENT.md). For validation scenarios, see [TESTING.md](TESTING.md).

## Local development

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm test
npm run typecheck
npm run build
npm run dev
```

Do not put real secrets in `wrangler.toml`, source files, commits, issues, or chat. `.dev.vars` is ignored and is only for local development. Use `wrangler secret put` for deployed secrets.

The local `.dev.vars` file is ignored by Git. Replace its example values only on your own machine.

## Scheduling

`/schedule` (with `/schedule_poll` retained as an alias) accepts the poll opening and closing times, followed by optional game settings:

```text
/schedule 10.11.2026 12:00 12.11.2026 11:55 --location "Main court" --game-date 12.11.2026 --game-time 20:30 --max 18 --min 10
```

The five game settings may also be supplied positionally in this order: location, game date, start time, maximum players, minimum players. Quote a location containing spaces. Omitted settings fall back to `POLL_LOCATION` (default `Католицький`), the poll closing date, `GAME_TIME` (default `20:30`), `MAX_PLAYERS` (default `18`), and `MIN_PLAYERS` (default `10`). Each created poll stores its own limits, so later schedule edits do not alter its confirmed list, waiting list, or final booking decision.

## Reliability model and limitations

Telegram `poll_answer` contains the chosen options but no vote timestamp; empty `option_ids` means retraction. Accordingly, the database records when this Worker durably processed the update—not the authoritative moment of the tap. The application sequence is a D1 `AUTOINCREMENT` value and is therefore deterministic even when recorded timestamps match.

Each accepted update is inserted with a unique processing token, and every mutation in the same D1 `batch()` is gated by that token. D1 batches are transactional. A larger `update_id` wins for a user's current state, so late delivery of an older update cannot overwrite newer state. `max_connections=1` reduces concurrency but is not treated as an ordering guarantee.

The outbox prevents deliberate duplicate notifications and retries failures. Telegram has no general idempotency key for `sendMessage`, so a crash after Telegram accepts a message but before D1 records `sent` can still produce a duplicate on retry. Conversely, Telegram cannot replay indefinitely after prolonged downtime. These are unavoidable external-delivery limits.

The source of truth is the received `poll_answer` stream. Telegram Bot API does not offer a method to download every individual voter of an existing poll, so `/reconcile` can rebuild derived queue state from persisted events, but cannot reconstruct updates Telegram never delivered.

## Official references

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Cloudflare D1 Worker API and transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
