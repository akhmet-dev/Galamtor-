(function exposeLensUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GalamtorLensUtils = api;
})(typeof globalThis === 'object' ? globalThis : this, function createLensUtils() {
const MAX_IMAGE_URL_LENGTH = 4096;

function isPrivateOrLocalHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.test') || host.endsWith('.invalid') || !host.includes('.')) {
    return true;
  }

  // Do not send intranet or IP-literal URLs to the external Lens service.
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')) return true;
  return false;
}

function buildLensUploadUrl(imageUrl) {
  if (typeof imageUrl !== 'string' || imageUrl.length === 0 || imageUrl.length > MAX_IMAGE_URL_LENGTH) return null;
  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || isPrivateOrLocalHost(parsed.hostname)) return null;
    parsed.hash = '';
    return `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(parsed.href)}`;
  } catch {
    return null;
  }
}

return { MAX_IMAGE_URL_LENGTH, isPrivateOrLocalHost, buildLensUploadUrl };
});
