[out:json][timeout:90];
(
  // crossings and what controls them
  node["highway"="crossing"](around:3219,29.619752,-95.584352);
  node["crossing"](around:3219,29.619752,-95.584352);
  node["highway"="traffic_signals"](around:3219,29.619752,-95.584352);
  node["highway"="stop"](around:3219,29.619752,-95.584352);
  node["kerb"](around:3219,29.619752,-95.584352);
  // walking network: separately mapped sidewalks, footways, paths, crossings drawn as ways
  way["highway"~"^(footway|path|pedestrian|steps|cycleway)$"](around:3219,29.619752,-95.584352);
  // roads, with any sidewalk=* tag (both/left/right/separate/no) so "no sidewalk" can be scored
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](around:3219,29.619752,-95.584352);
  // the school itself (to cross-check the NCES point and get its footprint/entrances)
  nwr["amenity"="school"](around:300,29.619752,-95.584352);
);
out body geom;
