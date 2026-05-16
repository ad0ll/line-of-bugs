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
