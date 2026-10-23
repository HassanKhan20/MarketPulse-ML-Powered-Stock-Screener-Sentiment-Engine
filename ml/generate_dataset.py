"""Generate a labeled financial-news headline corpus.

Each headline carries two labels:
  sentiment: negative | neutral | positive
  risk:      none | earnings | legal | regulatory | debt | supply_chain |
             leadership | cyber | macro

Headlines are composed from interchangeable parts (company, price-move verb,
catalyst phrase, context tail), so the vocabulary of risk recurs across many
sentence shapes the way it does on a real newswire. Every row records which
catalyst phrase produced it (`template`), letting train.py hold out entire
phrases for an honest test of generalisation. ~8% of rows are mixed signals
("shares rise despite lawsuit": positive sentiment, legal risk) and ~4% of
sentiment labels are flipped to mimic annotator disagreement.

Usage: python generate_dataset.py [--n 12000] [--seed 7]
"""
import argparse
import csv
import random
from pathlib import Path

COMPANIES = [
    "Apex Dynamics", "Northwind Corp", "Helios Energy", "Vertex Bio", "Quantum Retail",
    "BlueRiver Bank", "Ironclad Motors", "Lumen Software", "Cobalt Mining", "Summit Health",
    "Orion Aerospace", "Pinnacle Foods", "Nimbus Cloud", "Atlas Logistics", "Crescent Pharma",
    "Redwood Media", "Solaris Semiconductors", "Harbor Insurance", "Evergreen Utilities",
    "Stratos Airlines", "Keystone Steel", "Polaris Telecom", "Granite REIT", "Falcon Defense",
    "Zenith Apparel", "Meridian Payments", "Aurora Gaming", "Titan Chemicals", "Cascade Water",
    "Beacon Robotics", "Sterling Capital", "Mosaic Health", "Vanguard Rail", "Echo Devices",
    "The company", "The firm", "The chipmaker", "The retailer", "The lender", "The automaker",
    "The drugmaker", "The insurer", "The airline", "The miner", "The bank", "The startup",
]
PCTS = ["2%", "3%", "4%", "5%", "6%", "7%", "8%", "10%", "12%", "15%", "18%", "22%", "30%"]
AMOUNTS = ["$50 million", "$120 million", "$300 million", "$1.2 billion", "$2 billion",
           "$450 million", "$800 million", "$5 billion"]
# Base-form verbs; conjugate() agrees them with "shares" (plural) or "stock" (singular).
UP = ["rise", "jump", "surge", "climb", "rally", "gain", "soar", "advance", "spike", "pop"]
DOWN = ["fall", "drop", "plunge", "tumble", "slide", "sink", "slump", "dive", "skid", "retreat"]
FLAT = ["edge", "hold steady", "trade flat", "be little changed", "drift", "be unchanged"]
TAILS = ["", "", "", " - analysts", " in early trading", " after the bell", " in premarket trading",
         " amid broad market volatility", " according to filings", " - sources", " - report",
         " as investors digest the news", " on heavy volume"]

