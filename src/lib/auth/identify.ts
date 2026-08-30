// 担当A — Auth_Service core 1:N identification logic (pure, testable).
// Requirements 3.2, 3.4, 3.6, 3.7, 5.1, 5.5, 5.7, 9.5, 11.2, 13.10.
import {
  SCORE_THRESHOLD,
  POPULATION_CAP,
  type FaceVector,
} from "@/types/vector";
import { isPurpose, type Purpose } from "@/types/purpose";
import type { IdentifyResult } from "@/types/api";
import { euclideanDistance } from "./distance";

/** One candidate account in the identification population. */
export interface Candidate {
  accountId: string;
  /** All templates for this account (max 5). Vectors already decoded. */
  templates: FaceVector[];
}

export interface IdentifyOutcome {
  result: IdentifyResult;
  accountId?: string;
  score?: number; // distance of the single matched account
}

export class PurposeError extends Error {
  constructor(public readonly purpose: unknown) {
    super("purpose not allowed");
    this.name = "PurposeError";
  }
}

/**
 * Run 1:N identification over the given population.
 *
 * - Purpose must be one of the three allowed values, else PurposeError (要件11.2).
 * - Population is capped at POPULATION_CAP (要件3.2); extra candidates are ignored.
 * - Per account, the MINIMUM distance across its templates is the account score
 *   (closest template wins, i.e. highest similarity — 要件9.5).
 * - An account "matches" when its score < SCORE_THRESHOLD (要件3.4).
 * - 0 matches -> "none" (要件3.6/5.5); exactly 1 -> "matched"; >=2 -> "ambiguous" (要件3.7/5.7).
 */
export function identify(
  probe: FaceVector,
  purpose: Purpose | string,
  population: Candidate[],
): IdentifyOutcome {
  if (!isPurpose(purpose)) {
    throw new PurposeError(purpose);
  }

  const capped = population.slice(0, POPULATION_CAP);

  const matches: { accountId: string; score: number }[] = [];
  for (const cand of capped) {
    if (cand.templates.length === 0) continue;
    let best = Infinity;
    for (const tpl of cand.templates) {
      const d = euclideanDistance(probe, tpl);
      if (d < best) best = d;
    }
    if (best < SCORE_THRESHOLD) {
      matches.push({ accountId: cand.accountId, score: best });
    }
  }

  if (matches.length === 0) return { result: "none" };
  if (matches.length >= 2) return { result: "ambiguous" };
  return { result: "matched", accountId: matches[0].accountId, score: matches[0].score };
}
