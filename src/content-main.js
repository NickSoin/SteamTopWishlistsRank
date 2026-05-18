(function () {
  "use strict";

  const V = "v2.6.5";
  const log = (...a) => console.log("[SWR Main " + V + "]", ...a);

  // ── Settings gate ──────────────────────────────────────────────
  // Start only if "Show badges" is enabled; also react to live changes.
  let badgesEnabled = true;

  chrome.storage.sync.get({ swr_show_badges: true }, (prefs) => {
    badgesEnabled = prefs.swr_show_badges;
    if (badgesEnabled) init();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !("swr_show_badges" in changes)) return;
    badgesEnabled = changes.swr_show_badges.newValue;
    if (!badgesEnabled) {
      document.querySelectorAll(".swr-main-badge").forEach((el) => el.remove());
      processed = new WeakSet();
    } else {
      init();
    }
  });

  function init() {
    log("init");
    if (_scanObserver) _scanObserver.disconnect();
    scan();
    let scanTimer = null;
    _scanObserver = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(scan, 200);
    });
    _scanObserver.observe(document.body, { childList: true, subtree: true });
  }

  // appId -> entry (object) | false (not in top)
  const cache = new Map();
  // DOM elements already processed (badge injected or fetch triggered)
  let processed = new WeakSet();

  let _scanObserver = null;

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
    // Method 1: data-ds-appid — search results, main page, wishlists
    document.querySelectorAll("[data-ds-appid]").forEach((el) => {
      if (processed.has(el)) return;
      const appId = el.dataset.dsAppid?.split(",")[0];
      if (appId) injectBadge(el, appId);
    });

    // Method 2: <a href="/app/NNNN/"> wrapping an image
    // Covers publisher pages, curator pages, tag pages, etc.
    document.querySelectorAll('a[href*="/app/"]').forEach((el) => {
      if (processed.has(el)) return;
      // Only target links that contain a capsule image
      if (!el.querySelector("img")) return;
      // Skip if already captured by data-ds-appid above
      if (el.closest("[data-ds-appid]")) return;
      const m = el.href.match(/\/app\/(\d{1,12})\b/);
      if (!m) return;
      injectBadge(el, m[1]);
    });
  }

})();
