# Record Privacy v1 (`record-privacy-v1`)

**Status:** v1, 2026-09-28. Applies to every record HORIZON SHIELD publishes or anchors: gate verdicts, witness
walks, the NENRIN ledgers, agreement records, MUSUBI contracts and runs, résumés, and the Yakumo directory.
**Language:** RFC 2119 keywords. This is an operating policy, not legal advice; it has not yet been reviewed by a
lawyer, and it will be revised if a review says it must.

## 1. Why a policy

A public, append-only, Bitcoin-anchored record cannot be taken back. That is its purpose, and it is also why the
question "should this be public at all" has to be answered before anything is written, not after.

Two facts about Japan shape the answer. Stating a fact that lowers someone's standing can be defamation even when
the fact is true (Penal Code article 230); it is excused only when the fact concerns the public interest, the purpose
is solely to serve it, and the truth is proven (article 230-2). A company can be the injured party. And information
about a company is not personal information, but information about its officers, employees and sole traders is
(Act on the Protection of Personal Information, article 2; the Personal Information Protection Commission's general
guidelines, section 2-1).

## 2. Four kinds of record, four defaults

**P. Measurements of a surface its operator published.** An agent card, an MCP endpoint, a well-known file: the
operator put it on the public internet for machines to read. Measurements of it are published in full, with their
bytes and hashes, so anyone can recompute them. The measured party can answer: a response is filed like any other
record (a witness walk of its own, or a discrepancy record) and never replaces the measurement. Showing responses
beside the measurement on the register pages is not built yet (section 3).

**B. Records between private parties.** Agreements, contracts, delegations, execution receipts. The default is
private. A record is published in full only when the signed bytes say so with the consent of every signing party.
Until then the only thing that may be made public is a commitment (a hash) that reveals nothing.

**A. Adverse facts.** Failures, refusals, disagreements. They are published only about class P subjects, only as
counts and links to the recomputable records they come from, never as narrative, never as a score or penalty, and
always with the subject's response when there is one. The reader decides what a count means.

**I. Natural persons.** No public record names a natural person who has not named themselves in it. A witness may
sign with a name they chose. A customer, an officer, an employee or a sole trader is not named by us; where a work
record must mention a customer it is masked (`〇〇様`). Directory listings name only businesses that applied to be
listed.

## 3. How each record type meets it (as of 2026-09-28)

| Record | Class | Default | Status |
|---|---|---|---|
| Gate verdicts, register, `/record/{sha}` | P | public | complies. The measured party can now answer a verdict (nenrin-response-v0, `POST https://ledger.horizonshield.dev/response`, signed with a key on its own domain) and the ledger lists the answer at `/response?about=<record_sha256>`. **Complies since 2026-09-28**: `GET /record/<sha>` carries a `Link: <.../response?about=<sha>>; rel="replies"` header, outside the hashed body |
| Witness walks (`a2a-conduct-walk`) | P | public; the walker may choose `hash-only` or `commitment` | complies |
| Agreement records (`POST /agreement`, a2a-agreement-v1/v1.1) | B | published only with `"publication": "public"` in the signed bytes | **complies** at ledger.horizonshield.dev since its intake 0.2.0 and at agreement.horizonshield.dev since its intake 0.3.0 (both 2026-09-28). Correction: this row first said it complied when only the first of the two doors did; the second door kept and served records without the check until 0.3.0 |
| MUSUBI contracts (`grant.privacy`) | B | the signed `grant.privacy` value governs; only `public_record` may be published in full | **complies since musubi 0.2.0 (2026-09-28)**: any other value, or none, is refused with `contract_not_public_record` and nothing is kept; its executions are then refused as `contract_not_filed`. The first two contracts are `public_record` by both parties |
| Refused submissions (agreements, contracts, executions) | B | not kept, not served; the report goes back to the submitter only | **complies since 2026-09-28** at both doors; records kept as refused before that answer `410 withheld` |
| Task-bound observations (`/witness/task`) | B when the task is between private parties | commitment unless each party is a public surface (an https origin) or signed consent | **complies since hs-ledger task face 2026-09-28**: without it only the evidence_id and receipt time are kept and anchored; the reference walker's task binding carries the requester's consent. Observations filed before stay as filed |
| Résumé and trust-signal adverse counts | A | counts over class P endpoints, `erasable: false` | **complies since 2026-09-28**: `/resume` carries `subject_responses` beside the counts (outside the résumé bytes, so `resume_sha256` does not move), `/trust-signal` carries their count and link, and `GET /witness/<sha>` shows the replies to that walk. A reply changes no count and is not judged |
| Yakumo directory | I | businesses that applied; customers masked | complies (checked 2026-09-28: two verified, one pending with no name shown) |

"Open" rows are stated so that nobody reads this table as more than it is.

## 4. Keeping a record private and still provable

Do not file it on a public ledger. Compute its canonical SHA-256 and timestamp that hash (OpenTimestamps is free and
reveals nothing). If a dispute ever needs the record, the parties reveal the bytes and anyone can check them against
the timestamped hash.

## 5. What this does not establish

That every record ever published before this policy meets it (the table says where it did not). That the classes are
drawn where a court would draw them. That publishing a class P measurement is always lawful; it is our judgment that
measuring what an operator published for machines is in the public interest, and a lawyer has not yet confirmed it.
