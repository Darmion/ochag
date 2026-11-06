import { Color3, Texture, MeshBuilder, ShaderMaterial, Vector2, Scene, StandardMaterial, Effect } from '@babylonjs/core';
import { type GridLook, DEFAULT_GRID } from '../../settings/gridSettings';
import type { TabletopOptions } from '../sceneTypes';

Effect.ShadersStore['tableGridVertexShader'] = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform vec2 halfSize;
varying vec2 vCell;
void main(void) {
  vCell = (world * vec4(position, 1.0)).xz + halfSize;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;
Effect.ShadersStore['tableGridFragmentShader'] = `
#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec2 vCell;
uniform vec3 gridColor;
uniform float gridAlpha;
uniform float lineWidth;
uniform float gridStyle;
float band(float distancePx, float halfPx) {
  return 1.0 - smoothstep(halfPx - 0.5, halfPx + 0.5, distancePx);
}
void main(void) {
  vec2 perPixel = max(fwidth(vCell), vec2(0.00001));
  vec2 d = abs(fract(vCell + 0.5) - 0.5) / perPixel;
  float halfPx = lineWidth * 0.5;
  float a = 0.0;
  if (gridStyle < 0.5) {
    a = band(min(d.x, d.y), halfPx);
  } else if (gridStyle < 1.5) {
    float alongY = step(fract(vCell.y * 4.0 + 0.2), 0.6);
    float alongX = step(fract(vCell.x * 4.0 + 0.2), 0.6);
    a = max(band(d.x, halfPx) * alongY, band(d.y, halfPx) * alongX);
  } else if (gridStyle < 2.5) {
    a = band(length(d), halfPx + 1.0);
  } else {
    vec2 arm = 0.18 / perPixel;
    a = max(band(d.x, halfPx) * band(d.y, arm.y), band(d.y, halfPx) * band(d.x, arm.x));
  }
  a *= gridAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(gridColor, a);
}`;
const GRID_STYLE_CODE: Record<GridLook['style'], number> = { lines: 0, dashed: 1, dots: 2, crosses: 3 };

export type SurfaceDeps = {
  options: Pick<TabletopOptions, 'backgroundImageUrl'>;
  widthCells: number;
  heightCells: number;
  halfWidth: number;
  halfHeight: number;
  scene: Scene;
  material: (name: string, color: string) => StandardMaterial;
  wood: StandardMaterial;
  brass: StandardMaterial;
};

export function createSurface({
  options, widthCells, heightCells, halfWidth, halfHeight, scene, material, wood, brass,
}: SurfaceDeps) {
  const parchment = material('parchment', '#b99b69');
  const parchmentSpecularBare = new Color3(0.12, 0.1, 0.07);
  const parchmentSpecularWithImage = new Color3(0.05, 0.05, 0.05);
  let groundColor = '#b99b69';

  let backgroundTexture: Texture | undefined;
  let backgroundRotation = 0;

  function setBackground(url: string | undefined) {
    if (backgroundTexture) {
      backgroundTexture.dispose();
      backgroundTexture = undefined;
    }

    if (url) {
      const texture = new Texture(url, scene);
      texture.wAng = -backgroundRotation * Math.PI / 180;
      parchment.diffuseTexture = null;
      parchment.emissiveTexture = texture;
      parchment.diffuseColor = Color3.Black();
      parchment.disableLighting = true;
      parchment.specularColor = parchmentSpecularWithImage;
      backgroundTexture = texture;
    } else {
      parchment.emissiveTexture = null;
      parchment.diffuseTexture = null;
      parchment.diffuseColor = Color3.FromHexString(groundColor);
      parchment.disableLighting = false;
      parchment.specularColor = parchmentSpecularBare;
    }
  }

  function setBackgroundRotation(degrees: number) {
    backgroundRotation = ((degrees % 360) + 360) % 360;
    if (backgroundTexture) backgroundTexture.wAng = -backgroundRotation * Math.PI / 180;
  }

  setBackground(options.backgroundImageUrl);

  const ground = MeshBuilder.CreateGround('board', { width: widthCells, height: heightCells }, scene);
  ground.material = parchment;

  const grid = MeshBuilder.CreateGround('grid', { width: widthCells, height: heightCells }, scene);
  grid.position.y = 0.012;
  grid.isPickable = false;
  const gridMaterial = new ShaderMaterial('grid-material', scene, { vertex: 'tableGrid', fragment: 'tableGrid' }, {
    attributes: ['position'],
    uniforms: ['world', 'worldViewProjection', 'halfSize', 'gridColor', 'gridAlpha', 'lineWidth', 'gridStyle'],
    needAlphaBlending: true,
  });
  gridMaterial.backFaceCulling = false;
  gridMaterial.forceDepthWrite = true;
  gridMaterial.setVector2('halfSize', new Vector2(halfWidth, halfHeight));
  grid.material = gridMaterial;
  grid.alphaIndex = 0;
  let gridThemeColor = '#62472d';
  let gridLook: GridLook = { ...DEFAULT_GRID };

  function applyGrid() {
    gridMaterial.setColor3('gridColor', Color3.FromHexString(gridLook.color ?? gridThemeColor));
    gridMaterial.setFloat('gridAlpha', Math.min(1, Math.max(0.05, gridLook.opacity)));
    gridMaterial.setFloat('lineWidth', Math.min(4, Math.max(1, gridLook.width)));
    gridMaterial.setFloat('gridStyle', GRID_STYLE_CODE[gridLook.style] ?? 0);
    grid.setEnabled(gridLook.visible);
  }
  applyGrid();

  function setGrid(look: GridLook) {
    gridLook = { ...look };
    applyGrid();
  }

  function setTheme(colors: { ground: string; wood: string; grid: string }) {
    groundColor = colors.ground;
    if (!backgroundTexture) parchment.diffuseColor = Color3.FromHexString(groundColor);
    wood.diffuseColor = Color3.FromHexString(colors.wood);
    gridThemeColor = colors.grid;
    applyGrid();
  }

  const margin = 0.35;
  const cornerOverlap = 0.65;
  for (const side of [-1, 1]) {
    const horizontal = MeshBuilder.CreateBox(
      'frame', { width: widthCells + 2 * cornerOverlap, height: 0.4, depth: 0.6 }, scene,
    );
    horizontal.position.set(0, 0, side * (halfHeight + margin));
    horizontal.material = wood;
    horizontal.isPickable = false;
    const vertical = MeshBuilder.CreateBox(
      'frame', { width: 0.6, height: 0.4, depth: heightCells + 0.1 }, scene,
    );
    vertical.position.set(side * (halfWidth + margin), 0, 0);
    vertical.material = wood;
    vertical.isPickable = false;
    for (const z of [-(halfHeight + margin), halfHeight + margin]) {
      const stud = MeshBuilder.CreateSphere('stud', { diameter: 0.2, segments: 8 }, scene);
      stud.position.set(side * (halfWidth + margin), 0.2, z);
      stud.material = brass;
      stud.isPickable = false;
    }
  }

  return { setBackground, setBackgroundRotation, ground, setGrid, setTheme };
}
