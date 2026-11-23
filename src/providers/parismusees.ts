import { postJson } from "../lib/http.js";
import type { Artwork, ArtworkDetail, Provider } from "../types.js";

// Paris Musées: the 14 museums of the City of Paris (Petit Palais, Carnavalet,
// Musée d'Art Moderne, Maison de Victor Hugo, Palais Galliera and others).
// GraphQL over a Drupal site. Free token from https://apicollections.parismusees.paris.fr/
// ("Mon compte" > "Modifier" > "Auth Tokens"), sent in an `auth-token` header.
//
// The public API allows 1,000 requests a day, so each search and each detail
// lookup is exactly one request. Images are not: they come from the public
// website, outside the quota.
//
// Rights are per image. `fieldImageLibre` is true for CC0 images and null or
// false otherwise. Every record has a thumbnail; only CC0 records get a full image.
// Records, titles and labels are in French only.
const ENDPOINT = "https://apicollections.parismusees.paris.fr/graphql";
const SITE = "https://www.parismuseescollections.paris.fr";

/** Search API index that holds artworks, documents and archives together. */
const INDEX = "collections";

/** Search asks for this many times the limit, to survive de-duplication. */
const OVERFETCH = 3;
const MAX_FETCH = 150;

/** Longest description to return. */
const DESCRIPTION_LIMIT = 2_000;

function apiKey(): string | undefined {
  return process.env.PARISMUSEES_API_KEY?.trim() || undefined;
}

// --- Queries -----------------------------------------------------------------

// Keywords go in as variables, never spliced into the query text. `oeuvre`
// leaves out library documents and archives, which share the index.
const SEARCH_QUERY = `query Search($keys: [String]!, $limit: Int!) {
  searchAPISearch(
    index_id: "${INDEX}"
    fulltext: { keys: $keys, conjunction: "AND" }
    conditions: [{ name: "type_contenu_chaine_s", value: "oeuvre" }]
    range: { offset: 0, limit: $limit }
  ) {
    documents {
      ... on CollectionsDoc {
        nid_entier_s
        titre_texte_s
        auteur_texte_m
        annee_texte_s
        production_date_m
        premiere_image
      }
    }
  }
}`;

const DETAIL_QUERY = `query Detail($id: String!) {
  nodeById(id: $id) {
    ... on NodeOeuvre {
      entityId
      title
      absolutePath
      fieldCartelAuteur
      fieldCartelDatation
      fieldCartelDenominationTitre
      fieldCartelDimension
      fieldCartelMateriaux
      fieldCartelModeAcquisition
      fieldDateProduction { startYear endYear processed }
      fieldDescription { value }
      fieldOeuvreDescriptionIcono { value }
      fieldMusee { entity { name ... on TaxonomyTermMusee { fieldMuseeTitreCourt } } }
      fieldMateriauxTechnique { entity { name } }
      fieldOeuvreAuteurs {
        entity {
          fieldAuteurAttribution
          fieldAuteurAuteur { entity { name } }
        }
      }
      fieldVisuels {
        entity { publicUrl vignette fieldImageLibre fieldImageDroits }
      }
    }
  }
}`;

// --- API shapes (only the parts we read) -------------------------------------

interface GraphQlResponse<T> {
  data?: T | null;
  errors?: { message?: string }[];
}

interface SearchDoc {
  nid_entier_s?: number | null;
  titre_texte_s?: string | null;
  auteur_texte_m?: string | null;
  annee_texte_s?: string | null;
  /** Solr date range, e.g. "[1661-01-01T00:00:00Z TO 1743-12-31T00:00:00Z]". */
  production_date_m?: string | null;
  premiere_image?: string | null;
}

interface Named {
  entity?: { name?: string | null; fieldMuseeTitreCourt?: string | null } | null;
}

interface Visuel {
  entity?: {
    publicUrl?: string | null;
    vignette?: string | null;
    fieldImageLibre?: boolean | null;
    /** e.g. "CC0 Paris Musées / Petit Palais, musée des Beaux-Arts de la Ville de Paris". */
    fieldImageDroits?: string | null;
  } | null;
}

