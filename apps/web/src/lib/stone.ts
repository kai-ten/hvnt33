// The stones of the emblema and the mark, one set per theme, and the Greek key.
// Shared by Mosaic.tsx (the hero) and scripts/mark.ts (icons), so the two are
// always laid from the same stone. Change these together, never one at a time.

export const palettes = {
  light: {
    grout: "#d3c5a7", cream: ["#f2e9d8", "#ede3cd", "#e8ddc5", "#f4ede0", "#eadfc8"], band: ["#e4d6b9", "#dfd0b1", "#e7dac0"],
    dark: ["#2a2521", "#231f1b", "#342d27", "#2e2824"], red: ["#a3261a", "#942119", "#b0311f", "#8c1f16"],
    gold: ["#b98a3e", "#c49645", "#a97b34", "#cc9f52"], sand: ["#dcbb82", "#d4b074", "#cfa968", "#e0c28f", "#d8b67b"],
    course: ["#8f6e3d", "#7f6035", "#977442"], cap: ["#eed6a2", "#e8cd93", "#f2dcae"], ivory: ["#fbf7ec", "#f6efdf", "#fdfaf2"],
    light: "rgba(255, 252, 240, 0.34)",
  },
  dark: {
    grout: "#0c0a09", cream: ["#2e2923", "#29241f", "#332d26", "#2b2621", "#312b24"], band: ["#24201b", "#27221d", "#211d19"],
    dark: ["#ddd0b3", "#d4c6a8", "#e3d8bf", "#cfc1a2"], red: ["#e2664f", "#d4583f", "#ea7760", "#c94f39"],
    gold: ["#c99a4c", "#d4a758", "#b98a3e", "#deb366"], sand: ["#6e5a3c", "#655236", "#735f40", "#5f4d33", "#6a5739"],
    course: ["#a88550", "#9a7a48", "#b28d57"], cap: ["#8a7147", "#937a4e", "#806a43"], ivory: ["#eee6d3", "#e6dcc6", "#f3ecdc"],
    light: "rgba(255, 226, 170, 0.16)",
  },
};

// The Greek key: one continuous line that turns in on itself and runs on into
// the next unit. Ten cells per unit, seven rows.
export const key = [
  "#########.",
  "#.......#.",
  "#.#####.#.",
  "#.#...#.#.",
  "#.#...###.",
  "#.#.......",
  "#.########",
];
