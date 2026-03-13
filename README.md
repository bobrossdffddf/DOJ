# Warrant Discord Bot

A Discord bot for submitting and reviewing warrant requests with a judge approval flow.

## Features

- `/setup` command to configure:
  - Judge signing channel
  - Public embed/button channel
  - Active warrant channel
- Sends an embed with a **Create Warrant Request** button.
- Request flow collects:
  - Warrant type (Arrest/Search)
  - Suspect user (optional)
  - Suspected crime
  - Probable cause
  - Suspect photo reference (URL or upload note)
- Judge channel receives a formatted request with **Accept** and **Deny** buttons.
- On acceptance, judge fills optional supporting file link + Google Doc link.
- Approved warrant is posted in active warrants channel and DM'd to requester.

## Requirements

- Node.js 20+
- Discord bot with these scopes/intents:
  - `bot` + `applications.commands`
  - Privileged intent: Message Content (enabled in Discord developer portal)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from `.env.example`:

   ```bash
   cp .env.example .env
   ```

3. Fill in values:

   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`

4. Run bot:

   ```bash
   npm start
   ```

## Deploying on Proxmox (systemd VM/LXC style)

Use a process manager (recommended PM2) or systemd.

Example systemd service:

```ini
[Unit]
Description=Warrant Discord Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/warrant-bot
ExecStart=/usr/bin/node /opt/warrant-bot/src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/opt/warrant-bot/.env

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable warrant-bot
sudo systemctl start warrant-bot
sudo systemctl status warrant-bot
```

## Notes

Discord Components V2 is evolving; this implementation uses stable Discord interactions available in `discord.js` while preserving your requested workflow.
