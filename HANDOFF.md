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

## Sources (15)

Keyless: `met`, `artic`, `cleveland`, `rijksmuseum`, `nationalgallery`,
`whitney`, `smk`, `vam`, `japansearch`, `wikidata`.
Need a key in `.env`: `harvard` (`HARVARD_API_KEY`), `smithsonian`
(`SMITHSONIAN_API_KEY`), `tepapa` (`TEPAPA_API_KEY`), `europeana` and
`europeana-archives` (both `EUROPEANA_API_KEY`). A source with no key is
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
- The Art Institute of Chicago 403.
- `npm audit` reports 9 vulnerabilities (1 critical). `npm audit --omit=dev` shows only those in shipped code.
- npm warns that `esbuild` and `fsevents` have unapproved install scripts. The build works regardless.

**Next**

1. Finish the checks above.
2. Commit the fix on its own branch; consider a PR to upstream.
3. Start on new sources, using the Status column in the dev-notes survey and the key checklist in `keys-in-keychain.md` (section 8).

## Providers added (2026-11-07/08)

Branch chain, each on top of the last, none pushed or sent upstream yet:
`add-new-apis` (National Gallery, London) → `add-whitney` → `add-smk` →
`add-europeana`. Dev notes for each are in
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

## Known source problems

- **Cloudflare bot challenges (403 with `cf-mitigated: challenge`)** block:
  Art Institute of Chicago search (and images), Auckland Museum, Museums
  Victoria, Library of Congress. Not worked around. Auckland's API docs are in
  the dev notes `clippings/`.
- **RISD Museum**: the search endpoint works, but real responses carry no image
  URLs despite the docs listing `images`. Metadata-only; Kim is happy to add it
  that way (not built).
- **Getty Museum**: Linked Art, but no search endpoint; search needs SPARQL.
  Rijksmuseum is also Linked Art, so a shared reader is worth designing.
- **UK Museum Data Service**: key is in Keychain (`MUSEUMDATASERVICE_API_KEY`);
  not yet probed or built.
- Harvard image fetches occasionally time out at 30s; search and detail are fine.

## Next

1. Commit this file; push the branch chain; PR the providers upstream if wanted.
2. RISD (metadata only), then the Museum Data Service.
3. Decide the facets plan (shape, date policy, when to start).

## Running locally

- Keys live in the macOS Keychain. Run with them via
  `~/bin/mcp-keychain.sh HARVARD_API_KEY SMITHSONIAN_API_KEY TEPAPA_API_KEY EUROPEANA_API_KEY -- npm run smoke`
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
