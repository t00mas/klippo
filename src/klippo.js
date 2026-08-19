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

(async () => {
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

  // Amazon ships no product JSON-LD; read the DOM instead.
  const amazon = {
    match: (h) => h.includes('amazon.'),
    extract() {
      const q = (s) => document.querySelector(s);
      const txt = (s) => q(s)?.textContent?.trim().replace(/\s+/g, ' ');
      const title = txt('#productTitle');
      if (!title) return null;
      const asin =
        location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)?.[1] ||
        q('#ASIN')?.value;
      const brand = (txt('#bylineInfo') || '')
        .replace(/^(Marca:|Brand:|Visita la (?:tienda|Store) de|Visit the)\s*/i, '')
        .replace(/\s+(?:Store|tienda)$/i, '');
      const features = [...document.querySelectorAll('#feature-bullets li')]
        .map((li) => li.textContent.trim())
        .filter(Boolean);
      return {
        title,
        price: q('#corePrice_feature_div .a-offscreen, .a-price .a-offscreen')
          ?.textContent?.trim(),
        brand: brand || undefined,
        rating: q('#acrPopover')?.title?.trim(),
        reviews: txt('#acrCustomerReviewText')?.replace(/[()]/g, ''),
        availability: txt('#availability'),
        features: features.length ? features : undefined,
        asin,
        url: asin ? `${location.origin}/dp/${asin}` : location.href.split('?')[0],
        source: 'amazon',
      };
    },
  };

  // eBay: JSON-LD covers title/price/condition/brand, but the item
  // description lives in a cross-origin iframe (ebaydesc.com) a bookmarklet
  // can't read. So we add the item-specifics table (same-origin, structured)
  // and expose the description iframe URL for an agent to fetch separately.
  const ebay = {
    match: (h) => h.includes('ebay.'),
    extract() {
      const p = findProduct();
      const specs = {};
      // .ux-labels-values is reused by the shipping/returns/payments/condition
      // modules, so prefer the item-specifics section; fall back to all rows
      // but blocklist those module labels (es + en) and drop wall-of-text
      // values (shipping blurbs run to hundreds of chars).
      const skip =
        /^(env[íi]o|shipping|tarifas de importaci[óo]n|import charges|entrega|delivery|devoluciones|returns|pagos|payments|estado|condition|ubicaci[óo]n|located in)$/i;
      const feat = document.querySelectorAll(
        '.ux-layout-section-evo--features .ux-labels-values',
      );
      const rows = feat.length
        ? feat
        : document.querySelectorAll('.ux-labels-values');
      rows.forEach((row) => {
        const k = row
          .querySelector('.ux-labels-values__labels')
          ?.textContent?.trim()
          .replace(/:$/, '');
        const v = row
          .querySelector('.ux-labels-values__values')
          ?.textContent?.trim();
        if (k && v && v.length <= 120 && !skip.test(k)) specs[k] = v;
      });
      const q = (s) =>
        document.querySelector(s)?.textContent?.trim().replace(/\s+/g, ' ');
      const title = p?.name || q('h1 .ux-textspans--BOLD') || q('h1');
      if (!title) return null;
      const descUrl = document.querySelector(
        'iframe[id*="desc"],iframe[src*="ebaydesc"]',
      )?.src;
      return {
        title,
        price: p ? price(p.offers?.price, p.offers?.priceCurrency) : q('.x-price-primary'),
        condition:
          condition(p?.offers?.itemCondition) || specs['Estado'] || specs['Condition'],
        brand: p?.brand?.name || p?.brand || specs['Marca'] || specs['Brand'],
        specs: Object.keys(specs).length ? specs : undefined,
        descUrl,
        url: p?.offers?.url || location.href.split('?')[0],
        source: 'ebay',
      };
    },
  };

  // Vinted catalog (search/browse grid). The cards are client-rendered and
  // carry no per-item structured data, so ask Vinted's own JSON API with the
  // current filters. Same-origin fetch => the session cookie rides along and
  // we get exactly the list the page is showing.
  const vintedCatalog = {
    match: (h) => h.includes('vinted.'),
    async extract() {
      if (!/^\/catalog/.test(location.pathname)) return null;

      // Filters live in the query string (`catalog[]=2994&order=newest_first`);
      // the catalog id can also be baked into the path (/catalog/2994-slug).
      const qs = new URLSearchParams(location.search);
      const api = new URLSearchParams();
      const ids = [
        ...qs.getAll('catalog[]'),
        ...(location.pathname.match(/\/catalog\/(\d+)/)?.slice(1) || []),
      ];
      if (ids.length) api.set('catalog_ids', [...new Set(ids)].join(','));
      // Pass the rest through: brand_ids[], status_ids[], price_to,
      // search_text... The API takes the same names without the `[]`.
      for (const [k, v] of qs) {
        if (k === 'catalog[]') continue;
        api.append(k.replace(/\[\]$/, ''), v);
      }
      api.set('order', qs.get('order') || 'newest_first');
      api.set('per_page', qs.get('per_page') || '48');
      api.set('page', qs.get('page') || '1');

      const res = await fetch(`/api/v2/catalog/items?${api}`, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!res.ok) return null;
      const items = (await res.json()).items || [];
      if (!items.length) return null;

      return {
        query: Object.fromEntries(api),
        count: items.length,
        items: items.map((i) => ({
          title: i.title,
          // price = asking price; total = what the buyer pays incl. fees.
          price: price(i.price?.amount, i.price?.currency_code),
          total: price(i.total_item_price?.amount, i.total_item_price?.currency_code),
          brand: i.brand_title || undefined,
          size: i.size_title || undefined,
          condition: i.status || undefined,
          // The catalog endpoint sends no view count, and most cards have no
          // favourites yet. Keep the number only when it carries a signal.
          favorites: i.favourite_count || undefined,
          seller: i.user?.login,
          url: i.url || `${location.origin}/items/${i.id}`,
        })),
        url: location.href,
        source: 'vinted-catalog',
      };
    },
  };

  // Fallback for the same grid if the API call fails or its shape moves:
  // every card is an anchor to /items/<id> whose title attribute holds the
  // full descriptor ("Brand, size, condition, price"). Thin but stable.
  const vintedCatalogDom = {
    match: (h) => h.includes('vinted.'),
    extract() {
      if (!/^\/catalog/.test(location.pathname)) return null;
      const seen = new Set();
      const items = [];
      for (const a of document.querySelectorAll('a[href*="/items/"]')) {
        const id = a.getAttribute('href').match(/\/items\/(\d+)/)?.[1];
        const desc = a.title || a.getAttribute('aria-label');
        if (!id || !desc || seen.has(id)) continue;
        seen.add(id);
        items.push({
          desc: desc.replace(/\s+/g, ' ').trim(),
          url: `${location.origin}/items/${id}`,
        });
      }
      if (!items.length) return null;
      return { count: items.length, items, url: location.href, source: 'vinted-catalog-dom' };
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

  const ADAPTERS = [
    wallapop,
    amazon,
    ebay,
    vintedCatalog,
    vintedCatalogDom,
    jsonLdProduct,
    ogMeta,
  ];

  // --- run -----------------------------------------------------------------

  try {
    const host = location.hostname;
    let out = null;
    for (const a of ADAPTERS) {
      if (!a.match(host)) continue;
      // An adapter may be async (network); an adapter that throws just means
      // "not my page", so fall through to the next one.
      try {
        out = await a.extract();
      } catch {
        out = null;
      }
      if (out) break;
    }
    if (!out) {
      alert('klippo: no data found on this page');
      return;
    }
    const json = JSON.stringify(out, null, 2);
    const tag = `${out.source}${out.count ? `, ${out.count} items` : ''}`;
    try {
      await navigator.clipboard.writeText(json);
      alert(`klippo v4: copied ${json.length} chars (${tag})`);
    } catch {
      // An async adapter spends the click's user activation, which Firefox
      // needs for clipboard writes. Fall back to a selected textarea so the
      // user can copy with one keystroke.
      const t = document.createElement('textarea');
      t.value = json;
      t.style.cssText =
        'position:fixed;inset:5%;z-index:2147483647;width:90%;height:90%';
      t.addEventListener('copy', () => t.remove());
      document.body.append(t);
      alert(`klippo v4: press cmd/ctrl+C to copy ${json.length} chars (${tag})`);
      // Select after the alert: dismissing it takes the focus away.
      t.focus();
      t.select();
    }
  } catch (e) {
    alert('klippo err: ' + e.message);
  }
})();
