export const MARKETPLACE_DEFS = {
  sbazar: {
    id: "sbazar",
    name: "Sbazar",
    buildUrl(query) {
      return `https://www.sbazar.cz/hledej/${encodeURIComponent(query)}`;
    },
    selectors: {
      itemSelector: "article",
      titleSelector: "h3, h2, a",
      linkSelector: "a[href]",
      priceSelector: "[class*='price'], [data-e2e*='price']"
    }
  },
  bazos: {
    id: "bazos",
    name: "Bazos",
    buildUrl(query) {
      return `https://www.bazos.cz/search.php?hledat=${encodeURIComponent(query)}`;
    },
    selectors: {
      itemSelector: ".inzeraty.inzeratyflex, .inzerat",
      titleSelector: ".nadpis",
      linkSelector: "a[href]",
      priceSelector: ".inzeratycena, .inzeratcena, .cena"
    }
  }
};

export function buildSourcesForQuery(query, marketplaces) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) return [];

  const sourceList = [];
  for (const marketplaceId of marketplaces || []) {
    const def = MARKETPLACE_DEFS[marketplaceId];
    if (!def) continue;
    sourceList.push({
      id: def.id,
      name: def.name,
      url: def.buildUrl(normalizedQuery),
      ...def.selectors
    });
  }
  return sourceList;
}

export function listSupportedMarketplaces() {
  return Object.values(MARKETPLACE_DEFS).map((def) => ({
    id: def.id,
    name: def.name
  }));
}
