'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Pet = require('./pet-companion');

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem(key) {
      assert.equal(key, Pet.STORAGE_KEY);
      return value;
    },
    setItem(key, next) {
      assert.equal(key, Pet.STORAGE_KEY);
      value = next;
    },
    read() { return value; }
  };
}

test('exposes three original companions and fixed customization choices', () => {
  assert.deepEqual(Pet.PETS.map(({ id }) => id), ['samal', 'tumar', 'qyran']);
  assert.equal(new Set(Pet.PETS.map(({ name }) => name)).size, 3);
  assert.equal(Pet.COLORS.length, 4);
  assert.equal(Pet.ACCESSORIES.length, 5);
  assert.equal(Pet.TEMPERAMENTS.length, 3);
});

test('normalizes valid profile values and returns an immutable record', () => {
  const profile = Pet.normalizeProfile({
    petId: 'qyran', name: '  Aйбар  ', colorId: 'mint', accessoryId: 'moon', temperamentId: 'dreamy'
  });
  assert.deepEqual(profile, {
    petId: 'qyran', name: 'Aйбар', colorId: 'mint', accessoryId: 'moon', temperamentId: 'dreamy'
  });
  assert.equal(Object.isFrozen(profile), true);
});

test('rejects unknown identifiers and non-object profile input', () => {
  assert.deepEqual(Pet.normalizeProfile({ petId: '<svg>', colorId: 'url', accessoryId: 'x', temperamentId: 'x' }), Pet.DEFAULT_PROFILE);
  assert.deepEqual(Pet.normalizeProfile(null), Pet.DEFAULT_PROFILE);
  assert.deepEqual(Pet.normalizeProfile(['qyran']), Pet.DEFAULT_PROFILE);
});

test('normalizes names, removes control and direction characters, and limits Unicode code points', () => {
  assert.equal(Pet.normalizeName('  Ａли‮ce<>\u0000  Әли  ', 'samal'), 'Aлиce Әли');
  assert.equal(Array.from(Pet.normalizeName('🌌'.repeat(20))).length, 16);
  assert.equal(Pet.normalizeName(' \u0000\u202e ', 'tumar'), 'Тұмар');
  assert.equal(Pet.normalizeName(42, 'qyran'), 'Қыран');
});

test('loads the default profile when storage is empty or contains invalid JSON', () => {
  assert.deepEqual(Pet.loadProfile(memoryStorage()), Pet.DEFAULT_PROFILE);
  assert.deepEqual(Pet.loadProfile(memoryStorage('{broken')), Pet.DEFAULT_PROFILE);
});

test('loads and revalidates persisted profiles before using them', () => {
  const storage = memoryStorage(JSON.stringify({
    petId: 'tumar', name: '<img src=x>', colorId: 'sun', accessoryId: 'spark', temperamentId: 'calm', ignored: 'x'
  }));
  assert.deepEqual(Pet.loadProfile(storage), {
    petId: 'tumar', name: 'img src=x', colorId: 'sun', accessoryId: 'spark', temperamentId: 'calm'
  });
});

test('survives unavailable or throwing storage access', () => {
  assert.deepEqual(Pet.loadProfile({ getItem() { throw new Error('blocked'); } }), Pet.DEFAULT_PROFILE);
  assert.equal(Pet.saveProfile(Pet.DEFAULT_PROFILE, { setItem() { throw new Error('blocked'); } }), false);
  assert.equal(Pet.saveProfile(Pet.DEFAULT_PROFILE, null), false);
});

test('saves a normalized local profile instead of untrusted extra fields', () => {
  const storage = memoryStorage();
  assert.equal(Pet.saveProfile({ ...Pet.DEFAULT_PROFILE, name: '<b>Samal</b>', secret: 'discard' }, storage), true);
  assert.deepEqual(JSON.parse(storage.read()), {
    petId: 'samal', name: 'bSamal/b', colorId: 'sky', accessoryId: 'spark', temperamentId: 'curious'
  });
});

test('randomizes appearance and temperament deterministically while preserving the chosen name', () => {
  const values = [0, 0.5, 0.8, 0.999];
  const result = Pet.randomizeProfile({ ...Pet.DEFAULT_PROFILE, name: 'Арман' }, () => values.shift());
  assert.deepEqual(result, {
    petId: 'samal', name: 'Арман', colorId: 'violet', accessoryId: 'moon', temperamentId: 'dreamy'
  });
});

test('bounds random values and safely handles a non-finite random result', () => {
  const values = [-1, 1, Number.NaN, Number.POSITIVE_INFINITY];
  const result = Pet.randomizeProfile(Pet.DEFAULT_PROFILE, () => values.shift());
  assert.deepEqual(result, {
    petId: 'samal', name: 'Самал', colorId: 'sun', accessoryId: 'none', temperamentId: 'curious'
  });
});

test('renders only one of the fixed SVG templates', () => {
  for (const pet of Pet.PETS) {
    const avatar = Pet.renderAvatar(pet.id);
    assert.match(avatar, /^<svg class="pet-svg"/);
    assert.match(avatar, /<\/svg>$/);
    assert.match(avatar, new RegExp(`data-character="${pet.id}"`));
    assert.match(avatar, /class="pet-body"/);
    assert.match(avatar, /class="pet-eyes"/);
    assert.match(avatar, /class="pet-mouth-talk"/);
    assert.match(avatar, /aria-hidden="true"/);
  }
  assert.equal(Pet.renderAvatar('<img onerror=alert(1)>'), Pet.renderAvatar('samal'));
});

test('companions have distinct silhouettes and their own animated character detail', () => {
  const avatars = Pet.PETS.map(({ id }) => Pet.renderAvatar(id));
  assert.equal(new Set(avatars).size, 3);
  assert.match(avatars[0], /class="pet-antenna"/);
  assert.match(avatars[1], /class="pet-ear pet-ear-left"/);
  assert.match(avatars[2], /class="pet-wing pet-wing-left"/);
  assert.ok(avatars.slice(0, 2).every((avatar) => avatar.includes('class="pet-arm')));
});

test('does not initialize when the expected interface is absent', () => {
  assert.equal(Pet.initialize(), false);
});
