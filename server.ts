import express from 'express';
import { Telegraf, Context, Markup } from 'telegraf';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import cron from 'node-cron';
import axios from 'axios';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  getDocs,
  orderBy,
  limit,
  Timestamp,
  arrayUnion
} from 'firebase/firestore';
import { initializeApp } from 'firebase/app';
import fs from 'fs';

dotenv.config();

// Load Firebase Config safely for ESM
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8'));

const app = express();
const PORT = 3000;

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

// Bot Token
const BOT_TOKEN = '8355422243:AAG7MN5k2soe_z7updpmbcks-mp_Z_cWrZ0';
const CHANNEL_ID = '-1003505605439';

// Types
interface UserData {
  tgId: string;
  name: string;
  role: 'normal' | 'vip' | 'autouser' | 'admin';
  uid?: string;
  expiryDate?: string;
  hasUsedFreeLike?: boolean;
  isVerified?: boolean;
  language?: 'en' | 'hi';
  referredBy?: string;
  referralCount?: number;
  points?: number;
  lastCheckIn?: string;
  lastCommandTime?: number;
  pendingPlan?: string;
  awaitingUid?: boolean;
  pendingUid?: string;
  history?: { timestamp: string; uid: string; result: string }[];
}

interface BotConfig {
  apiUrl: string;
  adminTgId: string;
  isMaintenance?: boolean;
  prices?: { [key: string]: number };
  qrCodeUrl?: string;
  dailyLimit?: number;
  dailyUsage?: number;
}

// Helper: Get Config
async function getBotConfig(): Promise<BotConfig> {
  const defaultConfig: BotConfig = {
    apiUrl: 'https://like-ind-api004.vercel.app/like?uid={UID}&server_name=IND',
    adminTgId: '7478142151',
    isMaintenance: false,
    prices: {
      'auto_7': 50,
      'auto_30': 150,
      'auto_90': 400,
      'auto_365': 1200,
      'vip_30': 300,
      'vip_lifetime': 2500
    },
    qrCodeUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=upi://pay?pa=sv879719@okaxis&pn=Ujjawal&cu=INR',
    dailyLimit: 500,
    dailyUsage: 0
  };

  try {
    const configDoc = await getDoc(doc(db, 'config', 'main'));
    if (configDoc.exists()) {
      const data = configDoc.data();
      return {
        apiUrl: data.apiUrl || defaultConfig.apiUrl,
        adminTgId: data.adminTgId || defaultConfig.adminTgId,
        isMaintenance: data.isMaintenance ?? defaultConfig.isMaintenance,
        prices: data.prices || defaultConfig.prices,
        qrCodeUrl: data.qrCodeUrl || defaultConfig.qrCodeUrl,
        dailyLimit: data.dailyLimit ?? defaultConfig.dailyLimit,
        dailyUsage: data.dailyUsage ?? defaultConfig.dailyUsage
      };
    }
  } catch (e) {
    console.error('Error getting config:', e);
  }
  return defaultConfig;
}

// Helper: Call Like API
async function callLikeApi(uid: string, apiUrlTemplate: string) {
  if (!apiUrlTemplate) return '❌ API Error: URL Template missing ⚠️';
  
  const config = await getBotConfig();
  const dailyLimit = config.dailyLimit || 500;
  const dailyUsage = config.dailyUsage || 0;

  if (dailyUsage >= dailyLimit) {
    return '⚠️ <b>API Daily Limit Reached!</b>\n\nThe global daily limit for likes has been reached. Please try again tomorrow at 12:00 AM. ⏳';
  }

  const url = apiUrlTemplate.replace('{UID}', uid);
  try {
    const response = await axios.get(url);
    const data = response.data;
    
    // Increment usage count
    await updateDoc(doc(db, 'config', 'main'), {
      dailyUsage: (dailyUsage + 1)
    });

    let result = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
    
    if (result.toLowerCase().includes('success')) {
      return `✅ ${result} 🚀`;
    } else if (result.toLowerCase().includes('error') || result.toLowerCase().includes('fail')) {
      return `❌ ${result} ⚠️`;
    }
    
    return `✨ ${result} ✨`;
  } catch (error: any) {
    console.error('API Error:', error.message);
    return `❌ API Error: Connection failed (${error.message}) ⚠️`;
  }
}

let bot: Telegraf | null = null;
if (BOT_TOKEN) {
  try {
    bot = new Telegraf(BOT_TOKEN);
  } catch (e) {
    console.error('❌ Error initializing Telegraf:', e);
  }
} else {
  console.warn('⚠️ TELEGRAM_BOT_TOKEN is missing. Bot will not start.');
}

// Helper: Log to Channel and Firestore
async function logToChannel(message: string) {
  // Save to Firestore for Dashboard
  try {
    await setDoc(doc(collection(db, 'logs')), {
      message,
      timestamp: Timestamp.now(),
      type: 'info'
    });
  } catch (e) {
    console.error('Firestore Log Error:', e);
  }

  if (CHANNEL_ID && bot) {
    try {
      await bot.telegram.sendMessage(CHANNEL_ID, message, { parse_mode: 'HTML' });
    } catch (e) {
      console.error('Log Channel Error:', e);
    }
  }
}

