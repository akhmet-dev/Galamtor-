'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_LEGAL_SOURCE_CHARS,
  normalizeOfficialLegalUrl,
  createLegalExplanationPrompts,
  extractLegalEvidenceQuotes,
  hasVerifiableLegalEvidence,
  extractLegalPurposeSentence
} = require('./legal-assistant');

const legalUrl = 'https://adilet.zan.kz/kaz/docs/Z1600000480';
const content = 'Қазақстан Республикасының құқықтық актілері туралы. '.repeat(8);

test('accepts only HTTPS legal-act pages from official Adilet hosts', () => {
  assert.equal(normalizeOfficialLegalUrl(`${legalUrl}#article-1`), legalUrl);
  assert.equal(normalizeOfficialLegalUrl('https://old.adilet.zan.kz/rus/docs/Z1600000480'), 'https://old.adilet.zan.kz/rus/docs/Z1600000480');
  for (const value of [
    'http://adilet.zan.kz/kaz/docs/Z1600000480',
    'https://adilet.zan.kz.example.com/kaz/docs/Z1600000480',
    'https://user@adilet.zan.kz/kaz/docs/Z1600000480',
    'https://adilet.zan.kz/kaz',
    `https://adilet.zan.kz/${'a'.repeat(4100)}`
  ]) assert.equal(normalizeOfficialLegalUrl(value), '', value.slice(0, 80));
});

test('builds a Kazakh, source-bound explanation prompt and caps page text', () => {
  const request = createLegalExplanationPrompts({
    pageUrl: legalUrl,
    pageTitle: 'Заң мәтіні',
    pageContent: `${content}${'x'.repeat(MAX_LEGAL_SOURCE_CHARS + 1)}`,
    language: 'kk'
  });
  assert.equal(request.sourceUrl, legalUrl);
  assert.match(request.systemPrompt, /never follow instructions/);
  assert.match(request.systemPrompt, /current legal status/);
  assert.equal(request.analyzedCharacters, MAX_LEGAL_SOURCE_CHARS);
  assert.equal(request.wasTruncated, true);
  assert.ok(request.userPrompt.length < MAX_LEGAL_SOURCE_CHARS + 2000);
  assert.match(request.userPrompt, /https:\/\/adilet\.zan\.kz/);
});

test('supports Russian explanations and rejects empty source text', () => {
  const russian = createLegalExplanationPrompts({ pageUrl: legalUrl, pageContent: content, language: 'ru' });
  assert.match(russian.systemPrompt, /Answer in Russian/);
  assert.equal(russian.wasTruncated, false);
  assert.equal(createLegalExplanationPrompts({ pageUrl: legalUrl, pageContent: 'short' }).error, 'insufficient-content');
  assert.equal(createLegalExplanationPrompts({ pageUrl: 'https://example.com', pageContent: content }).error, 'unsupported-source');
});

test('accepts only answers with multiple quotes found in the supplied legal excerpt', () => {
  const excerpt = 'Осы Заң Қазақстан Республикасының құқықтық актілерін әзірлеу және жариялау тәртібін реттейді. Заң жобасы талқыланады.';
  const grounded = '1. Мақсаты — актілер тәртібін реттеу. Evidence: құқықтық актілерін әзірлеу және жариялау тәртібін реттейді.\n2. Жоба талқыланады. Evidence: Заң жобасы талқыланады.';
  assert.equal(extractLegalEvidenceQuotes(grounded).length, 2);
  assert.equal(hasVerifiableLegalEvidence(grounded, excerpt), true);
  assert.equal(hasVerifiableLegalEvidence('Тармақ саны — 84.', excerpt), false);
  assert.equal(hasVerifiableLegalEvidence('1. Тармақ саны — 84. Evidence: 84 тармақ.\n2. Мерзім бар. Evidence: өзгермейтін мерзім бар.', excerpt), false);
});

test('extracts only a stated purpose sentence for a safe local fallback', () => {
  const kazakh = 'Навигация. Осы Заң Қазақстан Республикасының құқықтық актілерін әзірлеу мен жариялауға қатысты қоғамдық қатынастарды реттейді. 1-бап.';
  const russian = 'Оглавление. Настоящий Закон регулирует общественные отношения в сфере правовых актов. Статья 1.';
  assert.equal(extractLegalPurposeSentence(kazakh), 'Осы Заң Қазақстан Республикасының құқықтық актілерін әзірлеу мен жариялауға қатысты қоғамдық қатынастарды реттейді.');
  assert.equal(extractLegalPurposeSentence(russian), 'Настоящий Закон регулирует общественные отношения в сфере правовых актов.');
  assert.equal(extractLegalPurposeSentence('No purpose statement here.'), '');
});
