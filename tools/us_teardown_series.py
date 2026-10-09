#!/usr/bin/env python3
"""Quote Teardowns: the U.S. edition of the 見積書の解剖 series (/us/teardowns/).

Each issue takes one illustrative contractor quote for a common U.S. home job and shows
the one line a homeowner should question, with public numbers and their sources.

Usage:
  python3 tools/us_teardown_series.py --out .                     # write the HTML pages
  python3 tools/us_teardown_series.py --out . --img-html DIR      # also write the square card HTML
  python3 tools/us_teardown_series.py --out . --img-html DIR --render   # and render the cards to
                                                                        # us/teardowns/img/NN.png at 2160x2160
                                                                        # (needs playwright; everything else is stdlib)
  python3 tools/us_teardown_series.py --selftest [--root .]       # checks; --root also resolves site links

Rules kept by this file:
  * It only overwrites files that carry MARK, so hand-written pages are never replaced.
  * Quotes are illustrative and labelled so. Every public number sits in a case's `facts`
    with a source key, or in `derived` with a formula the selftest recomputes.
  * Only Texas has a published loading rule used here (TxDOT Item 9). Elsewhere the BLS wage
    is shown plain, and the page says it excludes the contractor's insurance, taxes and markup.
  * No em dashes, en dashes or horizontal bars anywhere.

To add an issue: append a dict to CASES, run --selftest, then --out . --img-html DIR --render.
"""
import argparse, html, json, os, re, sys

BASE = "https://shield.the-horizons-innovation.com"
MARK = "<!-- generated: us_teardown_series.py -->"
DATE = "2026-10-09"
DATE_TEXT = "October 9, 2026"
CTA = "/us/teardown/?from=series"
CHECK = "/us/#check"
ORG_ID = f"{BASE}/us/#org"
TOSHI_ID = f"{BASE}/us/#toshi"

# Every public number on the pages points at one of these.
SOURCES = {
    "bls": ("U.S. Bureau of Labor Statistics, Occupational Employment and Wage Statistics, May 2025, "
            "metropolitan area data (oesm25ma.zip)", "https://www.bls.gov/oes/special-requests/oesm25ma.zip"),
    "bls_tables": ("U.S. Bureau of Labor Statistics, OEWS tables", "https://www.bls.gov/oes/tables.htm"),
    "txdot": ("Texas Department of Transportation, Standard Specifications 2024, Item 9, Measurement and Payment, "
              "Articles 9.7.1.1 to 9.7.1.3", "https://ftp.txdot.gov/pub/txdot-info/cmd/cserve/specs/2024/standard/s009.pdf"),
    "irc14": ("International Code Council, 2021 International Residential Code, Chapter 14, Section M1401.3 "
              "Equipment and appliance sizing", "https://codes.iccsafe.org/content/IRC2021P2/chapter-14-heating-and-cooling-equipment-and-appliances"),
    "hayward": ("City of Hayward, CA, Residential Water Heater Replacement (handout 005)",
                "https://www.hayward-ca.gov/sites/default/files/documents/005-Residential-Water-Heater-Replacement.pdf"),
    "epa_rrp": ("U.S. Environmental Protection Agency, Lead Renovation, Repair and Painting Program",
                "https://www.epa.gov/lead/renovation-repair-and-painting-program"),
    "cfr745_82": ("40 CFR 745.82, Applicability (Residential Property Renovation)",
                  "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-R/part-745/subpart-E/section-745.82"),
    "cfr745_83": ("40 CFR 745.83, Definitions (minor repair and maintenance activities; renovation)",
                  "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-R/part-745/subpart-E/section-745.83"),
    "cfr745_84": ("40 CFR 745.84, Information distribution requirements (the EPA pamphlet)",
                  "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-R/part-745/subpart-E/section-745.84"),
    "cfr429": ("Federal Trade Commission, Cooling-Off Rule, 16 CFR Part 429",
               "https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-429"),
    "usccdb": ("United States Construction Cost Database (USCCDB) v1.0, doi:10.5281/zenodo.22979157, CC BY 4.0",
               "https://doi.org/10.5281/zenodo.22979157"),
}

GUIDES = {
    "roof": ("/us/guides/is-my-roofing-quote-too-high/", "Is my roofing quote too high?"),
    "rates": ("/us/guides/trades-hourly-rates-austin-tx/", "What trades earn per hour in Austin, TX"),
    "op": ("/us/guides/overhead-and-profit-on-a-contractor-quote/", "Overhead and profit on a contractor quote"),
    "lead": ("/us/guides/lead-paint-rrp-certified-contractor/", "Lead paint and the RRP certified contractor"),
    "today": ("/us/guides/price-good-only-today/", "The contractor says the price is only good today"),
    "scope": ("/us/guides/scope-of-work-before-quotes/", "Write the scope of work before you get quotes"),
    "deposit": ("/us/guides/contractor-deposit-how-much/", "How much deposit should a contractor ask for?"),
}

