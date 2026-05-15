# Steam Wishlist Rank

Chrome extension that adds a wishlist rank row to Steam app pages.

## Original Task

The goal was to build a Chrome extension for people who work with Steam games and
want to see wishlist position directly on Steam store pages. The requested UI was
to place the data in the same metadata block as `All Reviews` and `Release Date`,
preferably immediately after `All Reviews`.

The requested values were:

- rank in `Top Wishlisted`;
- estimated wishlist count in a compact format such as `200k+`;
- estimate bands parsed from the supplied reference image.

The target display format is:

```text
TOP WISHLISTED:  #2378 (7k+ wishlists)
```

## What Was Built

The extension is a Manifest V3 Chrome extension. On Steam app pages it inserts a
new metadata row after the reviews block:

```text
Top Wishlisted: #5 (1.5m+ wishlists)
```

It works on URLs like:

```text
https://store.steampowered.com/app/1962700/Subnautica_2/
```

## Wishlist Estimates

Wishlist counts are estimates from the rank bands supplied in the project image:

| Position | Estimate |
| --- | --- |
| Top 1 | 4m+ |
| Top 10 | 1.5m+ |
| Top 50 | 600k+ |
| Top 100 | 300k+ |
| Top 200 | 200k+ |
| Top 500 | 80k+ |
| Top 1000 | 40k+ |
| Top 1500 | 25k+ |
| Top 2000 | 15k+ |
| Top 3000 | 7k+ |

Ranks after `Top 3000` use `<7k` because the supplied estimate table stops at
that point.

## Local Install

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select `dist/unpacked` after building, or the project root during development.

## Hosted Feed Architecture

The first implementation used SteamDB as the data source because the brief
mentioned `https://steamdb.info/stats/mostwished/`. That was changed for the
public release path because SteamDB often serves a browser challenge to automated
background requests. Requiring every user to open SteamDB manually would be a
poor product experience, and bypassing the challenge is not a good release
strategy.

The second implementation tried to read Steam Store's `popularwishlist` search
results directly from the extension. That works technically, but it turns every
extension user into a small scraper. When enough requests are made, Steam Store's
edge can return `Access Denied`.

The legacy implementation used a hosted JSON feed:

```text
https://nicksoin.github.io/SteamTopWishlistsRank/mostwished.json
```

That endpoint is now deprecated. It remains published as a small compatibility
stub so the old URL does not disappear, but GitHub Actions no longer updates the
full catalog there.

Version 2.2.0 adds a second hosted data path:

```text
https://nicksoin.github.io/SteamTopWishlistsRank/v2/current/{shard}.json
https://nicksoin.github.io/SteamTopWishlistsRank/v2/pre-release/{shard}.json
```

The v2 feed is split into 256 deterministic shards keyed by Steam app ID. The
extension downloads only the one small shard needed for the current page instead
of fetching the whole live catalog. Released games use the `pre-release` shard
family, which stores the last known pre-release wishlist position captured before
Steam reports the app as released. Early Access counts as release.

The source list is:

```text
https://store.steampowered.com/search/?filter=popularwishlist&ignore_preferences=1
```

This means:

- no VPS is required;
- extension users do not need to open SteamDB;
- extension users do not scan Steam Store search pages;
- current extension versions make one request to a tiny hosted shard;
- old extension versions point at a deprecated compatibility stub rather than a
  live full-catalog feed;
- the rank follows Steam Store's `Popular Wishlisted` order.

The extension caches hosted shards in `chrome.storage.local`.

## Reliability Details

Manifest V3 service workers can be paused by Chrome, so the extension keeps the
runtime logic simple:

1. The content script identifies whether the Steam page is still upcoming or
   already released.
2. The background service worker hashes the app ID into one of 256 shard IDs.
3. It reads the matching shard cache, or fetches that one shard from GitHub Pages.
4. The content script renders either the live wishlist rank or the stored
   pre-release rank.

While syncing, the UI displays:

```text
Top Wishlisted: Syncing...
```

If an upcoming game is not found in the hosted feed, the UI displays:

```text
Top Wishlisted: ---
```

If a released game has no stored historical snapshot, the UI displays:

```text
Pre-Release Top Wish: No data
```

## Privacy And Permissions

The extension requests:

- `storage` permission, used only for local rank cache;
- host access to `https://store.steampowered.com/*` for the content script;
- host access to `https://*.github.io/*` for the hosted feeds.

It does not collect personal data, does not sell data, and does not send a
user's browsing history to the developer. The cached data is public Steam
ranking data keyed by Steam app ID.

The extension does not use remote code. Network responses are parsed as data,
not executed as JavaScript.

## GitHub Pages Setup

1. Use the public GitHub repository `NickSoin/SteamTopWishlistsRank`.
2. Push this project to the repository.
3. In GitHub, open `Settings -> Pages`.
4. Set the source to `Deploy from a branch`.
5. Select branch `main` and folder `/docs`.
6. Save. GitHub Pages may take a few minutes to publish.
7. Confirm that `src/feed-config.js` points to the published Pages URL.
8. Rebuild the extension ZIP and upload that version to Chrome Web Store.

GitHub Actions runs `.github/workflows/update-feed.yml` every 6 hours:

```yaml
schedule:
  - cron: "17 */6 * * *"
```

The workflow can also be started manually from the Actions tab with
`Run workflow`.

The deprecated legacy compatibility stub lives at:

```text
docs/mostwished.json
```

The generated v2 files live at:

```text
data/wishlist-ledger.json
data/wishlist-ledger-meta.json
docs/v2/meta.json
docs/v2/current/*.json
docs/v2/pre-release/*.json
```

When Pages is enabled, the deprecated legacy feed URL is:

```text
https://nicksoin.github.io/SteamTopWishlistsRank/mostwished.json
```

## File Layout

- `manifest.json` - Chrome extension manifest.
- `src/feed-config.js` - hosted feed URLs.
- `src/content-steam.js` - inserts and updates the Steam page metadata row.
- `src/background.js` - hosted shard fetch/cache path.
- `src/shared.js` - shared rank parsing and wishlist estimate logic.
- `src/steam-wishlist-rank.css` - small CSS tweaks for the inserted row.
- `scripts/update-feed.js` - GitHub Actions feed and shard generator.
- `.github/workflows/update-feed.yml` - 6-hour feed update workflow.
- `docs/mostwished.json` - deprecated legacy compatibility stub served by GitHub Pages.
- `docs/v2/` - static shard feed served by GitHub Pages.
- `data/wishlist-ledger.json` - internal release ledger used by the generator.
- `data/wishlist-ledger-meta.json` - ledger metadata, including the date tracking began.
- `test/shared.test.js` - parser and estimate tests.
- `test/ledger.test.js` - ledger transition tests.

## Build And Test

Run tests:

```powershell
npm test
```

Build or update the feed manually:

```powershell
npm run build:feed
```

Load locally:

```text
chrome://extensions/ -> Developer mode -> Load unpacked -> dist/unpacked
```

Build the Chrome Web Store ZIP by copying `manifest.json`, `README.md`, and
`src/` into a ZIP with `manifest.json` at the archive root.
