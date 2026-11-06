

function senderKind(ctx, event) {
  for (const [kind, window, url] of [
    ['main', ctx.mainWindow, ctx.entryUrl],
    ['player-view', ctx.playerViewWindow, ctx.playerViewUrl],
  ]) {
    if (
      window &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      event.senderFrame.url === url
    ) {
      return kind;
    }
  }

  throw new Error('Недопустимый источник команды.');
}

function validateSender(ctx, event) {
  if (
    !ctx.mainWindow ||
    event.sender !== ctx.mainWindow.webContents ||
    event.senderFrame !== ctx.mainWindow.webContents.mainFrame ||
    event.senderFrame.url !== ctx.entryUrl
  ) {
    throw new Error('Недопустимый источник команды.');
  }
}

module.exports = { senderKind, validateSender };