# Each case:
#   quote: (line, amount in USD (int, negative for a credit), note, focal?)
#   card:  (line, quoted text, public reference text, mark, focal?)  3 to 4 rows on the 1080 card
#   facts: (token as printed, what it is, source key)  every public number
#   derived: (token as printed, python expression)  recomputed by --selftest
#   qx: extra illustrative tokens that belong to the quote (rates, percentages)
CASES = [
 {"no": "01", "photo": "roof2", "alt": "A roofer driving nails with a pneumatic nailer as he lays architectural shingles on a roof, under a clear sky.", "sub": "Labor works out to $75.00 per crew hour. BLS wage x TxDOT loading: $43.34 to $59.83.", "job": "Roof replacement", "place": "Austin, TX",
  "title": "$19,872 for a 24-square roof in Austin. Which line do I ask about?",
  "headline": "$19,872 for a 24-square roof. Which line do I ask about?",
  "desc": "An illustrative $19,872 Austin roof quote. The labor line works out to $75.00 per crew hour; BLS wages with the TxDOT loading give $43.34 to $59.83. The math and what to ask.",
  "lede": "Look at the labor line first. Three roofers for four days is 96 crew hours, and $7,200 for 96 hours is $75.00 an hour. The BLS wage for roofers in the Austin metro, loaded with the Texas DOT markup for overhead, profit, insurance and taxes, gives $43.34 to $59.83 an hour. That gap is the question.",
  "quote": [("Tear-off and haul-away, 1 layer", 2400, "", False),
            ("Shingles, architectural, 24 squares", 7920, "Product name not given", False),
            ("Underlayment, flashing, vents", 2352, "Lump sum", False),
            ("Labor, 3 roofers x 4 days", 7200, "The line to ask about", True)],
  "focal": "Labor, 3 roofers x 4 days: $7,200",
  "why": ["It is the one line on this quote that public data can check directly. The crew size and the days are written down, so the hours are known.",
          "The Texas Department of Transportation pays contractors for extra work at the payroll rate plus 25% \"as compensation for overhead, superintendence, profit, and small tools\" (Item 9, Article 9.7.1.1), plus 55% of the labor cost for labor insurance and labor taxes (Article 9.7.1.2). Applied to the BLS May 2025 wage for roofers in the Austin metro, that gives a loaded crew hour of $43.34 at the mean wage and $59.83 at the 90th percentile.",
          "The 25% in that factor already covers overhead and profit. The quote's $75.00 per crew hour is $15.17 above even the 90th percentile loaded rate."],
  "math": ["Crew hours: 3 roofers x 4 days x 8 hours = 96",
           "Loading: 1 + 25% + 55% = 1.80 (TxDOT Item 9)",
           "Loaded rate at the mean wage: $24.08 x 1.80 = $43.34 per crew hour",
           "Loaded rate at the 90th percentile wage: $33.24 x 1.80 = $59.83 per crew hour",
           "Reference for 96 crew hours: $4,161 to $5,744",
           "Quoted: $7,200, which is $75.00 per crew hour and $1,456 above the upper reference"],
  "ask": "Thanks for the quote. Before I decide, could you tell me:\n1. How many people and how many days the $7,200 labor line assumes, and whether anything else (accessories, cleanup, the dumpster) is folded into it.\n2. The shingle product name and the number of squares, including the waste percentage.\n3. How many layers the tear-off assumes.\n4. The product names for the underlayment, flashing and vents.\nI'm comparing quotes line by line, so the breakdown helps.",
  "limits": "It does not show the quote is unfair. A steep pitch, a second layer, a two-story walk or a crew that also hauls and cleans can all justify more hours or a higher rate. The BLS wage is an average of what roofers are paid, not what a contractor bills, and the DOT loading is a public-works payment rule, not a law for home repairs. It tells you which line to ask about and what a good answer has to explain.",
  "faq": [("Is $75 an hour too much for a roofing crew in Austin?", "Not necessarily. It is above the $43.34 to $59.83 loaded reference built from BLS wages and the TxDOT loading, so it is worth asking what the rate covers. A steep pitch, extra layers or work folded into labor are honest answers."),
          ("Why use a Texas DOT rule for a home roof?", "It is a published Texas rule that states how much to add to a wage for overhead, profit, insurance and taxes: 25% plus 55% on base wages. It is a reference point, not a price the contractor has to follow."),
          ("What should I ask first?", "The crew size and the days behind the labor line. Without them no one can check the hours.")],
  "card": [("Labor, 3 x 4 days", "$7,200", "$4,161 to $5,744 loaded", "ASK", True),
           ("Shingles, 24 sq", "$7,920", "Ask for the product name", "NO REF", False),
           ("Tear-off, haul-away", "$2,400", "No public benchmark", "NO REF", False),
           ("Underlayment, vents", "$2,352", "No public benchmark", "NO REF", False)],
  "facts": [("$24.08", "Roofers (SOC 47-2181), Austin-Round Rock-San Marcos, TX, mean hourly wage, May 2025", "bls"),
            ("$33.24", "Roofers (SOC 47-2181), Austin-Round Rock-San Marcos, TX, 90th percentile hourly wage, May 2025", "bls"),
            ("25%", "TxDOT Item 9, Article 9.7.1.1: overhead, superintendence, profit and small tools, on payroll", "txdot"),
            ("55%", "TxDOT Item 9, Article 9.7.1.2: labor insurance and labor taxes, on labor cost", "txdot")],
  "derived": [("1.80", "1 + 0.25 + 0.55"), ("$43.34", "24.08 * 1.80"), ("$59.83", "33.24 * 1.80"),
              ("$4,161", "96 * 24.08 * 1.80"), ("$5,744", "96 * 33.24 * 1.80"), ("$75.00", "7200 / 96"),
              ("$1,456", "7200 - 5744"), ("$15.17", "7200 / 96 - 33.24 * 1.80"), ("$75", "7200 / 96")],
  "qx": [],
  "sources": ["bls", "txdot", "usccdb"], "related": ["roof", "rates", "op"],
  "x": "Austin roof quote: $7,200 labor for 3 roofers x 4 days is $75.00 a crew hour. BLS wage x TxDOT loading gives $43.34 to $59.83. Ask what the rate covers."},

 {"no": "02", "photo": "hvac", "alt": "An HVAC technician kneeling at an outdoor air conditioning condenser beside a house, checking it with refrigerant gauges.", "sub": "The biggest line is sized \"to match existing.\" No load calculation is shown.", "job": "HVAC replacement", "place": "Phoenix, AZ",
  "title": "$14,850 for a 4-ton AC in Phoenix. Who decided it was 4 tons?",
  "headline": "$14,850 for a 4-ton system. Who decided it was 4 tons?",
  "desc": "An illustrative $14,850 Phoenix HVAC quote sized \"to match existing\" with no load calculation. What the International Residential Code says about sizing, and what to ask.",
  "lede": "The equipment line says 4 tons, sized to match the existing unit. Nothing on the quote shows a load calculation. The model code many cities adopt, the International Residential Code, says equipment is sized with ACCA Manual S based on loads calculated with ACCA Manual J or another approved method. Ask for the calculation before you sign.",
  "quote": [("Heat pump and air handler, 4 tons, 16 SEER2, sized to match existing", 9950, "No load calculation listed", True),
            ("Labor, 2 technicians x 2 days", 3400, "", False),
            ("Line set, pad, disconnect, thermostat", 1050, "", False),
            ("Permit and haul-away of old unit", 450, "", False)],
  "focal": "Heat pump and air handler, 4 tons, sized to match existing: $9,950",
  "why": ["Tonnage sets the price of the biggest line, and \"match existing\" only repeats whatever size went in last time, right or wrong. Insulation, windows and duct work changed since then all move the load.",
          "Section M1401.3 of the 2021 International Residential Code reads: heating and cooling equipment \"shall be sized in accordance with ACCA Manual S or other approved sizing methodologies based on building loads calculated in accordance with ACCA Manual J or other approved heating and cooling calculation methodologies.\" Whether your city adopted that section, and how it treats a replacement, is a question for your building department.",
          "The labor line can be set against wages, but only as plain wages. Arizona has no published loading rule that we use, so the BLS figures below exclude the contractor's insurance, payroll taxes, truck, overhead and profit."],
  "math": ["Labor hours: 2 technicians x 2 days x 8 hours = 32",
           "BLS wage, heating, air conditioning and refrigeration mechanics and installers (SOC 49-9021), Phoenix metro, May 2025: $29.91 mean, $39.99 at the 90th percentile",
           "Plain wages for 32 hours: $957 to $1,280",
           "Quoted labor: $3,400, or $106.25 per hour. The difference is the contractor's insurance, taxes, overhead and profit, plus anything else in the line. No public rule says how large it should be in Arizona."],
  "ask": "Before I decide, could you send:\n1. The Manual J load calculation (or the method you used) showing this house needs 4 tons.\n2. The Manual S equipment selection, or the model numbers and their capacity at our design temperature.\n3. Whether the permit line covers the city's mechanical permit, and the permit number once it's pulled.\n4. What the $3,400 labor line includes besides installation hours.",
  "limits": "It does not show that 4 tons is wrong. A load calculation may land on the same size. It shows that the quote does not say how the size was chosen, and size sets the price of the largest line. The wage figures are averages of what technicians are paid, not billing rates.",
  "faq": [("Do I need a Manual J load calculation for a replacement AC?", "Ask your city. The International Residential Code, Section M1401.3, calls for sizing with Manual S on loads from Manual J or another approved method. Adoption, and how it applies to replacements, varies by city."),
          ("What if the contractor won't run a load calculation?", "Ask how they chose the size, in writing. A contractor who sized it carefully can explain it. A quote that only says \"match existing\" has not explained it.")],
  "card": [("Equipment, 4 tons", "$9,950", "Load calc (Manual J) not shown", "ASK", True),
           ("Labor, 2 x 2 days", "$3,400", "$957 to $1,280 plain wages", "WAGE", False),
           ("Line set, pad, thermostat", "$1,050", "No public benchmark", "NO REF", False),
           ("Permit, haul-away", "$450", "Ask for the permit number", "RECEIPT", False)],
  "facts": [("$29.91", "HVAC mechanics and installers (SOC 49-9021), Phoenix-Mesa-Chandler, AZ, mean hourly wage, May 2025", "bls"),
            ("$39.99", "HVAC mechanics and installers (SOC 49-9021), Phoenix-Mesa-Chandler, AZ, 90th percentile hourly wage, May 2025", "bls"),
            ("M1401.3", "Sizing by ACCA Manual S on loads by ACCA Manual J or other approved methods", "irc14")],
  "derived": [("$957", "32 * 29.91"), ("$1,280", "32 * 39.99"), ("$106.25", "3400 / 32")],
  "qx": [],
  "sources": ["irc14", "bls", "usccdb"], "related": ["scope", "deposit"],
  "x": "Phoenix AC quote: $9,950 for 4 tons \"sized to match existing.\" No load calculation. IRC M1401.3 sizes equipment by Manual S on Manual J loads. Ask how they got 4 tons."},

 {"no": "03", "photo": "waterheater", "alt": "A plumber at a tank water heater in a garage, with a thermal expansion tank mounted on the cold-water line above it.", "sub": "In Hayward the tank is required only with a check valve, backflow preventer or pressure regulator.", "job": "Water heater replacement", "place": "Hayward, CA",
  "title": "$3,480 to replace a water heater in Hayward, CA. Which add-ons are required?",
  "headline": "$3,480 for a water heater. Which add-ons are required?",
  "desc": "An illustrative $3,480 water heater quote in Hayward, CA, with an expansion tank, a permit and a haul-away. Which ones the city requires, and what to ask.",
  "lede": "Short lines sit under the water heater: an expansion tank, a permit, a haul-away. In Hayward, the city requires a permit for any water heater replacement, and an expansion tank for any system with a check valve, backflow preventer or pressure regulator. So the question about the $385 tank is not whether it is fair but whether your house has one of those devices.",
  "quote": [("Water heater, 50 gallon gas, installed", 2450, "Model number not given", False),
            ("Thermal expansion tank", 385, "The line to ask about", True),
            ("Permit", 295, "", False),
            ("Haul-away of old tank", 175, "", False),
            ("Seismic straps, flex connectors, vent", 175, "", False)],
  "focal": "Thermal expansion tank: $385",
  "why": ["The City of Hayward's handout on residential water heater replacement says \"A plumbing permit is required to install, remove, replace or relocate a water heater\", that \"An expansion tank is required for any system with a check valve, backflow preventer or pressure regulator\", and that seismic straps go in the upper and lower third of the tank.",
          "That makes the expansion tank a yes-or-no question about your plumbing, not a price question. If your supply has one of those devices, the tank belongs on the quote. If it has none, ask why it is there.",
          "The permit line should come with a permit number and a final inspection; the handout says a final inspection is required after the water heater is installed. The handout does not list the fee, so no fee is shown here. Haul-away has no public benchmark."],
  "math": ["Add-on lines: $385 + $295 + $175 + $175 = $1,030, or 30% of the $3,480 total",
           "BLS wage, plumbers, pipefitters and steamfitters (SOC 47-2152), San Francisco-Oakland-Fremont metro, May 2025: $44.41 mean, $74.68 at the 90th percentile. Plain wages, without the contractor's insurance, taxes and markup.",
           "The installed line does not separate labor from the heater, so the wage cannot be set against it. Ask for the model number and the labor hours separately."],
  "ask": "Before I schedule, could you tell me:\n1. Which device makes the expansion tank necessary here: a check valve, a backflow preventer or a pressure regulator? Where is it?\n2. The permit number once it's pulled, and whether the price includes the final inspection.\n3. The model number of the water heater, and the labor hours apart from the heater.\n4. Whether the $175 haul-away is a flat fee or a disposal charge.",
  "limits": "It does not price any line. Hayward's handout says what is required, not what it should cost, and a tank, a permit and a haul-away can all be honest. The point is to know which are required at your house and to get proof that the permit and the inspection happen. Other cities set their own rules.",
  "faq": [("Is an expansion tank required when you replace a water heater?", "In Hayward, CA, the city's handout says an expansion tank is required for any system with a check valve, backflow preventer or pressure regulator. Other cities set their own rules; ask your building department."),
          ("Do I need a permit to replace a water heater in Hayward?", "Yes. The city's handout says a plumbing permit is required to install, remove, replace or relocate a water heater, and a final inspection is required after installation.")],
  "card": [("Expansion tank", "$385", "Required with a check valve, backflow preventer or regulator", "ASK", True),
           ("Permit", "$295", "Required; fee not in the handout", "RECEIPT", False),
           ("Haul-away", "$175", "No public benchmark", "NO REF", False),
           ("Heater, installed", "$2,450", "Ask for the model number", "NO REF", False)],
  "facts": [("$44.41", "Plumbers, pipefitters and steamfitters (SOC 47-2152), San Francisco-Oakland-Fremont, CA, mean hourly wage, May 2025", "bls"),
            ("$74.68", "Plumbers, pipefitters and steamfitters (SOC 47-2152), San Francisco-Oakland-Fremont, CA, 90th percentile hourly wage, May 2025", "bls"),
            ("permit", "Plumbing permit required to install, remove, replace or relocate a water heater; final inspection required", "hayward"),
            ("expansion tank", "Required for any system with a check valve, backflow preventer or pressure regulator", "hayward")],
  "derived": [("$1,030", "385 + 295 + 175 + 175"), ("30%", "1030 / 3480 * 100")],
  "qx": [],
  "sources": ["hayward", "bls", "usccdb"], "related": ["scope", "deposit"],
  "x": "Hayward water heater quote: $385 for an expansion tank. The city requires one only with a check valve, backflow preventer or pressure regulator. Ask which you have."},

 {"no": "04", "photo": "windows", "alt": "Two installers leveling a replacement window in the wall of an older house, with the old sash leaning against the wall.", "sub": "One window more or less moves the total by $1,330. Insert or full-frame is not stated.", "job": "Window replacement", "place": "Chicago, IL",
  "title": "$16,560 for 12 windows in Chicago. Do I have 12, and what kind of install?",
  "headline": "$16,560 for 12 windows. Do I have 12, and what kind?",
  "desc": "An illustrative $16,560 Chicago window quote: 12 windows at $1,150, insert or full-frame not stated, in a 1958 house where federal lead-safe rules apply. What to ask.",
  "lede": "A price per window is only as good as the count and the method behind it. This quote says 12 windows at $1,150 but never says whether they are inserts set into the old frames or full-frame replacements. And the house was built in 1958, so federal lead-safe rules apply to replacing its windows.",
  "quote": [("Vinyl double-hung windows, 12 @ $1,150", 13800, "Insert or full-frame not stated", True),
            ("Installation, 12 @ $180", 2160, "", False),
            ("Exterior capping and interior trim", 600, "", False)],
  "focal": "Vinyl double-hung windows, 12 @ $1,150: $13,800",
  "why": ["Walk the house and count. One window more or less moves the total by $1,330 ($1,150 plus $180 to install), so a quote that counts a basement window you meant to keep is not a small error.",
          "Then ask which method. An insert fits inside the existing frame; a full-frame replacement takes the old frame out to the rough opening. They are different jobs, and the quote has to say which one it prices, window by window.",
          "Because the house was built before 1978, EPA's Renovation, Repair and Painting Rule applies. Under 40 CFR 745.83, work counts as minor repair only where it \"does not involve window replacement\", so replacing windows in a pre-1978 home is covered however small. The firm must be lead-safe certified and must give you EPA's lead pamphlet no more than 60 days before work starts (40 CFR 745.84). Nothing on this quote mentions it."],
  "math": ["Per window, all in: $16,560 / 12 = $1,380",
           "One window more or less: $1,150 + $180 = $1,330",
           "Installation per window: $180. At the BLS May 2025 mean wage for glaziers (SOC 47-2121) in the Chicago metro, $35.62 an hour, that is 5.05 hours of wages per window, before the contractor's insurance, taxes and markup. The 90th percentile wage is $49.22."],
  "ask": "Before I decide, could you confirm in writing:\n1. Which 12 openings are included (a list by room is fine).\n2. Whether each window is an insert or a full-frame replacement.\n3. Your EPA lead-safe firm certification, since the house was built in 1958, and that you'll give me the lead pamphlet before work starts.\n4. The window product name, and what the capping and trim line covers.",
  "limits": "It does not say $1,150 is too much for a window. No public source here prices residential windows. It shows that the count and the method are missing, and both change what you are buying. The glazier wage is an average of pay, not a billing rate.",
  "faq": [("Does the EPA lead rule apply to window replacement?", "In homes built before 1978, yes. 40 CFR 745.83 excludes window replacement from the minor repair exception, so the work must be done by a lead-safe certified firm."),
          ("What is the difference between insert and full-frame windows?", "An insert goes inside the existing frame. A full-frame replacement removes the old frame to the rough opening. Ask the quote to say which, window by window.")],
  "card": [("Windows, 12 @ $1,150", "$13,800", "Count yours. Insert or full-frame?", "ASK", True),
           ("Install, 12 @ $180", "$2,160", "Glazier wage $35.62/h, plain", "WAGE", False),
           ("Capping and trim", "$600", "No public benchmark", "NO REF", False),
           ("Lead-safe work, 1958 house", "Not listed", "Required for window replacement", "MISSING", False)],
  "facts": [("$35.62", "Glaziers (SOC 47-2121), Chicago-Naperville-Elgin, IL-IN, mean hourly wage, May 2025", "bls"),
            ("$49.22", "Glaziers (SOC 47-2121), Chicago-Naperville-Elgin, IL-IN, 90th percentile hourly wage, May 2025", "bls"),
            ("1978", "RRP applies to paid work disturbing paint in homes built before 1978", "epa_rrp"),
            ("window replacement", "Minor repair exception excludes window replacement", "cfr745_83"),
            ("60 days", "Pamphlet no more than 60 days before renovation", "cfr745_84")],
  "derived": [("$1,380", "16560 / 12"), ("$1,330", "1150 + 180"), ("5.05", "180 / 35.62")],
  "qx": [],
  "sources": ["epa_rrp", "cfr745_83", "cfr745_84", "bls", "usccdb"], "related": ["lead", "scope"],
  "x": "Chicago window quote: 12 @ $1,150. Count your windows. Ask: insert or full-frame? In a 1958 house, EPA lead-safe rules cover window replacement. The quote is silent."},

 {"no": "05", "photo": "paint", "alt": "A painter in a respirator scraping peeling paint from 1950s wood clapboard siding, with plastic sheeting laid below to catch the chips.", "sub": "Prep is \"as needed.\" Coats are not stated. Pre-1978 paint brings EPA lead-safe rules.", "job": "Exterior painting", "place": "Philadelphia, PA",
  "title": "$9,800 to paint a 1952 house in Philadelphia. How many coats, and is it lead-safe?",
  "headline": "$9,800 to paint a 1952 house. How many coats? Lead-safe?",
  "desc": "An illustrative $9,800 exterior painting quote for a 1952 Philadelphia house: prep \"as needed\", coats not stated, no lead-safe work. The EPA rule and what to ask.",
  "lede": "The prep line says \"as needed\" and the paint line says \"premium.\" Neither says how much scraping, how many coats or which product. On a house built before 1978, the scraping is also where federal lead-safe rules come in.",
  "quote": [("Prep: wash, scrape, caulk, as needed", 1200, "The line to ask about", True),
            ("Paint body and trim, premium paint", 7600, "Coats and product not stated", False),
            ("Cleanup", 1000, "", False)],
  "focal": "Prep: wash, scrape, caulk, as needed: $1,200",
  "why": ["\"As needed\" means the quote does not say how much prep you are buying. Ask what will be scraped, how, and what gets primed.",
          "EPA's Renovation, Repair and Painting Rule covers paid work that disturbs painted surfaces in homes built before 1978. Under 40 CFR 745.83, exterior work counts as minor repair only if it disturbs 20 square feet or less of painted surface. Scraping a whole house is far past that, so the contractor must be a certified firm using lead-safe work practices, and must give you EPA's lead pamphlet no more than 60 days before work starts (40 CFR 745.84).",
          "The exceptions are narrow: 40 CFR 745.82 lists a written determination by an inspector or risk assessor, or testing by a certified renovator, showing the components are free of lead-based paint. Without one, treat the rule as applying.",
          "Then the paint line: one coat or two, and which product. Two quotes that differ by a coat are not the same job."],
  "math": ["BLS wage, painters, construction and maintenance (SOC 47-2141), Philadelphia-Camden-Wilmington metro, May 2025: $27.79 mean, $37.00 at the 90th percentile. Plain wages, without the contractor's insurance, taxes and markup.",
           "Prep at $1,200 is 43.2 hours of painter wages at the mean, or 32.4 hours at the 90th percentile, before markup. Ask how many hours the contractor expects.",
           "Lead-safe threshold for exterior work: more than 20 square feet of disturbed paint (40 CFR 745.83)."],
  "ask": "Before I decide, could you put in writing:\n1. What prep includes: the scraping method, how much, and which areas get primed.\n2. The paint product name and the number of coats on the body and on the trim.\n3. Your EPA lead-safe firm certification, since the house was built in 1952, and how you will contain and clean up paint chips.\n4. That you'll give me the EPA lead pamphlet before work starts.",
  "limits": "It does not say $9,800 is too much. It says the quote does not describe the work well enough to compare it with another quote, and that a legal requirement for a 1952 house is missing from the page. Lead-safe work costs more than ordinary prep, so a quote that is cheaper because it skips it is not a bargain.",
  "faq": [("Does the EPA lead rule apply to exterior painting?", "For paid work on homes built before 1978, yes, once more than 20 square feet of exterior painted surface is disturbed (40 CFR 745.83). The contractor must be a certified firm."),
          ("What should a painting quote say?", "The prep in plain terms, the product name, and the number of coats for the body and the trim. Without those, two quotes cannot be compared.")],
  "card": [("Prep, as needed", "$1,200", "1952 house: lead-safe rules over 20 sq ft", "ASK", True),
           ("Paint, premium", "$7,600", "Coats and product not stated", "NO SPEC", False),
           ("Cleanup", "$1,000", "No public benchmark", "NO REF", False)],
  "facts": [("$27.79", "Painters, construction and maintenance (SOC 47-2141), Philadelphia-Camden-Wilmington, PA-NJ-DE-MD, mean hourly wage, May 2025", "bls"),
            ("$37.00", "Painters, construction and maintenance (SOC 47-2141), Philadelphia-Camden-Wilmington, PA-NJ-DE-MD, 90th percentile hourly wage, May 2025", "bls"),
            ("1978", "RRP applies to paid work disturbing paint in homes built before 1978", "epa_rrp"),
            ("20 square feet", "Exterior minor repair limit: 20 square feet or less of painted surface", "cfr745_83"),
            ("60 days", "Pamphlet no more than 60 days before renovation", "cfr745_84")],
  "derived": [("43.2", "1200 / 27.79"), ("32.4", "1200 / 37.00")],
  "qx": [],
  "sources": ["epa_rrp", "cfr745_82", "cfr745_83", "cfr745_84", "bls", "usccdb"], "related": ["lead", "scope"],
  "x": "Paint quote for a 1952 house: prep \"as needed,\" coats not stated. Scraping over 20 sq ft on a pre-1978 home needs an EPA lead-safe firm. Ask for coats and certification."},

 {"no": "06", "photo": "bath", "alt": "A tile setter setting wall tile in a shower during a bathroom remodel, with tile boxes and a bucket of thinset on the floor.", "sub": "Pick $14 tile instead of $6 and the tile line goes from $720 to $1,680.", "job": "Bathroom remodel", "place": "Seattle, WA",
  "title": "$28,400 for a bathroom in Seattle, with $4,650 in allowances. What happens when I pick more?",
  "headline": "$28,400 bathroom. $4,650 of it is allowances. Then what?",
  "desc": "An illustrative $28,400 Seattle bathroom quote with $4,650 in allowances for tile, fixtures and the vanity. What an allowance buys, how overages work, and what to ask.",
  "lede": "An allowance is a placeholder: the contractor guesses what you will choose and prices the guess. Here, tile, fixtures and the vanity are allowances adding up to $4,650. The quote does not say what each allowance buys or how overages are charged, so the real price is not on the page yet.",
  "quote": [("Demolition and haul-away", 2800, "", False),
            ("Waterproofing and backer board", 1700, "", False),
            ("Tile installation, floor and shower walls", 6400, "", False),
            ("Tile allowance, 120 sq ft @ $6", 720, "The line to ask about", True),
            ("Plumbing fixture allowance", 2400, "Allowance", False),
            ("Vanity and top allowance", 1530, "Allowance", False),
            ("Plumbing", 4200, "", False),
            ("Electrical", 2350, "", False),
            ("Drywall and paint", 1800, "", False),
            ("Project management and cleanup", 4500, "", False)],
  "focal": "Tile allowance, 120 sq ft @ $6: $720",
  "why": ["$6 a square foot is a guess about the tile you will pick. If the tile you choose costs more, the difference comes back as a change order. Some contracts add the contractor's markup to that difference; the quote has to say whether this one does.",
          "Ask three things about every allowance: what product the number assumes, whether it is at the contractor's cost or at retail, and how an overage is billed.",
          "The tile installation line can be set against wages, as plain wages only. Washington has no published loading rule that we use."],
  "math": ["Allowances: $720 + $2,400 + $1,530 = $4,650, or 16% of the $28,400 total",
           "Example: you choose tile at $14 a square foot. 120 x $14 = $1,680. Overage: $1,680 - $720 = $960, before any markup on the overage.",
           "Tile installation: $6,400. BLS wage for tile and stone setters (SOC 47-2044), Seattle metro, May 2025: $39.65 mean, $50.20 at the 90th percentile. $6,400 is 161 hours of wages at the mean (127 at the 90th percentile), before the contractor's insurance, taxes and markup. Ask how many hours the installer expects."],
  "ask": "Before I sign, could you add to the quote:\n1. For each allowance, the product it assumes (a model number or a link is fine).\n2. Whether allowances are at your cost or at retail.\n3. How overages are billed: at cost, or with markup, and at what percentage.\n4. Whether the difference comes back to me as a credit if I choose something cheaper.",
  "limits": "It does not say the allowances are too low. $6 a square foot may match the tile you want. It shows that $4,650 of the price is still a guess, and that the overage terms decide what you finally pay. The wage is an average of pay, not a billing rate.",
  "faq": [("What is an allowance on a remodeling quote?", "A placeholder amount for something you have not chosen yet, like tile or a faucet. If you pick something that costs more, you pay the difference, sometimes with markup. The quote should say which."),
          ("How do I compare quotes with different allowances?", "Set the allowances to the same amounts, or ask both contractors to price the same products. Otherwise the lower quote may only have smaller guesses.")],
  "card": [("Tile allowance, 120 sq ft @ $6", "$720", "Overage terms not stated", "ASK", True),
           ("Fixture allowance", "$2,400", "Ask which models", "NO SPEC", False),
           ("Vanity allowance", "$1,530", "Ask which model", "NO SPEC", False),
           ("Tile installation", "$6,400", "Tile setter wage $39.65/h, plain", "WAGE", False)],
  "facts": [("$39.65", "Tile and stone setters (SOC 47-2044), Seattle-Tacoma-Bellevue, WA, mean hourly wage, May 2025", "bls"),
            ("$50.20", "Tile and stone setters (SOC 47-2044), Seattle-Tacoma-Bellevue, WA, 90th percentile hourly wage, May 2025", "bls")],
  "derived": [("$4,650", "720 + 2400 + 1530"), ("16%", "4650 / 28400 * 100"), ("$1,680", "120 * 14"),
              ("$960", "1680 - 720")],
  "qx": ["$6", "$14"],
  "sources": ["bls", "usccdb"], "related": ["scope", "deposit"],
  "x": "Seattle bath quote: $28,400, and $4,650 is allowances. Tile at $6/sq ft is a guess; pick $14 tile and that line is $1,680. Ask how overages are billed."},

 {"no": "07", "photo": "deck", "alt": "A carpenter building a wood deck at sunset behind a Texas house, with a miter saw on sawhorses and new decking boards.", "sub": "TxDOT loaded wage: $46.60 to $60.75 an hour, with overhead and profit already in it.", "job": "Deck rebuild", "place": "Austin, TX",
  "title": "20% overhead and profit on top of $65 an hour in Austin. Is it counted twice?",
  "headline": "20% overhead and profit on top of $65 an hour. Counted twice?",
  "desc": "An illustrative Austin deck quote adds 20% overhead and profit to labor already priced at $65 an hour. BLS wages with the TxDOT loading, which already includes overhead and profit, and what to ask.",
  "lede": "The labor line is already priced at $65 an hour. Then a separate line adds 20% for overhead and profit on everything, labor included. The Texas DOT rule that public data can check against counts overhead and profit inside the labor markup. So the overlap is worth one question.",
  "quote": [("Labor, 2 carpenters x 5 days, 80 h @ $65", 5200, "", False),
            ("Lumber, hardware, fasteners", 4800, "No invoices attached", False),
            ("Overhead and profit, 20% of $10,000", 2000, "The line to ask about", True)],
  "focal": "Overhead and profit, 20% of $10,000: $2,000",
  "why": ["TxDOT's rule for paying contractors for extra work adds 25% to wages \"as compensation for overhead, superintendence, profit, and small tools\" (Item 9, Article 9.7.1.1), and another 55% of the labor cost for labor insurance and labor taxes (Article 9.7.1.2). Applied to the BLS May 2025 wage for carpenters in the Austin metro, the loaded rate is $46.60 to $60.75 an hour.",
          "The quote's $65 an hour is already above the loaded rate at the 90th percentile wage, and the loaded rate already contains overhead and profit. Adding 20% on top of the labor line puts $1,040 more on the same costs.",
          "Materials are different. The same TxDOT rule pays invoice cost plus 25% for overhead and profit on materials (Article 9.7.1.3), so 20% on materials sits inside that reference. Ask for the invoices."],
  "math": ["Loading: 1 + 25% + 55% = 1.80 (TxDOT Item 9)",
           "Loaded rate: $25.89 x 1.80 = $46.60 at the mean wage; $33.75 x 1.80 = $60.75 at the 90th percentile",
           "Reference for 80 hours: $3,728 to $4,860",
           "Quoted labor: $5,200, or $65 an hour",
           "Overhead and profit on labor: 20% x $5,200 = $1,040",
           "Labor plus its share of overhead and profit: $6,240, or $78 an hour",
           "Overhead and profit on materials: 20% x $4,800 = $960, inside the 25% materials markup in TxDOT Article 9.7.1.3"],
  "ask": "Thanks for the quote. One question on the overhead and profit line:\n1. Does the $65 hourly rate already include your overhead and profit, or only wages, insurance and taxes?\n2. If it already includes them, could the 20% apply to materials only?\n3. Could you attach the material invoices or a supplier quote for the $4,800 line?",
  "limits": "It does not show the contractor is overcharging. A contractor is free to price labor bare and put all overhead in one line, or the other way around. It shows that this quote may be doing both, and a one-sentence answer settles it. The TxDOT rule is a public-works payment rule, not a law for home projects.",
  "faq": [("Is 20% overhead and profit normal?", "No public rule sets a normal percentage for home projects. TxDOT's public-works rule uses 25% on wages for overhead, profit and small tools, 55% for insurance and taxes, and 25% on materials. What matters is whether the labor rate already includes it."),
          ("How do I know if overhead is counted twice?", "Compare the hourly labor rate with a loaded wage. If the rate is already at or above the loaded rate, ask what the separate overhead line covers that the rate does not.")],
  "card": [("Overhead and profit, 20%", "$2,000", "Labor part $1,040 overlaps TxDOT 25%", "ASK", True),
           ("Labor, 80 h @ $65", "$5,200", "$3,728 to $4,860 loaded", "SEE MATH", False),
           ("Materials", "$4,800", "Invoice + 25% (TxDOT 9.7.1.3)", "INVOICES", False)],
  "facts": [("$25.89", "Carpenters (SOC 47-2031), Austin-Round Rock-San Marcos, TX, mean hourly wage, May 2025", "bls"),
            ("$33.75", "Carpenters (SOC 47-2031), Austin-Round Rock-San Marcos, TX, 90th percentile hourly wage, May 2025", "bls"),
            ("25%", "TxDOT Item 9, Articles 9.7.1.1 (labor) and 9.7.1.3 (materials): overhead and profit", "txdot"),
            ("55%", "TxDOT Item 9, Article 9.7.1.2: labor insurance and labor taxes, on labor cost", "txdot")],
  "derived": [("1.80", "1 + 0.25 + 0.55"), ("$46.60", "25.89 * 1.80"), ("$60.75", "33.75 * 1.80"),
              ("$3,728", "80 * 25.89 * 1.80"), ("$4,860", "80 * 33.75 * 1.80"), ("$1,040", "0.20 * 5200"),
              ("$6,240", "5200 * 1.20"), ("$78", "6240 / 80"), ("$960", "0.20 * 4800")],
  "qx": ["20%", "$65", "$10,000"],
  "sources": ["txdot", "bls", "usccdb"], "related": ["op", "rates", "roof"],
  "x": "Austin deck quote: labor at $65/h, then 20% overhead and profit on top. The TxDOT loaded rate, $46.60 to $60.75/h, already includes O&P. Counted twice?"},

 {"no": "08", "photo": "door", "alt": "A salesperson with a clipboard at a front door, holding out a contract to a homeowner who stands with her arms crossed.", "sub": "A sale of $25 or more at your home can be canceled until midnight of the third business day.", "job": "Siding, in-home sale", "place": "Any state",
  "title": "$12,400 in siding, but only if I sign tonight. What does the law say?",
  "headline": "$12,400, but only if I sign tonight. What does the law say?",
  "desc": "An illustrative in-home siding quote with a sign-tonight discount. The FTC Cooling-Off Rule (16 CFR Part 429): three business days to cancel a sale of $25 or more made at your home.",
  "lede": "The line to read is the discount: 10% off, but only if you sign tonight. When a sale of $25 or more is made at your home, the FTC Cooling-Off Rule gives you until midnight of the third business day to cancel, and the seller must give you a cancellation form in duplicate. A deadline of tonight does not shorten that.",
  "quote": [("Fiber cement siding, 1,600 sq ft", 9600, "", False),
            ("Trim, wraps and house wrap", 1800, "", False),
            ("Tear-off and disposal", 1000, "", False),
            ("Sign-tonight discount, 10%", -1240, "The line to ask about", True)],
  "focal": "Sign-tonight discount, 10%: -$1,240",
  "why": ["Under 16 CFR Part 429, a door-to-door sale includes a sale with a purchase price of $25 or more made at the buyer's residence (Section 429.0). The seller must give you a receipt or contract saying you may cancel \"at any time prior to midnight of the third business day\" after the transaction, and a completed Notice of Cancellation form in duplicate (Section 429.1). Business days do not include Sundays or federal holidays.",
          "A price that expires tonight exists to stop you comparing. If you do sign, the three business days still apply. The rule says failing to give you the cancellation form is an unfair and deceptive practice.",
          "Some sales are exempt from the rule. If you are unsure whether yours is, read the rule in the sources or ask your state's consumer protection office."],
  "math": ["Discount: 10% x $12,400 = $1,240. Price if signed tonight: $11,160.",
           "Threshold for a sale made at your home: $25 (16 CFR Section 429.0).",
           "Cancellation window: until midnight of the third business day after the sale (16 CFR Section 429.1)."],
  "ask": "Thanks for the visit. I don't sign the same day. If the 10% is real, please put it in writing with a date at least a week out, and leave the itemized quote and a blank copy of your contract so I can read it. If I sign later, I'll expect the Notice of Cancellation form in duplicate, as the FTC Cooling-Off Rule requires.",
  "limits": "It does not say the siding price is high or low; nothing here benchmarks siding. It says the deadline is a sales device, and that signing tonight does not waive the three business days the rule gives you for a sale made at your home. Exemptions exist, and the rule's text is in the sources.",
  "faq": [("Can I cancel a contract I signed at home?", "Under the FTC Cooling-Off Rule, for a sale of $25 or more made at your home, you can cancel until midnight of the third business day after the sale, unless an exemption applies (16 CFR Part 429)."),
          ("Does a \"today only\" price mean I lose the right to cancel?", "No. The right to cancel comes from the rule, not from the contractor's price terms. The seller must also give you a Notice of Cancellation form in duplicate.")],
  "card": [("Sign-tonight discount, 10%", "-$1,240", "FTC: 3 business days to cancel", "ASK", True),
           ("Notice of Cancellation", "Not given", "Required, in duplicate (16 CFR 429.1)", "MISSING", False),
           ("Siding, 1,600 sq ft", "$9,600", "No public benchmark here", "NO REF", False)],
  "facts": [("$25", "Door-to-door sale: purchase price of $25 or more at the buyer's residence", "cfr429"),
            ("third business day", "Buyer may cancel until midnight of the third business day after the transaction", "cfr429"),
            ("in duplicate", "Seller must give a completed Notice of Cancellation form in duplicate", "cfr429")],
  "derived": [("$1,240", "0.10 * 12400"), ("$11,160", "12400 - 1240")],
  "qx": ["10%", "$12,400"],
  "sources": ["cfr429"], "related": ["today", "deposit"],
  "x": "\"10% off if you sign tonight.\" A sale of $25 or more made at your home can be canceled until midnight of the third business day (FTC Cooling-Off Rule)."},
]

