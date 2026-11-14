import { Bone, Color3, Material, Mesh, MeshBuilder, StandardMaterial, Texture, TransformNode, Vector3, type Observer, type Scene } from '@babylonjs/core';
import { figureScale } from '../grid';
import { GAME_ICONS, SECONDARY_OPACITY, iconPath, type GameIconName } from '../../ui/gameIcons';
import type { AttackMotion, HeldHand, HeldLook } from '../../../../../packages/domain/character/held';
import type { HeldItemLook, ObjectRecord } from '../sceneTypes';

const LOOK_ICONS: Record<HeldLook, GameIconName> = {
  sword: 'sword', dagger: 'dagger', axe: 'axe', hammer: 'hammer', spear: 'swords', bow: 'bow', crossbow: 'bow', staff: 'wand', wand: 'wand',
  shield: 'shield', torch: 'flame', lantern: 'candle', thing: 'hand',
};
const HAND_BONE: Record<HeldHand, RegExp> = {
  main: /(right|^r)[\s._:-]*hand|hand[\s._:-]*(r|right)$|righthand/i,
  off: /(left|^l)[\s._:-]*hand|hand[\s._:-]*(l|left)$|lefthand/i,
};
const DURATION: Record<AttackMotion, number> = { swing: 280, thrust: 230, shot: 320, throw: 320 };

