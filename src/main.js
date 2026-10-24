import { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDatabase } from './db.js';
import { BillingRepository } from './repository.js';
import { extractCatalogueFromPdf } from './ai-catalogue.js';
import { MAX_PDF_BYTES } from '../shared/constants.js';
import { todayISO } from '../shared/format.js';

const APP_NAME = 'SAI TILES';
const LEGACY_APP_NAME = 'TileDesk';
const DB_FILENAME = 'sai-tiles.db';
const LEGACY_DB_FILENAME = 'tiledesk.db';

app.setName(APP_NAME);

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererDir = path.join(rootDir, 'renderer');
const rendererUrl = pathToFileURL(path.join(rendererDir, 'index.html')).href;
const isMac = process.platform === 'darwin';
const isDev = process.env.TILEDESK_DEV === '1';

if (process.env.TILEDESK_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.TILEDESK_DATA_DIR));
}

let mainWindow = null;
let database = null;
let repository = null;
let databasePath = null;
let backupsDir = null;
let sessionAiKey = '';
let aiKeySessionOnly = false;

const AI_KEY_META = 'ai_api_key_encrypted';

const hasLock = app.requestSingleInstanceLock();

if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    initializeApp();
    if (isDev) {
      // Dev-only affordance for local inspection.
      console.log(`${APP_NAME} development mode`);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });

  app.on('before-quit', closeDatabase);
}

function initializeApp() {
  databasePath = process.env.TILEDESK_DB_PATH
    ? path.resolve(process.env.TILEDESK_DB_PATH)
    : path.join(app.getPath('userData'), DB_FILENAME);
  backupsDir = path.join(app.getPath('userData'), 'backups');

  migrateLegacyData();
  database = openDatabase(databasePath, { seed: true });
  repository = new BillingRepository(database);
  upgradeLegacyProfile();

  createAutomaticBackup();
  registerIpcHandlers();
  buildApplicationMenu();
  createMainWindow();
}

function migrateLegacyData() {
  if (process.env.TILEDESK_DATA_DIR || process.env.TILEDESK_DB_PATH) return;
  try {
    const legacyDir = path.join(app.getPath('appData'), LEGACY_APP_NAME);
    const legacyDb = path.join(legacyDir, LEGACY_DB_FILENAME);
    if (fs.existsSync(databasePath) || !fs.existsSync(legacyDb)) return;

    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const source = new DatabaseSync(legacyDb);
    try {
      source.exec('PRAGMA busy_timeout = 5000');
      source.prepare('VACUUM INTO ?').run(databasePath);
    } finally {
      source.close();
    }
    console.log('Copied existing data from the previous showroom data folder.');
  } catch (error) {
    console.error('Could not migrate the previous showroom data folder:', error);
  }
}

function upgradeLegacyProfile() {
  try {
    const settings = repository.getSettings();
    if (settings.profileReviewed) return;

    const patch = {};
    if (settings.showroomName === 'My Tiles Showroom') patch.showroomName = APP_NAME;
    if (settings.addressLine1 === '123, Tile Market Road') patch.addressLine1 = '';
    if (settings.city === 'Chennai') patch.city = '';
    if (settings.pincode === '600001') patch.pincode = '';
    if (settings.jurisdiction === 'Chennai') patch.jurisdiction = '';
    if (settings.footerNote === 'Thank you for choosing us.') {
      patch.footerNote = `Thank you for choosing ${APP_NAME}.`;
    }
    if (Object.keys(patch).length) repository.updateSettings(patch);
  } catch (error) {
    console.error('Could not update the previous showroom profile:', error);
  }
}

