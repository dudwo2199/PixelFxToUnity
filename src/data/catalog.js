import manifest from "./effects.json";
import { PAL } from "../vendor/pixelfx/core/color.js";

const moduleLoaders = import.meta.glob([
  "../vendor/pixelfx/fx/fire/*.js", "../vendor/pixelfx/fx/explosions/*.js", "../vendor/pixelfx/fx/water/*.js",
  "../vendor/pixelfx/fx/ice/*.js", "../vendor/pixelfx/fx/lightning/*.js", "../vendor/pixelfx/fx/scifi/*.js",
  "../vendor/pixelfx/fx/melee/*.js", "../vendor/pixelfx/fx/impacts/*.js", "../vendor/pixelfx/fx/projectiles/*.js",
  "../vendor/pixelfx/fx/spawn/*.js", "../vendor/pixelfx/fx/arcane/*.js", "../vendor/pixelfx/fx/holy/*.js",
  "../vendor/pixelfx/fx/shadow/*.js", "../vendor/pixelfx/fx/status/*.js", "../vendor/pixelfx/fx/nature/*.js",
  "../vendor/pixelfx/fx/weather/*.js", "../vendor/pixelfx/fx/ui/*.js", "../vendor/pixelfx/fx/pickups/*.js",
  "../vendor/pixelfx/fx/transitions/*.js", "../vendor/pixelfx/fx/critters/*.js",
]);
const pending = new Map();

export const CATEGORY_ORDER = [
  "fire", "explosions", "water", "ice", "lightning", "scifi", "melee", "impacts",
  "projectiles", "spawn", "arcane", "holy", "shadow", "status", "nature", "weather",
  "ui", "pickups", "transitions", "critters",
];

export const CATEGORY_LABELS = {
  fire: "Fire", explosions: "Explosions", water: "Water", ice: "Ice", lightning: "Lightning",
  scifi: "Sci-fi", melee: "Melee", impacts: "Impacts", projectiles: "Projectiles", spawn: "Spawn & death",
  arcane: "Arcane", holy: "Holy", shadow: "Shadow", status: "Status", nature: "Nature", weather: "Weather",
  ui: "UI", pickups: "Pickups", transitions: "Transitions", critters: "Critters",
};

export const CATEGORIES = CATEGORY_ORDER.map((id) => ({ id, name: CATEGORY_LABELS[id] }));
export const EFFECTS = manifest.map((entry) => ({ ...entry, mod: null }));
export const EFFECT_BY_ID = new Map(EFFECTS.map((effect) => [effect.id, effect]));
export const PALETTES = PAL;
export const PALETTE_NAMES = Object.keys(PAL);
export const APP_VERSION = "1.0.0";
export const SETTINGS_SCHEMA = 1;

export async function loadEffect(effect) {
  if (effect.mod) return effect;
  if (pending.has(effect.id)) return pending.get(effect.id);
  const key = `../vendor/pixelfx/fx/${effect.id}.js`;
  const loader = moduleLoaders[key];
  if (!loader) throw new Error(`이펙트 모듈을 찾을 수 없습니다: ${effect.id}`);
  const request = loader().then((mod) => {
    effect.mod = mod;
    pending.delete(effect.id);
    return effect;
  }).catch((error) => {
    pending.delete(effect.id);
    throw error;
  });
  pending.set(effect.id, request);
  return request;
}

