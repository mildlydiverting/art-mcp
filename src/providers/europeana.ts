import { getJson } from "../lib/http.js";
import type { Artwork, ArtworkDetail, Provider, Source } from "../types.js";

// Europeana aggregates records from thousands of European museums, libraries and
// archives. Free key from https://pro.europeana.eu/pages/get-api. Two sources
// share this code: `europeana` searches still images (paintings, prints, drawings,
// photographs), and `europeana-archives` the rest (text, sound, video, 3D). The
// second is searched only when named, so books and recordings never swamp
// artwork results.
const BASE = "https://api.europeana.eu/record/v2";

/** Longest description to return. */
const DESCRIPTION_LIMIT = 2_000;

/** Europeana's thumbnail service defaults to 400px wide and offers 200px. */
const THUMB_SIZE = "w200";

function apiKey(): string | undefined {
  return process.env.EUROPEANA_API_KEY?.trim() || undefined;
}

// --- API shapes (only the parts we read) -------------------------------------

/** Values keyed by language code ("en", "de") or "def" when the language is unknown. */
type LangMap = Record<string, string[] | undefined>;

interface SearchItem {
  id: string;
  title?: string[];
  dcTitleLangAware?: LangMap;
  dcCreator?: string[];
  dcCreatorLangAware?: LangMap;
  year?: string[];
  rights?: string[];
  dataProvider?: string[];
  edmPreview?: string[];
  edmIsShownAt?: string[];
  guid?: string;
}

interface SearchResponse {
  success?: boolean;
  items?: SearchItem[];
}

interface Proxy {
  europeanaProxy?: boolean;
  [field: string]: unknown;
}

interface Organization {
  about?: string;
  prefLabel?: LangMap;
}

interface Agent {
  about?: string;
  prefLabel?: LangMap;
}

interface RecordObject {
  about?: string;
  agents?: Agent[];
  proxies?: Proxy[];
  organizations?: Organization[];
  aggregations?: {
    edmDataProvider?: LangMap;
    edmIsShownAt?: string;
    edmIsShownBy?: string;
    edmRights?: LangMap;
  }[];
  europeanaAggregation?: { edmPreview?: string };
}

interface RecordResponse {
  success?: boolean;
  object?: RecordObject;
}

// --- Reading language-keyed values -------------------------------------------

