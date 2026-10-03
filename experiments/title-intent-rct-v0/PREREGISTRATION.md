# gravity-title-intent-rct-v0: pre-registration

Registered by HORIZON SHIELD (The HORIZONs Co., Ltd.) on 2026-10-04, before the assignment exists.
Files fixed at registration: this document, `pages.json` (sha256 a26390d2da1bf0fd291ba522fab03bac113711a917d99c83350b5d3cd2f0e0ee), `rct.py`.

## Why

Across the 616 pages of shield.the-horizons-innovation.com, Bing's AI (Copilot, and the Bing index behind ChatGPT search) cited
46% of pages whose title asks for a price (相場, 費用, 価格, 単価), but 1 of 36 pages whose title frames a judgement
(これ高い, 高い？, 妥当) and 0 of 20 pages whose title carries ad wording (無料, AI診断, 今すぐ), among pages at least 60 days old
and less than 70% the same as another page (Bing Webmaster Tools AI page stats export of 2026-10-01; tools/gravity/gravity_fit_bing.py
at commit 9ba70707). That is an observation. Pages with judgement titles differ from price pages in other ways too.
This experiment asks whether the title alone is a cause.

## Hypothesis

H1: changing only the `<title>` of a page from judgement or ad wording to price wording raises the probability that Bing's AI
cites the page at least once.

## Units

The 35 pages in `pages.json`: every page in our sitemaps whose title contains judgement or ad wording, that was first published
at least 60 days before 2026-10-01, whose body text is less than 70% the same as any other of our pages, whose subject is a priced
piece of work, and that is not one of the 2026-09-15 monitor pages (souba/gaiheki, kyutoki, shiroari, toilet, gaiheki-150man,
yane-fukikae-slate-hiyou, yane-check, aimitsumori-tekisei-kakaku, kyutoki-20man). Pages about sales tactics or about our own
services (free inspection scams, EHN, inspect, kantei, widget and similar) are excluded because a price title would change what
they are about. Strata: `check_template` (18 pages built from the 2026-06-23 */-check template) and `other` (17).
The new title of every page is written in `pages.json` now, for both arms, before anyone knows which arm a page will be in.

## Intervention

Treatment: the `<title>` element is replaced by the registered new title. Nothing else on the page changes: body, h1, og:title,
description, URL, structured data and links stay as they are. Control: the page is not touched.
No other edit is made to any of the 35 pages until the last outcome is read, except a fix that cannot wait, which is logged in
DEVIATIONS.md with its date and reason.
Right after the titles change, all 35 pages (both arms) are sent to IndexNow in one request, so both arms are recrawled alike.

## Assignment

Within each stratum, pages are ordered by sha256("gravity-title-intent-rct-v0|" + H + "|" + page path), where H is the hash of
Bitcoin block 969,900 (lowercase hex). The first ceil(n/2) pages of each stratum are treatment: 9 of 18 and 9 of 17.
This folder is pushed to GitHub before block 969,900 is mined. Anyone can check the order of the two times (the GitHub commit
time and the block timestamp) and recompute the assignment with `python3 rct.py assign --block-hash <hash>` on a fresh copy.
The assignment is drawn once (`assignment.json`, with its own sha256) and never redrawn.

## Outcomes

Primary: for each page, Y = 1 if Bing Webmaster Tools AI Performance (page report) shows at least one citation for the date range
2026-11-09 to 2026-12-06, else 0.
Secondary: citation counts in the same range; Y and counts for 2026-12-07 to 2027-01-03; the first week a page is cited.
If the tool does not allow that exact range, the nearest available range ending on or after 2026-12-06 is used and the difference
is logged in DEVIATIONS.md.

## Analysis

Primary: pooled difference P(Y = 1 | treatment) minus P(Y = 1 | control), with a Newcombe 95% interval, and Fisher's exact test,
one-sided (treatment greater), alpha 0.05. All 35 pages are analysed in the arm they were assigned to.
Per-stratum results are reported, not tested. `python3 rct.py analyze <export.csv>` computes all of it.

Power (Fisher one-sided, 18 vs 17, control 3%): 0.88 if treatment reaches the observational 46%, 0.65 at 35%, 0.50 at 30%,
0.19 at 20%. A null result therefore rules out a large effect, not a small one.

## What follows

If H1 holds, the next experiment separates the title from the page: 2 x 2 (title price or judgement, body price or judgement).
If it does not, the observational gap comes from something else on those pages, and the title is not the lever.
Either way the result is published in this folder.
