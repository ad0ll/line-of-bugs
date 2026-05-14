# Sketchfab Integration — Deferred

**Status:** Deferred. Not part of MVP. User direction 2026-05-14:
*"Sketchfab button, out of scope for right now, we'll come back to this
after we have the basic app working."*

## What we have

- API key provisioned and stored in `.env.local` (gitignored) as
  `SKETCHFAB_API_KEY=...`.
- The key is currently NOT used by any code or download script.

## Original intent (when we come back)

User original quote (2026-05-14):
> *"Just for my dynamic sketching class, can you add a Search on Sketchfab
> action that opens a new tab prefilled w/ a search for the insect name in
> sketchup? This is best effort, the link + url definitely should work,
> but we don't care if results are found at this point. I'm going to get
> you api access later and we'll prefill the metadata with a field saying
> if there's hits on sketchfab or not."*

Two scopes:
1. **Action-bar button** (UI, runtime): "Search on Sketchfab" button on the
   session action bar, only visible in the dynamic-sketching mode/preset.
   Opens `https://sketchfab.com/search?type=models&q=<bug-name>` in a new
   tab. No client-side validation that hits exist.
2. **Metadata enrichment** (build-time / cron): pre-compute a
   `has_sketchfab_models` boolean per species using the Sketchfab Search
   API. Endpoint: `https://api.sketchfab.com/v3/search?type=models&q=<query>&downloadable=false`.
   Authenticated via the API key. Cache results so the action-bar button
   can be greyed out when no models exist.

## Open implementation questions for that future phase

- Is the dynamic-sketching mode a Home-screen toggle, a separate preset
  card, a URL param, or a class-account flag?
- Cache TTL for `has_sketchfab_models` — daily refresh, weekly, monthly?
- Tie-breaking: which species name to query — common name, scientific
  name, or both? (Scientific is more precise but rarely matched by
  3D-model uploaders; common name is more permissive.)

That's all for now. Pick this back up after Phase 1 (data + session view +
gallery + admin) is shipped.