// Helper: Run Auto-Likes for all active autousers
async function runAutoLikes() {
  console.log('🚀 Running auto-likes process...');
  try {
    const config = await getBotConfig();
    const now = new Date().toISOString();
    
    const q = query(collection(db, 'users'), where('role', '==', 'autouser'));
    const snapshot = await getDocs(q);
    
    let count = 0;
    for (const userDoc of snapshot.docs) {
      const data = userDoc.data();
      if (data.uid && data.expiryDate && data.expiryDate > now) {
        console.log(`Processing auto-like for UID: ${data.uid}`);
        const result = await callLikeApi(data.uid, config.apiUrl);
        const daysLeft = Math.ceil((new Date(data.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        
        const logMsg = `[ <b>Ujjawal auto user success</b> ]\n\n📝 <b>API Response:</b>\n<pre>${result}</pre>\n\n[ 🆔 <b>UID:</b> <code>${data.uid}</code> ]\n\n⏳ <b>Days Left:</b> ${daysLeft}\n👤 <b>User:</b> ${data.name || data.tgId}\n\n━━━━━━━━━━━━━━━\n⚙️ <b>Config:</b>\n👑 Admin: @UjjawalXsarkar\n🆔 Admin UID: <code>${config.adminTgId}</code>\n\n✨ <b>Set by @UjjawalXsarkar</b>`;
        await logToChannel(logMsg);
        count++;
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    return count;
  } catch (error) {
    console.error('❌ runAutoLikes error:', error);
    throw error;
  }
}

// Bot Commands (only if bot exists)
if (bot) {
  // Middleware: Maintenance & Anti-Spam
  bot.use(async (ctx, next) => {
    const tgId = ctx.from?.id.toString();
    if (!tgId) return next();

    const config = await getBotConfig();
    
    // Maintenance Check
    if (config.isMaintenance && tgId !== '7478142151') {
      return ctx.reply('🚧 <b>MAINTENANCE MODE</b>\n\nSorry, the bot is currently undergoing maintenance. Please try again later.\n\n✨ <b>Admin: @UjjawalXsarkar</b>', { parse_mode: 'HTML' });
    }

    // Anti-Spam (3 seconds cooldown)
    try {
      const userDoc = await getDoc(doc(db, 'users', tgId));
      const userData = userDoc.data() as UserData;
      const now = Date.now();
      
      if (userData?.lastCommandTime && now - userData.lastCommandTime < 3000 && tgId !== '7478142151') {
        return ctx.reply('⚠️ <b>Slow down!</b> Please wait a few seconds before sending another command.', { parse_mode: 'HTML' });
      }
      
      if (userDoc.exists()) {
        await updateDoc(doc(db, 'users', tgId), { lastCommandTime: now });
      }
    } catch (e) {}

    return next();
  });

  // Debug: Log all updates
  bot.use(async (ctx, next) => {
    console.log(`📩 Received update type: ${ctx.updateType}`);
    return next();
  });

  bot.catch((err, ctx) => {
    console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
  });

  // Force Join Check Function
  const checkJoin = async (ctx: Context, tgId: string) => {
    // Bypass for Admin
    if (tgId === '7478142151') return true;

    const channelUsername = '@jri5h5u5ecry4';
    const channelId = '-1002061054045'; 
    
    try {
      const member = await ctx.telegram.getChatMember(channelUsername, parseInt(tgId));
      return ['member', 'administrator', 'creator'].includes(member.status);
    } catch (e: any) {
      console.error(`❌ Join Check Error (@${channelUsername}):`, e.message);
      
      // If error is "member list is inaccessible", it's 100% because bot is not Admin
      if (e.message.includes('member list is inaccessible')) {
        console.warn('⚠️ ALERT: Bot is NOT an Admin in the channel. Please promote the bot to Admin in @jri5h5u5ecry4');
      }

      try {
        const member = await ctx.telegram.getChatMember(channelId, parseInt(tgId));
        return ['member', 'administrator', 'creator'].includes(member.status);
      } catch (e2: any) {
        console.error(`❌ Join Check Error (ID ${channelId}):`, e2.message);
      }
    }
    
    // If both fail, and it's a "Bad Request" (like chat not found), 
    // it means the bot setup is incomplete.
    return false;
  };

  const showStartMenu = async (ctx: Context) => {
    const tgId = ctx.from?.id.toString();
    if (!tgId) return;
    const name = ctx.from.first_name;
    
    // Handle Referral (only if it's a message with payload)
    let referredBy = null;
    if (ctx.updateType === 'message') {
      const startPayload = (ctx as any).startPayload;
      if (startPayload && startPayload !== tgId) {
        referredBy = startPayload;
      }
    }

    try {
      const userDoc = await getDoc(doc(db, 'users', tgId));
      let role: 'normal' | 'vip' | 'autouser' | 'admin' = 'normal';
      
      if (tgId === '7478142151') {
        role = 'admin';
      }

      if (!userDoc.exists()) {
        await setDoc(doc(db, 'users', tgId), {
          tgId,
          name,
          role: role,
          createdAt: Timestamp.now(),
          referredBy: referredBy,
          points: 0,
          referralCount: 0,
          isVerified: role === 'admin',
          language: 'en'
        });

        if (referredBy) {
          const referrerDoc = await getDoc(doc(db, 'users', referredBy));
          if (referrerDoc.exists()) {
            const rData = referrerDoc.data() as UserData;
            await updateDoc(doc(db, 'users', referredBy), {
              referralCount: (rData.referralCount || 0) + 1,
              points: (rData.points || 0) + 10 // 10 points per referral
            });
            try {
              await bot!.telegram.sendMessage(referredBy, `🎁 <b>New Referral!</b>\n\n${name} joined using your link. You earned <b>10 Points</b>!`, { parse_mode: 'HTML' });
            } catch (e) {}
          }
        }
      } else {
        const existingData = userDoc.data();
        if (tgId === '7478142151' && existingData.role !== 'admin') {
          await updateDoc(doc(db, 'users', tgId), { role: 'admin', isVerified: true });
        }
        role = existingData.role;
        if (tgId === '7478142151') role = 'admin';
      }
      
      const roleEmoji = role === 'admin' ? '👑' : role === 'vip' ? '💎' : role === 'autouser' ? '🤖' : '👤';
      const verifiedEmoji = (userDoc.data()?.isVerified || role === 'admin') ? ' ✅' : '';
      
      const welcomeMsg = `
✨ <b>WELCOME TO LIKE PRO BOT</b> ✨
━━━━━━━━━━━━━━━━━━━━
👤 <b>User:</b> ${name}${verifiedEmoji}
🎭 <b>Role:</b> ${roleEmoji} <b>${role.toUpperCase()}</b>
🆔 <b>ID:</b> <code>${tgId}</code>
━━━━━━━━━━━━━━━━━━━━
🚀 <i>The most powerful Auto-Like system on Telegram.</i>

👇 <b>Use the menu below to start!</b>
💡 <i>Type /help to see all available commands.</i>
✨ <b>Powered by @UjjawalXsarkar</b>`;

      // Main Keyboard (Reply Keyboard)
      const keyboard = [
        ['🚀 Free Like', '💎 VIP Like'],
        ['🎁 Daily Reward', '🏆 Leaderboard'],
        ['📜 History', '🎟️ Redeem Code'],
        ['🛒 Buy Premium', '📊 Status'],
        ['📞 Support', '❓ Help']
      ];

      // Inline Keyboard for quick actions
      const inlineKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('👤 View Profile', 'profile'), Markup.button.callback('🔗 Refer & Earn', 'refer_earn')]
      ]);

      // Welcome Banner (Placeholder URL - User can update in config)
      const bannerUrl = 'https://i.ibb.co/vYm6zXz/welcome-banner.jpg'; 
      
      try {
        await ctx.replyWithPhoto(bannerUrl, {
          caption: welcomeMsg,
          parse_mode: 'HTML',
          ...Markup.keyboard(keyboard).resize(),
          ...inlineKeyboard
        });
      } catch (e) {
        // Fallback to text if photo fails
        ctx.reply(welcomeMsg, {
          parse_mode: 'HTML',
          ...Markup.keyboard(keyboard).resize(),
          ...inlineKeyboard
        });
      }
    } catch (e) {
      console.error('❌ Error in showStartMenu:', e);
      ctx.reply('❌ <b>Database Connection Error!</b>\nPlease try again in a few seconds.', { parse_mode: 'HTML' });
    }
  };

  bot.start(async (ctx) => {
    console.log(`🚀 Bot started by: ${ctx.from.id} (@${ctx.from.username || 'no_username'})`);
    const tgId = ctx.from.id.toString();
    const name = ctx.from.first_name;
    
    // Force Join Check
    const isJoined = await checkJoin(ctx, tgId);
    if (!isJoined && tgId !== '7478142151') {
      const joinKeyboard = Markup.inlineKeyboard([
        [Markup.button.url('📢 Join Channel', 'https://t.me/jri5h5u5ecry4')],
        [Markup.button.callback('✅ I Have Joined', 'check_join')]
      ]);
      
      return ctx.reply(`👋 <b>Hello, ${name}!</b>\n\n⚠️ <b>Access Denied!</b>\nTo use this bot, you must join our official channel first.\n\n👇 <b>Click the button below to join:</b>`, {
        parse_mode: 'HTML',
        ...joinKeyboard
      });
    }

    return showStartMenu(ctx);
  });

  // Command Logic Functions
  const showProfile = async (ctx: Context) => {
    const tgId = ctx.from?.id.toString();
    if (!tgId) return;
    const userDoc = await getDoc(doc(db, 'users', tgId));
    if (!userDoc.exists()) return ctx.reply('❌ <b>Profile not found. Send /start first.</b>', { parse_mode: 'HTML' });
    
    const data = userDoc.data();
    const roleEmoji = data.role === 'admin' ? '👑' : data.role === 'vip' ? '💎' : data.role === 'autouser' ? '🤖' : '👤';
    
    let profileText = `
👤 <b>USER PROFILE</b>
━━━━━━━━━━━━━━━━━━━━
🎭 <b>Role:</b> ${roleEmoji} <b>${data.role.toUpperCase()}</b>
🆔 <b>TG ID:</b> <code>${data.tgId}</code>
🎮 <b>Game UID:</b> <code>${data.uid || 'Not Set'}</code>
━━━━━━━━━━━━━━━━━━━━
`;

    if (data.role !== 'normal' && data.role !== 'admin') {
      const expiry = new Date(data.expiryDate);
      const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      profileText += `📅 <b>Expiry:</b> ${expiry.toLocaleDateString()}
⏳ <b>Days Left:</b> ${daysLeft} Days\n━━━━━━━━━━━━━━━━━━━━\n`;
    }

    profileText += `✨ <b>Set by @UjjawalXsarkar</b>`;
    ctx.reply(profileText, { parse_mode: 'HTML' });
  };

  const showLeaderboard = async (ctx: Context) => {
    try {
      const q = query(collection(db, 'users'), orderBy('points', 'desc'), limit(10));
      const snapshot = await getDocs(q);
      
      let text = '🏆 <b>TOP 10 USERS LEADERBOARD</b>\n━━━━━━━━━━━━━━━━━━━━\n';
      let i = 1;
      snapshot.forEach(doc => {
        const data = doc.data();
        text += `${i === 1 ? '🥇' : i === 2 ? '🥈' : i === 3 ? '🥉' : '🔹'} <b>${data.name || 'User'}</b> - <code>${data.points || 0}</code> pts\n`;
        i++;
      });
      
      if (i === 1) text += '<i>No users on the leaderboard yet.</i>';
      
      text += `\n━━━━━━━━━━━━━━━━━━━━\n🎁 <b>Monthly Reward:</b>\nThe top user of the month will get 💎 <b>VIP for 1 Day!</b>`;
      
      ctx.reply(text, { parse_mode: 'HTML' });
    } catch (e) {
      console.error('Leaderboard error:', e);
      ctx.reply('❌ Error fetching leaderboard.');
    }
  };

  const showBuyPlans = async (ctx: Context) => {
    const config = await getBotConfig();
    const prices = config.prices || {};
    
    const plans = `
✨ <b>PREMIUM AUTO-LIKE PLANS</b> ✨
━━━━━━━━━━━━━━━━━━━━
🤖 <b>AUTO-USER (Daily Likes)</b>
🔹 7 Days: ₹${prices.auto_7 || 50}
🔹 30 Days: ₹${prices.auto_30 || 150}
🔹 90 Days: ₹${prices.auto_90 || 400}
🔹 365 Days: ₹${prices.auto_365 || 1200}

💎 <b>VIP (Instant High Priority)</b>
🔸 30 Days: ₹${prices.vip_30 || 300}
🔸 Lifetime: ₹${prices.vip_lifetime || 2500}

━━━━━━━━━━━━━━━━━━━━
👇 <b>Select a plan to buy:</b>`;

    const inlineKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🤖 Auto 7D', 'buy_auto_7'), Markup.button.callback('🤖 Auto 30D', 'buy_auto_30')],
      [Markup.button.callback('🤖 Auto 90D', 'buy_auto_90'), Markup.button.callback('🤖 Auto 365D', 'buy_auto_365')],
      [Markup.button.callback('💎 VIP 30D', 'buy_vip_30'), Markup.button.callback('💎 VIP Lifetime', 'buy_vip_lifetime')]
    ]);

    ctx.reply(plans, {
      parse_mode: 'HTML',
      ...inlineKeyboard
    });
  };

  const showHelp = async (ctx: Context) => {
    const tgId = ctx.from?.id.toString();
    if (!tgId) return;
    const userDoc = await getDoc(doc(db, 'users', tgId));
    const role = userDoc.data()?.role || 'normal';
    
    let helpText = `
❓ <b>LIKE PRO BOT - HELP MENU</b>
━━━━━━━━━━━━━━━━━━━━
👋 <b>Hello!</b> Here is how you can use this bot like a pro.

👤 <b>NORMAL COMMANDS</b>
🔹 <code>/start</code> - Refresh the bot menu
🔹 <code>/profile</code> - Check your role & expiry
🔹 <code>/like [UID]</code> - Get free trial likes
🔹 <code>/buy</code> - View premium plans & QR
🔹 <code>/leaderboard</code> - See top users
🔹 <code>/history</code> - Check your like history
🔹 <code>/support [msg]</code> - Contact Admin
🔹 <code>/status</code> - Check Server Status
🔹 <code>/redeem [CODE]</code> - Activate gift codes (Coins/Days)

💎 <b>VIP/AUTO COMMANDS</b>
🔸 <code>/viplike [UID]</code> - Instant high-priority likes

👑 <b>ADMIN COMMANDS</b>
⚙️ <code>/list</code> - View all premium users
⚙️ <code>/autouser [UID] [Days] [ID]</code>
⚙️ <code>/addVIP [UID] [Days] [ID]</code>
⚙️ <code>/check [ID]</code> - Inspect any user
⚙️ <code>/stats</code> - View bot statistics
⚙️ <code>/broadcast [Msg]</code> - Message all users
⚙️ <code>/genredeem [Code] [Coins] [Days] [Users]</code> - Create codes
⚙️ <code>/runauto</code> - Manually start daily likes
⚙️ <code>/setlimit [Num]</code> - Set daily API limit
⚙️ <code>/setchannel [ID]</code> - Set force-join channel
⚙️ <code>/setprice [Plan] [Price]</code> - Update plan prices
⚙️ <code>/newAPI [URL]</code> - Update API endpoint
⚙️ <code>/searchuid [UID]</code> - Find user by UID
⚙️ <code>/maintenance</code> - Toggle maintenance
━━━━━━━━━━━━━━━━━━━━
💡 <b>Pro Tip:</b> Use the <b>🎁 Daily Reward</b> button to earn points!
✨ <b>Support: @UjjawalXsarkar</b>`;

    ctx.reply(helpText, { parse_mode: 'HTML' });
  };

  const showUserList = async (ctx: Context) => {
    const tgId = ctx.from?.id.toString();
    if (!tgId) return;
    const userDoc = await getDoc(doc(db, 'users', tgId));
    if (userDoc.data()?.role !== 'admin' && tgId !== '7478142151') return ctx.reply('❌ <b>You are not an Admin!</b>', { parse_mode: 'HTML' });
    
    const q = query(collection(db, 'users'), where('role', 'in', ['autouser', 'vip']));
    const snapshot = await getDocs(q);
    
    let text = '📋 <b>PREMIUM USERS LIST</b>\n━━━━━━━━━━━━━━━━━━━━\n';
    snapshot.forEach(doc => {
      const data = doc.data();
      const expiry = new Date(data.expiryDate).toLocaleDateString();
      const roleEmoji = data.role === 'vip' ? '💎' : '🤖';
      text += `${roleEmoji} <code>${data.uid || 'N/A'}</code> | 📅 <b>${expiry}</b>\n`;
    });
    
    ctx.reply(text || '📭 <b>No premium users found.</b>', { parse_mode: 'HTML' });
  };

  bot.action('check_join', async (ctx) => {
    const tgId = ctx.from.id.toString();
    const isJoined = await checkJoin(ctx, tgId);
    
    if (isJoined) {
      await ctx.answerCbQuery('✅ Thank you for joining! Access granted.');
      await ctx.deleteMessage();
      return showStartMenu(ctx);
    } else {
      await ctx.answerCbQuery('❌ You haven\'t joined the channel yet!', { show_alert: true });
    }
  });

  bot.action(/^buy_(.+)$/, async (ctx) => {
    const planId = ctx.match[1];
    const tgId = ctx.from.id.toString();
    const config = await getBotConfig();
    
    const planNames: { [key: string]: string } = {
      'auto_7': '🤖 Auto-User (7 Days)',
      'auto_30': '🤖 Auto-User (30 Days)',
      'auto_90': '🤖 Auto-User (90 Days)',
      'auto_365': '🤖 Auto-User (365 Days)',
      'vip_30': '💎 VIP (30 Days)',
      'vip_lifetime': '💎 VIP (Lifetime)'
    };

    const planName = planNames[planId] || 'Unknown Plan';
    const qrCodeUrl = config.qrCodeUrl;
    
    const paymentInstructions = `
━━━━━━━━━━━━━━━━━━━━
📝 <b>Plan Selected:</b> ${planName}
━━━━━━━━━━━━━━━━━━━━
💳 <b>HOW TO PAY:</b>
1️⃣ Pay the amount for the plan to the QR code above.
2️⃣ Take a <b>Screenshot</b> of the successful payment.
3️⃣ <b>Send the Screenshot</b> here in this chat.
4️⃣ Admin will verify and activate your plan!

🚀 <i>Now please send the payment screenshot.</i>
✨ <b>Support: @UjjawalXsarkar</b>`;

    try {
      await updateDoc(doc(db, 'users', tgId), { 
        pendingPlan: planId,
        awaitingUid: true 
      });
      await ctx.answerCbQuery(`✅ Selected: ${planName}`);
      await ctx.reply(`🎮 <b>PLAN SELECTED:</b> ${planName}\n\n🚀 <b>Please send your Game UID now.</b>\nThis UID will be linked to your account once payment is approved.`, { parse_mode: 'HTML' });
    } catch (e) {
      console.error('Buy action error:', e);
      ctx.answerCbQuery('❌ Error selecting plan.');
    }
  });

  bot.on('text', async (ctx, next) => {
    const tgId = ctx.from.id.toString();
    const text = ctx.message.text.trim();

    // Skip if it's a command
    if (text.startsWith('/')) return next();

    try {
      const userDoc = await getDoc(doc(db, 'users', tgId));
      const userData = userDoc.data() as UserData;

      if (userData?.awaitingUid) {
        // Validate UID (usually numbers, length 8-12)
        if (!/^\d{5,15}$/.test(text)) {
          return ctx.reply('❌ <b>Invalid UID!</b>\nPlease send a valid numeric Game UID.', { parse_mode: 'HTML' });
        }

        await updateDoc(doc(db, 'users', tgId), {
          pendingUid: text,
          awaitingUid: false
        });

        const config = await getBotConfig();
        const planNames: { [key: string]: string } = {
          'auto_7': '🤖 Auto-User (7 Days)',
          'auto_30': '🤖 Auto-User (30 Days)',
          'auto_90': '🤖 Auto-User (90 Days)',
          'auto_365': '🤖 Auto-User (365 Days)',
          'vip_30': '💎 VIP (30 Days)',
          'vip_lifetime': '💎 VIP (Lifetime)'
        };
        const planName = planNames[userData.pendingPlan || ''] || 'Unknown Plan';

        const paymentInstructions = `
━━━━━━━━━━━━━━━━━━━━
📝 <b>Plan:</b> ${planName}
🎮 <b>UID:</b> <code>${text}</code>
━━━━━━━━━━━━━━━━━━━━
💳 <b>HOW TO PAY:</b>
1️⃣ Pay the amount for the plan to the QR code above.
2️⃣ Take a <b>Screenshot</b> of the successful payment.
3️⃣ <b>Send the Screenshot</b> here in this chat.
4️⃣ Admin will verify and activate your plan!

🚀 <i>Now please send the payment screenshot.</i>
✨ <b>Support: @UjjawalXsarkar</b>`;

        try {
          await ctx.replyWithPhoto(config.qrCodeUrl, {
            caption: paymentInstructions,
            parse_mode: 'HTML'
          });
        } catch (e) {
          await ctx.reply(`⚠️ <b>QR Code failed to load.</b>\n\n${paymentInstructions}`, { parse_mode: 'HTML' });
        }
        return;
      }
    } catch (e) {
      console.error('Text handler error:', e);
    }
    return next();
  });

  bot.on('photo', async (ctx) => {
    const tgId = ctx.from.id.toString();
    const name = ctx.from.first_name;
    
    try {
      const userDoc = await getDoc(doc(db, 'users', tgId));
      const userData = userDoc.data() as UserData;
      
      if (!userData?.pendingPlan) {
        return ctx.reply('⚠️ <b>Please select a plan first using /buy before sending a screenshot.</b>', { parse_mode: 'HTML' });
      }

      const planId = userData.pendingPlan;
      const pendingUid = userData.pendingUid || 'Not Provided';
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const fileId = photo.file_id;

      const adminMsg = `
💰 <b>NEW PAYMENT REQUEST!</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>User:</b> ${name}
🆔 <b>ID:</b> <code>${tgId}</code>
🎮 <b>UID:</b> <code>${pendingUid}</code>
📦 <b>Plan:</b> <code>${planId.toUpperCase()}</code>
━━━━━━━━━━━━━━━━━━━━
👇 <b>Approve or Reject this payment:</b>`;

      const adminKeyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Accept', `approve_${tgId}_${planId}`),
          Markup.button.callback('❌ Reject', `reject_${tgId}`)
        ]
      ]);

      await ctx.telegram.sendPhoto('7478142151', fileId, {
        caption: adminMsg,
        parse_mode: 'HTML',
        ...adminKeyboard
      });

      ctx.reply('✅ <b>Screenshot sent to Admin!</b>\nPlease wait while we verify your payment. You will be notified once it\'s approved.', { parse_mode: 'HTML' });
      
      // Clear pending plan to avoid multiple requests for same plan without selecting again
      // Or keep it? Let's keep it until approved/rejected.
    } catch (e) {
      console.error('Photo handler error:', e);
      ctx.reply('❌ Error processing your request.');
    }
  });

  bot.action(/^approve_(\d+)_(.+)$/, async (ctx) => {
    const targetId = ctx.match[1];
    const planId = ctx.match[2];
    const adminId = ctx.from.id.toString();

    if (adminId !== '7478142151') return ctx.answerCbQuery('❌ Admin Only!');

    try {
      let role: 'vip' | 'autouser' = planId.startsWith('vip') ? 'vip' : 'autouser';
      let days = 0;
      
      if (planId.includes('7')) days = 7;
      else if (planId.includes('30')) days = 30;
      else if (planId.includes('90')) days = 90;
      else if (planId.includes('365')) days = 365;
      else if (planId.includes('lifetime')) days = 36500; // ~100 years

      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + days);

      const userDoc = await getDoc(doc(db, 'users', targetId));
      const userData = userDoc.data() as UserData;
      const finalUid = userData.pendingUid || userData.uid || 'N/A';

      await updateDoc(doc(db, 'users', targetId), {
        role: role,
        uid: finalUid,
        expiryDate: expiryDate.toISOString(),
        pendingPlan: null,
        pendingUid: null,
        awaitingUid: false
      });

      await ctx.answerCbQuery('✅ Payment Approved!');
      await ctx.editMessageCaption(`✅ <b>PAYMENT APPROVED!</b>\n\n👤 User: <code>${targetId}</code>\n🎮 UID: <code>${finalUid}</code>\n📦 Plan: <code>${planId.toUpperCase()}</code>\n📅 Expiry: ${expiryDate.toLocaleDateString()}`, { parse_mode: 'HTML' });

      await ctx.telegram.sendMessage(targetId, `🎉 <b>CONGRATULATIONS!</b>\n\nYour payment has been <b>Approved</b>! ✅\n\n🎭 <b>New Role:</b> ${role.toUpperCase()}\n🎮 <b>Linked UID:</b> <code>${finalUid}</code>\n⏳ <b>Expiry:</b> ${expiryDate.toLocaleDateString()}\n\n🚀 <i>Enjoy your premium features!</i>`, { parse_mode: 'HTML' });
      
      logToChannel(`💰 <b>Payment Approved</b>\nUser: <code>${targetId}</code>\nPlan: ${planId}`);
    } catch (e) {
      console.error('Approve error:', e);
      ctx.answerCbQuery('❌ Error approving payment.');
    }
  });

  bot.action(/^reject_(\d+)$/, async (ctx) => {
    const targetId = ctx.match[1];
    const adminId = ctx.from.id.toString();

    if (adminId !== '7478142151') return ctx.answerCbQuery('❌ Admin Only!');

    try {
      await updateDoc(doc(db, 'users', targetId), { 
        pendingPlan: null,
        pendingUid: null,
        awaitingUid: false
      });
      
      await ctx.answerCbQuery('❌ Payment Rejected!');
      await ctx.editMessageCaption(`❌ <b>PAYMENT REJECTED!</b>\n\n👤 User: <code>${targetId}</code>`, { parse_mode: 'HTML' });

      await ctx.telegram.sendMessage(targetId, `❌ <b>PAYMENT REJECTED!</b>\n\nYour payment verification failed. If you think this is a mistake, please contact support.\n\n📞 <b>Support: @UjjawalXsarkar</b>`, { parse_mode: 'HTML' });
      
      logToChannel(`❌ <b>Payment Rejected</b>\nUser: <code>${targetId}</code>`);
    } catch (e) {
      console.error('Reject error:', e);
      ctx.answerCbQuery('❌ Error rejecting payment.');
    }
  });

  // Inline Action Handlers
  bot.action('daily_reward', async (ctx) => {
    const tgId = ctx.from.id.toString();
    const userDoc = await getDoc(doc(db, 'users', tgId));
    const userData = userDoc.data() as UserData;
    const now = new Date().toDateString();

    if (userData.lastCheckIn === now) {
      return ctx.answerCbQuery('⚠️ You already claimed your reward today!', { show_alert: true });
    }

    const rewardPoints = 5;
    await updateDoc(doc(db, 'users', tgId), {
      points: (userData.points || 0) + rewardPoints,
      lastCheckIn: now
    });

    ctx.answerCbQuery(`🎁 Success! You earned ${rewardPoints} Points.`, { show_alert: true });
  });

  bot.action('profile', async (ctx) => {
    ctx.answerCbQuery();
    return showProfile(ctx);
  });

  bot.action('refer_earn', async (ctx) => {
    const tgId = ctx.from.id.toString();
    const botInfo = await bot!.telegram.getMe();
    const referLink = `https://t.me/${botInfo.username}?start=${tgId}`;
    
    const msg = `
🔗 <b>REFER & EARN</b>
━━━━━━━━━━━━━━━━━━━━
Invite your friends and earn points!

🎁 <b>Reward:</b> 10 Points per friend
💰 <b>Your Points:</b> ${(await getDoc(doc(db, 'users', tgId))).data()?.points || 0}
👥 <b>Total Referrals:</b> ${(await getDoc(doc(db, 'users', tgId))).data()?.referralCount || 0}

👇 <b>Your Referral Link:</b>
<code>${referLink}</code>

<i>Share this link with your friends to start earning!</i>`;
    
    ctx.reply(msg, { parse_mode: 'HTML' });
    ctx.answerCbQuery();
  });

  bot.action('server_status', async (ctx) => {
    const config = await getBotConfig();
    let apiStatus = '🟢 Online';
    try {
      await axios.get(config.apiUrl.replace('{UID}', '123456789'), { timeout: 5000 });
    } catch (e) {
      apiStatus = '🔴 Offline';
    }

    const msg = `
🌐 <b>SERVER STATUS</b>
━━━━━━━━━━━━━━━━━━━━
🤖 <b>Bot:</b> 🟢 Online
🔥 <b>Like API:</b> ${apiStatus}
📂 <b>Database:</b> 🟢 Connected
━━━━━━━━━━━━━━━━━━━━
✨ <b>Powered by @UjjawalXsarkar</b>`;
    
    ctx.reply(msg, { parse_mode: 'HTML' });
    ctx.answerCbQuery();
  });

  // Buy Action Handlers
  bot.action(/^buy_(.+)$/, async (ctx) => {
    const planId = ctx.match[1];
    const tgId = ctx.from.id.toString();
    
    await updateDoc(doc(db, 'users', tgId), { pendingPlan: planId });
    
    ctx.reply(`
✅ <b>Plan Selected: ${planId.toUpperCase().replace('_', ' ')}</b>
━━━━━━━━━━━━━━━━━━━━
1️⃣ Please pay the amount using the QR code above.
2️⃣ After payment, <b>send the screenshot</b> of the transaction here.
3️⃣ Admin will verify and activate your plan instantly.

⚠️ <i>Make sure the transaction ID is visible in the screenshot.</i>`, { parse_mode: 'HTML' });
    ctx.answerCbQuery();
  });

  // Handle Screenshot Upload
  bot.on('photo', async (ctx) => {
    const tgId = ctx.from.id.toString();
    const userDoc = await getDoc(doc(db, 'users', tgId));
    const userData = userDoc.data() as UserData & { pendingPlan?: string };
    
    if (!userData?.pendingPlan) return;

    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photo.file_id;
    
    const adminMsg = `
🔔 <b>NEW PAYMENT PROOF</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>User:</b> ${ctx.from.first_name}
🆔 <b>ID:</b> <code>${tgId}</code>
🛒 <b>Plan:</b> <b>${userData.pendingPlan.toUpperCase()}</b>
━━━━━━━━━━━━━━━━━━━━
👇 <b>Approve or Reject:</b>`;

    const inlineKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✅ Approve', `approve_${tgId}_${userData.pendingPlan}`), Markup.button.callback('❌ Reject', `reject_${tgId}`)]
    ]);

    try {
      await bot!.telegram.sendPhoto('7478142151', fileId, {
        caption: adminMsg,
        parse_mode: 'HTML',
        ...inlineKeyboard
      });
      ctx.reply('✅ <b>Screenshot received!</b>\nAdmin is verifying your payment. You will be notified once activated.', { parse_mode: 'HTML' });
      await updateDoc(doc(db, 'users', tgId), { pendingPlan: null });
    } catch (e) {
      ctx.reply('❌ Error sending screenshot to admin. Please contact @UjjawalXsarkar directly.');
    }
  });

  // Admin Approval Handlers
  bot.action(/^approve_(.+)_(.+)$/, async (ctx) => {
    const targetId = ctx.match[1];
    const planId = ctx.match[2];
    
    let role: 'vip' | 'autouser' = planId.startsWith('vip') ? 'vip' : 'autouser';
    let days = 30;
    if (planId.includes('7')) days = 7;
    if (planId.includes('90')) days = 90;
    if (planId.includes('365')) days = 365;
    if (planId.includes('lifetime')) days = 3650;

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);

    await updateDoc(doc(db, 'users', targetId), {
      role: role,
      expiryDate: expiryDate.toISOString(),
      isVerified: true
    });

    try {
      await bot!.telegram.sendMessage(targetId, `🎉 <b>PAYMENT APPROVED!</b>\n\nYour <b>${planId.toUpperCase()}</b> plan is now active!\n\n📅 <b>Expiry:</b> ${expiryDate.toLocaleDateString()}\n🚀 <b>Enjoy your premium features!</b>`, { parse_mode: 'HTML' });
      ctx.editMessageCaption(`✅ <b>Approved!</b> User ${targetId} is now ${role.toUpperCase()}.`, { parse_mode: 'HTML' });
    } catch (e) {}
    ctx.answerCbQuery('User Approved!');
  });

  bot.action(/^reject_(.+)$/, async (ctx) => {
    const targetId = ctx.match[1];
    try {
      await bot!.telegram.sendMessage(targetId, `❌ <b>PAYMENT REJECTED!</b>\n\nAdmin could not verify your payment. Please contact @UjjawalXsarkar for help.`, { parse_mode: 'HTML' });
      ctx.editMessageCaption(`❌ <b>Rejected!</b> User ${targetId} notified.`, { parse_mode: 'HTML' });
    } catch (e) {}
    ctx.answerCbQuery('User Rejected!');
  });
  bot.hears('🚀 Free Like', (ctx) => ctx.reply('🚀 <b>Send your UID:</b>\n\nUsage: <code>/like [UID]</code>', { parse_mode: 'HTML' }));
  bot.hears('💎 VIP Like', (ctx) => ctx.reply('💎 <b>Send your UID:</b>\n\nUsage: <code>/viplike [UID]</code>', { parse_mode: 'HTML' }));
  bot.hears('🎁 Daily Reward', (ctx) => ctx.reply('🎁 <b>Claim your Daily Reward:</b>', { ...Markup.inlineKeyboard([[Markup.button.callback('🎁 Claim Points', 'daily_reward')]]) }));
  bot.hears('🏆 Leaderboard', (ctx) => showLeaderboard(ctx));
  bot.hears('📜 History', (ctx) => (bot as any).handleCommand('/history', ctx));
  bot.hears('🎟️ Redeem Code', (ctx) => ctx.reply('🎟️ <b>Redeem your Code:</b>\n\nUsage: <code>/redeem [CODE]</code>', { parse_mode: 'HTML' }));
  bot.hears('🛒 Buy Premium', showBuyPlans);
  bot.hears('📊 Status', (ctx) => (bot as any).handleCommand('/status', ctx));
  bot.hears('📞 Support', (ctx) => ctx.reply('📞 <b>Contact Support:</b>\n\nUsage: <code>/support [Your Message]</code>', { parse_mode: 'HTML' }));
  bot.hears('❓ Help', showHelp);

  bot.command('profile', showProfile);
  bot.command('leaderboard', showLeaderboard);
  bot.command('buy', showBuyPlans);
  bot.command('help', showHelp);
  bot.command('setchannel', async (ctx) => {
    const tgId = ctx.from.id.toString();
    if (tgId !== '7478142151') return;
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('❌ <b>Usage:</b> /setchannel [@username or ID]', { parse_mode: 'HTML' });
    
    const newChannel = args[1];
    await setDoc(doc(db, 'config', 'main'), { forceJoinChannel: newChannel }, { merge: true });
    ctx.reply(`✅ <b>Force Join Channel updated to:</b> <code>${newChannel}</code>\n\n⚠️ <i>Make sure the bot is an ADMIN in this channel!</i>`, { parse_mode: 'HTML' });
  });

  bot.command('setlimit', async (ctx) => {
    const tgId = ctx.from.id.toString();
    if (tgId !== '7478142151') return;
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('❌ <b>Usage:</b> /setlimit [Number]', { parse_mode: 'HTML' });
    
    const limit = parseInt(args[1]);
    if (isNaN(limit)) return ctx.reply('❌ <b>Invalid Limit!</b> Please provide a number.', { parse_mode: 'HTML' });
    
    await setDoc(doc(db, 'config', 'main'), { dailyLimit: limit }, { merge: true });
    ctx.reply(`✅ <b>API Daily Limit updated to:</b> <code>${limit}</code>`, { parse_mode: 'HTML' });
  });

  bot.command('list', showUserList);
  bot.command('autouserlist', showUserList);

  bot.command('runauto', async (ctx) => {
    const tgId = ctx.from.id.toString();
    if (tgId !== '7478142151') return;

    ctx.reply('🚀 <b>Starting manual auto-likes process...</b>\nThis might take a while depending on the number of users.', { parse_mode: 'HTML' });
    
    try {
      const count = await runAutoLikes();
      ctx.reply(`✅ <b>Manual auto-likes completed!</b>\nProcessed <code>${count}</code> users.`, { parse_mode: 'HTML' });
    } catch (e) {
      ctx.reply(`❌ <b>Error during manual auto-likes:</b>\n<pre>${e instanceof Error ? e.message : String(e)}</pre>`, { parse_mode: 'HTML' });
    }
  });

  bot.command('check', async (ctx) => {
    const tgId = ctx.from.id.toString();
    if (tgId !== '7478142151') return;
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('❌ <b>Usage:</b> /check [TG_ID]', { parse_mode: 'HTML' });
    
    const targetId = args[1];
    const userDoc = await getDoc(doc(db, 'users', targetId));
    if (!userDoc.exists()) return ctx.reply('❌ <b>User not found in database.</b>', { parse_mode: 'HTML' });
    
    const data = userDoc.data();
    ctx.reply(`
🔍 <b>USER INFO</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>Name:</b> ${data.name || 'N/A'}
🆔 <b>TG ID:</b> <code>${data.tgId}</code>
🎭 <b>Role:</b> <b>${data.role.toUpperCase()}</b>
🎮 <b>UID:</b> <code>${data.uid || 'N/A'}</code>
📅 <b>Expiry:</b> ${data.expiryDate || 'N/A'}
━━━━━━━━━━━━━━━━━━━━`, { parse_mode: 'HTML' });
  });

  bot.command('like', async (ctx) => {
    const tgId = ctx.from.id.toString();
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('❌ <b>Usage:</b> /like [UID]', { parse_mode: 'HTML' });
    
    const uid = args[1];
    const userDoc = await getDoc(doc(db, 'users', tgId));
    const userData = userDoc.data() as UserData;
    const isAdminUser = tgId === '7478142151' || userData?.role === 'admin';
    
    const config = await getBotConfig();
    let result = '';

    if (userData?.role === 'normal' && !isAdminUser) {
      if (userData.hasUsedFreeLike) {
        return ctx.reply('⚠️ <b>You have already used your free trial!</b>\n\n💳 Please buy Auto-User or VIP to continue.\nUse /buy to see plans.', { parse_mode: 'HTML' });
      }
      result = await callLikeApi(uid, config.apiUrl);
      await updateDoc(doc(db, 'users', tgId), { hasUsedFreeLike: true });
      ctx.reply(`✅ <b>Free Trial Success!</b>\n\n📝 <b>Result:</b>\n<pre>${result}</pre>\n\nTo get more likes, please /buy premium!`, { parse_mode: 'HTML' });
    } else {
      result = await callLikeApi(uid, config.apiUrl);
      ctx.reply(`✅ <b>Like Success!</b>\n\n📝 <b>Result:</b>\n<pre>${result}</pre>`, { parse_mode: 'HTML' });
    }

    // Save History
    const historyEntry = { timestamp: new Date().toISOString(), uid, result: result.substring(0, 100) };
    const newHistory = [...(userData.history || []), historyEntry].slice(-20);
    await updateDoc(doc(db, 'users', tgId), { history: newHistory });
  });

  bot.command('buy', showBuyPlans);

  bot.command('leaderboard', showLeaderboard);

  // Admin Commands
  bot.command('autouser', async (ctx) => {
    const tgId = ctx.from.id.toString();
    const userDoc = await getDoc(doc(db, 'users', tgId));
    if (userDoc.data()?.role !== 'admin' && tgId !== '7478142151') return ctx.reply('❌ <b>You are not an Admin!</b>', { parse_mode: 'HTML' });
    
    const args = ctx.message.text.split(' ');
    if (args.length < 4) return ctx.reply('❌ <b>Usage:</b> /autouser [UID] [Days] [TargetTGID]', { parse_mode: 'HTML' });
    
    const uid = args[1];
    const days = parseInt(args[2]);
    const targetTgId = args[3];
    
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);
    
    await setDoc(doc(db, 'users', targetTgId), {
      tgId: targetTgId,
      role: 'autouser',
      uid,
      expiryDate: expiryDate.toISOString()
    }, { merge: true });
    
    const config = await getBotConfig();
    const result = await callLikeApi(uid, config.apiUrl);
    
    const logMsg = `🚀 <b>AUTO-USER ACTIVATED!</b>\n\n👤 <b>Target ID:</b> <code>${targetTgId}</code>\n🆔 <b>UID:</b> <code>${uid}</code>\n⏳ <b>Duration:</b> ${days} Days\n\n📝 <b>API Result:</b>\n<pre>${result}</pre>\n\n━━━━━━━━━━━━━━━\n✨ <b>Set by @UjjawalXsarkar</b>`;
    ctx.reply(logMsg, { parse_mode: 'HTML' });
    
    // Notify User
    try {
      await bot!.telegram.sendMessage(targetTgId, `🎉 <b>CONGRATULATIONS!</b>\n\nYou have been upgraded to 🤖 <b>AUTO-USER</b> for <b>${days} Days</b>!\n\n🎮 <b>UID:</b> <code>${uid}</code>\n🚀 <b>Daily likes will start at 5 AM!</b>\n\n✨ <b>Set by @UjjawalXsarkar</b>`, { parse_mode: 'HTML' });
    } catch (e) {}
    
    logToChannel(logMsg);
  });

  bot.command('addVIP', async (ctx) => {
    const tgId = ctx.from.id.toString();
    const userDoc = await getDoc(doc(db, 'users', tgId));
    if (userDoc.data()?.role !== 'admin' && tgId !== '7478142151') return ctx.reply('❌ <b>You are not an Admin!</b>', { parse_mode: 'HTML' });
    
    const args = ctx.message.text.split(' ');
    if (args.length < 4) return ctx.reply('❌ <b>Usage:</b> /addVIP [UID] [Days] [TargetTGID]', { parse_mode: 'HTML' });
    
    const uid = args[1];
    const days = parseInt(args[2]);
    const targetTgId = args[3];
    
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);
    
    await setDoc(doc(db, 'users', targetTgId), {
      tgId: targetTgId,
      role: 'vip',
      uid,
      expiryDate: expiryDate.toISOString()
    }, { merge: true });
    
    ctx.reply(`💎 <b>VIP User Added Successfully!</b>\n\n👤 <b>ID:</b> <code>${targetTgId}</code>\n📅 <b>Days:</b> ${days}`, { parse_mode: 'HTML' });
    
    // Notify User
    try {
      await bot!.telegram.sendMessage(targetTgId, `🎉 <b>CONGRATULATIONS!</b>\n\nYou have been upgraded to 💎 <b>VIP</b> for <b>${days} Days</b>!\n\n🎮 <b>UID:</b> <code>${uid}</code>\n🚀 <b>Use /viplike for instant likes!</b>\n\n✨ <b>Set by @UjjawalXsarkar</b>`, { parse_mode: 'HTML' });
    } catch (e) {}
  });

  bot.command('newAPI', async (ctx) => {
    const tgId = ctx.from.id.toString();
    const userDoc = await getDoc(doc(db, 'users', tgId));
    if (userDoc.data()?.role !== 'admin') return ctx.reply('❌ <b>You are not an Admin!</b>', { parse_mode: 'HTML' });
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('❌ <b>Usage:</b> /newAPI [URL_WITH_{UID}]', { parse_mode: 'HTML' });
    
    const newUrl = args[1];
    await setDoc(doc(db, 'config', 'main'), { apiUrl: newUrl }, { merge: true });
    ctx.reply('✅ <b>API URL Updated successfully!</b>', { parse_mode: 'HTML' });
  });

  bot.action('server_status', (ctx) => {
    ctx.answerCbQuery();
    return (bot as any).handleCommand('/status', ctx);
  });

  bot.action('show_history', (ctx) => {
    ctx.answerCbQuery();
    return (bot as any).handleCommand('/history', ctx);
  });

  bot.command('redeem', async (ctx) => {
    const tgId = ctx.from.id.toString();
    const args = ctx.message.text.trim().split(/\s+/);
    if (args.length < 2) return ctx.reply('❌ <b>Usage:</b> <code>/redeem [CODE]</code>', { parse_mode: 'HTML' });
    
    const code = args[1].toUpperCase();
    
    try {
      const codeDoc = await getDoc(doc(db, 'redeemCodes', code));
      
      if (!codeDoc.exists()) return ctx.reply('❌ <b>Invalid Code!</b>\nThis code does not exist in our database.', { parse_mode: 'HTML' });
      
      const data = codeDoc.data();
      const maxUsers = data.maxUsers || 1;
      const usedBy = data.usedBy || [];
      const usedCount = usedBy.length;

      if (usedBy.includes(tgId)) {
        return ctx.reply('⚠️ <b>Already Redeemed!</b>\nYou have already used this code once.', { parse_mode: 'HTML' });
      }

      if (usedCount >= maxUsers) {
        return ctx.reply('❌ <b>Code Expired!</b>\nThis code has reached its maximum usage limit.', { parse_mode: 'HTML' });
      }
      
      // Check code expiry (validity period from creation)
      const createdAt = data.createdAt.toDate();
      const validityDays = data.days || 0;
      const expiryDate = new Date(createdAt);
      expiryDate.setDate(expiryDate.getDate() + validityDays);
      
      if (new Date() > expiryDate) {
        return ctx.reply('❌ <b>Code Expired!</b>\nThis code was only valid for ' + validityDays + ' days from creation.', { parse_mode: 'HTML' });
      }
      
      const userDoc = await getDoc(doc(db, 'users', tgId));
      const currentPoints = userDoc.data()?.points || 0;
      const coinsToAdd = data.coins || 0;
      
      await updateDoc(doc(db, 'users', tgId), {
        points: currentPoints + coinsToAdd,
        isVerified: true
      });
      
      await updateDoc(doc(db, 'redeemCodes', code), { 
        usedBy: arrayUnion(tgId),
        usedAt: Timestamp.now() 
      });
      
      ctx.reply(`🎉 <b>REDEEM SUCCESS!</b>\n━━━━━━━━━━━━━━━━━━━━\n💰 Points Added: <b>${coinsToAdd}</b>\n✨ Total Points: <b>${currentPoints + coinsToAdd}</b>\n━━━━━━━━━━━━━━━━━━━━\n🚀 <i>Enjoy your rewards!</i>`, { 
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('👤 View Profile', 'profile')]])
      });
    } catch (e: any) {
      console.error('Redeem error:', e);
      ctx.reply(`❌ <b>Error processing code:</b>\n<code>${e.message || 'Unknown error'}</code>`, { parse_mode: 'HTML' });
    }
  });

  bot.command('genredeem', async (ctx) => {
    const tgId = ctx.from.id.toString();
    if (tgId !== '7478142151') return ctx.reply('❌ <b>Admin Only!</b>', { parse_mode: 'HTML' });
    
    const args = ctx.message.text.trim().split(/\s+/);
    
    if (args.length < 5) {
      return ctx.reply('❌ <b>Usage:</b>\n<code>/genredeem [CODE] [COINS] [DAYS] [USERS]</code>\n\nExample: <code>/genredeem GIFT100 100 7 50</code>', { parse_mode: 'HTML' });
    }
    
    const code = args[1].toUpperCase();
    const coins = parseInt(args[2]);
    const days = parseInt(args[3]);
    const maxUsers = parseInt(args[4]);
    
    if (isNaN(coins) || isNaN(days) || isNaN(maxUsers)) {
      return ctx.reply('❌ <b>Invalid Input!</b>\nCoins, Days, and Users must be numbers.\n\nExample: <code>/genredeem GIFT100 100 7 50</code>', { parse_mode: 'HTML' });
    }

    try {
      if (/[.#$\[\]/]/.test(code)) {
         return ctx.reply('❌ <b>Invalid Code Name!</b>\nCode cannot contain characters like / . # $ [ ]', { parse_mode: 'HTML' });
      }

      await setDoc(doc(db, 'redeemCodes', code), {
        code,
        coins,
        days,
        maxUsers,
        usedBy: [],
        createdAt: Timestamp.now()
      });
      
      ctx.reply(`🎟️ <b>REDEEM CODE GENERATED!</b>\n━━━━━━━━━━━━━━━━━━━━\n🔑 Code: <code>${code}</code>\n💰 Coins: <b>${coins}</b>\n⏳ Valid for: <b>${days} Days</b>\n👥 Max Users: <b>${maxUsers}</b>\n━━━━━━━━━━━━━━━━━━━━\n✨ <i>Share this code with users!</i>`, { parse_mode: 'HTML' });
    } catch (e: any) {
      console.error('GenRedeem error:', e);
      ctx.reply(`❌ <b>Error generating code:</b>\n<code>${e.message || 'Unknown Error'}</code>`, { parse_mode: 'HTML' });
    }
  });

  bot.command('history', async (ctx) => {
    const tgId = ctx.from.id.toString();
    const userDoc = await getDoc(doc(db, 'users', tgId));
    const history = userDoc.data()?.history || [];
    
    if (history.length === 0) return ctx.reply('📭 <b>No history found.</b>', { parse_mode: 'HTML' });
    
    let text = '📜 <b>YOUR RECENT HISTORY</b>\n━━━━━━━━━━━━━━━━━━━━\n';
    history.slice(-10).reverse().forEach((h: any) => {
      text += `📅 ${new Date(h.timestamp).toLocaleString()}\n🎮 UID: <code>${h.uid}</code>\n📝 Result: ${h.result.substring(0, 50)}...\n\n`;
    });
    
    ctx.reply(text, { parse_mode: 'HTML' });
  });

  bot.command('support', async (ctx) => {
    const tgId = ctx.from.id.toString();
    const args = ctx.message.text.split(' ');
    const message = args.slice(1).join(' ');
    if (!message) return ctx.reply('❌ <b>Usage:</b> /support [Your Message]');
    
    const adminMsg = `
🎫 <b>NEW SUPPORT TICKET</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>User:</b> ${ctx.from.first_name}
🆔 <b>ID:</b> <code>${tgId}</code>
💬 <b>Message:</b> ${message}
━━━━━━━━━━━━━━━━━━━━`;
    
    try {
      await bot!.telegram.sendMessage('7478142151', adminMsg, { parse_mode: 'HTML' });
      ctx.reply('✅ <b>Ticket sent!</b> Admin will contact you soon.', { parse_mode: 'HTML' });
    } catch (e) {
      ctx.reply('❌ Error sending ticket. Please contact @UjjawalXsarkar directly.');
    }
  });

  bot.command('status', async (ctx) => {
    const config = await getBotConfig();
    let apiStatus = '🟢 Online';
    try {
      await axios.get(config.apiUrl.replace('{UID}', '123456789'), { timeout: 5000 });
    } catch (e) {
      apiStatus = '🔴 Offline';
    }

    const msg = `
🌐 <b>SERVER STATUS</b>
━━━━━━━━━━━━━━━━━━━━
🤖 <b>Bot:</b> 🟢 Online
🔥 <b>Like API:</b> ${apiStatus}
📂 <b>Database:</b> 🟢 Connected
━━━━━━━━━━━━━━━━━━━━
✨ <b>Powered by @UjjawalXsarkar</b>`;
    
    ctx.reply(msg, { parse_mode: 'HTML' });
  });

  bot.command('help', showHelp);

  bot.command('stats', async (ctx) => {
    const tgId = ctx.from.id.toString();
    if (tgId !== '7478142151') return;
    
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const totalUsers = usersSnap.size;
      const vipUsers = usersSnap.docs.filter(d => d.data().role === 'vip').length;
      const autoUsers = usersSnap.docs.filter(d => d.data().role === 'autouser').length;
      
      const statsMsg = `
📊 <b>BOT STATISTICS</b>
━━━━━━━━━━━━━━━━━━━━
👥 <b>Total Users:</b> ${totalUsers}
🤖 <b>Auto-Users:</b> ${autoUsers}
💎 <b>VIP Users:</b> ${vipUsers}
━━━━━━━━━━━━━━━━━━━━
✨ <b>Powered by @UjjawalXsarkar</b>`;
      
      ctx.reply(statsMsg, { parse_mode: 'HTML' });
    } catch (e) {
      ctx.reply('❌ Error fetching stats.');
    }
  });

  bot.command('viplike', async (ctx) => {
    const tgId = ctx.from.id.toString();
    const userDoc = await getDoc(doc(db, 'users', tgId));
    const userData = userDoc.data();
    const isAdminUser = tgId === '7478142151' || userData?.role === 'admin';
    
    if (userData?.role !== 'vip' && !isAdminUser) {
      return ctx.reply('❌ <b>This command is for VIP users only!</b>', { parse_mode: 'HTML' });
    }
    
    const args = ctx.message.text.split(' ');
    const uid = args[1] || userData?.uid;
    if (!uid) return ctx.reply('❌ <b>Usage:</b> /viplike [UID]', { parse_mode: 'HTML' });
    
    const config = await getBotConfig();
    const result = await callLikeApi(uid, config.apiUrl);
    
    ctx.reply(`💎 <b>VIP Instant Like Success!</b>\n\n📝 <b>Result:</b>\n<pre>${result}</pre>`, { parse_mode: 'HTML' });
  });

  // Admin Broadcast Command
  bot.command('broadcast', async (ctx) => {
    const tgId = ctx.from.id.toString();
    if (tgId !== '7478142151') return ctx.reply('❌ <b>Admin only!</b>', { parse_mode: 'HTML' });
    
    const text = (ctx.message as any)?.text || '';
    const message = text.replace('/broadcast', '').trim();
    
    const usersSnapshot = await getDocs(collection(db, 'users'));
    let count = 0;
    
    ctx.reply(`📢 <b>Starting broadcast to ${usersSnapshot.size} users...</b>`, { parse_mode: 'HTML' });
    
    for (const userDoc of usersSnapshot.docs) {
      try {
        if ((ctx.message as any).reply_to_message?.photo) {
          const photo = (ctx.message as any).reply_to_message.photo;
          const fileId = photo[photo.length - 1].file_id;
          await bot!.telegram.sendPhoto(userDoc.id, fileId, {
            caption: `📢 <b>MESSAGE FROM ADMIN</b>\n\n${message}\n\n✨ <b>Set by @UjjawalXsarkar</b>`,
            parse_mode: 'HTML'
          });
        } else {
          if (!message) continue;
          await bot!.telegram.sendMessage(userDoc.id, `📢 <b>MESSAGE FROM ADMIN</b>\n\n${message}\n\n✨ <b>Set by @UjjawalXsarkar</b>`, { parse_mode: 'HTML' });
        }
        count++;
      } catch (e) {}
    }
    
    ctx.reply(`✅ <b>Broadcast completed!</b>\nSent to ${count} users.`, { parse_mode: 'HTML' });
  });

  bot.command('searchuid', async (ctx) => {
    const tgId = ctx.from.id.toString();
    if (tgId !== '7478142151') return;
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('❌ <b>Usage:</b> /searchuid [UID]');
    
    const uid = args[1];
    const q = query(collection(db, 'users'), where('uid', '==', uid));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) return ctx.reply('❌ <b>No user found with this UID.</b>', { parse_mode: 'HTML' });
    
    let text = `🔍 <b>USERS WITH UID: ${uid}</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
    snapshot.forEach(doc => {
      const data = doc.data();
      text += `👤 <b>Name:</b> ${data.name}\n🆔 <b>TG ID:</b> <code>${data.tgId}</code>\n🎭 <b>Role:</b> ${data.role}\n\n`;
    });
    
    ctx.reply(text, { parse_mode: 'HTML' });
  });

  bot.command('setprice', async (ctx) => {
    const tgId = ctx.from.id.toString();
    if (tgId !== '7478142151') return;
    
    const args = ctx.message.text.split(' ');
    if (args.length < 3) return ctx.reply('❌ <b>Usage:</b> /setprice [PlanID] [Price]');
    
    const planId = args[1];
    const price = parseInt(args[2]);
    
    const configDoc = await getDoc(doc(db, 'config', 'main'));
    const currentPrices = configDoc.data()?.prices || {};
    currentPrices[planId] = price;
    
    await updateDoc(doc(db, 'config', 'main'), { prices: currentPrices });
    ctx.reply(`✅ <b>Price for ${planId} updated to ₹${price}!</b>`, { parse_mode: 'HTML' });
  });

  bot.command('maintenance', async (ctx) => {
    const tgId = ctx.from.id.toString();
    if (tgId !== '7478142151') return;
    
    const config = await getBotConfig();
    const newState = !config.isMaintenance;
    
    await updateDoc(doc(db, 'config', 'main'), { isMaintenance: newState });
    ctx.reply(`🚧 <b>Maintenance Mode: ${newState ? 'ON 🔴' : 'OFF 🟢'}</b>`, { parse_mode: 'HTML' });
  });
}

// Monthly VIP Reward & Daily Reset Cron Job (Runs at 12:00 AM IST / 6:30 PM UTC)
cron.schedule('30 18 * * *', async () => {
  console.log('🕒 Running Daily Reset (12:00 AM IST)...');
  const now = new Date();
  
  // Reset Global API Usage
  try {
    await updateDoc(doc(db, 'config', 'main'), { dailyUsage: 0 });
    console.log('✅ Global API usage reset for the new day.');
  } catch (e) {
    console.error('❌ Failed to reset daily usage:', e);
  }

  // Check if it's the 1st day of the month (IST)
  // Note: Since we run at 6:30 PM UTC, we check if tomorrow (UTC) is the 1st
  const istDate = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  if (istDate.getDate() === 1) {
    console.log('🏆 Granting Monthly VIP Reward...');
    const q = query(collection(db, 'users'), orderBy('points', 'desc'), limit(1));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      const topUser = snapshot.docs[0];
      const userData = topUser.data();
      const tgId = topUser.id;
      
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 1); // 1 Day VIP
      
      await updateDoc(doc(db, 'users', tgId), {
        role: 'vip',
        expiryDate: expiryDate.toISOString()
      });
      
      try {
        await bot!.telegram.sendMessage(tgId, `🥇 <b>CONGRATULATIONS!</b>\n\nYou are the <b>Top User of the Month</b>!\n\nYou have been awarded 💎 <b>VIP for 1 Day</b>! 🥳`, { parse_mode: 'HTML' });
      } catch (e) {}
    }
  }
});

// Daily Cron at 5 AM IST (11:30 PM UTC)
cron.schedule('30 23 * * *', async () => {
  console.log('🚀 Running daily auto-likes (5:00 AM IST)...');
  try {
    const count = await runAutoLikes();
    console.log(`✅ Daily auto-likes completed. Processed ${count} users.`);
  } catch (error) {
    console.error('❌ Auto-likes cron error:', error);
    logToChannel(`❌ <b>Auto-likes Cron Error:</b>\n<pre>${error instanceof Error ? error.message : String(error)}</pre>`);
  }
});

// Expiry Notification Cron (Every day at 10 AM IST / 4:30 AM UTC)
cron.schedule('30 4 * * *', async () => {
  console.log('🔔 Running Expiry Notifications (10:00 AM IST)...');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  
  const q = query(collection(db, 'users'), where('role', 'in', ['vip', 'autouser']));
  const snapshot = await getDocs(q);
  
  snapshot.forEach(async (userDoc) => {
    const data = userDoc.data();
    if (data.expiryDate && data.expiryDate.startsWith(tomorrowStr)) {
      try {
        // Notify User
        await bot!.telegram.sendMessage(userDoc.id, `⚠️ <b>EXPIRY ALERT!</b>\n\nYour premium plan is expiring in <b>24 hours</b>.\n\n💳 Please /buy a new plan to continue enjoying premium features!\n\n✨ <b>Powered by @UjjawalXsarkar</b>`, { parse_mode: 'HTML' });
        
        // Notify Channel
        const channelMsg = `⚠️ <b>EXPIRY ALERT (1 DAY LEFT)</b>\n━━━━━━━━━━━━━━━━━━━━\n🎮 UID: <code>${data.uid || 'N/A'}</code> | 📅 <b>${new Date(data.expiryDate).toLocaleDateString()}</b>\n👤 User: ${data.name || data.tgId}\n🎭 Role: ${data.role.toUpperCase()}`;
        await bot!.telegram.sendMessage('@jri5h5u5ecry4', channelMsg, { parse_mode: 'HTML' });
      } catch (e) {}
    }
  });
});

// Auto-Backup Cron (Every Sunday at 12 AM)
cron.schedule('0 0 * * 0', async () => {
  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    const users = usersSnap.docs.map(d => d.data());
    const backup = JSON.stringify(users, null, 2);
    
    await bot!.telegram.sendDocument('7478142151', { source: Buffer.from(backup), filename: `backup_${new Date().toISOString()}.json` }, {
      caption: `📂 <b>WEEKLY DATABASE BACKUP</b>\n\nTotal Users: ${users.length}\n\n✨ <b>Powered by @UjjawalXsarkar</b>`,
      parse_mode: 'HTML'
    });
  } catch (e) {
    console.error('Backup Error:', e);
  }
});

// Start Server
async function startServer() {
  // API routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/bot-status', async (req, res) => {
    if (!bot) return res.json({ status: 'error', message: 'Bot not initialized' });
    try {
      const me = await bot.telegram.getMe();
      res.json({ status: 'online', bot: me });
    } catch (e: any) {
      res.json({ status: 'offline', error: e.message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    if (bot) {
      bot.telegram.getMe().then((botInfo) => {
        console.log(`✅ Bot is online! Username: @${botInfo.username}`);
      }).catch((err) => {
        console.error('❌ Bot identity check failed:', err.message);
      });

      // Bot launch sequence (Non-blocking)
      bot.telegram.deleteWebhook().catch(() => {});
      bot.launch({
        allowedUpdates: ['message', 'callback_query'],
      })
        .then(() => console.log('✅ Bot launch sequence completed!'))
        .catch((err) => {
          console.error('❌ Failed to launch bot:', err.message);
          if (err.message.includes('404')) {
            console.error('👉 This usually means your TELEGRAM_BOT_TOKEN is invalid or the bot was deleted.');
          }
        });
    } else {
      console.log('⚠️ Bot not launched due to missing token.');
    }
  });
}

startServer();
