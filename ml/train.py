"""Train the MarketPulse news classifier.

Pipeline
  1. TF-IDF features (scikit-learn, word 1-2 grams, sublinear tf, L2 norm)
  2. PyTorch multi-task MLP: shared hidden layer -> sentiment head (3) + risk head (9)
  3. scikit-learn LogisticRegression baselines for comparison
  4. Export vectorizer + weights to JSON so the Node API can serve predictions
     without a Python runtime, plus parity fixtures to verify the JS port.

Two evaluations are reported:
  primary      - deduplicated random 80/20 split (test sentences never seen in training)
  stress test  - ~20% of catalyst phrases held out entirely (e.g. "jury verdict" never
                 appears in training), a much harder out-of-vocabulary setting

Usage: python train.py [--epochs 8] [--hidden 96]
"""
import argparse
import csv
import json
import random
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, f1_score
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).parent
DATA = ROOT / "data" / "financial_news.csv"
OUT_DIR = ROOT / "artifacts"

SENTIMENTS = ["negative", "neutral", "positive"]
RISKS = ["none", "earnings", "legal", "regulatory", "debt", "supply_chain", "leadership", "cyber", "macro"]


class NewsClassifier(nn.Module):
    def __init__(self, n_features: int, hidden: int):
        super().__init__()
        self.shared = nn.Sequential(nn.Linear(n_features, hidden), nn.ReLU(), nn.Dropout(0.4))
        self.sentiment = nn.Linear(hidden, len(SENTIMENTS))
        self.risk = nn.Linear(hidden, len(RISKS))

    def forward(self, x):
        h = self.shared(x)
        return self.sentiment(h), self.risk(h)


def set_seed(seed: int):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def load_rows():
    with DATA.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    seen, unique = set(), []
    for r in rows:
        key = r["text"].lower()
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique


def make_vectorizer(max_features: int) -> TfidfVectorizer:
    return TfidfVectorizer(lowercase=True, ngram_range=(1, 2), sublinear_tf=True,
                           min_df=2, max_features=max_features, norm="l2")


def fit_torch(X, ys, yr, args):
    Xt = torch.tensor(X.toarray(), dtype=torch.float32)
    ys_t, yr_t = torch.tensor(ys), torch.tensor(yr)
    model = NewsClassifier(Xt.shape[1], args.hidden)
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-3)
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.05)
    for epoch in range(1, args.epochs + 1):
        model.train()
        perm = torch.randperm(Xt.shape[0])
        total = 0.0
        for s in range(0, len(perm), 64):
            b = perm[s:s + 64]
            ls, lr_ = model(Xt[b])
            loss = loss_fn(ls, ys_t[b]) + loss_fn(lr_, yr_t[b])
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += loss.item() * len(b)
        print(f"  epoch {epoch:2d} loss={total / len(perm):.4f}")
    model.eval()
    return model


def predict(model, X):
    with torch.no_grad():
        ls, lr_ = model(torch.tensor(X.toarray(), dtype=torch.float32))
    return ls.argmax(1).numpy(), lr_.argmax(1).numpy()


def scores(ys, yr, ps, pr):
    return {
        "sentiment_accuracy": round(float(accuracy_score(ys, ps)), 4),
        "sentiment_macro_f1": round(float(f1_score(ys, ps, average="macro")), 4),
        "risk_accuracy": round(float(accuracy_score(yr, pr)), 4),
        "risk_macro_f1": round(float(f1_score(yr, pr, average="macro", labels=range(len(RISKS)),
                                              zero_division=0)), 4),
    }


