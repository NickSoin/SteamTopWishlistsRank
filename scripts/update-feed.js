const fs = require("node:fs/promises");
const path = require("node:path");
const shared = require("../src/shared.js");

const STEAM_SEARCH_URL = "https://store.steampowered.com/search/results/";
const STEAM_APPDETAILS_URL = "https://store.steampowered.com/api/appdetails";
const LEDGER_PATH = process.env.STEAM_WISHLIST_LEDGER_OUTPUT || "data/wishlist-ledger.json";
const LEDGER_META_PATH =
  process.env.STEAM_WISHLIST_LEDGER_META_OUTPUT || "data/wishlist-ledger-meta.json";
const V2_OUTPUT_DIR = process.env.STEAM_WISHLIST_V2_OUTPUT_DIR || "docs/v2";
const PAGE_SIZE = Number(process.env.STEAM_WISHLIST_PAGE_SIZE || 100);
const MAX_RANK = Number(process.env.STEAM_WISHLIST_MAX_RANK || 10000);
const REQUEST_DELAY_MS = Number(process.env.STEAM_WISHLIST_REQUEST_DELAY_MS || 1500);
const FETCH_TIMEOUT_MS = Number(process.env.STEAM_WISHLIST_FETCH_TIMEOUT_MS || 10000);
const FETCH_RETRIES = Number(process.env.STEAM_WISHLIST_FETCH_RETRIES || 3);
const RETRY_DELAY_MS = Number(process.env.STEAM_WISHLIST_RETRY_DELAY_MS || 5000);
const RELEASE_CHECK_DELAY_MS = Number(process.env.STEAM_WISHLIST_RELEASE_CHECK_DELAY_MS || 250);
const SHARD_COUNT = 256;

async function main() {
  const startedAt = new Date();
  const scrape = await scrapeWishlistFeed(startedAt);

  if (scrape.feed.partial) {
    console.warn("Skipping v2 ledger and shard update because the wishlist scrape is partial.");
    console.log(`Scraped ${scrape.feed.entryCount} wishlist ranks.`);
    return;
  }

  const ledger = await readJsonIfExists(LEDGER_PATH, {});
  const ledgerMeta = await readJsonIfExists(LEDGER_META_PATH, {
    trackingSince: startedAt.toISOString().slice(0, 10)
  });
  const nextLedger = await updateLedger({
    ledger,
    currentEntries: scrape.currentEntries,
    now: startedAt,
    fetchReleaseInfo: fetchReleaseInfoWithRetry
  });

  await writeJsonAtomic(LEDGER_PATH, nextLedger);
  await writeJsonAtomic(LEDGER_META_PATH, ledgerMeta);
  await writeV2Artifacts({
    ledger: nextLedger,
    currentEntries: scrape.currentEntries,
    outputDir: V2_OUTPUT_DIR,
    updatedAt: startedAt.toISOString(),
    trackingSince: ledgerMeta.trackingSince
  });

  console.log(`Scraped ${scrape.feed.entryCount} wishlist ranks.`);
  console.log(`Wrote wishlist ledger to ${LEDGER_PATH}`);
  console.log(`Wrote v2 wishlist shards to ${V2_OUTPUT_DIR}`);
}

async function scrapeWishlistFeed(startedAt) {
  const entries = {};
  const currentEntries = {};
  let totalCount = 0;
  let nextStart = 0;
  let scannedRowCount = 0;

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
    const rowCount = countSteamSearchRows(page.resultsHtml);

    for (const [appId, entry] of Object.entries(parsed)) {
      if (!entries[appId]) {
        entries[appId] = {
          rank: entry.rank,
          estimate: entry.estimate,
          name: entry.name
        };

        currentEntries[appId] = entry;
      }
    }

    scannedRowCount += rowCount;
    if (rowCount === 0 || rowCount < PAGE_SIZE) break;

    nextStart += rowCount;
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
    scannedRowCount,
    entryCount: Object.keys(entries).length,
    entries
  };

  if (scannedRowCount < Math.min(totalCount || MAX_RANK, MAX_RANK)) {
    feed.partial = true;
    feed.warning = "Feed update stopped before reaching maxRank. Existing entries are still usable.";
  }

  return { feed, currentEntries };
}