# Photos live in assets/us/img/NAME-WIDTH.EXT. Widths listed are the files that exist; nothing is upscaled.
# w and h are the size of the JPEG fallback (the img element's intrinsic size).
PHOTO_CAPTION = "Illustrative photo. Not the house, the crew or the quote in this issue."
PHOTOS = {
    "roof2": {"avif": [800, 1200, 1600], "webp": [800, 1200, 1600], "jpg": 1200, "w": 1200, "h": 1500, "pos": "50% 46%"},
    "hvac": {"avif": [], "webp": [800, 1200, 1536], "jpg": 1536, "w": 1536, "h": 864, "pos": "50% 50%"},
    "waterheater": {"avif": [], "webp": [800, 1200, 1536], "jpg": 1536, "w": 1536, "h": 864, "pos": "50% 50%"},
    "windows": {"avif": [], "webp": [800, 1200, 1536], "jpg": 1536, "w": 1536, "h": 864, "pos": "50% 50%"},
    "paint": {"avif": [], "webp": [800, 1200, 1536], "jpg": 1536, "w": 1536, "h": 864, "pos": "50% 50%"},
    "bath": {"avif": [], "webp": [800, 1200, 1536], "jpg": 1536, "w": 1536, "h": 864, "pos": "50% 50%"},
    "deck": {"avif": [], "webp": [800, 1200, 1536], "jpg": 1536, "w": 1536, "h": 864, "pos": "50% 50%"},
    "door": {"avif": [], "webp": [800, 1200, 1536], "jpg": 1536, "w": 1536, "h": 864, "pos": "50% 50%"},
    "quotes": {"avif": [], "webp": [800, 1200, 1536], "jpg": 1536, "w": 1536, "h": 864, "pos": "50% 50%"},
}
INDEX_ALT = "Several contractor quotes laid out on a wooden table, seen from above, with single lines circled in pen, a calculator and a cup of coffee beside them."
HERO_SIZES = "(min-width: 1280px) 1184px, calc(100vw - 32px)"
THUMB_SIZES = "(min-width: 700px) 176px, 112px"

