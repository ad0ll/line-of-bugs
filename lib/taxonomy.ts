/**
 * R6 layperson taxonomy — chip definitions for the "what kind of bug?"
 * filter. Each TaxonGroup maps a URL-safe `key` to a friendly UI `label`
 * and to a `dbValues` array (the literal taxon_subgroup column values it
 * matches). The "weird" chip also catches NULL rows so nothing is
 * permanently hidden.
 *
 * Order matters for UI display — most-common / most-recognized chips
 * first.
 */
import { sql, type SQL } from "drizzle-orm";

export interface TaxonGroup {
  /** URL-safe key, used as both the URL param value and the React key. */
  key: string;
  /** Friendly UI label shown on the chip. */
  label: string;
  /** taxon_subgroup column values this chip matches. */
  dbValues: readonly string[];
  /** True if this chip also catches NULL taxon_subgroup rows. */
  catchesNull?: boolean;
  /** Optional tooltip explaining the chip's contents — shown on hover for
   *  the ambiguous ones (weird, aphids, stick & leaf, etc.). */
  tooltip?: string;
}

export const TAXON_GROUPS: readonly TaxonGroup[] = [
  { key: "butterflies",  label: "butterflies",            dbValues: ["butterfly"] },
  { key: "moths",        label: "moths",                  dbValues: ["moth"] },
  { key: "caterpillars", label: "caterpillars",           dbValues: ["caterpillar"] },
  { key: "ladybugs",     label: "ladybugs",               dbValues: ["ladybug"] },
  { key: "beetles",      label: "beetles",                dbValues: ["beetle"] },
  { key: "bees",         label: "bees",                   dbValues: ["bee"] },
  { key: "wasps",        label: "wasps",                  dbValues: ["wasp"] },
  { key: "ants",         label: "ants",                   dbValues: ["ant"] },
  { key: "flies",        label: "flies",                  dbValues: ["fly"] },
  { key: "mosquitoes",   label: "mosquitoes",             dbValues: ["mosquito"] },
  { key: "dragonflies",  label: "dragonflies & damselflies", dbValues: ["dragonfly"] },
  { key: "grasshoppers", label: "grasshoppers",           dbValues: ["grasshopper"] },
  { key: "crickets",     label: "crickets",               dbValues: ["cricket"] },
  { key: "mantises",     label: "praying mantises",       dbValues: ["mantis"] },
  { key: "stick_insects",label: "stick & leaf insects",   dbValues: ["stick_insect"],
    tooltip: "Stick insects (Phasmatodea) — incl. leaf-mimicking ones." },
  { key: "cockroaches",  label: "cockroaches",            dbValues: ["cockroach"] },
  { key: "stink_bugs",   label: "stink bugs",             dbValues: ["stink_bug"] },
  { key: "cicadas",      label: "cicadas",                dbValues: ["cicada"] },
  { key: "aphids",       label: "aphids & scales",        dbValues: ["aphid"],
    tooltip: "Aphids, scale insects, mealybugs, whiteflies (Hemiptera Sternorrhyncha)." },
  { key: "earwigs",      label: "earwigs",                dbValues: ["earwig"] },
  {
    key: "weird",
    label: "weird stuff",
    dbValues: ["weird"],
    catchesNull: true,
    tooltip: "Lacewings, mayflies, caddisflies, stoneflies, fleas, silverfish, " +
             "termites, hoppers, and a handful of small orders most people don't have a word for.",
  },
] as const;

const VALID_KEYS = new Set(TAXON_GROUPS.map((g) => g.key));

export function isValidGroupKey(k: string): boolean {
  return VALID_KEYS.has(k);
}

export function parseGroupList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(isValidGroupKey);
}

/**
 * Build the SQL WHERE clause for the selected chips. Returns null if no
 * chips are selected (no filter applied).
 *
 * - Multi-chip = OR within the group: selecting "butterflies + beetles"
 *   matches rows where taxon_subgroup is EITHER value.
 * - The "weird" chip additionally matches NULL via the catchesNull flag.
 *
 * `column` is a SQL fragment for the taxon_subgroup reference — typically
 * `sql\`i.taxon_subgroup\`` (gallery, aliased to `i`) or
 * `sql\`${schema.images.taxonSubgroup}\`` (session, drizzle column).
 */
export function buildTaxonGroupSQL(selected: string[], column: SQL): SQL | null {
  if (!selected.length) return null;
  const valid = selected.filter(isValidGroupKey);
  if (!valid.length) return null;

  const dbValues = new Set<string>();
  let includesNull = false;
  for (const key of valid) {
    const group = TAXON_GROUPS.find((g) => g.key === key)!;
    for (const v of group.dbValues) dbValues.add(v);
    if (group.catchesNull) includesNull = true;
  }

  const values = [...dbValues];
  if (values.length === 0 && !includesNull) return null;

  if (includesNull && values.length > 0) {
    return sql`(${column} IS NULL OR ${column} IN (${sql.join(
      values.map((v) => sql`${v}`),
      sql`, `,
    )}))`;
  }
  if (includesNull) {
    return sql`${column} IS NULL`;
  }
  return sql`${column} IN (${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;
}
