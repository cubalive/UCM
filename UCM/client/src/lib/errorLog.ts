const MAX_ERRORS = 20;

export interface CapturedError {
  ts: number;
  type: "error" | "rejection";
  message: string;
  source?: string;
  line?: number;
  col?: number;
  stack?: string;
}

const errors: CapturedError[] = [];

export function pushError(entry: CapturedError) {
  errors.push(entry);
  if (errors.length > MAX_ERRORS) errors.shift();
}

export function getErrors(): readonly CapturedError[] {
  return errors;
}
