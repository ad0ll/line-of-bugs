export const orderColors: Record<string, string> = {
  Coleoptera:    '#FF6EC7',
  Lepidoptera:   '#F8B4D9',
  Hymenoptera:   '#FFD166',
  Hemiptera:     '#E16AAA',
  Diptera:       '#A78BFA',
  Odonata:       '#67D4E6',
  Orthoptera:    '#A8E6A1',
  Mantodea:      '#7FD89A',
  Neuroptera:    '#D4C5F9',
  Blattodea:     '#9C8AAC',
  Dermaptera:    '#C9A8D4',
  Phasmatodea:   '#B8D898',
  Trichoptera:   '#E8A8D4',
  Ephemeroptera: '#F0D796',
  Plecoptera:    '#88B8D4',
  Isoptera:      '#A89684',
  Other:         '#B8B0C4',
};

export function orderColor(order: string | null | undefined): string {
  if (!order) return orderColors.Other!;
  return orderColors[order] ?? orderColors.Other!;
}
