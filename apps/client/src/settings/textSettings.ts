import { computed, ref, watch } from 'vue';
import { gameSkin } from './uiMode';
import { tr } from '../i18n/i18n';

export type BodyFont = 'book' | 'clear' | 'wide' | 'serif';

type Faces = { regular: string[]; italic: string[]; bold: string[]; boldItalic: string[] };

const SEGOE: Faces = {
  regular: ['Segoe UI', 'SegoeUI'], italic: ['Segoe UI Italic', 'SegoeUI-Italic'],
  bold: ['Segoe UI Semibold', 'SegoeUI-Semibold'], boldItalic: ['Segoe UI Semibold Italic', 'SegoeUI-SemiboldItalic'],
};

export const BODY_FONTS: Array<{ id: BodyFont; label: string; faces: Faces; fallback: string }> = [
  {
    id: 'book', label: tr('Из оформления — шрифт выбранной темы'),
    faces: {
      regular: ['Palatino Linotype', 'PalatinoLinotype-Roman'], italic: ['Palatino Linotype Italic', 'PalatinoLinotype-Italic'],
      bold: ['Palatino Linotype Bold', 'PalatinoLinotype-Bold'], boldItalic: ['Palatino Linotype Bold Italic', 'PalatinoLinotype-BoldItalic'],
    },
    fallback: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif",
  },
  { id: 'clear', label: tr('Чёткий — Segoe UI, без засечек'), faces: SEGOE, fallback: "'Segoe UI', Arial, sans-serif" },
  {
    id: 'wide', label: tr('Широкий и разборчивый — Verdana'),
    faces: {
      regular: ['Verdana'], italic: ['Verdana Italic', 'Verdana-Italic'],
      bold: ['Verdana Bold', 'Verdana-Bold'], boldItalic: ['Verdana Bold Italic', 'Verdana-BoldItalic'],
    },
    fallback: 'Verdana, Tahoma, sans-serif',
  },
  {
    id: 'serif', label: tr('С засечками — Georgia'),
    faces: {
      regular: ['Georgia'], italic: ['Georgia Italic', 'Georgia-Italic'],
      bold: ['Georgia Bold', 'Georgia-Bold'], boldItalic: ['Georgia Bold Italic', 'Georgia-BoldItalic'],
    },
    fallback: "Georgia, 'Times New Roman', serif",
  },
];

export const TEXT_SIZES = [100, 110, 120, 130, 140] as const;

const FONT_KEY = 'ttrpg.bodyFont';
const SIZE_KEY = 'ttrpg.textSize';

function readFont(): BodyFont {
  try {
    const raw = localStorage.getItem(FONT_KEY);
    return BODY_FONTS.some(entry => entry.id === raw) ? (raw as BodyFont) : 'book';
  } catch {
    return 'book';
  }
}

function readSize(): number {
  try {
    const raw = Number(localStorage.getItem(SIZE_KEY));
    return (TEXT_SIZES as readonly number[]).includes(raw) ? raw : 100;
  } catch {
    return 100;
  }
}

export const bodyFont = ref<BodyFont>(readFont());
export const textSize = ref<number>(readSize());
const textCustomized = computed(() => bodyFont.value !== 'book' || textSize.value !== 100);

let added: FontFace[] = [];

function faceSource(names: string[]) {
  return names.map(name => `local("${name}")`).join(', ');
}

function register(family: string, faces: Faces, sizeAdjust: string) {
  const variants: Array<[keyof Faces, { weight: string; style: string }]> = [
    ['regular', { weight: '100 500', style: 'normal' }],
    ['italic', { weight: '100 500', style: 'italic' }],
    ['bold', { weight: '550 900', style: 'normal' }],
    ['boldItalic', { weight: '550 900', style: 'italic' }],
  ];
  for (const [variant, descriptors] of variants) {
    const face = new FontFace(family, faceSource(faces[variant]), { ...descriptors, sizeAdjust } as FontFaceDescriptors);
    document.fonts.add(face);
    added.push(face);
    void face.load().catch(() => {});
  }
}

export function applyTextSettings() {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  for (const face of added) document.fonts.delete(face);
  added = [];
  const themeFont: BodyFont = gameSkin.value === 'crystal' ? 'clear' : gameSkin.value === 'astral' || gameSkin.value === 'crimson' ? 'serif' : 'book';
  const effectiveFont = bodyFont.value === 'book' ? themeFont : bodyFont.value;
  const font = BODY_FONTS.find(entry => entry.id === effectiveFont) ?? BODY_FONTS[0]!;
  const sizeAdjust = `${textSize.value}%`;
  register('UI Body', font.faces, sizeAdjust);
  register('UI Label', SEGOE, sizeAdjust);
  const root = document.documentElement;
  root.style.setProperty('--g-body-font', `'UI Body', ${font.fallback}`);
  root.style.setProperty('--ui-body-font', `'UI Body', ${font.fallback}`);
  root.style.setProperty('--ui-label-font', `'UI Label', 'Segoe UI', Arial, sans-serif`);
  if (textCustomized.value) root.dataset.textCustom = '1';
  else delete root.dataset.textCustom;
}

watch([bodyFont, textSize, gameSkin], ([font, size]) => {
  try {
    localStorage.setItem(FONT_KEY, font);
    localStorage.setItem(SIZE_KEY, String(size));
  } catch {
  }
  applyTextSettings();
});