interface Oeuvre {
  entityId?: string | null;
  title?: string | null;
  absolutePath?: string | null;
  fieldCartelAuteur?: string | null;
  fieldCartelDatation?: string | null;
  fieldCartelDenominationTitre?: string | null;
  fieldCartelDimension?: string | null;
  fieldCartelMateriaux?: string | null;
  fieldCartelModeAcquisition?: string | null;
  fieldDateProduction?: {
    startYear?: number | null;
    endYear?: number | null;
    processed?: string | null;
  } | null;
  fieldDescription?: { value?: string | null } | null;
  fieldOeuvreDescriptionIcono?: { value?: string | null } | null;
  fieldMusee?: Named | null;
  fieldMateriauxTechnique?: Named[] | null;
  fieldOeuvreAuteurs?:
    | {
        entity?: {
          fieldAuteurAttribution?: string | null;
          fieldAuteurAuteur?: Named | null;
        } | null;
      }[]
    | null;
  fieldVisuels?: Visuel[] | null;
}

// --- Helpers -----------------------------------------------------------------

async function query<T>(text: string, variables: Record<string, unknown>): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("PARISMUSEES_API_KEY is not set");
  const res = await postJson<GraphQlResponse<T>>(
    ENDPOINT,
    { query: text, variables },
    { headers: { "auth-token": key } },
  );
  // GraphQL reports failures with a 200 and an `errors` list.
  if (res.errors?.length) {
    const message = res.errors.map((e) => e.message).filter(Boolean).join("; ");
    throw new Error(`Paris Musées API error: ${message || "unknown error"}`);
  }
  if (!res.data) throw new Error("Paris Musées API returned no data");
  return res.data;
}

const clean = (value: string | null | undefined): string | undefined =>
  value?.replace(/\s+/g, " ").trim() || undefined;

/** "Monet, Claude" -> "Claude Monet". Leaves anything more complicated alone. */
function personName(value: string | null | undefined): string | undefined {
  const name = clean(value);
  const parts = name?.match(/^([^,()]+), ([^,()]+)$/);
  return parts ? `${parts[2]} ${parts[1]}` : name;
}

/** Year or year span from a Solr date range: "1910", "1661–1743". */
function yearsFromRange(range: string | null | undefined): string | undefined {
  const years = range?.match(/(-?\d{4})-\d\d-\d\dT[^ ]* TO (-?\d{4})-/);
  if (!years) return undefined;
  const [, start, end] = years.map((y) => String(Number(y)));
  return start === end ? start : `${start}–${end}`;
}

