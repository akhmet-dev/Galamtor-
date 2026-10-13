(function() {
  'use strict';

  const CACHE_KEY = 'galamtor_github_release_cache_v4';
  const CACHE_TIME_MS = 15 * 60 * 1000; // 15 minutes
  const FALLBACK_VERSION = 'v1.5.0';

  const KAZAKH_MONTHS = [
    'Қаңтар', 'Ақпан', 'Наурыз', 'Сәуір', 'Мамыр', 'Маусым',
    'Шілде', 'Тамыз', 'Қыркүйек', 'Қазан', 'Қараша', 'Желтоқсан'
  ];

  function formatKazakhDate(dateString) {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return '';
    return `${d.getDate()} ${KAZAKH_MONTHS[d.getMonth()]} ${d.getFullYear()} ж.`;
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function extractSHA256(body) {
    if (!body) return null;
    const lines = body.split('\n');
    const hashes = {};
    let inHashSection = false;
    for (let line of lines) {
      line = line.trim();
      if (line.toLowerCase().includes('sha256') || line.toLowerCase().includes('checksum')) {
        inHashSection = true;
        continue;
      }
      if (inHashSection && line.match(/^[a-fA-F0-9]{64}\s+/)) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          hashes[parts[1].trim()] = parts[0].trim();
        }
      }
    }
    return Object.keys(hashes).length > 0 ? hashes : null;
  }

  async function fetchLatestRelease() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      const validated = window.GalamtorReleaseUtils.normalizeRelease(cached?.data);
      if (validated && !window.GalamtorReleaseUtils.isNewerVersion(FALLBACK_VERSION, validated.tag_name) && cached.timestamp <= Date.now() && Date.now() - cached.timestamp < CACHE_TIME_MS) return validated;
    } catch { /* Blocked or corrupt browser storage must not disable downloads. */ }
    try {
      const release = await window.GalamtorReleaseUtils.fetchRelease();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: release })); } catch {}
      return release;
    } catch { return null; }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function updateUI(release) {
    if (!release) return;

    const version = release.tag_name || FALLBACK_VERSION;
    const dateStr = release.published_at ? formatKazakhDate(release.published_at) : '';
    const downloadUrl = release.html_url;

    // 1. Update version texts
    const versionRegex = /v\d+\.\d+\.\d+/g;
    
    const dlVer = document.getElementById('dl-version-info');
    if (dlVer) {
      dlVer.textContent = `Қоғамдық нұсқа ${version} · ${dateStr ? dateStr + ' · ' : ''}macOS 13+ · Тегін`;
    } else {
      document.querySelectorAll('.dl-ver').forEach(el => {
        el.innerHTML = el.innerHTML.replace(versionRegex, version);
      });
    }

    const stableVersionCta = document.getElementById('stable-version-cta');
    if (stableVersionCta) stableVersionCta.textContent = `Соңғы нұсқа · ${version}`;

    // Main download button
    const mainBtn = document.getElementById('dl-main-btn');
    if (mainBtn) {
      mainBtn.href = downloadUrl;
      const textSpan = mainBtn.querySelector('.btn-text');
      if (textSpan) {
        textSpan.textContent = 'Жүктеу нұсқаларын көру';
      }
    }

    // Update structured data
    const ldJsons = document.querySelectorAll('script[type="application/ld+json"]');
    ldJsons.forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        if (data.softwareVersion || data['@type'] === 'SoftwareApplication') {
          data.softwareVersion = version;
          script.textContent = JSON.stringify(data, null, 2);
        }
      } catch (e) { }
    });

    // Update all elements containing specific classes with the version
    document.querySelectorAll('.cert-ver, .vb-v, .st-m, .ftr-ed, .sc-arc-bot, .byline span').forEach(el => {
      if (el.textContent.includes('v1.')) {
        el.textContent = el.textContent.replace(versionRegex, version);
      }
    });

    document.querySelectorAll('.cta-btn').forEach(el => {
      el.href = downloadUrl;
      if (el.textContent.match(/v\d+\.\d+\.\d+/)) {
        el.textContent = el.textContent.replace(versionRegex, version);
      }
    });

    document.querySelectorAll('.ticker-inner').forEach(el => {
      el.innerHTML = el.innerHTML.replace(versionRegex, version);
    });

    // Platform Dropdown
    const dropdownContainer = document.getElementById('dl-platform-dropdown');
    if (dropdownContainer && release.assets && release.assets.length > 0) {
      let dropdownHTML = `
        <div style="margin-top: 15px; font-size: 0.9em; text-align: center;">
          <details style="cursor: pointer; padding: 10px; background: rgba(0,0,0,0.05); border-radius: 8px;">
            <summary style="outline: none; font-weight: bold;">Жүктеу файлдары мен SHA-256</summary>
            <ul style="list-style: none; padding: 10px 0 0 0; margin: 0;">
      `;
      
      release.assets.forEach(asset => {
        if (!/\.(dmg|zip|exe|msi|txt)$/i.test(asset.name)) return;
        if (!/^https:\/\/github\.com\//.test(asset.browser_download_url)) return;
        const platformLabel = /-arm64(?:-mac)?\.(dmg|zip)$/.test(asset.name) ? 'Apple Silicon (ARM64) — '
          : /^Galamtor-[\d.]+(?:-mac)?\.(dmg|zip)$/.test(asset.name) ? 'Intel (x64) — ' : '';
        dropdownHTML += `
          <li style="margin-bottom: 8px;">
            <a href="${escapeHtml(asset.browser_download_url)}" style="text-decoration: none; color: inherit; border-bottom: 1px dotted currentColor;">
              ${platformLabel}${escapeHtml(asset.name)} (${formatBytes(asset.size)})
            </a>
          </li>
        `;
      });
      
      const hashes = extractSHA256(release.body);
      if (hashes) {
        dropdownHTML += `<li style="margin-top:15px; font-weight:bold;">SHA256 Checksums:</li>`;
        for (const [filename, hash] of Object.entries(hashes)) {
          dropdownHTML += `<li style="font-family: monospace; font-size: 0.8em; word-break: break-all; margin-top: 4px;">${escapeHtml(filename)}: ${escapeHtml(hash)}</li>`;
        }
      }

      dropdownHTML += `
            </ul>
          </details>
        </div>
      `;
      dropdownContainer.innerHTML = dropdownHTML;
    }
  }

  // Init
  document.addEventListener('DOMContentLoaded', () => {
    fetchLatestRelease().then(updateUI);
  });
})();
