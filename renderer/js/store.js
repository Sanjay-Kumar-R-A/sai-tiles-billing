export const store = {
  settings: null,
  categories: [],
  info: null
};

export async function loadStore() {
  const [settings, categories, info] = await Promise.all([
    window.tiledesk.settings.get(),
    window.tiledesk.settings.categories(),
    window.tiledesk.app.info()
  ]);
  store.settings = settings;
  store.categories = categories;
  store.info = info;
  return store;
}

export async function refreshSettings() {
  store.settings = await window.tiledesk.settings.get();
  return store.settings;
}

export async function refreshCategories() {
  store.categories = await window.tiledesk.settings.categories();
  return store.categories;
}

export async function refreshInfo() {
  store.info = await window.tiledesk.app.info();
  return store.info;
}