E = html.escape


def photo_path(name, w, ext):
    return f"/assets/us/img/{name}-{w}.{ext}"


def picture(name, alt, sizes, eager, cls):
    p = PHOTOS[name]
    srcs = ""
    for ext, typ in (("avif", "image/avif"), ("webp", "image/webp")):
        if p[ext]:
            srcset = ", ".join(f"{photo_path(name, w, ext)} {w}w" for w in p[ext])
            srcs += f'<source type="{typ}" srcset="{srcset}" sizes="{sizes}">'
    load = 'fetchpriority="high" decoding="async"' if eager else 'loading="lazy" decoding="async"'
    return (f'<picture class="{cls}">{srcs}<img src="{photo_path(name, p["jpg"], "jpg")}" width="{p["w"]}" height="{p["h"]}" '
            f'alt="{E(alt)}" {load} style="object-position:{p["pos"]}"></picture>')


def url_of(c):
    return f"{BASE}/us/teardowns/{c['no']}/"


def img_of(c):
    return f"{BASE}/us/teardowns/img/{c['no']}.png"


def money(v):
    return ("-$" if v < 0 else "$") + f"{abs(v):,}"


def total_of(c):
    return sum(a for _, a, _, _ in c["quote"])


# ---------------------------------------------------------------- card (1080 x 1080 CSS px, rendered at 2x)

