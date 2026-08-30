// 担当A の各ルートで共有するエラー写像。
//
// Next.js App Router の route.ts は HTTP メソッドハンドラ以外を export できないため
// （"is not a valid Route export field" でビルドが落ちる）、ヘルパはここに置く。

import type { ApiError } from "@/types/api";
import {
  IdentifyTimeoutError,
  InvalidVectorError,
  PurposeNotAllowedError,
} from "./identify";

/**
 * 例外を ApiError に写す。
 * IdentifyResult に "timeout" の枠がないため、タイムアウト（要件3-11）は ApiError 側で表現する。
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof PurposeNotAllowedError) {
    return { error: "purpose not allowed", reason: error.reason };
  }
  if (error instanceof InvalidVectorError) {
    return { error: "invalid face vector", reason: error.reason };
  }
  if (error instanceof IdentifyTimeoutError) {
    return { error: "identify timeout", reason: error.reason };
  }
  return { error: "internal error" };
}

/** 目的外利用（要件11-2/11-3）と不正入力は 400、タイムアウトは 408、それ以外は 500。 */
export function statusOf(error: unknown): number {
  if (error instanceof PurposeNotAllowedError) return 400;
  if (error instanceof InvalidVectorError) return 400;
  if (error instanceof IdentifyTimeoutError) return 408;
  return 500;
}
