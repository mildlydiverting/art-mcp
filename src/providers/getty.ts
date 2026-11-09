import {
  getAccessionNumbers,
  getCarriedOutBy,
  getCultures,
  getDimensionsDescriptions,
  getMaterialStatements,
  getProductionTimespans,
  getReferredToByClassification,
  getRightsStatements,
  normalizeFieldToArray,
  type LinkedArtNode,
} from "@thegetty/linkedart.js";
import { FULL_WIDTH, THUMB_WIDTH, iiifAtWidth } from "../lib/iiif.js";
import { getJson } from "../lib/http.js";
import type { Artwork, ArtworkDetail, Provider } from "../types.js";

// J. Paul Getty Museum collection. Open, no key. The data is Linked Art, but the
// API cannot list or search records, so search goes through the SPARQL
// endpoint and a record is fetched only when its detail is wanted (a record
// runs to hundreds of kilobytes).
const SPARQL = "https://data.getty.edu/museum/collection/sparql";
const OBJECT_BASE = "https://data.getty.edu/museum/collection/object";

const AAT = {
  creditLine: "http://vocab.getty.edu/aat/300435418",
  description: "http://vocab.getty.edu/aat/300080091",
} as const;

/** Getty's own classification for "Vincent van Gogh (Dutch, 1853 - 1890)". */
const PRODUCER_DESCRIPTION =
  "https://data.getty.edu/local/thesaurus/producer-description";

/** Slower than the museum APIs, and a record is large. */
const TIMEOUT_MS = 30_000;

/** Longest description to return. */
const DESCRIPTION_LIMIT = 2_000;

/** More matching people than this are almost certainly a loose query. */
const MAX_PEOPLE = 5;

const PREFIXES = `PREFIX crm: <http://www.cidoc-crm.org/cidoc-crm/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>`;

// --- SPARQL ------------------------------------------------------------------

interface SparqlResponse {
  results?: { bindings?: Record<string, { value: string } | undefined>[] };
}

async function select(query: string): Promise<Record<string, string>[]> {
  const url = `${SPARQL}?${new URLSearchParams({ query: `${PREFIXES}\n${query}` })}`;
  const res = await getJson<SparqlResponse>(url, {
    timeoutMs: TIMEOUT_MS,
    headers: { Accept: "application/sparql-results+json" },
  });
  return (res.results?.bindings ?? []).map((row) =>
    Object.fromEntries(
      Object.entries(row).flatMap(([k, v]) => (v ? [[k, v.value]] : [])),
    ),
  );
}

/** A SPARQL string literal. Only letters, digits and a little punctuation get through. */
function literal(text: string): string {
  return `"${text.replace(/[^\p{L}\p{N} '.,&()-]/gu, " ")}"`;
}

/** Every word of the query must appear in the text the filter is applied to. */
function everyWord(variable: string, query: string): string {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  return words
    .map((w) => `CONTAINS(LCASE(STR(${variable})), ${literal(w)})`)
    .join(" && ");
}

const objectUri = (id: string) => `<${OBJECT_BASE}/${id}>`;

// A record's id is the UUID at the end of its URI.
const uuidOf = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// --- Mapping -----------------------------------------------------------------

/** "Irises (90.PA.20)" -> "Irises". The accession number is part of Getty's label. */
function titleFromLabel(label: string | undefined): string {
  const title = label?.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return title || label?.trim() || "Untitled";
}

function plainText(text: string | undefined): string | undefined {
  const plain = text
    ?.replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return plain || undefined;
}

/** Image URL from the record, bounded to a width a model can take in. */
function imagesOf(url: string | undefined): {
  imageUrl?: string;
  thumbnailUrl?: string;
} {
  return {
    imageUrl: iiifAtWidth(url, FULL_WIDTH),
    thumbnailUrl: iiifAtWidth(url, THUMB_WIDTH),
  };
}

interface Row {
  o: string;
  label?: string;
  image?: string;
  makers?: string;
  date?: string;
}

