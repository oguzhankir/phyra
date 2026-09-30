type VerificationOperation = 'solve' | 'compare';

// Configuration can arrive before recovery and execution gates settle. Waiting
// must not consume the one-shot dispatch; the caller marks it started only when
// this decision returns the operation that it immediately submits.
export function verificationLaunch(
  operation: VerificationOperation | null,
  started: boolean,
  blocked: boolean,
): VerificationOperation | null {
  return operation && !started && !blocked ? operation : null;
}
