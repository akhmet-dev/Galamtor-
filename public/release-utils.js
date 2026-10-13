(function exposeReleaseUtils(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GalamtorReleaseUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createReleaseUtils() {
  const REPOSITORY = 'https://github.com/akhmet-dev/Galamtor-';
  const API_URL = 'https://api.github.com/repos/akhmet-dev/Galamtor-/releases/latest';
  function versionParts(version) {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
    return match ? match.slice(1).map(Number) : null;
  }
  function isNewerVersion(candidate, current) {
    const next = versionParts(candidate), previous = versionParts(current);
    if (!next || !previous) return false;
    for (let i = 0; i < 3; i++) {
      if (next[i] !== previous[i]) return next[i] > previous[i];
    }
    return false;
  }
  function normalizeRelease(value) {
    if (!value || typeof value !== 'object' || !versionParts(value.tag_name) || value.draft || value.prerelease ||
      value.html_url !== `${REPOSITORY}/releases/tag/${value.tag_name}`) return null;
    const prefix = `${REPOSITORY}/releases/download/${value.tag_name}/`;
    const assets = (Array.isArray(value.assets) ? value.assets : []).filter(asset =>
      typeof asset?.name === 'string' && /^[\w.\-]+$/.test(asset.name) && asset.name.length < 200 &&
      asset.browser_download_url === prefix + asset.name && Number.isFinite(asset.size) && asset.size >= 0);
    return { tag_name: value.tag_name, html_url: value.html_url,
      published_at: typeof value.published_at === 'string' ? value.published_at : '',
      body: typeof value.body === 'string' ? value.body.slice(0, 100000) : '', assets };
  }
  async function fetchRelease(fetchImpl = fetch, timeoutMs = 8000) {
    const response = await fetchImpl(API_URL, {
      headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error('Release metadata unavailable');
    const release = normalizeRelease(await response.json());
    if (!release) throw new Error('Invalid release metadata');
    return release;
  }
  return { REPOSITORY, API_URL, isNewerVersion, normalizeRelease, fetchRelease };
});