function closeDatabase() {
  if (!database) return;
  try {
    if (databasePath !== ':memory:') database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    database.close();
  } catch (error) {
    console.error('Could not close the database cleanly:', error);
  }
  database = null;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    title: APP_NAME,
    backgroundColor: '#f5f1ea',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 18, y: 20 } : undefined,
    webPreferences: {
      preload: path.join(rootDir, 'src', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(rendererDir, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (process.env.TILEDESK_OPEN_DEVTOOLS === '1') mainWindow?.webContents.openDevTools();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(rendererUrl.split('#')[0])) event.preventDefault();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createAutomaticBackup() {
  if (!database || databasePath === ':memory:') return;
  try {
    fs.mkdirSync(backupsDir, { recursive: true });
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const target = path.join(backupsDir, `SAI-TILES-${todayISO()}.db`);
    if (!fs.existsSync(target)) {
      fs.copyFileSync(databasePath, target);
    }

    const backups = fs
      .readdirSync(backupsDir)
      .filter((file) => /^SAI-TILES-\d{4}-\d{2}-\d{2}\.db$/.test(file))
      .map((file) => ({
        file,
        modified: fs.statSync(path.join(backupsDir, file)).mtimeMs
      }))
      .sort((a, b) => b.modified - a.modified);

    for (const backup of backups.slice(30)) {
      fs.rmSync(path.join(backupsDir, backup.file), { force: true });
    }
  } catch (error) {
    console.error('Automatic backup failed:', error);
  }
}

function success(data) {
  return { ok: true, data };
}

function failure(error) {
  return { ok: false, error: error instanceof Error ? error.message : 'Something went wrong.' };
}

function handle(channel, callback) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return success(await callback(...args));
    } catch (error) {
      console.error(`[${channel}]`, error);
      return failure(error);
    }
  });
}

function handleWithEvent(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return success(await callback(event, ...args));
    } catch (error) {
      console.error(`[${channel}]`, error);
      return failure(error);
    }
  });
}

function readAiKey() {
  if (sessionAiKey) return sessionAiKey;
  if (!database || !safeStorage.isEncryptionAvailable()) return '';
  const row = database.prepare('SELECT value FROM meta WHERE key = ?').get(AI_KEY_META);
  if (!row?.value) return '';
  try {
    return safeStorage.decryptString(Buffer.from(row.value, 'base64'));
  } catch {
    return '';
  }
}

function saveAiKey(value) {
  const key = String(value ?? '').trim();
  if (!key) return;
  sessionAiKey = key;
  aiKeySessionOnly = true;
  if (!safeStorage.isEncryptionAvailable()) return;
  try {
    const encrypted = safeStorage.encryptString(key).toString('base64');
    database
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(AI_KEY_META, encrypted);
    aiKeySessionOnly = false;
  } catch (error) {
    console.error('Could not save the AI key in the macOS Keychain:', error);
  }
}

function removeAiKey() {
  sessionAiKey = '';
  aiKeySessionOnly = false;
  database.prepare('DELETE FROM meta WHERE key = ?').run(AI_KEY_META);
}

function withAiStatus(settings) {
  return {
    ...settings,
    aiKeySet: Boolean(readAiKey()),
    aiKeyPersistent: !aiKeySessionOnly && safeStorage.isEncryptionAvailable()
  };
}

function catalogueFileFrom(sourcePath, fileName) {
  const raw = String(sourcePath ?? '').trim();
  if (!raw) throw new Error('Choose a PDF catalogue first.');
  const resolved = path.resolve(raw);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error('The PDF could not be found. Choose it again.');
  }
  if (!stat.isFile()) throw new Error('That is not a PDF file. Choose a catalogue or price list.');
  if (!stat.size) throw new Error('That PDF is empty.');
  if (stat.size > MAX_PDF_BYTES) {
    throw new Error('This PDF is larger than 1 GB. Split the catalogue into smaller files.');
  }

  let header;
  try {
    const handle = fs.openSync(resolved, 'r');
    try {
      const buffer = Buffer.alloc(1024);
      const bytes = fs.readSync(handle, buffer, 0, buffer.length, 0);
      header = buffer.subarray(0, bytes);
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    throw new Error('The PDF could not be opened. Choose it again.');
  }
  if (!header.includes(Buffer.from('%PDF-'))) {
    throw new Error('That file is not a PDF. Choose a PDF catalogue or price list.');
  }

  return {
    path: resolved,
    size: stat.size,
    name: safePdfFileName(fileName || path.basename(resolved))
  };
}

