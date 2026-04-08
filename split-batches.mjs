import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('Abandoned by My Alpha Mate.json', 'utf-8'));

const batches = [
  { name: 'batch-1-phase1-起', eps: [1, 2, 3, 4] },
  { name: 'batch-2-phase2-承', eps: [5, 6, 7] },
  { name: 'batch-3-phase3-转', eps: [8, 9, 10, 11] },
  { name: 'batch-4-phase4-合', eps: [12, 13] },
  { name: 'batch-5-phase5-终', eps: [14, 15, 16, 17, 18, 19, 20] },
];

// "Kennedy" in episodes → "Kennedy Barnes" in character_arcs
const nameMap = { 'Kennedy': 'Kennedy Barnes', 'Alpha Morgan': null };

function resolveArcName(epName) {
  return nameMap[epName] !== undefined ? nameMap[epName] : epName;
}

for (const batch of batches) {
  const episodes = data.episodes.filter(ep => batch.eps.includes(ep.ep_num));

  // Collect character names used in this batch
  const charNames = new Set();
  for (const ep of episodes) {
    for (const name of ep.output.characters) {
      const resolved = resolveArcName(name);
      if (resolved) charNames.add(resolved);
    }
  }
  // Always include Lyra when Sylvia is present (inner wolf, story-critical)
  if (charNames.has('Sylvia')) charNames.add('Lyra');

  // Collect location IDs referenced in scene_locations
  const locationIds = new Set();
  for (const ep of episodes) {
    for (const loc of Object.values(ep.output.scene_locations)) {
      if (loc.location_id) locationIds.add(loc.location_id);
      if (loc.parent_location_id) locationIds.add(loc.parent_location_id);
    }
  }

  // Filter character_arcs
  const characterArcs = data.character_arcs.filter(arc => charNames.has(arc.name));

  // Filter location_bible — keep parent if any child is referenced
  const locationBible = data.location_bible
    .filter(loc => {
      if (locationIds.has(loc.id)) return true;
      return loc.sub_locations?.some(sub => locationIds.has(sub.id));
    })
    .map(loc => ({
      ...loc,
      sub_locations: (loc.sub_locations || []).filter(sub => locationIds.has(sub.id)),
    }));

  const output = {
    title: data.title,
    synopsis: data.synopsis,
    character_arcs: characterArcs,
    location_bible: locationBible,
    episodes,
  };

  const filename = `${batch.name}.json`;
  const json = JSON.stringify(output, null, 2);
  writeFileSync(filename, json, 'utf-8');

  const kb = (Buffer.byteLength(json) / 1024).toFixed(1);
  console.log(
    `${filename}: ${episodes.length} eps, ${characterArcs.length} chars, ${locationBible.length} locs, ${kb} KB`
  );
}