def card_css(font_dir):
    return f"""@font-face{{font-family:"Geist";src:url("{font_dir}/Geist-Variable.woff2") format("woff2");font-weight:100 900}}
@font-face{{font-family:"Geist Mono";src:url("{font_dir}/GeistMono-Variable.woff2") format("woff2");font-weight:100 900}}
*{{margin:0;padding:0;box-sizing:border-box;border-radius:0}}
html,body{{width:1080px;height:1080px;background:#ffffff;color:#0a0a0a;font-family:"Geist",sans-serif;overflow:hidden;-webkit-font-smoothing:antialiased;font-feature-settings:"tnum" 1}}
.w{{position:absolute;inset:0;padding:60px 64px 52px;display:flex;flex-direction:column}}
.m{{font-family:"Geist Mono",monospace;text-transform:uppercase;letter-spacing:.06em}}
.top{{display:flex;justify-content:space-between;align-items:baseline;font-size:19px;padding-bottom:16px;border-bottom:1px solid #0a0a0a}}
.top b{{font-weight:500;color:#4f3cf0}}.top span{{color:#525252}}
h1{{font-size:70px;line-height:1.04;letter-spacing:-.038em;font-weight:600;margin-top:48px;max-width:950px}}
.sub{{font-size:29px;line-height:1.36;color:#525252;margin-top:30px;max-width:900px;letter-spacing:-.005em}}
.lbl{{margin-top:auto;display:flex;justify-content:space-between;font-size:15px;color:#525252;padding-bottom:10px;border-bottom:1px solid #0a0a0a}}
.r{{display:grid;grid-template-columns:300px 150px 1fr 120px;gap:20px;padding:17px 0;border-bottom:1px solid #e5e5e5;align-items:baseline}}
.r .l{{font-size:24px;font-weight:500;letter-spacing:-.01em;line-height:1.25}}
.r .q{{font-size:24px;font-weight:600;text-align:right}}
.r .p{{font-size:20px;color:#525252;line-height:1.3}}
.r .k{{font-size:15px;text-align:right;color:#737373}}
.r.f .l,.r.f .q,.r.f .p,.r.f .k{{color:#4f3cf0}}
.r.f .k{{font-weight:600}}
.ill{{font-size:15px;color:#737373;margin-top:14px}}
.ft{{margin-top:34px;display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid #0a0a0a;padding-top:18px;font-size:19px}}
.ft b{{font-weight:500}}.ft span{{color:#525252}}"""


