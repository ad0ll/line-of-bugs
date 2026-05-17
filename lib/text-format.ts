/**
 * Title-case a common name for display. Lowercase-stored names like
 * "monarch butterfly" → "Monarch Butterfly". Skips words that look
 * like already-capitalized acronyms (no change). Leaves taxa with
 * embedded hyphens ("brown-headed cowbird") capitalized per word.
 *
 * Intentionally narrow: ONLY for common names. Scientific names follow
 * Linnaean convention (Genus capitalized, species lowercase) and must
 * stay as the DB stores them — don't pipe them through this.
 */
/**
 * iNaturalist observations identified only to the order level surface with
 * `taxon_species` == `taxon_order` (e.g., both "Lepidoptera"). The common
 * name in that case is the order's common name ("Butterflies, Moths or
 * Skippers"). Detecting this lets the UI collapse a 3-way duplicate
 * (common, scientific, chip) into a single display with an "(order)" hint.
 *
 * All three inputs must be present: if `commonName` is missing there's no
 * duplicate to collapse, and species/order are needed to detect the
 * order-level identification at all.
 */
export function isOrderOnlyId(
  commonName: string | null | undefined,
  taxonSpecies: string | null | undefined,
  taxonOrder: string | null | undefined,
): boolean {
  if (!commonName || !taxonSpecies || !taxonOrder) return false;
  return taxonSpecies.toLowerCase() === taxonOrder.toLowerCase();
}

export function titleCaseCommonName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .split(/(\s+)/) // Keep whitespace tokens so we don't collapse multiple spaces.
    .map((word) => {
      if (!word.trim()) return word;
      // Already has internal caps (e.g., "iPhone-style", "DNA") — leave alone.
      if (/[A-Z]/.test(word.slice(1))) return word;
      // Split on hyphens so "brown-headed" → "Brown-Headed".
      return word
        .split("-")
        .map((part) =>
          part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1).toLowerCase(),
        )
        .join("-");
    })
    .join("");
}
