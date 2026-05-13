(function (root) {
  "use strict";

  const WISHLIST_BANDS = Object.freeze([
    { maxRank: 1,    estimate: "4m+"   },
    { maxRank: 10,   estimate: "1.5m+" },
    { maxRank: 20,   estimate: "800k+" },
    { maxRank: 50,   estimate: "600k+" },
    { maxRank: 100,  estimate: "300k+" },
    { maxRank: 200,  estimate: "200k+" },
    { maxRank: 500,  estimate: "80k+"  },
    { maxRank: 1000, estimate: "40k+"  },
    { maxRank: 1500, estimate: "25k+"  },
    { maxRank: 2000, estimate: "15k+"  },
    { maxRank: 3000, estimate: "7k+"   }
  ]);

  const ENTITY_MAP = Object.freeze({
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " "
  });

  function toRankNumber(rank) {
    const value = Number(String(rank ?? "").replace(/[,#\s]/g, ""));
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function estimateWishlists(rank) {
    const value = toRankNumber(rank);
    if (!value) return null;

    const band = WISHLIST_BANDS.find((item) => value <= item.maxRank);
    return band ? band.estimate : "<7k";
  }

  function parseRankFromText(text) {
    const cleaned = decodeHtmlEntities(text)
      .replace(/\s+/g, " ")
      .trim();
    const match = cleaned.match(/^#?\s*(\d{1,5})(?:[.)])?\b/);
    return match ? toRankNumber(match[1]) : null;
  }

  function decodeHtmlEntities(value) {
    return String(value ?? "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, entity) => {
      const lower = entity.toLowerCase();

      if (lower[0] === "#") {
        const isHex = lower[1] === "x";
        const codePoint = Number.parseInt(lower.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
      }

      return Object.prototype.hasOwnProperty.call(ENTITY_MAP, lower) ? ENTITY_MAP[lower] : all;
    });
  }

  function stripTags(value) {
    return decodeHtmlEntities(value)
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function parseAppIdFromRowHtml(rowHtml) {
    const dataMatch = rowHtml.match(/\bdata-appid=["']?(\d{1,12})/i);
    if (dataMatch) return dataMatch[1];

    const hrefMatch = rowHtml.match(/href=["'][^"']*\/app\/(\d{1,12})(?:[\/?#][^"']*)?["']/i);
    return hrefMatch ? hrefMatch[1] : null;
  }

  function parseRankFromRowHtml(rowHtml) {
    const dataRank = rowHtml.match(/\bdata-(?:rank|position|order)=["']?(\d{1,5})/i);
    if (dataRank) return toRankNumber(dataRank[1]);

    const firstCell = rowHtml.match(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/i);
    if (firstCell) {
      const rank = parseRankFromText(stripTags(firstCell[1]));
      if (rank) return rank;
    }

    return parseRankFromText(stripTags(rowHtml));
  }

  function pickNameFromRowHtml(rowHtml, appId) {
    const escapedAppId = escapeRegExp(appId);
    const appLinkPattern = new RegExp(
      `<a\\b[^>]*href=["'][^"']*/app/${escapedAppId}(?:[\\/?#][^"']*)?["'][^>]*>([\\s\\S]*?)<\\/a>`,
      "gi"
    );
    let bestName = "";
    let match;

    while ((match = appLinkPattern.exec(rowHtml))) {
      const text = stripTags(match[1]);
      if (text.length > bestName.length) bestName = text;
    }

    return bestName || null;
  }

  function createEntry(appId, rank, name, source) {
    const normalizedRank = toRankNumber(rank);
    if (!normalizedRank) return null;

    return {
      appId: String(appId),
      rank: normalizedRank,
      estimate: estimateWishlists(normalizedRank),
      name: name || null,
      source
    };
  }

  function parseRankingsFromSteamDbHtml(html) {
    const source = "steamdb_html";
    const entries = {};
    const rows = String(html ?? "").match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
    let fallbackRank = 0;

    for (const rowHtml of rows) {
      const appId = parseAppIdFromRowHtml(rowHtml);
      if (!appId || entries[appId]) continue;

      fallbackRank += 1;
      const rank = parseRankFromRowHtml(rowHtml) || fallbackRank;
      const entry = createEntry(appId, rank, pickNameFromRowHtml(rowHtml, appId), source);
      if (entry) entries[appId] = entry;
    }

    if (Object.keys(entries).length > 0) return entries;

    const linkPattern = /href=["'][^"']*\/app\/(\d{1,12})(?:[\/?#][^"']*)?["'][^>]*>([\s\S]*?)<\/a>/gi;
    let linkMatch;
    let linkRank = 0;

    while ((linkMatch = linkPattern.exec(String(html ?? "")))) {
      const appId = linkMatch[1];
      if (entries[appId]) continue;

      linkRank += 1;
      const entry = createEntry(appId, linkRank, stripTags(linkMatch[2]) || null, source);
      if (entry) entries[appId] = entry;
    }

    return entries;
  }

  function parseRankingsFromSteamSearchHtml(html, offset = 0) {
    const source = "steam_popularwishlist";
    const entries = {};
    const rows =
      String(html ?? "").match(/<a\b[^>]*class=["'][^"']*\bsearch_result_row\b[^"']*["'][\s\S]*?<\/a>/gi) ||
      [];

    rows.forEach((rowHtml, index) => {
      const appId = parseSteamSearchAppId(rowHtml);
      if (!appId || entries[appId]) return;

      const rank = Number(offset) + index + 1;
      const entry = createEntry(appId, rank, parseSteamSearchTitle(rowHtml), source);
      if (entry) entries[appId] = entry;
    });

    return entries;
  }

  function parseSteamSearchAppId(rowHtml) {
    const dataMatch = rowHtml.match(/\bdata-ds-appid=["']?(\d{1,12})/i);
    if (dataMatch) return dataMatch[1];

    return parseAppIdFromRowHtml(rowHtml);
  }

  function parseSteamSearchTitle(rowHtml) {
    const titleMatch = rowHtml.match(/<span\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    return titleMatch ? stripTags(titleMatch[1]) || null : null;
  }

  const api = {
    WISHLIST_BANDS,
    createEntry,
    estimateWishlists,
    parseRankFromText,
    parseRankingsFromSteamDbHtml,
    parseRankingsFromSteamSearchHtml,
    stripTags,
    toRankNumber
  };

  root.SteamWishlistRankShared = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
