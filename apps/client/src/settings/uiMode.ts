import { ref, watch } from 'vue';

export type GameSkin =
  | 'gate' | 'winter' | 'planes' | 'grove' | 'crystal' | 'astral' | 'crimson'
  | 'obsidian' | 'abyss' | 'ember' | 'neon' | 'spectral' | 'lava' | 'gems' | 'opal';
export type SkinGroup = 'classic' | 'dark' | 'glow' | 'shimmer';

export const SKIN_GROUPS: Array<{ id: SkinGroup; name: string }> = [
  { id: 'classic', name: 'Классические' },
  { id: 'dark', name: 'Глубокая тьма' },
  { id: 'glow', name: 'Свечение' },
  { id: 'shimmer', name: 'Переливы' },
];

export const GAME_SKINS: Array<{ id: GameSkin; name: string; description: string; group: SkinGroup }> = [
  { id: 'gate', name: 'Камень', description: 'Тёмный камень, золото, бордовые акценты', group: 'classic' },
  { id: 'winter', name: 'Сталь', description: 'Графит, серебро, холодный синий', group: 'classic' },
  { id: 'planes', name: 'Бронза', description: 'Бронза, пепел, медно-красные акценты', group: 'classic' },
  { id: 'grove', name: 'Эльфийская роща', description: 'Изумруд, старое золото и книжные шрифты', group: 'classic' },
  { id: 'crystal', name: 'Кристальная сага', description: 'Сапфир, серебро и чёткий текст в духе JRPG', group: 'classic' },
  { id: 'astral', name: 'Астральная библиотека', description: 'Чернильный фиолетовый, лунное золото и изящные заголовки', group: 'classic' },
  { id: 'crimson', name: 'Багряный двор', description: 'Винный бархат, тёмное серебро и строгая готика', group: 'classic' },
  { id: 'obsidian', name: 'Обсидиан', description: 'Чёрное вулканическое стекло, холодное серебро и фиолетовый отблеск', group: 'dark' },
  { id: 'abyss', name: 'Бездна', description: 'Почти чёрная синева глубин и бирюзовое серебро', group: 'dark' },
  { id: 'ember', name: 'Угли', description: 'Пепел, сажа и тлеющий оранжевый', group: 'dark' },
  { id: 'neon', name: 'Неоновая ночь', description: 'Чёрный бархат, бирюзовое и пурпурное свечение', group: 'glow' },
  { id: 'spectral', name: 'Призрачный огонь', description: 'Тьма склепа и мертвенно-зелёное свечение', group: 'glow' },
  { id: 'lava', name: 'Лавовая кузня', description: 'Базальт и медленно текущая по рамкам лава', group: 'shimmer' },
  { id: 'gems', name: 'Самоцветы', description: 'Рамки переливаются аметистом, изумрудом и сапфиром', group: 'shimmer' },
  { id: 'opal', name: 'Опал', description: 'Тёмный перламутр с мягкими радужными переливами', group: 'shimmer' },
];

export const GAME_BOARD_COLORS: Record<GameSkin, { ground: string; wood: string; grid: string }> = {
  gate: { ground: '#2c2419', wood: '#1a110a', grid: '#9c7a38' },
  winter: { ground: '#1d242c', wood: '#10151b', grid: '#7d93a8' },
  planes: { ground: '#2e1b11', wood: '#1a0e07', grid: '#a8642e' },
  grove: { ground: '#172c25', wood: '#0c1914', grid: '#9cb680' },
  crystal: { ground: '#182c50', wood: '#0b1530', grid: '#88bce4' },
  astral: { ground: '#29213b', wood: '#141024', grid: '#b4a0d0' },
  crimson: { ground: '#302127', wood: '#180e14', grid: '#b49b9e' },
  obsidian: { ground: '#141318', wood: '#0b0a0f', grid: '#777482' },
  abyss: { ground: '#0c1c22', wood: '#061014', grid: '#527e85' },
  ember: { ground: '#1d1612', wood: '#0f0b09', grid: '#8c6248' },
  neon: { ground: '#0e0a1c', wood: '#06040d', grid: '#287989' },
  spectral: { ground: '#0a1510', wood: '#050b08', grid: '#38805d' },
  lava: { ground: '#171214', wood: '#090708', grid: '#93451f' },
  gems: { ground: '#120f22', wood: '#08060f', grid: '#77639f' },
  opal: { ground: '#171a22', wood: '#0b0c11', grid: '#8590a2' },
};

export const SKIN_SWATCHES: Record<GameSkin, { bg: string; rim: string; tint: string; text: string }> = {
  gate: { bg: '#1c1813', rim: '#d4ae5a', tint: '#7a1b16', text: '#ebdfc3' },
  winter: { bg: '#161b22', rim: '#b8c7d4', tint: '#1e4a73', text: '#dde6ee' },
  planes: { bg: '#21160f', rim: '#cf8f4d', tint: '#5e2347', text: '#ecd6b6' },
  grove: { bg: '#14271f', rim: '#c4c58b', tint: '#28533e', text: '#e5ead5' },
  crystal: { bg: '#142646', rim: '#a8cee9', tint: '#285b9e', text: '#e4effb' },
  astral: { bg: '#241b32', rim: '#ceb78a', tint: '#5c387a', text: '#eee2f3' },
  crimson: { bg: '#261921', rim: '#c7b6b5', tint: '#732b40', text: '#f1e2de' },
  obsidian: { bg: '#111015', rim: '#bdb7d1', tint: '#3d2b60', text: '#e7e4f0' },
  abyss: { bg: '#0a171d', rim: '#92cbc9', tint: '#104757', text: '#d9ecec' },
  ember: { bg: '#181310', rim: '#c58a61', tint: '#76240e', text: '#ecdacc' },
  neon: { bg: '#0f0a1f', rim: '#3eeeff', tint: '#81116e', text: '#ebe8ff' },
  spectral: { bg: '#09130f', rim: '#80ffb3', tint: '#184d3c', text: '#e0f4e9' },
  lava: { bg: '#120f10', rim: '#ff8c2c', tint: '#8b230b', text: '#f3ddcc' },
  gems: { bg: '#110e22', rim: '#cdaeff', tint: '#19553f', text: '#edeafb' },
  opal: { bg: '#15171e', rim: '#d9e3f1', tint: '#344c76', text: '#eef1f7' },
};

const SKIN_KEY = 'ttrpg.gameSkin';
const MOTION_KEY = 'ttrpg.skinMotion';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
  }
}

const savedSkin = read(SKIN_KEY);

export const gameSkin = ref<GameSkin>(GAME_SKINS.some(skin => skin.id === savedSkin) ? savedSkin as GameSkin : 'gate');

export const skinMotion = ref(read(MOTION_KEY) !== 'off');

export function setGameSkin(skin: GameSkin) {
  gameSkin.value = skin;
}

function apply() {
  const root = document.documentElement;
  root.dataset.ui = 'game';
  root.dataset.skin = gameSkin.value;
  root.dataset.skinMotion = skinMotion.value ? 'on' : 'off';
}

watch(gameSkin, value => {
  write(SKIN_KEY, value);
  apply();
});

watch(skinMotion, value => {
  write(MOTION_KEY, value ? 'on' : 'off');
  apply();
});

apply();
