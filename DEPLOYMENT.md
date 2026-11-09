# Розгортання на Cloudflare Workers (Windows 11)

Ця інструкція не потребує VPS, увімкненого ПК чи власного домену. Після розгортання Telegram викликає `workers.dev`, а Cloudflare Cron періодично виконує звірку. Команди запускайте у PowerShell 7 з кореня проєкту.

## 1. Передумови

Встановіть Git, актуальну LTS-версію Node.js (не нижче 20) та PowerShell 7:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Microsoft.PowerShell -e
node --version
npm --version
git --version
```

Успіх: усі три команди версій повертають номер без помилки. Cloudflare також вказує Node.js як передумову в [офіційному D1 quick start](https://developers.cloudflare.com/d1/get-started/).

У каталозі проєкту:

```powershell
npm install
npm run typecheck
npm test
npm run build
```

Успіх: усі tests passed, TypeScript без помилок, Wrangler показує `--dry-run: exiting now`.

## 2. Створення Telegram-бота

1. В Telegram відкрийте лише офіційний [@BotFather](https://t.me/BotFather).
2. Надішліть `/newbot`, задайте ім'я та username, який завершується на `bot`.
3. BotFather покаже token на кшталт `123456789:AA...`. Це **реальний секрет**: не вставляйте його у код, `wrangler.toml`, Git, issue або повідомлення чату. Збережіть у password manager.
4. За бажанням виконайте `/setcommands` і вставте:

```text
start - довідка
help - довідка
status - склад і резерв
my_status - мій статус
schedule - налаштувати щотижневе голосування
disable_poll - вимкнути автоматичні голосування
history - історія для організатора
create_poll - створити poll вручну
close_poll - закрити poll
reconcile - звірити стан
```

## 3. Додавання в групу та дозволи

Додайте бота до наявної групи. Він має мати право **надсилати повідомлення** і **створювати опитування**. У групі з жорсткими обмеженнями найпростіше зробити його адміністратором лише з цими правами; видалення, бан, керування користувачами та закріплення не потрібні. Бот закриває власне poll через `stopPoll`.

Privacy Mode можна залишити ввімкненим: slash-команди надходять боту, а `poll_answer` для створеного ним неанонімного poll надходить незалежно. Telegram прямо зазначає, що bots receive votes лише для polls, надісланих самим ботом, у [PollAnswer docs](https://core.telegram.org/bots/api#pollanswer).

## 4. Як дізнатися chat ID та user ID

Зробіть це **до** реєстрації webhook. У приватному чаті надішліть боту `/start`, а в групі — `/help`. Потім у PowerShell без виведення token на екран:

```powershell
$secureToken = Read-Host 'Telegram bot token' -AsSecureString
$botToken = ConvertFrom-SecureString $secureToken -AsPlainText
$updates = Invoke-RestMethod "https://api.telegram.org/bot$botToken/getUpdates"
$updates.result | ConvertTo-Json -Depth 10
```

У приватному `message.from.id` — ваш `ORGANIZER_USER_ID`. У груповому `message.chat.id` — `TELEGRAM_CHAT_ID`; для supergroup він зазвичай починається з `-100`. Збережіть обидва значення. Якщо `result` порожній, надішліть нові slash-команди й повторіть. Після `setWebhook` метод `getUpdates` недоступний — це обмеження [Telegram webhook API](https://core.telegram.org/bots/api#setwebhook).

Очистіть token із процесу після налаштування:

```powershell
Remove-Variable botToken,secureToken -ErrorAction SilentlyContinue
```

## 5. Вхід у Cloudflare та створення D1

```powershell
npx wrangler login
```

Відкриється браузер. Успіх: `Successfully logged in`.

```powershell
npm run db:create
```

Успіх: Wrangler повертає `database_name` і UUID `database_id`. У `wrangler.toml` замініть нульовий UUID у `database_id` на цей UUID. Binding мусить залишитися `DB`.

Застосуйте schema до remote D1:

```powershell
npm run db:migrate:remote
```

Успіх: усі міграції `0001`–`0004` мають статус success/✅. Локально команда `npm run db:migrate:local` створює окрему тестову базу.

## 6. Secrets і конфігурація

Згенеруйте webhook secret лише з дозволених Telegram символів:

```powershell
$webhookSecret = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