async function updateLedger({ ledger, currentEntries, now, fetchReleaseInfo }) {
  const nextLedger = cloneJson(ledger);
  const currentAppIds = new Set(Object.keys(currentEntries));
  const currentCandidateIds = new Set();
  const today = now.toISOString().slice(0, 10);

  for (const [appId, entry] of Object.entries(currentEntries)) {
    if (nextLedger[appId]?.state === "released") continue;

    const exactReleaseDate = shared.normalizeSteamDate(entry.releaseText);
    if (exactReleaseDate && exactReleaseDate <= today) {
      currentCandidateIds.add(appId);
      continue;
    }

    upsertUpcomingLedgerEntry(nextLedger, appId, entry);
  }

  const absentCandidateIds = Object.entries(nextLedger)
    .filter(([appId, entry]) => entry?.state === "upcoming" && !currentAppIds.has(appId))
    .map(([appId]) => appId);

  for (const appId of currentCandidateIds) {
    const currentEntry = currentEntries[appId];
    const releaseInfo = await fetchReleaseInfo(appId);

    if (releaseInfo?.released) {
      markReleased(nextLedger, appId, releaseInfo, currentEntry);
    } else if (releaseInfo) {
      upsertUpcomingLedgerEntry(nextLedger, appId, currentEntry);
    }

    await delay(RELEASE_CHECK_DELAY_MS);
  }

  for (const appId of absentCandidateIds) {
    const releaseInfo = await fetchReleaseInfo(appId);
    if (releaseInfo?.released) {
      markReleased(nextLedger, appId, releaseInfo);
    }

    await delay(RELEASE_CHECK_DELAY_MS);
  }

  return nextLedger;
}

function upsertUpcomingLedgerEntry(ledger, appId, entry) {
  const existing = ledger[appId];
  if (existing?.state === "released") return;

  ledger[appId] = {
    name: entry.name || existing?.name || null,
    state: "upcoming",
    preRelease: {
      rank: entry.rank,
      estimate: entry.estimate || shared.estimateWishlists(entry.rank)
    }
  };
}

function markReleased(ledger, appId, releaseInfo, currentEntry = null) {
  const existing = ledger[appId] || {};

  ledger[appId] = {
    name: currentEntry?.name || existing.name || releaseInfo.name || null,
    state: "released",
    ...(existing.preRelease ? { preRelease: existing.preRelease } : {}),
    releaseDate: releaseInfo.releaseDate || null
  };
}

