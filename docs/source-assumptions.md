# Source assumptions

Date checked: 2026-05-02

This project implements terminal Claude Code profile configuration selection. It intentionally does not implement automatic Claude Desktop Chat, Claude Desktop Code, or Cowork account switching until a separate Desktop feasibility artifact is created and reviewed.

## Official source assumptions

- `CLAUDE_CONFIG_DIR` overrides Claude Code's default `~/.claude` config directory and is documented for multiple accounts side by side.
- Claude Code credentials are platform-specific: macOS uses Keychain; Linux and Windows use `.credentials.json` under `~/.claude` or `$CLAUDE_CONFIG_DIR`.
- Terminal Claude Code auth precedence can be affected by cloud-provider credentials, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `apiKeyHelper`, `CLAUDE_CODE_OAUTH_TOKEN`, and then `/login` OAuth.
- Claude Desktop and remote sessions use OAuth exclusively and do not read API-key environment variables or call `apiKeyHelper`.
- Claude Code settings can define `env`, `apiKeyHelper`, hooks, plugins, MCP controls, and provider policy. Managed settings have highest precedence.
- `~/.claude.json` is mixed application state and is not safe to copy or symlink wholesale between profiles.
- Claude Code local application data can include plaintext transcripts, tool output, prompt history, paste/image caches, task state, and debug logs.
- Claude Desktop Code and CLI share some Code configuration files, but Desktop Chat MCP configuration is separate from Claude Code MCP configuration.
- Cowork requires Claude Desktop on macOS or Windows and a paid Claude plan.

## Sources

- Claude Code environment variables: https://code.claude.com/docs/en/env-vars
- Claude Code authentication: https://code.claude.com/docs/en/authentication
- Claude Code settings: https://code.claude.com/docs/en/settings
- Claude Code `.claude` directory: https://code.claude.com/docs/en/claude-directory
- Claude Code Desktop: https://code.claude.com/docs/en/desktop
- Claude Code MCP: https://code.claude.com/docs/en/mcp
- Claude Cowork getting started: https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork
- Cowork computer use: https://support.claude.com/en/articles/14128542-let-claude-use-your-computer-in-cowork

## Implementation boundary

The current release may claim:

- managed terminal Claude Code profile config selection;
- default-deny sharing;
- effective-auth risk auditing;
- legacy profile inspection/import.

The current release must not claim:

- automatic Claude Desktop Chat account switching;
- automatic Claude Cowork account switching;
- Desktop Code support;
- verified account identity from `CLAUDE_CONFIG_DIR` alone.
