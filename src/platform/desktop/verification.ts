import { invoke } from '@tauri-apps/api/core';
export type VerificationConfiguration = '3d' | '2d-compare' | '2d-profile' | null;
type VerificationArguments = {
  verification_mode: undefined;
  verification_configuration: undefined;
  verification_trace: { message: string };
  verification_complete: { report: Record<string, unknown> };
};
type VerificationResult = {
  verification_mode: boolean;
  verification_configuration: VerificationConfiguration;
  verification_trace: void;
  verification_complete: void;
};
// Explicit local verification commands only; this adapter is not a general-purpose invoke bridge.
export function invokeVerification<K extends keyof VerificationArguments>(
  command: K,
  args?: VerificationArguments[K],
): Promise<VerificationResult[K]> {
  return invoke(command, args);
}
