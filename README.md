# thebet365api-mcp

An MCP server for [thebet365api.com](https://thebet365api.com): bet365 odds as JSON for Claude, Cursor, VS Code and any other MCP client.

- US games: moneyline, spread and total for the NFL, NBA, NHL, MLB, college football and college basketball, in season.
- European soccer: match result, double chance, goal line and goalscorer prices.
- Every price carries `observed_at`, the time it was read.

Independent and unofficial. Not affiliated with, endorsed by or sponsored by bet365. Data only; no wagering.

## Hosted server (no install)

Point any Streamable HTTP client at:

```
https://thebet365api.com/api/mcp
```

Add `Authorization: Bearer bt_...` for the data tools. Free key, no card: [thebet365api.com/sign-up](https://thebet365api.com/sign-up?ref=github).

## Local stdio server

This repo is a zero-dependency stdio relay to the hosted server, for clients that only run local commands. Node 18+.

```json
{
  "mcpServers": {
    "thebet365api": {
      "command": "npx",
      "args": ["-y", "github:johnnycapital/thebet365api-mcp"],
      "env": { "THEBET365API_KEY": "bt_..." }
    }
  }
}
```

Claude Code:

```bash
claude mcp add thebet365api -e THEBET365API_KEY=bt_... -- npx -y github:johnnycapital/thebet365api-mcp
```

Leave out the key to run keyless.

## Tools

No key:
- `get_bet365_coverage`: leagues and markets captured, and the age of the latest price.
- `preview_bet365_odds`: a 15-minute-delayed preview, up to 3 events.
- `get_onboarding_questions`, `send_feedback`.

With a key:
- `get_bet365_odds`: current prices by event.
- `list_bet365_events`: games with captured prices, soonest first.
- `get_bet365_line_history`: how a line moved.

Set `THEBET365API_MCP_TOOLS=all` to also expose the watchlist tools.

## Environment

| Variable | Effect |
| --- | --- |
| `THEBET365API_KEY` | Optional. Enables the data tools. |
| `THEBET365API_MCP_TOOLS=all` | Expose every hosted tool. |
| `THEBET365API_MCP_URL` | Override the upstream endpoint (used by the tests). |

## Plans

Free: 100 requests a month, no card. Paid from $49 a month. See [pricing](https://thebet365api.com/pricing).

## Tests

```bash
npm test                       # offline, mocked upstream
THEBET365API_LIVE=1 npm test   # also calls the hosted server
```

## Links

- Docs: https://thebet365api.com/docs
- OpenAPI: https://thebet365api.com/openapi.json
- MCP Registry: `com.thebet365api/server`

## License

MIT, Copyright (c) 2026 Stunning Couches LLC.
