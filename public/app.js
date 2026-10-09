/* ═══════════════════════════════════════════════════════════════════════
   GALAMTOR LIVE INTERACTIVE ENGINE (2026 Linear / Raycast / Arc Standards)
   - Dynamic Mouse Spotlight Shaders
   - Live Token-by-Token Gemini AI Streaming Simulator
   - Raycast Command Palette (⌘K) Keyboard Engine
   - Interactive Performance Benchmark Slider
   - Real-time Omnibox & Tab Switching
   - Multi-platform Package Switcher & Multilingual Localization
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── 1. Localization Dictionary ─────────────────────────────────────────────
  const I18N = {
    kk: {
      badge: "🇰🇿 Қазақстанның жаңа буын веб-браузері • v1.0.0",
      heroTitle: "Ғаламторды өзгеше таныңыз. <span class=\"text-radiant\">Жылдам. Қауіпсіз. Ұлттық.</span>",
      heroSubtitle: "Қазақстанның алғашқы интеллектуалды браузері. Кіріктірілген Gemini 2.5 Flash жасанды интеллекті, Kaspi және eGov қызметтеріне жедел қолжетімділік және мызғымас AdBlock Shield қорғанысы.",
      dlBtnMac: "macOS үшін жүктеу (Apple Silicon M1-M4)",
      dlFor: "жүктеу",
      copied: "Көшірілді!",
      cmdKPlaceholder: "Команда жазыңыз немесе іздеңіз...",
      aiInitialMsg: "🤖 Сәлем! Мен Galamtor AI көмекшісімін (Gemini 2.5 Flash). Бетті түйіндеп берейін бе, әлде қазақшаға аударайын ба?",
      aiSummarizeDemo: "📄 **Бет түйіндемесі**:\n1. Қазақстанның қаржылық және мемлекеттік экожүйесі толық интеграцияланған.\n2. Трафикті 40% үнемдейтін нативті AdBlock қорғанысы қосылған.\n3. Барлық деректер жергілікті түрде шифрланады.",
      aiTranslateDemo: "🌐 **Қазақша аударма**:\n«Galamtor — болашақтың ұлттық браузері, сіздің жеке құпиялылығыңыз бен уақытыңызды үнемдейді.»",
      aiCodeDemo: "💻 **Код үлгісі**:\n```bash\n# Galamtor-ды 1-командамен орнату\ncurl -sSL https://galamtor.web.app/install.sh | bash\n```",
      benchStartup: "Жүктелу уақыты",
      benchRam: "Жад тұтынуы (RAM)",
      benchBattery: "Батарея үнемдеуі"
    },
    ru: {
      badge: "🇰🇿 Казахстанский веб-браузер нового поколения • v1.0.0",
      heroTitle: "Взгляните на интернет по-новому. <span class=\"text-radiant\">Быстрый. Безопасный. Родной.</span>",
      heroSubtitle: "Первый интеллектуальный браузер Казахстана. Встроенный ИИ Gemini 2.5 Flash, мгновенный доступ к Kaspi и eGov, а также встроенная блокировка рекламы и трекеров.",
      dlBtnMac: "Скачать для macOS (Apple Silicon M1-M4)",
      dlFor: "Скачать для",
      copied: "Скопировано!",
      cmdKPlaceholder: "Введите команду или поиск...",
      aiInitialMsg: "🤖 Привет! Я ассистент Galamtor AI на базе Gemini 2.5. Чем могу помочь?",
      aiSummarizeDemo: "📄 **Краткое резюме страницы**:\n1. Интеграция ключевых сервисов Казахстана (Kaspi, eGov).\n2. Блокировка 100% рекламы и экономия до 40% трафика.\n3. Сквозное шифрование всех пользовательских данных.",
      aiTranslateDemo: "🌐 **Мгновенный перевод**:\n«Galamtor — национальный браузер нового поколения, созданный для вашей приватности и максимальной скорости.»",
      aiCodeDemo: "💻 **Установка в терминале**:\n```bash\ncurl -sSL https://galamtor.web.app/install.sh | bash\n```",
      benchStartup: "Время запуска",
      benchRam: "Потребление памяти (RAM)",
      benchBattery: "Энергоэффективность"
    },
    en: {
      badge: "🇰🇿 Next-Gen National Web Browser of Kazakhstan • v1.0.0",
      heroTitle: "Experience the web like never before. <span class=\"text-radiant\">Fast. Secure. Native.</span>",
      heroSubtitle: "The first intelligent browser built with Gemini 2.5 Flash AI, seamless integration with national services, and built-in AdBlock & Privacy Shield.",
      dlBtnMac: "Download for macOS (Apple Silicon M1-M4)",
      dlFor: "Download for",
      copied: "Copied!",
      cmdKPlaceholder: "Type a command or search...",
      aiInitialMsg: "🤖 Hello! I am Galamtor AI powered by Gemini 2.5 Flash. How may I assist you?",
      aiSummarizeDemo: "📄 **Page Summary**:\n1. Full integration with Kazakhstan's digital ecosystem (Kaspi, eGov).\n2. Native AdBlock saving up to 40% bandwidth.\n3. Zero telemetry and local encryption.",
      aiTranslateDemo: "🌐 **Instant Translation**:\n'Galamtor is a next-gen browser engineered for privacy, intelligence, and blazing performance.'",
      aiCodeDemo: "💻 **1-Line Terminal Install**:\n```bash\ncurl -sSL https://galamtor.web.app/install.sh | bash\n```",
      benchStartup: "Startup Latency",
      benchRam: "Memory Footprint (RAM)",
      benchBattery: "Battery Efficiency"
    }
  };

  let activeLang = 'kk';

  // ── 2. OS Detector ─────────────────────────────────────────────────────────
  function getSystemInfo() {
    const ua = navigator.userAgent.toLowerCase();
    const plat = navigator.platform?.toLowerCase() || '';
    if (plat.includes('mac') || ua.includes('macintosh') || ua.includes('mac os')) {
      const isArm = (navigator.userAgentData?.architecture === 'arm') || (navigator.maxTouchPoints > 2) || ua.includes('arm');
      return {
        os: 'mac',
        label: isArm ? 'macOS (Apple Silicon M1-M4)' : 'macOS (Intel x64)',
        file: isArm ? 'Galamtor-1.0.0-arm64.dmg' : 'Galamtor-1.0.0-x64.dmg',
        size: '102 MB'
      };
    } else if (plat.includes('win') || ua.includes('windows')) {
      return {
        os: 'windows',
        label: 'Windows 10 / 11 (64-bit)',
        file: 'Galamtor-Setup-1.0.0.exe',
        size: '98 MB'
      };
    }
    return {
      os: 'linux',
      label: 'Linux (Debian / Ubuntu)',
      file: 'galamtor_1.0.0_amd64.deb',
      size: '94 MB'
    };
  }

  // ── 3. Dynamic Mouse Spotlight Shaders ──────────────────────────────────────
  function initSpotlightShaders() {
    const cards = document.querySelectorAll('.spotlight-card, .bench-visualizer, .sim-outer-frame');
    document.addEventListener('mousemove', (e) => {
      cards.forEach((card) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        card.style.setProperty('--mouse-x', `${x}px`);
        card.style.setProperty('--mouse-y', `${y}px`);
      });
    });
  }

  // ── 4. Live Streaming Typewriter AI Simulator ──────────────────────────────
  let isTyping = false;

  function streamAiText(targetElement, fullText, speed = 18, onComplete) {
    if (isTyping) return;
    isTyping = true;
    targetElement.innerHTML = '';
    
    let i = 0;
    const formatted = fullText.replace(/\n/g, '<br>');
    const cursor = document.createElement('span');
    cursor.className = 'pulse-beacon';
    cursor.style.display = 'inline-block';
    cursor.style.marginLeft = '4px';
    targetElement.appendChild(cursor);

    function step() {
      if (i < formatted.length) {
        if (formatted.slice(i, i + 4) === '<br>') {
          targetElement.insertBefore(document.createElement('br'), cursor);
          i += 4;
        } else {
          const char = document.createTextNode(formatted[i]);
          targetElement.insertBefore(char, cursor);
          i++;
        }
        setTimeout(step, speed);
      } else {
        cursor.remove();
        isTyping = false;
        if (onComplete) onComplete();
      }
    }
    step();
  }

  function setupAiCopilot() {
    const body = document.getElementById('copilot-stream-body');
    const input = document.getElementById('copilot-input-box');
    const form = document.getElementById('copilot-form');
    const toggleBtn = document.getElementById('btn-toggle-ai-copilot');
    const panel = document.getElementById('sim-ai-copilot');
    const closeBtn = document.getElementById('btn-close-copilot');

    if (toggleBtn && panel) {
      toggleBtn.addEventListener('click', () => panel.classList.toggle('hidden'));
    }
    if (closeBtn && panel) {
      closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
    }

    function appendUserBubble(text) {
      const b = document.createElement('div');
      b.className = 'ai-bubble user';
      b.innerText = text;
      body?.appendChild(b);
      if (body) body.scrollTop = body.scrollHeight;
    }

    function streamBotReply(promptType, customQuery = '') {
      const dict = I18N[activeLang];
      let text = dict.aiInitialMsg;
      if (promptType === 'summary') text = dict.aiSummarizeDemo;
      else if (promptType === 'translate') text = dict.aiTranslateDemo;
      else if (promptType === 'code') text = dict.aiCodeDemo;
      else if (customQuery) {
        text = `🤖 Galamtor AI: "${customQuery}" сұрауыңыз бойынша деректер өңделді. Gemini 2.5 моделі қазақ тілінде жылдам әрі дәл жауап берді.`;
      }

      const botBubble = document.createElement('div');
      botBubble.className = 'ai-bubble bot';
      body?.appendChild(botBubble);

      // Add voice wave visualizer
      const voiceEq = document.createElement('div');
      voiceEq.className = 'voice-equalizer-bar';
      voiceEq.innerHTML = `
        <span class="eq-stick"></span>
        <span class="eq-stick"></span>
        <span class="eq-stick"></span>
        <span class="eq-stick"></span>
        <span class="eq-stick"></span>
        <span style="font-size: 0.72rem; color: var(--cyan-primary); margin-left: 6px; font-weight: 600;">TTS Дыбысталуда</span>
      `;
      botBubble.appendChild(voiceEq);

      const contentBox = document.createElement('div');
      contentBox.style.marginTop = '8px';
      botBubble.appendChild(contentBox);

      streamAiText(contentBox, text, 15, () => {
        if (body) body.scrollTop = body.scrollHeight;
      });
    }

    document.querySelectorAll('.copilot-action-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const action = pill.dataset.action;
        appendUserBubble(pill.innerText);
        streamBotReply(action);
      });
    });

    if (form && input) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = input.value.trim();
        if (!val) return;
        appendUserBubble(val);
        input.value = '';
        streamBotReply('custom', val);
      });
    }
  }

  // ── 5. Terminal CLI Package Switcher ─────────────────────────────────────────
  const PKG_COMMANDS = {
    curl: "curl -sSL https://galamtor.web.app/install.sh | bash",
    brew: "brew install --cask galamtor",
    winget: "winget install Galamtor.Browser",
    pacman: "yay -S galamtor-bin",
    apt: "sudo apt-get install galamtor"
  };

  function initPackageSwitcher() {
    const tabs = document.querySelectorAll('.pkg-tab-btn');
    const cmdEl = document.getElementById('cli-active-cmd');
    const copyBtn = document.getElementById('btn-copy-cli');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const pkg = tab.dataset.pkg;
        if (cmdEl && PKG_COMMANDS[pkg]) {
          cmdEl.innerText = PKG_COMMANDS[pkg];
        }
      });
    });

    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const text = cmdEl?.innerText || PKG_COMMANDS.curl;
        navigator.clipboard.writeText(text).then(() => {
          const orig = copyBtn.innerHTML;
          copyBtn.innerHTML = `✓ ${I18N[activeLang].copied}`;
          setTimeout(() => { copyBtn.innerHTML = orig; }, 2000);
        });
      });
    }
  }

  // ── 6. Live Interactive Benchmark Slider ────────────────────────────────────
  const BENCH_METRICS = {
    speed: {
      title: "Жүктелу уақыты (Милисекунд — төмен болған сайын жақсы)",
      galamtor: { val: "118 ms", width: "18%" },
      chrome: { val: "840 ms", width: "88%" },
      arc: { val: "720 ms", width: "75%" }
    },
    ram: {
      title: "Жад көлемі (RAM тұтынуы — аз болған сайын жеңіл)",
      galamtor: { val: "185 MB", width: "22%" },
      chrome: { val: "940 MB", width: "95%" },
      arc: { val: "780 MB", width: "80%" }
    },
    battery: {
      title: "Батарея үнемдеуі (1 сағаттық жұмыстағы энергия тиімділігі)",
      galamtor: { val: "+4.2 сағат", width: "95%" },
      chrome: { val: "Базалық", width: "40%" },
      arc: { val: "+1.1 сағат", width: "55%" }
    }
  };

  function initBenchmark() {
    const tabs = document.querySelectorAll('.bench-metric-tab');
    const titleEl = document.getElementById('bench-metric-title');
    const barGalamtor = document.getElementById('bar-galamtor');
    const barChrome = document.getElementById('bar-chrome');
    const barArc = document.getElementById('bar-arc');
    const valGalamtor = document.getElementById('val-galamtor');
    const valChrome = document.getElementById('val-chrome');
    const valArc = document.getElementById('val-arc');

    function applyMetric(type) {
      const data = BENCH_METRICS[type] || BENCH_METRICS.speed;
      if (titleEl) titleEl.innerText = data.title;
      if (barGalamtor) barGalamtor.style.width = data.galamtor.width;
      if (barChrome) barChrome.style.width = data.chrome.width;
      if (barArc) barArc.style.width = data.arc.width;
      if (valGalamtor) valGalamtor.innerText = data.galamtor.val;
      if (valChrome) valChrome.innerText = data.chrome.val;
      if (valArc) valArc.innerText = data.arc.val;
    }

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        applyMetric(tab.dataset.metric);
      });
    });

    applyMetric('speed');
  }

  // ── 7. Raycast Command Palette (⌘K) ────────────────────────────────────────
  function initCommandPalette() {
    const backdrop = document.getElementById('cmd-palette');
    const input = document.getElementById('palette-search-input');
    const triggers = document.querySelectorAll('.cmd-k-trigger');
    const items = document.querySelectorAll('.palette-item');

    function openPalette() {
      backdrop?.classList.add('active');
      input?.focus();
    }

    function closePalette() {
      backdrop?.classList.remove('active');
      if (input) input.value = '';
    }

    triggers.forEach(b => b.addEventListener('click', openPalette));

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        backdrop?.classList.contains('active') ? closePalette() : openPalette();
      }
      if (e.key === 'Escape' && backdrop?.classList.contains('active')) {
        closePalette();
      }
    });

    backdrop?.addEventListener('click', (e) => {
      if (e.target === backdrop) closePalette();
    });

    items.forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        closePalette();
        if (action === 'download') {
          document.querySelector('#download')?.scrollIntoView({ behavior: 'smooth' });
        } else if (action === 'simulator') {
          document.querySelector('#showcase')?.scrollIntoView({ behavior: 'smooth' });
        } else if (action === 'lang-kk') setLanguage('kk');
        else if (action === 'lang-ru') setLanguage('ru');
        else if (action === 'lang-en') setLanguage('en');
      });
    });
  }

  // ── 8. Browser Simulator Live Stage & Tabs ──────────────────────────────────
  function initSimulatorStage() {
    const tabs = document.querySelectorAll('.sim-browser-tab');
    const screens = document.querySelectorAll('.sim-view-screen');
    const omnibox = document.getElementById('sim-omnibox-input');
    const dockButtons = document.querySelectorAll('.dock-badge-item[data-screen]');

    function switchSimScreen(screenId, urlString, tabIndex) {
      screens.forEach(s => s.classList.remove('active'));
      tabs.forEach(t => t.classList.remove('active'));

      const targetScreen = document.getElementById(screenId);
      if (targetScreen) targetScreen.classList.add('active');

      if (tabs[tabIndex]) tabs[tabIndex].classList.add('active');
      if (omnibox) omnibox.value = urlString;
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        const screenId = tab.dataset.screen;
        const url = tab.dataset.url || 'galamtor://home';
        switchSimScreen(screenId, url, index);
      });
    });

    dockButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        dockButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const screenId = btn.dataset.screen;
        const url = btn.dataset.url;
        switchSimScreen(screenId, url, 1);
      });
    });

    document.querySelectorAll('.sim-svc-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        const url = tile.dataset.url;
        if (url.includes('kaspi')) switchSimScreen('screen-kaspi', 'https://kaspi.kz', 1);
        else if (url.includes('egov')) switchSimScreen('screen-egov', 'https://egov.kz', 1);
        else if (url.includes('youtube')) switchSimScreen('screen-youtube', 'https://youtube.com', 1);
      });
    });

    // Digital Clock
    function updateClock() {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const clockEl = document.getElementById('sim-clock-digital');
      if (clockEl) clockEl.innerText = `${h}:${m}`;

      const dateEl = document.getElementById('sim-date-str');
      if (dateEl) {
        const opt = { day: 'numeric', month: 'long', weekday: 'short' };
        dateEl.innerText = now.toLocaleDateString(activeLang === 'kk' ? 'kk-KZ' : activeLang === 'ru' ? 'ru-RU' : 'en-US', opt);
      }
    }
    updateClock();
    setInterval(updateClock, 1000);
  }

  // ── 9. Set Language ─────────────────────────────────────────────────────────
  function setLanguage(lang) {
    if (!I18N[lang]) lang = 'kk';
    activeLang = lang;

    document.querySelectorAll('.lang-item-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });

    const activeLabel = document.getElementById('nav-lang-label');
    if (activeLabel) {
      activeLabel.innerText = lang === 'kk' ? '🇰🇿 ҚАЗ' : lang === 'ru' ? '🇷🇺 РУС' : '🇬🇧 ENG';
    }

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (I18N[lang][key]) el.innerHTML = I18N[lang][key];
    });

    // Update download label
    const sys = getSystemInfo();
    const dlBtn = document.getElementById('btn-hero-master-dl');
    if (dlBtn) {
      dlBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        <span>${sys.label} — ${I18N[lang].dlFor || 'Жүктеу'} (${sys.size})</span>
      `;
      dlBtn.setAttribute('href', `dist/${sys.file}`);
      dlBtn.setAttribute('download', sys.file);
    }
  }

  // ── 10. Initialization ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    initSpotlightShaders();
    setupAiCopilot();
    initPackageSwitcher();
    initBenchmark();
    initCommandPalette();
    initSimulatorStage();

    // Language Menu Toggle
    const langBtn = document.getElementById('btn-lang-toggle');
    const langMenu = document.getElementById('lang-menu-panel');
    if (langBtn && langMenu) {
      langBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        langMenu.classList.toggle('active');
      });
      document.addEventListener('click', () => langMenu.classList.remove('active'));
      document.querySelectorAll('.lang-item-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          setLanguage(btn.dataset.lang);
          langMenu.classList.remove('active');
        });
      });
    }

    setLanguage('kk');
  });

})();
