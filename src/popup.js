"use strict";

const ISSUES_URL = "https://docs.google.com/forms/d/e/1FAIpQLSc0XEsEq0j0fr6hsrNl6RHXdVlFZfgs9eaeTf_WtAJ_2QZydw/viewform";
const METHOD_URL = "https://nicksoin.github.io/SteamTopWishlistsRank/";

const EMPTY_VALUE = "\u2014";

document.getElementById("link-issues").href = ISSUES_URL;
document.getElementById("link-method").href = METHOD_URL;

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
  const updatedAtEl = document.getElementById("updated-at");
  const currentEntryCountEl = document.getElementById("current-entry-count");
  const releasedEntryCountEl = document.getElementById("released-entry-count");
  const prereleaseEntryCountEl = document.getElementById("prerelease-entry-count");
  const trackingSinceEl = document.getElementById("tracking-since");
  const staleEl = document.getElementById("stale-notice");

  const updatedAt = meta.current?.updatedAt || meta.generatedAt;
  updatedAtEl.textContent = updatedAt ? formatDate(updatedAt) : EMPTY_VALUE;
  currentEntryCountEl.textContent = formatCount(meta.current?.entryCount);
  releasedEntryCountEl.textContent = formatCount(meta.released?.entryCount);
  prereleaseEntryCountEl.textContent = formatCount(meta.preRelease?.entryCount);
  trackingSinceEl.textContent = meta.trackingSince ? formatTrackingDate(meta.trackingSince) : EMPTY_VALUE;

  if (meta.stale) staleEl.style.display = "block";
}

function renderUnavailable() {
  document.getElementById("updated-at").textContent = EMPTY_VALUE;
  document.getElementById("current-entry-count").textContent = EMPTY_VALUE;
  document.getElementById("released-entry-count").textContent = EMPTY_VALUE;
  document.getElementById("prerelease-entry-count").textContent = EMPTY_VALUE;
  document.getElementById("tracking-since").textContent = EMPTY_VALUE;
}

function formatCount(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-US") : EMPTY_VALUE;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return iso;
  }
}

function formatTrackingDate(isoDate) {
  try {
    return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  } catch {
    return isoDate;
  }
}
