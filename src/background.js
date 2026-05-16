importScripts("shared.js", "feed-config.js");

const SHARD_CACHE_PREFIX = "steam_wishlist_rank_shard_cache_v3";
const META_CACHE_KEY = "steam_wishlist_rank_meta_cache_v3";
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const inFlightShardPromises = new Map();
let inFlightMetaPromise = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "getWishlistRank") {
    handleGetWishlistRank(message)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message?.type === "getFeedMeta") {
    getMeta(Boolean(message.force))
      .then((meta) => sendResponse({ ok: true, meta }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  return false;
});

async function handleGetWishlistRank(message) {
  const appId = SteamWishlistRankShared.normalizeAppId(message.appId);
  if (!appId) {
    return { ok: false, error: "Invalid app id" };
  }

  const mode = normalizeMode(message.mode);
  if (!mode) {
    return { ok: false, error: "Invalid wishlist mode" };
  }

  const shardId = SteamWishlistRankShared.getShardId(appId);
  const shard = await getShard(mode, shardId, Boolean(message.force));
  const rawEntry = shard.entries?.[appId] || null;
  const entry = rawEntry ? normalizeEntry(appId, rawEntry) : null;

  return {
    ok: true,
    mode,
    entry,
    fetchedAt: shard.fetchedAt || null,
    updatedAt: shard.updatedAt || null,
    source: "hosted_v2_shard",
    shardId,
    shardUrl: buildShardUrl(mode, shardId),
    stale: Boolean(shard.stale),
    refreshError: shard.refreshError || null
  };
}

async function getShard(mode, shardId, force) {
  const cacheKey = getShardCacheKey(mode, shardId);
  const cached = await readCache(cacheKey);
  const hasEntries = cached.payload?.entries && typeof cached.payload.entries === "object";
  const isFresh = cached.fetchedAt && Date.now() - cached.fetchedAt < CACHE_TTL_MS;

  if (!force && hasEntries && isFresh) {
    return { ...cached.payload, fetchedAt: cached.fetchedAt, stale: false };
  }

  try {
    const freshShard = await fetchShardDeduped(mode, shardId);
    const fetchedAt = Date.now();
    await writeCache(cacheKey, { payload: freshShard, fetchedAt });
    return { ...freshShard, fetchedAt, stale: false };
  } catch (error) {
    if (hasEntries) {
      return {
        ...cached.payload,
        fetchedAt: cached.fetchedAt || null,
        stale: true,
        refreshError: getErrorMessage(error)
      };
    }

    throw error;
  }
}

async function getMeta(force) {
  const cached = await readCache(META_CACHE_KEY);
  const hasPayload = cached.payload && typeof cached.payload === "object";
  const isFresh = cached.fetchedAt && Date.now() - cached.fetchedAt < CACHE_TTL_MS;

  if (!force && hasPayload && isFresh) {
    return { ...cached.payload, fetchedAt: cached.fetchedAt, stale: false };
  }

  try {
    const freshMeta = await fetchMetaDeduped();
    const fetchedAt = Date.now();
    await writeCache(META_CACHE_KEY, { payload: freshMeta, fetchedAt });
    return { ...freshMeta, fetchedAt, stale: false };
  } catch (error) {
    if (hasPayload) {
      return {
        ...cached.payload,
        fetchedAt: cached.fetchedAt || null,
        stale: true,
        refreshError: getErrorMessage(error)
      };
    }

    throw error;
  }
}

async function fetchShardDeduped(mode, shardId) {
  const key = `${mode}:${shardId}`;
  if (!inFlightShardPromises.has(key)) {
    const promise = fetchShard(mode, shardId).finally(() => {
      inFlightShardPromises.delete(key);
    });
    inFlightShardPromises.set(key, promise);
  }

  return inFlightShardPromises.get(key);
}

async function fetchMetaDeduped() {
  if (!inFlightMetaPromise) {
    inFlightMetaPromise = fetchMeta().finally(() => {
      inFlightMetaPromise = null;
    });
  }

  return inFlightMetaPromise;
}

async function fetchShard(mode, shardId) {
  const shardUrl = buildShardUrl(mode, shardId);
  const shard = await fetchJson(shardUrl);
  validateShard(shard);
  return shard;
}

async function fetchMeta() {
  const metaUrl = `${getConfiguredV2BaseUrl()}/meta.json`;
  const meta = await fetchJson(metaUrl);
  validateMeta(meta);
  return meta;
}

async function fetchJson(url) {
  if (!url || /YOUR_GITHUB_USERNAME/i.test(url)) {
    throw new Error("Feed URL is not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(url, {
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

  return response.json();
}

function validateShard(shard) {
  if (!shard || typeof shard !== "object" || typeof shard.entries !== "object") {
    throw new Error("Shard response is not a valid wishlist shard");
  }
}

function validateMeta(meta) {
  if (!meta || typeof meta !== "object" || Number(meta.schemaVersion) !== 2) {
    throw new Error("Meta response is not a valid wishlist v2 meta file");
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
    releaseDate: entry.releaseDate || null,
    source: entry.source || "hosted_v2_shard"
  };
}

function normalizeMode(value) {
  if (value === "current" || value === "preRelease") return value;
  return null;
}

function getShardCacheKey(mode, shardId) {
  return `${SHARD_CACHE_PREFIX}_${mode}_${shardId}`;
}

function buildShardUrl(mode, shardId) {
  const directory = mode === "preRelease" ? "pre-release" : "current";
  return `${getConfiguredV2BaseUrl()}/${directory}/${shardId}.json`;
}

function getConfiguredV2BaseUrl() {
  return String(globalThis.STEAM_WISHLIST_RANK_V2_BASE_URL || "").replace(/\/+$/, "");
}

async function readCache(key) {
  const data = await storageGet(key);
  return data[key] || {};
}

async function writeCache(key, cache) {
  await storageSet({ [key]: cache });
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
