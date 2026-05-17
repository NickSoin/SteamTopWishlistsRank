# Steam Wishlist Rank — Project Status & Architecture

**Version:** 2.4.0  
**Last updated:** 2026-05-16

---

## Что делает проект

Chrome-расширение, которое показывает на странице Steam-игры её позицию в топе вишлистов (Steam Popular Wishlisted). Для **вышедших** игр показывает пиковую позицию до релиза; для **ещё не вышедших** — текущую позицию.

---

## Архитектура

```
GitHub Actions (every 6h)
  └─ scripts/update-feed.js
        ├─ Scrapes Steam search (popularwishlist, top 10k)
        ├─ Updates data/wishlist-ledger.json
        └─ Writes docs/v2/ shards (256 files per category)
              ├─ current/00.json … ff.json   (upcoming games)
              └─ pre-release/00.json … ff.json (released games, peak rank)

Python scraper (local, wishlist-history/)
  └─ Reads Wayback Machine CDX API + SteamDB snapshots
        └─ Writes historical data directly to docs/v2/pre-release/
           (461k observations, ~6,267 games, 2018–2026)

GitHub Pages
  └─ nicksoin.github.io/SteamTopWishlistsRank/v2/
        ├─ meta.json
        ├─ current/{shard}.json
        └─ pre-release/{shard}.json

Chrome Extension (dist/unpacked/ — loaded locally)
  ├─ background.js   Service worker: fetch shards, cache in chrome.storage
  ├─ content-steam.js  Inject rank row on Steam app pages
  ├─ popup.html/js   Extension popup with stats
  └─ feed-config.js  URL: nicksoin.github.io/SteamTopWishlistsRank/v2
```

---

## Ключевые правила / логика

### Shard ID
- `FNV1a32(appId) & 0xFF` → hex string 2 символа ("00"…"ff")
- 256 шардов, реализовано в `src/shared.js → getShardId()`

### Режим отображения (content-steam.js)
```javascript
const mode = isReleasedPage() ? "preRelease" : "current";
// isReleasedPage() = нет .game_area_comingsoon на странице
```
- **upcoming** игра → mode `"current"` → читает `current/` шарды → лейбл "Top Wishlisted:"
- **released** игра → mode `"preRelease"` → читает `pre-release/` шарды → лейбл зависит от source

### Лейблы для pre-release записей
```javascript
function getRowLabel(entry) {
  if (mode === "current") return "Top Wishlisted:";
  if (entry?.source === "tracked") return "On-Release Top Wish:";
  return "Peak TopWish tracked:";
}
```
- `source === "tracked"` — игра отслеживалась живьём нашим GitHub Action до релиза
- всё остальное (historical, hosted_v2_shard) — исторические данные из Wayback

### Источники данных в шардах (поле `source`)
| Значение | Откуда | Лейбл |
|---|---|---|
| `"tracked"` | GitHub Action (ledger) | "On-Release Top Wish:" |
| `"historical"` | Python scraper | "Peak TopWish tracked:" |
| отсутствует | Python scraper (старые) | "Peak TopWish tracked:" (fallback) |

### Кэш в Chrome Extension
- `SHARD_CACHE_PREFIX = "steam_wishlist_rank_shard_cache_v4"` (background.js)
- `META_CACHE_KEY = "steam_wishlist_rank_meta_cache_v4"` (background.js)
- TTL: 4 часа
- Для сброса кэша — поменять суффикс (v3→v4) при следующей необходимости

### Merge стратегия (update-feed.js)
```javascript
mergedPreReleaseShards[shardId] = { ...existing, ...preReleaseShards[shardId] };
// existing = исторические данные из файла на диске (Wayback)
// preReleaseShards = живые данные из ledger
// live перезаписывает historical для одного appId
```
**Важно**: GitHub Action читает исторические шарды из репозитория и мержит с live-данными.  
Без этого Action стирал бы 6,267 исторических записей каждые 6 часов.

### normalizeSteamDate (shared.js)
Поддерживает ОБА формата:
- `"23 Aug, 2018"` — Steam search page HTML (day-first)
- `"Nov 20, 2024"` — Steam appdetails API (month-first)

---

## Файлы проекта

