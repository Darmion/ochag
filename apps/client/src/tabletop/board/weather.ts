import { ParticleSystem, DynamicTexture, Scene, Color3, Vector3, Color4, HemisphericLight } from '@babylonjs/core';

export type WeatherDeps = {
  widthCells: number;
  heightCells: number;
  scene: Scene;
  ambient: HemisphericLight;
  setFogBackground: (color: Color3 | null) => void;
  ambientBase: () => number;
};

export function createWeather({ widthCells, heightCells, scene, ambient, setFogBackground, ambientBase }: WeatherDeps) {
  let weatherSystem: ParticleSystem | null = null;
  let weatherTexture: DynamicTexture | null = null;
  let lightningTimer: ReturnType<typeof setTimeout> | null = null;
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let currentWeather = 'clear';

  function particleTexture(kind: 'drop' | 'flake') {
    const texture = new DynamicTexture(`weather-${kind}`, { width: 32, height: 32 }, scene, false);
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, kind === 'drop' ? 'rgba(210,225,255,0.9)' : 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    texture.hasAlpha = true;
    texture.update();
    return texture;
  }

  function stopWeather() {
    weatherSystem?.dispose();
    weatherSystem = null;
    weatherTexture?.dispose();
    weatherTexture = null;
    if (lightningTimer) clearTimeout(lightningTimer);
    lightningTimer = null;
    if (flashTimer) {
      clearTimeout(flashTimer);
      flashTimer = null;
      ambient.intensity = ambientBase();
    }
    scene.fogMode = Scene.FOGMODE_NONE;
    setFogBackground(null);
  }

  function flashLightning() {
    lightningTimer = setTimeout(() => {
      ambient.intensity = ambientBase() + 1.2;
      flashTimer = setTimeout(() => { ambient.intensity = ambientBase(); flashTimer = null; }, 110);
      flashLightning();
    }, 7000 + Math.random() * 9000);
  }

  function setWeather(weather: string) {
    if (weather === currentWeather) return;
    currentWeather = weather;
    stopWeather();
    if (weather === 'fog') {
      scene.fogMode = Scene.FOGMODE_EXP2;
      scene.fogDensity = 0.035;
      scene.fogColor = new Color3(0.42, 0.42, 0.44);
      setFogBackground(scene.fogColor);
      return;
    }
    if (weather !== 'rain' && weather !== 'storm' && weather !== 'snow') return;

    const snow = weather === 'snow';
    const storm = weather === 'storm';
    const system = new ParticleSystem('weather', storm ? 6000 : snow ? 2500 : 3000, scene);
    weatherTexture = particleTexture(snow ? 'flake' : 'drop');
    system.particleTexture = weatherTexture;
    system.emitter = new Vector3(0, 0, 0);
    const reach = Math.max(widthCells, heightCells) / 2 + 2;
    system.minEmitBox = new Vector3(-reach, 9, -reach);
    system.maxEmitBox = new Vector3(reach, 11, reach);
    system.direction1 = snow ? new Vector3(-0.4, -1, -0.2) : new Vector3(-0.6, -10, 0);
    system.direction2 = snow ? new Vector3(0.4, -1, 0.2) : new Vector3(-0.3, -12, 0.2);
    system.minEmitPower = snow ? 0.6 : 1.2;
    system.maxEmitPower = snow ? 1 : 1.6;
    system.gravity = new Vector3(0, snow ? -0.4 : -14, 0);
    system.minLifeTime = snow ? 6 : 0.7;
    system.maxLifeTime = snow ? 9 : 0.9;
    system.minSize = snow ? 0.06 : 0.045;
    system.maxSize = snow ? 0.12 : 0.065;
    system.emitRate = storm ? 5000 : snow ? 280 : 2200;
    system.color1 = snow ? new Color4(1, 1, 1, 0.9) : new Color4(0.75, 0.82, 1, 0.55);
    system.color2 = snow ? new Color4(0.9, 0.93, 1, 0.75) : new Color4(0.65, 0.72, 0.95, 0.4);
    system.colorDead = new Color4(1, 1, 1, 0);
    system.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    if (!snow) {
      system.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
      system.minScaleX = 0.5;
      system.maxScaleX = 0.7;
      system.minScaleY = 6;
      system.maxScaleY = 9;
    }
    system.preWarmCycles = snow ? 300 : 60;
    system.start();
    weatherSystem = system;
    if (storm) flashLightning();
  }

  return { stopWeather, setWeather };
}
