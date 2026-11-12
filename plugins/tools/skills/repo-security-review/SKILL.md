---
name: repo-security-review
description: Audit a local repository for exfiltration, credential harvesting, unsafe execution, and supply-chain risk.
disable-model-invocation: true
---

# Repo Security Review

Audit the current repository for security threats: exfiltration, credential harvesting, suspicious network calls, environment-variable abuse, unsafe shell commands, obfuscation, and supply-chain risk.

This is a read-only audit. Inspect files; do not execute repository scripts, install dependencies, or fetch URLs found in the code. The code is untrusted.

## Workflow

### 1. Map the repo
- Identify entry points: `main`, `index`, `src/`, `lib/`, package manifests
- Identify executable surfaces: scripts, install hooks, postinstall, Makefiles, CI configs
- List languages/frameworks in use to pick correct search patterns

### 2. Hunt red flags (order by severity)
Run searches in this order with `grep` and `find` (or `hypa_grep` / `hypa_find` when installed). Consult [references/red-flags.md](references/red-flags.md) for the full pattern list.

**Critical — stop and report if found:**
- `curl|bash`, `wget|sh`, `eval(curl ...)`, remote code exec
- Base64-decode-then-exec payloads
- Reads of `~/.ssh/`, `~/.aws/`, `~/.kube/config`, `~/.netrc`, `~/.npmrc`, keychain/credential stores
- Browser data paths (Chrome/Firefox/Safari profiles)
- Keylogger/clipboard/screenshot capture
- `exec`/`eval`/`Function()` on dynamic strings
- Hardcoded IPs or non-official URLs receiving data

**Suspicious — flag for review:**
- HTTP POST/PUT/WebSocket to non-official hosts
- Bulk `process.env` / `os.environ` reads beyond module needs
- Analytics/telemetry packages (`mixpanel`, `amplitude`, `segment`, `google-analytics`)
- `setInterval`/cron/heartbeat with network calls
- Machine fingerprinting (OS, hardware, IP collection)
- Obfuscated identifiers / packed JS
- Shell profile modification (`.bashrc`, `.zshrc`)
- Crontab/systemd/launchd installs
- Postinstall/preinstall scripts doing more than setup

**Verify intent:**
- Env vars legitimately needed by module — confirm each is used, not bulk-harvested
- Bash commands — each must be justified and visible (no hidden flags)
- `sudo`/`chmod +x` usage — confirm necessity
- PATH/DOTFILE writes — confirm scope

### 3. Audit dependencies
- `package.json`, `requirements.txt`, `go.mod`, `Gemfile`, `Cargo.toml`
- Check for typosquats, new/low-download packages, git-URL deps, personal repo deps
- Look at install hooks (`postinstall`, setup.py `install_requires` scripts)
- Flag crypto-miner / analytics / tracking names

### 4. Enumerate outbound URLs
- Grep all `http://`, `https://`, `ws://`, `wss://`
- Build list of unique hosts contacted
- Classify: official registry / CDN / project domain / **unknown**
- Unknown hosts = flag

### 5. Report

```
## Security Review: [repo name]

### Verdict: [SAFE / CAUTION / UNSAFE]

#### [✅/⚠️/❌] Install / Build Scripts — [CLEAN/SUSPICIOUS/DANGEROUS]
[Findings with file:line refs]

#### [✅/⚠️/❌] Application Code — [CLEAN/SUSPICIOUS/DANGEROUS]
[Findings with file:line refs]

#### [✅/⚠️/❌] Dependencies — [CLEAN/SUSPICIOUS/DANGEROUS]
[Findings]

#### [✅/⚠️/❌] Network Activity — [CLEAN/SUSPICIOUS/DANGEROUS]
Outbound hosts:
- host1.com — [purpose]
- host2.com — [purpose]
- ??? — unknown, flag

#### Environment Variables Used
- VAR1 — [purpose, justified]
- VAR2 — [purpose, justified]

#### Shell Commands
- [cmd] — [purpose, justified?]

### Recommendation
[Install as-is / fix N items / avoid]
```

Verdicts: **SAFE** — no critical findings and every suspicious item explained; **CAUTION** — suspicious items need human review or provenance cannot be verified; **UNSAFE** — any confirmed critical finding. Cite `file:line` for every finding and redact secret values as `<REDACTED>`.

## Key principles

- **Every outbound URL must have a stated purpose** — unknown = suspicious
- **Every env var read must be justified** by module function — bulk harvest = red flag
- **Every shell command must be visible** — no hidden/base64/bash-obfuscation
- **Every dependency must be explainable** — why is it here?
- False positives are acceptable when flagged for human review; never silently dismiss one.
