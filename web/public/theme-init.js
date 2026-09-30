// Applies the saved (or OS) color theme before the app renders, so dark-mode
// users never see a light flash. Loaded as a same-origin script because the
// Content-Security-Policy forbids inline scripts. Keep in sync with src/theme.ts.
;(function () {
  var pref = 'system'
  try {
    pref = localStorage.getItem('fwui-theme') || 'system'
  } catch {
    /* storage blocked: follow the OS */
  }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
})()
