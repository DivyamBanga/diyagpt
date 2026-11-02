// Runs before the app: refuse to render inside frames (clickjacking) and apply the saved theme without a flash.
(function () {
  if (window.top !== window.self) {
    document.documentElement.style.display = 'none';
    try { window.top.location = window.self.location; } catch (e) {}
    return;
  }
  var theme = 'system';
  try { theme = localStorage.getItem('diyagpt.theme') || 'system'; } catch (e) {}
  var dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
