// tokenRefresher.ts
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { db } from './server.js'; // Assuming db is exported from server.ts
import axios from 'axios';
import cron from 'node-cron';

// API Logic - Now running on the cloud server
const API_URL = "https://vk-boy-acc-v1.vercel.app/guest_to_jwt";

async function getNewToken(uid: string, password: string) {
  try {
    const url = `${API_URL}?uid=${uid}&password=${password}`;
    const res = await axios.get(url, { timeout: 10000 });
    // Simple regex to extract token
    const match = res.data.match(/ey[A-Za-z0-9\-\._]+/);
    return match ? match[0] : null;
  } catch (e) {
    console.error(`Error refreshing token for ${uid}:`, e);
    return null;
  }
}

export async function refreshAllTokens() {
  console.log('🔄 Starting Automated Token Refresh on Cloud...');
  
  // 1. Get Accounts from Firestore
  const accountsDoc = await getDoc(doc(db, 'config', 'accounts_list'));
  if (!accountsDoc.exists()) {
    console.error('❌ Accounts list not found in Firestore!');
    return;
  }
  
  const accounts = accountsDoc.data().accounts; // [{uid, password}]
  const updatedTokens = [];

  // 2. Refresh Tokens
  for (const acc of accounts) {
    const token = await getNewToken(acc.uid, acc.password);
    if (token) {
      updatedTokens.push({ uid: acc.uid, token });
    }
  }

  // 3. Save to Cloud Firestore
  await setDoc(doc(db, 'config', 'tokens_store'), { all_tokens: updatedTokens });
  console.log(`✅ Automated refresh complete. ${updatedTokens.length} tokens updated.`);
}

// Run every 2 hours
cron.schedule('0 */2 * * *', refreshAllTokens);
