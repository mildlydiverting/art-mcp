# Handover

Last updated: 2026-11-04

## What this is

Kim's fork of `puf3zin/art-mcp`: an MCP server that searches museum
collections. Fork is `mildlydiverting/art-mcp` (remote `origin`); the original
is remote `upstream`.

## Layout

- `src/providers/*.ts`: one file per museum source. `index.ts` lists them all.
- `src/lib/`: shared helpers (HTTP, images, IIIF, concurrency).
- `src/scripts/smoke.ts`: live smoke test. Run with `npm run smoke`.
- `.env.example`: shows which API keys exist.

## Sources (11)

`met`, `artic`, `cleveland`, `rijksmuseum`, `nationalgallery`, `vam`,
`japansearch`, `wikidata` need no key. `harvard`, `smithsonian`, `tepapa` need a key in `.env`
(`HARVARD_API_KEY`, `SMITHSONIAN_API_KEY`, `TEPAPA_API_KEY`). A source with
no key is skipped, not an error.

## Recent changes (2026-11-04/05)

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

## Next source: National Gallery, London (designed, not built)

Design agreed 2026-11-07. Work on `add-new-apis`, not `main`. Full API notes and sample responses are in the dev notes: `/Users/kimplowright/Development/_development-notes/art-mcp/providers/nationalgallery.md` (raw samples in `ng-london-raw/` beside it).

- New file `src/providers/nationalgallery.ts`: source id `nationalgallery`, name "National Gallery, London", no key (`isAvailable()` returns true). Model it on `rijksmuseum.ts`.
- Also touch: `SOURCES` in `src/types.ts`, `src/providers/index.ts`, the README source table, `src/scripts/smoke.ts` (add a sample query), and this file (Sources: 11). `.env.example` needs nothing.
- **Search:** one POST to `https://data.ng.ac.uk/es/public/_search` (Elasticsearch 7.17 syntax; use `postJson`). A hit is a full record, so there is no second fetch. Filter `@datatype.base` = `object`. Free text: `multi_match` over `summary.title`, `title.value`, `creation.maker.summary.title`, `description.value`, `subject.summary.title`, `genre.summary.title`. Limit the payload with `_source.includes`; a full hit is about 76 KB.
- **Get:** `https://data.ng.ac.uk/{PID}?profile=ciim-json` should return the same CIIM shape as a search hit, so one mapper serves both. IDs are PIDs such as `0F6J-0001-0000-0000`. Also accept an object number such as `NG35` by searching `identifier.value`.
- **Link:** `https://data.ng.ac.uk/{PID}.html`, which redirects to the Gallery's own page when there is one.
- **Rights:** images CC BY-NC-ND 4.0, descriptions CC BY 4.0, data CC0. Put that in `license`; leave `isPublicDomain` unset.
- **Images:** IIIF at `https://data.ng.ac.uk/iiif/3/{image PID}/full/{width},/0/default.jpg`, with the image PID from `multimedia[0]["@admin"].uid`. Only when `access.media.public_image` is true. The Gallery's own docs disagree on whether IIIF works yet.

**Check once built.** None of these could be tested from the sandbox.

- [ ] POST to `_search` is accepted. The docs show GET with a body, which Node `fetch` can't send. If POST is refused, use the `_q`/`_source` URL parameters.
- [ ] The IIIF image URL serves a JPEG. If not, return no image rather than a broken link.
- [ ] `?profile=ciim-json` returns the same shape as a search hit.
- [ ] Free-text results look relevant: "centaur" returned 5 objects with a plain `query_string`; the maker query for "Titian" returned 22.
- [ ] `npm run smoke` passes for the new source.

## Running locally

- Keys live in the macOS Keychain. Run with them via
  `~/bin/mcp-keychain.sh HARVARD_API_KEY SMITHSONIAN_API_KEY TEPAPA_API_KEY -- npm run smoke`
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
