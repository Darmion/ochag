import { Color3, DynamicTexture, Texture, StandardMaterial, Scene } from '@babylonjs/core';
import type { WallStyle, WallSegment, TabletopOptions } from '../sceneTypes';

export type WallTexturesDeps = {
  options: TabletopOptions;
  scene: Scene;
};

const ROCK_PALETTE = { dark: [58, 55, 51], light: [148, 141, 130], moss: 0.04 } as const;

function periodicNoise(random: () => number, cells: number) {
  const values = Array.from({ length: cells * cells }, () => random());
  const at = (i: number, j: number) => values[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)]!;
  return (u: number, v: number) => {
    const gx = u * cells, gy = v * cells;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
    const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bottom * sy;
  };
}

// Periodic noise and integer strata keep the tile seamless both ways, so long cliffs show no seams.
function paintRock(ctx: CanvasRenderingContext2D, size: number, random: () => number) {
  const palette = ROCK_PALETTE;
  const octaves = [4, 8, 16, 32, 64].map(cells => periodicNoise(random, cells));
  const weights = [0.4, 0.25, 0.16, 0.11, 0.08];
  const fbm = (u: number, v: number) => octaves.reduce((sum, noise, index) => sum + noise(u, v) * weights[index]!, 0);
  const mossNoise = periodicNoise(random, 6);
  const bands = 4;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size, v = y / size;
      const warp = fbm(u, v);
      const strata = 0.5 + 0.5 * Math.sin((v + warp * 0.3) * Math.PI * 2 * bands);
      height[y * size + x] = warp * 0.72 + strata * 0.28;
    }
  }
  const image = ctx.createImageData(size, size);
  const at = (x: number, y: number) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)]!;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const h = at(x, y);
      const relief = Math.max(0, Math.min(1, 0.5 + (h - at(x - 3, y - 3)) * 9));
      const tone = Math.max(0, Math.min(1, (h - 0.25) * 1.7));
      const lit = 0.62 + relief * 0.62;
      let r = (palette.dark[0] + (palette.light[0] - palette.dark[0]) * tone) * lit;
      let g = (palette.dark[1] + (palette.light[1] - palette.dark[1]) * tone) * lit;
      let b = (palette.dark[2] + (palette.light[2] - palette.dark[2]) * tone) * lit;
      const low = y / size;
      const moss = Math.max(0, (mossNoise(x / size, y / size) - (0.86 - palette.moss - low * 0.06)) * 4) * (relief > 0.45 ? 1 : 0.4);
      if (moss > 0) {
        const k = Math.min(0.5, moss);
        r = r * (1 - k) + 70 * k; g = g * (1 - k) + 96 * k; b = b * (1 - k) + 48 * k;
      }
      const grain = (random() - 0.5) * 14;
      const index = (y * size + x) * 4;
      image.data[index] = Math.max(0, Math.min(255, r + grain));
      image.data[index + 1] = Math.max(0, Math.min(255, g + grain));
      image.data[index + 2] = Math.max(0, Math.min(255, b + grain));
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const crack = (points: Array<[number, number]>, width: number) => {
    for (const shift of [-size, 0, size]) {
      for (const [color, offset] of [['rgba(255,255,255,0.10)', 1], ['rgba(0,0,0,0.55)', 0]] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        points.forEach(([px, py], index) => ctx[index ? 'lineTo' : 'moveTo'](px + shift + offset, py + offset));
        ctx.stroke();
      }
    }
  };
  for (let index = 0; index < 7; index += 1) {
    let x = random() * size, y = random() * size;
    const points: Array<[number, number]> = [[x, y]];
    const steps = 4 + Math.floor(random() * 5);
    for (let step = 0; step < steps; step += 1) {
      x += 14 + random() * 34;
      y += (random() - 0.5) * 18;
      points.push([x, y]);
    }
    crack(points, 1 + random() * 1.4);
  }
  for (let index = 0; index < 4; index += 1) {
    let x = random() * size, y = random() * size * 0.5;
    const points: Array<[number, number]> = [[x, y]];
    for (let step = 0; step < 4; step += 1) {
      x += (random() - 0.5) * 16;
      y += 18 + random() * 30;
      points.push([x, y]);
    }
    crack(points, 1 + random());
  }
}

