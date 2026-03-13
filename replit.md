# Warrant Discord Bot

A Discord bot for submitting and reviewing warrant requests with a judge approval flow.

## Architecture

- **Runtime**: Node.js 20+ (ESM modules)
- **Framework**: discord.js v14
- **Type**: Backend-only Discord bot (no frontend/web server)
- **Config storage**: JSON file at `data/guild-config.json`

## Project Structure

```
src/
  index.js        # Main bot entrypoint — slash commands, interaction handlers
  configStore.js  # JSON-based guild config persistence
data/
  guild-config.json  # Auto-created; stores per-guild channel IDs
```

## Environment Variables / Secrets

| Key                | Description                          |
|--------------------|--------------------------------------|
| `DISCORD_TOKEN`    | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID`| Application/client ID from Discord Developer Portal |

## Workflow

- **Name**: `Start application`
- **Command**: `node src/index.js`
- **Output type**: console (no web port)

## Bot Features

- `/setup` (Admin only) — Configure judge channel, embed channel, and active warrant channel
- Warrant request flow: type selection, suspect selection, crime/probable cause modal
- Judge approval flow: Accept/Deny buttons with optional file/doc links
- Approved warrants posted to active channel and DM'd to requester
