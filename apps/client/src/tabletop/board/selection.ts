import { GizmoManager, HighlightLayer, TransformNode, Quaternion, Mesh, Color3, Scene } from '@babylonjs/core';
import { PULL_INTERVAL_MS } from '../signals';
import type { ObjectTransform, GizmoMode, TabletopOptions, LiveHooks, ObjectRecord } from '../sceneTypes';

export type SelectionDeps = {
  options: Pick<TabletopOptions, 'onObjectTransform'>;
  live: Pick<LiveHooks, 'onObjectGrab' | 'onObjectPull' | 'onObjectRelease'>;
  scene: Scene;
  objectEntries: Map<string, ObjectRecord>;
  contestedObject: () => string | null;
  refreshLabel: (objectId: string) => void;
};

export function createSelection({ options, live, scene, objectEntries, contestedObject, refreshLabel }: SelectionDeps) {
  // GizmoManager's click-to-attach refuses TransformNode roots, so selection uses our own click handler and attachToNode().
  const gizmoManager = new GizmoManager(scene);
  gizmoManager.usePointerToAttachGizmos = false;
  const selectionHighlight = new HighlightLayer('selection-highlight', scene);
  let selectedObjectId: string | null = null;
  let selectedCanMove = false;
  let draggingObjectId: string | null = null;
  let selectionEnabled = true;

  // Create all three gizmos once so axis limits and drag-end listeners are wired a single time.
  gizmoManager.positionGizmoEnabled = true;
  gizmoManager.rotationGizmoEnabled = true;
  gizmoManager.scaleGizmoEnabled = true;

  const {positionGizmo, rotationGizmo, scaleGizmo} = gizmoManager.gizmos;

  // Only rotation_y and a uniform scale are saved: hide the other axes.
  if (rotationGizmo) {
    rotationGizmo.xGizmo.isEnabled = false;
    rotationGizmo.zGizmo.isEnabled = false;
  }
  if (scaleGizmo) {
    scaleGizmo.xGizmo.isEnabled = false;
    scaleGizmo.yGizmo.isEnabled = false;
    scaleGizmo.zGizmo.isEnabled = false;
  }

  const gizmoHandle = new TransformNode('gizmo-handle', scene);
  gizmoHandle.rotationQuaternion = Quaternion.Identity();
  let lastObjectPullAt = 0;

  function rootOf(objectId: string): TransformNode | null {
    return objectEntries.get(objectId)?.holder ?? null;
  }

  function syncHandleFromRoot(root: TransformNode) {
    gizmoHandle.position.copyFrom(root.position);
    gizmoHandle.rotationQuaternion = root.rotationQuaternion
      ? root.rotationQuaternion.clone()
      : Quaternion.FromEulerAngles(root.rotation.x, root.rotation.y, root.rotation.z);
    gizmoHandle.scaling.copyFrom(root.scaling);
  }

  function copyHandleToRoot(root: TransformNode) {
    root.position.copyFrom(gizmoHandle.position);
    root.rotationQuaternion = gizmoHandle.rotationQuaternion!.clone();
    root.scaling.copyFrom(gizmoHandle.scaling);
  }

  // Read rotationQuaternion: once the gizmo or a glTF import sets it, Euler .rotation stays frozen.
  function handleTransform(): ObjectTransform {
    const rotationYRadians = gizmoHandle.rotationQuaternion!.toEulerAngles().y;

    return {
      x: gizmoHandle.position.x,
      y: gizmoHandle.position.y,
      z: gizmoHandle.position.z,
      rotationY: (rotationYRadians * 180) / Math.PI,
      scale: gizmoHandle.scaling.x,
    };
  }

  for (const gizmo of [positionGizmo, rotationGizmo, scaleGizmo]) {
    gizmo?.onDragStartObservable.add(() => {
      draggingObjectId = selectedObjectId;
      lastObjectPullAt = 0;
      if (selectedObjectId) live.onObjectGrab?.(selectedObjectId);
    });

    gizmo?.onDragObservable.add(() => {
      if (!draggingObjectId) return;

      const root = rootOf(draggingObjectId);
      if (root && contestedObject() !== draggingObjectId) copyHandleToRoot(root);

      const now = performance.now();
      if (now - lastObjectPullAt >= PULL_INTERVAL_MS) {
        lastObjectPullAt = now;
        live.onObjectPull?.(draggingObjectId, handleTransform());
      }
    });

    gizmo?.onDragEndObservable.add(() => {
      const root = draggingObjectId ? rootOf(draggingObjectId) : null;
      if (root && contestedObject() !== draggingObjectId) copyHandleToRoot(root);
      if (selectedObjectId) options.onObjectTransform?.(selectedObjectId, handleTransform());
      if (draggingObjectId) live.onObjectRelease?.(draggingObjectId);
      draggingObjectId = null;
    });
  }

  gizmoManager.positionGizmoEnabled = false;
  gizmoManager.rotationGizmoEnabled = false;
  gizmoManager.scaleGizmoEnabled = false;

  function setSelectionEnabled(enabled: boolean) {
    selectionEnabled = enabled;
  }

  // attachToNode only attaches the gizmo types enabled at that moment, so the mode is re-applied after every attach.
  let gizmoMode: GizmoMode = 'move';
  let showGizmo = true;

  function setShowGizmo(show: boolean) {
    showGizmo = show;
    if (!selectedObjectId || !objectEntries.get(selectedObjectId)) return;
    gizmoManager.attachToNode(show && selectedCanMove ? gizmoHandle : null);
    if (show && selectedCanMove) setGizmoMode(gizmoMode);
  }

  function setActiveObject(objectId: string | null, canMove: boolean) {
    selectionHighlight.removeAllMeshes();
    const previous = selectedObjectId;
    selectedObjectId = objectId;
    selectedCanMove = canMove;

    if (previous && previous !== objectId) refreshLabel(previous);

    const record = objectId ? objectEntries.get(objectId) : undefined;

    if (!record) {
      gizmoManager.attachToNode(null);
      return;
    }

    for (const mesh of record.content.meshes()) {
      if (mesh instanceof Mesh) selectionHighlight.addMesh(mesh, Color3.FromHexString('#f5c469'));
    }

    refreshLabel(record.data.id);
    syncHandleFromRoot(record.holder);
    gizmoManager.attachToNode(canMove && showGizmo ? gizmoHandle : null);
    if (canMove && showGizmo) setGizmoMode(gizmoMode);
  }

  function setGizmoMode(mode: GizmoMode) {
    gizmoMode = mode;
    gizmoManager.positionGizmoEnabled = mode === 'move';
    gizmoManager.rotationGizmoEnabled = mode === 'rotate';
    gizmoManager.scaleGizmoEnabled = mode === 'scale';
  }

  // Babylon prefers rotationQuaternion once it is set; keep both in sync.
  function setRootTransform(root: TransformNode, x: number, y: number, z: number, rotationY: number, scale: number) {
    root.position.set(x, y, z);

    const rotationYRadians = (rotationY * Math.PI) / 180;
    if (root.rotationQuaternion) {
      root.rotationQuaternion = Quaternion.FromEulerAngles(0, rotationYRadians, 0);
    } else {
      root.rotation.set(0, rotationYRadians, 0);
    }

    root.scaling.setAll(scale);
  }

  function selectedId() {
    return selectedObjectId;
  }

  function draggingId() {
    return draggingObjectId;
  }

  function setDragging(objectId: string | null) {
    draggingObjectId = objectId;
  }

  function isSelectionEnabled() {
    return selectionEnabled;
  }

  function refreshActiveObject(objectId: string) {
    if (objectId === selectedObjectId) setActiveObject(objectId, selectedCanMove);
  }

  function disposeSelection() {
    gizmoManager.dispose();
    selectionHighlight.dispose();
  }

  return { rootOf, syncHandleFromRoot, setSelectionEnabled, setShowGizmo, setActiveObject, setGizmoMode, setRootTransform, selectedId, draggingId, setDragging, isSelectionEnabled, refreshActiveObject, disposeSelection };
}
