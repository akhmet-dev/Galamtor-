const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function readJsonFile(filePath, fallback, isValid = () => true) {
  for (const candidate of [filePath, `${filePath}.bak`]) {
    try {
      const value = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (isValid(value)) return value;
    } catch {}
  }
  return structuredClone(fallback);
}

// A crash can leave the old complete file or the new complete file, never a partial JSON document.
function writeJsonAtomic(filePath, value, { backup = true, isValid = () => true } = {}) {
  if (!isValid(value)) throw new TypeError('Invalid profile data');
  const serialized = JSON.stringify(value, null, 2);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${randomUUID()}`;
  const backupTemporary = `${temporary}.bak`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, serialized, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (backup) {
      try {
        const previous = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (isValid(previous)) {
          fs.writeFileSync(backupTemporary, JSON.stringify(previous, null, 2), { flag: 'wx', mode: 0o600 });
          fs.renameSync(backupTemporary, `${filePath}.bak`);
        }
      } catch (error) {
        if (fs.existsSync(backupTemporary)) throw error;
        // Preserve the existing backup when the primary file is missing or corrupt.
      }
    }
    fs.renameSync(temporary, filePath);
    if (!backup) fs.rmSync(`${filePath}.bak`, { force: true });
    return true;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
    fs.rmSync(backupTemporary, { force: true });
  }
}

module.exports = { readJsonFile, writeJsonAtomic };
