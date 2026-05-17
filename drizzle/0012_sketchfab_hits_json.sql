-- Cache the trimmed Sketchfab hit array as JSON alongside the bool flag.
-- Required because prod's Hetzner egress IP is bot-blocked by Akamai
-- (Sketchfab's CDN), so the route handler cannot call Sketchfab live.
-- A remote enrichment job (Windmill) populates this column; the route
-- handler serves directly from it without touching Sketchfab.
--
-- NULL = unchecked. "[]" should not appear: when has_sketchfab_models is 0,
-- this column stays NULL to keep the "no data" semantic unambiguous.
ALTER TABLE `species_metadata`
  ADD COLUMN `sketchfab_hits_json` text;
