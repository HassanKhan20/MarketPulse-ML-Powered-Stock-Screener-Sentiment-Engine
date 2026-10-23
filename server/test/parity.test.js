// The JS inference port must reproduce the probabilities PyTorch produced at export time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NewsModel, tokenize } from '../src/model.js';

const fixtures = JSON.parse(
  readFileSync(new URL('../../ml/artifacts/parity_fixtures.json', import.meta.url), 'utf8'),
);
const model = NewsModel.load();

test('tokenizer matches scikit-learn conventions', () => {
  assert.deepEqual(tokenize('S&P cuts Apex to junk, 10% drop'), [
    'cuts', 'apex', 'to', 'junk', '10', 'drop',
    'cuts apex', 'apex to', 'to junk', 'junk 10', '10 drop',
  ]);
});

test('JS predictions match PyTorch probabilities', () => {
  assert.ok(fixtures.length > 40);
  for (const fx of fixtures) {
    const out = model.predict(fx.text);
    const sent = Object.values(out.sentiment.probabilities);
    const risk = Object.values(out.risk.probabilities);
    fx.sentiment.forEach((p, i) => assert.ok(Math.abs(p - sent[i]) < 1e-3, `${fx.text}: sentiment[${i}] ${p} vs ${sent[i]}`));
    fx.risk.forEach((p, i) => assert.ok(Math.abs(p - risk[i]) < 1e-3, `${fx.text}: risk[${i}] ${p} vs ${risk[i]}`));
  }
});

test('model separates obvious cases', () => {
  assert.equal(model.predict('Apex Dynamics beats earnings estimates and raises guidance').sentiment.label, 'positive');
  const breach = model.predict('Ransomware attack shuts down bank systems, customer data stolen');
  assert.equal(breach.sentiment.label, 'negative');
  assert.equal(breach.risk.type, 'cyber');
  assert.ok(breach.risk.score > 0.5);
});