Запишіть чотири значення. Wrangler запитає або прийме значення зі stdin і не додає їх до Git:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put ORGANIZER_USER_ID
```

На кожен prompt вставте відповідне реальне значення. `TELEGRAM_BOT_TOKEN` і `TELEGRAM_WEBHOOK_SECRET` — секрети; ID не є token, але теж зберігаються як secrets, щоб не комітити приватні ідентифікатори. Перевірити лише імена, не значення:

```powershell
npx wrangler secret list
```

Несекретні defaults уже в `wrangler.toml`: `Europe/Kyiv`, 18, 10, `Католицький`, `20:30`. Змініть їх там, якщо потрібно. `TIMEZONE` має бути IANA zone, а не UTC offset. Також замініть нульовий placeholder `database_id` на ID, який повернула команда `npm run db:create`.

Параметри конкретного щотижневого голосування можна задати без редагування конфігурації:

```text
/schedule 10.11.2026 12:00 12.11.2026 11:55 --location "Назва залу" --game-date 12.11.2026 --game-time 20:30 --max 18 --min 10
```

Якщо їх пропустити, бот використає `POLL_LOCATION`, дату закриття голосування, `GAME_TIME`, `MAX_PLAYERS` і `MIN_PLAYERS`. `/schedule_poll` залишається сумісним аліасом.

## 7. Deploy на workers.dev

```powershell
npm run deploy
```

Успіх: Wrangler виведе URL на кшталт `https://basketball-attendance-bot.<subdomain>.workers.dev`. Збережіть його як `WORKER_URL` без `/webhook`.

```powershell
$workerUrl = 'https://basketball-attendance-bot.YOUR_SUBDOMAIN.workers.dev'
Invoke-RestMethod "$workerUrl/health"
```

Успіх: `{ ok: true, service: basketball-attendance-bot }`. Endpoint не показує IDs, secrets або стан бази.

## 8. Реєстрація webhook

У новій PowerShell-сесії без literal token в історії:

```powershell
$secureToken = Read-Host 'Telegram bot token' -AsSecureString
$env:TELEGRAM_BOT_TOKEN = ConvertFrom-SecureString $secureToken -AsPlainText
$env:TELEGRAM_WEBHOOK_SECRET = $webhookSecret
$env:WORKER_URL = $workerUrl
npm run webhook:set
npm run webhook:info
```

