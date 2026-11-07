export function sourceIdentity(root: string): string;
export function needsBuild(root: string): boolean;
export function needsInstall(root: string): boolean;
export function lockIdentity(root: string): string;
export function recordInstall(root: string): void;
export function recordBuild(root: string): {
  id: string;
  builtAt: string;
  version: string;
};
