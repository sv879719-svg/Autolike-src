import fs from 'fs';
import path from 'path';
import axios from 'axios';

const ACCOUNTS_FILE = path.join(process.cwd(), 'new_bot_accounts.json');
const TOKENS_FILE = path.join(process.cwd(), 'new_bot_tokens.json');

async function updateTokens() {
  console.log('🔄 Standalone Token Refresher running for NEW BOT...');
  try {
    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    const tokens = [];

    for (const account of accounts) {
      try {
        const url = `https://vk-boy-acc-v1.vercel.app/guest_to_jwt?uid=${account.uid}&password=${account.password}`;
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json'
          }
        });
        if (response.data && response.data.token) {
          tokens.push({ uid: account.uid, token: response.data.token });
        }
      } catch (e) {
        console.error(`❌ Error fetching token for ${account.uid}:`, e);
      }
    }

    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
    console.log('✅ Tokens updated successfully in new_bot_tokens.json!');
  } catch (e) {
    console.error('❌ Error in updateTokens:', e);
  }
}

// Run immediately, then every hour
updateTokens();
setInterval(updateTokens, 60 * 60 * 1000);
