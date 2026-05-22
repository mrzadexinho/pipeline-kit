---
'@idriszade/core': patch
---

ci: verify Trusted Publishing OIDC end-to-end + remove NPM_TOKEN long-lived secret

This patch bump exists to trigger one publish run via Trusted Publishing OIDC
(npm Trusted Publishers configured on all 33 @idriszade/* packages 2026-05-22).
The workflow no longer passes NODE_AUTH_TOKEN — if this publishes successfully,
TP-OIDC is the sole auth path. No source code or behavior changes in core.
