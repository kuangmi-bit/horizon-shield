// Read a quote (or a job description with photos) into structured lines with AI.
// The AI only reads and classifies. It never produces a reference value: those come from
// public data in refs.js and the formulas in engine.js. Every draft is reviewed by a person
// before it is sent.

const QUOTE_PROMPT = `You read contractor quotes for U.S. homeowners. Return JSON only, no code fences, no commentary, in exactly this shape:
{"schema_version":"us-extract-0.1","doc":{"contractor":string|null,"quote_no":string|null,"quote_date":"YYYY-MM-DD"|null,"total":number|null,"trade":string},
"lines":[{"item":string,"amount":number|null,"qty":number|null,"unit":string|null,"kind":"labor"|"material"|"permit"|"overhead"|"disposal"|"other",
"labor":{"workers":number|null,"days":number|null,"hours":number|null}|null,
"material":{"type":"asphalt_shingles"|"other","squares":number|null,"weight_lb_per_square":number|null}|null}]}
Rules: copy each line description verbatim on one line. Amounts are plain numbers without $ or commas; discounts are negative. Include every priced line, in order. Use kind "overhead" for overhead, profit or markup lines, "permit" for permit fees, "disposal" for tear-off, dumpster or haul-away, "labor" only for lines that are labor alone. Fill labor.workers, days or hours only when the quote states them. Fill material.squares and weight_lb_per_square only when the quote or a product sheet in the file states them. If something is unreadable, use null. Never guess a number.`;

const JOB_PROMPT = `You turn a U.S. homeowner's description, measurements and photos into a scope of work for contractors to price. Return JSON only, no code fences, in exactly this shape:
{"schema_version":"us-extract-0.1","doc":{"contractor":null,"quote_no":null,"quote_date":null,"total":null,"trade":string},
"lines":[{"item":string,"qty_text":string|null,"kind":"labor"|"material"|"permit"|"overhead"|"disposal"|"other",
"labor":{"workers":null,"days":null,"hours":null}|null,
"material":{"type":"asphalt_shingles"|"other","squares":number|null,"weight_lb_per_square":number|null}|null}]}
Rules: list the items a complete quote for this job would need, one per line, each with the quantity the homeowner gave (qty_text, for example "26 squares" or "3 windows, 36 x 48 in"). Use only quantities the homeowner stated or that follow directly from their measurements; if a quantity is not given, set qty_text to "quantity needed". Never invent prices or hours.`;

export function contentBlocks(files, text) {
  const blocks = [];
  for (const f of files) {
    const data = toBase64(f.bytes);
    if (f.kind === "pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    else blocks.push({ type: "image", source: { type: "base64", media_type: f.contentType, data } });
  }
  if (text) blocks.push({ type: "text", text: `Text supplied by the homeowner:\n${String(text).slice(0, 20000)}` });
  return blocks;
}

export function toBase64(bytes) {
  // Build the binary string in 32 KB parts: spreading a large array into fromCharCode overflows the stack.
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function extract(env, { mode, files, text }, fetchImpl = fetch) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const content = [...contentBlocks(files, text), { type: "text", text: mode === "detailed_estimate" ? JOB_PROMPT : QUOTE_PROMPT }];
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || "claude-sonnet-4-6", max_tokens: 8000, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) throw new Error(`extraction API ${res.status}`);
  const data = await res.json();
  const txt = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").replace(/```json|```/g, "").trim();
  let ex;
  try { ex = JSON.parse(txt); } catch { throw new Error("extraction was not valid JSON"); }
  return { extracted: ex, gates: gates(ex, mode) };
}

export function gates(ex, mode) {
  const g = { pass: true, notes: [] };
  if (!ex || !Array.isArray(ex.lines) || !ex.lines.length) { g.pass = false; g.notes.push("no lines"); return g; }
  if (ex.lines.length > 80) { g.pass = false; g.notes.push("more than 80 lines"); }
  const kinds = new Set(["labor", "material", "permit", "overhead", "disposal", "other"]);
  for (const l of ex.lines) {
    if (typeof l.item !== "string" || !l.item.trim()) { g.pass = false; g.notes.push("line without description"); }
    if (!kinds.has(l.kind)) { g.pass = false; g.notes.push(`unknown kind ${l.kind}`); }
    if (mode !== "detailed_estimate" && l.amount != null && typeof l.amount !== "number") { g.pass = false; g.notes.push("non-numeric amount"); }
  }
  if (mode !== "detailed_estimate" && ex.doc && typeof ex.doc.total === "number") {
    const sum = ex.lines.reduce((s, l) => s + (typeof l.amount === "number" ? l.amount : 0), 0);
    const tol = Math.max(5, Math.abs(ex.doc.total) * 0.01);
    if (Math.abs(sum - ex.doc.total) > tol) g.notes.push(`lines add up to ${sum}, quote total is ${ex.doc.total}: check for tax, discounts or missed lines`);
  }
  return g;
}
