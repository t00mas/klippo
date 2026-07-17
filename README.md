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
| Vinted     | JSON-LD                       | title, price, condition, brand, desc               |
| Most shops | JSON-LD / OpenGraph fallback  | whatever the page exposes (thin but universal)     |

The `source` field in the output tells you which path produced the data.

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

### Rebuild the minified bookmarklet

```sh
npx terser src/klippo.js -c -m -o /tmp/out.js
# prepend `javascript:` to the result and paste into dist/klippo.min.js
```

## License

MIT — see [LICENSE](LICENSE).
