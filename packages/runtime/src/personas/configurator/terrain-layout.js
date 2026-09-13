/** Queries over the single generated terrain representation; no actor occupancy policy. */
export function terrainPositions(layout, kind) {
  const data = layout?.data || layout;
  if (!data || !Array.isArray(data.terrain)) return [];
  return data.terrain.flatMap((terrain, index) =>
    (kind ? terrain === kind : terrain === 'floor')
      ? [{ x: index % data.width, y: Math.floor(index / data.width) }] : []);
}

export function terrainMarker(layout, kind) {
  return terrainPositions(layout, kind)[0] || null;
}
