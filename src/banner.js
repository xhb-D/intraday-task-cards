export function hasBannerMessage(message) {
  return typeof message === 'string' && message.trim().length > 0;
}

export function renderBannerVisibility(element, message) {
  const visible = hasBannerMessage(message);
  element.hidden = !visible;
  return visible;
}

// Visibility is safe for both text-only and structured banners: it never owns child content.
export function renderTextBanner(element, message) {
  const visible = renderBannerVisibility(element, message);
  element.textContent = visible ? message : '';
  return visible;
}
