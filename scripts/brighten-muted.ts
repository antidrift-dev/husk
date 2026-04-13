import fs from "fs";
import path from "path";

const themesDir = path.join(__dirname, "..", "themes");

function brightenHex(hex: string, amount: number): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function darkenHex(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function isLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r + g + b) / 3 > 128;
}

for (const file of fs.readdirSync(themesDir).filter(f => f.endsWith(".yaml"))) {
  let content = fs.readFileSync(path.join(themesDir, file), "utf-8");

  // Find bg to determine light/dark
  const bgMatch = content.match(/^\s+bg:\s+"(#[0-9a-f]{6})"/im);
  const light = bgMatch ? isLight(bgMatch[1]) : false;

  // Brighten textMuted by 30 for dark, darken by 20 for light
  content = content.replace(/textMuted:\s+"(#[0-9a-f]{6})"/i, (_, hex) => {
    const newHex = light ? darkenHex(hex, 20) : brightenHex(hex, 30);
    return `textMuted: "${newHex}"`;
  });

  // Brighten textFaint by 25 for dark, darken by 15 for light
  content = content.replace(/textFaint:\s+"(#[0-9a-f]{6})"/i, (_, hex) => {
    const newHex = light ? darkenHex(hex, 15) : brightenHex(hex, 25);
    return `textFaint: "${newHex}"`;
  });

  fs.writeFileSync(path.join(themesDir, file), content);
  console.log(`${file}: ${light ? "light" : "dark"} — adjusted`);
}
