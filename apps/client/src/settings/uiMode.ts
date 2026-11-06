import { ref, watch } from 'vue';

export type GameSkin = 'gate' | 'winter' | 'planes' | 'grove' | 'crystal' | 'astral' | 'crimson';

export const GAME_SKINS: Array<{ id: GameSkin; name: string; description: string }> = [
  { id: 'gate', name: 'Камень', description: 'Тёмный камень, золото, бордовые акценты' },
  { id: 'winter', name: 'Сталь', description: 'Графит, серебро, холодный синий' },
  { id: 'planes', name: 'Бронза', description: 'Бронза, пепел, медно-красные акценты' },
  { id: 'grove', name: 'Эльфийская роща', description: 'Изумруд, старое золото и книжные шрифты' },
  { id: 'crystal', name: 'Кристальная сага', description: 'Сапфир, серебро и чёткий текст в духе JRPG' },
  { id: 'astral', name: 'Астральная библиотека', description: 'Чернильный фиолетовый, лунное золото и изящные заголовки' },
  { id: 'crimson', name: 'Багряный двор', description: 'Винный бархат, тёмное серебро и строгая готика' },
];

export const GAME_BOARD_COLORS: Record<GameSkin, { ground: string; wood: string; grid: string }> = {
  gate: { ground: '#2c2419', wood: '#1a110a', grid: '#9c7a38' },
  winter: { ground: '#1d242c', wood: '#10151b', grid: '#7d93a8' },
  planes: { ground: '#2e1b11', wood: '#1a0e07', grid: '#a8642e' },
  grove: { ground: '#172c25', wood: '#0c1914', grid: '#9cb680' },
  crystal: { ground: '#182c50', wood: '#0b1530', grid: '#88bce4' },
  astral: { ground: '#29213b', wood: '#141024', grid: '#b4a0d0' },
  crimson: { ground: '#302127', wood: '#180e14', grid: '#b49b9e' },
};

const SKIN_KEY = 'ttrpg.gameSkin';

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

export function setGameSkin(skin: GameSkin) {
  gameSkin.value = skin;
}

function apply() {
  const root = document.documentElement;
  root.dataset.ui = 'game';
  root.dataset.skin = gameSkin.value;
}

watch(gameSkin, value => {
  write(SKIN_KEY, value);
  apply();
});

apply();
