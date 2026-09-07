export function hasBannerMessage(message) {
  return typeof message === 'string' && message.trim().length > 0;
}

export function renderBannerVisibility(element, message) {
  const visible = hasBannerMessage(message);
  element.hidden = !visible;
  if (!visible) element.textContent = '';
  return visible;
}
