import { Engine, Scene, ArcRotateCamera, Vector3, Color3, Color4, HemisphericLight, DirectionalLight, StandardMaterial, PointerEventTypes } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { snapToBoard, snapToLatticePoint, type Position } from './grid';
import { createWeather } from './board/weather';
import { createGlow } from './board/glow';
import { createTurnRing } from './board/turnRing';
import { createTerrain } from './board/terrain';
import { createReachCells } from './board/reachCells';
import { createRangeFrame } from './board/rangeFrame';
import { createWallTextures } from './board/wallTextures';
import { createPlacementPreviews } from './board/previews';
import { createWallDrawing } from './board/wallDrawing';
import { createSurroundings } from './board/surroundings';
import { createFog } from './board/fog';
import { createLabels } from './board/labels';
import { createDrawings } from './board/drawings';
import { createPins } from './board/pins';
import { createFreehand } from './board/freehand';
import { createFloatingText } from './board/floatingText';
import { createAttackFx } from './board/attackFx';
import { createFigureLabels } from './board/figureLabels';
import { createAreaTiles } from './board/areaTiles';
import { createAreaTemplates } from './board/areaTemplates';
import { createTriggerAreas } from './board/triggerAreas';
import { createTemplateTool } from './board/templateTool';
import { createWalls } from './board/walls';
import { createAim } from './board/aim';
import { createRulers } from './board/rulers';
import { createPings } from './board/pings';
import { createTerrainBrush } from './board/terrainBrush';
import { createMeasure } from './board/measure';
import { createMultiHighlight } from './board/multiHighlight';
import { createMarquee } from './board/marquee';
import { createFraming } from './board/framing';
import { createSurface } from './board/surface';
import { createObjectContent } from './board/objectContent';
import { createObjectPoses } from './board/objectPoses';
import { createSelection } from './board/selection';
import { createCameraPan } from './board/cameraPan';
import { createCameraInput } from './board/cameraInput';
import { createObjectApply } from './board/objectApply';
import type {
  ObjectSide,
  TableTool,
  MultiSelection,
  TabletopOptions,
  ObjectRecord,
} from './sceneTypes';
import { createObjectDrag } from './board/objectDrag';
import { createTableClicks } from './board/tableClicks';
export type {
  ObjectSide,
  PlacedObject,
  ObjectTransform,
  GizmoMode,
  WallStyle,
  WallKind,
  WallSegment,
  FogCell,
  FogState,
  TableTool,
  MapPin,
  Drawing,
  MultiSelection,
  AimMark,
  AimSpec,
} from './sceneTypes';

const SIDE_COLORS: Record<ObjectSide, string> = {
  mine: '#315246',
  party: '#3f5582',
  hostile: '#702e32',
  neutral: '#8a6d3b',
  friendly: '#2e6f73',
  object: '#a68148',
};

export type Tabletop = ReturnType<typeof createTabletop>;

