(function attachWelcomeUtils(root) {
  'use strict';

  function getKazakhGreeting(value = new Date()) {
    const hour = typeof value === 'number' ? value : value?.getHours?.();
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return 'Қайырлы күн!';
    if (hour >= 5 && hour < 11) return 'Қайырлы таң!';
    if (hour >= 11 && hour < 17) return 'Қайырлы күн!';
    if (hour >= 17 && hour < 22) return 'Қайырлы кеш!';
    return 'Қайырлы түн!';
  }

  const api = Object.freeze({ getKazakhGreeting });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GalamtorWelcomeUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
