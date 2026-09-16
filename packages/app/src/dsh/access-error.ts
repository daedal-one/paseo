export type DshAccessErrorCode =
  | "runtime-unavailable"
  | "session-unavailable"
  | "session-refresh-failed"
  | "invalid-origin"
  | "invalid-record"
  | "storage-unavailable"
  | "not-paired"
  | "already-paired"
  | "unsupported-platform"
  | "transport-disposed"
  | "request-cancelled"
  | "transport-failed"
  | "invalid-response"
  | "invalid-enrollment"
  | "expired-enrollment"
  | "enrollment-rejected"
  | "enrollment-outcome-unknown"
  | "enrollment-save-failed";

/** Fixed diagnostics keep native errors, stored grants and response bodies out of logs. */
export class DshAccessError extends Error {
  constructor(readonly code: DshAccessErrorCode) {
    super(`dsh-access/${code}`);
    this.name = "DshAccessError";
  }
}
