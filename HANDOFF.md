# Handover

Last updated: 2026-11-08

## What this is

Kim's fork of `puf3zin/art-mcp`: an MCP server that searches museum
collections. Fork is `mildlydiverting/art-mcp` (remote `origin`); the original
is remote `upstream`.

## Layout

- `src/providers/*.ts`: one file per museum source. `index.ts` lists them all.
- `src/lib/`: shared helpers (HTTP, images, IIIF, concurrency).
- `src/scripts/smoke.ts`: live smoke test. Run with `npm run smoke`.
- `.env.example`: shows which API keys exist.

## Sources (18)

Keyless: `met`, `artic`, `cleveland`, `rijksmuseum`, `nationalgallery`,
`whitney`, `smk`, `risd`, `getty`, `vam`, `japansearch`, `wikidata`.
Need a key in `.env`: `harvard` (`HARVARD_API_KEY`), `smithsonian`
(`SMITHSONIAN_API_KEY`), `tepapa` (`TEPAPA_API_KEY`), `europeana` and
`europeana-archives` (both `EUROPEANA_API_KEY`), `parismusees`
(`PARISMUSEES_API_KEY`). A source with no key is
skipped, not an error.

`europeana-archives` (library and archive material) is **only searched when
named**: `all` skips it. It uses the optional `Provider.onlyWhenNamed` flag.

## Fixes (2026-11-04/05)

All three are on `main` in the fork and sent upstream as separate PRs.

1. **Met search.** The Met retired `/v1/search` on 2026-10-01 (410 Gone).
   Search now uses `/v1.1/search` with a `limit`. `/objects/{id}` is still v1.
   Upstream: https://github.com/puf3zin/art-mcp/pull/2
2. **Cooper Hewitt links** (`smithsonian.ts`). `record_link` for CHNDM records
   points at a retired site that redirects to a generic page. Links are now
   `https://www.si.edu/object/<slug>:<record_ID>`; the slug is cosmetic.
   Checked in the app with the Giani drawings, accented and Chinese titles.
3. **Image size and timeouts.** `get_artwork_image` was fetching originals
   (12MB for a Smithsonian drawing), which overran Claude Desktop's 60s wait.
   Met and Smithsonian `imageUrl` are now web-sized; the original is
   `fullImageUrl` on `get_artwork`. The HTTP timeout now covers the response
   body (it used to stop at headers). Other sources were already bounded.

Not yet checked: Smithsonian links for units other than CHNDM (one per
`record_link` host), and the `edanmdm-` fallback in the Cooper Hewitt fix,
which assumes a record ID format that has not been confirmed.

### Cooper Hewitt link fix (2026-11-04)

Cooper Hewitt (`CHNDM`) links from the Smithsonian source went to a generic page. `museumUrlOf()` in `src/providers/smithsonian.ts` now builds `https://www.si.edu/object/<slug>:<record_ID>` for those records (the slug is ignored; the record ID does the lookup). `record_ID` was added to `EdanRow`. Build is clean; `npm run smoke` shows only the Art Institute of Chicago 403.

## ToDo

- [x] Giani pair (`chndm_1901-39-497` and `-498`): `get_artwork` links carry the matching record IDs (2026-11-06). Not opened in a browser.
- [ ] `search_artworks` returns the fixed link, not only `get_artwork`.
- [ ] A title with accents or punctuation; an empty title (slug falls back to `object`).
- [ ] One link per other Smithsonian host, to confirm they are unchanged (hosts listed in the provider note).
- [ ] The fallback when `record_ID` is missing. It strips `edanmdm-` from `row.id`, but the ids seen are `ld1-...`.
- [ ] The concurrent image-call problem: re-test on `main` to see whether it predates this change.

**Git: check before committing**

- Run `git branch` and `git status`: it isn't known which branch the edit was made on. Before this work `main` was one commit ahead of `origin/main`; the branches `add-new-apis` and `fix-cooper-hewitt-links` (suggested) exist or were proposed.
- Keep the fix on its own branch from `upstream/main` so it can go upstream as a standalone PR.
- `git diff` should show only `src/providers/smithsonian.ts`: no `dist` files, no keys.

**Not investigated**

- Smithsonian lookups by accession number (`chndm_1901-39-497`) return not found; `edanmdm:chndm_1901-39-497` works. Results show the `ld1-...` ID.
- Art Institute of Chicago 403: fixed by sending its documented `AIC-User-Agent`
  header (`src/lib/http.ts`, `fix/artic-user-agent`). Without it Cloudflare
  challenges the API and the images.
