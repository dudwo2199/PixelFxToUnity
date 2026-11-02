import { clearFrame, composite, createFrame, createFx } from "../vendor/pixelfx/core/index.js";
import { PALETTES } from "../data/catalog.js";

export function createPlayer(canvas, effect, config = {}, { scale = 1 } = {}) {
  const { meta, mod } = effect;
  const [width, height] = meta.size;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
  const context = canvas.getContext("2d", { alpha: true });
  context.imageSmoothingEnabled = false;
  const frame = createFrame(width, height);
  const image = context.createImageData(width, height);
  const fps = config.fps ?? meta.fps;
  const options = config.palette ? { palette: PALETTES[config.palette] } : {};
  let instance = createFx(mod, { x: meta.origin[0], y: meta.origin[1], ...options });
  let previous = performance.now();
  let accumulator = 0;
  let stopped = false;
  let animationFrame = 0;
  const step = 1 / Math.max(1, fps);

  const draw = () => {
    clearFrame(frame);
    instance.draw(frame);
    composite(frame, image.data, null);
    context.putImageData(image, 0, 0);
  };

  const tick = (now) => {
    if (stopped) return;
    const delta = Math.min(0.1, (now - previous) / 1000);
    previous = now;
    accumulator = Math.min(accumulator + delta, step * 6);
    let changed = false;
    while (accumulator >= step) {
      accumulator -= step;
      if (!meta.loop && instance.t >= meta.duration) {
        instance = createFx(mod, { x: meta.origin[0], y: meta.origin[1], ...options });
        accumulator = 0;
      } else {
        instance.update(step);
      }
      changed = true;
    }
    if (changed) draw();
    animationFrame = requestAnimationFrame(tick);
  };

  draw();
  animationFrame = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(animationFrame);
  };
}

export async function renderSpriteSheet(effect, config, onProgress = () => {}) {
  const { meta, mod } = effect;
  const fps = config.fps ?? meta.fps;
  const [frameWidth, frameHeight] = meta.size;
  const count = Math.max(1, Math.round(meta.duration * fps) + (meta.loop ? 0 : 1));
  const frame = createFrame(frameWidth, frameHeight);
  const instance = createFx(mod, {
    x: meta.origin[0],
    y: meta.origin[1],
    ...(config.palette ? { palette: PALETTES[config.palette] } : {}),
  });
  const columns = Math.min(count, Math.max(1, Math.ceil(Math.sqrt((count * frameHeight) / frameWidth))));
  const rows = Math.ceil(count / columns);
  const sheetWidth = columns * frameWidth;
  const sheetHeight = rows * frameHeight;
  const sheetCanvas = document.createElement("canvas");
  sheetCanvas.width = sheetWidth;
  sheetCanvas.height = sheetHeight;
  const sheetContext = sheetCanvas.getContext("2d", { alpha: true });
  for (let index = 0; index < count; index += 1) {
    if (index) instance.update(1 / fps);
    clearFrame(frame);
    instance.draw(frame);
    const rgba = new Uint8ClampedArray(frameWidth * frameHeight * 4);
    composite(frame, rgba, null);
    const x = (index % columns) * frameWidth;
    const y = Math.floor(index / columns) * frameHeight;
    sheetContext.putImageData(new ImageData(rgba, frameWidth, frameHeight), x, y);
    if (index % 8 === 0) {
      onProgress((index + 1) / count);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const sheetBlob = await new Promise((resolve, reject) => sheetCanvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 인코딩에 실패했습니다.")), "image/png"));
  const json = {
    frames: Array.from({ length: count }, (_, index) => ({
      filename: `${effect.slug} ${index}`,
      frame: { x: (index % columns) * frameWidth, y: Math.floor(index / columns) * frameHeight, w: frameWidth, h: frameHeight },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: frameWidth, h: frameHeight },
      sourceSize: { w: frameWidth, h: frameHeight },
      duration: Math.round(1000 / fps),
    })),
    meta: {
      app: "https://github.com/patch-gg/pixelfx",
      version: "1",
      image: `${effect.slug}.png`,
      format: "RGBA8888",
      size: { w: sheetWidth, h: sheetHeight },
      scale: "1",
      frameTags: [{ name: effect.name, from: 0, to: count - 1, direction: "forward" }],
      pixelfx: {
        id: effect.id,
        name: effect.name,
        fps,
        loop: meta.loop,
        frames: count,
        frameSize: [frameWidth, frameHeight],
        pivot: meta.origin,
        columns,
      },
    },
  };
  return { sheetBlob, json, fps, frameWidth, frameHeight, columns, count };
}

