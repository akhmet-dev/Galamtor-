// Shared menu actions also power the native menus and command palette.
(function setupBrowserControls() {
  const trigger = document.getElementById('btn-browser-menu');
  if (!trigger) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'browser-menu-backdrop';
  backdrop.hidden = true;
  const menu = document.createElement('div');
  menu.id = 'browser-menu';
  menu.className = 'browser-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Браузер мәзірі');
  menu.hidden = true;
  document.body.append(backdrop, menu);
  let contextTabId = null;
  let previousFocus = null;
  let version = '';
  let checkingUpdate = false;

  const commands = [
    ['new-tab', 'Жаңа қойынды', '⌘T'],
    ['new-incognito-tab', 'Жеке қойынды', '⇧⌘N'],
    ['reopen-tab', 'Жабылған қойындыны қайта ашу', '⇧⌘T'],
    null,
    ['find-in-page', 'Беттен іздеу', '⌘F'],
    ['save-page', 'Бетті сақтау', '⌘S'],
    ['print', 'Басып шығару', '⌘P'],
    null,
    ['open-bookmarks', 'Бетбелгілер', '⌘B'],
    ['open-history', 'Тарих', '⌘Y'],
    ['open-downloads', 'Жүктеулер', '⌘J'],
    null,
    ['command-palette', 'Қойындылар мен әрекеттерді іздеу', '⌘K'],
    ['customize-startpage', 'Басты бетті баптау', ''],
    ['open-settings', 'Баптаулар', '⌘,'],
    ['toggle-ai', 'AI көмекшісі', '⌘/'],
    ['check-update', 'Жаңартуларды тексеру', '']
  ];

  const pageActions = new Set(['find-in-page', 'save-page', 'print', 'mute-tab']);
  function isDisabled(action) {
    const hasContextTarget = contextTabId !== null;
    const tab = tabs.find(t => t.id === (hasContextTarget ? contextTabId : activeTabId));
    if (hasContextTarget && !tab) return true;
    if (action === 'reopen-tab') return !recentlyClosedTabs.length;
    if (pageActions.has(action)) return !tab || tab.isHome || tab.loadFailed;
    return false;
  }

  function closeMenu(restoreFocus = true) {
    menu.hidden = true;
    backdrop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
    contextTabId = null;
  }

  function buildMenu(items) {
    menu.replaceChildren();
    items.forEach(item => {
      if (!item) {
        const divider = document.createElement('div'); divider.className = 'browser-menu-divider'; divider.setAttribute('role', 'separator');
        menu.appendChild(divider); return;
      }
      const [action, label, shortcut] = item;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'browser-menu-item';
      button.setAttribute('role', 'menuitem'); button.dataset.action = action; button.disabled = isDisabled(action);
      const name = document.createElement('span'); name.textContent = label;
      const keys = document.createElement('span'); keys.className = 'browser-menu-shortcut'; keys.textContent = shortcut;
      button.append(name, keys);
      button.addEventListener('click', () => {
        const tabId = contextTabId;
        closeMenu();
        dispatchBrowserAction(action, tabId ? { tabId } : undefined);
      });
      menu.appendChild(button);
    });
    if (!contextTabId) {
      const footer = document.createElement('div'); footer.className = 'browser-menu-footer';
      footer.textContent = version ? `Galamtor ${version}` : 'Galamtor · нұсқасы жүктелуде…';
      menu.appendChild(footer);
    }
  }

  function showMenu(x, y, returnFocus = document.activeElement) {
    previousFocus = returnFocus;
    menu.hidden = false; backdrop.hidden = false;
    trigger.setAttribute('aria-expanded', String(!contextTabId));
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
    menu.querySelector('button:not(:disabled)')?.focus();
  }

  trigger.addEventListener('click', () => {
    if (!menu.hidden) { closeMenu(); return; }
    contextTabId = null;
    buildMenu(commands);
    const rect = trigger.getBoundingClientRect();
    showMenu(rect.right - 320, rect.bottom + 8, trigger);
  });
  backdrop.addEventListener('click', () => closeMenu());
  window.addEventListener('resize', () => closeMenu(false));
  menu.addEventListener('keydown', event => {
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      closeMenu();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  });

  window.openTabMenu = (tabId, x, y) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    contextTabId = tabId;
    buildMenu([
      ['duplicate-tab', 'Қойындыны көшіру', ''],
      ['mute-tab', tab.isMuted ? 'Дыбысты қосу' : 'Дыбысты өшіру', ''],
      ['close-tab', 'Қойындыны жабу', '⌘W'],
      null, ['reopen-tab', 'Жабылған қойындыны қайта ашу', '⇧⌘T']
    ]);
    showMenu(x, y, document.querySelector(`.tab[data-tab-id="${tabId}"]`) || document.activeElement);
  };
  window.refreshBrowserMenu = () => {
    if (menu.hidden) return;
    if (contextTabId !== null && !tabs.some(tab => tab.id === contextTabId)) {
      closeMenu(false);
      return;
    }
    menu.querySelectorAll('[data-action]').forEach(button => {
      const action = button.dataset.action;
      button.disabled = isDisabled(action);
      if (action === 'mute-tab') {
        const tab = tabs.find(item => item.id === contextTabId);
        const label = button.firstElementChild;
        if (tab && label) label.textContent = tab.isMuted ? 'Дыбысты қосу' : 'Дыбысты өшіру';
      }
    });
  };
  window.checkBrowserUpdate = async () => {
    if (checkingUpdate) return;
    checkingUpdate = true;
    showToast('Жаңартулар тексерілуде…');
    try {
      const result = await window.galamtorAPI?.checkForUpdate();
      if (result?.manual) checkingUpdate = false;
      if (!result) {
        checkingUpdate = false;
        showToast('Бұл жинақта автожаңарту қолжетімсіз');
      }
    } catch { checkingUpdate = false; showToast('Жаңартуларды тексеру сәтсіз аяқталды'); }
  };
  window.galamtorAPI?.onUpdateNotAvailable?.(() => {
    if (checkingUpdate) showToast('Жаңа нұсқа табылған жоқ');
    checkingUpdate = false;
  });
  window.galamtorAPI?.onUpdateAvailable?.(() => { checkingUpdate = false; });
  window.galamtorAPI?.onUpdateError?.(() => {
    if (checkingUpdate) showToast('Жаңартуларды тексеру сәтсіз аяқталды');
    checkingUpdate = false;
  });
  window.galamtorAPI?.getBrowserInfo?.().then(info => {
    version = typeof info?.version === 'string' ? info.version : '';
    const footer = menu.querySelector('.browser-menu-footer');
    if (footer) footer.textContent = version ? `Galamtor ${version}` : 'Galamtor нұсқасы қолжетімсіз';
  }).catch(() => {
    const footer = menu.querySelector('.browser-menu-footer');
    if (footer) footer.textContent = 'Galamtor нұсқасы қолжетімсіз';
  });
})();
