// Types for a2a-conduct (conduct-v1.4). The runtime is a2a_conduct.mjs, no dependencies.

export declare const EXT_URI: "https://gate.horizonshield.dev/ext/conduct/v1";
export declare const EXT_PERMANENT_ID: "https://w3id.org/horizonshield/conduct/v1";
export declare const EXT_URIS: readonly [typeof EXT_URI, typeof EXT_PERMANENT_ID];
export declare const GATE: string;
export declare const WITNESS_INTAKE: string;
export declare const PAID_BY: readonly ["buyer", "seller", "referral", "advertising", "subscription", "public", "other"];
export declare const USER_AGENT: string;
export declare const VERSION: string;

export type PaidBy = (typeof PAID_BY)[number];

/** Who pays this agent (section 2). Extra keys, such as disclosure_url, are kept as given. */
export interface Compensation {
  paid_by: PaidBy;
  referral_fee: boolean;
  listing_fee: boolean;
  /** 0 to 100 */
  success_fee_pct?: number;
  [key: string]: unknown;
}

export interface ConductParams {
  compensation: Compensation;
  measured_endpoints: string[];
  conduct_record: string;
  witness_intake: string;
  verdict_recipe?: unknown;
  consent?: unknown;
  register?: unknown;
  rings?: unknown;
}

/** An AgentExtension entry for AgentCard.capabilities.extensions[]. */
export interface ConductExtension {
  uri: typeof EXT_URI;
  description: string;
  required: false;
  params: ConductParams;
}

export interface ExtensionOptions {
  conductRecord?: string;
  witnessIntake?: string;
  verdictRecipe?: unknown;
  verdict_recipe?: unknown;
  consent?: unknown;
  register?: unknown;
  rings?: unknown;
}

export type HeadersLike = Headers | Map<string, string> | Array<[string, string]> | Record<string, string | string[] | undefined>;

/** Throws A2AConductError on a malformed compensation declaration or a non-https measured endpoint. */
export declare function extension(compensation: Compensation, measuredEndpoints: string[], options?: ExtensionOptions): ConductExtension;

export declare function servedUrl(url: string | URL): string;

export declare function activated(requestHeaders: HeadersLike): { uri: string | null; spelling: "a2a-extensions" | "x-a2a-extensions" | null };

export declare function echoHeaders(requestHeaders: HeadersLike): { "A2A-Extensions"?: string; "X-A2A-Extensions"?: string };

export type ConductMetadata = {
  "https://gate.horizonshield.dev/ext/conduct/v1/endpoint": string;
  "https://gate.horizonshield.dev/ext/conduct/v1/conduct_record": string;
  "https://gate.horizonshield.dev/ext/conduct/v1/witness_intake": string;
  "https://gate.horizonshield.dev/ext/conduct/v1/served_by": string;
};

export declare function metadata(ext: ConductExtension, served: string | URL): ConductMetadata;

/** A JSON-RPC result: a 0.3 Message/Task object, or a 1.0 {message} / {task} wrapper. Mutated and returned. */
export declare function attach<T extends object>(result: T, ext: ConductExtension, served: string | URL): T;

/** One Message or Task object (for example an @a2a-js/sdk Message you are about to publish). Mutated and returned. */
export declare function attachToMessage<T extends object>(messageOrTask: T, ext: ConductExtension, served: string | URL): T;

/** @a2a-js/sdk RequestContext or ServerCallContext. Returns the activated URI, or null. */
export declare function activateOn(ctx: unknown): string | null;

export interface RegisterReading {
  endpoint: string;
  http: number;
  state: string | null;
  /** true only when the latest scheduled measurement passed; null otherwise, never false */
  verified: boolean | null;
  record_url: string | null;
  history_url: string | null;
}

export interface PreflightReport {
  agent: string;
  card_status: number;
  extension_declared: boolean;
  compensation: Compensation | Record<string, unknown> | null;
  measured_endpoints: string[];
  register: RegisterReading[];
  witness_intake: string | null;
  does_not_establish: string[];
}

export interface PreflightOptions {
  /** custom transport returning [status, parsed JSON or null] */
  getJson?: (url: string) => [number, unknown] | Promise<[number, unknown]>;
  fetch?: typeof globalThis.fetch;
  gate?: string;
}

export declare function preflight(agentOrigin: string, options?: PreflightOptions): Promise<PreflightReport>;
