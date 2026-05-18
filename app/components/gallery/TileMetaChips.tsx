/**
 * Tile metadata chips: life stage → sex → institution.
 *
 * Display order (left to right) picked for drawing-student priority:
 *   1. life stage   — biggest morphological cue (adult vs. larva)
 *   2. sex          — anatomical detail
 *   3. institution  — attribution; visually distinguished via pink tint
 *
 * The taxon-order chip (e.g., "lepidoptera") is rendered separately by
 * `<OrderBadge>` in the meta-row above; this component is biological +
 * attribution metadata only.
 *
 * Empty / "unknown" values produce no chip — UI noise floor stays low.
 */
interface Props {
  lifeStage?: string | null;
  sex?: string | null;
  institution?: string | null;
}

export function TileMetaChips({ lifeStage, sex, institution }: Props) {
  const chips: { key: string; label: string }[] = [];
  if (lifeStage && lifeStage !== "unknown") chips.push({ key: "stage", label: lifeStage });
  if (sex && sex !== "unknown") chips.push({ key: "sex", label: sex });
  if (institution) chips.push({ key: "inst", label: institution });
  if (chips.length === 0) return null;
  return (
    <div className="grid-item-meta-chips">
      {chips.map((c) => (
        <span key={c.key} className={`grid-item-meta-chip is-${c.key}`}>
          {c.label}
        </span>
      ))}
    </div>
  );
}
