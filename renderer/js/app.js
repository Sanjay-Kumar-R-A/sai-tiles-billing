import { brandMark, icon } from './icons.js';
import { currentPath, navigate } from './router.js';
import { loadStore, refreshCategories, refreshSettings, store } from './store.js';
import { emptyState, escapeHtml, initials, loadingPanel, toast } from './ui.js';
import * as dashboard from './pages/dashboard.js';
import * as billing from './pages/billing.js';
import * as invoices from './pages/invoices.js';
import * as invoiceDetail from './pages/invoice-detail.js';
import * as invoicePrint from './pages/invoice-print.js';
import * as products from './pages/products.js';
import * as catalogueImport from './pages/catalogue-import.js';
import * as customers from './pages/customers.js';
import * as stock from './pages/stock.js';
import * as reports from './pages/reports.js';
import * as settings from './pages/settings.js';

const ROUTES = [
  { pattern: '/dashboard', page: dashboard, label: 'Dashboard', nav: 'dashboard' },
  { pattern: '/billing', page: billing, label: 'New bill', nav: 'billing' },
  { pattern: '/invoices', page: invoices, label: 'Invoices', nav: 'invoices' },
  { pattern: /^\/invoices\/(\d+)\/print$/, page: invoicePrint, label: 'Print invoice', nav: 'invoices', print: true },
  { pattern: /^\/invoices\/(\d+)$/, page: invoiceDetail, label: 'Invoice', nav: 'invoices' },
  { pattern: '/products', page: products, label: 'Products', nav: 'products' },
  { pattern: '/products/import', page: catalogueImport, label: 'Import catalogue', nav: 'products' },
  { pattern: '/customers', page: customers, label: 'Customers', nav: 'customers' },
  { pattern: '/stock', page: stock, label: 'Stock', nav: 'stock' },
  { pattern: '/reports', page: reports, label: 'Reports', nav: 'reports' },
  { pattern: '/settings', page: settings, label: 'Settings', nav: 'settings' }
];

const shell = document.getElementById('app');
const content = () => document.getElementById('content');
let renderToken = 0;
let currentRoute = null;
let currentPathname = '/dashboard';
let activePage = null;

function parseLocation() {
  const raw = currentPath();
  const hashIndex = raw.indexOf('?');
  const pathname = hashIndex === -1 ? raw : raw.slice(0, hashIndex);
  const query = Object.fromEntries(new URLSearchParams(hashIndex === -1 ? '' : raw.slice(hashIndex + 1)));
  return { pathname: pathname || '/dashboard', query };
}

function matchRoute(pathname) {
  for (const route of ROUTES) {
    if (typeof route.pattern === 'string') {
      if (route.pattern === pathname) return { route, params: {} };
      continue;
    }
    const match = route.pattern.exec(pathname);
    if (match) return { route, params: { id: match[1] } };
  }
  return null;
}

function navLink({ href, key, label, iconName }) {
  return `
    <a class="nav-link" href="#${href}" data-nav="${href}" data-nav-key="${key}">
      <span class="nav-icon">${icon(iconName)}</span>
      ${escapeHtml(label)}
    </a>
  `;
}

