"use strict";

const CACHE_KEY = "steam_wishlist_rank_feed_cache_v1";
const ISSUES_URL = "https://docs.google.com/forms/d/e/1FAIpQLSc0XEsEq0j0fr6hsrNl6RHXdVlFZfgs9eaeTf_WtAJ_2QZydw/viewform";
const METHOD_URL = "https://nicksoin.github.io/SteamTopWishlistsRank/";

document.getElementById("link-issues").href = ISSUES_URL;
document.getElementById("link-method").href = METHOD_URL;

loadAndRender();

async function loadAndRender() {
  const cache = await readCache();
  renderStatus(cache);
}

function renderStatus(cache) {
  const fetchedAtEl = document.getElementById("fetched-at");
  const updatedAtEl = document.getElementById("updated-at");
  const entryCountEl = document.getElementById("entry-count");
  const staleEl = document.getElementById("stale-notice");

  if (!cache.fetchedAt) {
    fetchedAtEl.textContent = "Not yet fetched";
    fetchedAtEl.className = "value muted";
    return;
  }

  fetchedAtEl.textContent = formatAge(Date.now() - cache.fetchedAt);

  const updatedAt = cache.feed?.updatedAt;
  updatedAtEl.textContent = updatedAt ? formatDate(updatedAt) : "—";

  const count = cache.feed?.entryCount ?? Object.keys(cache.feed?.entries ?? {}).length;
  entryCountEl.textContent = count ? count.toLocaleString("en-US") : "—";

  if (cache.stale) staleEl.style.display = "block";
}

function readCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get(CACHE_KEY, (data) => resolve(data[CACHE_KEY] || {}));
  });
}

function formatAge(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    });
  } catch {
    return iso;
  }
}
