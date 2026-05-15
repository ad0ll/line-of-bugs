/**
 * Subject-type values shared across home, gallery, session, and APIs.
 *
 * R7 (2026-05-15) split the legacy "nature" chip into separate "wild"
 * and "captive" chips so users can pick captive (zoo / lab / garden)
 * subjects independently of wild-habitat photos. The DB column is
 * `subject_state` (DwC `basisOfRecord`); the UI chip key is the same.
 *
 *   wild     ↔ HumanObservation  (alive, natural habitat)
 *   captive  ↔ LivingSpecimen    (alive, human care)
 *   specimen ↔ PreservedSpecimen (mounted/dried/pinned)
 *   all      → no subject_state filter
 *
 * Legacy URL params (pre-R7 bookmarks) are remapped:
 *   subject=nature → wild  (closest single value; wild dominates the old set)
 *   subject=both   → all
 */
export const SUBJECT_TYPES = ["wild", "captive", "specimen", "all"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

const VALID = new Set<string>(SUBJECT_TYPES);
const LEGACY: Record<string, SubjectType> = {
  nature: "wild",
  both: "all",
};

/**
 * Strict parse — returns null if the raw value isn't a current or
 * legacy SubjectType. Use this at API entry points where unknown
 * values should 400.
 */
export function parseSubjectStrict(raw: string | null | undefined): SubjectType | null {
  if (raw == null || raw === "") return null;
  if (VALID.has(raw)) return raw as SubjectType;
  return LEGACY[raw] ?? null;
}

/**
 * Lenient parse — defaults to "all" when the value is missing,
 * empty, or unrecognized. Use this for URL params where stale
 * bookmarks shouldn't break the page.
 */
export function parseSubject(raw: string | null | undefined): SubjectType {
  return parseSubjectStrict(raw) ?? "all";
}

export function isSubjectType(raw: string): raw is SubjectType {
  return VALID.has(raw);
}
