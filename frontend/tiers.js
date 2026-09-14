// Plain global helpers - no build step, loaded via a plain <script> tag.
const TIER_COLORS = {
  "Immediate Review": "#e63965",
  "Scheduled Review": "#e0a12e",
  "Monitor": "#4c8bf5",
};

const TIER_BG = {
  "Immediate Review": "rgba(230, 57, 101, 0.14)",
  "Scheduled Review": "rgba(224, 161, 46, 0.14)",
  "Monitor": "rgba(76, 139, 245, 0.14)",
};

function tierColor(tier) {
  return TIER_COLORS[tier] || "#8892a6";
}

function tierBg(tier) {
  return TIER_BG[tier] || "rgba(136,146,166,0.14)";
}
