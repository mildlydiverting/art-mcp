import { getJson, postJson } from "../lib/http.js";
import { THUMB_WIDTH, iiifAtWidth } from "../lib/iiif.js";
import type { Artwork, ArtworkDetail, Provider } from "../types.js";

// National Gallery, London collection data (beta). Records are CIIM JSON served
// from an Elasticsearch 7.17 index, so a search hit is already a complete
// record: unlike the Rijksmuseum there is no second fetch per result.
const BASE = "https://data.ng.ac.uk";
const SEARCH = `${BASE}/es/public/_search`;
const IIIF = `${BASE}/iiif/3`;

/** Structured data CC0, narrative text CC BY 4.0, images CC BY-NC-ND 4.0. */
const LICENSE = "Images CC BY-NC-ND 4.0; descriptions CC BY 4.0; data CC0";

/** Persistent identifiers look like `0F6J-0001-0000-0000`. */
const PID_PATTERN = /^[0-9A-Z]{4}(?:-[0-9A-Z]{4}){3}$/;

/** Fields a free-text query is matched against. */
const QUERY_FIELDS = [
  "summary.title",
  "title.value",
  "creation.maker.summary.title",
  "description.value",
  "subject.summary.title",
  "genre.summary.title",
];

/**
 * What the compact mapper reads. A full hit is around 76KB, nearly all of it
 * linked vocabulary entries and long descriptions that search results do not
 * need, so ask Elasticsearch for just these paths.
 */
const SEARCH_FIELDS = [
  "@admin.uid",
  "summary.title",
  "title.type",
  "title.value",
  "creation.attribution.type",
  "creation.attribution.value",
  "creation.maker.summary.title",
  "creation.date.value",
  "multimedia.@admin.uid",
  "access.media.public_image",
];

// --- CIIM shapes (only the parts we read) ------------------------------------

interface Typed {
  type?: string;
  value?: string;
}

interface CiimRecord {
  "@admin"?: { uid?: string };
  summary?: { title?: string };
  title?: Typed[];
  identifier?: (Typed & { primary?: boolean })[];
  creation?: {
    attribution?: Typed[];
    maker?: { summary?: { title?: string } }[];
    date?: { value?: string }[];
    place?: { summary?: { title?: string } }[];
  }[];
  material?: Typed[];
  measurements?: { display?: string }[];
  category?: Typed[];
  description?: Typed[];
  legal?: { credit?: string };
  multimedia?: { "@admin"?: { uid?: string } }[];
  access?: { media?: { public_image?: boolean } };
}

interface SearchResponse {
  hits?: { hits?: { _source?: CiimRecord }[] };
}

// --- Mapping -----------------------------------------------------------------

function typedValue(items: Typed[] | undefined, type: string): string | undefined {
  return items?.find((i) => i.type === type && i.value)?.value;
}

function titleOf(r: CiimRecord): string {
  return (
    typedValue(r.title, "full title") ??
    typedValue(r.title, "short title") ??
    r.summary?.title ??
    "Untitled"
  );
}

/**
 * The Gallery's own attribution string keeps qualifiers such as "or workshop
 * of Titian" or "attributed to", which the bare maker name would drop and so
 * credit the master with a studio piece. Fall back to the makers when absent.
 */
function artistOf(r: CiimRecord): string | undefined {
  const creation = r.creation?.[0];
  const attribution = typedValue(creation?.attribution, "attribution");
  if (attribution) return attribution;
  const makers = (creation?.maker ?? [])
    .map((m) => m.summary?.title)
    .filter((t): t is string => Boolean(t));
  return makers.length ? makers.join("; ") : undefined;
}

/**
 * The plain statement ("oil on canvas") is the first `material` entry with no
 * `type`; the others are a "detailed" variant and linked vocabulary terms.
 */
function mediumOf(r: CiimRecord): string | undefined {
  return (
    r.material?.find((m) => !m.type && m.value)?.value ??
    r.material?.find((m) => m.value)?.value
  );
}

