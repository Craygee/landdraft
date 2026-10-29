export interface MarkerIconOption {
  id: string;
  label: string;
  symbol: string;
  category: "General" | "Land" | "Transportation" | "Utilities" | "Water" | "Energy";
}

/** Monochrome symbols stay recolorable in MapLibre and export reliably. */
export const markerIcons: MarkerIconOption[] = [
  { id: "dot", label: "Point", symbol: "●", category: "General" },
  { id: "ring", label: "Open point", symbol: "○", category: "General" },
  { id: "diamond", label: "Diamond", symbol: "◆", category: "General" },
  { id: "square", label: "Square", symbol: "■", category: "General" },
  { id: "triangle", label: "Direction", symbol: "▲", category: "General" },
  { id: "star", label: "Important", symbol: "★", category: "General" },
  { id: "flag", label: "Flag", symbol: "⚑", category: "General" },
  { id: "cross", label: "Medical / safety", symbol: "✚", category: "General" },
  { id: "home", label: "Residence", symbol: "⌂", category: "Land" },
  { id: "building", label: "Building", symbol: "▣", category: "Land" },
  { id: "parcel", label: "Parcel", symbol: "▰", category: "Land" },
  { id: "farm", label: "Farm / ranch", symbol: "♜", category: "Land" },
  { id: "park", label: "Park / habitat", symbol: "♣", category: "Land" },
  { id: "road", label: "Road", symbol: "═", category: "Transportation" },
  { id: "intersection", label: "Intersection", symbol: "✣", category: "Transportation" },
  { id: "rail", label: "Railroad", symbol: "≡", category: "Transportation" },
  { id: "airport", label: "Airport", symbol: "✈", category: "Transportation" },
  { id: "parking", label: "Parking", symbol: "P", category: "Transportation" },
  { id: "power", label: "Electric", symbol: "ϟ", category: "Utilities" },
  { id: "substation", label: "Substation", symbol: "⊠", category: "Utilities" },
  { id: "pipeline", label: "Pipeline", symbol: "⊚", category: "Utilities" },
  { id: "communications", label: "Communications", symbol: "⌁", category: "Utilities" },
  { id: "water", label: "Water", symbol: "≈", category: "Water" },
  { id: "well", label: "Water well", symbol: "◉", category: "Water" },
  { id: "tank", label: "Tank / reservoir", symbol: "◍", category: "Water" },
  { id: "dam", label: "Dam", symbol: "⊓", category: "Water" },
  { id: "oil", label: "Oil / gas well", symbol: "⊙", category: "Energy" },
  { id: "fuel", label: "Fuel", symbol: "⛽", category: "Energy" },
  { id: "solar", label: "Solar", symbol: "☀", category: "Energy" },
  { id: "wind", label: "Wind turbine", symbol: "ϒ", category: "Energy" },
];

export const defaultMarkerIcon = markerIcons[0]!;
