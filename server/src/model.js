// Pure-JS inference for the PyTorch news classifier exported by ml/train.py.
// Reproduces scikit-learn's TfidfVectorizer (word 1-2 grams, sublinear tf, L2 norm)
// and the MLP forward pass, so predictions need no Python runtime.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DEFAULT_MODEL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../ml/artifacts/model.json',
);

// Python's (?u)\b\w\w+\b: maximal runs of 2+ unicode word characters.
const TOKEN_RE = /[\p{L}\p{N}_]{2,}/gu;

export function tokenize(text) {
  const unigrams = text.toLowerCase().match(TOKEN_RE) ?? [];
  const grams = [...unigrams];
  for (let i = 0; i < unigrams.length - 1; i++) grams.push(`${unigrams[i]} ${unigrams[i + 1]}`);
  return grams;
}

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
}

export class NewsModel {
  constructor(spec) {
    const { vectorizer, weights, labels, architecture } = spec;
    this.meta = {
      name: spec.name,
      version: spec.version,
      trainedAt: spec.trained_at,
      labels,
      architecture,
      metrics: spec.metrics,
      dataset: spec.dataset,
      vocabularySize: Object.keys(vectorizer.vocabulary).length,
    };
    this.labels = labels;
    this.vocab = new Map(Object.entries(vectorizer.vocabulary));
    this.idf = Float64Array.from(vectorizer.idf);
    this.hidden = architecture.hidden;

    // Transpose W1 (hidden x input) so each feature's hidden-unit weights are contiguous:
    // the TF-IDF vector is sparse, so the first layer only touches a handful of columns.
    const nIn = architecture.input;
    this.W1T = new Float64Array(nIn * this.hidden);
    weights.W1.forEach((row, k) => row.forEach((w, j) => { this.W1T[j * this.hidden + k] = w; }));
    this.b1 = Float64Array.from(weights.b1);
    this.Ws = weights.Ws;
    this.bs = weights.bs;
    this.Wr = weights.Wr;
    this.br = weights.br;
  }

  static load(modelPath = process.env.MODEL_PATH ?? DEFAULT_MODEL_PATH) {
    return new NewsModel(JSON.parse(readFileSync(modelPath, 'utf8')));
  }

  vectorize(text) {
    const counts = new Map();
    for (const g of tokenize(text)) {
      const idx = this.vocab.get(g);
      if (idx !== undefined) counts.set(idx, (counts.get(idx) ?? 0) + 1);
    }
    const feats = [];
    let norm = 0;
    for (const [idx, c] of counts) {
      const v = (1 + Math.log(c)) * this.idf[idx];
      feats.push([idx, v]);
      norm += v * v;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) for (const f of feats) f[1] /= norm;
    return feats;
  }

  predict(text) {
    const feats = this.vectorize(text);
    const h = Float64Array.from(this.b1);
    for (const [j, x] of feats) {
      const off = j * this.hidden;
      for (let k = 0; k < this.hidden; k++) h[k] += this.W1T[off + k] * x;
    }
    for (let k = 0; k < this.hidden; k++) if (h[k] < 0) h[k] = 0;

    const head = (W, b) => softmax(W.map((row, i) => row.reduce((acc, w, k) => acc + w * h[k], b[i])));
    const sentimentProbs = head(this.Ws, this.bs);
    const riskProbs = head(this.Wr, this.br);
    return this.describe(text, sentimentProbs, riskProbs, feats.length);
  }

  describe(text, sentimentProbs, riskProbs, knownTerms) {
    const { sentiment: S, risk: R } = this.labels;
    const argmax = (arr) => arr.indexOf(Math.max(...arr));
    const p = Object.fromEntries(S.map((l, i) => [l, sentimentProbs[i]]));
    const riskIdx = argmax(riskProbs);
    const noneIdx = R.indexOf('none');
    const round = (v) => Math.round(v * 10000) / 10000;
    return {
      text,
      sentiment: {
        label: S[argmax(sentimentProbs)],
        // -1 (bearish) .. +1 (bullish)
        score: round(p.positive - p.negative),
        confidence: round(Math.max(...sentimentProbs)),
        probabilities: Object.fromEntries(S.map((l, i) => [l, round(sentimentProbs[i])])),
      },
      risk: {
        type: R[riskIdx],
        // Probability that the headline describes *some* risk event.
        score: round(1 - riskProbs[noneIdx]),
        probabilities: Object.fromEntries(R.map((l, i) => [l, round(riskProbs[i])])),
      },
      knownTerms,
    };
  }
}
