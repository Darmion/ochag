// The app name lives here; package.json «build» (read by electron-builder) and apps/desktop/main/windows.cjs titles are set separately.
export const branding = {
  appName: 'Очаг',
  tagline: 'виртуальный стол для ролевых игр',
  edition: 'бета',
  // The desktop shell opens only allow-listed links: apps/desktop/main/windows.cjs EXTERNAL_LINKS.
  issuesUrl: 'https://github.com/Darmion/ochag/issues',
};

const BASE = import.meta.env.BASE_URL;
export const brandImages = {
  logo: `${BASE}branding/logo.png`,
  emblem: `${BASE}branding/emblem.png`,
  monochrome: `${BASE}branding/icon.svg`,
  icon: `${BASE}favicon.png`,
} as const;