def card_html(c, font_dir):
    rows = "".join(
        f"<div class='r{' f' if f else ''}'><span class=l>{E(l)}</span><span class=q>{E(q)}</span>"
        f"<span class=p>{E(p)}</span><span class='k m'>{E(k)}</span></div>" for l, q, p, k, f in c["card"])
    return f"""<!doctype html><html lang="en-US"><head><meta charset="utf-8"><style>{card_css(font_dir)}</style></head><body><div class=w>
<div class='top m'><b>Quote teardown {c['no']}</b><span>{E(c['job'])} / {E(c['place'])}</span></div>
<h1>{E(c['headline'])}</h1>
<p class=sub>{E(c['sub'])}</p>
<div class='lbl m'><span>Line</span><span>Quoted / public reference / mark</span></div>
{rows}
<div class='ill m'>Illustrative quote. Sources on the page.</div>
<div class='ft m'><b>Read the lines before you sign.</b><span>shield.the-horizons-innovation.com/us</span></div>
</div></body></html>"""


# ---------------------------------------------------------------- pages

EXTRA_CSS = """.td-head{grid-column:1 / -1;max-width:60rem}
.td-head .mono{color:var(--mute);display:block}
.td-head h1{font-size:clamp(34px,5.2vw,72px);line-height:1.02;letter-spacing:-.04em;margin:16px 0 18px;text-wrap:balance}
.td-photo{grid-column:1 / -1;margin:40px 0 56px}
.td-photo picture,.td-photo img{display:block;width:100%}
.td-photo img{aspect-ratio:16 / 9;height:auto;object-fit:cover;background:var(--line)}
.td-photo figcaption{font:500 11px/1.6 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--mute);border-top:1px solid var(--line);padding-top:10px;margin-top:10px}
.doc-h .toc{margin-top:0}
@media (max-width:700px){.td-photo{margin:28px 0 36px}}
.td-img{border:1px solid var(--line);margin:28px 0 8px;width:100%;height:auto}
.doc-b p.td-cap{color:var(--mute);font-size:13px;margin:0 0 8px}
.doc-b p.td-lab{font:500 11px/1.6 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin:0 0 8px}
.doc-b table.td-q th.r,.doc-b table.td-q td.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.doc-b table.td-q tr.focal td{color:var(--flag)}
.doc-b table.td-q tr.tot td{border-top:1px solid var(--fg);border-bottom:0;font-weight:600}
.doc-b table.td-q .note{display:block;color:var(--mute);font-size:13px}
.doc-b table.td-q tr.focal .note{color:var(--flag)}
.td-focal{border-left:2px solid var(--accent);padding:4px 0 4px 16px;font-weight:600;margin:16px 0}
.td-math{list-style:none;padding:0!important;margin:16px 0;border-top:1px solid var(--fg)}
.td-math li{margin:0!important;padding:10px 0;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}
.td-ask{white-space:pre-wrap;font:14px/1.65 var(--mono);border:1px solid var(--line2);padding:16px;margin:12px 0;overflow-wrap:anywhere}
.td-copy{cursor:pointer;font-family:var(--sans)}
.td-cta{border-top:1px solid var(--fg);margin-top:48px;padding-top:20px}
.td-cta p{margin:0 0 16px}
.td-cta .actions{margin-top:0}
.td-nav{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line);margin-top:48px;padding-top:16px;font-size:14px}
.td-list{list-style:none;padding:0!important;margin:24px 0;border-top:1px solid var(--fg)}
.td-list li{margin:0!important;border-bottom:1px solid var(--line)}
.td-list a{display:grid;grid-template-columns:176px 1fr;gap:20px;padding:18px 0;text-decoration:none;align-items:start}
.td-list picture,.td-list img{display:block;width:100%}
.td-list img{aspect-ratio:16 / 9;height:auto;object-fit:cover;background:var(--line)}
.td-list .n{display:block;margin-bottom:4px}
@media (max-width:700px){.td-list a{grid-template-columns:112px 1fr;gap:14px}}
.td-list .n{font:500 13px/1.7 var(--mono);color:var(--accent)}
.td-list b{display:block;font-weight:600;letter-spacing:-.01em}
.td-list span.t{display:block;color:var(--mute);font-size:14px}"""

HEADER = """<header class="top"><div class="wrap">
 <a class="brand" href="/us/">HORIZON SHIELD <span class="mono">US</span></a>
 <nav class="nav" aria-label="Main"><a href="/us/teardown/">Teardown</a><a href="/us/teardowns/">Teardowns</a><a href="/us/guides/">Guides</a><a href="/us/#sample">Sample report</a><a href="/us/#pricing">Pricing</a></nav>
 <a class="cta" href="/us/#check">Check a quote</a>
</div></header>"""

FOOTER = """<footer class="foot"><div class="wrap">
 <div class="co"><b>HORIZON SHIELD</b>The HORIZONs Co., Ltd.<br>Win Aoyama 942, 2-2-15 Minami-Aoyama, Minato-ku, Tokyo 107-0062, Japan<br><a href="mailto:contact@the-horizons-innovation.com">contact@the-horizons-innovation.com</a> &nbsp;/&nbsp; +81 463 74 5917</div>
 <nav aria-label="Legal">
  <a href="/us/guides/">Guides</a><a href="/us/privacy/">Privacy Policy</a>
  <a href="/us/terms/">Terms of Service</a><a href="/us/refunds/">Refund Policy</a>
  <a href="/us/disclaimer/">Disclaimer</a><a href="/us/accessibility/">Accessibility</a>
  <a href="/us/company/">Company and contact</a><a href="/us/privacy/#choices">Your privacy choices</a>
  <a href="/">日本語</a>
 </nav>
 <p class="legal">HORIZON SHIELD provides price benchmarking information only. We are not a licensed contractor, engineer, architect, home inspector, public adjuster, appraiser or attorney. Quote Teardowns use illustrative quotes written for teaching, not any real contractor's quote. Statutes, codes and agency pages are quoted as published on the date shown and are not legal advice; check the source for your situation. Reference values come from public sources and are not quotes. &copy; 2026 The HORIZONs Co., Ltd.</p>
</div></footer>"""

COPY_JS = """<script>document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){var t=document.getElementById(b.getAttribute('data-copy'));if(!t)return;var s=t.textContent;function ok(){var o=b.textContent;b.textContent='Copied';setTimeout(function(){b.textContent=o},1600)}if(navigator.clipboard){navigator.clipboard.writeText(s).then(ok,function(){})}else{var r=document.createRange();r.selectNodeContents(t);var g=getSelection();g.removeAllRanges();g.addRange(r)}})});</script>"""


