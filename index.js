const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Galamtor',
    backgroundColor: '#090a0f',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 12 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      sandbox: true
    }
  });

  mainWindow.loadFile('index.html');

  // Uncomment for development:
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
