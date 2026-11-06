import type { FastifyPluginAsync } from 'fastify';

import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';

import { addressOf } from './rate-keys.ts';

const core = createRequire(import.meta.url)('../../../desktop/host/update-core.cjs') as {
  installerFor: (dir: string, version: string) => Promise<{ path: string; size: number; sha256: string; version: string } | null>;
};

type Options = {
  appVersion: string;
  updateDir: string | null;
};

export const updateRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  const installer = () => (options.updateDir ? core.installerFor(options.updateDir, options.appVersion) : Promise.resolve(null));

  app.get('/update/info', async () => {
    const file = await installer();

    return {
      version: options.appVersion,
      installer: file ? { size: file.size, sha256: file.sha256 } : null,
    };
  });

  app.get('/update/installer', { config: { rateLimit: { max: 6, timeWindow: '1 hour', keyGenerator: addressOf } } }, async (_request, reply) => {
    const file = await installer();

    if (!file) {
      return reply.code(404).send({
        error: 'NO_INSTALLER',
        message: 'На сервере мастера нет установщика его версии. Мастеру нужно обновиться через «Обновления» или выбрать установщик вручную.',
      });
    }

    reply
      .type('application/octet-stream')
      .header('Content-Length', String(file.size))
      .header('Content-Disposition', `attachment; filename="Ochag-Setup-${file.version}.exe"`);

    return reply.send(createReadStream(file.path));
  });
};
