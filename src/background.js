importScripts("shared.js", "feed-config.js");

const FEED_CACHE_KEY = "steam_wishlist_rank_feed_cache_v1";
const FEED_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
let inFlightFeedPromise = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "getWishlistRank") {
    handleGetWishlistRank(message)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message?.type === "refreshFeed") {
    getFeed(true)
      .then((feed) => sendResponse({ ok: true, feed }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  return false;
});

async function handleGetWishlistRank(message) {
  const appId = normalizeAppId(message.appId);
  if (!appId) {
    return { ok: false, error: "Invalid app id" };
  }

  const feed = await getFeed(Boolean(message.force));
  const rawEntry = feed.entries?.[appId] || null;
  const entry = rawEntry ? normalizeEntry(appId, rawEntry) : null;

  return {
    ok: true,
    entry,
    fetchedAt: feed.fetchedAt || null,
    updatedAt: feed.updatedAt || null,
    source: feed.source || "hosted_feed",
    feedUrl: getConfiguredFeedUrl(),
    complete: true,
    totalCount: feed.totalCount || Object.keys(feed.entries || {}).length,
    stale: Boolean(feed.stale),
    refreshError: feed.refreshError || null
  };
}

async function getFeed(force) {
  const cached = await readCache();
  const hasEntries = cached.feed?.entries && Object.keys(cached.feed.entries).length > 0;
  const isFresh = cached.fetchedAt && Date.now() - cached.fetchedAt < FEED_TTL_MS;

  if (!force && hasEntries && isFresh) {
    return { ...cached.feed, fetchedAt: cached.fetchedAt, stale: false };
  }

  try {
    const freshFeed = await fetchFeedDeduped();
    await writeCache({ feed: freshFeed, fetchedAt: Date.now() });
    return { ...freshFeed, fetchedAt: Date.now(), stale: false };
  } catch (error) {
    if (hasEntries) {
      return {
        ...cached.feed,
        fetchedAt: cached.fetchedAt || null,
        stale: true,
        refreshError: getErrorMessage(error)
      };
    }

    throw error;
  }
}

async function fetchFeedDeduped() {
  if (!inFlightFeedPromise) {
    inFlightFeedPromise = fetchFeed().finally(() => {
      inFlightFeedPromise = null;
    });
  }

  return inFlightFeedPromise;
}

async function fetchFeed() {
  const feedUrl = getConfiguredFeedUrl();
  if (!feedUrl || /YOUR_GITHUB_USERNAME/i.test(feedUrl)) {
    throw new Error("Feed URL is not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(feedUrl, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
      headers: { accept: "application/json" }
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Feed HTTP ${response.status}`);
  }

  const feed = await response.json();
  validateFeed(feed);

  return feed;
}

function validateFeed(feed) {
  if (!feed || typeof feed !== "object" || typeof feed.entries !== "object") {
    throw new Error("Feed response is not a valid wishlist rank feed");
  }
}

function normalizeEntry(appId, entry) {
  const rank = SteamWishlistRankShared.toRankNumber(entry.rank);
  if (!rank) return null;

  return {
    appId,
    rank,
    estimate: entry.estimate || SteamWishlistRankShared.estimateWishlists(rank),
    name: entry.name || null,
    source: entry.source || "hosted_feed"
  };
}

function getConfiguredFeedUrl() {
  return globalThis.STEAM_WISHLIST_RANK_FEED_URL || "";
}

async function readCache() {
  const data = await storageGet(FEED_CACHE_KEY);
  return data[FEED_CACHE_KEY] || {};
}

async function writeCache(cache) {
  await storageSet({ [FEED_CACHE_KEY]: cache });
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

function normalizeAppId(value) {
  const match = String(value ?? "").match(/^\d{1,12}$/);
  return match ? match[0] : null;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
