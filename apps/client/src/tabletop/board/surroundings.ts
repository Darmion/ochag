import { MeshBuilder, StandardMaterial, Color3, DynamicTexture, Texture, Color4, Scene } from '@babylonjs/core';

export type SurroundingsDeps = {
  widthCells: number;
  heightCells: number;
  scene: Scene;
};

export function createSurroundings({ widthCells, heightCells, scene }: SurroundingsDeps) {
  const surroundSize = Math.max(widthCells, heightCells) * 6 + 80;
  const surround = MeshBuilder.CreateGround('table-surround', { width: surroundSize, height: surroundSize }, scene);
  surround.position.y = -0.21;
  surround.isPickable = false;
  surround.alphaIndex = -10;
  const surroundMaterial = new StandardMaterial('table-surround', scene);
  surroundMaterial.specularColor = new Color3(0.04, 0.035, 0.03);
  const planks = new DynamicTexture('table-planks', { width: 512, height: 512 }, scene, true);
  {
    const ctx = planks.getContext() as CanvasRenderingContext2D;
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    ctx.fillStyle = '#c9c9c9';
    ctx.fillRect(0, 0, 512, 512);
    const plank = 512 / 3;
    for (let row = 0; row < 3; row++) {
      const y0 = Math.round(row * plank);
      const y1 = Math.round((row + 1) * plank);
      const tone = Math.round(180 + random() * 55);
      ctx.fillStyle = `rgb(${tone},${tone},${tone})`;
      ctx.fillRect(0, y0, 512, y1 - y0);
      for (let line = 0; line < 34; line++) {
        const y = y0 + random() * (y1 - y0);
        const shade = random() < 0.55 ? 0 : 255;
        const wide = random() < 0.35;
        ctx.strokeStyle = `rgba(${shade},${shade},${shade},${wide ? 0.02 + random() * 0.04 : 0.05 + random() * 0.08})`;
        ctx.lineWidth = wide ? 5 + random() * 9 : 0.8 + random() * 1.8;
        ctx.beginPath();
        ctx.moveTo(0, y);
        const wave = 40 + random() * 50;
        for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, y + Math.sin((x + row * 97) / wave) * 3);
        ctx.stroke();
      }
      if (random() < 0.7) {
        const kx = random() * 512, ky = y0 + (y1 - y0) * (0.3 + random() * 0.4);
        const knot = ctx.createRadialGradient(kx, ky, 1, kx, ky, 12 + random() * 10);
        knot.addColorStop(0, 'rgba(0,0,0,0.25)');
        knot.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = knot;
        ctx.fillRect(kx - 24, ky - 24, 48, 48);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, y0, 512, 4);
      ctx.fillRect(Math.round(random() * 400) + 56, y0, 4, y1 - y0);
    }
    planks.update();
  }
  planks.wrapU = Texture.WRAP_ADDRESSMODE;
  planks.wrapV = Texture.WRAP_ADDRESSMODE;
  planks.uScale = surroundSize / 6;
  planks.vScale = surroundSize / 6;
  surroundMaterial.diffuseTexture = planks;
  const surroundFade = new DynamicTexture('table-surround-fade', { width: 256, height: 256 }, scene, false);
  {
    const ctx = surroundFade.getContext() as CanvasRenderingContext2D;
    const inner = Math.min(0.42, (Math.max(widthCells, heightCells) + 30) / surroundSize) * 256;
    const fade = ctx.createRadialGradient(128, 128, inner, 128, 128, 128);
    fade.addColorStop(0, 'rgba(255,255,255,1)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 256, 256);
    surroundFade.hasAlpha = true;
    surroundFade.update();
  }
  surroundFade.wrapU = Texture.CLAMP_ADDRESSMODE;
  surroundFade.wrapV = Texture.CLAMP_ADDRESSMODE;
  surroundMaterial.opacityTexture = surroundFade;
  surround.material = surroundMaterial;
  const shadowMargin = 1.3;
  const boardShadow = MeshBuilder.CreateGround('board-shadow', { width: widthCells + 2 * shadowMargin, height: heightCells + 2 * shadowMargin }, scene);
  boardShadow.position.y = -0.205;
  boardShadow.isPickable = false;
  boardShadow.alphaIndex = -9;
  const shadowMaterial = new StandardMaterial('board-shadow', scene);
  shadowMaterial.disableLighting = true;
  shadowMaterial.diffuseColor = Color3.Black();
  shadowMaterial.emissiveColor = Color3.Black();
  shadowMaterial.specularColor = Color3.Black();
  const shadowTexture = new DynamicTexture('board-shadow-texture', { width: 256, height: 256 }, scene, false);
  {
    const ctx = shadowTexture.getContext() as CanvasRenderingContext2D;
    const w = widthCells + 2 * shadowMargin, h = heightCells + 2 * shadowMargin;
    const padX = (shadowMargin * 0.55 / w) * 256, padY = (shadowMargin * 0.55 / h) * 256;
    ctx.clearRect(0, 0, 256, 256);
    ctx.filter = `blur(${Math.max(4, Math.min(padX, padY) * 0.8)}px)`;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(padX, padY, 256 - 2 * padX, 256 - 2 * padY);
    ctx.filter = 'none';
    shadowTexture.hasAlpha = true;
    shadowTexture.update();
  }
  shadowMaterial.opacityTexture = shadowTexture;
  boardShadow.material = shadowMaterial;

  let surroundBase = Color3.FromHexString('#45301f');
  let surroundLight = 1;
  let voidColor = new Color3(0.075, 0.048, 0.032);
  let fogBackground: Color3 | null = null;
  function setFogBackground(color: Color3 | null) {
    fogBackground = color;
    applySurroundings();
  }
  function applySurroundings() {
    surroundMaterial.diffuseColor = surroundBase.scale(surroundLight);
    const background = fogBackground ?? voidColor;
    scene.clearColor = new Color4(background.r, background.g, background.b, 1);
  }
  function setSurroundLight(light: number) {
    surroundLight = light;
    applySurroundings();
  }
  function setSurroundings(colors: { table: string; void: string }) {
    surroundBase = Color3.FromHexString(colors.table);
    voidColor = Color3.FromHexString(colors.void);
    applySurroundings();
  }

  return { setFogBackground, setSurroundLight, setSurroundings };
}