export function createWallTextures({ options, scene }: WallTexturesDeps) {
  const wallMaterials = new Map<string, StandardMaterial>();
  function seeded(seed: number) {
    let value = seed;
    return () => {
      value = (value * 1664525 + 1013904223) % 4294967296;
      return value / 4294967296;
    };
  }

  function shade(hex: string, amount: number) {
    const color = Color3.FromHexString(hex);
    const k = 1 + amount;
    return new Color3(Math.min(1, color.r * k), Math.min(1, color.g * k), Math.min(1, color.b * k)).toHexString();
  }

  function paintWallTexture(style: Exclude<WallStyle, 'image' | 'plain'>) {
    const size = style === 'rock' ? 512 : 256;
    const texture = new DynamicTexture(`wall-texture-${style}`, { width: size, height: size }, scene, true);
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    const random = seeded(style.length * 977 + style.charCodeAt(0));
    const block = (x: number, y: number, w: number, h: number, base: string, spread: number) => {
      ctx.fillStyle = shade(base, (random() - 0.5) * spread);
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x, y, w, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x, y + h - 3, w, 3);
    };
    const speckle = (count: number, alpha: number) => {
      for (let i = 0; i < count; i += 1) {
        ctx.fillStyle = random() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha * 0.7})`;
        ctx.fillRect(random() * size, random() * size, 2, 2);
      }
    };

    if (style === 'stone') {
      ctx.fillStyle = '#34312d';
      ctx.fillRect(0, 0, size, size);
      const rowHeight = size / 6;
      for (let row = 0; row < 6; row += 1) {
        let x = -random() * 40;
        while (x < size) {
          const w = 46 + random() * 44;
          block(x + 2, row * rowHeight + 2, w - 4, rowHeight - 4, '#77736c', 0.35);
          x += w;
        }
      }
      speckle(900, 0.12);
    } else if (style === 'brick') {
      ctx.fillStyle = '#b9ab92';
      ctx.fillRect(0, 0, size, size);
      const rowHeight = size / 10;
      for (let row = 0; row < 10; row += 1) {
        const offset = row % 2 ? -32 : 0;
        for (let x = offset; x < size; x += 64) block(x + 2, row * rowHeight + 2, 60, rowHeight - 4, '#8e4a34', 0.3);
      }
      speckle(600, 0.1);
    } else if (style === 'wood') {
      const plank = size / 8;
      for (let i = 0; i < 8; i += 1) {
        ctx.fillStyle = shade('#6e4b2c', (random() - 0.5) * 0.35);
        ctx.fillRect(i * plank, 0, plank, size);
        ctx.strokeStyle = 'rgba(0,0,0,0.22)';
        ctx.lineWidth = 1;
        for (let g = 0; g < 5; g += 1) {
          const gx = i * plank + 4 + random() * (plank - 8);
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.bezierCurveTo(gx + 3, size * 0.3, gx - 3, size * 0.7, gx + 1, size);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(i * plank, 0, 2, size);
      }
      for (const y of [size * 0.18, size * 0.78]) {
        ctx.fillStyle = '#5a3c22';
        ctx.fillRect(0, y, size, 18);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(0, y, size, 3);
        ctx.fillStyle = '#2a2a2a';
        for (let i = 0; i < 8; i += 1) ctx.fillRect(i * plank + plank / 2 - 2, y + 7, 4, 4);
      }
    } else if (style === 'hedge') {
      ctx.fillStyle = '#1f3d1c';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 700; i += 1) {
        ctx.fillStyle = shade('#3f7a34', (random() - 0.5) * 0.7);
        ctx.beginPath();
        ctx.arc(random() * size, random() * size, 3 + random() * 7, 0, Math.PI * 2);
        ctx.fill();
      }
      speckle(300, 0.15);
    } else {
      paintRock(ctx, size, random);
    }

    texture.update();
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 4;
    return texture;
  }

  function wallMaterial(wall: WallSegment) {
    const style: WallStyle = wall.style ?? 'stone';
    const key = style === 'image' && wall.texture_asset_id ? `image:${wall.texture_asset_id}` : style === 'image' ? 'stone' : style;
    const cached = wallMaterials.get(key);
    if (cached) return cached;

    const mat = new StandardMaterial(`wall-${key}`, scene);
    mat.specularColor = new Color3(0.06, 0.06, 0.05);
    if (style === 'plain') {
      mat.diffuseColor = Color3.FromHexString('#4a4a52');
    } else if (key.startsWith('image:')) {
      const placeholder = paintWallTexture('stone');
      mat.diffuseTexture = placeholder;
      void options.loadImageUrl?.(wall.texture_asset_id!).then(url => {
        if (scene.isDisposed) return;
        const picture = new Texture(url, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
        picture.wrapU = Texture.WRAP_ADDRESSMODE;
        picture.wrapV = Texture.WRAP_ADDRESSMODE;
        mat.diffuseTexture = picture;
        placeholder.dispose();
      }).catch(() => undefined);
    } else if (key === 'rock') {
      mat.diffuseTexture = paintWallTexture('rock');
      mat.specularColor = new Color3(0.03, 0.03, 0.03);
    } else {
      mat.diffuseTexture = paintWallTexture(key as Exclude<WallStyle, 'image' | 'plain'>);
    }
    wallMaterials.set(key, mat);
    return mat;
  }

  return { wallMaterial };
}
