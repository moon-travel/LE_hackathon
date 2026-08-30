// 担当A — pure session state transitions (no DB). Requirements 8.1, 8.6.
import type { SessionState } from "@/types/session";

export interface SessionLike {
  id: string;
  accountId: string;
  state: SessionState;
  enteredAt: Date;
}

export interface ExitedSession extends SessionLike {
  state: "CLOSED";
  exitedAt: Date;
}

/**
 * Apply an exit to an ACTIVE session: state becomes CLOSED and the exit time is
 * recorded (要件8.1). Throws if the session is not ACTIVE.
 */
export function applyExitTransition(session: SessionLike, exitedAt: Date): ExitedSession {
  if (session.state !== "ACTIVE") {
    throw new Error(`cannot exit a session in state ${session.state}`);
  }
  return { ...session, state: "CLOSED", exitedAt };
}

/**
 * Apply a forced close to an ACTIVE session: state becomes FORCE_CLOSED and the
 * exit time is recorded as the closing time (要件8.6).
 */
export function applyForceClose(
  session: SessionLike,
  closedAt: Date,
): SessionLike & { state: "FORCE_CLOSED"; exitedAt: Date } {
  if (session.state !== "ACTIVE") {
    throw new Error(`cannot force-close a session in state ${session.state}`);
  }
  return { ...session, state: "FORCE_CLOSED", exitedAt: closedAt };
}
