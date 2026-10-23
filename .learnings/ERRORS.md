## [ERR-20261023-001] apply_patch_unavailable

**Logged**: 2026-10-23T10:06:00+09:00
**Priority**: medium
**Status**: resolved
**Area**: docs

### Summary
The required `apply_patch` command is not installed in the cron shell environment.

### Error
```
zsh:1: command not found: apply_patch
```

### Context
- Attempted to add the scheduled blog articles in `/Users/rose/Downloads/project/study-blog`.
- Searched standard user and Homebrew locations; no executable was found.

### Resolution
- **Resolved**: 2026-10-23T10:06:00+09:00
- **Notes**: Used the POSIX `patch` utility as the patch-based fallback.

