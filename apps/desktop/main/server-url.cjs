const DEFAULT_PORT = '3000';

const LOCAL_SUFFIXES = /\.(local|lan|home|internal|localdomain|home\.arpa)$/i;
function isInternetName(hostname) {
  const host = String(hostname).replace(/^\[|\]$/g, '');
  if (!host.includes('.') || host.includes(':')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return !LOCAL_SUFFIXES.test(host);
}

function normalizeServerUrl(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 300) {
    throw new Error('Некорректный адрес сервера.');
  }

  let text = value.trim();

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const host = text.split(/[/:]/)[0] ?? '';
    text = `${isInternetName(host) ? 'https' : 'http'}://${text}`;
  }

  const url = new URL(text);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Адрес должен начинаться с http:// или https://.');
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'Укажите только адрес и порт, например http://192.168.1.10:3000.',
    );
  }

  if (!/^[a-z]+:\/\/[^/]*:\d+/i.test(text) && !isInternetName(url.hostname)) {
    url.port = DEFAULT_PORT;
  }

  return url.origin;
}

module.exports = { DEFAULT_PORT, isInternetName, normalizeServerUrl };
