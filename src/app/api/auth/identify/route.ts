// 担当A — Auth_Service. POST /api/auth/identify
// Requirements 3.1, 3.3, 3.11, 5.1, 11.2, 11.10.
import { NextResponse } from "next/server";
import type { IdentifyRequest, IdentifyResponse } from "@/types/api";
import { isPurpose } from "@/types/purpose";
import { isValidFaceVector } from "@/types/vector";
import { identify } from "@/lib/auth/identify";
import { buildPopulation } from "@/lib/auth/population";
import { appendAudit } from "@/lib/audit/log";

export async function POST(
  req: Request,
): Promise<NextResponse<IdentifyResponse | { error: string }>> {
  let body: Partial<IdentifyRequest>;
  try {
    body = (await req.json()) as Partial<IdentifyRequest>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Purpose limitation: reject anything not in the allowed set (要件11.2, 11.3).
  if (!isPurpose(body.purpose)) {
    await appendAudit("purpose_denied", { purpose: String(body.purpose ?? "") });
    return NextResponse.json({ error: "purpose not allowed" }, { status: 400 });
  }
  if (!isValidFaceVector(body.vector)) {
    return NextResponse.json({ error: "invalid vector" }, { status: 400 });
  }

  // Population scope: entry uses today's ACTIVE+registered; payment/pass use ACTIVE only.
  const scope = body.purpose === "entry" ? "entry" : "active";
  const population = await buildPopulation(scope);

  const outcome = identify(body.vector, body.purpose, population);

  // Audit the access WITHOUT the vector values (要件11.10).
  await appendAudit(
    "identify",
    { purpose: body.purpose, result: outcome.result, populationSize: population.length },
    outcome.accountId,
  );

  const res: IdentifyResponse = {
    result: outcome.result,
    accountId: outcome.accountId,
    score: outcome.score,
  };
  return NextResponse.json(res);
}