| Файл | Роль |
|---|---|
| `scripts/update-feed.js` | GitHub Actions: скрейп + шарды |
| `src/shared.js` | Утилиты (shared между extension и Node.js) |
| `src/background.js` | Service worker: fetch + cache |
| `src/content-steam.js` | UI: инжект строки на Steam pages |
| `src/popup.html` + `popup.js` | Попап расширения |
| `src/feed-config.js` | URL конфиг (GitHub Pages) |
| `manifest.json` | Chrome extension manifest (корень) |
| `dist/unpacked/` | Копия для локальной загрузки в Chrome |
| `dist/steam-wishlist-rank-2.4.0.zip` | Zip для Chrome Web Store |
| `docs/v2/meta.json` | Метаданные фида (entryCount и пр.) |
| `docs/v2/current/*.json` | 256 шардов: текущие топ-вишлисты |
| `docs/v2/pre-release/*.json` | 256 шардов: исторические + tracked |
| `data/wishlist-ledger.json` | Ledger: состояние всех отслеживаемых игр |
| `data/wishlist-ledger-meta.json` | Метаданные ledger (trackingSince) |
| `wishlist-history/` | Python scraper (локальный, не в git) |
| `.github/workflows/update-feed.yml` | GitHub Action (cron every 6h) |

---

## GitHub Action (update-feed.yml)

```yaml
schedule: "17 */6 * * *"   # каждые 6 часов
trigger: push to main (только при изменении скрипта или shared.js)
```

**Что делает:**
1. Scrapes Steam Popular Wishlisted (top 10,000)
2. Обновляет `data/wishlist-ledger.json` — проверяет релизы через Steam API
3. Пишет `docs/v2/current/` и `docs/v2/pre-release/` (с merge!)
4. Пишет `docs/v2/meta.json`
5. Коммитит и пушит

**Критично:** `git pull --rebase origin main` — ПОСЛЕ `git commit`, ПЕРЕД `git push`.

---

## Python Scraper (wishlist-history/)

**Не в git.** Локальный инструмент для парсинга Wayback Machine.

- SQLite база: ~461k наблюдений, ~8,123 уникальных игр
- Команды: `scrape`, `build_shards`, `recheck-released`
- `recheck-released` — переразбирает raw даты без API вызовов (быстро)
- `build_shards` — пишет напрямую в `docs/v2/pre-release/` + обновляет `meta.json`
- **Формат дат**: поддерживает оба формата (`"Nov 20, 2024"` и `"23 Aug, 2018"`)

---

## Текущее состояние данных

| Метрика | Значение |
|---|---|
| Текущих upcoming игр в топе | ~4,614 |
| Released отслеживаемых (ledger) | ~12 |
| Исторических pre-release записей | **6,267** (Wayback, 2018–2026) |
| Tracking since | 2026-05-15 |
| Шардов (на категорию) | 256 |
| GitHub Pages URL | nicksoin.github.io/SteamTopWishlistsRank/v2 |

---

## Синхронизация dist/unpacked

Пользователь загружает расширение локально из `dist/unpacked/`.  
**При изменении любого src/* файла нужно:**

```bash
cp src/background.js dist/unpacked/src/background.js
cp src/shared.js dist/unpacked/src/shared.js
cp src/content-steam.js dist/unpacked/src/content-steam.js
cp src/popup.js dist/unpacked/src/popup.js
cp src/popup.html dist/unpacked/src/popup.html
cp src/feed-config.js dist/unpacked/src/feed-config.js
```

После синхронизации — перезагрузить расширение в `chrome://extensions` (кнопка ↻).

**Zip для стора:**
```bash
cd dist/unpacked && zip -r ../steam-wishlist-rank-2.4.0.zip .
```

---

## Известные особенности / Not bugs

- **Несколько снапшотов в день**: Wayback Machine мог сохранять до 14 копий в день. Разные игры могут иметь одинаковый rank+date — это нормально, не баг.
- **All Will Fall (#11), Olden Era (#1)**: корректные данные — они реально были там в момент снапшота.
- **GitHub Action и конфликты**: Action использует `git pull --rebase` перед пушем. При конфликте — `git reset --hard origin/main` → пересобрать → сразу push.

---

## История исправлений (текущая сессия)

| Дата | Что | Где |
|---|---|---|
| 2026-05-16 | Fix parse_steam_date: US format "Nov 20, 2024" | scraper.py |
| 2026-05-16 | recheck_released: переразобрал 6,439 дат без API | scraper.py |
| 2026-05-16 | Merge pre-release shards вместо перезаписи | update-feed.js |
| 2026-05-16 | preReleaseEntryCount считается из merged, не ledger | update-feed.js |
| 2026-05-16 | source:"tracked" в shard entries из ledger | update-feed.js |
| 2026-05-16 | getRowLabel() + buildShellRow(entry) | content-steam.js |
| 2026-05-16 | Popup: строка "Historical pre-release records" | popup.html/js |
| 2026-05-16 | Cache keys v2→v3 (инвалидация стале кэша) | background.js |
| 2026-05-16 | normalizeSteamDate: поддержка обоих форматов дат | shared.js |
| 2026-05-16 | git pull --rebase перед push в Action | update-feed.yml |
| 2026-05-16 | Bump version 2.2→2.3→2.4 | manifest.json, package.json |