Успіх: `setWebhook` повертає `ok: true`; info має правильний URL, `pending_update_count: 0` (або число, що зменшується), `max_connections: 1`, allowed updates `message` і `poll_answer`, без `last_error_message`. Скрипт задає `drop_pending_updates: false`, тому навмисно не викидає накопичені updates. Header перевіряється Worker-ом згідно з [Telegram `secret_token` docs](https://core.telegram.org/bots/api#setwebhook).

Приберіть secrets із середовища:

```powershell
Remove-Item Env:TELEGRAM_BOT_TOKEN,Env:TELEGRAM_WEBHOOK_SECRET -ErrorAction SilentlyContinue
Remove-Variable secureToken -ErrorAction SilentlyContinue
```

## 9. Тест без очікування понеділка

1. В групі організатор надсилає `/create_poll`.
2. Має з'явитися poll з точною назвою поточного тижня. Повторіть команду: другого poll бути не повинно.
3. Проголосуйте й виконайте `/status` та `/my_status`.
4. Для тесту >18 потрібні 19 різних Telegram users: попросіть учасників або використайте окрему тестову групу. Не створюйте фальшиві акаунти всупереч правилам Telegram. Дев'ятнадцятий має стати резервом №1.
5. Дев'ятнадцятий учасник має отримати згадку в групі з позицією в резерві.
6. Нехай один із перших 18 змінить вибір на «Не буду»: резерв №1 має бути підвищений, повідомлення — одне.
7. `/close_poll` перевіряє закриття і final summary зараз. У production native `close_date` закриває poll о 11:55 Kyiv, а Cron `stopPoll` є fallback.

Щоб перевірити саме середовищну логіку середи без зміни production часу, використовуйте автоматичні DST/time тести. Не ставте `close_deadline` вручну у production D1. Для staging можна створити окремий Worker/D1 або тимчасово змінити тестову копію коду.

## 10. Logs, діагностика та оновлення

Live logs:

```powershell
npm run logs
```

Потім надішліть `/status`. Успіх — HTTP 200 без `webhook processing failed`. Логи навмисно не містять token або повних update payloads.

Оновлення:

```powershell
git pull
npm install
npm run typecheck
npm test
npm run db:migrate:remote
npm run deploy
```

Webhook URL не треба реєструвати знову, якщо workers.dev URL не змінився.

Типові помилки:

- `401 Unauthorized` на `/webhook`: `secret_token` в Telegram не збігається з Worker secret; повторіть `secret put`, deploy і `webhook:set`.
- `database not found` / binding error: неправильний UUID або не застосовані migrations.
- `Forbidden: bot was blocked by the user`: очікувано для private message; outbox створює group fallback.
- Poll не створюється: перевірте bot permission «Send polls», chat ID, `/history` не допоможе до створення; дивіться `wrangler tail`.
- Команда organizer заборонена: `ORGANIZER_USER_ID` — це `from.id`, не username і не chat ID.
- `pending_update_count` росте: перевірте `/health`, webhook info `last_error_message`, secret та логи.
- Cron не з'явився одразу: propagation Cron changes може зайняти кілька хвилин; `/reconcile` виконує ту саму recovery logic.
- D1 free-tier exceeded: запити відновляться після reset опівночі UTC; перевірте Metrics.

## 11. Backup і відновлення

Створіть каталог поза Git або переконайтеся, що backup не комітиться:

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
npx wrangler d1 export basketball-attendance --remote --output "backups\basketball-$(Get-Date -Format yyyyMMdd-HHmmss).sql"
```

Успіх: Wrangler підтверджує export, а `.sql` існує. Файл містить Telegram IDs та імена — зберігайте приватно. Імпорт у **окрему** recovery database:

```powershell
npx wrangler d1 create basketball-attendance-recovery
npx wrangler d1 execute basketball-attendance-recovery --remote --file .\backups\YOUR_BACKUP.sql
```

Не імпортуйте поверх production без окремого плану відновлення. Див. [офіційний D1 import/export guide](https://developers.cloudflare.com/d1/best-practices/import-export-data/) та D1 Time Travel у dashboard.

## 12. Free plan usage

Для однієї малої групи навантаження на порядки нижче квот. Станом на 6 листопада 2026 офіційні ліміти Free: Workers 100,000 requests/day і 10 ms CPU/invocation; D1 5 million rows read/day, 100,000 rows written/day, 5 GB total storage та 500 MB/database. Cron кожні п'ять хвилин — 288 invocations/day. Див. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) і [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

У Cloudflare Dashboard відкрийте Workers & Pages → ваш Worker → Metrics та Storage & Databases → D1 → basketball-attendance → Metrics. Для query hot spots:

```powershell
npx wrangler d1 insights basketball-attendance --sort-by=writes --time-period=1d
```

## Фінальний checklist

- [ ] `npm run typecheck`, `npm test`, `npm run build` успішні.
- [ ] Bot створений через офіційний BotFather; token лише в password manager/secret.
- [ ] Bot у потрібній групі й може писати та створювати polls.
- [ ] Chat ID і organizer user ID перевірені.
- [ ] Wrangler login успішний; D1 створена; UUID замінено в `wrangler.toml`.
- [ ] Remote migration застосована.
- [ ] Чотири Worker secrets існують.
- [ ] Deploy повернув workers.dev URL; `/health` відповідає OK.
- [ ] Webhook info правильний, без last error.
- [ ] `/create_poll`, duplicate prevention, `/status`, waiting list і promotion перевірені.
- [ ] Повідомлення про резерв і підвищення з'являються в групі.
- [ ] `/close_poll` створив один final summary.
- [ ] `wrangler tail` чистий; backup export перевірений.
