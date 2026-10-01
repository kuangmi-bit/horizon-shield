/**
 * hs-ehn-verify v2: EHN の寄与を板に載せる前の門(トルネード v2)。恒久 dry-run(/submit は呼ばない、KV にも書かない)。
 *
 * v1 からの違い:
 *   ・L2 を v2 に(値と根拠をつなぐ、数のかたまりごと照合、万円を読む、K 回すべてを接地)。
 *   ・/verify-dryrun に認証(Bearer、secret TORNADO_TOKEN)。無ければ 503 で閉じる。
 *   ・回数制限(rate limit バインディング TORNADO_RL があれば)、本文 32KB・原文 8,000 字の上限。
 *   ・監査ハッシュは正規化 JSON で、K 回分・抽出器名・指示文の sha256・方針の版を含む。
 *   ・ログには判定・理由・ハッシュだけ(原文も値も出さない)。
 */
import { gateHandle, TORNADO_VERSION } from "../../_shared/tornado/tornado.js";
import { EHN_POLICY, ehnExtractors } from "./ehn_policy.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return Response.json({ ok: true, worker: "hs-ehn-verify", mode: "dry-run", gate: TORNADO_VERSION, policy: EHN_POLICY.id + "@" + EHN_POLICY.version });
    }
    if (url.pathname === "/verify-dryrun") {
      const res = await gateHandle(request, env, {
        policy: EHN_POLICY,
        extractors: ehnExtractors,
        authSecret: "TORNADO_TOKEN",
        rateLimiter: "TORNADO_RL",
        log: (o) => console.log("ehn-verify dry-run:", JSON.stringify(o)),
      });
      if (res.status !== 200) return res;
      const body = await res.json();
      body.mode = "dry-run";
      if (body.decision === "adopt") body.note = "DRY-RUN: 本番なら hs-kira-proxy /submit を叩く。今は叩かない。";
      return Response.json(body);
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  },
};
