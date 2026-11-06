import { Color3, DynamicTexture, Texture, StandardMaterial, Scene } from '@babylonjs/core';
import type { WallStyle, WallSegment, TabletopOptions } from '../sceneTypes';

export type WallTexturesDeps = {
  options: TabletopOptions;
  scene: Scene;
};

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
    const size = 256;
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
      ctx.fillStyle = '#4c443d';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 40; i += 1) {
        ctx.fillStyle = shade('#5d544b', (random() - 0.5) * 0.6);
        ctx.beginPath();
        const cx = random() * size, cy = random() * size, r = 18 + random() * 34;
        for (let k = 0; k < 7; k += 1) {
          const angle = (k / 7) * Math.PI * 2;
          const rr = r * (0.6 + random() * 0.5);
          ctx[k ? 'lineTo' : 'moveTo'](cx + Math.cos(angle) * rr, cy + Math.sin(angle) * rr);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      for (let i = 0; i < 10; i += 1) {
        ctx.beginPath();
        let x = random() * size, y = random() * size;
        ctx.moveTo(x, y);
        for (let k = 0; k < 4; k += 1) {
          x += (random() - 0.5) * 40;
          y += random() * 30;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      speckle(800, 0.14);
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
    } else {
      mat.diffuseTexture = paintWallTexture(key as Exclude<WallStyle, 'image' | 'plain'>);
    }
    wallMaterials.set(key, mat);
    return mat;
  }

  return { wallMaterial };
}
