const {app, Menu, BrowserWindow, ipcMain, Tray} = require('electron');
app.setName('Standard Notes');

const path = require('path')
const windowStateKeeper = require('electron-window-state')
const shell = require('electron').shell;
const log = require('electron-log');
const Store = require('./javascripts/main/store.js');

import menuManager from './javascripts/main/menuManager.js'
import archiveManager from './javascripts/main/archiveManager.js';
import packageManager from './javascripts/main/packageManager.js';
import searchManager from './javascripts/main/searchManager.js';
import updateManager from './javascripts/main/updateManager.js';
import zoomManager from './javascripts/main/zoomManager.js';

ipcMain.on('initial-data-loaded', () => {
  archiveManager.beginBackups();
});

ipcMain.on('major-data-change', () => {
  archiveManager.performBackup();
})

process.on('uncaughtException', function (err) {
  console.log(err);
})

log.transports.file.level = 'info';

let darwin = process.platform === 'darwin'
let win, tray, trayContextMenu, willQuitApp = false;

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (!darwin) {
    app.quit()
  }
})

function createWindow () {

  // Load the previous state with fallback to defaults
  let winState = windowStateKeeper({
    defaultWidth: 1100,
    defaultHeight: 800
  })

  let iconLocation = path.join(__dirname, '/icon/Icon-512x512.png');

  // Defaults to false in store.js
  let useSystemMenuBar = Store.instance().get("useSystemMenuBar");

  // Create the window using the state information
  win = new BrowserWindow({
    'x': winState.x,
    'y': winState.y,
    'width': winState.width,
    'height': winState.height,
    'minWidth': 300,
    'minHeight': 400,
    show: false,
    icon: iconLocation,

    // We want hiddenInset on Mac. On Windows/Linux, doesn't seem to have an effect, but we'll default to it's original value before themed title bar changes were put in place.
    titleBarStyle: darwin || useSystemMenuBar ? 'hiddenInset' : null,

    // Will apply  to Windows and Linux only, since titleBarStyle takes precendence for mac. But we'll explicitely specifiy false for mac to be on the safe side
    frame: darwin ? false : useSystemMenuBar
  })

  searchManager.setWindow(win);
  archiveManager.setWindow(win);
  packageManager.setWindow(win);
  updateManager.setWindow(win);
  zoomManager.setWindow(win);

  // Register listeners on the window, so we can update the state
  // automatically (the listeners will be removed when the window
  // is closed) and restore the maximized or full screen state
  winState.manage(win)
  // win.webContents.openDevTools()

  win.on('closed', (event) => {
    win = null
  })

  win.on('blur', (event) => {
    win.webContents.send("window-blurred", null);
    archiveManager.applicationDidBlur();
  })

  win.on('hide', (event) => {
    tray.updateContextMenu();
  })

  win.on('focus', (event) => {
    win.webContents.send("window-focused", null);
    tray.updateContextMenu();
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  win.on('close', (e) => {
    if (willQuitApp) {
      /* the user tried to quit the app */
      win = null;
    } else {
      /* the user only tried to close the window */
      e.preventDefault();

      // Fixes Mac full screen issue where pressing close results in a black screen.
      if(win.isFullScreen()) {
        win.setFullScreen(false);
      }
      win.hide();
    }
  })

  let url = 'file://' + __dirname + '/index.html';
  if ('APP_RELATIVE_PATH' in process.env) {
    url = 'file://' + __dirname + '/' + process.env.APP_RELATIVE_PATH;
  }
  win.loadURL(url);

  // handle link clicks
  win.webContents.on('new-window', function(e, url) {
    if(!url.includes("file://")) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // handle link clicks (this event is fired instead of
  // 'new-window' when target is not set to _blank)
  win.webContents.on('will-navigate', function(e, url) {
    if(!url.includes("file://")) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

function createTrayIcon (mainWindow) {
  const icon = path.join(__dirname, `/icon/Icon-256x256.png`);

  tray = new Tray(icon);

  tray.toggleWindowVisibility = (show) => {
    if (mainWindow) {
      if (!show) {
        mainWindow.hide();
      } else {
        mainWindow.show();

        // On some versions of GNOME the window may not be on top when restored.
        mainWindow.setAlwaysOnTop(true);
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(false);
      }
    }
  };

  tray.updateContextMenu = () => {
    if (mainWindow.isVisible()) {
      trayContextMenu.items[0].visible = false;
      trayContextMenu.items[1].visible = true;
    } else {
      trayContextMenu.items[0].visible = true;
      trayContextMenu.items[1].visible = false;
    }

    tray.setContextMenu(trayContextMenu);
  };

  trayContextMenu = Menu.buildFromTemplate([{
    id: 'ShowWindow',
    label: 'Show',
    click: tray.toggleWindowVisibility.bind(this, true),
  }, {
    id: 'HideWindow',
    label: 'Hide',
    click: tray.toggleWindowVisibility.bind(this, false),
  },
  {
    type: 'separator'
  },
  {
    id: 'quit',
    label: 'Quit',
    click: app.quit.bind(app),
  }]);

  tray.setToolTip('Standard Notes');
  tray.setContextMenu(trayContextMenu);

  tray.on('click', () => {
    tray.popUpContextMenu();
  });

  return tray;
}

app.on('before-quit', () => willQuitApp = true);

app.on('activate', function() {

	if (!win) {
    createWindow();
	} else {
    win.show();
  }

  updateManager.checkForUpdate();
});

// feature flag: https://github.com/electron/electron/blob/master/docs/api/breaking-changes.md#appmakesingleinstance
const hasRequestSingleInstanceLock = app.requestSingleInstanceLock ? true : false;
let isSecondInstance = null;

// Someone tried to run a second instance, we should focus our window.
const handleSecondInstance = (argv, cwd) => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
}

if (hasRequestSingleInstanceLock) {
  isSecondInstance = !app.requestSingleInstanceLock()

  app.on('second-instance', (event, argv, cwd) => {
    handleSecondInstance(argv, cwd)
  })
} else {
  isSecondInstance = app.makeSingleInstance((argv, cwd) => {
    handleSecondInstance(argv, cwd)
  })
}

app.on('ready', function(){

  if (isSecondInstance) {
    console.warn("Quiting app and focusing existing instance.");
    app.quit()
  } else {
    if(!win) {
      createWindow();
    } else {
      win.focus();
    }

    menuManager.loadMenu(win, archiveManager, updateManager);
    updateManager.onNeedMenuReload = () => {
      menuManager.reload();
    }
  }

  if (process.platform === 'win32' || process.platform === 'linux') {
    createTrayIcon(win);
  }
})

ipcMain.on("display-app-menu", (event, position) => {
  menuManager.popupMenu(position);
});
