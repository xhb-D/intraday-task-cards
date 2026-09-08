(function () {
  try {
    var preference = localStorage.getItem('trading-risk-manager:appearance');
    if (preference === 'light' || preference === 'dark') {
      document.documentElement.setAttribute('data-theme', preference);
    }
  } catch (_) {
    // Storage unavailable: keep system appearance.
  }
})();