// A round token with the line icon, for items without a picture of their own.
function iconToken(look: HeldLook): string {
  const paths = GAME_ICONS[LOOK_ICONS[look]].map(raw => {
    const { d, filled, secondary } = iconPath(raw);
    return `<path d="${d}"${filled ? ' fill="#f3e6c8"' : ''}${secondary ? ` opacity="${SECONDARY_OPACITY}"` : ''}/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="-4 -4 32 32">`
    + `<circle cx="12" cy="12" r="14.6" fill="#1d150c" fill-opacity="0.82" stroke="#c9a66b" stroke-width="1.3"/>`
    + `<g fill="none" stroke="#f3e6c8" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

type Sprite = { mesh: Mesh; material: StandardMaterial; texture: Texture | null; x: number; y: number; bone: TransformNode | null };
type Hands = { key: string; node: TransformNode; sprites: Map<HeldHand, Sprite>; follow: Observer<Scene> | null; motion: Observer<Scene> | null; disposed: boolean };

export type HeldItemsDeps = {
  scene: Scene;
  reducedMotion: boolean;
  loadImageUrl?: (assetId: string) => Promise<string>;
};

// Small pictures of what a creature holds, at its hands: beside a standee or a pawn, on the hand bones of a model when it has them.
export function createHeldItems({ scene, reducedMotion, loadImageUrl }: HeldItemsDeps) {
  const hands = new Map<string, Hands>();

  function keyOf(record: ObjectRecord) {
    const items = record.data.held ?? [];
    return `${record.appearanceKey}#${items.map(item => `${item.hand}:${item.look}:${item.twoHanded}:${item.art ?? ''}:${item.imageAssetId ?? ''}`).join('|')}`;
  }

  function handBones(record: ObjectRecord): Partial<Record<HeldHand, TransformNode>> {
    const bones: Bone[] = (record.content.entries?.skeletons ?? []).flatMap(skeleton => skeleton.bones);
    const found: Partial<Record<HeldHand, TransformNode>> = {};
    for (const hand of ['main', 'off'] as const) {
      const node = bones.find(bone => HAND_BONE[hand].test(bone.name))?.getTransformNode();
      if (node) found[hand] = node;
    }
    return found;
  }

  function makeSprite(entry: Hands, item: HeldItemLook, size: number): Sprite {
    const mesh = MeshBuilder.CreatePlane(`held-${item.hand}`, { size, sideOrientation: Mesh.DOUBLESIDE }, scene);
    mesh.parent = entry.node;
    const material = new StandardMaterial(`held-${item.hand}`, scene);
    material.specularColor = Color3.Black();
    material.emissiveColor = new Color3(0.55, 0.55, 0.55);
    material.backFaceCulling = false;
    material.transparencyMode = Material.MATERIAL_ALPHATEST;
    material.alphaCutOff = 0.35;
    mesh.material = material;
    const sprite: Sprite = { mesh, material, texture: null, x: 0, y: 0, bone: null };
    const show = (url: string) => {
      if (entry.disposed) return;
      const texture = new Texture(url, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE, null, () => {
        if (!entry.disposed && url !== iconToken(item.look)) show(iconToken(item.look));
      });
      texture.hasAlpha = true;
      sprite.texture?.dispose();
      sprite.texture = texture;
      material.diffuseTexture = texture;
      material.useAlphaFromDiffuseTexture = true;
    };
    if (item.imageAssetId && loadImageUrl) void loadImageUrl(item.imageAssetId).then(show).catch(() => show(iconToken(item.look)));
    else show(item.art ?? iconToken(item.look));
    return sprite;
  }

  function dispose(objectId: string) {
    const entry = hands.get(objectId);
    if (!entry) return;
    entry.disposed = true;
    if (entry.follow) scene.onBeforeRenderObservable.remove(entry.follow);
    if (entry.motion) scene.onBeforeRenderObservable.remove(entry.motion);
    for (const sprite of entry.sprites.values()) {
      sprite.texture?.dispose();
      sprite.material.dispose();
      sprite.mesh.dispose();
    }
    entry.node.dispose();
    hands.delete(objectId);
  }

  function build(record: ObjectRecord, key: string): Hands {
    const node = new TransformNode(`held-${record.data.id}`, scene);
    node.parent = record.holder;
    node.billboardMode = TransformNode.BILLBOARDMODE_Y;
    const entry: Hands = { key, node, sprites: new Map(), follow: null, motion: null, disposed: false };
    const factor = figureScale(record.data.size);
    const bones = record.data.appearance.kind === 'model' ? handBones(record) : {};
    for (const item of record.data.held ?? []) {
      const size = (item.look === 'shield' ? 0.54 : item.twoHanded ? 0.66 : 0.5) * factor;
      const sprite = makeSprite(entry, item, size);
      sprite.bone = bones[item.hand] ?? null;
      entry.sprites.set(item.hand, sprite);
    }
    if ([...entry.sprites.values()].some(sprite => sprite.bone)) {
      entry.follow = scene.onBeforeRenderObservable.add(() => {
        for (const sprite of entry.sprites.values()) if (sprite.bone && !entry.motion) sprite.mesh.setAbsolutePosition(sprite.bone.getAbsolutePosition());
      });
    }
    return entry;
  }

  // Beside the figure at hand height: the main hand on the viewer's left (the figure faces the viewer), the other on the right.
  function place(entry: Hands, record: ObjectRecord) {
    const factor = figureScale(record.data.size);
    const height = Math.max(0.3 * factor, record.content.labelHeight * 0.42);
    const side = 0.5 * factor;
    for (const [hand, sprite] of entry.sprites) {
      if (sprite.bone) continue;
      const item = record.data.held?.find(entry => entry.hand === hand);
      sprite.x = (hand === 'main' ? -1 : 1) * (side + (item?.twoHanded ? 0.06 : 0));
      sprite.y = height;
      sprite.mesh.position.set(sprite.x, sprite.y, -0.02);
      sprite.mesh.rotation.z = 0;
    }
  }

  function refreshHeld(record: ObjectRecord) {
    const id = record.data.id;
    const key = keyOf(record);
    let entry = hands.get(id);
    if (entry && entry.key !== key) {
      dispose(id);
      entry = undefined;
    }
    if (!record.data.held?.length) return;
    if (!entry) {
      entry = build(record, key);
      hands.set(id, entry);
    }
    if (!entry.motion) place(entry, record);
    const visibility = record.data.hidden ? 0.45 : 1;
    for (const sprite of entry.sprites.values()) {
      sprite.mesh.visibility = visibility;
      sprite.mesh.metadata = { objectId: id };
      sprite.mesh.isPickable = true;
    }
  }

  // The weapon moves the way it is used: a swing arcs across, a thrust jabs toward the target, a shot recoils, a throw flies out and back.
  function playMotion(objectId: string, motion: AttackMotion, target: Vector3) {
    const entry = hands.get(objectId);
    const sprite = entry?.sprites.get('main') ?? entry?.sprites.get('off');
    if (!entry || !sprite || reducedMotion || sprite.bone) return;
    if (entry.motion) scene.onBeforeRenderObservable.remove(entry.motion);
    const camera = scene.activeCamera;
    const right = camera ? camera.getDirection(Vector3.Right()) : Vector3.Right();
    const toward = Math.sign(Vector3.Dot(target.subtract(entry.node.getAbsolutePosition()), right)) || 1;
    const born = performance.now();
    const duration = DURATION[motion];
    const { x, y } = sprite;
    entry.motion = scene.onBeforeRenderObservable.add(() => {
      const t = Math.min(1, (performance.now() - born) / duration);
      const out = Math.sin(Math.PI * t);
      if (motion === 'swing') {
        sprite.mesh.rotation.z = toward * (1.1 - 2.2 * t);
        sprite.mesh.position.set(x + toward * 0.18 * out, y + 0.08 * out, -0.02);
      } else if (motion === 'thrust') {
        sprite.mesh.rotation.z = -toward * 0.9;
        sprite.mesh.position.set(x + toward * 0.38 * out, y, -0.02);
      } else if (motion === 'shot') {
        sprite.mesh.position.set(x - toward * 0.1 * out, y, -0.02);
        sprite.mesh.scaling.setAll(1 + 0.12 * out);
      } else {
        sprite.mesh.rotation.z = -toward * Math.PI * 2 * t;
        sprite.mesh.position.set(x + toward * 0.45 * out, y + 0.22 * out, -0.02);
      }
      if (t >= 1) {
        scene.onBeforeRenderObservable.remove(entry.motion);
        entry.motion = null;
        sprite.mesh.position.set(x, y, -0.02);
        sprite.mesh.rotation.z = 0;
        sprite.mesh.scaling.setAll(1);
      }
    });
  }

  function disposeAll() {
    for (const id of [...hands.keys()]) dispose(id);
  }

  return { refreshHeld, dropHeld: dispose, playMotion, disposeAll };
}
