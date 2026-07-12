const { app, BrowserWindow, nativeImage, Menu, MenuItem } = require('electron');
const path = require('path');

require('electron-reload')(__dirname, {
  electron: path.join(__dirname, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
});

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
    icon: path.join(__dirname, 'assets/icon.png'),
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
  if (process.platform === 'darwin') {
    const image = nativeImage.createFromPath(path.join(__dirname, 'assets/icon.png'));
    app.dock.setIcon(image);
  }

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// ── Native Right-Click Context Menu for Webviews ──
app.on('web-contents-created', (event, contents) => {
  contents.on('context-menu', (e, params) => {
    const menu = new Menu();

    // 1. Image-specific options
    if (params.mediaType === 'image') {
      if (params.srcURL) {
        menu.append(new MenuItem({
          label: 'Суретті жаңа қойындыда ашу (Open Image in New Tab)',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) {
              win.webContents.executeJavaScript(`createTab("${params.srcURL}");`);
            }
          }
        }));
        menu.append(new MenuItem({
          label: 'Суретті көшіру (Copy Image)',
          click: () => {
            contents.copyImageAt(params.x, params.y);
          }
        }));
        menu.append(new MenuItem({
          label: 'Сурет сілтемесін көшіру (Copy Image Address)',
          click: () => {
            const { clipboard } = require('electron');
            clipboard.writeText(params.srcURL);
          }
        }));
        menu.append(new MenuItem({ type: 'separator' }));
      }
    }

    // 2. Standard editing tools
    const hasText = params.selectionText && params.selectionText.trim().length > 0;
    
    if (hasText) {
      menu.append(new MenuItem({
        label: 'Көшіру (Copy)',
        role: 'copy'
      }));
    }
    
    if (params.isEditable) {
      menu.append(new MenuItem({
        label: 'Қою (Paste)',
        role: 'paste'
      }));
      menu.append(new MenuItem({
        label: 'Барлығын таңдау (Select All)',
        role: 'selectAll'
      }));
    } else if (hasText) {
      menu.append(new MenuItem({
        label: 'Барлығын таңдау (Select All)',
        role: 'selectAll'
      }));
    }

    // Add separator if we added options before
    if (menu.items.length > 0) {
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // 3. Inspect Element (global developer tool)
    menu.append(new MenuItem({
      label: 'Кодты көру',
      click: () => {
        contents.inspectElement(params.x, params.y);
        if (!contents.isDevToolsOpened()) {
          contents.openDevTools({ mode: 'detach' });
        }
      }
    }));

    menu.popup();
  });
});
