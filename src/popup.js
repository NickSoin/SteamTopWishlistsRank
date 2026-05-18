"use strict";

const ISSUES_URL = "https://docs.google.com/forms/d/e/1FAIpQLSc0XEsEq0j0fr6hsrNl6RHXdVlFZfgs9eaeTf_WtAJ_2QZydw/viewform";
const METHOD_URL = "https://nicksoin.github.io/SteamTopWishlistsRank/";
const EMPTY_VALUE = "—";

document.getElementById("link-issues").href = ISSUES_URL;
document.getElementById("link-method").href = METHOD_URL;

// ── Tab switching ──────────────────────────────────────────────

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === target));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + target));
  });
});

// ── Settings ───────────────────────────────────────────────────

const DEFAULTS = { swr_show_badges: true, swr_show_historical: true };

const elBadges = document.getElementById("setting-badges");
const elHistorical = document.getElementById("setting-historical");

// Load stored values
chrome.storage.sync.get(DEFAULTS, (prefs) => {
  elBadges.checked = prefs.swr_show_badges;
  elHistorical.checked = prefs.swr_show_historical;
});

// Save on change
elBadges.addEventListener("change", () => {
  chrome.storage.sync.set({ swr_show_badges: elBadges.checked });
});

elHistorical.addEventListener("change", () => {
  chrome.storage.sync.set({ swr_show_historical: elHistorical.checked });
});

// ── Main tab data ──────────────────────────────────────────────

loadAndRender();

function loadAndRender() {
  chrome.runtime.sendMessage({ type: "getFeedMeta" }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      renderUnavailable();
      return;
    }
    renderMeta(response.meta);
  });
}

function renderMeta(meta) {
  const updatedAt = meta.current?.updatedAt || meta.generatedAt;
  document.getElementById("updated-at").textContent = updatedAt ? formatDate(updatedAt) : EMPTY_VALUE;
  document.getElementById("current-entry-count").textContent = formatCount(meta.current?.entryCount);
  document.getElementById("released-entry-count").textContent = formatCount(meta.released?.entryCount);
  document.getElementById("prerelease-entry-count").textContent = formatCount(meta.preRelease?.entryCount);
  document.getElementById("tracking-since").textContent = meta.trackingSince ? formatTrackingDate(meta.trackingSince) : EMPTY_VALUE;
  if (meta.stale) document.getElementById("stale-notice").style.display = "block";
}

function renderUnavailable() {
  ["updated-at", "current-entry-count", "released-entry-count", "prerelease-entry-count", "tracking-since"]
    .forEach((id) => { document.getElementById(id).textContent = EMPTY_VALUE; });
}

// ── Helpers ────────────────────────────────────────────────────

function formatCount(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-US") : EMPTY_VALUE;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function formatTrackingDate(isoDate) {
  try {
    return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return isoDate; }
}
