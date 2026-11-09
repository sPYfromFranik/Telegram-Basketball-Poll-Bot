# Тестування

## Автоматичні перевірки

```powershell
npm install
npm run typecheck
npm test
npm run build
```

Очікувано: TypeScript завершується без помилок; Vitest показує `3 passed` і `28 passed`; Wrangler завершує dry run та показує розмір bundle.

Тести охоплюють Kyiv DST, понеділок/середу й формат дати; 18 основних та резерв; вихід, повторний вступ, відкликання, підвищення; дублікати й події не за порядком; пороги 9/10/21; HTML/ID mentions; malformed updates; повтори transient Telegram failures та відсутність повтору permanent failures.

## Локальна D1 та Worker

```powershell
npm run db:migrate:local
Copy-Item .dev.vars.example .dev.vars
# Вкажіть лише тестові значення у .dev.vars
npm run dev
```

В іншому терміналі:

```powershell
Invoke-RestMethod http://localhost:8787/health
```

Очікувано: `ok = True`. Справжній Telegram webhook не може викликати `localhost`; для інтеграційного тесту розгорніть Worker і використовуйте `/create_poll`.

## Ручний сценарій приймання

1. Організатор надсилає `/create_poll`; другий виклик не створює дубль.
2. 18 різних акаунтів голосують «Буду»; `/status` показує 18 основних.
3. Дев'ятнадцятий голосує «Буду»; отримує в групі згадку з резервом №1.
4. Один з основних змінює голос; резерв №1 переходить в основу, група отримує одну заміну.
5. Перевірте `/history` як організатор і відмову для іншого користувача.
6. `/close_poll` закриває poll і один раз ставить підсумок в outbox.
7. Голос після deadline не приймається до D1 навіть якщо Telegram update затримався.

## Моделювання помилок

Telegram виклики інкапсульовані в `TelegramClient`; передайте mock `fetch` із відповідями 500/429 для перевірки retry або 403 для private fallback. Для перевірки outbox тимчасово заблокуйте бота тестовим користувачем: private delivery стане `failed`, а груповий fallback — новим outbox item.

Офіційні деталі структури `PollAnswer`, включно з порожнім `option_ids`, наведено в [Telegram Bot API](https://core.telegram.org/bots/api#pollanswer).
