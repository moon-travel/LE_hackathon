// Auth_Service: 母集団構築と 1:N 識別。
// _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.11, 5.1, 5.5, 5.7, 9.5, 9.10, 11.2, 11.3, 11.10_

import { isPurpose } from "@/types/purpose";
import type { Purpose } from "@/types/purpose";
import type { FaceVector } from "@/types/vector";
import type { IdentifyResult } from "@/types/api";
import { prisma } from "@/lib/db";
import {
  MATCH_THRESHOLD,
  POPULATION_LIMIT,
  distanceToScore,
  euclideanDistance,
  isValidVector,
} from "./distance";
import { businessDayRange } from "./businessDay";
import { isSupportedModelVersion } from "./modelVersion";
import { AuditEvent, appendAudit } from "./audit";

/** 識別要求の受付から判定を返すまでの上限。要件9-5（1.5秒以内）に合わせる。 */
export const IDENTIFY_TIMEOUT_MS = 1500;

/** 母集団の1件（デコード済みテンプレート）。 */
export interface PopulationTemplate {
  accountId: string;
  vector: FaceVector;
}

/** 純粋な判定結果。DB に依存しないためプロパティテストの対象にできる。 */
export interface IdentifyDecision {
  result: IdentifyResult;
  /** result === "matched" のときのみ設定。 */
  accountId?: string;
  /** 採用された最小距離。 */
  distance?: number;
  /** 表示用スコア（1 - 距離）。 */
  score?: number;
  /** 閾値未満だったアカウント数。判定分岐の根拠（要件3-6/3-7/5-5/5-7）。 */
  matchedCount: number;
  /** 母集団のアカウント数。 */
  populationSize: number;
}

/**
 * 1:N 識別の判定（純粋関数）。
 *
 * - アカウント単位で最小距離を採用する（要件9-5「最高スコア採用」の距離版）
 * - `distance < MATCH_THRESHOLD` を満たすアカウント数 n で分岐する
 *   n = 0 → none / n = 1 → matched / n >= 2 → ambiguous
 *   （要件3-4, 3-6, 3-7, 5-5, 5-7）
 * - 判定は距離のみで行い、表示用スコアは判定に用いない
 *
 * Property 2「1:N識別の件数判定整合」が検証する対象。
 */
export function decideIdentity(
  population: readonly PopulationTemplate[],
  probe: FaceVector,
  threshold: number = MATCH_THRESHOLD,
): IdentifyDecision {
  // アカウントごとの最小距離を求める（1アカウント最大5テンプレート、要件9-3）。
  const minDistanceByAccount = new Map<string, number>();
  for (const t of population) {
    const d = euclideanDistance(t.vector, probe);
    const current = minDistanceByAccount.get(t.accountId);
    if (current === undefined || d < current) {
      minDistanceByAccount.set(t.accountId, d);
    }
  }

  const populationSize = minDistanceByAccount.size;

  // 閾値未満のアカウントを集める。境界値 threshold ちょうどは不一致（未満なので）。
  const matches: Array<{ accountId: string; distance: number }> = [];
  for (const [accountId, distance] of minDistanceByAccount) {
    if (distance < threshold) {
      matches.push({ accountId, distance });
    }
  }

  if (matches.length === 0) {
    return { result: "none", matchedCount: 0, populationSize };
  }
  if (matches.length >= 2) {
    return { result: "ambiguous", matchedCount: matches.length, populationSize };
  }

  const best = matches[0];
  return {
    result: "matched",
    accountId: best.accountId,
    distance: best.distance,
    score: distanceToScore(best.distance),
    matchedCount: 1,
    populationSize,
  };
}

/** 目的外利用エラー（要件11-2 / 11-3）。 */
export class PurposeNotAllowedError extends Error {
  readonly reason = "purpose_not_allowed";
  constructor(readonly given: unknown) {
    super("purpose not allowed");
    this.name = "PurposeNotAllowedError";
  }
}

/** 不正なベクトル（次元数不一致・非有限値）。 */
export class InvalidVectorError extends Error {
  readonly reason = "invalid_vector";
  constructor() {
    super("invalid face vector");
    this.name = "InvalidVectorError";
  }
}

/** 識別のタイムアウト（要件3-11）。 */
export class IdentifyTimeoutError extends Error {
  readonly reason = "timeout";
  constructor() {
    super("identify timeout");
    this.name = "IdentifyTimeoutError";
  }
}

/**
 * purpose に応じた母集団の範囲。
 *
 * 要件3-2（入場）と要件5-1（施設内決済）で母集団の定義が異なる。
 *   entry            : 当日 ACTIVE セッション保持 ∪ 当日登録済み
 *   payment / pass   : ACTIVE セッション保持のみ
 */
