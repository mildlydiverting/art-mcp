import { getJson } from "../lib/http.js";
import type { Artwork, ArtworkDetail, Provider } from "../types.js";

// RISD Museum (Rhode Island School of Design). Open API, no key. One endpoint
// returns an array of objects. Its documentation lists an `images` field, but
// live responses carry no image URLs, so this source is metadata only: titles,
// makers, dates, materials, credit lines and a link to the museum's own page.
const BASE = "https://risdmuseum.org/api/v1/collection";

/** The API pages in fixed sizes; 25 is the largest. */
const PAGE_SIZE = 25;

/** Longest description to return. */
const DESCRIPTION_LIMIT = 2_000;

// --- API shapes (only the parts we read) -------------------------------------

interface RisdMaker {
  name?: string | null;
  role?: string | null;
  years?: string | null;
}

interface RisdObject {
  id: string;
  title?: string | null;
  primaryMaker?: string | null;
  makers?: RisdMaker[] | null;
  dating?: string | null;
  culture?: string | null;
  place?: string | null;
  mediumTechnique?: string | null;
  medium?: string[] | null;
  type?: string[] | null;
  dimensions?: string | null;
  credit?: string | null;
  description?: string | null;
  objectNumber?: string | null;
  publicDomain?: string | boolean | null;
  onView?: string | boolean | null;
  url?: string | null;
}

// --- Mapping -----------------------------------------------------------------

/** The API returns booleans as the strings "True" and "False", or null. */
function flag(value: string | boolean | null | undefined): boolean | undefined {
  if (value === true || value === "True") return true;
  if (value === false || value === "False") return false;
  return undefined;
}

const text = (value: string | null | undefined) => value?.trim() || undefined;

/** Descriptions arrive as HTML fragments such as "<p>Coffin of Nesmin</p>". */
function plainText(html: string | null | undefined): string | undefined {
  const plain = html
    ?.replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain || undefined;
}

/**
 * Named makers with their role where there is one, falling back to the
 * museum's short description ("Unknown Maker, Egyptian") when none are named.
 */
function artistOf(o: RisdObject): string | undefined {
  const named = (o.makers ?? [])
    .filter((m) => text(m.name) && !/^unknown\b/i.test(m.name!.trim()))
    .map((m) => {
      const role = text(m.role);
      return role && !/^(artist|none)$/i.test(role)
        ? `${m.name!.trim()} (${role})`
        : m.name!.trim();
    });
  if (named.length) return [...new Set(named)].join("; ");
  return text(o.primaryMaker);
}

function toCompact(o: RisdObject): Artwork {
  return {
    source: "risd",
    id: o.id,
    title: text(o.title) ?? "Untitled",
    artist: artistOf(o),
    date: text(o.dating),
    // No image: see the note at the top of the file.
    museumUrl: text(o.url),
  };
}

function toDetail(o: RisdObject): ArtworkDetail {
  const description = plainText(o.description);
  const isPublicDomain = flag(o.publicDomain);
  return {
    ...toCompact(o),
    medium:
      text(o.mediumTechnique) ??
      (o.medium?.length ? o.medium.join("; ") : undefined),
    dimensions: text(o.dimensions),
    department: o.type?.length ? o.type.join("; ") : undefined,
    culture: text(o.culture),
    creditLine: text(o.credit),
    isPublicDomain,
    license:
      isPublicDomain === true
        ? "Public domain"
        : isPublicDomain === false
          ? "Not public domain. Contact the RISD Museum about image use."
          : undefined,
    description:
      description && description.length > DESCRIPTION_LIMIT
        ? `${description.slice(0, DESCRIPTION_LIMIT).trimEnd()}…`
        : description,
  };
}

// --- Provider ----------------------------------------------------------------

export const risdProvider: Provider = {
  id: "risd",
  name: "RISD Museum (metadata only)",

  isAvailable() {
    return true;
  },

  async search(query, limit) {
    // The API ignores words that are not in the Latin script (it folds accents,
    // so "Édouard" is fine). A query with nothing else would get the unfiltered
    // collection back, which would look like results, so return none instead.
    if (!/[\p{Script=Latin}\p{N}]/u.test(query)) return [];
    // Every word must match. Pages count from 0.
    const results: RisdObject[] = [];
    for (let page = 0; results.length < limit && page < 2; page++) {
      const params = new URLSearchParams({
        search_api_fulltext: query,
        items_per_page: String(PAGE_SIZE),
        page: String(page),
      });
      const rows = await getJson<RisdObject[]>(`${BASE}?${params}`);
      results.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    return results.slice(0, limit).map(toCompact);
  },

  async getArtwork(id) {
    const wanted = id.trim();
    // The API's own ID is a number; accession numbers such as "38.206.2" are
    // found by searching, since the full-text search matches them.
    let found: RisdObject | undefined;
    if (/^\d+$/.test(wanted)) {
      const rows = await getJson<RisdObject[]>(
        `${BASE}?${new URLSearchParams({ id: wanted })}`,
      );
      found = rows[0];
    }
    if (!found) {
      const rows = await getJson<RisdObject[]>(
        `${BASE}?${new URLSearchParams({ search_api_fulltext: wanted, items_per_page: String(PAGE_SIZE) })}`,
      );
      found = rows.find(
        (r) => r.objectNumber?.toLowerCase() === wanted.toLowerCase(),
      );
    }
    if (!found) throw new Error(`No RISD Museum artwork found for '${id}'.`);
    return toDetail(found);
  },
};
