// 担当C — Template_Codec decode. Requirements 13.2, 13.6, 13.10.
import type { DecodeResult } from "@/types/codec";
import { validateEncoded } from "./validate";

/**
 * Decode persisted-form data into a vector + modelVersion. Throws CodecError on
 * invalid input (要件13.6). Returns the model version so Auth_Service can check
 * it against its supported-versions list (要件13.10).
 */
export function decodeTemplate(data: string): DecodeResult {
  const env = validateEncoded(data);
  return { vector: env.vector, modelVersion: env.modelVersion };
}
