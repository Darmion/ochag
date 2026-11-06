import { computed, reactive, watch, type ComputedRef, type Ref } from 'vue';

import { MAX_UPLOADS, addUpload, artPrefs, setArt } from '../art/artPersonalization';
import { campaignArt, refreshCampaignArt, setCampaignArt, uploadCampaignSprite } from '../art/campaignArt';
import { canvasBlob, canvasDataUrl, cellCount, fitSquare, guessCell, readImage, sliceSheet } from '../art/spriteSheet';
import type { ArtElement } from './catalog';
import type { PictureLibrary } from './pictureLibrary';

const PERSONAL_SIZE = 96;
const CAMPAIGN_SIZE = 128;

export function useSpriteUpload({ selected, forAll, busy, notice, actionError, pictures }: {
  selected: Readonly<Ref<ArtElement | null>>;
  forAll: ComputedRef<boolean>;
  busy: Ref<boolean>;
  notice: Ref<string>;
  actionError: Ref<string>;
  pictures: PictureLibrary;
}) {
  const sheet = reactive({
    image: null as HTMLImageElement | null, name: '', preview: '', cellWidth: 0, cellHeight: 0, skipEmpty: true,
    thumbs: [] as string[], cells: [] as HTMLCanvasElement[], total: 0, empty: 0, cut: false, progress: '',
  });
  function cancelSheet() {
    sheet.image = null;
    sheet.cells = [];
    sheet.thumbs = [];
    sheet.progress = '';
  }
  async function onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !selected.value) return;
    actionError.value = '';
    try {
      const image = await readImage(file);
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Спрайт';
      const cell = guessCell(image.naturalWidth, image.naturalHeight);
      if (cell.width === image.naturalWidth && cell.height === image.naturalHeight) {
        await addPictures([image], name, true);
        return;
      }
      Object.assign(sheet, { image, name, preview: image.src, cellWidth: cell.width, cellHeight: cell.height, skipEmpty: true });
      recut();
    } catch (cause) {
      actionError.value = cause instanceof Error ? cause.message : 'Не получилось открыть файл.';
    }
  }
  const size = () => (forAll.value ? CAMPAIGN_SIZE : PERSONAL_SIZE);
  const sheetGrid = computed(() => (sheet.image ? cellCount(sheet.image.naturalWidth, sheet.image.naturalHeight, sheet.cellWidth, sheet.cellHeight) : { columns: 0, rows: 0 }));
  function recut() {
    if (!sheet.image) return;
    const width = Math.max(1, Math.min(sheet.image.naturalWidth, Math.round(sheet.cellWidth || 0)));
    const height = Math.max(1, Math.min(sheet.image.naturalHeight, Math.round(sheet.cellHeight || 0)));
    const result = sliceSheet(sheet.image, width, height, sheet.skipEmpty);
    sheet.cells = result.cells;
    sheet.total = result.total;
    sheet.empty = result.empty;
    sheet.cut = result.cut;
    sheet.thumbs = result.cells.slice(0, 60).map(cell => fitSquare(cell, 48).toDataURL('image/png'));
  }
  watch(() => [sheet.cellWidth, sheet.cellHeight, sheet.skipEmpty], () => recut());
  const roomLeft = computed(() => (forAll.value ? 500 - campaignArt.sprites.length : MAX_UPLOADS - artPrefs.uploads.length));

  function addWhole() {
    if (sheet.image) void addPictures([sheet.image], sheet.name, true);
  }

  async function addPictures(canvases: Array<HTMLCanvasElement | HTMLImageElement>, name: string, assign: boolean) {
    const element = selected.value;
    if (!element || !canvases.length) return;
    if (canvases.length > roomLeft.value) {
      actionError.value = `Места хватит на ${Math.max(0, roomLeft.value)} — удалите лишние в «${pictures.ownLabel}» или нарежьте меньше.`;
      return;
    }
    busy.value = true;
    actionError.value = '';
    try {
      const values: string[] = [];
      for (const [index, canvas] of canvases.entries()) {
        const label = canvases.length > 1 ? `${name} ${index + 1}` : name;
        sheet.progress = canvases.length > 1 ? `Добавляю ${index + 1} из ${canvases.length}…` : '';
        const square = fitSquare(canvas, size());
        if (forAll.value) {
          values.push(`asset:${await uploadCampaignSprite(await canvasBlob(square), label)}`);
        } else {
          const upload = addUpload(label, canvasDataUrl(square));
          if (!upload) break;
          values.push(`upload:${upload.id}`);
        }
      }
      if (forAll.value) await refreshCampaignArt();
      if (assign && values.length === 1) {
        await (forAll.value ? setCampaignArt(element.key, values[0]!) : setArt(element.key, values[0]!));
        notice.value = `«${element.name}» — теперь «${name}»${forAll.value ? ' у всех' : ''}.`;
      } else {
        notice.value = `Добавлено ${values.length} — они в разделе «${pictures.ownLabel}», выберите нужную.`;
        pictures.pictureSection = pictures.ownSection;
        pictures.pictureQuery = '';
      }
      cancelSheet();
    } catch (cause) {
      actionError.value = cause instanceof Error ? cause.message : 'Не получилось добавить картинку.';
    } finally {
      busy.value = false;
      sheet.progress = '';
    }
  }

  return { sheet, sheetGrid, cancelSheet, onFile, addWhole, addPictures };
}

export type SpriteSheet = ReturnType<typeof useSpriteUpload>['sheet'];