function shellMarkup() {
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="brand-mark">${brandMark()}</div>
          <div class="brand-copy">
            <span class="brand-name">SAI TILES</span>
            <span class="brand-sub">Tiles billing</span>
          </div>
        </div>

        <button type="button" class="showroom-chip" data-nav="/settings" aria-label="Open showroom settings">
          <div class="showroom-avatar" id="showroom-avatar">ST</div>
          <div class="showroom-copy">
            <div class="showroom-name" id="showroom-name">SAI TILES</div>
            <div class="showroom-meta" id="showroom-meta">Loading…</div>
          </div>
        </button>

        <button type="button" class="new-bill-btn" data-action="new-bill">
          ${icon('plus')}
          <span>New bill</span>
          <kbd>⌘N</kbd>
        </button>

        <nav class="nav-groups" aria-label="Main navigation">
          <div class="nav-group">
            <div class="nav-label">Overview</div>
            ${navLink({ href: '/dashboard', key: 'dashboard', label: 'Dashboard', iconName: 'dashboard' })}
          </div>
          <div class="nav-group">
            <div class="nav-label">Counter</div>
            ${navLink({ href: '/billing', key: 'billing', label: 'New bill', iconName: 'receipt' })}
            ${navLink({ href: '/invoices', key: 'invoices', label: 'Invoices', iconName: 'invoices' })}
          </div>
          <div class="nav-group">
            <div class="nav-label">Catalogue</div>
            ${navLink({ href: '/products', key: 'products', label: 'Products', iconName: 'products' })}
            ${navLink({ href: '/customers', key: 'customers', label: 'Customers', iconName: 'customers' })}
            ${navLink({ href: '/stock', key: 'stock', label: 'Stock', iconName: 'stock' })}
          </div>
          <div class="nav-group">
            <div class="nav-label">Business</div>
            ${navLink({ href: '/reports', key: 'reports', label: 'Reports', iconName: 'reports' })}
          </div>
        </nav>

        <div class="sidebar-spacer"></div>
        <div class="sidebar-foot">
          ${navLink({ href: '/settings', key: 'settings', label: 'Settings', iconName: 'settings' })}
          <div class="privacy-note">
            ${icon('shield')}
            <span>Bills, stock and customer details stay on this Mac.</span>
          </div>
          <div class="sidebar-version" id="sidebar-version">SAI TILES · Local</div>
        </div>
      </aside>
      <main class="main" id="main">
        <div class="main-inner" id="content"></div>
      </main>
    </div>
  `;
}

function updateShell() {
  const settingsData = store.settings ?? {};
  const name = settingsData.showroomName || 'SAI TILES';
  document.getElementById('showroom-name').textContent = name;
  document.getElementById('showroom-avatar').textContent = initials(name) || 'ST';
  const meta = [settingsData.city, settingsData.gstin ? `GSTIN ${settingsData.gstin}` : 'GSTIN not set']
    .filter(Boolean)
    .join(' · ');
  document.getElementById('showroom-meta').textContent = meta || 'Showroom profile';
  document.getElementById('sidebar-version').textContent = `SAI TILES v${store.info?.version ?? '1.0.0'} · Local data`;
}

function updateActiveNav(key) {
  for (const link of document.querySelectorAll('[data-nav-key]')) {
    const active = link.dataset.navKey === key;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function pageLoading() {
  return `<div class="page"><div style="height:66px;"></div>${loadingPanel(6)}</div>`;
}

function pageError(error) {
  return `
    <div class="page">
      <div class="card">
        ${emptyState({
          iconName: 'alert',
          title: 'This page could not load',
          text: error?.message || 'An unexpected error occurred.',
          action: '<button type="button" class="btn btn-primary" data-action="retry-render">Try again</button>'
        })}
      </div>
    </div>
  `;
}

async function renderCurrent() {
  const token = ++renderToken;
  const { pathname, query } = parseLocation();
  const matched = matchRoute(pathname);
  const container = content();
  const main = document.getElementById('main');

  if (!matched) {
    document.title = 'Not found · SAI TILES';
    document.body.classList.remove('print-mode');
    updateActiveNav('');
    container.innerHTML = `<div class="page">
      <div class="card" style="margin-top:40px;">
        ${emptyState({
          iconName: 'search',
          title: 'Page not found',
          text: 'That page does not exist in SAI TILES.',
          action: '<button type="button" class="btn btn-primary" data-nav="/dashboard">Back to dashboard</button>'
        })}
      </div>
    </div>`;
    return;
  }

  const { route, params } = matched;
  if (activePage && typeof activePage.cleanup === 'function') {
    activePage.cleanup();
  }
  activePage = route.page;
  currentRoute = route;
  currentPathname = pathname;
  document.title = `${route.label} · SAI TILES`;
  document.body.classList.toggle('print-mode', Boolean(route.print));
  updateActiveNav(route.nav);
  if (main) main.scrollTop = 0;
  container.innerHTML = pageLoading();

  const ctx = {
    params,
    query,
    pathname,
    settings: store.settings,
    info: store.info,
    rerender: () => renderCurrent(),
    refreshShell: async () => {
      await Promise.all([refreshSettings(), refreshCategories()]);
      updateShell();
      ctx.settings = store.settings;
    }
  };

  try {
    await route.page.render(container, ctx);
    if (token !== renderToken) return;
  } catch (error) {
    if (token !== renderToken) return;
    console.error(error);
    container.innerHTML = pageError(error);
  }
}

function startNewBill() {
  if (currentPath() === '/billing') {
    window.dispatchEvent(new CustomEvent('tiledesk:new-bill'));
    return;
  }
  navigate('/billing');
}

async function backupDatabase() {
  try {
    const result = await window.tiledesk.app.backup();
    if (result?.canceled) return;
    toast('Database backup saved', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function printPage() {
  try {
    const result = await window.tiledesk.app.printPage();
    if (result?.started === false && result?.failureReason) {
      toast(result.failureReason, 'error');
    }
  } catch (error) {
    toast(error.message, 'error');
  }
}

function handlePrintCommand() {
  const { pathname } = parseLocation();
  if (/^\/invoices\/\d+\/print$/.test(pathname)) {
    void printPage();
    return;
  }
  const detail = /^\/invoices\/(\d+)$/.exec(pathname);
  if (detail) {
    navigate(`/invoices/${detail[1]}/print?auto=print`);
    return;
  }
  toast('Open an invoice first, then print it.', 'info');
}

function bindGlobalEvents() {
  document.addEventListener('click', (event) => {
    const newBill = event.target.closest('[data-action="new-bill"]');
    if (newBill) {
      event.preventDefault();
      startNewBill();
      return;
    }

    const retry = event.target.closest('[data-action="retry-render"]');
    if (retry) {
      event.preventDefault();
      renderCurrent();
      return;
    }

    const nav = event.target.closest('[data-nav]');
    if (nav) {
      event.preventDefault();
      navigate(nav.dataset.nav);
      return;
    }

    const row = event.target.closest('[data-row-href]');
    if (row && !event.target.closest('button, a, input, select, textarea, label')) {
      navigate(row.dataset.rowHref);
    }
  });

  window.addEventListener('hashchange', () => renderCurrent());
  window.addEventListener('tiledesk:rerender', () => renderCurrent());

  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === ',') {
      event.preventDefault();
      navigate('/settings');
    }
  });

  window.tiledesk.app.onNavigate?.((route) => {
    if (route === '/billing') {
      startNewBill();
      return;
    }
    navigate(route);
  });

  window.tiledesk.app.onCommand?.((command) => {
    if (command === 'backup') void backupDatabase();
    if (command === 'print') handlePrintCommand();
  });
}

async function boot() {
  try {
    await loadStore();
    shell.className = '';
    shell.innerHTML = shellMarkup();
    updateShell();
    bindGlobalEvents();
    if (!window.location.hash) {
      window.location.hash = '#/dashboard';
    }
    await renderCurrent();
  } catch (error) {
    console.error(error);
    shell.className = 'boot-screen';
    shell.innerHTML = `
      <div class="boot-mark">${brandMark()}</div>
      <div class="boot-text">SAI TILES could not start</div>
      <p class="muted" style="max-width:420px;text-align:center;font-size:12px;line-height:1.6;">
        ${escapeHtml(error.message || 'An unexpected error occurred.')}
      </p>
      <button type="button" class="btn btn-primary" data-boot-retry>Try again</button>
    `;
    shell.querySelector('[data-boot-retry]')?.addEventListener('click', () => window.location.reload());
  }
}

boot();
