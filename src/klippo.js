// klippo — strip marketplace listings to clean, structured JSON.
//
// This is the readable source. The paste-ready bookmarklet lives in
// dist/klippo.min.js (same logic, minified, prefixed with `javascript:`).
//
// How it works: on click, pick an adapter by hostname. Each adapter reads
// whatever structured data the site already ships (embedded app state,
// JSON-LD, OpenGraph meta) and maps it to a small flat object. Result is
// copied to the clipboard as pretty JSON, ready to paste into an LLM.
//
// Add a site: write an adapter { match, extract } and push it to ADAPTERS
// before the generic fallback. `extract` returns an object or null (null =
// "I don't apply here, try the next adapter").

(() => {
  // --- helpers -------------------------------------------------------------

  // Meta tag content by property or name (OpenGraph / product meta).
  const meta = (n) =>
    document.querySelector(`meta[property="${n}"],meta[name="${n}"]`)?.content;

  // All JSON-LD blocks on the page, flattened (handles arrays and @graph).
  const jsonLd = () =>
    [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap(
      (s) => {
        try {
          const j = JSON.parse(s.textContent);
          return Array.isArray(j) ? j : j['@graph'] || [j];
        } catch {
          return [];
        }
      },
    );

  const findProduct = () =>
    jsonLd().find((x) => x && /product/i.test(x['@type'] || ''));

  // Trim schema.org condition URLs down to the bare word: NewCondition -> New.
  const condition = (c) =>
    (c || '').split('/').pop().replace(/Condition$/, '') || undefined;

  const price = (amount, currency) =>
    amount != null ? `${amount} ${currency || ''}`.trim() : undefined;

  // --- adapters ------------------------------------------------------------

  const wallapop = {
    match: (h) => h.includes('wallapop'),
    extract() {
      const el = document.getElementById('__NEXT_DATA__');
      if (!el) return null;
      const pp = JSON.parse(el.textContent).props.pageProps;
      const i = pp.item;
      if (!i) return null;
      const s = pp.itemSeller || {};
      const d = pp.itemDeliveryInfo || {};
      return {
        title: i.title?.original,
        price: price(i.price?.cash?.amount, i.price?.cash?.currency),
        condition: i.condition?.text,
        brand: i.brand,
        model: i.model,
        desc: i.description?.original,
        city: i.location?.city,
        country: i.location?.countryCode,
        views: i.views,
        favorites: i.favorites,
        shipping: (d.deliveryOptions || [])
          .map((x) => `${x.method} ${x.cost?.amount}${x.cost?.currency}`)
          .join(', '),
        seller: {
          name: s.microName,
          type: s.sellerType,
          rating: s.stats?.ratingAverage,
          sales: s.stats?.counters?.sells,
          reviews: s.stats?.counters?.reviews,
          verified: s.verified,
        },
        url: location.href,
        source: 'wallapop',
      };
    },
  };

  // Works for Vinted and most schema.org e-commerce (eBay, many shops).
  const jsonLdProduct = {
    match: () => true,
    extract() {
      const p = findProduct();
      if (!p) return null;
      return {
        title: p.name,
        price: price(p.offers?.price, p.offers?.priceCurrency),
        condition: condition(p.offers?.itemCondition || p.itemCondition),
        brand: p.brand?.name || p.brand,
        desc: p.description,
        seller: p.offers?.seller?.name,
        url: p.offers?.url || location.href,
        source: 'json-ld',
      };
    },
  };

  // Last resort: OpenGraph / product meta tags. Thin but near-universal.
  const ogMeta = {
    match: () => true,
    extract() {
      return {
        title: meta('og:title') || document.title,
        price: price(meta('product:price:amount'), meta('product:price:currency')),
        desc: meta('og:description'),
        url: location.href,
        source: 'og-meta',
      };
    },
  };

  const ADAPTERS = [wallapop, jsonLdProduct, ogMeta];

  // --- run -----------------------------------------------------------------

  try {
    const host = location.hostname;
    let out = null;
    for (const a of ADAPTERS) {
      if (!a.match(host)) continue;
      out = a.extract();
      if (out) break;
    }
    if (!out) {
      alert('klippo: no data found on this page');
      return;
    }
    const json = JSON.stringify(out, null, 2);
    navigator.clipboard
      .writeText(json)
      .then(() => alert(`klippo: copied ${json.length} chars (${out.source})`));
  } catch (e) {
    alert('klippo err: ' + e.message);
  }
})();