def ld_json(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def org_nodes():
    return [{"@type": "Organization", "@id": ORG_ID, "name": "HORIZON SHIELD", "legalName": "The HORIZONs Co., Ltd.",
             "url": f"{BASE}/us/", "email": "contact@the-horizons-innovation.com"},
            {"@type": "Person", "@id": TOSHI_ID, "name": "Toshikatsu Oga",
             "jobTitle": "Representative director, 30 years in construction (carpenter, site supervisor, construction manager)",
             "sameAs": ["https://orcid.org/0009-0000-9180-903X"], "worksFor": {"@id": ORG_ID}}]


def head(title, desc, canon, og_title, og_desc, image, og_type, ld):
    return f"""<!doctype html>
{MARK}
<html lang="en-US" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{E(title)}</title>
<meta name="description" content="{E(desc)}">
<meta name="author" content="Toshikatsu Oga | HORIZON SHIELD">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#ffffff">
<link rel="canonical" href="{canon}">
<link rel="alternate" hreflang="en-US" href="{canon}">
<link rel="alternate" hreflang="x-default" href="{canon}">
<link rel="alternate" type="text/plain" href="{BASE}/llms.txt" title="Site summary for language models">
<link rel="mcp-server" href="https://mcp.horizonshield.dev">
<meta property="og:type" content="{og_type}">
<meta property="og:title" content="{E(og_title)}">
<meta property="og:description" content="{E(og_desc)}">
<meta property="og:url" content="{canon}">
<meta property="og:image" content="{image}">
<meta property="og:image:width" content="2160">
<meta property="og:image:height" content="2160">
<meta property="og:site_name" content="HORIZON SHIELD US">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{E(og_title)}">
<meta name="twitter:description" content="{E(og_desc)}">
<meta name="twitter:image" content="{image}">
<link rel="preload" href="/assets/us/fonts/Geist-Variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/us/us.css">
<style>{EXTRA_CSS}</style>
<script type="application/ld+json">
{ld_json(ld)}
</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
{HEADER}
"""


def cta_block():
    return f"""<div class="td-cta"><span class="mono mute">Your own quote</span>
<p><b>Get a free teardown of your own quote.</b> Upload it and see every line by kind, the lines nobody can check, and the questions to send. No account. Not a verdict.</p>
<div class="actions"><a class="cta" href="{CTA}">Get a free teardown of your own quote</a><a class="cta ghost" href="{CHECK}">$39 Quote Check</a></div></div>"""


def case_page(c, i):
    url, img = url_of(c), img_of(c)
    tot = total_of(c)
    trs = "".join(
        f"<tr class=\"{'focal' if f else ''}\"><td>{E(l)}{('<span class=note>' + E(n) + '</span>') if n else ''}</td>"
        f"<td class=r>{money(a)}</td></tr>" for l, a, n, f in c["quote"])
    trs += f"<tr class=tot><td>Total</td><td class=r>{money(tot)}</td></tr>"
    srcs = "".join(f'<li><a href="{SOURCES[k][1]}" rel="noopener">{E(SOURCES[k][0])}</a></li>' for k in c["sources"])
    facts = "".join(f'<li>{E(tok)}: {E(lab)}. <a href="{SOURCES[k][1]}" rel="noopener">Source</a></li>'
                    for tok, lab, k in c["facts"])
    rel = "".join(f'<li><a href="{GUIDES[g][0]}">{E(GUIDES[g][1])}</a></li>' for g in c["related"])
    prev_c = CASES[i - 1] if i > 0 else None
    next_c = CASES[i + 1] if i + 1 < len(CASES) else None
    nav = ('<nav class="td-nav" aria-label="Series">'
           + (f'<a href="/us/teardowns/{prev_c["no"]}/">Previous: {prev_c["no"]} {E(prev_c["job"])}</a>' if prev_c else '<span></span>')
           + '<a href="/us/teardowns/">All teardowns</a>'
           + (f'<a href="/us/teardowns/{next_c["no"]}/">Next: {next_c["no"]} {E(next_c["job"])}</a>' if next_c else '<span></span>')
           + '</nav>')
    faq_html = "".join(f"<h3>{E(q)}</h3><p>{E(a)}</p>" for q, a in c["faq"])
    why = "".join(f"<p>{E(p)}</p>" for p in c["why"])
    math = "".join(f"<li>{E(m)}</li>" for m in c["math"])
    ld = {"@context": "https://schema.org", "@graph": org_nodes() + [
        {"@type": "Article", "@id": f"{url}#article", "headline": c["title"], "description": c["desc"],
         "url": url, "mainEntityOfPage": url, "datePublished": DATE, "dateModified": DATE, "inLanguage": "en-US",
         "author": {"@id": TOSHI_ID}, "publisher": {"@id": ORG_ID}, "image": img,
         "isPartOf": {"@type": "CollectionPage", "@id": f"{BASE}/us/teardowns/#page", "name": "Quote Teardowns", "url": f"{BASE}/us/teardowns/"},
         "about": f"{c['job']} quotes, {c['place']}", "citation": [SOURCES[k][1] for k in c["sources"]]},
        {"@type": "FAQPage", "@id": f"{url}#faq", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in c["faq"]]},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "HORIZON SHIELD US", "item": f"{BASE}/us/"},
            {"@type": "ListItem", "position": 2, "name": "Quote Teardowns", "item": f"{BASE}/us/teardowns/"},
            {"@type": "ListItem", "position": 3, "name": f"{c['no']} {c['job']}", "item": url}]}]}
    title = f"{c['title']} | Quote Teardown {c['no']} | HORIZON SHIELD US"
    out = head(title, c["desc"], url, c["headline"], c["desc"], img, "article", ld)
    out += f"""<main id="main" class="doc"><div class="wrap">
<div class="td-head"><span class="mono">Quote Teardown {c['no']} &nbsp;/&nbsp; {E(c['job'])}, {E(c['place'])}</span><h1>{E(c['title'])}</h1><span class="mono">Toshikatsu Oga &nbsp;/&nbsp; {DATE_TEXT}</span></div>
<figure class="td-photo">{picture(c['photo'], c['alt'], HERO_SIZES, True, 'td-pic')}<figcaption>{E(PHOTO_CAPTION)}</figcaption></figure>
<div class="doc-h"><ol class="toc"><li><a href="#quote">The quote</a></li><li><a href="#line">The one line to ask about</a></li><li><a href="#math">The arithmetic</a></li><li><a href="#ask">What to ask the contractor</a></li><li><a href="#limits">What this does not establish</a></li><li><a href="#faq">Questions</a></li><li><a href="#sources">Sources</a></li></ol></div>
<div class="doc-b">
<p><b>{E(c['lede'])}</b></p>
<img class="td-img" src="/us/teardowns/img/{c['no']}.png" width="1080" height="1080" alt="{E(c['headline'])} Ledger of the illustrative quote with the line to ask about marked." loading="lazy" decoding="async">
<p class="td-cap">The card for this issue. The quote is illustrative, written for teaching; it is not any real contractor's quote.</p>
<h2 id="quote">The quote</h2>
<p class="td-lab">Illustrative quote. {E(c['job'])}, {E(c['place'])}.</p>
<table class="td-q"><thead><tr><th>Line</th><th class="r">Quoted</th></tr></thead><tbody>{trs}</tbody></table>
<h2 id="line">The one line to ask about</h2>
<p class="td-focal">{E(c['focal'])}</p>
{why}
<h2 id="math">The arithmetic</h2>
<ol class="td-math">{math}</ol>
<p>Public numbers used above:</p>
<ul>{facts}</ul>
<h2 id="ask">What to ask the contractor</h2>
<p>Copy this into a text or an email. A contractor with a reason for each number can answer in a minute.</p>
<pre class="td-ask" id="ask-{c['no']}">{E(c['ask'])}</pre>
<button type="button" class="cta ghost td-copy" data-copy="ask-{c['no']}">Copy the questions</button>
<h2 id="limits">What this does not establish</h2>
<p>{E(c['limits'])}</p>
{cta_block()}
<h2 id="faq">Questions</h2>
{faq_html}
<h2 id="sources">Sources</h2>
<p>Every public number on this page links to the record it comes from. Wages were looked up in <a href="{SOURCES['usccdb'][1]}" rel="noopener">USCCDB</a>, which carries the BLS file as published. Statutes, codes and agency pages are quoted as published on {DATE_TEXT}; check the source for changes.</p>
<ol>{srcs}</ol>
<h2 id="related">Related guides</h2>
<ul>{rel}</ul>
<p>How we work: HORIZON SHIELD is paid by homeowners only. We take no referral fee, listing fee or commission from any contractor, distributor or insurer. <a href="/us/">About the service</a>.</p>
{nav}
</div></div></main>
{FOOTER}
{COPY_JS}
</body>
</html>
"""
    return out


def index_page():
    url = f"{BASE}/us/teardowns/"
    items = "".join(
        f'<li><a href="/us/teardowns/{c["no"]}/">{picture(c["photo"], c["alt"], THUMB_SIZES, False, "td-thumb")}<span><span class="n">{c["no"]}</span><b>{E(c["title"])}</b>'
        f'<span class="t">{E(c["job"])}, {E(c["place"])}</span></span></a></li>' for c in CASES)
    desc = ("Worked examples of U.S. contractor quotes for common home jobs. Each one marks the single line a homeowner "
            "should question, with public numbers and their sources: wages, codes, the EPA lead rule and the FTC Cooling-Off Rule.")
    ld = {"@context": "https://schema.org", "@graph": org_nodes() + [
        {"@type": "CollectionPage", "@id": f"{url}#page", "name": "Quote Teardowns", "url": url, "inLanguage": "en-US",
         "description": desc, "datePublished": DATE, "dateModified": DATE, "author": {"@id": TOSHI_ID},
         "publisher": {"@id": ORG_ID}, "image": img_of(CASES[0]),
         "mainEntity": {"@type": "ItemList", "numberOfItems": len(CASES), "itemListElement": [
             {"@type": "ListItem", "position": n + 1, "name": c["title"], "url": url_of(c)} for n, c in enumerate(CASES)]}},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "HORIZON SHIELD US", "item": f"{BASE}/us/"},
            {"@type": "ListItem", "position": 2, "name": "Quote Teardowns", "item": url}]}]}
    out = head("Quote Teardowns: the one line to question on a contractor quote | HORIZON SHIELD US", desc, url,
               "Quote Teardowns", "One illustrative quote per issue, one line to question, public numbers with sources.",
               img_of(CASES[0]), "website", ld)
    out += f"""<main id="main" class="doc"><div class="wrap">
<div class="td-head"><span class="mono">Series &nbsp;/&nbsp; Quote Teardowns</span><h1>Quote Teardowns</h1><span class="mono">Toshikatsu Oga &nbsp;/&nbsp; {DATE_TEXT}</span></div>
<figure class="td-photo">{picture("quotes", INDEX_ALT, HERO_SIZES, True, "td-pic")}<figcaption>{E(PHOTO_CAPTION.split(". ")[0] + ".")}</figcaption></figure>
<div class="doc-h"></div>
<div class="doc-b">
<p><b>A total tells you nothing. A line can.</b> Each issue takes one illustrative quote for a common U.S. home job and marks the one line to ask about, with the arithmetic, the public numbers behind it and a message you can send the contractor.</p>
<p>The quotes are written for teaching and are not any real contractor's quote. The public numbers are real and linked: BLS wages by metro area, the Texas DOT loading rule, the International Residential Code, the EPA lead rule and the FTC Cooling-Off Rule. Where no public number exists, the page says so and tells you what to ask instead.</p>
<ul class="td-list">{items}</ul>
{cta_block()}
<h2 id="how">How to read an issue</h2>
<p>Every issue has the same parts: the quote, the one line to ask about, the arithmetic, what to ask, and what the arithmetic does not establish. Wages are what workers are paid, not what contractors bill. Only Texas has a published loading rule used here; elsewhere the wage is shown plain and excludes the contractor's insurance, taxes and markup.</p>
<p>The Japanese edition of this series is <a href="/hacker/kaibou/" hreflang="ja">見積書の解剖</a>.</p>
</div></div></main>
{FOOTER}
</body>
</html>
"""
    return out