# Catalyst phrases: (noun-phrase used after "on"/"after"/"despite", full-sentence predicate).
POS = [
    ("earnings beat", "beats quarterly earnings estimates"),
    ("raised guidance", "raises full-year guidance on strong demand"),
    ("record revenue", "posts record revenue as demand accelerates"),
    ("buyback announcement", "announces {a} share buyback"),
    ("analyst upgrade", "upgraded to buy by analysts citing growth"),
    ("FDA approval", "wins FDA approval for flagship drug"),
    ("contract win", "wins {a} government contract"),
    ("dividend hike", "raises dividend on robust cash flow"),
    ("margin expansion", "expands operating margin to record high"),
    ("strong subscriber growth", "tops subscriber growth forecasts"),
    ("blockbuster product launch", "unveils breakthrough product, orders exceed expectations"),
    ("strategic partnership", "strikes strategic partnership to accelerate growth"),
    ("credit upgrade", "credit rating upgraded on improving balance sheet"),
    ("record backlog", "reports record order backlog of {a}"),
    ("price target increase", "price target raised as profit outlook improves"),
    ("better-than-expected sales", "reports better-than-expected sales growth"),
    ("debt reduction", "pays down debt as free cash flow soars"),
    ("market share gains", "gains market share from rivals, profit climbs"),
    ("upbeat outlook", "issues upbeat outlook, sees strong growth ahead"),
    ("deal approval", "clears regulatory review, acquisition approved"),
    ("cost cuts boosting profit", "boosts profit with successful cost cuts"),
    ("strong holiday sales", "reports strong holiday sales, beats expectations"),
]
NEU = [
    ("upcoming earnings date", "to report quarterly results next week"),
    ("investor day", "schedules investor day for next month"),
    ("board appointment", "names new independent board member"),
    ("routine filing", "files routine quarterly report with SEC"),
    ("conference presentation", "to present at industry conference"),
    ("in-line results", "reports results in line with expectations"),
    ("regular dividend", "declares regular quarterly dividend"),
    ("headquarters move", "relocates headquarters to new campus"),
    ("index rebalance", "to join stock index in quarterly rebalance"),
    ("sustainability report", "publishes annual sustainability report"),
    ("notes offering", "prices {a} notes offering"),
    ("reaffirmed outlook", "reaffirms full-year outlook"),
    ("stock split completion", "completes previously announced stock split"),
    ("shareholder meeting", "sets date for annual shareholder meeting"),
    ("new office opening", "opens new regional office"),
    ("investor relations hire", "appoints new head of investor relations"),
    ("hold rating", "rating kept at hold by analysts"),
    ("fed meeting wait", "awaits fed decision with markets"),
    ("product update", "rolls out routine software update"),
]
NEG = {
    "earnings": [
        ("earnings miss", "misses quarterly earnings estimates"),
        ("guidance cut", "cuts full-year guidance as demand weakens"),
        ("profit warning", "issues profit warning on slowing sales"),
        ("surprise loss", "reports surprise quarterly loss"),
        ("revenue decline", "posts revenue decline as margins contract"),
        ("analyst downgrade", "downgraded to sell on weak earnings outlook"),
        ("asset writedown", "takes {a} writedown on impaired assets"),
        ("dividend suspension", "suspends dividend after earnings shortfall"),
        ("weak sales forecast", "forecasts weak sales, misses expectations"),
        ("shrinking margins", "warns margins will shrink further"),
    ],
    "legal": [
        ("class action lawsuit", "faces class action lawsuit from shareholders"),
        ("securities fraud suit", "sued by investors for securities fraud"),
        ("patent loss", "loses patent infringement case, owes {a}"),
        ("jury verdict", "ordered by jury to pay {a} in damages"),
        ("product liability suit", "hit with lawsuit over defective products"),
        ("employee litigation", "faces litigation from former employees"),
        ("court ruling", "loses contract dispute in court ruling"),
        ("fraud charges", "charged with fraud by federal prosecutors"),
        ("lawsuit settlement", "agrees to pay {a} to settle lawsuit"),
        ("whistleblower complaint", "accused of accounting fraud in whistleblower lawsuit"),
    ],
    "regulatory": [
        ("SEC investigation", "under SEC investigation over accounting"),
        ("regulatory fine", "fined {a} by regulators for compliance violations"),
        ("antitrust probe", "faces antitrust probe from regulators"),
        ("FDA rejection", "drug application rejected by FDA"),
        ("FDA warning letter", "receives FDA warning letter over manufacturing"),
        ("EU investigation", "targeted by EU antitrust investigation"),
        ("blocked merger", "merger blocked by competition regulators"),
        ("export sanctions", "hit by new export sanctions restrictions"),
        ("safety recall order", "ordered by safety regulator to recall products"),
        ("federal subpoena", "subpoenaed in federal regulatory probe"),
    ],
    "debt": [
        ("junk downgrade", "credit rating cut to junk by S&P"),
        ("liquidity crunch", "warns of liquidity crunch and going concern doubt"),
        ("missed bond payment", "misses bond payment as default fears rise"),
        ("debt restructuring", "seeks to restructure {a} of debt"),
        ("leverage concerns", "bonds tumble on mounting leverage concerns"),
        ("cash burn", "draws down credit line amid heavy cash burn"),
        ("bankruptcy fears", "explores bankruptcy filing"),
        ("covenant breach", "breaches loan covenants, lenders demand repayment"),
        ("Moody's downgrade", "downgraded by Moody's on rising debt load"),
        ("dwindling cash reserves", "says cash reserves dwindle as losses widen"),
    ],
    "supply_chain": [
        ("supply chain disruption", "halts production on supply chain disruption"),
        ("chip shortage", "cuts output due to chip shortage"),
        ("component shortages", "warns component shortages will last into next year"),
        ("port delays", "inventory squeezed by port and shipping delays"),
        ("factory fire", "factory fire disrupts shipments"),
        ("supplier bankruptcy", "production threatened by supplier bankruptcy"),
        ("raw material shortage", "cuts deliveries amid raw material shortage"),
        ("supply constraints", "delays product launch on supply constraints"),
        ("supplier strike", "assembly lines stalled by strike at key supplier"),
        ("logistics bottlenecks", "hit by logistics bottlenecks and freight costs"),
    ],
    "leadership": [
        ("CEO resignation", "CEO resigns abruptly amid board turmoil"),
        ("CFO departure", "CFO departs unexpectedly"),
        ("CEO firing", "fires chief executive after internal probe"),
        ("proxy fight", "faces proxy fight from activist investor"),
        ("insider selling", "executives sell shares ahead of bad news"),
        ("chairman ouster", "board ousts chairman over governance concerns"),
        ("succession worries", "leadership shakeup raises succession worries"),
        ("founder exit", "founder steps down amid misconduct allegations"),
        ("executive exodus", "senior executives exit in management exodus"),
    ],
    "cyber": [
        ("data breach", "discloses data breach exposing millions of customers"),
        ("ransomware attack", "systems shut down by ransomware attack"),
        ("cybersecurity incident", "reports cybersecurity incident disrupting operations"),
        ("customer data theft", "says hackers stole customer data"),
        ("cyberattack outage", "suffers outage blamed on cyberattack"),
        ("payment system breach", "investigates breach of payment systems"),
        ("data leak", "faces scrutiny after massive data leak"),
        ("network intrusion", "hit by network intrusion compromising client data"),
        ("hacker attack", "targeted by hackers in security breach"),
    ],
    "macro": [
        ("rising interest rates", "says rising interest rates are slowing demand"),
        ("recession fears", "outlook clouded by recession fears"),
        ("new tariffs", "warns new tariffs will hit profits"),
        ("strong dollar", "overseas revenue hurt by strong dollar"),
        ("economic slowdown", "cuts jobs as economic slowdown deepens"),
        ("inflation pressure", "margins squeezed by inflation pressure"),
        ("weak consumer spending", "hurt by weakening consumer spending"),
        ("trade war escalation", "exports threatened by trade war escalation"),
        ("bond yield spike", "pressured as bond yields spike"),
        ("geopolitical tensions", "operations disrupted by geopolitical tensions"),
    ],
}


