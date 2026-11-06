const { ipcMain, net } = require('electron');
const { allowedRoute } = require('./api-routes.cjs');
const { networkFailure } = require('./connection.cjs');
const { senderKind } = require('./senders.cjs');

const REQUEST_TIMEOUT = 15_000;
const FILE_TIMEOUT = 10 * 60_000;
const STALL_TIMEOUT = 30_000;
const FILE_LIMIT = 200 * 1024 * 1024;

async function readStreaming(response, signal, onChunk) {
  const started = Date.now();
  onChunk();
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > FILE_LIMIT) throw new Error(`Файл больше ${FILE_LIMIT / 1024 / 1024} МБ — выберите файл поменьше.`);
    if (Date.now() - started > FILE_TIMEOUT) {
      const reason = new Error('request timed out');
      reason.name = 'TimeoutError';
      throw reason;
    }
    if (signal.aborted) throw signal.reason;
    chunks.push(value);
    onChunk();
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
}

function registerApiRequestHandler(ctx) {
  ipcMain.handle('api:request', async (event, input) => {
    const sender = senderKind(ctx, event);

    try {
      if (!input || typeof input !== 'object') {
        throw new Error('Некорректный запрос.');
      }

      if (
        sender === 'player-view' &&
        (input.method !== 'GET' || input.file || input.body !== undefined || input.token !== ctx.playerViewState?.token)
      ) {
        throw new Error('Окно «вид игроков» может только смотреть.');
      }

      const {
        path: route,
        method = 'GET',
        body,
        token = '',
        file,
      } = input;

      if (
        typeof route !== 'string' ||
        route.length > 500 ||
        !allowedRoute.test(route)
      ) {
        throw new Error('Недопустимый маршрут API.');
      }

      if (
        !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      ) {
        throw new Error('Недопустимый метод запроса.');
      }

      if (
        typeof token !== 'string' ||
        (token !== '' && !/^[A-Za-z0-9_-]{43}$/.test(token))
      ) {
        throw new Error('Некорректный токен.');
      }

      let requestBody;
      let extraHeaders = {};

      if (file) {
        if (
          typeof file !== 'object' ||
          typeof file.name !== 'string' || file.name.length > 200 ||
          typeof file.type !== 'string' || file.type.length > 100 ||
          !(file.data instanceof ArrayBuffer || ArrayBuffer.isView(file.data))
        ) {
          throw new Error('Некорректный файл.');
        }

        if (file.data.byteLength > 30 * 1024 * 1024) {
          throw new Error('Файл больше 30 МБ.');
        }

        // net.fetch sets the multipart boundary itself, so no Content-Type here.
        const form = new FormData();
        form.append('file', new Blob([file.data], { type: file.type }), file.name);
        requestBody = form;
      } else if (body !== undefined) {
        const serialized = JSON.stringify(body);

        if (Buffer.byteLength(serialized, 'utf8') > 2 * 1024 * 1024) {
          throw new Error('Запрос превышает 2 МБ.');
        }

        requestBody = serialized;
        extraHeaders = { 'Content-Type': 'application/json' };
      }

      const controller = new AbortController();
      let deadline = null;
      const expire = (ms, name = 'TimeoutError') => {
        clearTimeout(deadline);
        deadline = setTimeout(() => {
          const reason = new Error(name === 'StallError' ? 'download stalled' : 'request timed out');
          reason.name = name;
          controller.abort(reason);
        }, ms);
      };
      expire(file ? FILE_TIMEOUT : REQUEST_TIMEOUT);

      try {
        const response = await net.fetch(`${ctx.serverUrl}${route}`, {
          method,
          headers: {
            ...extraHeaders,
            ...(token
              ? { Authorization: `Bearer ${token}` }
              : {}),
          },
          ...(requestBody !== undefined
            ? { body: requestBody }
            : {}),
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
        });

        const contentType = response.headers.get('content-type') ?? '';
        const isJson = contentType.includes('application/json');
        let data = null;
        let binary = false;

        if (response.status !== 204) {
          if (isJson) {
            expire(REQUEST_TIMEOUT);
            data = await response.json();
          } else {
            data = await readStreaming(response, controller.signal, () => expire(STALL_TIMEOUT, 'StallError'));
            binary = true;
          }
        }

        return {
          status: response.status,
          data,
          binary,
          ...(binary ? { contentType: contentType.slice(0, 100) } : {}),
        };
      } catch (error) {
        return networkFailure(controller.signal.aborted && controller.signal.reason ? controller.signal.reason : error, ctx.serverUrl);
      } finally {
        clearTimeout(deadline);
      }
    } catch (error) {
      return {
        status: 0,
        data: {
          message: error instanceof Error ? error.message : 'Запрос не выполнен. Попробуйте ещё раз.',
        },
      };
    }
  });
}

module.exports = { registerApiRequestHandler };
