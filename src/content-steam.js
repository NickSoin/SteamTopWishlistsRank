(function () {
  "use strict";

  const appIdMatch = location.pathname.match(/\/app\/(\d{1,12})\b/);
  if (!appIdMatch) return;

  const appId = appIdMatch[1];
  const CACHE_KEY = "steam_wishlist_rank_feed_cache_v1";
  const SYNC_RETRY_MS = 10000;
  const ERROR_RETRY_MS = 30000;
  let retryTimer = null;
  let hasFinalResult = false;

  renderStatusRow("Syncing...");
  requestWishlistRank();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[CACHE_KEY]) {
      requestWishlistRank();
    }
  });

  function requestWishlistRank(options = {}) {
    window.clearTimeout(retryTimer);

    chrome.runtime.sendMessage({ type: "getWishlistRank", appId, force: Boolean(options.force) }, (response) => {
      if (chrome.runtime.lastError) {
        console.debug("[Steam Wishlist Rank]", chrome.runtime.lastError.message);
        renderStatusRow("Extension error", chrome.runtime.lastError.message);
        scheduleRetry(ERROR_RETRY_MS, true);
        return;
      }

      if (!response?.ok) {
        renderStatusRow("Unavailable", response?.error || "Could not read wishlist rank.");
        scheduleRetry(ERROR_RETRY_MS, true);
        return;
      }

      if (!response.entry) {
        if (hasFinalResult) return;

        const tooltip =
          response.refreshError ||
          "The app was not found in the hosted Steam Popular Wishlisted feed.";
        const label = response.complete ? "---" : "Syncing...";
        renderStatusRow(label, tooltip, true);
        if (!response.complete) {
          scheduleRetry(response.refreshError ? ERROR_RETRY_MS : SYNC_RETRY_MS, Boolean(response.refreshError));
        }
        return;
      }

      window.clearTimeout(retryTimer);
      renderWishlistRow(response.entry, response);
    });
  }

  function scheduleRetry(delay, force) {
    window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(() => requestWishlistRank({ force }), delay);
  }

  function renderWishlistRow(entry, response) {
    hasFinalResult = true;

    waitForSteamDetails((target) => {
      const row = buildRow(entry, response);
      removeExistingRow();

      if (target.matches(".release_date")) {
        target.insertAdjacentElement("beforebegin", row);
      } else {
        target.insertAdjacentElement("afterend", row);
      }
    });
  }

  function renderStatusRow(message, title, isSteamDbLink) {
    waitForSteamDetails((target) => {
      const row = buildShellRow();
      const value = row.querySelector(".steamdb-wishlist-rank-value");
      const element = isSteamDbLink ? document.createElement("a") : document.createElement("span");

      if (isSteamDbLink) {
        element.href = "https://store.steampowered.com/search/?filter=popularwishlist&ignore_preferences=1";
        element.target = "_blank";
        element.rel = "noreferrer";
      }

      element.textContent = message;
      element.title = title || "";
      value.append(element);

      removeExistingRow();

      if (target.matches(".release_date")) {
        target.insertAdjacentElement("beforebegin", row);
      } else {
        target.insertAdjacentElement("afterend", row);
      }
    });
  }

  function buildRow(entry, response) {
    const row = buildShellRow();
    const value = row.querySelector(".steamdb-wishlist-rank-value");
    const estimate =
      entry.estimate || globalThis.SteamWishlistRankShared?.estimateWishlists(entry.rank);

    const link = document.createElement("a");
    link.href = "https://store.steampowered.com/search/?filter=popularwishlist&ignore_preferences=1";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.title = buildTooltip(entry, response);

    const rankSpan = document.createElement("span");
    rankSpan.textContent = `#${formatRankForDisplay(entry.rank)}`;
    link.append(rankSpan);

    if (estimate) {
      link.append(document.createTextNode(" ("));

      const estimateSpan = document.createElement("span");
      estimateSpan.className = "steamdb-wishlist-estimate";
      estimateSpan.textContent = estimate;
      link.append(estimateSpan);

      const suffix = document.createElement("span");
      suffix.className = "steamdb-wishlist-muted";
      suffix.textContent = " wishlists)";
      link.append(suffix);
    }

    value.append(link);

    return row;
  }

  function buildShellRow() {
    const row = document.createElement("div");
    row.className = "dev_row steamdb-wishlist-rank-row";
    row.dataset.appId = appId;

    const label = document.createElement("div");
    label.className = "subtitle column";
    label.textContent = "Top Wishlisted:";

    const value = document.createElement("div");
    value.className = "summary column steamdb-wishlist-rank-value";

    row.append(label, value);
    return row;
  }

  function buildTooltip(entry, response) {
    const estimate =
      entry.estimate || globalThis.SteamWishlistRankShared?.estimateWishlists(entry.rank);
    const parts = [
      `Steam Popular Wishlisted rank #${formatRank(entry.rank)}.`,
      estimate
        ? `Wishlist count estimate: ${estimate}.`
        : "Wishlist count estimate is not available for this rank."
    ];

    if (entry.name) {
      parts.unshift(entry.name);
    }

    if (response?.source) {
      parts.push(`Source: ${response.source}.`);
    }

    if (response?.refreshError) {
      parts.push(`Live refresh failed: ${response.refreshError}.`);
    }

    return parts.join(" ");
  }

  function waitForSteamDetails(callback) {
    const startedAt = Date.now();
    const timeoutMs = 10000;

    const tryRender = () => {
      const target = findInsertTarget();
      if (!target) return false;

      callback(target);
      return true;
    };

    if (tryRender()) return;

    const observer = new MutationObserver(() => {
      if (tryRender() || Date.now() - startedAt > timeoutMs) {
        observer.disconnect();
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.setTimeout(() => {
      observer.disconnect();
      tryRender();
    }, timeoutMs);
  }

  function findInsertTarget() {
    return document.querySelector("#userReviews") || document.querySelector(".release_date");
  }

  function removeExistingRow() {
    const existing = Array.from(document.querySelectorAll(".steamdb-wishlist-rank-row")).find(
      (row) => row.dataset.appId === appId
    );
    if (existing) existing.remove();
    return existing;
  }

  function formatRank(rank) {
    return Number(rank).toLocaleString("en-US");
  }

  function formatRankForDisplay(rank) {
    return String(Number(rank));
  }
})();
