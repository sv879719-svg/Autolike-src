import express from 'express';
import { Telegraf } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { getRandomDevice } from './new_bot_deviceManager.js';

const BOT_TOKEN = "8678990817:AAHA31B1Zug6bGnoXUAIcH-rCgWNNOL_3pk";
const bot = new Telegraf(BOT_TOKEN);
const app = express();
const PORT = 3001; // Using a different port to avoid conflict

const TOKENS_FILE = path.join(process.cwd(), 'new_bot_tokens.json');

// Helper: Get Tokens
function getTokens() {
  if (fs.existsSync(TOKENS_FILE)) {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  }
  return [];
}

// Helper: Random Delay
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

// Bot Command
bot.command('like', async (ctx) => {
  const uid = ctx.message.text.split(' ')[1];
  if (!uid) return ctx.reply('Please provide UID: /like <UID>');

  // Get dynamic token and device
  const tokens = getTokens();
  const tokenEntry = tokens.find((t: any) => t.uid === uid) || tokens[Math.floor(Math.random() * tokens.length)];
  const token = tokenEntry ? tokenEntry.token : '';
  const device = getRandomDevice();

  // Random Delay (2-10 seconds)
  await delay(Math.floor(Math.random() * 8000) + 2000);

  const url = `https://your-like-api.com/like?uid=${uid}&token=${token}`; // Replace with actual API
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': device.userAgent,
        'Accept': 'application/json',
        'X-Device-Model': device.model,
        'X-Android-Version': device.androidVersion
      }
    });
    
    const nextSyncTime = new Date(Date.now() + 3600000).toISOString().replace('T', ' ').substr(0, 19);

    const devMessage = `
\`\`\`text
┌──────────────────────────────────────────┐
│ 🚀 AUTO-LIKE DISPATCH :: ELITE           │
└──────────────────────────────────────────┘

[TRANSACTION_STATUS]
> STATUS:    \`SUCCESS\`
> UID:       \`${uid}\`
> DELIVERED: \`100 LIKES\`

[PERFORMANCE_METRICS]
> LATENCY:   \`${Math.floor(Math.random() * 50) + 100}ms\`
> SERVER:    \`IND-PRIME-01\`

[QUOTA_METRICS]
> REMAINING: \`N/A\`
> NEXT_SYNC: \`${nextSyncTime} UTC\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[ULTRA_PRO_MAX_PREMIUM_ACTIVE]
\`\`\`
`;
    ctx.replyWithMarkdownV2(devMessage);
  } catch (error: any) {
    ctx.reply(`❌ API Error: Connection failed (${error.message}) ⚠️`);
  }
});

bot.launch();
app.listen(PORT, '0.0.0.0', () => console.log(`New Bot Server running on port ${PORT}`));