async function writeV2Artifacts({ ledger, currentEntries, outputDir, updatedAt, trackingSince }) {
  const currentShards = createEmptyShardMap();
  const preReleaseShards = createEmptyShardMap();
  let currentEntryCount = 0;
  let releasedEntryCount = 0;
  let preReleaseEntryCount = 0;

  for (const [appId, entry] of Object.entries(currentEntries)) {
    if (ledger[appId]?.state !== "upcoming") continue;

    const shardId = shared.getShardId(appId);
    currentShards[shardId][appId] = {
      rank: entry.rank,
      estimate: entry.estimate || shared.estimateWishlists(entry.rank),
      name: entry.name || ledger[appId]?.name || null
    };
    currentEntryCount += 1;
  }

  for (const [appId, entry] of Object.entries(ledger)) {
    if (entry?.state !== "released") continue;
    releasedEntryCount += 1;
    if (!entry.preRelease) continue;

    const shardId = shared.getShardId(appId);
    preReleaseShards[shardId][appId] = {
      rank: entry.preRelease.rank,
      estimate: entry.preRelease.estimate || shared.estimateWishlists(entry.preRelease.rank),
      name: entry.name || null,
      releaseDate: entry.releaseDate || null
    };
    preReleaseEntryCount += 1;
  }

  await fs.mkdir(path.join(outputDir, "current"), { recursive: true });
  await fs.mkdir(path.join(outputDir, "pre-release"), { recursive: true });

  // Merge pre-release shards with historical data already on disk.
  // Historical entries (from the Wayback scraper) are preserved; live ledger
  // entries take priority when the same appId appears in both.
  const preReleaseDir = path.join(outputDir, "pre-release");
  const mergedPreReleaseShards = {};
  for (const shardId of Object.keys(preReleaseShards)) {
    const diskPath = path.join(preReleaseDir, `${shardId}.json`);
    let existing = {};
    try {
      const raw = await fs.readFile(diskPath, "utf8");
      existing = JSON.parse(raw).entries || {};
    } catch {
      // file doesn't exist yet or is unreadable — start empty
    }
    // live ledger entries win over historical data for same appId
    mergedPreReleaseShards[shardId] = { ...existing, ...preReleaseShards[shardId] };
  }

  await Promise.all([
    ...Object.entries(currentShards).map(([shardId, entries]) =>
      writeJsonAtomic(path.join(outputDir, "current", `${shardId}.json`), {
        schemaVersion: 2,
        kind: "current",
        updatedAt,
        entryCount: Object.keys(entries).length,
        entries
      })
    ),
    ...Object.entries(mergedPreReleaseShards).map(([shardId, entries]) =>
      writeJsonAtomic(path.join(outputDir, "pre-release", `${shardId}.json`), {
        schemaVersion: 2,
        kind: "pre_release",
        updatedAt,
        entryCount: Object.keys(entries).length,
        entries
      })
    )
  ]);

  await writeJsonAtomic(path.join(outputDir, "meta.json"), {
    schemaVersion: 2,
    shardAlgorithm: "fnv1a32-low8",
    shardCount: SHARD_COUNT,
    trackingSince: trackingSince || String(updatedAt || "").slice(0, 10) || null,
    generatedAt: updatedAt,
    current: {
      updatedAt,
      entryCount: currentEntryCount
    },
    released: {
      updatedAt,
      entryCount: releasedEntryCount
    },
    preRelease: {
      updatedAt,
      entryCount: preReleaseEntryCount
    }
  });
}

function createEmptyShardMap() {
  return Object.fromEntries(
    Array.from({ length: SHARD_COUNT }, (_unused, index) => [
      index.toString(16).padStart(2, "0"),
      {}
    ])
  );
}

function countSteamSearchRows(html) {
  return (
    String(html ?? "").match(
      /<a\b[^>]*class=["'][^"']*\bsearch_result_row\b[^"']*["'][\s\S]*?<\/a>/gi
    ) || []
  ).length;
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

async function fetchReleaseInfo(appId) {
  const url = new URL(STEAM_APPDETAILS_URL);
  url.searchParams.set("appids", appId);
  url.searchParams.set("l", "english");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(url.toString(), {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "Steam Wishlist Rank feed updater (+https://github.com/)"
      }
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Steam appdetails HTTP ${response.status} for appid=${appId}`);
  }

  const json = await response.json();
  const payload = json?.[appId];
  if (!payload?.success || !payload.data) {
    return null;
  }

  return {
    released: payload.data.release_date?.coming_soon === false,
    releaseDate: shared.normalizeSteamDate(payload.data.release_date?.date),
    name: payload.data.name || null
  };
}

async function fetchReleaseInfoWithRetry(appId) {
  let lastError = null;

  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      return await fetchReleaseInfo(appId);
    } catch (error) {
      lastError = error;
      console.warn(
        `Release check failed for appid=${appId}, attempt ${attempt}/${FETCH_RETRIES}: ${error.message}`
      );

      if (attempt < FETCH_RETRIES) {
        await delay(RETRY_DELAY_MS * attempt);
      }
    }
  }

  console.warn(`Skipping release check for appid=${appId}: ${lastError?.message || "unknown error"}`);
  return null;
}

async function readJsonIfExists(filePath, fallback) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error?.code === "ENOENT") return cloneJson(fallback);
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(`${filePath}.tmp`, filePath);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  createEmptyShardMap,
  markReleased,
  scrapeWishlistFeed,
  updateLedger,
  upsertUpcomingLedgerEntry,
  writeV2Artifacts
};
