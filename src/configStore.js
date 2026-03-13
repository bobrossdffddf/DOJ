import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.cwd(), 'data');
const configPath = path.join(dataDir, 'guild-config.json');

function ensureConfigFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({}, null, 2), 'utf8');
  }
}

export function loadConfig() {
  ensureConfigFile();
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw || '{}');
}

export function saveConfig(config) {
  ensureConfigFile();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

export function getGuildConfig(guildId) {
  const cfg = loadConfig();
  return cfg[guildId] || null;
}

export function setGuildConfig(guildId, guildConfig) {
  const cfg = loadConfig();
  cfg[guildId] = guildConfig;
  saveConfig(cfg);
}
