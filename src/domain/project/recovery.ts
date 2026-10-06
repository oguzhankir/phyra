import type { ProjectDefinition as Project } from '../contracts/types';
import { documentError } from './document';
export function recoveryEligible(project: Project, dirty: boolean, invalidDrafts: number): boolean {
  return dirty && invalidDrafts === 0 && documentError(project) === null;
}
// A checkpoint owns exactly a canonical definition. Results, UI drafts and file paths never enter it.
export function recoverySnapshot<T extends Project>(project: T): T {
  return structuredClone(project);
}
