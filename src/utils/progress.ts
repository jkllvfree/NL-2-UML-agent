import * as crypto from "crypto";

export type AgentProgressEvent = {
  kind: "progress";
  task: "uml" | "generate-module-tree";
  requestId: string;
  stage: string;
  message?: string;
  detail?: unknown;
  error?: string;
  timestamp: string;
};

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function emitProgress(event: Omit<AgentProgressEvent, "kind" | "timestamp">): void {
  const payload: AgentProgressEvent = {
    kind: "progress",
    timestamp: new Date().toISOString(),
    ...event,
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
