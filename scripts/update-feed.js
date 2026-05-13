const fs = require("node:fs/promises");
const path = require("node:path");
const shared = require("../src/shared.js");

const STEAM_SEARCH_URL = "https://store.steampowered.com/search/results/";
const OUTPUT_PATH = process.env.STEAM_WISHLIST_FEED_OUTPUT || "docs/mostwished.json";
const PAGE_SIZE = Number(process.env.STEAM_WISHLIST_PAGE_SIZE || 100);
const MAX_RANK = Number(process.env.STEAM_WISHLIST_MAX_RANK || 10000);
const REQUEST_DELAY_MS = Number(process.env.STEAM_WISHLIST_REQUEST_DELAY_MS || 1500);
const FETCH_TIMEOUT_MS = Number(process.env.STEAM_WISHLIST_FETCH_TIMEOUT_MS || 10000);
const FETCH_RETRIES = Number(process.env.STEAM_WISHLIST_FETCH_RETRIES || 3);
const RETRY_DELAY_MS = Number(process.env.STEAM_WISHLIST_RETRY_DELAY_MS || 5000);

async function main() {
  const startedAt = new Date();
  const entries = {};
  let totalCount = 0;
  let nextStart = 0;

  while (nextStart < MAX_RANK) {
    let page;

    try {
      page = await fetchWishlistPageWithRetry(nextStart);
    } catch (error) {
      if (Object.keys(entries).length === 0) {
        throw error;
      }

      console.warn(`Stopping feed update at rank ${nextStart + 1}: ${error.message}`);
      break;
    }

    totalCount = page.totalCount || totalCount;

    const parsed = shared.parseRankingsFromSteamSearchHtml(page.resultsHtml, nextStart);
    const appIds = Object.keys(parsed);

    for (const [appId, entry] of Object.entries(parsed)) {
      entries[appId] = {
        rank: entry.rank,
        estimate: entry.estimate,
        name: entry.name
      };
    }

    if (appIds.length === 0 || appIds.length < PAGE_SIZE) break;

    nextStart += appIds.length;
    if (nextStart >= Math.min(totalCount || MAX_RANK, MAX_RANK)) break;

    await delay(REQUEST_DELAY_MS);
  }

  const feed = {
    schemaVersion: 1,
    source: "steam_popularwishlist",
    sourceUrl: "https://store.steampowered.com/search/?filter=popularwishlist&ignore_preferences=1",
    updatedAt: startedAt.toISOString(),
    generatedAt: new Date().toISOString(),
    maxRank: MAX_RANK,
    pageSize: PAGE_SIZE,
    totalCount,
    entryCount: Object.keys(entries).length,
    entries
  };

  if (feed.entryCount < Math.min(totalCount || MAX_RANK, MAX_RANK)) {
    feed.partial = true;
    feed.warning = "Feed update stopped before reaching maxRank. Existing entries are still usable.";
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(`${OUTPUT_PATH}.tmp`, `${JSON.stringify(feed, null, 2)}\n`, "utf8");
  await fs.rename(`${OUTPUT_PATH}.tmp`, OUTPUT_PATH);

  console.log(`Wrote ${feed.entryCount} wishlist ranks to ${OUTPUT_PATH}`);
}

async function fetchWishlistPage(start) {
  const url = new URL(STEAM_SEARCH_URL);
  url.searchParams.set("query", "");
  url.searchParams.set("start", String(start));
  url.searchParams.set("count", String(PAGE_SIZE));
  url.searchParams.set("dynamic_data", "");
  url.searchParams.set("sort_by", "_ASC");
  url.searchParams.set("snr", "1_7_7_popularwishlist_150_1");
  url.searchParams.set("filter", "popularwishlist");
  url.searchParams.set("ignore_preferences", "1");
  url.searchParams.set("infinite", "1");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(url.toString(), {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
      headers: {
        accept: "application/json,text/javascript,*/*;q=0.01",
        "user-agent": "Steam Wishlist Rank feed updater (+https://github.com/)"
      }
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Steam search HTTP ${response.status} at start=${start}`);
  }

  const json = await response.json();
  if (!json || Number(json.success) !== 1) {
    throw new Error(`Steam search returned an unexpected response at start=${start}`);
  }

  return {
    resultsHtml: String(json.results_html || ""),
    totalCount: Number(json.total_count) || 0
  };
}

async function fetchWishlistPageWithRetry(start) {
  let lastError = null;

  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      return await fetchWishlistPage(start);
    } catch (error) {
      lastError = error;
      console.warn(
        `Fetch failed for start=${start}, attempt ${attempt}/${FETCH_RETRIES}: ${error.message}`
      );

      if (attempt < FETCH_RETRIES) {
        await delay(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
