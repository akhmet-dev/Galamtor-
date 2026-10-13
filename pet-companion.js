(function attachGalamtorPet(root) {
  'use strict';

  const STORAGE_KEY = 'galamtor_pet_profile_v1';
  const DEFAULT_PROFILE = Object.freeze({
    petId: 'samal',
    name: 'Самал',
    colorId: 'sky',
    accessoryId: 'spark',
    temperamentId: 'curious'
  });

  const PETS = Object.freeze([
    Object.freeze({ id: 'samal', name: 'Самал', role: 'Жел серігі', note: 'Жылдам ойлап, жайлы бағыт көрсетеді.' }),
    Object.freeze({ id: 'tumar', name: 'Тұмар', role: 'Жылы қорғаушы', note: 'Сабырлы, бірақ әрдайым сергек.' }),
    Object.freeze({ id: 'qyran', name: 'Қыран', role: 'Көкжиек зерттеушісі', note: 'Жаңа қойындыға қуана ұшады.' })
  ]);

  const COLORS = Object.freeze([
    Object.freeze({ id: 'sky', name: 'Көк аспан', shell: '#72a9ff', shade: '#3e68c9', outline: '#263c78', eye: '#a5f4ff', glow: 'rgba(76, 155, 255, .34)' }),
    Object.freeze({ id: 'mint', name: 'Жалбыз', shell: '#67d8ba', shade: '#299a91', outline: '#175d68', eye: '#d1fff1', glow: 'rgba(61, 224, 190, .3)' }),
    Object.freeze({ id: 'violet', name: 'Күлгін', shell: '#bb93ff', shade: '#7652c8', outline: '#46316f', eye: '#e5d8ff', glow: 'rgba(167, 115, 255, .32)' }),
    Object.freeze({ id: 'sun', name: 'Күн шуағы', shell: '#ffd16f', shade: '#e68a47', outline: '#8a4d39', eye: '#fff5bf', glow: 'rgba(255, 191, 82, .32)' })
  ]);

  const ACCESSORIES = Object.freeze([
    Object.freeze({ id: 'none', name: 'Аксессуарсыз', glyph: '' }),
    Object.freeze({ id: 'spark', name: 'Жұлдызша', glyph: '✦' }),
    Object.freeze({ id: 'headphones', name: 'Құлаққап', glyph: '♫' }),
    Object.freeze({ id: 'scarf', name: 'Шарф', glyph: '〰' }),
    Object.freeze({ id: 'moon', name: 'Ай белгісі', glyph: '☾' })
  ]);

  const TEMPERAMENTS = Object.freeze([
    Object.freeze({ id: 'curious', name: 'Қызыққұмар' }),
    Object.freeze({ id: 'calm', name: 'Сабырлы' }),
    Object.freeze({ id: 'dreamy', name: 'Арманшыл' })
  ]);

  // Original Galamtor companions: expressive pixel-bot silhouettes with separate animated parts.
  const AVATARS = Object.freeze({
    samal: `<svg class="pet-svg" data-character="samal" viewBox="0 0 128 136" aria-hidden="true" focusable="false">
      <ellipse class="pet-shadow" cx="64" cy="128" rx="27" ry="4"/>
      <g class="pet-body">
        <g class="pet-arm pet-arm-left"><path class="pet-shell" d="M39 78 25 74l-9 9 2 14 12 4 10-10z" stroke="var(--pet-outline)" stroke-width="4" stroke-linejoin="round"/><path class="pet-shade" d="m21 84 12-2 4 7-9 8-7-3z"/></g>
        <g class="pet-arm pet-arm-right"><path class="pet-shell" d="m89 78 14-4 9 9-2 14-12 4-10-10z" stroke="var(--pet-outline)" stroke-width="4" stroke-linejoin="round"/><path class="pet-shade" d="m107 84-12-2-4 7 9 8 7-3z"/></g>
        <g class="pet-legs"><path class="pet-shell" d="M43 104h15v15l-5 5H37v-8zM70 104h15l6 12v8H71l-5-5z" stroke="var(--pet-outline)" stroke-width="4" stroke-linejoin="round"/><path class="pet-shade" d="M39 117h16v4H39zm35 0h13v4H74z"/></g>
        <path class="pet-shell" d="M36 75h56v34c0 8-6 13-14 13H50c-8 0-14-5-14-13z" stroke="var(--pet-outline)" stroke-width="4"/>
        <path class="pet-shade" d="M42 98h44v11H42z"/><rect class="pet-chest-light" x="58" y="84" width="12" height="8" rx="4"/>
        <g class="pet-antenna"><path d="M64 19V9" stroke="var(--pet-outline)" stroke-width="5" stroke-linecap="round"/><circle class="pet-shell" cx="64" cy="8" r="6" stroke="var(--pet-outline)" stroke-width="3"/><circle class="pet-antenna-light" cx="64" cy="8" r="2"/></g>
        <path class="pet-shell" d="M37 24h54q13 0 13 13v26q0 17-17 17H41q-17 0-17-17V37q0-13 13-13z" stroke="var(--pet-outline)" stroke-width="5"/>
        <path class="pet-shade" d="M31 62h66v8q-3 6-12 6H43q-9 0-12-6z"/>
        <rect class="pet-face" x="34" y="37" width="60" height="37" rx="13"/>
        <path class="pet-face-glint" d="M43 42h12"/>
        <g class="pet-eyes"><path class="pet-eye" d="M50 51v8m28-8v8" stroke-width="5" stroke-linecap="round"/></g>
        <path class="pet-mouth" d="M57 65q7 5 14 0" stroke-width="2.5" stroke-linecap="round"/>
        <ellipse class="pet-mouth-talk" cx="64" cy="65" rx="4" ry="5"/>
        <path class="pet-cheek" d="M43 64h4m34 0h4" stroke-width="3" stroke-linecap="round"/>
      </g>
    </svg>`,
    tumar: `<svg class="pet-svg" data-character="tumar" viewBox="0 0 128 136" aria-hidden="true" focusable="false">
      <ellipse class="pet-shadow" cx="64" cy="128" rx="28" ry="4"/>
      <g class="pet-body">
        <g class="pet-ear pet-ear-left"><path class="pet-shell" d="M38 31 27 12q-3-6 4-5l22 16z" stroke="var(--pet-outline)" stroke-width="4" stroke-linejoin="round"/><path class="pet-ear-inset" d="m34 16 9 10-5 1z"/></g>
        <g class="pet-ear pet-ear-right"><path class="pet-shell" d="m90 31 11-19q3-6-4-5L75 24z" stroke="var(--pet-outline)" stroke-width="4" stroke-linejoin="round"/><path class="pet-ear-inset" d="m94 16-9 10 5 1z"/></g>
        <g class="pet-arm pet-arm-left"><path class="pet-shell" d="M34 79 21 76l-7 8 3 13 13 3 9-12z" stroke="var(--pet-outline)" stroke-width="4" stroke-linejoin="round"/><circle class="pet-arm-light" cx="23" cy="87" r="3"/></g>
        <g class="pet-arm pet-arm-right"><path class="pet-shell" d="m94 79 13-3 7 8-3 13-13 3-9-12z" stroke="var(--pet-outline)" stroke-width="4" stroke-linejoin="round"/><circle class="pet-arm-light" cx="105" cy="87" r="3"/></g>
        <path class="pet-shell" d="M40 93h16v25l-5 6H36v-9zm32 0h16l4 22v9H77l-5-6z" stroke="var(--pet-outline)" stroke-width="4" stroke-linejoin="round"/>
        <path class="pet-shell" d="M31 72q0-10 10-10h46q10 0 10 10v33q0 10-10 10H41q-10 0-10-10z" stroke="var(--pet-outline)" stroke-width="4"/>
        <path class="pet-shade" d="M37 94h54v11q-3 5-10 5H47q-7 0-10-5z"/>
        <path class="pet-chest-mark" d="M64 80 74 89 64 98 54 89z"/>
        <circle class="pet-chest-light" cx="64" cy="89" r="3"/>
        <path class="pet-shell" d="M35 40q0-18 18-18h22q18 0 18 18v24q0 15-15 15H50q-15 0-15-15z" stroke="var(--pet-outline)" stroke-width="5"/>
        <rect class="pet-face" x="40" y="39" width="48" height="31" rx="14"/>
        <path class="pet-face-glint" d="M47 44h10"/>
        <g class="pet-eyes"><path class="pet-eye pet-eye-smile" d="M49 54q5-7 10 0m10 0q5-7 10 0" stroke-width="4" stroke-linecap="round"/></g>
        <path class="pet-mouth" d="M58 62q6 6 12 0" stroke-width="2.5" stroke-linecap="round"/>
        <ellipse class="pet-mouth-talk" cx="64" cy="62" rx="4" ry="5"/>
        <path class="pet-cheek" d="M43 61h3m36 0h3" stroke-width="3" stroke-linecap="round"/>
      </g>
    </svg>`,
    qyran: `<svg class="pet-svg" data-character="qyran" viewBox="0 0 128 136" aria-hidden="true" focusable="false">
      <ellipse class="pet-shadow" cx="64" cy="128" rx="31" ry="4"/>
      <g class="pet-body">
        <g class="pet-wing pet-wing-left"><path class="pet-shell" d="M37 66 8 47l9 30 18 11 9-9z" stroke="var(--pet-outline)" stroke-width="4" stroke-linejoin="round"/><path class="pet-wing-line" d="m16 55 18 21"/></g>
        <g class="pet-wing pet-wing-right"><path class="pet-shell" d="m91 66 29-19-9 30-18 11-9-9z" stroke="var(--pet-outline)" stroke-width="4" stroke-linejoin="round"/><path class="pet-wing-line" d="M112 55 94 76"/></g>
        <path class="pet-shell" d="M42 95h15l-3 23-6 7H35v-8zm29 0h15l9 22v8H78l-6-7z" stroke="var(--pet-outline)" stroke-width="4" stroke-linejoin="round"/>
        <path class="pet-shade" d="M39 117h13v4H39zm40 0h11v4H79z"/>
        <path class="pet-shell" d="M36 74h56v35q0 10-10 10H46q-10 0-10-10z" stroke="var(--pet-outline)" stroke-width="4"/>
        <path class="pet-shade" d="M42 95h44v14q0 5-6 5H48q-6 0-6-5z"/>
        <path class="pet-chest-mark" d="m64 82 8 8-8 8-8-8z"/><path class="pet-chest-light" d="m64 85 5 5-5 5-5-5z"/>
        <g class="pet-antenna"><path d="M64 23V13" stroke="var(--pet-outline)" stroke-width="5" stroke-linecap="round"/><path class="pet-shell" d="m56 14 8-10 8 10-8 5z" stroke="var(--pet-outline)" stroke-width="3" stroke-linejoin="round"/><circle class="pet-antenna-light" cx="64" cy="12" r="2"/></g>
        <path class="pet-shell" d="M30 39q0-20 20-20h28q20 0 20 20v29H30z" stroke="var(--pet-outline)" stroke-width="5"/>
        <path class="pet-shade" d="M34 61h60v7H34z"/>
        <path class="pet-face" d="M37 37q0-9 10-9h34q10 0 10 9v25H37z"/>
        <path class="pet-face-glint" d="M45 33h15"/>
        <g class="pet-eyes"><path class="pet-eye" d="m49 43 5 5-5 5m30-10-5 5 5 5" stroke-width="4" stroke-linecap="square"/></g>
        <path class="pet-mouth" d="M58 59h12" stroke-width="2.5" stroke-linecap="round"/>
        <ellipse class="pet-mouth-talk" cx="64" cy="58" rx="4" ry="5"/>
      </g>
    </svg>`
  });

  const VALID_ACTIVITY = new Set(['idle', 'thinking', 'speaking', 'happy']);

  function safeChoice(value, choices, fallback) {
    return choices.some((choice) => choice.id === value) ? value : fallback;
  }

  function normalizeName(value, petId = DEFAULT_PROFILE.petId) {
    const pet = PETS.find((item) => item.id === petId) || PETS[0];
    if (typeof value !== 'string') return pet.name;
    const cleaned = value.normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const bounded = Array.from(cleaned).slice(0, 16).join('');
    return bounded || pet.name;
  }

  function normalizeProfile(candidate) {
    const source = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
    const petId = safeChoice(source.petId, PETS, DEFAULT_PROFILE.petId);
    return Object.freeze({
      petId,
      name: normalizeName(source.name, petId),
      colorId: safeChoice(source.colorId, COLORS, DEFAULT_PROFILE.colorId),
      accessoryId: safeChoice(source.accessoryId, ACCESSORIES, DEFAULT_PROFILE.accessoryId),
      temperamentId: safeChoice(source.temperamentId, TEMPERAMENTS, DEFAULT_PROFILE.temperamentId)
    });
  }

  function loadProfile(storage) {
    try {
      const target = storage === undefined ? root.localStorage : storage;
      const saved = target?.getItem(STORAGE_KEY);
      return saved ? normalizeProfile(JSON.parse(saved)) : normalizeProfile(DEFAULT_PROFILE);
    } catch {
      return normalizeProfile(DEFAULT_PROFILE);
    }
  }

  function saveProfile(profile, storage) {
    try {
      const target = storage === undefined ? root.localStorage : storage;
      if (!target?.setItem) return false;
      target.setItem(STORAGE_KEY, JSON.stringify(normalizeProfile(profile)));
      return true;
    } catch {
      return false;
    }
  }

  function randomizeProfile(profile, random = Math.random) {
    const pick = (items) => {
      const raw = Number(random());
      const index = Number.isFinite(raw) ? Math.floor(Math.min(0.999999, Math.max(0, raw)) * items.length) : 0;
      return items[index].id;
    };
    const current = normalizeProfile(profile);
    return normalizeProfile({
      ...current,
      petId: pick(PETS),
      colorId: pick(COLORS),
      accessoryId: pick(ACCESSORIES),
      temperamentId: pick(TEMPERAMENTS)
    });
  }

  function renderAvatar(petId) {
    const validPetId = safeChoice(petId, PETS, DEFAULT_PROFILE.petId);
    return AVATARS[validPetId];
  }

  function initialize() {
    const widget = root.document?.getElementById('galamtor-bot-widget');
    const panel = root.document?.getElementById('galamtor-pet-studio');
    const openButton = root.document?.getElementById('galamtor-pet-customize');
    if (!widget || !panel || !openButton) return false;

    const liveArt = root.document.getElementById('galamtor-pet-live-art');
    const previewArt = root.document.getElementById('galamtor-pet-preview-art');
    const previewName = root.document.getElementById('galamtor-pet-preview-name');
    const previewRole = root.document.getElementById('galamtor-pet-preview-role');
    const previewNote = root.document.getElementById('galamtor-pet-preview-note');
    const nameInput = root.document.getElementById('galamtor-pet-name');
    const colorButtons = Array.from(panel.querySelectorAll('[data-pet-color]'));
    const accessorySelect = root.document.getElementById('galamtor-pet-accessory');
    const temperamentSelect = root.document.getElementById('galamtor-pet-temperament');
    const status = root.document.getElementById('galamtor-pet-save-status');
    const liveAccessory = root.document.getElementById('galamtor-pet-live-accessory');
    const previewAccessory = root.document.getElementById('galamtor-pet-preview-accessory');
    const liveButton = root.document.getElementById('galamtor-bot-open');
    const previewCard = panel.querySelector('.pet-preview-card');
    const demoButton = root.document.getElementById('galamtor-pet-demo');
    const resetButton = root.document.getElementById('galamtor-pet-reset');
    const randomButton = root.document.getElementById('galamtor-pet-randomize');
    const closeButton = root.document.getElementById('galamtor-pet-close');
    const catalog = root.document.getElementById('galamtor-pet-catalog');
    if (!liveArt || !previewArt || !nameInput || !accessorySelect || !temperamentSelect || !catalog) return false;

    let profile = loadProfile();
    let previousFocus = null;
    let demoTimeout = null;
    let activity = 'idle';

    function setAvatarStyle(element, petId = profile.petId) {
      if (!element) return;
      const color = COLORS.find((item) => item.id === profile.colorId) || COLORS[0];
      element.style.setProperty('--pet-shell', color.shell);
      element.style.setProperty('--pet-shade', color.shade);
      element.style.setProperty('--pet-outline', color.outline);
      element.style.setProperty('--pet-eye', color.eye);
      element.style.setProperty('--pet-glow', color.glow);
      element.dataset.temperament = profile.temperamentId;
      element.dataset.activity = activity;
      element.innerHTML = renderAvatar(petId);
    }

    function setAccessory(element) {
      if (!element) return;
      const accessory = ACCESSORIES.find((item) => item.id === profile.accessoryId) || ACCESSORIES[0];
      element.textContent = accessory.glyph;
      element.hidden = !accessory.glyph;
      element.setAttribute('aria-label', accessory.glyph ? accessory.name : 'Аксессуарсыз');
    }

    function render() {
      const pet = PETS.find((item) => item.id === profile.petId) || PETS[0];
      const color = COLORS.find((item) => item.id === profile.colorId) || COLORS[0];
      setAvatarStyle(liveArt);
      setAvatarStyle(previewArt);
      liveButton?.style.setProperty('--pet-glow', color.glow);
      previewCard?.style.setProperty('--pet-glow', color.glow);
      setAccessory(liveAccessory);
      setAccessory(previewAccessory);
      if (previewName) previewName.textContent = profile.name;
      if (previewRole) previewRole.textContent = pet.role;
      if (previewNote) previewNote.textContent = pet.note;
      nameInput.value = profile.name;
      accessorySelect.value = profile.accessoryId;
      temperamentSelect.value = profile.temperamentId;
      openButton.setAttribute('aria-label', `${profile.name} серігін баптау`);
      openButton.title = `${profile.name} · Серікті баптау`;
      panel.querySelectorAll('[data-pet-id]').forEach((button) => {
        const selected = button.dataset.petId === profile.petId;
        button.setAttribute('aria-pressed', String(selected));
        button.classList.toggle('is-selected', selected);
        setAvatarStyle(button.querySelector('.pet-choice-avatar'), button.dataset.petId);
      });
      colorButtons.forEach((button) => {
        const selected = button.dataset.petColor === profile.colorId;
        button.setAttribute('aria-pressed', String(selected));
        button.classList.toggle('is-selected', selected);
      });
    }

    function update(next, announcement = 'Өзгеріс осы құрылғыда сақталды.') {
      profile = normalizeProfile({ ...profile, ...next });
      const saved = saveProfile(profile);
      render();
      if (status) status.textContent = saved ? announcement : 'Баптауды сақтау мүмкін болмады.';
    }

    PETS.forEach((pet) => {
      const button = root.document.createElement('button');
      button.type = 'button';
      button.className = 'pet-choice';
      button.dataset.petId = pet.id;
      button.setAttribute('aria-label', `${pet.name} — ${pet.role}`);
      button.title = `${pet.name} · ${pet.role}`;
      button.setAttribute('aria-pressed', 'false');
      const avatar = root.document.createElement('span');
      avatar.className = 'pet-choice-avatar galamtor-pet-art';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.innerHTML = renderAvatar(pet.id);
      const copy = root.document.createElement('span');
      copy.className = 'pet-choice-copy';
      const name = root.document.createElement('strong');
      name.textContent = pet.name;
      const role = root.document.createElement('small');
      role.textContent = pet.role;
      copy.append(name, role);
      button.append(avatar, copy);
      button.addEventListener('click', () => update({ petId: pet.id }, `${pet.name} серігі таңдалды.`));
      catalog.appendChild(button);
    });

    colorButtons.forEach((button) => {
      const color = COLORS.find((item) => item.id === button.dataset.petColor);
      if (color) button.style.setProperty('--swatch-color', color.shell);
      button.addEventListener('click', () => update({ colorId: button.dataset.petColor }, 'Түсі өзгертілді.'));
    });

    const commitName = () => update({ name: nameInput.value }, 'Аты осы құрылғыда сақталды.');
    nameInput.addEventListener('input', (event) => {
      if (!event.isComposing) commitName();
    });
    nameInput.addEventListener('compositionend', commitName);
    accessorySelect.addEventListener('change', () => update({ accessoryId: accessorySelect.value }, 'Аксессуары өзгертілді.'));
    temperamentSelect.addEventListener('change', () => update({ temperamentId: temperamentSelect.value }, 'Мінезі өзгертілді.'));

    function closeStudio({ restoreFocus = true } = {}) {
      if (panel.hidden) return;
      panel.hidden = true;
      openButton.setAttribute('aria-expanded', 'false');
      if (restoreFocus) (previousFocus || openButton).focus();
      previousFocus = null;
    }

    function openStudio() {
      if (!panel.hidden) {
        closeStudio();
        return;
      }
      previousFocus = root.document.activeElement;
      panel.hidden = false;
      openButton.setAttribute('aria-expanded', 'true');
      root.document.getElementById('galamtor-pet-name')?.focus();
    }

    openButton.addEventListener('click', openStudio);
    closeButton?.addEventListener('click', () => closeStudio());
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeStudio();
      }
    });
    root.document.addEventListener('pointerdown', (event) => {
      if (!panel.hidden && !panel.contains(event.target) && event.target !== openButton && !openButton.contains(event.target)) {
        closeStudio({ restoreFocus: false });
      }
    });

    demoButton?.addEventListener('click', () => {
      activity = 'happy';
      render();
      if (status) status.textContent = `${profile.name} қуана секіріп амандасты!`;
      if (demoTimeout) root.clearTimeout(demoTimeout);
      demoTimeout = root.setTimeout(() => {
        activity = 'idle';
        render();
      }, 1200);
    });

    randomButton?.addEventListener('click', () => {
      update(randomizeProfile(profile), 'Жаңа образ таңдалып, осы құрылғыда сақталды.');
    });
    resetButton?.addEventListener('click', () => update(DEFAULT_PROFILE, 'Әдепкі серік қалпына келтірілді.'));

    render();
    if (status) status.textContent = 'Таңдауларың осы құрылғыда сақталады.';

    return Object.freeze({
      close: closeStudio,
      setActivity(nextActivity) {
        activity = VALID_ACTIVITY.has(nextActivity) ? nextActivity : 'idle';
        render();
      },
      getProfile() { return profile; }
    });
  }

  const api = Object.freeze({
    STORAGE_KEY,
    DEFAULT_PROFILE,
    PETS,
    COLORS,
    ACCESSORIES,
    TEMPERAMENTS,
    normalizeName,
    normalizeProfile,
    loadProfile,
    saveProfile,
    randomizeProfile,
    renderAvatar,
    initialize
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.GalamtorPet = api;
})(typeof window !== 'undefined' ? window : globalThis);
