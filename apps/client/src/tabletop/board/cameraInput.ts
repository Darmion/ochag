import type { ArcRotateCamera } from '@babylonjs/core';
import type { TabletopOptions } from '../sceneTypes';

export type CameraInputDeps = {
  canvas: HTMLCanvasElement;
  camera: ArcRotateCamera;
  options: Pick<TabletopOptions, 'cameraScheme' | 'altRotate'>;
};

export function createCameraInput({ canvas, camera, options }: CameraInputDeps) {
  let cameraScheme: 'tts' | 'classic' = options.cameraScheme ?? 'tts';
  let altRotate = options.altRotate ?? true;
  function applyCameraControls() {
    const input = camera.movement.input;
    if (cameraScheme === 'classic') {
      input.resetInputMap();
      return;
    }
    const map: typeof input.inputMap = [
      { source: 'pointer', button: 1, interaction: 'rotate' },
      { source: 'pointer', button: 2, interaction: 'pan' },
      { source: 'wheel', interaction: 'zoom' },
      { source: 'keyboard', key: [187, 107, 189, 109], interaction: 'zoom' },
    ];
    if (altRotate) map.unshift({ source: 'pointer', button: 0, modifiers: { alt: true }, interaction: 'rotate' });
    input.inputMap = map;
  }
  applyCameraControls();
  function setCameraControls(next: { scheme: 'tts' | 'classic'; altRotate: boolean }) {
    cameraScheme = next.scheme;
    altRotate = next.altRotate;
    applyCameraControls();
  }

  // Babylon 9's camera observer shares scene.onPointerObservable with the gestures, so each gesture checks instead of skipping observers.
  const cameraGesture = (event: unknown) => cameraScheme === 'tts' && altRotate && Boolean((event as MouseEvent).altKey);

  function holdCamera(event: unknown) {
    camera.detachControl();
    const pointerId = (event as { pointerId?: number }).pointerId;
    if (typeof pointerId === 'number') {
      try {
        canvas.setPointerCapture(pointerId);
      } catch {
      }
    }
  }

  return { cameraScheme: () => cameraScheme, setCameraControls, cameraGesture, holdCamera };
}