function safePdfFileName(value) {
  return (
    path
      .basename(String(value || 'catalogue.pdf'))
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
      .trim()
      .slice(0, 160) || 'catalogue.pdf'
  );
}

function registerIpcHandlers() {
  handle('settings:get', () => withAiStatus(repository.getSettings()));
  handle('settings:update', (patch = {}) => {
    const { aiApiKey, aiRemoveKey, ...settingsPatch } = patch ?? {};
    const updated = repository.updateSettings(settingsPatch);
    if (aiRemoveKey) removeAiKey();
    if (typeof aiApiKey === 'string' && aiApiKey.trim()) saveAiKey(aiApiKey);
    return withAiStatus(updated);
  });
  handle('categories:list', () => repository.getCategories());

  handleWithEvent('catalogue:extract', async (event, { path: sourcePath, fileName, requestId } = {}) => {
    const file = catalogueFileFrom(sourcePath, fileName);

    const settings = repository.getSettings();
    const apiKey = readAiKey();
    if (!apiKey) throw new Error('Add the AI API key in Settings → AI catalogue first.');

    const progressId = String(requestId ?? '');
    const onProgress = (progress) => {
      if (event.sender.isDestroyed()) return;
      event.sender.send('catalogue:progress', { requestId: progressId, ...progress });
    };

    const extraction = await extractCatalogueFromPdf({
      pdfPath: file.path,
      fileName: file.name,
      apiKey,
      provider: settings.aiProvider,
      model: settings.aiModel,
      baseUrl: settings.aiBaseUrl,
      onProgress
    });
    const items = repository.previewCatalogue(extraction.products);

    return {
      fileName: file.name,
      supplier: extraction.supplier,
      provider: extraction.provider,
      model: extraction.model,
      items,
      warnings: extraction.warnings
    };
  });

  handle('catalogue:import', ({ items, updateDetails, addStock, source } = {}) =>
    repository.importCatalogue(items, { updateDetails, addStock, source })
  );

  handle('products:list', (filters) => repository.listProducts(filters));
  handle('products:get', (id) => repository.getProduct(id));
  handle('products:create', (input) => repository.createProduct(input));
  handle('products:update', (id, input) => repository.updateProduct(id, input));
  handle('products:setActive', (id, active) => repository.setProductActive(id, active));
  handle('products:adjustStock', (id, payload) => repository.adjustStock(id, payload));

  handle('customers:list', (filters) => repository.listCustomers(filters));
  handle('customers:get', (id) => repository.getCustomer(id));
  handle('customers:create', (input) => repository.createCustomer(input));
  handle('customers:update', (id, input) => repository.updateCustomer(id, input));
  handle('customers:setActive', (id, active) => repository.setCustomerActive(id, active));

  handle('invoices:list', (filters) => repository.listInvoices(filters));
  handle('invoices:get', (id) => repository.getInvoice(id));
  handle('invoices:create', (input) => repository.createInvoice(input));
  handle('invoices:void', (id, reason) => repository.voidInvoice(id, reason));
  handle('invoices:delete', (id) => repository.deleteInvoice(id));
  handle('invoices:addPayment', (id, payment) => repository.addPayment(id, payment));
  handle('invoices:deletePayment', (paymentId) => repository.deletePayment(paymentId));

  handle('stock:list', (filters) => repository.listStockMovements(filters));
  handle('stock:create', (input) => repository.createStockIn(input));

  handle('dashboard:get', () => repository.getDashboard());
  handle('reports:sales', (range) => repository.reportSales(range));
  handle('reports:gst', (range) => repository.reportGst(range));
  handle('reports:outstanding', (filters) => repository.reportOutstanding(filters));
  handle('reports:stock', (filters) => repository.reportStock(filters));

  handle('app:info', () => ({
    version: app.getVersion(),
    dbPath: databasePath,
    dataDir: app.getPath('userData'),
    backupsDir,
    platform: process.platform,
    summary: repository.getDatabaseSummary()
  }));

  handle('app:openDataFolder', () => {
    shell.showItemInFolder(databasePath);
    return { opened: true };
  });

  ipcMain.handle('app:backup', async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(window, {
        title: 'Save SAI TILES database backup',
        defaultPath: path.join(app.getPath('documents'), `SAI-TILES-backup-${todayISO()}.db`),
        filters: [{ name: 'SQLite database', extensions: ['db'] }]
      });
      if (result.canceled || !result.filePath) return success({ canceled: true });

      database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(databasePath, result.filePath);
      return success({ canceled: false, path: result.filePath });
    } catch (error) {
      console.error('[app:backup]', error);
      return failure(error);
    }
  });

  ipcMain.handle('app:saveCsv', async (event, { suggestedName, content } = {}) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      const safeName = path
        .basename(String(suggestedName || 'export.csv'))
        .replace(/[\\/:*?"<>|]/g, '-');
      const result = await dialog.showSaveDialog(window, {
        title: 'Export CSV',
        defaultPath: path.join(app.getPath('documents'), safeName.endsWith('.csv') ? safeName : `${safeName}.csv`),
        filters: [{ name: 'CSV file', extensions: ['csv'] }]
      });
      if (result.canceled || !result.filePath) return success({ canceled: true });
      fs.writeFileSync(result.filePath, String(content ?? ''), 'utf8');
      return success({ canceled: false, path: result.filePath });
    } catch (error) {
      console.error('[app:saveCsv]', error);
      return failure(error);
    }
  });

  ipcMain.handle('app:printPage', async (event) => {
    try {
      return await new Promise((resolve) => {
        event.sender.print(
          {
            silent: false,
            printBackground: true,
            pageSize: 'A4',
            margins: { marginType: 'none' }
          },
          (printSuccess, failureReason) => {
            resolve(success({ started: printSuccess, failureReason: failureReason || '' }));
          }
        );
      });
    } catch (error) {
      console.error('[app:printPage]', error);
      return failure(error);
    }
  });

  ipcMain.handle('app:savePdf', async (event, { suggestedName } = {}) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      const safeName = path
        .basename(String(suggestedName || 'invoice.pdf'))
        .replace(/[\\/:*?"<>|]/g, '-');
      const result = await dialog.showSaveDialog(window, {
        title: 'Save invoice as PDF',
        defaultPath: path.join(
          app.getPath('documents'),
          safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`
        ),
        filters: [{ name: 'PDF document', extensions: ['pdf'] }]
      });
      if (result.canceled || !result.filePath) return success({ canceled: true });

      const pdf = await event.sender.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        preferCSSPageSize: true,
        margins: { marginType: 'none' }
      });
      fs.writeFileSync(result.filePath, pdf);
      return success({ canceled: false, path: result.filePath });
    } catch (error) {
      console.error('[app:savePdf]', error);
      return failure(error);
    }
  });
}

function sendNavigation(route) {
  mainWindow?.webContents.send('navigate', route);
}

function sendCommand(command) {
  mainWindow?.webContents.send('command', command);
}

function showAbout() {
  void dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About SAI TILES',
    message: APP_NAME,
    detail: `Billing and inventory for SAI TILES\nVersion ${app.getVersion()}\n\nYour data stays on this Mac.\nDatabase: ${databasePath}`,
    buttons: ['OK']
  });
}

function buildApplicationMenu() {
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { label: 'About SAI TILES', click: showAbout },
              { type: 'separator' },
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: () => sendNavigation('/settings')
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Bill', accelerator: 'CmdOrCtrl+N', click: () => sendNavigation('/billing') },
        {
          label: 'Invoices',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => sendNavigation('/invoices')
        },
        { type: 'separator' },
        {
          label: 'Save Database Backup…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendCommand('backup')
        },
        {
          label: 'Print Invoice',
          accelerator: 'CmdOrCtrl+P',
          click: () => sendCommand('print')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev
          ? [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]
          : [])
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Open Data Folder',
          click: () => {
            if (databasePath) shell.showItemInFolder(databasePath);
          }
        },
        ...(!isMac ? [{ type: 'separator' }, { label: 'About SAI TILES', click: showAbout }] : [])
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
