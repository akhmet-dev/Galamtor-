(function() {
  'use strict';

  const CACHE_KEY = 'galamtor_github_release_cache_v2';
  const CACHE_TIME_MS = 15 * 60 * 1000; // 15 minutes
  const REPO_API_URL = 'https://api.github.com/repos/akhmet-dev/Galamtor-/releases/latest';
  const FALLBACK_VERSION = 'v1.0.1';

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
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_TIME_MS) {
          return parsed.data;
        }
      }

      const response = await fetch(REPO_API_URL);
      if (!response.ok) throw new Error('API request failed');
      const data = await response.json();

      localStorage.setItem(CACHE_KEY, JSON.stringify({
        timestamp: Date.now(),
        data: data
      }));

      return data;
    } catch (error) {
      console.warn('Failed to fetch GitHub release:', error);
      return null;
    }
  }

  function detectOSInfo() {
    const ua = navigator.userAgent.toLowerCase();
    const plat = navigator.platform?.toLowerCase() || '';
    
    let isMac = plat.includes('mac') || ua.includes('macintosh') || ua.includes('mac os');
    let isWin = plat.includes('win') || ua.includes('windows');
    let isLinux = plat.includes('linux') || ua.includes('x11');
    
    let isArm = false;
    if (navigator.userAgentData && navigator.userAgentData.architecture === 'arm') {
      isArm = true;
    } else if (isMac && (navigator.maxTouchPoints > 2 || ua.includes('arm'))) {
      isArm = true;
    }

    if (isMac) {
      return {
        os: 'mac',
        label: isArm ? 'macOS (Apple Silicon) үшін жүктеу' : 'macOS (Intel) үшін жүктеу',
        assetMatcher: isArm ? (a) => a.name.endsWith('.dmg') && a.name.includes('arm64') : (a) => a.name.endsWith('.dmg') && (a.name.includes('x64') || a.name.includes('x86_64'))
      };
    } else if (isWin) {
      return {
        os: 'windows',
        label: 'Windows үшін жүктеу',
        assetMatcher: (a) => a.name.endsWith('.exe')
      };
    } else {
      return {
        os: 'linux',
        label: 'Linux үшін жүктеу',
        assetMatcher: (a) => a.name.endsWith('.deb') || a.name.endsWith('.AppImage')
      };
    }
  }

  function updateUI(release) {
    if (!release) return;

    const version = release.tag_name || FALLBACK_VERSION;
    const dateStr = release.published_at ? formatKazakhDate(release.published_at) : '';
    const osInfo = detectOSInfo();
    
    // Find optimal asset for detected OS
    let primaryAsset = null;
    let fallbackAsset = null;
    
    if (release.assets && release.assets.length > 0) {
      primaryAsset = release.assets.find(osInfo.assetMatcher);
      if (!primaryAsset) {
        // Find any asset if specific architecture not found
        if (osInfo.os === 'mac') primaryAsset = release.assets.find(a => a.name.endsWith('.dmg'));
        else if (osInfo.os === 'windows') primaryAsset = release.assets.find(a => a.name.endsWith('.exe'));
      }
      fallbackAsset = release.assets[0];
    }
    
    const downloadUrl = primaryAsset ? primaryAsset.browser_download_url : release.html_url;
    const downloadSize = primaryAsset ? formatBytes(primaryAsset.size) : '';

    // 1. Update version texts
    const versionRegex = /v\d+\.\d+\.\d+/g;
    
    const dlVer = document.getElementById('dl-version-info');
    if (dlVer) {
      dlVer.innerHTML = `Нұсқа ${version} &nbsp;·&nbsp; ${dateStr ? dateStr + ' &nbsp;·&nbsp; ' : ''}macOS 13+ &nbsp;·&nbsp; Тегін`;
    } else {
      document.querySelectorAll('.dl-ver').forEach(el => {
        el.innerHTML = el.innerHTML.replace(versionRegex, version);
      });
    }

    // Main download button
    const mainBtn = document.getElementById('dl-main-btn');
    if (mainBtn) {
      mainBtn.href = downloadUrl;
      const textSpan = mainBtn.querySelector('.btn-text');
      if (textSpan) {
        textSpan.textContent = osInfo.label + (downloadSize ? ` (${downloadSize})` : '');
      } else {
        // Fallback if span is missing
        mainBtn.innerHTML = mainBtn.innerHTML.replace(/macOS үшін жүктеу|Windows үшін жүктеу|Linux үшін жүктеу/i, osInfo.label + (downloadSize ? ` (${downloadSize})` : ''));
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
    document.querySelectorAll('.cert-ver, .vb-v, .st-m').forEach(el => {
      if (el.textContent.includes('v1.')) {
        el.textContent = version;
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
            <summary style="outline: none; font-weight: bold;">Басқа платформалар (Other platforms)</summary>
            <ul style="list-style: none; padding: 10px 0 0 0; margin: 0;">
      `;
      
      release.assets.forEach(asset => {
        dropdownHTML += `
          <li style="margin-bottom: 8px;">
            <a href="${asset.browser_download_url}" style="text-decoration: none; color: inherit; border-bottom: 1px dotted currentColor;">
              ${asset.name} (${formatBytes(asset.size)})
            </a>
          </li>
        `;
      });
      
      const hashes = extractSHA256(release.body);
      if (hashes) {
        dropdownHTML += `<li style="margin-top:15px; font-weight:bold;">SHA256 Checksums:</li>`;
        for (const [filename, hash] of Object.entries(hashes)) {
          dropdownHTML += `<li style="font-family: monospace; font-size: 0.8em; word-break: break-all; margin-top: 4px;">${filename}: ${hash}</li>`;
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