function stripHtml(value: string | null | undefined): string | undefined {
  const text = clean(value?.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "));
  if (!text) return undefined;
  return text.length > DESCRIPTION_LIMIT
    ? `${text.slice(0, DESCRIPTION_LIMIT).trimEnd()}…`
    : text;
}

const names = (items: Named[] | null | undefined): string[] =>
  (items ?? []).flatMap((i) => clean(i.entity?.name) ?? []);

const nodeUrl = (id: string) => `${SITE}/node/${id}`;

// --- Mapping -----------------------------------------------------------------

function toArtwork(doc: SearchDoc): Artwork | undefined {
  if (doc.nid_entier_s == null) return undefined;
  const id = String(doc.nid_entier_s);
  const title = clean(doc.titre_texte_s) ?? "Sans titre";
  return {
    source: "parismusees",
    id,
    title,
    titleOriginal: title,
    language: "fr",
    artist: personName(doc.auteur_texte_m),
    date: yearsFromRange(doc.production_date_m) ?? clean(doc.annee_texte_s),
    thumbnailUrl: clean(doc.premiere_image),
    museumUrl: nodeUrl(id),
  };
}

function artistOf(o: Oeuvre): string | undefined {
  const label = clean(o.fieldCartelAuteur);
  if (label) return label;
  const authors = (o.fieldOeuvreAuteurs ?? []).flatMap((a) => {
    const name = personName(a.entity?.fieldAuteurAuteur?.entity?.name);
    if (!name) return [];
    const attribution = clean(a.entity?.fieldAuteurAttribution);
    return [attribution ? `${name} (${attribution})` : name];
  });
  return authors.length ? [...new Set(authors)].join("; ") : undefined;
}

function dateOf(o: Oeuvre): string | undefined {
  const d = o.fieldDateProduction;
  if (clean(o.fieldCartelDatation)) return clean(o.fieldCartelDatation);
  if (d?.startYear != null && d.endYear != null && d.endYear !== d.startYear)
    return `${d.startYear}–${d.endYear}`;
  if (d?.startYear != null) return String(d.startYear);
  return clean(d?.processed);
}

function toDetail(o: Oeuvre, id: string): ArtworkDetail {
  const visuels = (o.fieldVisuels ?? []).flatMap((v) => (v.entity ? [v.entity] : []));
  // Only an image the museum flags as free gets a full-size URL and a licence.
  const free = visuels.find((v) => v.fieldImageLibre === true && clean(v.publicUrl));
  const shown = free ?? visuels.find((v) => clean(v.vignette));
  const title =
    clean(o.fieldCartelDenominationTitre) ?? clean(o.title) ?? "Sans titre";
  const museum = o.fieldMusee?.entity;
  const rights = clean(free?.fieldImageDroits);

  return {
    source: "parismusees",
    id: clean(o.entityId) ?? id,
    title,
    titleOriginal: title,
    language: "fr",
    artist: artistOf(o),
    date: dateOf(o),
    thumbnailUrl: clean(shown?.vignette),
    // The website serves only the original (about 3MB for a painting); the
    // public API offers no medium size, so both URLs are the same file.
    imageUrl: clean(free?.publicUrl),
    fullImageUrl: clean(free?.publicUrl),
    museumUrl: clean(o.absolutePath) ?? nodeUrl(id),
    medium: clean(o.fieldCartelMateriaux) ?? (names(o.fieldMateriauxTechnique).join(", ") || undefined),
    dimensions: clean(o.fieldCartelDimension),
    department: clean(museum?.fieldMuseeTitreCourt) ?? clean(museum?.name),
    creditLine: clean(o.fieldCartelModeAcquisition),
    isPublicDomain: Boolean(free),
    // The museum's own statement, verbatim ("CC0 Paris Musées / …"). It is not
    // shortened to "CC0": a qualified statement must not read as plain CC0, and
    // a missing one must not be filled in.
    license: free ? (rights ?? "Marked free by the museum; no rights statement given") : undefined,
    description:
      stripHtml(o.fieldOeuvreDescriptionIcono?.value) ??
      stripHtml(o.fieldDescription?.value),
  };
}

// --- Provider ----------------------------------------------------------------

export const parisMuseesProvider: Provider = {
  id: "parismusees",
  name: "Paris Musées",

  isAvailable() {
    return Boolean(apiKey());
  },

  async search(text, limit) {
    const keys = text.split(/\s+/).filter(Boolean);
    if (!keys.length) return [];
    // The index can hold several documents for one artwork (a search for
    // "Lavacourt" returns node 226737 three times), so ask for extra and
    // de-duplicate. It is still one request.
    const data = await query<{ searchAPISearch?: { documents?: SearchDoc[] | null } | null }>(
      SEARCH_QUERY,
      { keys, limit: Math.min(limit * OVERFETCH, MAX_FETCH) },
    );
    const seen = new Set<string>();
    return (data.searchAPISearch?.documents ?? [])
      .flatMap((d) => toArtwork(d) ?? [])
      .filter((a) => !seen.has(a.id) && Boolean(seen.add(a.id)))
      .slice(0, limit);
  },

  async getArtwork(id) {
    if (!/^\d+$/.test(id)) throw new Error(`Paris Musées ids are numeric, not '${id}'.`);
    const data = await query<{ nodeById?: Oeuvre | null }>(DETAIL_QUERY, { id });
    // A node that is not an artwork comes back without the NodeOeuvre fields.
    const oeuvre = data.nodeById;
    if (!oeuvre?.entityId) throw new Error(`No Paris Musées artwork found for '${id}'.`);
    return toDetail(oeuvre, id);
  },
};
