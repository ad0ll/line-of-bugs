/**
 * Short layperson-friendly explanations for filter labels. Kept in
 * one place so the wording stays consistent between the home page
 * and the gallery (both surfaces use the same filters).
 */
import type { ReactNode } from "react";

interface TooltipDef {
  label: string;
  content: ReactNode;
}

export const TOOLTIPS = {
  interval: {
    label: "interval per slide",
    content: "How long each photo stays on screen before the next one. Short intervals push gesture practice; longer ones let you finish a sketch.",
  },
  subject: {
    label: "subject type",
    content: <>
      <strong>wild</strong> — bugs photographed in their habitat, alive.{" "}
      <strong>captive</strong> — alive but staged (a hand, a leaf in a jar, a studio shot).{" "}
      <strong>specimen</strong> — preserved/pinned museum photos.{" "}
      <strong>all</strong> — everything.
    </>,
  },
  view: {
    label: "view",
    content: <>
      The angle the bug was photographed from.{" "}
      <strong>dorsal</strong> = top-down,{" "}
      <strong>ventral</strong> = belly-up,{" "}
      <strong>lateral</strong> = side profile.{" "}
      Most of our wild photos aren't labeled — those show as <strong>unknown</strong>.
    </>,
  },
  lifeStage: {
    label: "life stage",
    content: <>
      Most insects go through forms.{" "}
      <strong>adult</strong> = the flying/walking grown-up.{" "}
      <strong>larva</strong> = the caterpillar/grub stage.{" "}
      <strong>nymph</strong> = a juvenile that looks like a tiny adult.{" "}
      <strong>pupa</strong> / <strong>cocoon</strong> = the in-between sealed phase.
    </>,
  },
  sex: {
    label: "sex",
    content: <>
      <strong>male</strong> / <strong>female</strong> when the photographer could tell.{" "}
      <strong>worker</strong> applies to social insects (bees, ants, wasps) — a non-reproductive female caste.{" "}
      Most photos don't have this labeled — those show as <strong>unknown</strong>.
    </>,
  },
  repeatMode: {
    label: "repeat behavior",
    content: <>
      Controls whether the same species can show up twice in your session.{" "}
      <strong>one per species</strong> is the strict mode for "I want variety."
    </>,
  },
  institution: {
    label: "institution",
    content: "Where the photo came from — iNaturalist (citizen-science snapshots), Bugwood (university + USDA collections), Smithsonian (museum specimens).",
  },
  taxonGroup: {
    label: "what kind of bug?",
    content: <>
      Filter by familiar bug categories. <strong>butterflies</strong> and{" "}
      <strong>moths</strong> are split apart; <strong>ladybugs</strong> are their{" "}
      own thing separately from other <strong>beetles</strong>.{" "}
      <strong>weird stuff</strong> covers the small orders (lacewings, mayflies,
      caddisflies, stoneflies, fleas, silverfish, termites, hoppers) most people
      don't have a word for.
    </>,
  },
} as const satisfies Record<string, TooltipDef>;

export type TooltipKey = keyof typeof TOOLTIPS;
