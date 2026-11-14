import { t, tn } from '../i18n/i18n';
import type { GameIconName } from '../ui/gameIcons';

// Where the server found a file still in use (apps/server/src/system/asset-usage.ts).
export type AssetPlace =
  | 'sceneBackground' | 'sceneMusic' | 'sceneWalls' | 'objectModel' | 'objectImage' | 'objectOpenImage'
  | 'player' | 'campaignLook' | 'conditionIcon' | 'handout' | 'artReplacement' | 'spell' | 'spellRevision'
  | 'deletedScene' | 'runeSymbols';

export type CampaignFile = {
  id: string;
  kind: string;
  content_type: string;
  byte_size: number;
  original_filename: string | null;
  created_at: string;
  uploaded_by_name: string | null;
  uses: Array<{ place: AssetPlace; name: string | null }>;
};

export type FileFilter = 'pictures' | 'models' | 'audio' | 'sprites' | 'all';

export const FILE_FILTERS: Array<{ id: FileFilter; label: string; kinds: string[] | null }> = [
  { id: 'pictures', label: 'Картинки', kinds: ['scene_background', 'object_image', 'campaign_avatar', 'campaign_banner'] },
  { id: 'models', label: 'Модели', kinds: ['object_model'] },
  { id: 'audio', label: 'Музыка и звуки', kinds: ['audio'] },
  { id: 'sprites', label: 'Спрайты библиотеки', kinds: ['art_sprite'] },
  { id: 'all', label: 'Все файлы', kinds: null },
];

const KINDS: Record<string, { label: string; icon: GameIconName }> = {
  scene_background: { label: 'Карта сцены', icon: 'map' },
  object_image: { label: 'Картинка объекта', icon: 'image' },
  campaign_avatar: { label: 'Аватар кампании', icon: 'campaignBanner' },
  campaign_banner: { label: 'Баннер кампании', icon: 'campaignBanner' },
  object_model: { label: 'Модель', icon: 'box' },
  audio: { label: 'Звук', icon: 'music' },
  art_sprite: { label: 'Спрайт', icon: 'palette' },
};

const PLACES: Record<AssetPlace, string> = {
  sceneBackground: 'фон сцены «{name}»',
  sceneMusic: 'музыка сцены «{name}»',
  sceneWalls: 'стены сцены «{name}»',
  objectModel: 'модель «{name}»',
  objectImage: 'картинка «{name}»',
  objectOpenImage: 'открытая картинка «{name}»',
  player: 'проигрыватель музыки',
  campaignLook: 'оформление кампании',
  conditionIcon: 'значок состояния «{name}»',
  handout: 'раздаточный материал «{name}»',
  artReplacement: 'замена картинки «{name}»',
  spell: 'заклинание «{name}»',
  spellRevision: 'правка заклинания «{name}»',
  deletedScene: 'удалённая сцена «{name}» — её можно вернуть',
  runeSymbols: 'руна «{name}» рунного замка',
};

export const fileKindLabel = (kind: string) => t(KINDS[kind]?.label ?? 'Файл');
export const fileKindIcon = (kind: string): GameIconName => KINDS[kind]?.icon ?? 'scroll';
export const isPicture = (file: CampaignFile) => /^image\//.test(file.content_type);

const placeText = (use: CampaignFile['uses'][number]) => t(PLACES[use.place], { name: use.name ?? '' });

export const allPlaces = (file: CampaignFile) => file.uses.map(placeText).join(', ');

export function usesSummary(file: CampaignFile, libraryKind: boolean): string {
  if (!file.uses.length) return libraryKind ? t('Нигде не используется, лежит в библиотеке') : t('Нигде не используется');
  const places = file.uses.slice(0, 3).map(placeText);
  const rest = file.uses.length - places.length;
  const list = rest > 0 ? `${places.join(', ')} ${tn(rest, 'и ещё {n} место|и ещё {n} места|и ещё {n} мест')}` : places.join(', ');
  return t('Используется: {list}', { list });
}
