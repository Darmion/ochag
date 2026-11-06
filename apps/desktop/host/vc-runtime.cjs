const fs = require('node:fs');
const path = require('node:path');

// initdb, pg_ctl and postgres of @embedded-postgres/windows-x64 import VCRUNTIME140.dll, which a clean Windows gets only with the Visual C++ Redistributable.
const DLLS = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'];

function missingVcRuntime({systemRoot = process.env.SystemRoot || 'C:\\Windows', exists = fs.existsSync} = {}) {
  return DLLS.filter(name => !exists(path.join(systemRoot, 'System32', name)));
}

// 3221225781 = 0xC0000135 STATUS_DLL_NOT_FOUND, the exit code embedded-postgres reports when initdb cannot load.
function isDllNotFound(error) {
  return /3221225781|0xc0000135/i.test(error instanceof Error ? error.message : String(error ?? ''));
}

function vcRuntimeError() {
  const error = new Error('Серверу мастера нужен компонент Windows «Microsoft Visual C++ Redistributable (x64)». Скачайте его с сайта Microsoft, установите и запустите сервер снова.');
  error.code = 'vc-runtime';
  return error;
}

module.exports = {missingVcRuntime, isDllNotFound, vcRuntimeError};