export function populationScopeOf(purpose: Purpose): "entryGate" | "inFacility" {
  return purpose === "entry" ? "entryGate" : "inFacility";
}

/**
 * 母集団を構築する。上限は POPULATION_LIMIT（500件、要件3-2 / 5-1）。
 *
 * 対応バージョン外のテンプレートは**そのテンプレートのみ**除外し、同一アカウントの
 * 対応版は母集団に残す（要件9-10）。除外時は監査ログへ記録する。
 */
export async function buildPopulation(
  purpose: Purpose,
  now: Date = new Date(),
): Promise<PopulationTemplate[]> {
  const scope = populationScopeOf(purpose);
  const { start, end } = businessDayRange(now);

  // 当日 ACTIVE セッションを持つアカウント。
  const activeSessions = await prisma.session.findMany({
    where: { state: "ACTIVE", enteredAt: { gte: start, lte: end } },
    select: { accountId: true },
  });
  const accountIds = new Set(activeSessions.map((s) => s.accountId));

  // 入場ゲートの母集団は「当日登録済み」も含む（要件3-2）。
  if (scope === "entryGate") {
    const todayTemplates = await prisma.faceTemplate.findMany({
      where: { createdAt: { gte: start, lte: end } },
      select: { accountId: true },
    });
    for (const t of todayTemplates) {
      accountIds.add(t.accountId);
    }
  }

  if (accountIds.size === 0) {
    return [];
  }

  // 母集団上限。超過分は切り捨てる（要件3-2 / 5-1。到達時の警告表示は担当C の Admin 側）。
  const limited = Array.from(accountIds).slice(0, POPULATION_LIMIT);

  const templates = await prisma.faceTemplate.findMany({
    where: { accountId: { in: limited } },
    select: { id: true, accountId: true, vector: true, modelVersion: true },
  });

  const population: PopulationTemplate[] = [];
  for (const t of templates) {
    if (!isSupportedModelVersion(t.modelVersion)) {
      // 要件9-10: 対象アカウント識別子・バージョン識別子・再登録が必要である旨を記録。
      await appendAudit({
        eventType: AuditEvent.UNSUPPORTED_MODEL_VERSION,
        accountId: t.accountId,
        detail: {
          templateId: t.id,
          modelVersion: t.modelVersion,
          message: "対応バージョン外のため母集団から除外。再登録が必要",
        },
      });
      continue;
    }
    const parsed = safeParseVector(t.vector);
    if (parsed === null) {
      continue;
    }
    population.push({ accountId: t.accountId, vector: parsed });
  }
  return population;
}

/** SQLite に JSON 文字列で保存されたベクトルを復元する。壊れていれば null。 */
function safeParseVector(raw: string): FaceVector | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidVector(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 1:N 識別を実行する。
 *
 * 1. purpose 検証（要件11-2 / 11-3）。3値以外は照合せず拒否し監査記録
 * 2. ベクトル検証
 * 3. 母集団構築 → decideIdentity
 * 4. IDENTIFY_TIMEOUT_MS で打ち切り（要件3-11 / 9-5）
 * 5. アクセス要求を監査記録（要件11-10）
 */
export async function identify(
  vector: unknown,
  purpose: unknown,
  now: Date = new Date(),
): Promise<IdentifyDecision> {
  if (!isPurpose(purpose)) {
    await appendAudit({
      eventType: AuditEvent.PURPOSE_REJECTED,
      detail: { requestedPurpose: String(purpose), reason: "目的外利用のため拒否" },
    });
    throw new PurposeNotAllowedError(purpose);
  }
  if (!isValidVector(vector)) {
    throw new InvalidVectorError();
  }

  const decision = await withTimeout(
    (async () => {
      const population = await buildPopulation(purpose, now);
      return decideIdentity(population, vector);
    })(),
    IDENTIFY_TIMEOUT_MS,
  );

  // 要件11-10: 発生日時・要求元・許可/拒否の判定結果を記録。ベクトル値は含めない。
  await appendAudit({
    eventType: AuditEvent.TEMPLATE_ACCESS,
    accountId: decision.accountId ?? null,
    ts: now,
    detail: {
      requester: "Auth_Service",
      purpose,
      granted: true,
      result: decision.result,
      matchedCount: decision.matchedCount,
      populationSize: decision.populationSize,
    },
  });

  if (decision.result !== "matched") {
    // 要件9-6: 認証失敗の発生日時・失敗要因の区分を記録。
    await appendAudit({
      eventType: AuditEvent.AUTH_FAILED,
      ts: now,
      detail: { purpose, reason: decision.result, populationSize: decision.populationSize },
    });
  }

  return decision;
}

/** 指定ミリ秒で打ち切る。超過時は IdentifyTimeoutError。 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new IdentifyTimeoutError()), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
