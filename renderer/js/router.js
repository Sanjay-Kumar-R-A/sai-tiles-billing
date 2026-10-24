export function currentPath() {
  const hash = window.location.hash.replace(/^#/, '');
  return hash || '/dashboard';
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (window.location.hash === target) {
    window.dispatchEvent(new CustomEvent('tiledesk:rerender'));
    return;
  }
  if (replace) {
    window.location.replace(target);
  } else {
    window.location.hash = target;
  }
}

export function navigateToInvoice(id) {
  navigate(`/invoices/${Number(id)}`);
}

export function refreshRoute() {
  window.dispatchEvent(new CustomEvent('tiledesk:rerender'));
}
