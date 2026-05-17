export function sketchfabQueryKey(scientific: string, common: string) {
  return ["sketchfab", scientific, common] as const;
}
