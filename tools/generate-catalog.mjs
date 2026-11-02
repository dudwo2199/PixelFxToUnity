import { readdir, writeFile } from "node:fs/promises";

const root = new URL("../src/vendor/pixelfx/fx/", import.meta.url);
const order = ["fire", "explosions", "water", "ice", "lightning", "scifi", "melee", "impacts", "projectiles", "spawn", "arcane", "holy", "shadow", "status", "nature", "weather", "ui", "pickups", "transitions", "critters"];
const publishedEffects = [];
for (const category of order) {
  const dir = new URL(`${category}/`, root);
  const filenames = (await readdir(dir)).filter((name) => name.endsWith(".js") && !name.startsWith("_"));
  for (const filename of filenames.sort()) {
    const mod = await import(new URL(filename, dir).href);
    const id = `${category}/${filename.slice(0, -3)}`;
    const meta = { fps: 30, bg: "dark", loop: false, duration: 1, tags: [], options: {}, ...mod.meta };
    publishedEffects.push({ id, category, slug: filename.slice(0, -3), name: meta.name || filename.slice(0, -3), meta });
  }
}

if (publishedEffects.length !== 232) {
  throw new Error(`Expected 232 published gallery effects (without the 12 moves), found ${publishedEffects.length}.`);
}

await writeFile(new URL("../src/data/effects.json", import.meta.url), `${JSON.stringify(publishedEffects)}\n`, "utf8");
console.log(`Generated catalog for ${publishedEffects.length} official gallery effects.`);
