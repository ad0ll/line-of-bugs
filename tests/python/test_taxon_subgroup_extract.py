"""Tests for scripts.backfill_taxon_subgroup.classify (R6).

classify(taxon_order, ancestor_ids) walks the iNat ancestor chain
looking for the IDs in TAXON_ID_TO_SUBGROUP. First match wins, so
more-specific IDs must precede general ones. Then a per-order default
applies for everything else.
"""
from scripts.backfill_taxon_subgroup import classify


# Ancestor lists are illustrative — they only need the FIRST matching
# ID present, so we keep them short.

def test_lepidoptera_with_papilionoidea_returns_butterfly():
    assert classify("Lepidoptera", [47157, 47224, 999999]) == "butterfly"


def test_lepidoptera_without_papilionoidea_returns_moth():
    assert classify("Lepidoptera", [47157, 12345]) == "moth"


def test_lepidoptera_larva_order_returns_caterpillar():
    # Lepidoptera_larva is our project's synthetic order tag (R3 pull).
    # No ancestor check needed — the order name alone is decisive.
    assert classify("Lepidoptera_larva", []) == "caterpillar"


def test_coleoptera_with_coccinellidae_returns_ladybug():
    assert classify("Coleoptera", [47208, 48486]) == "ladybug"


def test_coleoptera_without_coccinellidae_returns_beetle():
    assert classify("Coleoptera", [47208, 99999]) == "beetle"


def test_hymenoptera_with_anthophila_returns_bee():
    assert classify("Hymenoptera", [47201, 630955]) == "bee"


def test_hymenoptera_with_formicidae_returns_ant():
    assert classify("Hymenoptera", [47201, 47336]) == "ant"


def test_hymenoptera_without_known_subgroup_returns_wasp():
    # Catch-all for stinging insects in this order. Sawflies (Symphyta)
    # technically aren't wasps but they're rare and visually wasp-ish.
    assert classify("Hymenoptera", [47201, 12345]) == "wasp"


def test_diptera_with_culicidae_returns_mosquito():
    assert classify("Diptera", [47822, 52134]) == "mosquito"


def test_diptera_without_culicidae_returns_fly():
    assert classify("Diptera", [47822, 99999]) == "fly"


def test_hemiptera_with_heteroptera_returns_stink_bug():
    assert classify("Hemiptera", [47744, 61267]) == "stink_bug"


def test_hemiptera_with_sternorrhyncha_returns_aphid():
    assert classify("Hemiptera", [47744, 334037]) == "aphid"


def test_hemiptera_with_cicadidae_returns_cicada():
    # Cicadidae is more specific than its parent suborder, so Cicada
    # should win even when both could match.
    assert classify("Hemiptera", [47744, 50186, 125816]) == "cicada"


def test_odonata_returns_dragonfly():
    assert classify("Odonata", [47792]) == "dragonfly"


def test_mantodea_returns_mantis():
    assert classify("Mantodea", [48112]) == "mantis"


def test_phasmatodea_returns_stick_insect():
    assert classify("Phasmatodea", [47198]) == "stick_insect"


def test_blattodea_returns_cockroach():
    assert classify("Blattodea", [81769]) == "cockroach"


def test_dermaptera_returns_earwig():
    assert classify("Dermaptera", [47793]) == "earwig"


def test_orthoptera_caelifera_returns_grasshopper():
    assert classify("Orthoptera", [47651, 67688]) == "grasshopper"


def test_orthoptera_ensifera_returns_cricket():
    assert classify("Orthoptera", [47651, 132694]) == "cricket"


def test_orthoptera_without_known_suborder_falls_through_to_cricket():
    # When we can't tell, default to cricket (the smaller group; visually
    # less likely to mislead than calling everything a grasshopper).
    assert classify("Orthoptera", [47651, 12345]) == "cricket"


def test_hemiptera_without_known_suborder_falls_into_weird():
    # Leafhoppers, planthoppers, treehoppers, spittlebugs — visually
    # distinct from stink bugs and laypeople have no chip for them.
    assert classify("Hemiptera", [47744, 12345]) == "weird"


def test_neuroptera_falls_into_weird():
    assert classify("Neuroptera", [48763]) == "weird"


def test_ephemeroptera_falls_into_weird():
    assert classify("Ephemeroptera", [48011]) == "weird"


def test_trichoptera_falls_into_weird():
    assert classify("Trichoptera", [62164]) == "weird"


def test_plecoptera_falls_into_weird():
    assert classify("Plecoptera", [47504]) == "weird"


def test_siphonaptera_falls_into_weird():
    assert classify("Siphonaptera", []) == "weird"


def test_thysanura_falls_into_weird():
    assert classify("Thysanura", []) == "weird"


def test_empty_inputs_returns_none():
    assert classify("", []) is None


def test_unknown_order_returns_weird():
    # Anything with a non-empty taxon_order resolves to "weird" rather
    # than None so the chip filter has full coverage. (Empty string
    # still returns None — see test_empty_inputs_returns_none.)
    assert classify("MadeUpOrder", [123, 456]) == "weird"


def test_isoptera_termites_return_weird():
    # Modern taxonomy folds termites into Blattodea, but Bugwood still
    # tags them as the older Isoptera order. Default to weird since
    # laypeople don't have a "termites" chip.
    assert classify("Isoptera", []) == "weird"


def test_thysanoptera_thrips_return_weird():
    assert classify("Thysanoptera", []) == "weird"


def test_cicada_before_aphid_specificity():
    """When a chain happens to contain both Cicadidae (50186) AND
    Auchenorrhyncha (125816) AND Sternorrhyncha (334037), pick the
    most specific (cicada). This wouldn't naturally happen but the
    iteration order in TAXON_ID_TO_SUBGROUP must be specific-first
    for the dict insertion-order rule to work."""
    assert classify("Hemiptera", [47744, 50186, 125816, 334037]) == "cicada"
