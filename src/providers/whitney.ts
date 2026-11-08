import { getJson } from "../lib/http.js";
import type { Artwork, ArtworkDetail, Provider } from "../types.js";

// Whitney Museum of American Art public API. Open and unauthenticated. Records
// follow JSON:API loosely (`id`, `type`, `attributes`), and the Whitney warns
// that attribute names may change, so everything is read defensively.
const BASE = "https://whitney.org/api";
const WORK_PAGE = "https://whitney.org/collection/works";
const PERMISSIONS = "https://whitney.org/collection/images-and-permissions";

/** The API returns a fixed page of 30; results are trimmed client-side. */
const PAGE_SIZE = 30;

/** A query with more words than this is cut off, to keep the URL sensible. */
const MAX_WORDS = 6;

/** Longest curatorial label to return; the longest seen runs to about 1,100. */
const DESCRIPTION_LIMIT = 2_000;

// --- API shapes (only the parts we read) -------------------------------------

interface WhitneyImage {
  url?: string;
}

interface WhitneyAttributes {
  title?: string;
  display_artist_text?: string;
  display_date?: string;
  medium?: string;
  dimensions?: string;
  classification?: string;
  credit_line?: string;
  object_label?: string;
  description?: string;
  images?: WhitneyImage[];
}

interface WhitneyResource {
  id: string;
  attributes?: WhitneyAttributes;
}

interface ListResponse {
  data?: WhitneyResource[];
}

interface SingleResponse {
  data?: WhitneyResource;
}

// --- Mapping -----------------------------------------------------------------

/** Labels and dimensions come back as HTML fragments with CR/LF breaks. */
function plain(html: string | undefined, separator = " "): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .split(/\s*[\r\n]+\s*/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join(separator);
  return text || undefined;
}

/** The © line is the last sentence of the caption in `description`, if any. */
function rightsNotice(a: WhitneyAttributes): string | undefined {
  const text = plain(a.description);
  const at = text?.indexOf("©") ?? -1;
  if (!text || at === -1) return undefined;
  return text.slice(at).replace(/\.$/, "").trim() || undefined;
}

function toCompact(r: WhitneyResource): Artwork {
  const a = r.attributes ?? {};
  // The API gives one image URL and no smaller rendition, so it serves as both.
  const image = a.images?.find((i) => i.url)?.url;
  return {
    source: "whitney",
    id: String(r.id),
    title: a.title || "Untitled",
    artist: a.display_artist_text || undefined,
    date: a.display_date || undefined,
    imageUrl: image,
    thumbnailUrl: image,
    museumUrl: `${WORK_PAGE}/${encodeURIComponent(String(r.id))}`,
  };
}

function toDetail(r: WhitneyResource): ArtworkDetail {
  const a = r.attributes ?? {};
  const notice = rightsNotice(a);
  return {
    ...toCompact(r),
    medium: a.medium || undefined,
    dimensions: plain(a.dimensions, "; "),
    // The Whitney's own `department` is an administrative bucket ("collection",
    // "artport"); the classification ("Photographs", "Drawings") is the closer
    // match to what other museums report as a department.
    department: a.classification || undefined,
    creditLine: a.credit_line || undefined,
    // Metadata is CC0, but the Whitney's open-access dataset states that images
    // are not part of it and must be licensed separately. isPublicDomain stays
    // unset for that reason.
    license:
      `Data CC0; images not openly licensed${notice ? ` (${notice})` : ""}. ` +
      `See ${PERMISSIONS}`,
    // `description` is a caption repeating the artist, title, medium and
    // credit; `object_label` is the curatorial text.
    description: truncate(plain(a.object_label), DESCRIPTION_LIMIT),
  };
}

function truncate(text: string | undefined, max: number): string | undefined {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

// --- Query -------------------------------------------------------------------

/**
 * The API has no free-text search, only Ransack field filters. Every word must
 * appear in the title, artist or medium (so "hopper nighthawks" finds works by
 * Hopper titled Nighthawks); matching the whole phrase against one field would
 * return nothing for a query that spans fields. Ordered by popularity, which is
 * the nearest thing to relevance on offer.
 */
function searchParams(query: string): URLSearchParams {
  const params = new URLSearchParams();
  const words = query.trim().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  words.forEach((word, i) => {
    params.set(`q[g][${i}][title_or_display_artist_text_or_medium_cont]`, word);
  });
  params.set("q[s]", "popularity desc");
  return params;
}

export const whitneyProvider: Provider = {
  id: "whitney",
  name: "Whitney Museum of American Art",

  isAvailable() {
    return true;
  },

  async search(query, limit) {
    const res = await getJson<ListResponse>(
      `${BASE}/artworks?${searchParams(query).toString()}`,
    );
    return (res.data ?? []).slice(0, Math.min(limit, PAGE_SIZE)).map(toCompact);
  },

  async getArtwork(id) {
    const res = await getJson<SingleResponse>(
      `${BASE}/artworks/${encodeURIComponent(id.trim())}`,
    );
    if (!res.data) throw new Error(`No Whitney artwork found for '${id}'.`);
    return toDetail(res.data);
  },
};
