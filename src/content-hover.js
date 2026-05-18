(function () {
  "use strict";

  const CAPSULE_HOVER_ENABLED = true;
  if (!CAPSULE_HOVER_ENABLED) return;

  const V = "v2.5.8";
  const log = (...a) => console.log("[SWR Hover " + V + "]", ...a);

  log("init");

  let hoveredAppId = null;
  // null = loading, false = confirmed no data, {...} = has data
  let pendingEntry = null;
  let lastRenderedKey = null;
  let _popupId = 0;
  let _lastPopupClass = null;

  // --- Popup detection ---

  const EXACT_SELS = [
    "#global_hover",
    ".game_hover",
    ".store_hover_flyout_ctn",
    ".store_hover_flyout",
  ];

  function findPopup() {
    for (const sel of EXACT_SELS) {
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return el;
      }
    }
    const wc = document.querySelector('[class*="flyout"]');
    if (wc) {
      const r = wc.getBoundingClientRect();
      if (r.width > 100 && r.height > 100) return wc;
    }
    for (const child of document.body.children) {
      const r = child.getBoundingClientRect();
      if (r.width < 100 || r.height < 100) continue;
      const pos = getComputedStyle(child).position;
      if (pos !== "absolute" && pos !== "fixed") continue;
      if (child.querySelector('a[href*="/app/"]')) return child;
    }
    return null;
  }

  // --- AppId extraction ---

  function extractAppId(el) {
    const row = el.closest("[data-ds-appid]");
    if (row) return row.dataset.dsAppid?.split(",")[0] || null;
    const a = el.closest('a[href*="/app/"]');
    if (a) return a.href.match(/\/app\/(\d{1,12})\b/)?.[1] || null;
    return null;
  }

  // --- UI ---

  function buildBadge(modifier) {
    const badge = document.createElement("div");
    badge.className = "swr-hover-rank swr-hover-rank--" + modifier;

    const chip = document.createElement("div");
    chip.className = "swr-hover-rank-chip";

    const label = document.createElement("span");
    label.className = "swr-hover-rank-label";
    label.textContent = "Top Wishlisted:";
    chip.appendChild(label);

    badge.appendChild(chip);
    return { badge, chip };
  }

  function renderBadge(popup, entry) {
    popup.querySelector(".swr-hover-rank")?.remove();

    const { badge, chip } = buildBadge("found");

    const value = document.createElement("span");
    value.className = "swr-hover-rank-value";
    value.textContent = "#" + entry.rank;
    chip.appendChild(value);

    if (entry.estimate) {
      const est = document.createElement("span");
      est.className = "swr-hover-rank-est";
      est.textContent = entry.estimate;
      chip.appendChild(est);

      const muted = document.createElement("span");
      muted.className = "swr-hover-rank-muted";
      muted.textContent = " wishlists";
      chip.appendChild(muted);
    }

    popup.prepend(badge);
    log("injected #" + entry.rank + " into", popup.className || popup.id);
  }

  function renderNoBadge(popup) {
    popup.querySelector(".swr-hover-rank")?.remove();

    const { badge, chip } = buildBadge("none");

    const text = document.createElement("span");
    text.className = "swr-hover-rank-value";
    text.textContent = "Not in Top Wishlisted";
    chip.appendChild(text);

    popup.prepend(badge);
  }

  // --- Polling tick (80 ms) ---

  function tick() {
    if (!hoveredAppId) return;
    if (pendingEntry === null) return; // still waiting for response

    const popup = findPopup();

    if (!popup) {
      if (_lastPopupClass !== null) {
        _lastPopupClass = null;
      }
      lastRenderedKey = null;
      return;
    }

    const cls = popup.className || popup.id || "?";
    if (cls !== _lastPopupClass) {
      log("popup found:", cls);
      _lastPopupClass = cls;
    }

    if (!popup.dataset.swrId) popup.dataset.swrId = String(++_popupId);
    const key = hoveredAppId + ":" + popup.dataset.swrId;

    if (pendingEntry === false) {
      if (key !== lastRenderedKey || !popup.querySelector(".swr-hover-rank")) {
        renderNoBadge(popup);
        lastRenderedKey = key;
      }
      return;
    }

    if (key !== lastRenderedKey || !popup.querySelector(".swr-hover-rank")) {
      renderBadge(popup, pendingEntry);
      lastRenderedKey = key;
    }
  }

  setInterval(tick, 80);

  // --- Mouse tracking ---

  document.addEventListener(
    "mouseenter",
    (e) => {
      if (!(e.target instanceof Element)) return;
      const appId = extractAppId(e.target);
      if (!appId || appId === hoveredAppId) return;

      hoveredAppId = appId;
      pendingEntry = null; // loading state
      lastRenderedKey = null;
      _lastPopupClass = null;

      log("hover →", appId);

      try {
        chrome.runtime.sendMessage(
          { type: "getWishlistRank", appId, mode: "current", force: false },
          (response) => {
            if (chrome.runtime.lastError) {
              log("msg error:", chrome.runtime.lastError.message);
              pendingEntry = false;
              return;
            }
            if (hoveredAppId !== appId) return;
            if (!response?.ok || !response.entry) {
              log("no data for", appId);
              pendingEntry = false; // confirmed: not in top wishlisted
              return;
            }
            pendingEntry = response.entry;
            log("got rank #" + response.entry.rank + " for", appId);
          }
        );
      } catch (e) {
        log("sendMessage threw:", e.message);
        pendingEntry = false;
      }
    },
    true
  );

  document.addEventListener(
    "mouseleave",
    (e) => {
      if (!(e.target instanceof Element)) return;
      if (!e.relatedTarget) {
        hoveredAppId = null;
        pendingEntry = null;
        lastRenderedKey = null;
      }
    },
    true
  );
})();
