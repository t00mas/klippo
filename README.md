# klippo

Strip marketplace listings to clean, structured JSON for your LLM or other uses.

Browse a listing, click one bookmark, and a compact JSON blob lands on your
clipboard. Paste it into Claude, ChatGPT, a spreadsheet, wherever. No more
copy-pasting a whole page of headers, footers, nav, cookie banners, and
"related items" just to ask "is this a good deal?".

## Why

Comparison shopping across sites (Wallapop, Vinted, ...) means feeding listings
to an LLM. Selecting the whole page (`cmd+A`) drags in ~40KB of junk per page.
klippo reads the structured data the site already ships and emits ~500 bytes of
signal instead.

Example — a cluttered page becomes:

```json
{
  "title": "Example Item",
  "price": "10 EUR",
  "condition": "Good",
  "brand": "Acme",
  "desc": "Short description.",
  "url": "https://example.com/item/123",
  "source": "json-ld"
}
```

## Install (bookmarklet)

Works in Firefox and Chrome. No install, no extension store, no permissions.
Runs in your logged-in session, so it sees pages a headless crawler can't.

1. Show the bookmarks toolbar (`cmd+shift+B` / `ctrl+shift+B`).
2. Copy the entire one line from [`dist/klippo.min.js`](dist/klippo.min.js).
3. Right-click the toolbar → New Bookmark. Name it `klippo`, paste the line as
   the URL. Save.
4. Open a listing → click `klippo` → an alert confirms the copy → paste.

> Firefox sometimes strips the leading `javascript:` on paste. If the bookmark
> does nothing, edit it and make sure the URL still starts with `javascript:`.

## Supported sites

| Site       | Source                        | Fields                                             |
| ---------- | ----------------------------- | -------------------------------------------------- |
| Wallapop   | `__NEXT_DATA__` app state     | title, price, condition, brand, desc, location, views, favorites, shipping, full seller stats |
| Amazon     | DOM scrape                    | title, price, brand, rating, reviews, availability, features, ASIN, clean `/dp/ASIN` URL |
| eBay       | JSON-LD + item-specifics DOM  | title, price, condition, brand, item specifics, description iframe URL* |
| Vinted (listing) | JSON-LD                 | title, price, condition, brand, desc               |
| Vinted (catalog) | Vinted JSON API†        | one entry per grid card: title, price, total price with fees, brand, size, condition, listing age, photo count, favorites, seller, business-seller and promoted flags, item URL |
| Most shops | JSON-LD / OpenGraph fallback  | whatever the page exposes (thin but universal)     |

The `source` field in the output tells you which path produced the data.

† On a `/catalog` page klippo asks Vinted's own API (`/api/v2/catalog/items`)
with the filters that are in the URL, so you get the same list the page shows,
in the same order. Sort by newest, set your filters, click klippo, and paste a
whole page of listings into an LLM in one go:

```
https://www.vinted.es/catalog/3564-computers-and-accessories?order=newest_first
https://www.vinted.es/catalog?catalog[]=3564&order=newest_first
```

Both URL shapes work (`3564` is Computers & accessories). klippo reads the
catalog id from the path or from `catalog[]`, and forwards every other filter
in the URL (`brand_ids[]`, `status_ids[]`, `price_to`, `search_text`, ...).

A field appears only when it carries a signal, so an empty count or a false
flag costs you no tokens. Read `age` (time since the main photo went up, the
closest thing the endpoint has to a creation date) with `promoted`: an advert
ignores the newest-first order, so it looks fresher than it is. `business`
marks a reseller who prices at retail.

`age` also exposes a bump. A seller can push an old listing back to the top of
the newest-first order, but the photo keeps its original upload time. A card
that sits among 10-minute items with an age of `1d` is a relist, not a find.

`per_page` defaults to 48; add `&per_page=96` to the page URL to grab more. The
call runs in your session, so it needs no token. If it fails, klippo falls back
to scraping the grid anchors (`source: vinted-catalog-dom`, description string
and URL only).

\* eBay serves its item description from a cross-origin iframe
(`ebaydesc.com`), which a bookmarklet cannot read. klippo emits the iframe's
`descUrl` instead so you (or an agent) can fetch it separately; the
item-specifics table usually covers the same ground more cleanly.

## How it works

One bookmarklet. On click it picks the first matching **adapter** by hostname,
each reading whatever structured data the page already ships (embedded app
state, JSON-LD, or OpenGraph meta) and mapping it to a small flat object. If an
adapter finds nothing it falls through to the next; the last two (JSON-LD, then
OpenGraph) are near-universal fallbacks.

- Readable source: [`src/klippo.js`](src/klippo.js)
- Paste-ready minified: [`dist/klippo.min.js`](dist/klippo.min.js)

## Add a site

In [`src/klippo.js`](src/klippo.js), add an adapter before the fallbacks:

```js
const mysite = {
  match: (host) => host.includes('mysite'),
  extract() {
    // read the page, return a flat object — or null to skip to the next adapter
    return { title: ..., price: ..., url: location.href, source: 'mysite' };
  },
};
```

Then push it into `ADAPTERS` ahead of the JSON-LD/OpenGraph fallbacks.
`extract` can be `async` if the adapter must call the site's own API. An
adapter that throws is treated as "not my page", so klippo tries the next one.

### Rebuild the minified bookmarklet

```sh
npx terser src/klippo.js -c -m -o /tmp/out.js
# prepend `javascript:` to the result and paste into dist/klippo.min.js
```

## License

MIT — see [LICENSE](LICENSE).
