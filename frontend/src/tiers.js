export const TIER_COLORS = {
  "Immediate Review": "#e63965",
  "Scheduled Review": "#e0a12e",
  "Monitor": "#4c8bf5",
};

export const TIER_BG = {
  "Immediate Review": "rgba(230, 57, 101, 0.14)",
  "Scheduled Review": "rgba(224, 161, 46, 0.14)",
  "Monitor": "rgba(76, 139, 245, 0.14)",
};

export function tierColor(tier) {
  return TIER_COLORS[tier] || "#8892a6";
}

export function tierBg(tier) {
  return TIER_BG[tier] || "rgba(136,146,166,0.14)";
}
