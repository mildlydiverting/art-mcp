import { FULL_WIDTH, THUMB_WIDTH, iiifImageUrl } from "../lib/iiif.js";
import { getJson } from "../lib/http.js";
import type { Artwork, ArtworkDetail, Provider } from "../types.js";

// SMK, the National Gallery of Denmark (Statens Museum for Kunst). Open API,
// no key. Images are served over IIIF Image API 2.
const BASE = "https://api.smk.dk/api/v1";

const PUBLIC_DOMAIN_MARK = "Public Domain Mark 1.0";

/** Longest exhibition or label text to return. */
const DESCRIPTION_LIMIT = 2_000;

/**
 * The full record carries colour analysis, exhibition histories and more, about
 * 5KB each. Search results need only these.
 */
const SEARCH_FIELDS = [
  "object_number",
  "titles",
  "artist",
  "production",
  "production_date",
  "has_image",
  "image_iiif_id",
  "frontend_url",
];

// --- API shapes (only the parts we read) -------------------------------------

interface SmkTitle {
  title?: string;
  /** Spelled out in the record's own language: "engelsk", "Dansk". */
  language?: string;
}

interface SmkCreator {
  creator?: string;
  creator_forename?: string;
  creator_surname?: string;
  /** Attribution wording such as "attributed to" or "follower of". */
  creator_role?: string;
}

interface SmkDimension {
  type?: string;
  value?: string;
  unit?: string;
}

interface SmkItem {
  object_number?: string;
  titles?: SmkTitle[];
  artist?: string[];
  production?: SmkCreator[];
  production_date?: { period?: string }[];
  techniques?: string[];
  materials?: string[];
  dimensions?: SmkDimension[];
  object_names?: { name?: string }[];
  credit_line?: string[];
  labels?: { text?: string }[];
  has_image?: boolean;
  image_iiif_id?: string;
  frontend_url?: string;
  public_domain?: boolean;
  rights?: string;
}

interface SearchResponse {
  items?: SmkItem[];
}

// --- Mapping -----------------------------------------------------------------

function titleIn(items: SmkTitle[] | undefined, language: RegExp): string | undefined {
  return items?.find((t) => t.title && language.test(t.language ?? ""))?.title;
}

/**
 * The record gives an English title for most works and a Danish one for some.
 * `title` prefers English; the Danish title, when there is one, goes in
 * `titleOriginal`.
 */
function titlesOf(item: SmkItem): Pick<Artwork, "title" | "titleOriginal" | "language"> {
  const english = titleIn(item.titles, /^eng/i);
  const danish = titleIn(item.titles, /^dan/i);
  const title = english ?? danish ?? item.titles?.find((t) => t.title)?.title;
  return {
    title: title ?? "Untitled",
    ...(danish ? { titleOriginal: danish } : {}),
    // `language` describes `title`, so it is only set when that is the Danish one.
    ...(danish && title === danish ? { language: "da" } : {}),
  };
}

/**
 * Build the artist from the production entries, not the `artist` display list:
 * that list drops the attribution wording, so a "follower of Philips Koninck"
 * shows as "Unknown" and an "attributed to" work as a firm attribution.
 */
function artistOf(item: SmkItem): string | undefined {
  const makers = (item.production ?? [])
    .map((p) => {
      const name =
        p.creator_forename && p.creator_surname
          ? `${p.creator_forename} ${p.creator_surname}`
          : (p.creator_surname ?? p.creator);
      if (!name) return undefined;
      return p.creator_role ? `${p.creator_role} ${name}` : name;
    })
    .filter((m): m is string => Boolean(m));
  if (makers.length) return makers.join("; ");
  const fallback = (item.artist ?? []).filter(Boolean).join("; ");
  return fallback || undefined;
}

function imagesOf(item: SmkItem): { imageUrl?: string; thumbnailUrl?: string } {
  // The record also links the original download, which can be 16MB, so build
  // sized IIIF URLs instead.
  if (!item.has_image || !item.image_iiif_id) return {};
  return {
    imageUrl: iiifImageUrl(item.image_iiif_id, FULL_WIDTH),
    thumbnailUrl: iiifImageUrl(item.image_iiif_id, THUMB_WIDTH),
  };
}

function toCompact(item: SmkItem): Artwork {
  const id = item.object_number ?? "";
  return {
    source: "smk",
    id,
    ...titlesOf(item),
    artist: artistOf(item),
    date: item.production_date?.[0]?.period,
    ...imagesOf(item),
    museumUrl: item.frontend_url,
  };
}

/** "67.9 × 57.5 cm" from the first height, width and depth in the record. */
function dimensionsOf(item: SmkItem): string | undefined {
  const dims = item.dimensions ?? [];
  const first = (type: string) => dims.find((d) => d.type === type && d.value);
  const parts = ["height", "width", "depth"]
    .map(first)
    .filter((d): d is SmkDimension => Boolean(d));
  if (!parts.length) return undefined;
  const unit = parts[0].unit;
  return `${parts.map((d) => d.value).join(" × ")}${unit ? ` ${unit}` : ""}`;
}

function licenseOf(item: SmkItem): string | undefined {
  if (item.public_domain) return PUBLIC_DOMAIN_MARK;
  return item.rights ? `Not public domain. See ${item.rights}` : undefined;
}

function toDetail(item: SmkItem): ArtworkDetail {
  const medium = (item.techniques?.length ? item.techniques : item.materials) ?? [];
  const label = item.labels?.find((l) => l.text)?.text;
  const description = label?.replace(/\s+/g, " ").trim();
  return {
    ...toCompact(item),
    medium: medium.length ? medium.join("; ") : undefined,
    dimensions: dimensionsOf(item),
    // The kind of object ("Painting", "Etching"), the nearest thing SMK has to a
    // department.
    department: item.object_names?.[0]?.name,
    creditLine: item.credit_line?.length ? item.credit_line.join("; ") : undefined,
    isPublicDomain: item.public_domain,
    license: licenseOf(item),
    description:
      description && description.length > DESCRIPTION_LIMIT
        ? `${description.slice(0, DESCRIPTION_LIMIT).trimEnd()}…`
        : description,
  };
}

// --- Provider ----------------------------------------------------------------

export const smkProvider: Provider = {
  id: "smk",
  name: "SMK, National Gallery of Denmark",

  isAvailable() {
    return true;
  },

  async search(query, limit) {
    const params = new URLSearchParams({
      keys: query,
      offset: "0",
      rows: String(limit),
      lang: "en",
      fields: SEARCH_FIELDS.join(","),
    });
    const res = await getJson<SearchResponse>(`${BASE}/art/search/?${params}`);
    return (res.items ?? []).map(toCompact);
  },

  async getArtwork(id) {
    const params = new URLSearchParams({ object_number: id.trim(), lang: "en" });
    const res = await getJson<SearchResponse>(`${BASE}/art/?${params}`);
    const item = res.items?.[0];
    if (!item) throw new Error(`No SMK artwork found for '${id}'.`);
    return toDetail(item);
  },
};
