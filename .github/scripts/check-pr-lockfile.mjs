#!/usr/bin/env node
/**
 * check-pr-lockfile.mjs
 * Checks that pnpm-lock.yaml was not manually edited.
 * Export: checkLockfile(files, prAuthor, prBranch, repo) → { passed, failures }
 * Fork carry: luongjames8/paperclip PRs must commit their lockfile update (no
 * refresh bot runs there; pr-trusted.yml verifies it is current instead).
 */
import { fileURLToPath } from 'node:url';

export const LOCKFILE_OWNING_FORK = 'luongjames8/paperclip';

export function checkLockfile(files, prAuthor, prBranch, repo) {
  const lockfileChanged = files.some(f => f.filename === 'pnpm-lock.yaml');
  if (!lockfileChanged || repo === LOCKFILE_OWNING_FORK) return { passed: true, failures: [] };

  const isRefreshBot =
    prAuthor === 'github-actions[bot]' && prBranch === 'chore/refresh-lockfile';

  return {
    passed: isRefreshBot,
    failures: isRefreshBot ? [] : [
      'You have changes to `pnpm-lock.yaml` — `pr.yml` will hard-fail this PR with a confusing message about lockfile edits. ' +
      'To fix: run `pnpm install` locally, exclude the lockfile from your commit, push again. ' +
      'The lockfile is regenerated automatically by the refresh bot on a schedule.',
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = JSON.parse(process.env.PR_FILES ?? '[]');
  const result = checkLockfile(files, process.env.PR_AUTHOR ?? '', process.env.PR_BRANCH ?? '', process.env.GITHUB_REPOSITORY ?? '');
  console.log(JSON.stringify(result));
  process.exit(result.passed ? 0 : 1);
}