function imagesOf(r: CiimRecord): { imageUrl?: string; thumbnailUrl?: string } {
  // Only the Gallery's public-image flag licenses showing a picture; records
  // under copyright or on loan have none.
  if (r.access?.media?.public_image !== true) return {};
  const uid = r.multimedia?.[0]?.["@admin"]?.uid;
  if (!uid) return {};
  // The image server speaks IIIF Image API 3, which rejects any size larger
  // than the source ("scales in excess of 100% must be prefixed with ^"), and
  // these sources are only about 800px wide, so the repo's usual 843px width
  // would 400. `max` is always valid and the server caps it at its own
  // maxArea (roughly 800px), which is already a sensible size to view.
  const imageUrl = `${IIIF}/${encodeURIComponent(uid)}/full/max/0/default.jpg`;
  return { imageUrl, thumbnailUrl: iiifAtWidth(imageUrl, THUMB_WIDTH) };
}

function toCompact(r: CiimRecord): Artwork {
  const pid = r["@admin"]?.uid ?? "";
  return {
    source: "nationalgallery",
    id: pid,
    title: titleOf(r),
    artist: artistOf(r),
    date: r.creation?.[0]?.date?.[0]?.value,
    ...imagesOf(r),
    museumUrl: pid ? `${BASE}/${pid}.html` : undefined,
  };
}

function toDetail(r: CiimRecord): ArtworkDetail {
  return {
    ...toCompact(r),
    medium: mediumOf(r),
    dimensions: r.measurements?.[0]?.display,
    department: typedValue(r.category, "department"),
    originPlace: r.creation?.[0]?.place?.[0]?.summary?.title,
    creditLine: r.legal?.credit,
    // The Gallery does not call anything "public domain", so isPublicDomain
    // stays unset and the actual terms go in `license`.
    license: LICENSE,
    description: typedValue(r.description, "short text"),
  };
}

// --- Lookups -----------------------------------------------------------------

const OBJECTS_ONLY = { term: { "@datatype.base": "object" } };

async function search(
  query: object,
  size: number,
  includes?: string[],
): Promise<CiimRecord[]> {
  const res = await postJson<SearchResponse>(SEARCH, {
    size,
    ...(includes ? { _source: { includes } } : {}),
    query: { bool: { must: [query], filter: [OBJECTS_ONLY] } },
  });
  return (res.hits?.hits ?? []).flatMap((h) => (h._source ? [h._source] : []));
}

/** Resolve an object number such as `NG35` (or `L777`, `NG4452`) to a PID. */
async function pidForObjectNumber(number: string): Promise<string | undefined> {
  // The index matches case-sensitively and object numbers are upper case
  // ("NG35"), so also try the upper-cased form for input such as "ng35".
  const forms = [...new Set([number, number.toUpperCase()])];
  const hits = await search(
    {
      bool: {
        should: forms.map((f) => ({ match: { "identifier.value": f } })),
        minimum_should_match: 1,
      },
    },
    10,
    ["@admin.uid", "identifier.type", "identifier.value"],
  );
  // `match` is loose about tokens, so insist on the exact object number.
  return hits.find((h) =>
    h.identifier?.some(
      (i) =>
        i.type === "object number" &&
        i.value?.toLowerCase() === number.toLowerCase(),
    ),
  )?.["@admin"]?.uid;
}

/** A record by PID, in the same CIIM shape a search hit has. */
async function byPid(pid: string): Promise<CiimRecord> {
  // Without `?profile=` the default is also CIIM, but naming it keeps the
  // shape stable if the Gallery changes the default.
  return getJson<CiimRecord>(`${BASE}/${encodeURIComponent(pid)}?profile=ciim-json`);
}

export const nationalGalleryProvider: Provider = {
  id: "nationalgallery",
  name: "National Gallery, London",

  isAvailable() {
    return true;
  },

  async search(query, limit) {
    const hits = await search(
      {
        multi_match: { query, type: "best_fields", fields: QUERY_FIELDS },
      },
      limit,
      SEARCH_FIELDS,
    );
    return hits.map(toCompact);
  },

  async getArtwork(id) {
    const wanted = id.trim();
    const pid = PID_PATTERN.test(wanted)
      ? wanted
      : await pidForObjectNumber(wanted);
    if (!pid) {
      throw new Error(
        `No National Gallery object found for '${id}'. Use a PID such as 0F6J-0001-0000-0000 or an object number such as NG35.`,
      );
    }
    return toDetail(await byPid(pid));
  },
};
