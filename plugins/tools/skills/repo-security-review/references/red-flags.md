# Security Red Flags Reference

Comprehensive pattern list for local repo security audit.

## Install / Build Script Red Flags

### Critical
- `curl URL | bash` or `wget URL | sh` from non-official sources
- `eval $(curl ...)` — remote code exec
- Download + `chmod +x` + execute from unknown hosts
- Modifying `/etc/` system files
- Adding crontab entries
- Modifying `.bashrc`, `.zshrc`, `.profile` to inject persistent code
- Creating systemd services or launchd agents
- Disabling security features (SELinux, firewall)

### Suspicious
- Env var harvesting (`$AWS_SECRET`, `$GITHUB_TOKEN`, etc.)
- Reading files outside install scope
- Hidden file creation (dotfiles) in unexpected locations
- Network requests during install (beyond downloading artifact)
- Compilation from source without visible code
- Unnecessary `sudo`/root

### Verify
- PATH additions — confirm what's being added
- `~/.config/<app>` or `~/.<app>` creation — confirm scope
- Package manager dependency installs

## Source Code Red Flags

### Critical
- Base64 decoded + executed payloads
- `eval()`, `exec()`, `Function()` on dynamic/untrusted strings
- Obfuscated code (meaningless names, packed JS, hex-encoded strings)
- Reading `~/.ssh/id_rsa`, `~/.ssh/known_hosts`
- Reading `~/.aws/credentials`, `~/.netrc`, `~/.npmrc`
- Reading `~/.kube/config`, `~/.docker/config.json`, `~/.pypirc`
- Reading browser data (cookies, history, saved passwords)
- Keylogger patterns (keyboard listeners storing input)
- Screenshot/screen recording without clear purpose
- Clipboard monitoring

### Suspicious
- Hardcoded IP addresses (not domain names)
- Non-HTTPS URLs for data transmission
- Domains unrelated to project
- Data serialization before network send
- `setInterval` with HTTP calls (phone-home)
- Machine fingerprinting (OS, hardware, network info collection)
- Bulk environment variable reads
- Directory enumeration / file tree walking
- DNS tunneling (encoded data in DNS queries)

## Sensitive File Paths

### Credentials / Keys
```
~/.ssh/*
~/.aws/*
~/.azure/*
~/.config/gcloud/*
~/.kube/config
~/.docker/config.json
~/.netrc
~/.npmrc
~/.pypirc
~/.gitconfig
~/.gnupg/*
~/.*_history
```

### Browser Data
```
~/Library/Application Support/Google/Chrome/
~/.config/google-chrome/
~/Library/Application Support/Firefox/
~/.mozilla/firefox/
~/Library/Safari/
```

### System
```
/etc/passwd
/etc/shadow
/etc/hosts
```

### Legitimate Access (verify context)
- `~/.config/<appname>/`
- `~/.local/share/<appname>/`
- `~/.cache/<appname>/`
- Log files in expected locations

## Dependency Red Flags

### npm (package.json)
- `analytics`, `tracking`, `telemetry`, `metrics` packages
- `postinstall`/`preinstall` scripts executing code
- Dependencies from GitHub URLs instead of npm registry
- Very new packages or extremely low weekly downloads
- Typosquatted names (`lodahs` vs `lodash`)

### Python (requirements.txt, setup.py, pyproject.toml)
- `pip install` from GitHub/git URLs
- `-` or `_` variations of popular names
- Packages not on PyPI
- setup.py install hooks with network or file ops

### Go (go.mod)
- `replace` directives to unusual forks
- Personal GitHub account dependencies
- Recent ownership transfers

### Ruby (Gemfile)
- Gems from git sources instead of RubyGems
- Gems with post-install hooks

### Rust (Cargo.toml)
- `build.rs` with network or file ops outside target dir
- Git dependencies from unknown repos

### Common suspect names
- `event-stream` (historical malware)
- `flatmap-stream`
- Anything with `miner`, `crypto-` (unless expected)
- `debug-*`, `dev-*` with network capabilities

## Network Red Flags

### Suspicious URLs
- Non-registry URLs in install scripts
- Hardcoded IPs (especially private ranges, unusual ports)
- URL shorteners (`bit.ly`, `tinyurl`)
- Dynamic DNS (`*.ngrok.io`, `*.serveo.net`, `*.duckdns.org`)
- Recently registered domains
- Unusual TLDs

### Legitimate
- Official project domain
- GitHub API (`api.github.com`) for releases/updates
- Package registries (`npmjs.com`, `pypi.org`, `crates.io`, `rubygems.org`)
- CDNs (`unpkg.com`, `cdnjs.com`, `jsdelivr.net`)

### Suspicious activity
- Analytics endpoints (`google-analytics`, `mixpanel`, `segment`, `amplitude`)
- POST requests with collected data to non-official hosts
- WebSocket connections to unknown servers
- Contacting multiple different external hosts

## Environment Variable Red Flags

### Harvest pattern (red flag)
- Bulk iteration over `process.env` / `os.environ`
- Regex/filter matching many secret names
- Serializing env vars before network send

### Legitimate
- Reading specific vars needed for module function
- `LOG_LEVEL`, `PORT`, `NODE_ENV` etc. — configuration only
- Each var has clear, visible usage

## Shell Command Red Flags

### Dangerous
- `bash -c` with base64/hex arguments
- Commands piped from `curl`/`wget`
- Hidden flags passed to common tools
- Piping sensitive output to network commands
- `dd`, `mkfs`, `rm -rf /` patterns
- `:(){ :|:& };:` class fork bombs

### Suspicious
- `chmod 777` on arbitrary paths
- `chown` to unexpected users
- Writing to `/usr/`, `/bin/`, `/sbin/` without root context
- Downloading binaries to global paths

## Quick Grep Cheatsheet

```bash
# Outbound URLs
grep -rEn 'https?://[^\s"'"'"']+' --include='*.{js,ts,py,sh,go,rs,rb,json}' .

# Hardcoded IPs
grep -rEn '[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}' --include='*.{js,ts,py,sh,go,rs,rb}' .

# Sensitive file reads
grep -rEn '(\.ssh|\.aws|credentials|\.netrc|\.npmrc|\.kube)' .

# Eval/exec
grep -rEn '\beval\s*\(|\bexec\s*\(|\bFunction\s*\(' --include='*.{js,ts,py,rb}' .

# Base64 decode
grep -rEn '(atob|btoa|base64\.b64decode|Buffer.from\([^,]+,\s*['"'"']base64['"'"'])' .

# Env harvesting
grep -rEn 'process\.env|os\.environ' --include='*.{js,ts,py}' .

# Postinstall hooks
grep -rEn '"postinstall"|"preinstall"' package.json

# Analytics
grep -rEn '(analytics|telemetry|tracking|mixpanel|amplitude|segment)' .
```
