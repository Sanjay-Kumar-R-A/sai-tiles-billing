const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel) {
  return async (...args) => {
    const response = await ipcRenderer.invoke(channel, ...args);
    if (!response || response.ok !== true) {
      throw new Error(response?.error || 'The request could not be completed.');
    }
    return response.data;
  };
}

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('tiledesk', {
  settings: {
    get: invoke('settings:get'),
    update: invoke('settings:update'),
    categories: invoke('categories:list')
  },
  products: {
    list: invoke('products:list'),
    get: invoke('products:get'),
    create: invoke('products:create'),
    update: invoke('products:update'),
    setActive: invoke('products:setActive'),
    adjustStock: invoke('products:adjustStock')
  },
  catalogue: {
    extract: invoke('catalogue:extract'),
    import: invoke('catalogue:import')
  },
  customers: {
    list: invoke('customers:list'),
    get: invoke('customers:get'),
    create: invoke('customers:create'),
    update: invoke('customers:update'),
    setActive: invoke('customers:setActive')
  },
  invoices: {
    list: invoke('invoices:list'),
    get: invoke('invoices:get'),
    create: invoke('invoices:create'),
    void: invoke('invoices:void'),
    deleteInvoice: invoke('invoices:delete'),
    addPayment: invoke('invoices:addPayment'),
    deletePayment: invoke('invoices:deletePayment')
  },
  stock: {
    list: invoke('stock:list'),
    create: invoke('stock:create')
  },
  dashboard: {
    get: invoke('dashboard:get')
  },
  reports: {
    sales: invoke('reports:sales'),
    gst: invoke('reports:gst'),
    outstanding: invoke('reports:outstanding'),
    stock: invoke('reports:stock')
  },
  app: {
    info: invoke('app:info'),
    backup: invoke('app:backup'),
    saveCsv: invoke('app:saveCsv'),
    savePdf: invoke('app:savePdf'),
    printPage: invoke('app:printPage'),
    openDataFolder: invoke('app:openDataFolder'),
    onNavigate: (callback) => subscribe('navigate', callback),
    onCommand: (callback) => subscribe('command', callback)
  }
});