# ---------------------------------------------------------------- writing

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            if MARK not in f.read():
                raise SystemExit(f"refuse to overwrite hand-written file: {path}")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def build(out, img_html=None, font_dir=None):
    root = os.path.join(out, "us", "teardowns")
    write(os.path.join(root, "index.html"), index_page())
    for i, c in enumerate(CASES):
        write(os.path.join(root, c["no"], "index.html"), case_page(c, i))
        if img_html:
            os.makedirs(img_html, exist_ok=True)
            fd = font_dir or os.path.relpath(os.path.join(out, "assets", "us", "fonts"), img_html)
            with open(os.path.join(img_html, f"{c['no']}.html"), "w", encoding="utf-8") as f:
                f.write(card_html(c, fd))
    return [f"{BASE}/us/teardowns/"] + [url_of(c) for c in CASES]


def render(out, img_html):
    """Render each card to us/teardowns/img/NN.png at 2160 x 2160 (1080 viewport, device scale 2)."""
    from playwright.sync_api import sync_playwright  # only needed here
    dst = os.path.join(out, "us", "teardowns", "img")
    os.makedirs(dst, exist_ok=True)
    exe = "/opt/pw-browsers/chromium" if os.path.isfile("/opt/pw-browsers/chromium") else None
    with sync_playwright() as p:
        b = p.chromium.launch(**({"executable_path": exe} if exe else {}))
        pg = b.new_page(viewport={"width": 1080, "height": 1080}, device_scale_factor=2)
        for c in CASES:
            pg.goto("file://" + os.path.abspath(os.path.join(img_html, f"{c['no']}.html")))
            pg.evaluate("document.fonts.ready")
            pg.wait_for_timeout(250)
            assert pg.evaluate("document.fonts.check('600 62px Geist')"), "Geist did not load"
            pg.screenshot(path=os.path.join(dst, f"{c['no']}.png"), full_page=False)
        b.close()


# ---------------------------------------------------------------- selftest

NUM = re.compile(r"-?\$\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?%|\b\d+\.\d+\b")
CITE = [re.compile(r"\b\d+(?:\.\d+){2,}\b"), re.compile(r"\b7\d\d\.\d+\b"), re.compile(r"\b429\.\d+\b"),
        re.compile(r"\bM\d+\.\d+\b")]
DASHES = re.compile("[\u2012\u2013\u2014\u2015\u2e3a\u2e3b\ufe58\ufe63\uff0d]")


def norm(tok):
    t = tok.replace(",", "").replace("$", "").lstrip("-")
    return ("%" if t.endswith("%") else "n", float(t.rstrip("%")))


def case_strings(c):
    skip = {"facts", "derived", "sources", "related", "no", "qx"}
    out = []

    def walk(v):
        if isinstance(v, str):
            out.append(v)
        elif isinstance(v, (list, tuple)):
            for x in v:
                walk(x)
    for k, v in c.items():
        if k not in skip:
            walk(v)
    return out


def check_numbers(c):
    allowed = []
    for l, a, n, f in c["quote"]:
        allowed.append(("n", float(abs(a))))
    allowed.append(("n", float(abs(total_of(c)))))
    for tok in c["qx"]:
        allowed.append(norm(tok))
    for tok, lab, k in c["facts"]:
        assert k in SOURCES and SOURCES[k][1].startswith("https://"), (c["no"], tok, k)
        assert k in c["sources"], f"{c['no']}: fact source {k} missing from the Sources list"
        for m in NUM.findall(tok):
            allowed.append(norm(m))
    for tok, expr in c["derived"]:
        val = eval(expr, {"__builtins__": {}})
        kind, want = norm(tok)
        dec = len(tok.split(".")[1].rstrip("%")) if "." in tok else 0
        tol = 0.5 * 10 ** -dec + 1e-9  # the printed value must be the rounded result
        assert abs(val - want) <= tol, f"{c['no']}: derived {tok} != {expr} = {val}"
        allowed.append((kind, want))
    # quote line labels like "12 @ $1,150" are illustrative quote numbers
    for l, a, n, f in c["quote"]:
        for m in NUM.findall(l):
            allowed.append(norm(m))
    bad = []
    for s in case_strings(c):
        for rx in CITE:
            s = rx.sub(" ", s)
        for m in NUM.findall(s):
            k = norm(m)
            if not any(k[0] == a[0] and abs(k[1] - a[1]) < 1e-6 for a in allowed):
                bad.append(m)
    assert not bad, f"{c['no']}: numbers without a source or formula: {sorted(set(bad))}"


def default_root():
    r = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    site = all(os.path.isfile(os.path.join(r, *x)) for x in (("assets", "us", "us.css"), ("us", "index.html"), ("sitemap.xml",)))
    return r if site else None


def selftest(root=None):
    import tempfile
    root = root or default_root()
    from html.parser import HTMLParser
    ok = 0
    d = tempfile.mkdtemp()
    urls = build(d, os.path.join(d, "_img"), font_dir="fonts")
    assert len(urls) == len(CASES) + 1 and len({c["no"] for c in CASES}) == len(CASES); ok += 1

    pages = [os.path.join(d, "us", "teardowns", "index.html")] + [os.path.join(d, "us", "teardowns", c["no"], "index.html") for c in CASES]
    planned = {"/us/teardowns/"} | {f"/us/teardowns/{c['no']}/" for c in CASES} | {f"/us/teardowns/img/{c['no']}.png" for c in CASES}

    class L(HTMLParser):
        def __init__(s):
            super().__init__(); s.links = []; s.ld = []; s.imgs = []; s._in = False
        def handle_starttag(s, t, a):
            a = dict(a)
            for k in ("href", "src"):
                if a.get(k):
                    s.links.append(a[k])
            if a.get("srcset"):
                s.links += [part.strip().split(" ")[0] for part in a["srcset"].split(",") if part.strip()]
            if t == "img":
                s.imgs.append(a)
            s._in = (t == "script" and a.get("type") == "application/ld+json")
        def handle_data(s, data):
            if s._in:
                s.ld.append(data)
        def handle_endtag(s, t):
            if t == "script":
                s._in = False

    missing, types = [], set()
    for p in pages:
        t = open(p, encoding="utf-8").read()
        assert MARK in t and 'data-theme="light"' in t and 'hreflang="en-US"' in t
        assert not DASHES.search(t), f"dash in {p}"
        lp = L(); lp.feed(t)
        assert len(lp.ld) == 1
        g = json.loads(lp.ld[0])
        types |= {n["@type"] for n in g["@graph"]}
        assert any(n.get("@id") == ORG_ID for n in g["@graph"])
        for im in lp.imgs:  # every photo: alt text, explicit size, exactly one eager image per page
            assert im.get("alt") and im.get("width") and im.get("height"), (p, im.get("src"))
        assert sum(1 for im in lp.imgs if im.get("fetchpriority") == "high") == 1, p
        assert all(im.get("loading") == "lazy" for im in lp.imgs if im.get("fetchpriority") != "high"), p
        for h in lp.links:
            if h.startswith(("http://", "https://", "mailto:", "#")):
                continue
            path = h.split("#")[0].split("?")[0]
            if path in planned:
                continue
            if root:
                fs = os.path.join(root, path.lstrip("/"))
                if not (os.path.isfile(fs) or os.path.isfile(os.path.join(fs, "index.html"))):
                    missing.append((os.path.relpath(p, d), h))
    ok += 1  # pages parse, JSON-LD parses, no dashes
    assert {"Organization", "Person", "Article", "FAQPage", "BreadcrumbList", "CollectionPage"} <= types; ok += 1
    assert not missing, f"links or image files that do not exist: {missing}"
    for name, ph in PHOTOS.items():  # widths listed must not exceed the native size, and every file must exist
        assert max(ph["webp"] + ph["avif"] + [ph["jpg"]]) <= 1600
        if root:
            for ext in ("avif", "webp"):
                for w in ph[ext]:
                    assert os.path.isfile(os.path.join(root, photo_path(name, w, ext).lstrip("/"))), (name, w, ext)
            assert os.path.isfile(os.path.join(root, photo_path(name, ph["jpg"], "jpg").lstrip("/"))), (name, "jpg")
    ok += 1
    for c in CASES:
        t = open(os.path.join(d, "us", "teardowns", c["no"], "index.html"), encoding="utf-8").read()
        assert CTA in t and CHECK in t and img_of(c) in t and "Illustrative quote" in t
        assert 2 <= len(c["faq"]) <= 3 and 3 <= len(c["card"]) <= 4 and sum(1 for r in c["card"] if r[4]) == 1
        assert sum(1 for r in c["quote"] if r[3]) == 1
        check_numbers(c)
        post = f"{c['x']} {url_of(c)}"
        assert len(post) <= 230, f"{c['no']}: X post is {len(post)} characters"
        assert not DASHES.search(post)
        card = open(os.path.join(d, "_img", f"{c['no']}.html"), encoding="utf-8").read()
        assert not DASHES.search(card) and "Illustrative quote" in card
    ok += 1  # every number in every case has a source URL or a formula
    p = os.path.join(d, "us", "teardowns", "index.html")
    open(p, "w").write("hand-written")
    try:
        build(d); raise AssertionError("overwrote a hand-written file")
    except SystemExit:
        ok += 1
    print(f"selftest ok {ok}/6" + (f" (links and image files resolved against {root})" if root else " (site links and image files not resolved: pass --root)"))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=".")
    ap.add_argument("--img-html")
    ap.add_argument("--font-dir", help="font folder as seen from the card HTML (default: OUT/assets/us/fonts)")
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--root", help="site root used by --selftest to resolve links")
    ap.add_argument("--posts", action="store_true", help="print the X post drafts")
    a = ap.parse_args()
    if a.selftest:
        selftest(a.root); sys.exit(0)
    if a.posts:
        for c in CASES:
            s = f"{c['x']} {url_of(c)}"
            print(f"{c['no']} ({len(s)}): {s}")
        sys.exit(0)
    for u in build(a.out, a.img_html, a.font_dir):
        print(u)
    if a.render:
        if not a.img_html:
            raise SystemExit("--render needs --img-html")
        render(a.out, a.img_html)
        print("rendered", len(CASES), "cards")
