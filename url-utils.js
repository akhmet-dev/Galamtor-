(function exposeGalamtorURLUtils(root, createUtils) {
  const utils = createUtils();
  if (typeof module !== 'undefined' && module.exports) module.exports = utils;
  if (root) root.GalamtorURLUtils = utils;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createGalamtorURLUtils() {
  const SEARCH_URL = 'https://www.google.com/search?q=';

  function isIPv4(hostname) {
    const octets = hostname.split('.');
    return octets.length === 4 && octets.every((octet) => {
      if (!/^\d{1,3}$/.test(octet)) return false;
      const value = Number(octet);
      return value >= 0 && value <= 255;
    });
  }

  function isValidHost(hostname) {
    const normalized = hostname.toLowerCase();
    if (normalized === 'localhost' || isIPv4(normalized)) return true;
    if (normalized.startsWith('[') && normalized.endsWith(']')) {
      return normalized.includes(':');
    }

    const dnsName = normalized.endsWith('.') ? normalized.slice(0, -1) : normalized;
    if (dnsName.length > 253) return false;
    const labels = dnsName.split('.');
    return labels.length > 1 && labels.every((label) =>
      label.length > 0 && label.length <= 63 &&
      /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label)
    );
  }

  function isLocalHost(hostname) {
    if (hostname.toLowerCase() === 'localhost') return true;
    if (isIPv4(hostname)) {
      const [first, second] = hostname.split('.').map(Number);
      return first === 10 || first === 127 || (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) || (first === 169 && second === 254) || hostname === '0.0.0.0';
    }
    const address = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return address === '::1' || /^f[cd][a-f0-9]{0,2}:/.test(address) || /^fe[89ab][a-f0-9]:/.test(address);
  }

  function searchFor(query) {
    return `${SEARCH_URL}${encodeURIComponent(query)}`;
  }

  function parseSearchOrURL(input) {
    if (typeof input !== 'string') return '';
    const trimmed = input.trim();
    if (!trimmed) return '';

    const explicitScheme = trimmed.match(/^([a-z][a-z\d+.-]*):\/\//i);
    if (explicitScheme) {
      try {
        const parsed = new URL(trimmed);
        if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return '';
        return parsed.href;
      } catch {
        return '';
      }
    }

    // Block non-web protocols while keeping search operators such as `site:` usable.
    const scheme = trimmed.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();
    if (scheme && ['file', 'javascript', 'data', 'blob', 'mailto', 'ftp', 'ws', 'wss', 'about', 'chrome', 'devtools'].includes(scheme)) {
      return '';
    }

    try {
      const candidate = new URL(`https://${trimmed}`);
      if (!candidate.hostname || candidate.username || candidate.password || !isValidHost(candidate.hostname)) {
        return searchFor(trimmed);
      }
      candidate.protocol = isLocalHost(candidate.hostname) ? 'http:' : 'https:';
      return candidate.href;
    } catch {
      return searchFor(trimmed);
    }
  }

  return { parseSearchOrURL };
});