def cap(s: str) -> str:
    return s[0].upper() + s[1:]


def conjugate(verb: str, singular: bool) -> str:
    head, _, rest = verb.partition(" ")
    if head == "be":
        head = "is" if singular else "are"
    elif singular:
        head = head[:-1] + "ies" if head.endswith("y") and head[-2] not in "aeiou" else head + "s"
    return f"{head} {rest}".strip()


def subject_verb(co: str, verb_pool, rng: random.Random) -> str:
    singular = rng.random() < 0.5
    noun = "stock" if singular else "shares"
    return f"{co} {noun} {conjugate(rng.choice(verb_pool), singular)}"


def render(co: str, verb_pool, cause: str, rng: random.Random, linker: str) -> str:
    move = rng.choice(["", rng.choice(PCTS) + " "])
    return f"{subject_verb(co, verb_pool, rng)} {move}{linker} {cause}"


def headline(kind: str, phrase, rng: random.Random) -> str:
    noun, pred = phrase
    co = rng.choice(COMPANIES)
    pred = pred.format(a=rng.choice(AMOUNTS))
    style = rng.random()
    if kind == "neutral":
        if style < 0.6:
            text = f"{co} {pred}"
        else:
            text = f"{subject_verb(co, FLAT, rng)} ahead of {noun}"
    elif kind == "positive":
        if style < 0.5:
            text = f"{co} {pred}"
        else:
            text = render(co, UP, noun, rng, rng.choice(["on", "after", "following"]))
    else:
        if style < 0.5:
            text = f"{co} {pred}"
        else:
            text = render(co, DOWN, noun, rng, rng.choice(["on", "after", "following", "amid"]))
    return cap(text.replace("  ", " ") + rng.choice(TAILS))


def generate(n: int, seed: int):
    rng = random.Random(seed)
    rows = []
    for _ in range(n):
        r = rng.random()
        if r < 0.30:
            sent, risk, pool = "positive", "none", POS
        elif r < 0.54:
            sent, risk, pool = "neutral", "none", NEU
        else:
            risk = rng.choice(list(NEG.keys()))
            sent, pool = "negative", NEG[risk]
        t = rng.randrange(len(pool))
        template = f"{sent}:{risk}:{t}"

        if risk != "none" and rng.random() < 0.08:
            # Mixed signal: the market shrugs off a risk event.
            co = rng.choice(COMPANIES)
            text = cap(f"{subject_verb(co, UP, rng)} despite {pool[t][0]}" + rng.choice(TAILS))
            sent = "positive"
        else:
            text = headline(sent, pool[t], rng)

        if rng.random() < 0.04:
            sent = rng.choice(["negative", "neutral", "positive"])
        rows.append({"text": text, "sentiment": sent, "risk": risk, "template": template})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=12000)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    out = Path(__file__).parent / "data" / "financial_news.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    rows = generate(args.n, args.seed)
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["text", "sentiment", "risk", "template"])
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {len(rows)} rows -> {out}")


if __name__ == "__main__":
    main()
