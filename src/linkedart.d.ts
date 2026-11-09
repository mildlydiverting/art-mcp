// @thegetty/linkedart.js ships no type declarations. These cover only the
// helpers art-mcp calls; add to them as more are used.
declare module "@thegetty/linkedart.js" {
  /** A Linked Art JSON-LD node. The library works on plain parsed JSON. */
  export type LinkedArtNode = Record<string, unknown>;

  export interface HelperOptions {
    /** One AAT id, or a list, naming the classification to look for. */
    requestedClassifications?: string | string[];
    /** Limit results to this language ("en"); leave out for every language. */
    language?: string;
    languageOptions?: { fallbackLanguage?: string; [option: string]: unknown };
  }

  export function normalizeFieldToArray(resource: LinkedArtNode, field: string): LinkedArtNode[];
  /** Values of the entries classified as one of the given AAT ids. Empty when none match. */
  export function getValuesByClassification(
    resources: LinkedArtNode[],
    classifications: string | string[],
    options?: HelperOptions,
  ): string[];
  /** The content of the first entry in `referred_to_by` with this classification. */
  export function getReferredToByClassification(resource: LinkedArtNode, classification: string): string | undefined;
  export function getPrimaryName(resource: LinkedArtNode, options?: HelperOptions): string | undefined;
  export function getPrimaryNames(resource: LinkedArtNode, options?: HelperOptions): string[];
  export function getAccessionNumbers(resource: LinkedArtNode, options?: HelperOptions): string[];
  export function getDimensionsDescriptions(resource: LinkedArtNode, options?: HelperOptions): string[];
  export function getMaterialStatements(resource: LinkedArtNode, options?: HelperOptions): string[];
  export function getCultures(resource: LinkedArtNode, options?: HelperOptions): string[];
  export function getDigitalImages(resource: LinkedArtNode, options?: HelperOptions): string[];
  export function getRightsStatements(resource: LinkedArtNode, options?: HelperOptions): string[];
  export function getCopyrightStatements(resource: LinkedArtNode, options?: HelperOptions): string[];
  export function getAcknowledgementStatements(resource: LinkedArtNode, options?: HelperOptions): string[];
  export function getProductionTimespans(resource: LinkedArtNode): LinkedArtNode[];
  export function getCarriedOutBy(resource: LinkedArtNode, field?: string): LinkedArtNode[];
}