def evaluate_split(name, texts, y_sent, y_risk, idx_train, idx_test, args, verbose=False):
    print(f"\n=== {name}: train={len(idx_train)} test={len(idx_test)} ===")
    vec = make_vectorizer(args.max_features)
    X_train = vec.fit_transform([texts[i] for i in idx_train])
    X_test = vec.transform([texts[i] for i in idx_test])
    model = fit_torch(X_train, y_sent[idx_train], y_risk[idx_train], args)
    ps, pr = predict(model, X_test)

    base_s = LogisticRegression(max_iter=3000, C=4.0).fit(X_train, y_sent[idx_train])
    base_r = LogisticRegression(max_iter=3000, C=4.0).fit(X_train, y_risk[idx_train])

    yt_s, yt_r = y_sent[idx_test], y_risk[idx_test]
    result = {
        "pytorch": scores(yt_s, yt_r, ps, pr),
        "sklearn_logreg_baseline": scores(yt_s, yt_r, base_s.predict(X_test), base_r.predict(X_test)),
    }
    if verbose:
        print("Sentiment (PyTorch):")
        print(classification_report(yt_s, ps, target_names=SENTIMENTS, digits=3))
        print("Risk (PyTorch):")
        print(classification_report(yt_r, pr, labels=range(len(RISKS)), target_names=RISKS,
                                    digits=3, zero_division=0))
    print(json.dumps(result, indent=2))
    return result, vec, model


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--hidden", type=int, default=96)
    ap.add_argument("--max-features", type=int, default=4000)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    set_seed(args.seed)

    rows = load_rows()
    texts = [r["text"] for r in rows]
    y_sent = np.array([SENTIMENTS.index(r["sentiment"]) for r in rows])
    y_risk = np.array([RISKS.index(r["risk"]) for r in rows])

    # Stress test: hold out ~20% of catalyst phrases within every (sentiment, risk) group.
    groups = {}
    for r in rows:
        sent, risk, _ = r["template"].split(":")
        groups.setdefault((sent, risk), set()).add(r["template"])
    rng = random.Random(args.seed)
    held_out = set()
    for tpls in groups.values():
        tpls = sorted(tpls)
        rng.shuffle(tpls)
        held_out.update(tpls[:max(1, round(len(tpls) * 0.2))])
    is_test = np.array([r["template"] in held_out for r in rows])
    stress, _, _ = evaluate_split("stress test (unseen catalyst phrases)", texts, y_sent, y_risk,
                                  np.where(~is_test)[0], np.where(is_test)[0], args)

    # Primary: deduplicated random split. This is the model that ships.
    idx_train, idx_test = train_test_split(np.arange(len(rows)), test_size=0.2,
                                           random_state=args.seed, stratify=y_sent)
    primary, vec, model = evaluate_split("primary (random split, deduplicated)", texts, y_sent,
                                         y_risk, idx_train, idx_test, args, verbose=True)

    # ---- export -----------------------------------------------------------
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), OUT_DIR / "news_classifier.pt")

    def r6(t):
        return np.round(t.detach().numpy().astype(np.float64), 6).tolist()

    sd = model.state_dict()
    now = datetime.now(timezone.utc)
    export = {
        "name": "marketpulse-news-classifier",
        "version": now.strftime("%Y%m%d%H%M%S"),
        "trained_at": now.isoformat(),
        "labels": {"sentiment": SENTIMENTS, "risk": RISKS},
        "vectorizer": {
            "ngram_range": [1, 2], "sublinear_tf": True, "norm": "l2", "lowercase": True,
            "token_pattern": r"(?u)\b\w\w+\b",
            "vocabulary": {term: int(i) for term, i in vec.vocabulary_.items()},
            "idf": np.round(vec.idf_, 6).tolist(),
        },
        "architecture": {"input": len(vec.vocabulary_), "hidden": args.hidden, "activation": "relu",
                         "heads": ["sentiment", "risk"]},
        "weights": {
            "W1": r6(sd["shared.0.weight"]), "b1": r6(sd["shared.0.bias"]),
            "Ws": r6(sd["sentiment.weight"]), "bs": r6(sd["sentiment.bias"]),
            "Wr": r6(sd["risk.weight"]), "br": r6(sd["risk.bias"]),
        },
        "metrics": {"primary": primary, "stress_unseen_phrases": stress},
        "dataset": {"rows": len(rows), "train": int(len(idx_train)), "test": int(len(idx_test)),
                    "synthetic": True, "source": "ml/generate_dataset.py"},
    }
    with (OUT_DIR / "model.json").open("w", encoding="utf-8") as f:
        json.dump(export, f, separators=(",", ":"))

    # Parity fixtures: the Node inference port must reproduce these probabilities.
    fixtures_text = [texts[i] for i in idx_test[:40]] + [
        "Hackers breach bank systems, customer data stolen",
        "Company beats earnings and raises guidance",
        "Shares flat ahead of the Fed decision",
        "CEO resigns amid accounting probe",
        "Ünïcödé façade test — 10% drop",
    ]
    Xf = torch.tensor(vec.transform(fixtures_text).toarray(), dtype=torch.float32)
    with torch.no_grad():
        fs, fr = model(Xf)
    fixtures = [
        {"text": t, "sentiment": s, "risk": rk}
        for t, s, rk in zip(fixtures_text,
                            torch.softmax(fs, 1).numpy().round(6).tolist(),
                            torch.softmax(fr, 1).numpy().round(6).tolist())
    ]
    with (OUT_DIR / "parity_fixtures.json").open("w", encoding="utf-8") as f:
        json.dump(fixtures, f, indent=1, ensure_ascii=False)
    print(f"\nexported -> {OUT_DIR / 'model.json'}")


if __name__ == "__main__":
    main()
