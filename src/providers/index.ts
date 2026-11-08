import type { Provider, Source } from "../types.js";
import { articProvider } from "./artic.js";
import { clevelandProvider } from "./cleveland.js";
import { europeanaArchivesProvider, europeanaProvider } from "./europeana.js";
import { harvardProvider } from "./harvard.js";
import { japanSearchProvider } from "./japansearch.js";
import { metProvider } from "./met.js";
import { nationalGalleryProvider } from "./nationalgallery.js";
import { rijksmuseumProvider } from "./rijksmuseum.js";
import { smithsonianProvider } from "./smithsonian.js";
import { smkProvider } from "./smk.js";
import { tepapaProvider } from "./tepapa.js";
import { vamProvider } from "./vam.js";
import { whitneyProvider } from "./whitney.js";
import { wikidataProvider } from "./wikidata.js";

/** All known providers, in default fan-out order. */
export const providers: Provider[] = [
  metProvider,
  articProvider,
  clevelandProvider,
  harvardProvider,
  rijksmuseumProvider,
  nationalGalleryProvider,
  whitneyProvider,
  smkProvider,
  vamProvider,
  smithsonianProvider,
  japanSearchProvider,
  tepapaProvider,
  europeanaProvider,
  europeanaArchivesProvider,
  wikidataProvider,
];

const byId = new Map<Source, Provider>(providers.map((p) => [p.id, p]));

export function getProvider(source: Source): Provider | undefined {
  return byId.get(source);
}

/**
 * Providers an `all` search covers: those that can currently be queried
 * (required keys present), leaving out sources that are searched only when named.
 */
export function availableProviders(): Provider[] {
  return providers.filter((p) => p.isAvailable() && !p.onlyWhenNamed);
}
