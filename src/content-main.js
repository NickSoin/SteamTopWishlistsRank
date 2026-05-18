(function () {
  "use strict";

  const MAIN_RANKS_ENABLED = true;
  if (!MAIN_RANKS_ENABLED) return;

  const V = "v2.6.0";
  const log = (...a) => console.log("[SWR Main " + V + "]", ...a);

  log("init");

  // appId -> entry (object) | false (not in top)
  const cache = new Map();
  // DOM elements already processed (badge injected or fetch triggered)
  const processed = new WeakSet();

  // --- Data fetch ---

  function fetchRank(appId, callback) {
    if (cache.has(appId)) {
      callback(cache.get(appId));
      return;
    }
    try {
      chrome.runtime.sendMessage(
        { type: "getWishlistRank", appId, mode: "current", force: false },
        (response) => {
          if (chrome.runtime.lastError) return;
          const entry = response?.ok && response.entry ? response.entry : false;
          cache.set(appId, entry);
          callback(entry);
        }
      );
    } catch (e) {
      log("sendMessage threw:", e.message);
    }
  }

  // --- Badge rendering ---

  function injectBadge(capsule, appId) {
    if (processed.has(capsule)) return;
    processed.add(capsule);

    fetchRank(appId, (entry) => {
      // Only show badge for games that are in top wishlisted
      if (!entry) return;

      // Find the thumbnail image container for overlay positioning
      const imgEl =
        capsule.querySelector("img.capsule_image") ||
        capsule.querySelector("img") ||
        capsule.querySelector(".capsule_image");

      let anchor = imgEl ? imgEl.parentElement : null;

      // If anchor has no relative positioning, wrap or use capsule root
      if (!anchor) anchor = capsule;

      // Avoid injecting twice if already there
      if (anchor.querySelector(".swr-main-badge")) return;

      const style = window.getComputedStyle(anchor);
      if (style.position === "static") anchor.style.position = "relative";

      const badge = document.createElement("div");
      badge.className = "swr-main-badge";
      badge.title = "Top Wishlisted: #" + entry.rank + (entry.estimate ? " · " + entry.estimate + " wishlists" : "");

      const rank = document.createElement("span");
      rank.className = "swr-main-badge-rank";
      rank.textContent = "#" + entry.rank;
      badge.appendChild(rank);

      if (entry.estimate) {
        const est = document.createElement("span");
        est.className = "swr-main-badge-est";
        est.textContent = entry.estimate;
        badge.appendChild(est);
      }

      anchor.appendChild(badge);
    });
  }

  // --- DOM scanning ---

  function scan() {
    document.querySelectorAll("[data-ds-appid]").forEach((el) => {
      if (processed.has(el)) return;
      // Skip capsules that are already on /app/ pages (handled by content-steam.js)
      const appId = el.dataset.dsAppid?.split(",")[0];
      if (appId) injectBadge(el, appId);
    });
  }

  // Initial scan after DOM settles
  scan();

  // Re-scan when Steam dynamically loads new sections
  let scanTimer = null;
  new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 200);
  }).observe(document.body, { childList: true, subtree: true });
})();
