export const ROUTES = Object.freeze({ home: '#/home', risk: '#/risk' });

export function parseRoute(hash) {
  return hash === ROUTES.risk ? 'risk' : hash === '' || hash === '#' || hash === ROUTES.home ? 'home' : 'unknown';
}

export function normalizeRoute(hash) {
  return hash === '' || hash === '#' ? ROUTES.home : hash;
}

export function applyRoute(root, hash = globalThis.location?.hash || '') {
  const route = parseRoute(hash);
  const active = route === 'unknown' ? 'error' : route;
  root?.querySelectorAll?.('[data-route-view]').forEach(view => { view.hidden = view.dataset.routeView !== active; });
  root?.querySelectorAll?.('[data-route-link]').forEach(link => {
    const selected = link.dataset.routeLink === active;
    link.setAttribute('aria-current', selected ? 'page' : 'false');
  });
  if (route === 'unknown') {
    const message = root?.querySelector?.('[data-route-error]');
    if (message) message.textContent = `无法打开地址「${hash || '空地址'}」。数据仍保留在当前页面。`;
    const heading = root?.querySelector?.('[data-route-error-heading]');
    heading?.focus?.();
  }
  if (globalThis.document) document.title = active === 'risk' ? 'Trading Risk Manager · 统一交易控制中心' : active === 'error' ? '找不到页面 · 统一交易控制中心' : '日内交易状态卡 · 统一交易控制中心';
  return { route: active, unknown: route === 'unknown' };
}