- `npm audit` reports 9 vulnerabilities (1 critical). `npm audit --omit=dev` shows only those in shipped code.
- npm warns that `esbuild` and `fsevents` have unapproved install scripts. The build works regardless.

**Next**

1. Finish the checks above.
2. Commit the fix on its own branch; consider a PR to upstream.
3. Start on new sources, using the Status column in the dev-notes survey and the key checklist in `keys-in-keychain.md` (section 8).

## Providers added (2026-11-07/08)

Branch chain, each on top of the last, 
`add-new-apis` (National Gallery, London) → `add-whitney` → `add-smk` →
`add-europeana` → `add-risd`, then `use-linkedart-js` → `add-getty` (cut from
`add-risd`). All pushed to the fork `origin`, none sent upstream. Dev notes for each are in
`/Users/kimplowright/Development/_development-notes/art-mcp/`.

- **National Gallery, London** (`nationalgallery`): Elasticsearch POST; IIIF
  v3 images (`full/max`, `full/200,`; a fixed width above the original needs `^`).
  Uses `creation.attribution` so "workshop of" is not credited to the master.
- **Whitney** (`whitney`): Ransack filters, no free text, so each query word
  becomes a per-field filter. Search is metadata plus images.
- **SMK, National Gallery of Denmark** (`smk`): REST plus IIIF v2. Artist is
  built from `production[]` to keep "copy after" and "follower of". Many
  records (mostly prints and drawings) have no image.
- **Europeana** (`europeana`, `europeana-archives`): aggregator, so results
  overlap museums we search directly. Key sent in the `X-Api-Key` header. Many
  records lack a maker. Thumbnail service gives 200px and 400px only.

Searches by one query string only. The shared filters and content types plan is
in `plan-facets-and-content-types.md` (dev notes); nothing built, awaiting
Kim's decisions.

## Paris Musées (2026-11-19)

Branch `add-parismusees`, cut from `main`. `parismusees`, key
`PARISMUSEES_API_KEY` (Keychain), sent in an `auth-token` header.

- GraphQL on Drupal (`https://apicollections.parismusees.paris.fr/graphql`).
  Search is `searchAPISearch` on index `collections`, filtered with
  `type_contenu_chaine_s = oeuvre`; detail is `nodeById` with the `fieldCartel*`
  label strings. One request each: the public quota is 1,000 a day.
