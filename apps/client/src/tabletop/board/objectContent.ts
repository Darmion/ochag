import { type AssetContainer, LoadAssetContainerAsync, TransformNode, MeshBuilder, Mesh, StandardMaterial, Color3, Texture, Material, Vector3, Scene } from '@babylonjs/core';
import { figureScale } from '../grid';
import type { ObjectSide, ObjectContent, PlacedObject, TabletopOptions } from '../sceneTypes';

export type ObjectContentDeps = {
  options: Pick<TabletopOptions, 'loadImageUrl' | 'loadModelFile'>;
  scene: Scene;
  brass: StandardMaterial;
  crateWood: StandardMaterial;
  sideMaterials: Record<ObjectSide, StandardMaterial>;
};

export function createObjectContent({ options, scene, brass, crateWood, sideMaterials }: ObjectContentDeps) {
  // One detached AssetContainer per model, instantiated per object: each instance gets its own retargeted AnimationGroups, which TransformNode.clone() cannot do.
  const modelContainers = new Map<string, AssetContainer | null>();
  const modelLoads = new Map<string, Promise<AssetContainer | null>>();

  async function ensureContainer(assetId: string): Promise<AssetContainer | null> {
    if (modelContainers.has(assetId)) return modelContainers.get(assetId) ?? null;

    let pending = modelLoads.get(assetId);

    if (!pending) {
      pending = (async () => {
        if (!options.loadModelFile) return null;

        try {
          const file = await options.loadModelFile(assetId);
          return await LoadAssetContainerAsync(file, scene);
        } catch {
          return null;
        }
      })();

      modelLoads.set(assetId, pending);
    }

    const container = await pending;
    modelContainers.set(assetId, container);
    return container;
  }

  function getAnimationNames(assetId: string): string[] {
    return modelContainers.get(assetId)?.animationGroups.map(g => g.name) ?? [];
  }

  function animationIndex(assetId: string, name: string): number {
    return modelContainers.get(assetId)?.animationGroups.findIndex(g => g.name === name) ?? -1;
  }

  function childMeshes(holder: TransformNode) {
    return holder.getChildMeshes(false);
  }

  function buildPawn(holder: TransformNode, side: ObjectSide): ObjectContent {
    const base = MeshBuilder.CreateCylinder('pawn-base', { diameter: 0.82, height: 0.13, tessellation: 32 }, scene);
    base.material = brass;
    base.parent = holder;
    base.position.y = 0.09;
    const cloak = MeshBuilder.CreateCylinder('pawn-cloak', { diameterTop: 0.24, diameterBottom: 0.55, height: 0.72, tessellation: 16 }, scene);
    cloak.parent = base;
    cloak.position.y = 0.39;
    cloak.material = sideMaterials[side];
    const head = MeshBuilder.CreateSphere('pawn-head', { diameter: 0.27, segments: 12 }, scene);
    head.parent = base;
    head.position.y = 0.88;
    head.material = brass;
    const parts = [base, cloak, head];

    return {
      meshes: () => parts,
      labelHeight: 1.12,
      dispose: () => parts.forEach(part => part.dispose()),
    };
  }

  function buildCrate(holder: TransformNode): ObjectContent {
    const box = MeshBuilder.CreateBox('crate', { size: 0.74 }, scene);
    box.material = crateWood;
    box.parent = holder;
    box.position.y = 0.37;
    const band = MeshBuilder.CreateBox('crate-band', { width: 0.78, height: 0.08, depth: 0.78 }, scene);
    band.material = brass;
    band.parent = holder;
    band.position.y = 0.55;
    const parts = [box, band];

    return {
      meshes: () => parts,
      labelHeight: 0.8,
      dispose: () => parts.forEach(part => part.dispose()),
    };
  }

  function buildStandee(holder: TransformNode, side: ObjectSide, assetId: string): ObjectContent {
    const base = MeshBuilder.CreateCylinder('standee-base', { diameter: 0.8, height: 0.06, tessellation: 32 }, scene);
    base.material = sideMaterials[side];
    base.parent = holder;
    base.position.y = 0.03;

    const card = MeshBuilder.CreatePlane('standee-card', { width: 1, height: 1, sideOrientation: Mesh.DOUBLESIDE }, scene);
    card.parent = holder;
    card.billboardMode = TransformNode.BILLBOARDMODE_Y;

    const cardMaterial = new StandardMaterial('standee-card', scene);
    cardMaterial.specularColor = Color3.Black();
    cardMaterial.diffuseColor = new Color3(0.85, 0.78, 0.62);
    cardMaterial.emissiveColor = new Color3(0.5, 0.5, 0.5);
    cardMaterial.backFaceCulling = false;
    card.material = cardMaterial;

    let disposed = false;
    let texture: Texture | undefined;

    const content: ObjectContent = {
      meshes: () => [base, card],
      labelHeight: 1.3,
      dispose: () => {
        disposed = true;
        base.dispose();
        card.dispose();
        texture?.dispose();
        cardMaterial.dispose();
      },
    };

    function setCardSize(aspect: number) {
      let height = 0.9 * aspect;
      let width = 0.9;

      if (height > 2.4) {
        height = 2.4;
        width = height / aspect;
      } else if (height < 0.5) {
        height = 0.5;
        width = Math.min(1.6, height / aspect);
      }

      card.scaling.set(width, height, 1);
      card.position.y = 0.06 + height / 2;
      content.labelHeight = 0.06 + height + 0.04;
    }

    setCardSize(1.3);

    void options.loadImageUrl?.(assetId).then(url => {
      if (disposed) return;

      texture = new Texture(url, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE, () => {
        if (disposed || !texture) return;
        const size = texture.getBaseSize();
        if (size.width > 0) setCardSize(size.height / size.width);
      });
      texture.hasAlpha = true;
      cardMaterial.diffuseColor = Color3.White();
      cardMaterial.diffuseTexture = texture;
      cardMaterial.useAlphaFromDiffuseTexture = true;
      cardMaterial.transparencyMode = Material.MATERIAL_ALPHATEST;
      cardMaterial.alphaCutOff = 0.4;
    }).catch(() => {
    });

    return content;
  }

  function centerModel(holder: TransformNode, root: unknown) {
    if (!(root instanceof TransformNode)) return;
    const modelRoot = root;
    holder.computeWorldMatrix(true);
    for (const node of [modelRoot, ...modelRoot.getChildMeshes(false)]) node.computeWorldMatrix(true);
    const { min, max } = modelRoot.getHierarchyBoundingVectors(true);
    if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) return;
    const toLocal = holder.getWorldMatrix().clone().invert();
    const low = Vector3.TransformCoordinates(min, toLocal);
    const high = Vector3.TransformCoordinates(max, toLocal);
    const shift = new Vector3(
      -(Math.min(low.x, high.x) + Math.max(low.x, high.x)) / 2,
      Math.max(0, -Math.min(low.y, high.y)),
      -(Math.min(low.z, high.z) + Math.max(low.z, high.z)) / 2,
    );
    if (shift.lengthSquared() > 1e-8) modelRoot.position.addInPlace(shift);
  }

  async function buildModel(holder: TransformNode, id: string, assetId: string): Promise<ObjectContent | null> {
    const container = await ensureContainer(assetId);
    if (!container) return null;

    const entries = container.instantiateModelsToScene(() => `object-${id}`, false);
    const modelRoot = entries.rootNodes[0];

    if (!modelRoot) {
      entries.dispose();
      return null;
    }

    modelRoot.parent = holder;
    centerModel(holder, modelRoot);

    const { max } = holder.getHierarchyBoundingVectors(true);
    const scale = holder.scaling.y || 1;
    const labelHeight = Math.max(0.3, (max.y - holder.position.y) / scale);

    return {
      meshes: () => childMeshes(holder),
      labelHeight,
      entries,
      dispose: () => entries.dispose(),
    };
  }

  function appearanceKey(object: PlacedObject) {
    const look = object.appearance;
    return look.kind === 'default'
      ? `default:${object.creature ? 'pawn' : 'crate'}:${object.side}:${object.size}`
      : `${look.kind}:${look.assetId}:${object.side}${look.kind === 'image' ? `:${object.size}` : ''}`;
  }

  async function buildContent(holder: TransformNode, object: PlacedObject): Promise<ObjectContent> {
    const look = object.appearance;

    if (look.kind === 'model') {
      const model = await buildModel(holder, object.id, look.assetId);
      if (model) return model;
    }

    const factor = figureScale(object.size);
    const sizeNode = new TransformNode(`object-size-${object.id}`, scene);
    sizeNode.parent = holder;
    sizeNode.scaling.setAll(factor);

    const inner = look.kind === 'image'
      ? buildStandee(sizeNode, object.side, look.assetId)
      : object.creature ? buildPawn(sizeNode, object.side) : buildCrate(sizeNode);

    return {
      meshes: inner.meshes,
      get labelHeight() { return inner.labelHeight * factor; },
      set labelHeight(value: number) { inner.labelHeight = value / factor; },
      dispose: () => {
        inner.dispose();
        sizeNode.dispose();
      },
    };
  }

  return { getAnimationNames, animationIndex, appearanceKey, buildContent };
}