export function createTabletop(canvas: HTMLCanvasElement, options: TabletopOptions) {
  const { widthCells, heightCells } = options.dimensions;
  const live = options.live ?? {};
  const tools = options.tools ?? {};
  const halfWidth = widthCells / 2;
  const halfHeight = heightCells / 2;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
  let windowZoom = options.windowZoom ?? 1;
  const applyPixelDensity = () => {
    const screenDensity = window.devicePixelRatio / windowZoom;
    engine.setHardwareScalingLevel(Math.max(1, screenDensity / 1.5) / windowZoom);
  };
  applyPixelDensity();
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.075, 0.048, 0.032, 1);
  const radius = Math.max(12, Math.hypot(widthCells, heightCells) * 0.9);
  const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, radius, Vector3.Zero(), scene);
  camera.lowerRadiusLimit = 6;
  camera.upperRadiusLimit = Math.max(45, radius * 1.8);
  camera.lowerBetaLimit = 0.2;
  camera.upperBetaLimit = Math.PI / 2.1;
  camera.wheelPrecision = 12;
  camera.panningSensibility = 100;
  camera.attachControl(canvas, true);

  const { cameraScheme, setCameraControls, cameraGesture, holdCamera } = createCameraInput({ canvas, camera, options });

  const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.9;
  ambient.groundColor = new Color3(0.15, 0.09, 0.05);
  const sun = new DirectionalLight('sun', new Vector3(-1, -2, 1), scene);
  sun.intensity = 1.0;
  sun.diffuse = new Color3(1, 0.88, 0.66);

  function material(name: string, color: string) {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = Color3.FromHexString(color);
    mat.specularColor = new Color3(0.12, 0.1, 0.07);
    return mat;
  }
  const wood = material('wood', '#46291b');
  const brass = material('brass', '#c6a15a');
  const crateWood = material('crate-wood', '#8a5a33');
  const sideMaterials = Object.fromEntries(
    (Object.keys(SIDE_COLORS) as ObjectSide[]).map(side => [side, material(`side-${side}`, SIDE_COLORS[side])]),
  ) as Record<ObjectSide, StandardMaterial>;

  const {
    setBackground, setBackgroundRotation, ground, setGrid, setTheme,
  } = createSurface({ options, widthCells, heightCells, halfWidth, halfHeight, scene, material, wood, brass });

  const { setFogBackground, setSurroundLight, setSurroundings } = createSurroundings({ widthCells, heightCells, scene });

  const {
    overlayLabels, createLabel, removeLabel, setLabelText, setLabelClass, invalidateLabelSizes,
  } = createLabels({ canvas, tools, scene, camera });

  // Leave the GLB __root__ untouched: it holds glTF's right-to-left-handed conversion (180° turn and Z mirror); writing to it mirrored the models.

  const objectEntries = new Map<string, ObjectRecord>();

  const {
    getAnimationNames, animationIndex, appearanceKey, buildContent,
  } = createObjectContent({ options, scene, brass, crateWood, sideMaterials });

  // contestedObject and refreshLabel are created further down, so they are passed lazily.
  const {
    rootOf, syncHandleFromRoot, setSelectionEnabled, setShowGizmo, setActiveObject, setGizmoMode,
    setRootTransform, selectedId, draggingId, setDragging, isSelectionEnabled, refreshActiveObject,
    disposeSelection,
  } = createSelection({ options, live, scene, objectEntries, contestedObject: () => contestedObject(), refreshLabel: id => refreshLabel(id) });

  // stopFlight is created further down, so it is passed lazily.
  const { setCameraPan } = createCameraPan({ widthCells, heightCells, engine, scene, camera, stopFlight: () => stopFlight() });

  const {
    stopFlight, frameView, resetCamera, userCameraStamp, disposeFraming,
  } = createFraming({ canvas, halfWidth, halfHeight, reducedMotion, scene, radius, camera, objectEntries });

  const {
    applyObjectPose, moveRoot, clearObjectPose, contestedObject, isLivePosed, dropLivePose,
  } = createObjectPoses({
    engine, scene, selectedObjectId: selectedId,
    draggingObjectId: draggingId, rootOf, syncHandleFromRoot, setRootTransform,
  });

  const {
    refreshLabel, makeLabel, makeHpBar, refreshHpBar, setShowHitPoints,
  } = createFigureLabels({
    setLabelText, setLabelClass, createLabel, objectEntries,
    selectedObjectId: selectedId, inAnyTemplate: record => inAnyTemplate(record),
  });
  const {
    showFloatingText, showSpeech, stopFloatingText,
  } = createFloatingText({ reducedMotion, createLabel, setLabelText, removeLabel, objectEntries });

  const { showAttack } = createAttackFx({ reducedMotion, scene, rootOf });

  const LIGHTING = { bright: [0.9, 1.0], dim: [0.88, 0.9], dark: [0.85, 0.8] } as const;
  const SURROUND_LIGHT = { bright: 1, dim: 0.7, dark: 0.4 } as const;

  let ambientBase: number = LIGHTING.bright[0];
  function setLighting(level: 'bright' | 'dim' | 'dark') {
    const [ambientIntensity, sunIntensity] = LIGHTING[level] ?? LIGHTING.bright;
    ambient.intensity = ambientIntensity;
    ambientBase = ambientIntensity;
    sun.intensity = sunIntensity;
    setSurroundLight(SURROUND_LIGHT[level] ?? 1);
  }

  const {
    stopWeather, setWeather,
  } = createWeather({
    widthCells, heightCells, scene, ambient, setFogBackground,
    ambientBase: () => ambientBase,
  });

  const { refreshGlow } = createGlow({ scene, objectEntries, currentWalls: () => wallList(), wallsVersion: () => wallsRevision() });

  // refreshAim and refreshMulti are created further down, so they are passed lazily.
  const {
    setObjects, turnObject,
  } = createObjectApply({
    scene, removeLabel, objectEntries, animationIndex, appearanceKey, buildContent, selectedId,
    setActiveObject, refreshActiveObject, draggingId, syncHandleFromRoot, dropLivePose, isLivePosed,
    moveRoot, makeLabel, makeHpBar, refreshLabel, refreshHpBar, refreshGlow, multi: () => multi,
    refreshAim: () => refreshAim(), refreshMulti: () => refreshMulti(),
  });

  createTurnRing({ scene, reducedMotion, objectEntries, rootOf, turnObjectId: turnObject });

  const WALL_HEIGHT = 1;
  const WALL_DEPTH = 0.2;

  const { setDifficultCells } = createTerrain({ widthCells, heightCells, scene });

  const { setReachCells, setMoveFilter } = createReachCells({ widthCells, heightCells, scene });

  const { setRangeFrame } = createRangeFrame({ scene, objectEntries, rootOf });

  const { wallMaterial } = createWallTextures({ options, scene });

  let multi = { objects: new Set<string>(), walls: new Set<string>(), templates: new Set<string>() };

  function setMultiSelection(selection: MultiSelection) {
    multi = { objects: new Set(selection.objects), walls: new Set(selection.walls), templates: new Set(selection.templates) };
    refreshMulti();
  }

  const {
    disposeWalls, refreshWallOutlines, wallList, wallsRevision, setWalls, setWallHighlight,
    wallPointUnderPointer, wallUnderPointer, hoveredWallId, setHoveredWall, isWallPickMode,
    setWallPickMode,
  } = createWalls({ scene, WALL_HEIGHT, WALL_DEPTH, wallMaterial, multi: () => multi, pickGroundPoint });

  const {
    setWallShape, isWallDrawMode, updateWallVisuals, setWallDrawMode, setWallFirstPoint,
  } = createWallDrawing({ scene, brass, WALL_HEIGHT, WALL_DEPTH });

  const {
    placePreviewMaterial, placePreviewActive, setPlacePreview, groupPreviewActive, setGroupPreview,
    updateGroupPreview, updatePlacePreview,
  } = createPlacementPreviews({ scene });

  const { setFog, setFogPreview, setLightMap } = createFog({ widthCells, heightCells, scene });

  const { setDrawings } = createDrawings({ scene, removeLabel, createLabel, setLabelText });

  const { setPins } = createPins({ scene, material, brass, removeLabel, createLabel, setLabelText });

  const {
    setDrawStyle, strokeActive, cancelStroke,
  } = createFreehand({ canvas, tools, scene, camera, cameraGesture, holdCamera, tool: () => tool, pickGroundPoint });

  const { areaTiles, tintMaterial } = createAreaTiles({ widthCells, heightCells, scene });

  // refreshMulti is created further down, so it is passed lazily.
  const {
    setTemplates, inAnyTemplate, templateList, highlightTemplates,
  } = createAreaTemplates({ objectEntries, refreshLabel, multi: () => multi, tintMaterial, areaTiles, refreshMulti: () => refreshMulti() });

  const { setTriggerAreas, setTriggerHighlight } = createTriggerAreas({ tintMaterial, areaTiles });

  const {
    setTemplateStyle, templateDragActive, cancelTemplateDrag,
  } = createTemplateTool({
    canvas, widthCells, heightCells, tools, scene, camera, cameraGesture, holdCamera, ground,
    tintMaterial, areaTiles, tool: () => tool,
  });

  const {
    aimTap, setAimCursor, setAim, aimActive, hasAimCursor, refreshAim,
  } = createAim({
    canvas, options, widthCells, heightCells, tools, scene, objectEntries, rootOf, wallList,
    hoveredWallId, setHoveredWall, wallPointUnderPointer, isWallPickMode, placePreviewMaterial,
    tintMaterial, areaTiles, tool: () => tool, pickGroundPoint,
  });

  let tool: TableTool = 'select';

  const clampX = (value: number) => Math.max(-halfWidth, Math.min(halfWidth, value));
  const clampZ = (value: number) => Math.max(-halfHeight, Math.min(halfHeight, value));

  function pickGroundPoint(snap: boolean): Position | null {
    const pick = scene.pick(scene.pointerX, scene.pointerY, mesh => mesh === ground);
    if (!pick?.hit || !pick.pickedPoint) return null;

    return snap
      ? { x: snapToBoard(pick.pickedPoint.x, widthCells), z: snapToBoard(pick.pickedPoint.z, heightCells) }
      : { x: clampX(pick.pickedPoint.x), z: clampZ(pick.pickedPoint.z) };
  }

  const { emissiveMaterial, createRuler, createPathLine } = createRulers({ scene, createLabel, setLabelText, removeLabel });

  const measureText = (from: Position, to: Position) => tools.measureLabel?.(from, to) ?? '';

  const {
    clearOwnMeasure, showRemoteMeasure, clearRemoteMeasure, clearRemoteMeasures, measureActive,
    abortMeasure, stopMeasureTimers,
  } = createMeasure({
    canvas, tools, scene, camera, cameraGesture, holdCamera, tool: () => tool, clampX, clampZ,
    pickGroundPoint, createRuler, measureText,
  });

  const {
    showPing, firePing, clearPings,
  } = createPings({
    canvas, tools, reducedMotion, scene, camera, removeLabel, createLabel, setLabelText, clampX,
    clampZ, emissiveMaterial,
  });

  function setTool(next: TableTool) {
    tool = next;
    if (!hasAimCursor()) canvas.style.cursor = next === 'select' ? '' : next === 'erase' ? 'cell' : 'crosshair';
    if (next !== 'measure') clearOwnMeasure(true);
    if (next !== 'draw') cancelStroke();
    if (next !== 'place') setPlacePreview(null);
  }

  function clearSignals() {
    clearOwnMeasure(false);
    clearRemoteMeasures();
    clearPings();
  }

  // consumeMarqueeEnd and isTerrainBrush are created further down, so they are passed lazily.
  createTableClicks({
    options, widthCells, heightCells, tools, scene, ground, isSelectionEnabled, wallUnderPointer,
    isWallPickMode, wallPointUnderPointer, wallList, isWallDrawMode, aimActive, aimTap,
    tool: () => tool, pickGroundPoint, firePing,
    consumeMarqueeEnd: () => consumeMarqueeEnd(), isTerrainBrush: () => isTerrainBrush(),
  });

  // isTerrainBrush is created further down, so it is passed lazily.
  const {
    endObjectDrag, cancelObjectDrag,
  } = createObjectDrag({
    canvas, options, widthCells, heightCells, live, tools, scene, camera, cameraGesture, holdCamera,
    objectEntries, setDragging, isSelectionEnabled, selectedId, syncHandleFromRoot, contestedObject,
    isWallPickMode, isWallDrawMode, tool: () => tool, clampX, clampZ, pickGroundPoint,
    createPathLine, createRuler, measureText, isTerrainBrush: () => isTerrainBrush(), cancelGesture,
  });


  scene.onPointerObservable.add(info => {
    if (info.type !== PointerEventTypes.POINTERMOVE || !isWallDrawMode()) return;

    const pick = scene.pick(scene.pointerX, scene.pointerY, mesh => mesh === ground);

    updateWallVisuals(
      pick?.hit && pick.pickedPoint
        ? {
            x: snapToLatticePoint(pick.pickedPoint.x, widthCells),
            z: snapToLatticePoint(pick.pickedPoint.z, heightCells),
          }
        : null,
    );
  });

  scene.onPointerObservable.add(info => {
    if (info.type === PointerEventTypes.POINTERMOVE && groupPreviewActive() && tool === 'select') updateGroupPreview(pickGroundPoint(true));
    if (info.type !== PointerEventTypes.POINTERMOVE || tool !== 'place' || !placePreviewActive()) return;
    updatePlacePreview(pickGroundPoint(true));
  });

  scene.onPointerObservable.add(info => {
    if (info.type !== PointerEventTypes.POINTERMOVE || !isWallPickMode() || aimActive()) return;
    setHoveredWall(wallUnderPointer());
  });

  const { refreshMulti } = createMultiHighlight({ scene, objectEntries, multi: () => multi, refreshWallOutlines, highlightTemplates });
  // isTerrainBrush is created further down, so it is passed lazily.
  const {
    marqueeActive, consumeMarqueeEnd, cancelMarquee, disposeMarquee,
  } = createMarquee({
    canvas, tools, scene, camera, cameraScheme, cameraGesture, holdCamera,
    objectEntries, isWallPickMode, wallList, isWallDrawMode, templateList, tool: () => tool,
    isTerrainBrush: () => isTerrainBrush(),
  });

  const {
    isTerrainBrush, terrainDragActive, cancelTerrainDrag, setTerrainBrush,
  } = createTerrainBrush({
    canvas, widthCells, heightCells, tools, scene, camera, cameraGesture, holdCamera, tintMaterial,
    pickGroundPoint,
  });
  function abortGestures() {
    endObjectDrag();
    if (strokeActive()) cancelStroke();
    abortMeasure();
    cancelTemplateDrag();
    cancelMarquee();
    cancelTerrainDrag();
  }
  const onLostCapture = () => setTimeout(abortGestures, 0);

  function cancelGesture(): boolean {
    if (cancelObjectDrag()) return true;
    const busy = Boolean(strokeActive() || measureActive() || templateDragActive() || marqueeActive() || terrainDragActive());
    if (strokeActive()) cancelStroke();
    if (measureActive()) clearOwnMeasure(true);
    abortGestures();
    return busy;
  }
  canvas.addEventListener('lostpointercapture', onLostCapture);
  // The middle button rotates the camera: block Chromium's autoscroll.
  const preventAutoscroll = (event: MouseEvent) => {
    if (event.button === 1) event.preventDefault();
  };
  canvas.addEventListener('mousedown', preventAutoscroll);
  canvas.addEventListener('auxclick', preventAutoscroll);

  function setWindowZoom(zoom: number) {
    if (!Number.isFinite(zoom) || zoom <= 0 || zoom === windowZoom) return;
    windowZoom = zoom;
    applyPixelDensity();
    engine.resize();
  }

  const preventMenu = (event: Event) => event.preventDefault();
  const preventPageScroll = (event: WheelEvent) => {
    event.preventDefault();
  };
  canvas.addEventListener('wheel', preventPageScroll, {
    passive: false,
  });
  canvas.addEventListener('contextmenu', preventMenu);
  const resize = new ResizeObserver(() => engine.resize());
  resize.observe(canvas);
  const frame = () => scene.render();
  engine.runRenderLoop(frame);
  return {
    cancelGesture,
    setCameraControls,
    setWindowZoom,
    setObjects,
    setDrawings,
    setDrawStyle,
    setPins,
    setShowHitPoints,
    setLighting,
    setWeather,
    setDifficultCells,
    setReachCells,
    setMoveFilter,
    setRangeFrame,
    setTemplates,
    setTemplateStyle,
    setTriggerAreas,
    setTriggerHighlight,
    setWalls,
    setFog,
    setFogPreview,
    setLightMap,
    setBackground,
    setBackgroundRotation,
    setTheme,
    setSurroundings,
    setGrid,
    getAnimationNames,
    setSelectionEnabled,
    setActiveObject,
    showFloatingText,
    showSpeech,
    showAttack,
    setGizmoMode,
    setShowGizmo,
    setCameraPan,
    setWallDrawMode,
    setWallFirstPoint,
    setWallShape,
    setWallHighlight,
    setAim,
    setAimCursor,
    setWallPickMode,
    setTerrainBrush,
    setMultiSelection,
    setPlacePreview,
    setGroupPreview,
    applyObjectPose,
    clearObjectPose,
    setTool,
    showPing,
    showRemoteMeasure,
    clearRemoteMeasure,
    clearOwnMeasure,
    clearSignals,
    focusOn(point: Position) {
      stopFlight();
      camera.setTarget(new Vector3(clampX(point.x), 0, clampZ(point.z)), false, false, true);
    },
    resetCamera,
    frameView,
    userCameraStamp,
    invalidateLabelSizes,
    dispose() {
      disposeFraming();
      stopWeather();
      stopFloatingText();
      clearPings();
      stopMeasureTimers();
      disposeMarquee();
      for (const label of overlayLabels) label.el.remove();
      overlayLabels.clear();
      resize.disconnect();
      canvas.removeEventListener('contextmenu', preventMenu);
      canvas.removeEventListener('wheel', preventPageScroll);
      canvas.removeEventListener('lostpointercapture', onLostCapture);
      canvas.removeEventListener('mousedown', preventAutoscroll);
      canvas.removeEventListener('auxclick', preventAutoscroll);
      engine.stopRenderLoop(frame);
      disposeSelection();
      disposeWalls();
      scene.dispose();
      engine.dispose();
    },
  };
}
