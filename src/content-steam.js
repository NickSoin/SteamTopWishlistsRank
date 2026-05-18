(function () {
  "use strict";

  const appIdMatch = location.pathname.match(/\/app\/(\d{1,12})\b/);
  if (!appIdMatch) return;

  const appId = appIdMatch[1];
  const mode = isReleasedPage() ? "preRelease" : "current";
  const ERROR_RETRY_MS = 30000;
  let retryTimer = null;
  let hasFinalResult = false;

  // Check "Show historical data" setting before rendering pre-release data
  if (mode === "preRelease") {
    chrome.storage.sync.get({ swr_show_historical: true }, (prefs) => {
      if (!prefs.swr_show_historical) {
        renderStatusRow("Game released", "Historical wishlist data is disabled in extension settings.");
      } else {
        renderStatusRow("Syncing...");
        requestWishlistRank();
      }
    });
  } else {
    renderStatusRow("Syncing...");
    requestWishlistRank();
  }

  function requestWishlistRank(options = {}) {
    window.clearTimeout(retryTimer);

    chrome.runtime.sendMessage(
      { type: "getWishlistRank", appId, mode, force: Boolean(options.force) },
      (response) => {
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
            (mode === "preRelease"
              ? "No stored pre-release wishlist snapshot was found for this app."
              : "The app was not found in the hosted Steam Popular Wishlisted feed.");
          const label = mode === "preRelease" ? "No data" : "---";
          renderStatusRow(label, tooltip, mode === "current");
          return;
        }

        window.clearTimeout(retryTimer);
        renderWishlistRow(response.entry, response);
      }
    );
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
      if (hasFinalResult) return;
      const row = buildShellRow(null);
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
    const row = buildShellRow(entry);
    const value = row.querySelector(".steamdb-wishlist-rank-value");

    // Rank number → links to Steam Popular Wishlisted
    const rankLink = document.createElement("a");
    rankLink.href = "https://store.steampowered.com/search/?filter=popularwishlist&ignore_preferences=1";
    rankLink.target = "_blank";
    rankLink.rel = "noreferrer";
    rankLink.title = buildTooltip(entry, response);
    rankLink.textContent = `#${formatRankForDisplay(entry.rank)}`;
    value.append(rankLink);

    // Wishlist count: confirmed (with source link) or estimated
    const wishlistEl = buildWishlistDisplay(entry);
    if (wishlistEl) {
      value.append(document.createTextNode(" "));
      value.append(wishlistEl);
    }

    return row;
  }

  function buildWishlistDisplay(entry) {
    if (entry.actualWishlists) {
      // Confirmed count — wrap entire "(N wishlists)" in a link if URL is known
      const wrapper = entry.wishlistUrl
        ? document.createElement("a")
        : document.createElement("span");

      if (entry.wishlistUrl) {
        wrapper.href = entry.wishlistUrl;
        wrapper.target = "_blank";
        wrapper.rel = "noreferrer";
        wrapper.title = "View developer announcement";
        wrapper.className = "steamdb-wishlist-source-link";
      }

      wrapper.append(document.createTextNode("("));

      const countEl = document.createElement("span");
      countEl.className = "steamdb-wishlist-estimate";
      countEl.textContent = formatWishlists(entry.actualWishlists);
      wrapper.append(countEl);

      const suffix = document.createElement("span");
      suffix.className = "steamdb-wishlist-muted";
      suffix.textContent = " wishlists)";
      wrapper.append(suffix);

      return wrapper;
    }

    // Band-based estimate — velocity rank, not total count
    const estimate = entry.estimate || globalThis.SteamWishlistRankShared?.estimateWishlists(entry.rank);
    if (!estimate) return null;

    const wrapper = document.createElement("span");
    wrapper.append(document.createTextNode("("));

    const estSpan = document.createElement("span");
    estSpan.className = "steamdb-wishlist-estimate";
    estSpan.textContent = estimate;
    wrapper.append(estSpan);

    const suffix = document.createElement("span");
    suffix.className = "steamdb-wishlist-muted";
    suffix.textContent = " wishlists, estimated)";
    wrapper.append(suffix);

    return wrapper;
  }

  function formatWishlists(count) {
    const n = Number(count);
    if (!n) return null;
    if (n >= 1_000_000) {
      const m = n / 1_000_000;
      return `~${m % 1 === 0 ? m : m.toFixed(1)}m`;
    }
    if (n >= 1_000) {
      return `~${Math.round(n / 1_000)}k`;
    }
    return `~${n}`;
  }

  function getRowLabel(entry) {
    if (mode === "current") return "Top Wishlisted:";
    if (entry?.source === "tracked") return "On-Release Top Wish:";
    return "Peak Wishlisted:";
  }

  function buildShellRow(entry) {
    const row = document.createElement("div");
    row.className = "dev_row steamdb-wishlist-rank-row";
    row.dataset.appId = appId;

    const label = document.createElement("div");
    label.className = "subtitle column";
    label.textContent = getRowLabel(entry);

    const value = document.createElement("div");
    value.className = "summary column steamdb-wishlist-rank-value";

    row.append(label, value);
    return row;
  }

  function buildTooltip(entry, response) {
    const parts = [
      mode === "preRelease"
        ? `Pre-release Steam Popular Wishlisted rank #${formatRank(entry.rank)}.`
        : `Steam Popular Wishlisted rank #${formatRank(entry.rank)}.`
    ];

    if (entry.actualWishlists) {
      parts.push(`Confirmed wishlists: ${formatWishlists(entry.actualWishlists)} (developer announcement).`);
    } else {
      const estimate = entry.estimate || globalThis.SteamWishlistRankShared?.estimateWishlists(entry.rank);
      parts.push(
        estimate
          ? `Wishlist count estimate: ${estimate} (based on velocity rank, may differ from total count).`
          : "Wishlist count estimate not available."
      );
    }

    if (entry.name) {
      parts.unshift(entry.name);
    }

    if (response?.source) {
      parts.push(`Source: ${response.source}.`);
    }

    if (mode === "preRelease" && entry.releaseDate) {
      parts.push(`Release date: ${entry.releaseDate}.`);
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

  function isReleasedPage() {
    return !document.querySelector(".game_area_comingsoon");
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