/**
 * Getty lists some makers twice ("Kazumasa Ogawa" and "Kazumasa Ogawa (Japanese,
 * 1860 - 1929)") and fills unknown ones with "Unknown". Keep each name once, in
 * its fullest form, and drop the unknowns.
 */
function makersOf(joined: string | undefined): string | undefined {
  const fullest = new Map<string, string>();
  for (const name of (joined ?? "").split("; ").map((n) => n.trim())) {
    if (!name || /^unknown\b/i.test(name)) continue;
    const base = name.replace(/\s*\(.*$/, "");
    if ((fullest.get(base)?.length ?? 0) < name.length) fullest.set(base, name);
  }
  return fullest.size ? [...fullest.values()].join("; ") : undefined;
}

/** "1889-01-01T00:00:00Z" -> "1889"; BCE years come with a leading minus. */
function yearOf(timestamp: string | undefined): string | undefined {
  const m = timestamp?.match(/^(-?\d{1,4})/);
  return m ? String(Number(m[1])) : undefined;
}

function rowToArtwork(row: Row): Artwork {
  return {
    source: "getty",
    id: uuidOf(row.o),
    title: titleFromLabel(row.label),
    artist: makersOf(row.makers),
    date: yearOf(row.date),
    ...imagesOf(row.image),
    museumUrl: undefined,
  };
}

/** "The J. Paul Getty Museum, Los Angeles (90.PA.20)": the credit, then the accession number. */
function creditLineOf(record: LinkedArtNode): string | undefined {
  const credit = getReferredToByClassification(record, AAT.creditLine);
  const accession = getAccessionNumbers(record)[0];
  if (credit && accession) return `${credit} (${accession})`;
  return credit || accession;
}

function toDetail(record: LinkedArtNode, id: string): ArtworkDetail {
  const production = record.produced_by as LinkedArtNode | undefined;
  const label = typeof record._label === "string" ? record._label : undefined;

  // Getty's own wording keeps the nationality and dates: "Vincent van Gogh
  // (Dutch, 1853 - 1890)".
  const producer = production
    ? getReferredToByClassification(production, PRODUCER_DESCRIPTION)
    : undefined;
  const makers = production
    ? getCarriedOutBy(record)
        .map((m) => (typeof m._label === "string" ? m._label : undefined))
        .filter((m): m is string => Boolean(m))
    : [];

  const timespan = getProductionTimespans(record)[0];
  const dateNames = normalizeFieldToArray(timespan ?? {}, "identified_by");
  const date = dateNames.find((n) => typeof n.content === "string")?.content;

  const web = normalizeFieldToArray(record, "subject_of").find(
    (s) => s.format === "text/html",
  );
  const representation = normalizeFieldToArray(record, "representation")[0];

  const classes = normalizeFieldToArray(record, "classified_as")
    .map((c) => (typeof c._label === "string" ? c._label : undefined))
    .filter(
      (c): c is string => Boolean(c) && !/^(Artwork|Object Record)/.test(c!),
    );

  const rights = getRightsStatements(record)[0];
  const description = plainText(
    getReferredToByClassification(record, AAT.description),
  );
  const dimensions = getDimensionsDescriptions(record);

  return {
    source: "getty",
    id,
    title: titleFromLabel(label),
    artist: producer || (makers.length ? makers.join("; ") : undefined),
    date: typeof date === "string" ? date : undefined,
    ...imagesOf(
      typeof representation?.id === "string" ? representation.id : undefined,
    ),
    museumUrl: typeof web?.id === "string" ? web.id : undefined,
    medium: getMaterialStatements(record)[0],
    dimensions: dimensions.length ? dimensions.join("; ") : undefined,
    department: classes[0],
    culture: getCultures(record).join("; ") || undefined,
    creditLine: creditLineOf(record),
    isPublicDomain: rights
      ? /^(no copyright|public domain)$/i.test(rights.trim())
      : undefined,
    license: rights ? `${rights}; collection data CC0` : undefined,
    description:
      description && description.length > DESCRIPTION_LIMIT
        ? `${description.slice(0, DESCRIPTION_LIMIT).trimEnd()}…`
        : description,
  };
}

// --- Provider ----------------------------------------------------------------

/** Title, makers, date and image for a set of records, in one query. */
async function summaries(ids: string[]): Promise<Row[]> {
  if (!ids.length) return [];
  const values = ids.map(objectUri).join(" ");
  return (await select(`
    SELECT ?o (SAMPLE(?l) AS ?label) (SAMPLE(?img) AS ?image)
           (GROUP_CONCAT(DISTINCT ?mn; separator="; ") AS ?makers) (SAMPLE(?ts) AS ?date)
    WHERE {
      VALUES ?o { ${values} }
      ?o rdfs:label ?l .
      OPTIONAL { ?o crm:P108i_was_produced_by ?prod .
        OPTIONAL { ?prod crm:P14_carried_out_by ?m . ?m rdfs:label ?mn }
        OPTIONAL { ?prod crm:P4_has_time-span ?t . ?t crm:P82a_begin_of_the_begin ?ts } }
      OPTIONAL { ?o crm:P138i_has_representation ?img }
    } GROUP BY ?o`)) as unknown as Row[];
}

export const gettyProvider: Provider = {
  id: "getty",
  name: "J. Paul Getty Museum",

  isAvailable() {
    return true;
  },

  async search(query, limit) {
    const words = everyWord("?l", query);
    if (!words) return [];

    // Works whose title matches, and works by people whose name matches. The
    // second takes two steps because scanning every work's maker is far slower
    // than finding the person first.
    const [byTitle, people] = await Promise.all([
      select(`SELECT DISTINCT ?o WHERE { ?o a crm:E22_Human-Made_Object ; rdfs:label ?l .
        FILTER(${words}) } LIMIT ${limit}`),
      select(`SELECT DISTINCT ?p WHERE { ?p a crm:E21_Person ; rdfs:label ?l .
        FILTER(${words}) } LIMIT ${MAX_PEOPLE}`),
    ]);

    let byMaker: Record<string, string>[] = [];
    if (people.length) {
      const list = people.map((p) => `<${p.p}>`).join(" ");
      byMaker = await select(`SELECT DISTINCT ?o WHERE { VALUES ?p { ${list} }
        ?prod crm:P14_carried_out_by ?p . ?o crm:P108i_was_produced_by ?prod } LIMIT ${limit}`);
    }

    // Alternate the two lists so neither crowds out the other.
    const ids: string[] = [];
    const seen = new Set<string>();
    for (
      let i = 0;
      ids.length < limit && i < Math.max(byTitle.length, byMaker.length);
      i++
    ) {
      for (const list of [byMaker, byTitle]) {
        const uri = list[i]?.o;
        if (uri && !seen.has(uri) && ids.length < limit) {
          seen.add(uri);
          ids.push(uuidOf(uri));
        }
      }
    }

    const rows = await summaries(ids);
    const order = new Map(ids.map((id, i) => [id, i]));
    return rows
      .sort(
        (a, b) => (order.get(uuidOf(a.o)) ?? 0) - (order.get(uuidOf(b.o)) ?? 0),
      )
      .map(rowToArtwork);
  },

  async getArtwork(id) {
    let uuid = id.trim();
    if (!UUID.test(uuid)) {
      // An accession number such as "90.PA.20": Getty puts it at the end of the label.
      const rows =
        await select(`SELECT ?o WHERE { ?o a crm:E22_Human-Made_Object ; rdfs:label ?l .
        FILTER(STRENDS(LCASE(STR(?l)), ${literal(`(${uuid})`.toLowerCase())})) } LIMIT 1`);
      if (!rows[0]) throw new Error(`No Getty artwork found for '${id}'.`);
      uuid = uuidOf(rows[0].o);
    }
    const record = await getJson<LinkedArtNode>(`${OBJECT_BASE}/${uuid}`, {
      timeoutMs: TIMEOUT_MS,
      headers: { Accept: "application/json" },
    }).catch((err: unknown) => {
      if (err instanceof Error && /404/.test(err.message)) {
        throw new Error(`No Getty artwork found for '${id}'.`);
      }
      throw err;
    });
    return toDetail(record, uuid);
  },
};
