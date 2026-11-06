import { Vector3, StandardMaterial, Color3, MeshBuilder, Scene, TransformNode } from '@babylonjs/core';

export type AttackFxDeps = {
  reducedMotion: boolean;
  scene: Scene;
  rootOf: (objectId: string) => TransformNode | null;
};

export function createAttackFx({ reducedMotion, scene, rootOf }: AttackFxDeps) {
  function showAttack(fromId: string, toId: string, style: 'arrow' | 'spell' | 'melee', effect: 'hit' | 'miss' | 'crit' | 'heal') {
    const from = rootOf(fromId);
    const to = rootOf(toId);
    if (!from || !to) return;
    const start = new Vector3(from.position.x, from.position.y + 0.6, from.position.z);
    const end = new Vector3(to.position.x, to.position.y + 0.6, to.position.z);
    if (effect === 'miss') {
      const side = new Vector3(-(end.z - start.z), 0, end.x - start.x).normalize().scale(0.45);
      end.addInPlace(side).addInPlace(end.subtract(start).normalize().scale(0.6));
    }

    const material = new StandardMaterial('attack-fx', scene);
    material.disableLighting = true;
    material.emissiveColor = Color3.FromHexString(effect === 'heal' ? '#7ee08a' : effect === 'crit' ? '#ffe27a' : style === 'spell' ? '#ff9a4a' : '#f1d9a6');
    material.alpha = 0.95;

    if (style === 'melee' || reducedMotion) {
      const flash = MeshBuilder.CreateTorus('attack-flash', { diameter: 0.9, thickness: 0.07, tessellation: 32 }, scene);
      flash.material = material;
      flash.isPickable = false;
      flash.position.set(to.position.x, to.position.y + 0.4, to.position.z);
      flash.rotation.x = Math.PI / 2;
      const born = performance.now();
      const observer = scene.onBeforeRenderObservable.add(() => {
        const t = Math.min(1, (performance.now() - born) / 260);
        const size = 0.6 + t * (effect === 'crit' ? 1.4 : 0.9);
        flash.scaling.set(size, size, size);
        material.alpha = 0.95 * (1 - t);
        if (t >= 1) {
          scene.onBeforeRenderObservable.remove(observer);
          flash.dispose();
          material.dispose();
        }
      });
      return;
    }

    const projectile = style === 'arrow'
      ? MeshBuilder.CreateBox('attack-arrow', { width: 0.09, height: 0.09, depth: 0.7 }, scene)
      : MeshBuilder.CreateSphere('attack-spell', { diameter: 0.36, segments: 12 }, scene);
    projectile.material = material;
    projectile.isPickable = false;
    const distance = Vector3.Distance(start, end);
    const duration = 280 + distance * 45;
    const arc = style === 'arrow' ? Math.min(1.2, distance * 0.12) : 0.15;
    const born = performance.now();
    const previous = start.clone();
    const observer = scene.onBeforeRenderObservable.add(() => {
      const t = Math.min(1, (performance.now() - born) / duration);
      const point = Vector3.Lerp(start, end, t);
      point.y += Math.sin(Math.PI * t) * arc;
      projectile.position.copyFrom(point);
      if (style === 'arrow' && !point.equals(previous)) projectile.lookAt(point.add(point.subtract(previous)));
      previous.copyFrom(point);
      if (t >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
        projectile.dispose();
        material.dispose();
      }
    });
  }

  return { showAttack };
}
