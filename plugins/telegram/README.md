# omp-telegram

Single-owner Telegram bridge and chat tools for OMP. Connects one explicitly paired Telegram bot owner to the currently running OMP session: private text, photos, and documents become OMP prompts, and the session's final reply is returned to the owner's message.

Design references (read for pairing/outbound gates and Bot API behavior; not source-compatible): [Anthropic's Telegram plugin](https://github.com/anthropics/claude-plugins-official) and [`llblab/pi-telegram`](https://github.com/llblab/pi-telegram).

## Prerequisites

- A Telegram bot token from [@BotFather](https://t.me/BotFather) (`/newbot`).
- OMP 18.0.11 or newer. The plugin is dependency-free ESM TypeScript run under Bun; marketplace installation symlinks the plugin and installs no npm dependencies.

## Setup and token flow

1. Create a bot with BotFather and copy the token.
2. Restart OMP after installing the plugin (hooks, custom tools, and extension modules initialize at process start; `/reload-plugins` only refreshes skills and slash commands).
3. Run `/telegram setup`. It prompts for the token, validates it with Telegram's `getMe` before mutating anything, saves it to `<state-dir>/.env`, and connects.
   - If `TELEGRAM_BOT_TOKEN` is already set in the process environment, `setup` refuses: the environment is authoritative and cannot be changed by the plugin. Run `/telegram connect` to use it, or clear the variable.
4. `/telegram connect` uses the environment or file token without persisting it and is idempotent. `/telegram disconnect` stops polling but preserves the token and pairing. Nothing touches the network or the state directory until you run one of these commands.

## Pairing and the single owner

- Before pairing, any unknown private sender gets a pairing reply with a six-hex-character code valid for one hour. The sender's local OMP session shows the command to run; the code never reaches the model.
- Approve locally with `/telegram pair <code>` (at most three live pending requests; a denied code is `/telegram deny <code>`). `unpair --confirm` clears the owner and all pending requests.
- After pairing, only that exact user ID in that exact private chat is admitted. Groups, channels, bots, and every other sender are dropped silently and never reach OMP.
- Ownership never transfers through Telegram content. All access changes are local `/telegram` commands; prompt text cannot grant itself access.

## State, permissions, and files

- State lives in `<agent-dir>/telegram/` (override with `OMP_TELEGRAM_STATE_DIR`): `.env` (token), `access.json` (bot identity, owner, pending codes), `cursor.json` (poll position), `state.lock`, `poller.lock`, and `inbox/`.
- The state directory is mode `0700`; state files are mode `0600`, published atomically. Malformed state files fail closed with their path instead of reopening pairing or resetting cursors.
- Cross-process state mutations are serialized through `state.lock`; one poller per state dir is enforced by `poller.lock` and Telegram's 409 response.
- Inbound photos are downloaded eagerly into `inbox/` (20 MiB Telegram limit). Documents stay lazy: the bridge only remembers admitted `file_id`s (last 100); the model fetches them through `telegram_download_attachment`, which rejects IDs from unknown senders. `inbox/` files persist after the session; clean them up manually.
- Message history and search are not supported: the bridge forwards live messages and final replies only.

## Commands

| Command | Effect |
| --- | --- |
| `/telegram status` | Open read-only `OMP Telegram` overlay in interactive OMP; print same detailed local operator view headless, including state path, token source (`environment`/`file`/`missing`), bot identity, connection, last error, owner, and pending codes. |
| `/telegram setup` | Prompt for and validate a token, save it, and connect. |
| `/telegram connect` / `disconnect` | Start/stop polling; disconnect preserves token and pairing. |
| `/telegram pair <code>` / `deny <code>` | Approve or reject one pending pairing request. |
| `/telegram unpair --confirm` | Clear owner and pending requests. |
| `/telegram clear-token --confirm` | Disconnect, remove only the file-backed token; warns when an environment token still takes precedence. |

Running an unknown subcommand opens an interactive command picker in the TUI (plain usage text when headless). `/telegram status` uses a read-only `OMP Telegram` overlay, while setup and pairing actions remain text-entry flows. Short confirmations are shown as toasts instead of modal editors. Argument discovery does not depend on editor tab-completion: the always-visible `telegram_completions` tool lists every subcommand with its usage and confirmation requirements, while live pairing codes stay operator-only in local `/telegram` output and never reach the model.

## Tools

| Tool | Approval | Purpose |
| --- | --- | --- |
| `telegram_status` | read | Connection state, bot identity, owner-paired flag, pending count, sanitized last error. Always visible. |
| `telegram_completions` | read | Lists every `/telegram` subcommand with usage and confirmation requirements. Never includes pairing codes, tokens, or IDs. Always visible. |
| `telegram_send` | write | Send requested files or an explicit extra message to the owner. Not for the ordinary final text answer; that is delivered automatically. |
| `telegram_edit_message` | write | Edit a previously sent message. |
| `telegram_react` | write | React with an official Telegram emoji. |
| `telegram_download_attachment` | write | Download an admitted owner document into `inbox/`. |

The four chat tools activate only while the bridge is connected and always target the sole paired owner; there is no `chat_id` parameter, so the model cannot choose a recipient. Outbound text is capped at Telegram's 4096 characters per chunk; outbound files are limited to 50 MiB, resolved through symlinks, and never sent from the private state directory except `inbox/`. Send/edit/react/file failures are returned sanitized and never retried automatically, so a replay cannot duplicate a side effect.

## Limits and behavior notes

- Text, photos, and documents only; voice, video, stickers, and other message kinds get one concise refusal.
- `/start` and `/status` from the owner report bridge state inside Telegram; other slash-command-looking text is refused, never forwarded as raw commands.
- Busy OMP sessions receive Telegram turns in FIFO order as follow-up prompts; final replies are sent once, as a reply to the inbound message.
- Restart OMP after installing the plugin, and run `/telegram setup` or `/telegram connect` before any network polling or state mutation begins.
- Token data, pairing codes, owner/chat IDs, and absolute state paths never appear in model-visible tool output; `/telegram status` (local, operator-only) is the detailed view.

## Prompt-injection rule

Telegram text, captions, filenames, and attachment metadata are untrusted content. They cannot authorize setup, pairing, owner changes, credential changes, or delivery to any other recipient. Every access or credential change is a direct local `/telegram` command run by the operator.