/** A URI or an internal reference rather than a name someone can read. */
const isReference = (value: string) => /^(https?:|#)/i.test(value.trim());

/** English first, then unknown-language values, then whatever else there is. */
function readable(map: LangMap | undefined): string[] {
  if (!map) return [];
  const order = [
    "en",
    "def",
    ...Object.keys(map).filter((k) => k !== "en" && k !== "def"),
  ];
  for (const lang of order) {
    const values = (map[lang] ?? []).filter((v) => v && !isReference(v));
    if (values.length)
      return [...new Set(values.map((v) => v.replace(/\u00a0/g, " ").trim()))];
  }
  return [];
}

/**
 * Makers are often given as a link to an agent record (the Rijksmuseum does this),
 * whose name sits in the record's `agents`.
 */
function creatorsOf(object: RecordObject): string[] {
  const named = fromProxies(object.proxies, "dcCreator");
  if (named.length) return named;
  const links = (object.proxies ?? []).flatMap((p) =>
    Object.values((p.dcCreator as LangMap | undefined) ?? {}).flatMap(
      (v) => v ?? [],
    ),
  );
  const names = links.flatMap((uri) =>
    readable(object.agents?.find((a) => a.about === uri)?.prefLabel).slice(
      0,
      1,
    ),
  );
  return [...new Set(names)];
}

/** The same, across the proxies of a record. Europeana's own enriched one comes first. */
function fromProxies(
  proxies: Proxy[] | undefined,
  ...fields: string[]
): string[] {
  const ordered = [...(proxies ?? [])].sort(
    (a, b) =>
      Number(Boolean(b.europeanaProxy)) - Number(Boolean(a.europeanaProxy)),
  );
  for (const field of fields) {
    for (const proxy of ordered) {
      const values = readable(proxy[field] as LangMap | undefined);
      if (values.length) return values;
    }
  }
  return [];
}

// --- Rights ------------------------------------------------------------------

const RIGHTS_STATEMENTS: Record<string, string> = {
  InC: "In Copyright",
  "InC-EDU": "In Copyright, educational use permitted",
  "InC-NC": "In Copyright, non-commercial use permitted",
  "InC-RUU": "In Copyright, rights-holder unlocatable",
  NoC: "No Copyright",
  "NoC-NC": "No Copyright, non-commercial use only",
  "NoC-OKLR": "No Copyright, other known legal restrictions",
  "NoC-CR": "No Copyright, contractual restrictions",
  CNE: "Copyright Not Evaluated",
  UND: "Copyright Undetermined",
  NKC: "No Known Copyright",
};

/** Turn a rights URI into a short label, and say whether it means public domain. */
function rightsOf(uri: string | undefined): {
  license?: string;
  isPublicDomain?: boolean;
} {
  if (!uri) return {};
  const cc = uri.match(/creativecommons\.org\/licenses\/([a-z-]+)\/([\d.]+)/i);
  if (cc)
    return {
      license: `CC ${cc[1].toUpperCase()} ${cc[2]}`,
      isPublicDomain: false,
    };
  if (/publicdomain\/zero/i.test(uri))
    return { license: "CC0 1.0", isPublicDomain: true };
  if (/publicdomain\/mark/i.test(uri)) {
    return { license: "Public Domain Mark 1.0", isPublicDomain: true };
  }
  const statement = uri.match(
    /rightsstatements\.org\/vocab\/([A-Za-z-]+)\//,
  )?.[1];
  if (statement)
    return {
      license: RIGHTS_STATEMENTS[statement] ?? `Rights statement ${statement}`,
    };
  return { license: uri };
}

// --- Mapping -----------------------------------------------------------------

/** The thumbnail service takes a `size` parameter; without one it returns 400px. */
const thumbnailOf = (preview: string) => `${preview}&size=${THUMB_SIZE}`;

function toCompact(item: SearchItem, source: Source): Artwork {
  const preview = item.edmPreview?.[0];
  const creators = readable(item.dcCreatorLangAware);
  const title = readable(item.dcTitleLangAware)[0] ?? item.title?.[0];
  return {
    source,
    id: item.id.replace(/^\//, ""),
    title: title && !isReference(title) ? title : "Untitled",
    artist: creators.length ? creators.join("; ") : undefined,
    date: item.year?.[0],
    imageUrl: preview,
    thumbnailUrl: preview ? thumbnailOf(preview) : undefined,
    museumUrl: item.edmIsShownAt?.[0] ?? item.guid,
  };
}

function toDetail(object: RecordObject, source: Source): ArtworkDetail {
  const proxies = object.proxies;
  const aggregation = object.aggregations?.[0];
  const preview = object.europeanaAggregation?.edmPreview;

  const providerUri = aggregation?.edmDataProvider?.def?.[0];
  const provider =
    readable(
      object.organizations?.find((o) => o.about === providerUri)?.prefLabel,
    )[0] ?? readable(aggregation?.edmDataProvider)[0];

  const description = fromProxies(proxies, "dcDescription")[0]?.replace(
    /\s+/g,
    " ",
  );
  const rights = rightsOf(aggregation?.edmRights?.def?.[0]);
  const creators = creatorsOf(object);
  const dimensions = fromProxies(proxies, "dctermsExtent");
  const medium = fromProxies(proxies, "dctermsMedium");
  const kind = fromProxies(proxies, "dcType");

  return {
    source,
    id: (object.about ?? "").replace(/^\//, ""),
    title: fromProxies(proxies, "dcTitle")[0] ?? "Untitled",
    artist: creators.length ? creators.join("; ") : undefined,
    date: fromProxies(proxies, "dctermsCreated", "dcDate")[0],
    imageUrl: preview,
    thumbnailUrl: preview ? thumbnailOf(preview) : undefined,
    // The provider's own file can be many megabytes, so it is offered separately.
    fullImageUrl: aggregation?.edmIsShownBy,
    museumUrl: aggregation?.edmIsShownAt,
    medium: medium.length ? medium.join("; ") : undefined,
    dimensions: dimensions.length ? dimensions.join(", ") : undefined,
    department: kind[0],
    creditLine: provider ? `${provider}, via Europeana` : undefined,
    description:
      description && description.length > DESCRIPTION_LIMIT
        ? `${description.slice(0, DESCRIPTION_LIMIT).trimEnd()}…`
        : description,
    ...rights,
  };
}

// --- Provider ----------------------------------------------------------------

/** Europeana's own classification of a record's media. */
const IMAGES = "TYPE:IMAGE";
const ARCHIVES = "(TYPE:TEXT OR TYPE:VIDEO OR TYPE:SOUND OR TYPE:3D)";

function makeProvider(
  sourceId: "europeana" | "europeana-archives",
  name: string,
  typeFilter: string,
  onlyWhenNamed: boolean,
): Provider {
  return {
    id: sourceId,
    name,
    ...(onlyWhenNamed ? { onlyWhenNamed } : {}),

    isAvailable() {
      return apiKey() !== undefined;
    },

    async search(query, limit) {
      const key = apiKey();
      if (!key) throw new Error("EUROPEANA_API_KEY is not set");
      const params = new URLSearchParams({
        query,
        rows: String(limit),
        profile: "standard",
      });
      // One kind of media, and only records with a file behind them.
      params.append("qf", typeFilter);
      params.append("qf", "MEDIA:true");
      // The key goes in a header so it never appears in a URL.
      const res = await getJson<SearchResponse>(
        `${BASE}/search.json?${params}`,
        {
          headers: { "X-Api-Key": key },
        },
      );
      return (res.items ?? []).map((item) => toCompact(item, sourceId));
    },

    async getArtwork(id) {
      const key = apiKey();
      if (!key) throw new Error("EUROPEANA_API_KEY is not set");
      // Record IDs look like "90402/SK_A_2344": a dataset, then the item.
      const path = id
        .trim()
        .replace(/^\/+/, "")
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      const res = await getJson<RecordResponse>(`${BASE}/${path}.json`, {
        headers: { "X-Api-Key": key },
      });
      if (!res.object)
        throw new Error(`No Europeana record found for '${id}'.`);
      return toDetail(res.object, sourceId);
    },
  };
}

export const europeanaProvider = makeProvider(
  "europeana",
  "Europeana",
  IMAGES,
  false,
);

export const europeanaArchivesProvider = makeProvider(
  "europeana-archives",
  "Europeana, library and archive material",
  ARCHIVES,
  true,
);