- Rights per image: `fieldImageLibre` true (`fieldImageDroits` "CC0 Paris
  Musées / …") or null. Only free images get `imageUrl` and a licence.
- `fieldMediaImage` is null on the public API, so no derivatives: `imageUrl`
  is the ~3MB original from the public website.
- Boolean conditions in `searchAPISearch` ignore `false`; filter in code.
- Probe scripts, schema introspection and sample responses are in the dev
  notes, `art-mcp-notes/clippings/parismusees/`.
- The index can return one artwork several times ("Lavacourt" gave 226737
  three times), so search fetches 3x the limit and de-duplicates.
- Checked live 2026-11-19: search, detail, image (3MB, 6s). Query variables
  work. `conjunction: "AND"` narrows multi-word searches ("Carnavalet
  enseigne": 149 results with it, 19,465 without).
- The server sometimes returns a bare 500 for a valid request that succeeds
  when repeated. open-museum-mcp retries once; this provider does not.

## Known source problems

- **Cloudflare bot challenges (403 with `cf-mitigated: challenge`)** block:
  Auckland Museum, Museums Victoria, Library of Congress. Not worked around;
  worth rereading each one's docs for a required identification header (the
  Art Institute of Chicago turned out to need one). Auckland's API docs are in
  the dev notes `clippings/`.
- **Cloudflare, tested again 2026-11-09:** Auckland and the Library of Congress
  are still challenged from Kim's phone hotspot, so it is not her home network.
- **RISD Museum** (`risd`, built): the search endpoint works, but real responses
  carry no image URLs despite the docs listing `images`. Metadata-only, and the
  smoke test skips its image step.
- **Getty Museum** (`getty`, built): the API cannot list or search, so search is
  SPARQL (title and maker, then one summary query, 3-4s). Matching makers across
  all works in one query takes 25s+, so find the person first. A full record is
  about 440KB and is fetched only for detail. Words must all match in a title or
  in a maker name, so "van gogh irises" finds nothing.
- **Linked Art:** `@thegetty/linkedart.js` is a dependency (no bundled types, so
  `src/linkedart.d.ts` declares the helpers used). Rijksmuseum uses it for titles
  and accession numbers, checked identical to a saved baseline. Beware: its
  `getPrimaryName`/`getPrimaryNames` return the text "Unknown (<id>)" when nothing
  matches; use `getValuesByClassification` where a miss must be empty.
- **UK Museum Data Service**: skipped for now. The token in Keychain
  (`MUSEUMDATASERVICE_API_KEY`) is rejected by the Search API (401 invalid
  token); it is probably the Extract token, not a Search API one (that comes
  from the "Request a Search API key" form). Spec at
  `https://api.museumdata.uk/api/spec`: `GET /api/v2/search` (`q`, `field`,
  `filter`, `aggs`, `size`, `from`), `/api/v2/get?pid=`, Bearer auth.
- Harvard image fetches occasionally time out at 30s; search and detail are fine.

## Saved test data (plan, agreed 2026-11-22)

Goal: tests that run without the live APIs, so a change to our code can be
checked offline and in CI. The nightly smoke test stays, to catch museums
changing their APIs.

Approach: record and replay at the `fetch` seam. Every provider fetches
through `request()` in `src/lib/http.ts`, so providers need no changes.

1. **Runner.** Vitest (as in open-museum-mcp): runs TypeScript directly.
   Add `"test": "vitest run"`. Keep Node 18 support in mind when picking the
   Vitest version, or decide to raise `engines`.
2. **Record.** `src/scripts/record-fixtures.ts` (excluded from the package
   like `smoke.ts`). Runs a list of cases (source, `search` query or
   `getArtwork` ID) against the live APIs with keys from Keychain, and saves
   each response to `test/fixtures/<source>/<case>.json`, with the request
   URL alongside. Strip API keys from URLs and bodies before saving (some
   responses carry the key in `next` links); fail if a known key value is
   still present.
3. **Replay.** A test helper stubs `globalThis.fetch` and returns the saved
   body for each URL, matched with the key parameters removed. An unmatched
   URL fails the test with the URL in the message: no silent network calls.
4. **Assert.** Per provider, call `search` / `getArtwork` and check the
   normalised result: title, artist, dates, museum link, image URL, licence.
   Check exact strings for names with diacritics and CJK.
5. **Cases.** Start from the record fixtures and names in the dev note
   `art-mcp-notes/test-fixtures.md` (QIDs and ULAN IDs added 2026-11-22).
   At least one search and one detail per provider. Include known edge cases:
   Smithsonian `edanmdm:` prefix and unprefixed 404; Cooper Hewitt link;
   Wikidata label edge cases (Dürer has no `@en` label, Portinari's English
   label drops the circumflex, Mu Xin is labelled "Muxin").
6. **Images.** `get_artwork_image` fetches binary data. Replay those with a
   tiny placeholder image, or leave them to the smoke test. Decide when
   building.
7. **Re-recording.** Fixtures are a snapshot. Re-record a provider only when
   its test fails because the museum changed, and review the diff.

Order: runner and replay helper with one provider (SMK, no key needed), then
the rest one commit per provider. Build on its own branch from `main`.

## Next

1. PR the providers upstream if wanted (upstream has not acted on PRs #2-#4;
   the Art Institute fix is its own PR from `fix/artic-user-agent`).
2. Museum Data Service, once there is a working Search API token.
3. Decide the facets plan (shape, date policy, when to start).
4. Build the saved test data (see "Saved test data" above).

## Running locally

- Keys live in the macOS Keychain. Run with them via
  `~/bin/mcp-keychain.sh HARVARD_API_KEY SMITHSONIAN_API_KEY TEPAPA_API_KEY EUROPEANA_API_KEY PARISMUSEES_API_KEY -- npm run smoke`
- Claude Desktop runs `dist/index.js`: `npm run build`, then Cmd+Q and reopen.
- Never print API responses unfiltered; some include the key in `next` links.

## Gotchas

- Run `npm install` before `npx tsc --noEmit`; `node_modules` may be missing.
- Don't commit `package-lock.json` changes that `npm install` makes by accident.
- Keep PR branches off `main`: branch from `upstream/main` so only the fix goes
  upstream. This fork's `main` may carry commits upstream doesn't want.
- Other sources may break the same way the Met did. Run `npm run smoke` to
  check them (it makes live calls).
- Rebuild and restart the MCP server after changes, or the client keeps
  running old code.

## Kim's preferences

British English. Short, structured answers. Ask one question at a time. Get
approval before significant rewrites or new files over ~50 lines.
