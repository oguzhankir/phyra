import type { Project } from '../contracts/types';
import { inputError } from './validation';
export function recoveryEligible(project: Project, dirty: boolean, invalidDrafts: number): boolean {
  return dirty && invalidDrafts === 0 && inputError(project) === null;
}
// A checkpoint owns exactly a canonical definition. Results, UI drafts and file paths never enter it.
export function recoverySnapshot(project: Project): Project {
  return structuredClone(project);
}
