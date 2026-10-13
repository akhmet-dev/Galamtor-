const { URL } = require('node:url');
const QALQAN_BLOCKLIST = [
  'invest-kaspi.com', 'kaspi-bonus.kz', 'halyk-invest-bot.com',
  'tengri-coin.net', 'bitcoin-astana.kz', 'egov-kz.online',
  'egov-login.com', 'mygov-kz.ru', 'kaspi-login.ru', 'kaspi-pay.online',
  'kaspi-prize.kz', 'halyk-win.com', 'gos-viplaty.kz', 'fond-kompensatsii.kz',
  'kaspi-credit-online.kz', 'egov-posobie.kz'
];

function isPhishingOrScam(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname.toLowerCase();

    // 1. Direct blocklist check
    if (QALQAN_BLOCKLIST.some(d => host === d || host.endsWith('.' + d))) {
      return { isScam: true, reason: 'Белгілі алаяқтық немесе фишингтік ресурс тізімінде анықталды.' };
    }

    // 2. Legitimate KZ service verification
    const isLegitKaspi = host === 'kaspi.kz' || host.endsWith('.kaspi.kz');
    const isLegiteGov = host === 'egov.kz' || host.endsWith('.egov.kz');
    const isLegitHalyk = host === 'halykbank.kz' || host.endsWith('.halykbank.kz') || host === 'homebank.kz' || host.endsWith('.homebank.kz');

    // 3. Phishing heuristic checks
    if (!isLegitKaspi && /kaspi.*(?:login|pay|bonus|prize|invest|money|cash)/i.test(host)) {
      return { isScam: true, reason: 'Kaspi.kz брендін заңсыз пайдаланған күдікті фишингтік сілтеме.' };
    }
    if (!isLegiteGov && /egov.*(?:login|free|bonus|viplata|posobie)/i.test(host)) {
      return { isScam: true, reason: 'eGov.kz мемлекеттік порталын қайталаған жалған парақша.' };
    }
    if (!isLegitHalyk && /halyk.*(?:invest|bonus|win|kassa)/i.test(host)) {
      return { isScam: true, reason: 'Halyk Bank атын жамылған жалған инвестициялық сайт.' };
    }
  } catch (e) {}
  return { isScam: false };
}


function isYouTubeURL(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return ['youtube.com', 'googlevideo.com', 'ytimg.com'].some(domain => host === domain || host.endsWith('.' + domain));
  } catch { return false; }
}

module.exports = { isPhishingOrScam, isYouTubeURL };
