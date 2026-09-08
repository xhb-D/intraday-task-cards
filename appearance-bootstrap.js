(function () {
  try {
    var preference;
    var canonical = localStorage.getItem('trading-control-center:v1');
    if (canonical !== null) {
      try {
        var parsed = JSON.parse(canonical);
        var canonicalPreference = parsed && parsed.preferences && parsed.preferences.appearance;
        if (canonicalPreference === 'system' || canonicalPreference === 'light' || canonicalPreference === 'dark') preference = canonicalPreference;
      } catch (_) {
        // A damaged canonical record may fall back to the legacy appearance key.
      }
    }
    if (preference === undefined) preference = localStorage.getItem('trading-risk-manager:appearance');
    if (preference === 'light' || preference === 'dark') {
      document.documentElement.setAttribute('data-theme', preference);
    } else if (preference === 'system') {
      document.documentElement.removeAttribute('data-theme');
    }
  } catch (_) {
    // Storage unavailable: keep system appearance.
  }
})();
