// index.js
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import MutasikuSDK from 'mutasiku-sdk';

import { logger } from './lib/logger.js';
import { 
  handleDANAInitiation, 
  verifyDANAOtp, 
  completeDANASetup 
} from './lib/walletHandlers.js';
import { 
  handleDANABankTransferInit, 
  completeDANABankTransfer, 
  handleDANAQRISTransfer 
} from './lib/transferHandlers.js';
import { 
  getMutasiForUser, 
  getAccountsForUser, 
  removeAccountForUser 
} from './lib/accountHandler.js';
import {
  isValidPhoneNumber,
  formatPhoneNumber,
  formatCurrency
} from './lib/utils.js';
import { 
  updateSessionData, 
  getSessionData, 
  deleteSessionData, 
  createSessionData 
} from './lib/sessionUtils.js';
import { 
  isUserAuthenticated, 
  authenticateUser, 
  isUserBlocked, 
  logoutUser
} from './lib/authHandler.js';

// Load environment variables
dotenv.config();

// Environment variables with defaults
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_BOT_NAME = process.env.TELEGRAM_BOT_NAME || '';
const MUTASIKU_API_KEY = process.env.MUTASIKU_API_KEY || '';
const DB_PATH = process.env.DB_PATH;

// Validate required environment variables
if (!TELEGRAM_BOT_TOKEN) {
  logger.error('telegram.init', 'TELEGRAM_BOT_TOKEN is not set in environment variables');
  process.exit(1);
}

if (!MUTASIKU_API_KEY) {
  logger.error('telegram.init', 'MUTASIKU_API_KEY is not set in environment variables');
  process.exit(1);
}

// Supported wallet types
const SUPPORTED_WALLETS = [
  { code: 'DANA', name: 'DANA', id: 'dana-id' },
  { code: 'OVO', name: 'OVO', id: 'ovo-id' },
  { code: 'GOPAY-MERCHANT', name: 'GoPay Merchant', id: 'gopay-id' }
];

// Ensure the data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize the bot
startBot();

/**
 * Function to start the bot in a single process
 */
async function startBot() {
  logger.info('telegram.init', `Starting bot process ${process.pid}`);
  
  // Set up the database
  const db = await setupDatabase();
  
  // Initialize Mutasiku SDK
  const sdk = new MutasikuSDK({
    apiKey: MUTASIKU_API_KEY,
    logger
  });

  // Initialize bot
  const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

  // Session management with SQLite
  const sessionManager = initializeSessionManager(db);
  
  // Set up a cleanup job to remove expired sessions
  setupSessionCleanup(db);
  
  // Configure bot commands
  setupBotCommands(bot, sdk, sessionManager);
  
  // Start the bot
  bot.launch()
    .then(() => logger.info('telegram.init', `Bot initialized successfully with process ID ${process.pid}`))
    .catch(error => logger.error('telegram.init', 'Failed to initialize Telegram bot', { error: error instanceof Error ? error.message : 'Unknown error' }));

  // Enable graceful stop
  setupGracefulShutdown(bot, db);
}

/**
 * Setup database function
 */
async function setupDatabase() {
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });
  
  // Create the sessions table if it doesn't exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      chatId TEXT NOT NULL,
      type TEXT NOT NULL,
      state TEXT,
      data TEXT,
      expires INTEGER NOT NULL,
      createdAt INTEGER NOT NULL
    )
  `);
  
  // Create indexes for faster lookups
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_chatId ON sessions(chatId);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
    CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions(type)
  `);
  
  logger.info('database.init', 'Database initialized successfully');
  return db;
}

/**
 * Initialize session management functions
 */
function initializeSessionManager(db) {
  /**
   * Create a new session
   */
  const createSession = async (chatId, type, data = {}) => {
    const sessionId = `${chatId}_${type}_${Date.now()}`;
    const now = Date.now();
    const expires = now + (15 * 60 * 1000); // 15 minutes default
    
    await db.run(
      'INSERT INTO sessions (id, chatId, type, state, data, expires, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      sessionId,
      chatId,
      type,
      '',
      JSON.stringify(data),
      expires,
      now
    );
    
    return {
      id: sessionId,
      chatId,
      type,
      state: '',
      data,
      expires: new Date(expires),
      createdAt: new Date(now)
    };
  };

  /**
   * Get the most recent active session for a chatId
   * If type is specified, get that specific type
   */
  const getSession = async (chatId, type = null) => {
    const now = Date.now();
    
    let query = 'SELECT * FROM sessions WHERE chatId = ? AND expires > ?';
    let params = [chatId, now];
    
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    
    query += ' ORDER BY createdAt DESC LIMIT 1';
    
    const row = await db.get(query, ...params);
    
    if (!row) return null;
    
    return {
      id: row.id,
      chatId: row.chatId,
      type: row.type,
      state: row.state,
      data: JSON.parse(row.data),
      expires: new Date(row.expires),
      createdAt: new Date(row.createdAt)
    };
  };

  /**
   * Update an existing session
   */
  const updateSession = async (sessionId, updates) => {
    const row = await db.get('SELECT * FROM sessions WHERE id = ?', sessionId);
    if (!row) return null;
    
    const session = {
      id: row.id,
      chatId: row.chatId,
      type: row.type,
      state: row.state,
      data: JSON.parse(row.data),
      expires: new Date(row.expires),
      createdAt: new Date(row.createdAt)
    };
    
    const updatedSession = { ...session };
    if (updates.state !== undefined) updatedSession.state = updates.state;
    if (updates.data) {
      updatedSession.data = { ...updatedSession.data, ...updates.data };
    }
    
    await db.run(
      'UPDATE sessions SET state = ?, data = ? WHERE id = ?',
      updatedSession.state,
      JSON.stringify(updatedSession.data),
      sessionId
    );
    
    return updatedSession;
  };

  /**
   * Delete a session
   */
  const deleteSession = async (sessionId) => {
    const result = await db.run('DELETE FROM sessions WHERE id = ?', sessionId);
    return result.changes > 0;
  };
  
  /**
   * Delete all sessions for a chatId and type
   */
  const deleteSessionsByType = async (chatId, type) => {
    const result = await db.run('DELETE FROM sessions WHERE chatId = ? AND type = ?', chatId, type);
    return result.changes > 0;
  };
  
  /**
   * Extend session expiration time
   */
  const extendSession = async (sessionId, minutes = 15) => {
    const now = Date.now();
    const expires = now + (minutes * 60 * 1000);
    
    const result = await db.run(
      'UPDATE sessions SET expires = ? WHERE id = ?',
      expires,
      sessionId
    );
    
    return result.changes > 0;
  };
  
  return {
    createSession,
    getSession,
    updateSession,
    deleteSession,
    deleteSessionsByType,
    extendSession
  };
}

/**
 * Setup session cleanup job
 */
function setupSessionCleanup(db) {
  setInterval(async () => {
    try {
      const now = Date.now();
      const result = await db.run('DELETE FROM sessions WHERE expires < ?', now);
      
      if (result.changes > 0) {
        logger.info('database.cleanup', `Cleaned up ${result.changes} expired sessions`);
      }
    } catch (error) {
      logger.error('database.cleanup', 'Error cleaning up expired sessions', { error });
    }
  }, 60000); // Run every minute
}

/**
 * Configure all bot commands
 */
function setupBotCommands(bot, sdk, sessionManager) {
  // Start command
  bot.start(async (ctx) => {
    logger.info('telegram.command', 'Received /start command', {
      userId: ctx.from?.id
    });
    
    const chatId = ctx.chat?.id.toString();
    const isAuthenticated = await isUserAuthenticated(chatId, sessionManager);
    
    if (isAuthenticated) {
      await ctx.reply(`Selamat datang kembali di ${TELEGRAM_BOT_NAME}! 🤖\n\nAnda sudah login. Gunakan /help untuk melihat perintah yang tersedia.`);
    } else {
      await ctx.reply(
        `Selamat datang di ${TELEGRAM_BOT_NAME}! 🤖\n\n` +
        '🔐 <b>Akses Terbatas</b>\n' +
        'Bot ini memerlukan autentikasi sebelum digunakan.\n\n' +
        '🔑 Gunakan perintah /login untuk masuk.\n',
        { parse_mode: 'HTML' }
      );
    }
  });

  // Login command
  bot.command('login', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    // Check if already authenticated
    const isAuthenticated = await isUserAuthenticated(chatId, sessionManager);
    if (isAuthenticated) {
      return await ctx.reply('✅ Anda sudah login!\n\nGunakan /logout untuk keluar atau /help untuk melihat perintah yang tersedia.');
    }

    // Check if user is blocked
    const blockStatus = await isUserBlocked(chatId, sessionManager);
    if (blockStatus.blocked) {
      return await ctx.reply(`🚫 ${blockStatus.message}`);
    }

    // Clear any existing session that's not auth_attempts
    const existingSession = await sessionManager.getSession(chatId);
    if (existingSession && existingSession.type !== 'auth_attempts') {
      await sessionManager.deleteSession(existingSession.id);
    }

    // Create login session
    const session = await sessionManager.createSession(chatId, 'login', {});
    await sessionManager.updateSession(session.id, { state: 'awaiting_password' });

    let message = '🔐 <b>Login ke Bot</b>\n\nSilakan masukkan password:';
    
    if (blockStatus.attemptsLeft) {
      message += `\n\n⚠️ Sisa percobaan: ${blockStatus.attemptsLeft}`;
    }

    await ctx.reply(message, { parse_mode: 'HTML' });
  });

  // Logout command
  bot.command('logout', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const success = await logoutUser(chatId, sessionManager);
    
    if (success) {
      await ctx.reply('✅ Anda telah logout.\n\nGunakan /login untuk masuk kembali.');
    } else {
      await ctx.reply('❌ Anda belum login.');
    }
  });

  // Protected commands with individual auth checks
  bot.command('help', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    console.log("test");
    
    const isAuthenticated = await isUserAuthenticated(chatId, sessionManager);
    if (!isAuthenticated) {
      return await ctx.reply(
        '🔐 <b>Akses Terbatas</b>\n\n' +
        'Anda harus login terlebih dahulu untuk menggunakan bot ini.\n\n' +
        'Gunakan perintah /login untuk masuk.',
        { parse_mode: 'HTML' }
      );
    }

    ctx.reply(`Bantuan ${TELEGRAM_BOT_NAME}:

🔐 <b>Autentikasi:</b>
/login - Login ke bot
/logout - Logout dari bot

📱 <b>Manajemen Akun:</b>
/add - Tambahkan akun e-wallet baru
/remove - Hapus akun e-wallet yang ada
/accounts - Lihat semua akun Anda

💸 <b>Transfer:</b>
/transfer - Transfer dana dari akun DANA Anda

📊 <b>Transaksi:</b>
/mutasi - Lihat transaksi terbaru Anda
  Filter dasar:
  • /mutasi limit 10 - Tampilkan 10 transaksi
  • /mutasi days 30 - Tampilkan transaksi dari 30 hari terakhir
  • /mutasi page 2 - Beralih ke halaman hasil berikutnya
  
  Filter lanjutan:
  • /mutasi type credit - Hanya tampilkan uang masuk
  • /mutasi type debit - Hanya tampilkan uang keluar
  • /mutasi provider dana - Filter berdasarkan kode penyedia
  • /mutasi account [ID] - Tampilkan transaksi untuk akun tertentu
  • /mutasi min 1000000 - Filter jumlah minimum
  • /mutasi max 5000000 - Filter jumlah maksimum
  • /mutasi search "transfer" - Cari teks tertentu

Anda dapat menggabungkan filter: /mutasi days 30 type credit min 500000

/help - Tampilkan pesan bantuan ini`, { parse_mode: 'HTML' });
  });

  // Mutasi command with auth check
  bot.command('mutasi', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;
    
    const isAuthenticated = await isUserAuthenticated(chatId, sessionManager);
    if (!isAuthenticated) {
      return await ctx.reply(
        '🔐 <b>Akses Terbatas</b>\n\n' +
        'Anda harus login terlebih dahulu untuk menggunakan bot ini.\n\n' +
        'Gunakan perintah /login untuk masuk.',
        { parse_mode: 'HTML' }
      );
    }
    
    await handleMutasiCommand(ctx, sdk);
  });
  
  // Accounts command with auth check
  bot.command('accounts', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;
    
    const isAuthenticated = await isUserAuthenticated(chatId, sessionManager);
    if (!isAuthenticated) {
      return await ctx.reply(
        '🔐 <b>Akses Terbatas</b>\n\n' +
        'Anda harus login terlebih dahulu untuk menggunakan bot ini.\n\n' +
        'Gunakan perintah /login untuk masuk.',
        { parse_mode: 'HTML' }
      );
    }
    
    await handleAccountsCommand(ctx, sdk);
  });
  
  // Remove command with auth check
  bot.command('remove', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;
    
    const isAuthenticated = await isUserAuthenticated(chatId, sessionManager);
    if (!isAuthenticated) {
      return await ctx.reply(
        '🔐 <b>Akses Terbatas</b>\n\n' +
        'Anda harus login terlebih dahulu untuk menggunakan bot ini.\n\n' +
        'Gunakan perintah /login untuk masuk.',
        { parse_mode: 'HTML' }
      );
    }
    
    await handleRemoveCommand(ctx, sdk);
  });
  
  // Add command with auth check
  bot.command('add', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;
    
    const isAuthenticated = await isUserAuthenticated(chatId, sessionManager);
    if (!isAuthenticated) {
      return await ctx.reply(
        '🔐 <b>Akses Terbatas</b>\n\n' +
        'Anda harus login terlebih dahulu untuk menggunakan bot ini.\n\n' +
        'Gunakan perintah /login untuk masuk.',
        { parse_mode: 'HTML' }
      );
    }
    
    await handleAddCommand(ctx, sessionManager);
  });
  
  // Transfer command with auth check
  bot.command('transfer', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;
    
    const isAuthenticated = await isUserAuthenticated(chatId, sessionManager);
    if (!isAuthenticated) {
      return await ctx.reply(
        '🔐 <b>Akses Terbatas</b>\n\n' +
        'Anda harus login terlebih dahulu untuk menggunakan bot ini.\n\n' +
        'Gunakan perintah /login untuk masuk.',
        { parse_mode: 'HTML' }
      );
    }
    
    await handleTransferCommand(ctx, sdk, sessionManager);
  });
  
  // Cancel command with auth check
  bot.command('cancel', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;
    
    const isAuthenticated = await isUserAuthenticated(chatId, sessionManager);
    if (!isAuthenticated) {
      return await ctx.reply(
        '🔐 <b>Akses Terbatas</b>\n\n' +
        'Anda harus login terlebih dahulu untuk menggunakan bot ini.\n\n' +
        'Gunakan perintah /login untuk masuk.',
        { parse_mode: 'HTML' }
      );
    }
    
    // Delete any active session
    const session = await getSessionData(chatId, sessionManager);
    if (session) {
      await deleteSessionData(session.id, sessionManager);
      await ctx.reply('Tindakan dibatalkan. Ketik /add atau /transfer untuk memulai kembali.');
    } else {
      await ctx.reply('Tidak ada tindakan yang sedang berlangsung.');
    }
  });

  // Set up text message handler BEFORE other commands
  setupTextMessageHandler(bot, sessionManager, sdk);
  
  // Set up callback actions
  setupCallbackActions(bot, sdk, sessionManager);
}

/**
 * Handle transfer command
 */
async function handleTransferCommand(ctx, sdk, sessionManager) {
  const chatId = ctx.chat?.id.toString();
  if (!chatId) {
    logger.error('telegram.transfer', 'No chat context found');
    return;
  }

  try {
    // Check for existing session
    const existingSession = await getSessionData(chatId, sessionManager);
    if (existingSession) {
      await ctx.reply('Anda memiliki proses yang sedang berlangsung. Silakan selesaikan atau ketik /cancel untuk membatalkan.');
      return;
    }

    // Show loading message
    const loadingMsg = await ctx.reply('Memuat akun DANA Anda... 🔄');

    try {
      // Get user's DANA accounts
      const accountsResponse = await sdk.getAccounts();
      
      if (accountsResponse.status !== 'success' || !accountsResponse.data) {
        await ctx.telegram.editMessageText(
          chatId,
          loadingMsg.message_id,
          undefined,
          '❌ Gagal mengambil daftar akun. Silakan coba lagi nanti.'
        );
        return;
      }

      // Filter only active DANA accounts
      const danaAccounts = accountsResponse.data.filter(
        account => account.type === 'ewallet' && 
                  account.isActive === true && 
                  account.provider.code === 'DANA'
      );

      if (danaAccounts.length === 0) {
        await ctx.telegram.editMessageText(
          chatId,
          loadingMsg.message_id,
          undefined,
          'Anda tidak memiliki akun DANA aktif. Gunakan /add untuk menambahkan akun DANA terlebih dahulu.'
        );
        return;
      }

      // Create keyboard for account selection
      const keyboard = danaAccounts.map((account) => [
        { 
          text: `${account.phoneNumber} - ${account.name} - ${formatCurrency(account.balance)}`, 
          callback_data: `transfer_account:${account.id}` 
        }
      ]);
      
      keyboard.push([{ text: 'Batal', callback_data: 'cancel_transfer' }]);

      await ctx.telegram.editMessageText(
        chatId,
        loadingMsg.message_id,
        undefined,
        'Pilih akun DANA untuk transfer:',
        {
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );
    } catch (error) {
      logger.error('telegram.transfer', 'Error in transfer command', { error });
      await ctx.telegram.editMessageText(
        chatId,
        loadingMsg.message_id,
        undefined,
        '❌ Gagal memuat akun. Silakan coba lagi nanti.'
      );
    }
  } catch (error) {
    logger.error('telegram.transfer', 'Error preparing transfer command', { error });
    await ctx.reply('Gagal mempersiapkan transfer. Silakan coba lagi nanti.');
  }
}

/**
 * Handle mutasi command
 */
async function handleMutasiCommand(ctx, sdk) {
  const chatId = ctx.chat?.id.toString();
  if (!chatId) {
    logger.error('telegram.mutasi', 'No chat context found');
    return;
  }
  
  try {
    // Parse command arguments for filtering
    const args = ctx.message?.text.split(' ').slice(1) || [];
    const options = parseMutasiOptions(args);
    
    // Show a "loading" message
    const loadingMsg = await ctx.reply('Memuat transaksi Anda... 🔄');
    
    try {
      // Get transactions for this user
      const result = await getMutasiForUser(sdk, chatId, options);
      
      if (result.success) {
        // Edit the loading message with the results
        await ctx.telegram.editMessageText(
          chatId,
          loadingMsg.message_id,
          undefined,
          result.message,
          { parse_mode: 'HTML' }
        );
        
        // If there are no transactions, offer some guidance
        if (result.data.length === 0 && !options.search && !options.type && !options.providerCode) {
          await ctx.reply(`Tidak ada transaksi ditemukan untuk kriteria yang ditentukan. Anda dapat mencoba:\n\n- /mutasi days 30 (untuk 30 hari terakhir)\n- /mutasi limit 10 (tampilkan hingga 10 transaksi)\n- /mutasi type credit (hanya tampilkan uang masuk)`);
        }
      } else {
        await ctx.telegram.editMessageText(
          chatId,
          loadingMsg.message_id,
          undefined,
          '❌ ' + result.message
        );
      }
    } catch (error) {
      logger.error('telegram.mutasi', 'Error fetching transactions', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      await ctx.telegram.editMessageText(
        chatId,
        loadingMsg.message_id,
        undefined,
        '❌ Gagal mengambil transaksi. Silakan coba lagi nanti atau periksa aplikasi.'
      );
    }
  } catch (error) {
    logger.error('telegram.mutasi', 'Error processing mutasi command', { error });
    await ctx.reply('Gagal memproses permintaan. Silakan coba lagi nanti.');
  }
}

/**
 * Parse mutasi command options
 */
function parseMutasiOptions(args) {
  const options = {
    limit: 5, // Default limit
    days: 7,  // Default to last 7 days
    page: 1   // Default page
  };
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i].toLowerCase();
    const nextArg = args[i+1];
    
    if (arg === 'limit' && nextArg) {
      const parsedValue = parseInt(nextArg);
      if (!isNaN(parsedValue) && parsedValue > 0) {
        options.limit = Math.min(parsedValue, 20); // Cap at 20 for readability
        i++; // Skip the next arg
      }
    } 
    else if (arg === 'page' && nextArg) {
      const parsedValue = parseInt(nextArg);
      if (!isNaN(parsedValue) && parsedValue > 0) {
        options.page = parsedValue;
        i++;
      }
    }
    else if (arg === 'days' && nextArg) {
      const parsedValue = parseInt(nextArg);
      if (!isNaN(parsedValue) && parsedValue > 0) {
        options.days = Math.min(parsedValue, 90); // Cap at 90 days
        i++;
      }
    }
    else if (arg === 'account' && nextArg) {
      options.accountId = nextArg;
      i++;
    }
    else if (arg === 'type' && nextArg) {
      const type = nextArg.toUpperCase();
      if (['CREDIT', 'DEBIT'].includes(type)) {
        options.type = type;
        i++;
      }
    }
    else if (arg === 'provider' && nextArg) {
      options.providerCode = nextArg;
      i++;
    }
    else if (arg === 'min' && nextArg) {
      const parsedValue = parseInt(nextArg);
      if (!isNaN(parsedValue)) {
        options.minAmount = parsedValue;
        i++;
      }
    }
    else if (arg === 'max' && nextArg) {
      const parsedValue = parseInt(nextArg);
      if (!isNaN(parsedValue)) {
        options.maxAmount = parsedValue;
        i++;
      }
    }
    else if (arg === 'search' && nextArg) {
      options.search = nextArg;
      i++;
    }
  }
  
  return options;
}

/**
 * Handle accounts command
 */
async function handleAccountsCommand(ctx, sdk) {
  const chatId = ctx.chat?.id.toString();
  if (!chatId) {
    logger.error('telegram.accounts', 'No chat context found');
    return;
  }
  
  try {
    // Show a "loading" message
    const loadingMsg = await ctx.reply('Memuat akun Anda... 🔄');
    
    try {
      // Get accounts using the handler function
      const result = await getAccountsForUser(sdk, chatId);
      
      if (result.success) {
        // Display the formatted message
        await ctx.telegram.editMessageText(
          chatId,
          loadingMsg.message_id,
          undefined,
          result.message,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.telegram.editMessageText(
          chatId,
          loadingMsg.message_id,
          undefined,
          '❌ ' + result.message
        );
      }
    } catch (error) {
      logger.error('telegram.accounts', 'Error in accounts command', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      await ctx.telegram.editMessageText(
        chatId,
        loadingMsg.message_id,
        undefined,
        '❌ Gagal mengambil akun. Silakan coba lagi nanti atau periksa aplikasi.'
      );
    }
  } catch (error) {
    logger.error('telegram.accounts', 'Error fetching user info', { error });
    await ctx.reply('Gagal memverifikasi akun Anda. Silakan coba lagi nanti.');
  }
}

/**
 * Handle remove command
 */
async function handleRemoveCommand(ctx, sdk) {
  const chatId = ctx.chat?.id.toString();
  if (!chatId) return;
  
  try {
    // Show a "loading" message
    const loadingMsg = await ctx.reply('Memuat daftar akun... 🔄');
    
    try {
      // Get all accounts for this user
      const accountsResponse = await sdk.getAccounts();
      
      // Check if response is in the expected format
      if (accountsResponse.status !== 'success' || !accountsResponse.data) {
        await ctx.telegram.editMessageText(
          chatId,
          loadingMsg.message_id,
          undefined,
          '❌ Gagal mengambil daftar akun. Silakan coba lagi nanti.'
        );
        return;
      }
      
      // Filter only active e-wallet accounts
      const walletAccounts = accountsResponse.data.filter(
        account => account.type === 'ewallet' && account.isActive === true
      );
      
      if (walletAccounts.length === 0) {
        await ctx.telegram.editMessageText(
          chatId,
          loadingMsg.message_id,
          undefined,
          'Anda tidak memiliki akun e-wallet untuk dihapus.'
        );
        return;
      }
      
      // Create keyboard
      const keyboard = walletAccounts.map((account) => [
        { 
          text: `${account.accountName} (${account.provider.name || account.provider.code || 'Unknown'})`, 
          callback_data: `remove:${account.id}` 
        }
      ]);
      
      keyboard.push([{ text: 'Batal', callback_data: 'cancel_remove' }]);
      
      // Send selection message
      await ctx.telegram.editMessageText(
        chatId,
        loadingMsg.message_id,
        undefined,
        'Pilih akun yang ingin dihapus:',
        {
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );
    } catch (error) {
      logger.error('telegram.remove', 'Error in remove command', { error });
      await ctx.telegram.editMessageText(
        chatId,
        loadingMsg.message_id,
        undefined,
        '❌ Gagal memuat daftar akun. Silakan coba lagi nanti.'
      );
    }
  } catch (error) {
    logger.error('telegram.remove', 'Error preparing remove command', { error });
    await ctx.reply('Gagal mempersiapkan daftar akun. Silakan coba lagi nanti.');
  }
}

/**
 * Handle add command
 */
async function handleAddCommand(ctx, sessionManager) {
  const chatId = ctx.chat?.id.toString();
  if (!chatId) {
    logger.error('telegram.add', 'No chat context found');
    return;
  }
  
  try {
    // Check for existing session
    const existingSession = await getSessionData(chatId, sessionManager);
    if (existingSession) {
      await ctx.reply('Anda memiliki proses yang sedang berlangsung. Silakan selesaikan atau ketik /cancel untuk membatalkan.');
      return;
    }
    
    // Check if we have any supported wallets
    if (SUPPORTED_WALLETS.length === 0) {
      await ctx.reply('Tidak ada e-wallet yang didukung saat ini.');
      return;
    }
    
    // If only one wallet type is supported, skip selection
    if (SUPPORTED_WALLETS.length === 1) {
      const wallet = SUPPORTED_WALLETS[0];
      
      // Create a session for adding the wallet
      const session = await createSessionData(chatId, 'add_wallet', { 
        walletCode: wallet.code,
        providerId: wallet.id
      }, sessionManager);
      
      // Update session state
      await updateSessionData(session, sessionManager, {
        state: 'awaiting_phone'
      });
      
      await ctx.reply(`Silakan masukkan nomor telepon ${wallet.name} Anda dalam format: 081xxxxxxxxx\n\nBalas dengan nomor telepon Anda atau ketik /cancel untuk membatalkan.`);
    } else {
      // Multiple wallet types - show selection keyboard
      const keyboard = SUPPORTED_WALLETS.map((wallet) => [
        { text: wallet.name, callback_data: `wallet_${wallet.code}` }
      ]);
      
      // Add a cancel button
      keyboard.push([{ text: 'Batal', callback_data: 'wallet_cancel' }]);
      
      await ctx.reply(
        'Pilih e-wallet yang ingin ditambahkan:',
        {
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );
    }
  } catch (error) {
    logger.error('telegram.add', 'Error in add command', { error });
    await ctx.reply('Gagal memulai proses penambahan akun. Silakan coba lagi nanti.');
  }
}

/**
 * Handle bank transfer amount input with improved UX
 */
async function handleBankAmountInput(ctx, session, sdk, sessionManager) {
  if (!ctx.message?.text) {
    return await ctx.reply('Input tidak valid. Silakan masukkan jumlah yang valid.');
  }

  const amountText = ctx.message.text.trim().replace(/[.,]/g, '');
  const amount = parseInt(amountText);

  if (isNaN(amount) || amount < 10000) {
    return await ctx.reply('Jumlah tidak valid. Minimum transfer ke bank adalah Rp 10.000.\n\nSilakan masukkan jumlah yang valid:');
  }

  const loadingMsg = await ctx.reply('Memuat daftar bank... 🔄');

  try {
    const banksResponse = await sdk.getDanaBanks(session.data.accountId);
    
    if (!banksResponse.success || !Array.isArray(banksResponse.data) || banksResponse.data.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        '❌ Gagal memuat daftar bank. Silakan coba lagi nanti.'
      );
      return;
    }

    // Update session with amount and banks
    await updateSessionData(session, sessionManager, {
      state: 'selecting_bank_method',
      data: { 
        amount,
        availableBanks: banksResponse.data 
      }
    });

    // Show bank selection options
    const selectionKeyboard = [
      [{ text: '🔍 Cari Bank', callback_data: 'search_bank' }],
      [{ text: '⭐ Bank Populer', callback_data: 'popular_banks' }],
      [{ text: '📋 Semua Bank (A-Z)', callback_data: 'all_banks_az' }],
      [{ text: '❌ Batal', callback_data: 'cancel_transfer' }]
    ];

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      `💰 <b>Jumlah transfer: ${formatCurrency(amount)}</b>\n\n🏦 <b>Cara pilih bank tujuan:</b>\n\n🔍 <b>Cari Bank</b> - Ketik nama bank\n⭐ <b>Bank Populer</b> - 10 bank utama\n📋 <b>Semua Bank</b> - Daftar lengkap (${banksResponse.data.length} bank)`,
      {
        reply_markup: {
          inline_keyboard: selectionKeyboard
        },
        parse_mode: 'HTML'
      }
    );
  } catch (error) {
    logger.error('telegram.transfer.amount', 'Error processing amount', { error });
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      '❌ Gagal memproses jumlah. Silakan coba lagi nanti.'
    );
  }
}

/**
 * Bank search handler
 */
async function handleBankSearch(ctx, session, sessionManager) {
  if (!ctx.message?.text) {
    return await ctx.reply('Silakan ketik nama bank yang ingin dicari.');
  }

  const searchTerm = ctx.message.text.trim().toLowerCase();
  
  if (searchTerm.length < 2) {
    return await ctx.reply('Ketik minimal 2 karakter untuk mencari bank.\n\nContoh: BCA, Mandiri, BNI');
  }

  const allBanks = session.data.availableBanks;
  
  // Search banks by name
  const matchingBanks = allBanks.filter(bank => {
    const bankName = (bank.name || bank.instLocalName).toLowerCase();
    return bankName.includes(searchTerm) || 
           bank.instId.toLowerCase().includes(searchTerm);
  });

  if (matchingBanks.length === 0) {
    return await ctx.reply(
      `❌ Tidak ditemukan bank dengan kata kunci: "<b>${ctx.message.text}</b>"\n\n💡 Coba kata kunci lain:\n• BCA\n• Mandiri\n• BNI\n• BRI\n• CIMB\n\nAtau ketik /cancel untuk membatalkan.`,
     { parse_mode: 'HTML' }
   );
  }

  if (matchingBanks.length === 1) {
    // Only one match, select it automatically
    const bankData = matchingBanks[0];
    
    await updateSessionData(session, sessionManager, {
      state: 'awaiting_account_number',
      data: { bankData }
    });

    const bankName = bankData.name || bankData.instLocalName;
    const transferAmount = formatCurrency(session.data.amount);

    await ctx.reply(
      `✅ <b>Bank ditemukan: ${bankName}</b>\n💰 <b>Jumlah: ${transferAmount}</b>\n\n📝 Silakan masukkan nomor rekening tujuan (8-20 digit):`,
      { parse_mode: 'HTML' }
    );
  } else {
    // Multiple matches, show selection
    const bankKeyboard = matchingBanks.slice(0, 10).map((bank) => [
      { 
        text: `${bank.name || bank.instLocalName}`, 
        callback_data: `select_bank:${allBanks.indexOf(bank)}`
      }
    ]);
    
    if (matchingBanks.length > 10) {
      bankKeyboard.push([{ 
        text: `➡️ Lihat ${matchingBanks.length - 10} bank lainnya`, 
        callback_data: 'more_search_results' 
      }]);
    }
    
    bankKeyboard.push([{ text: '🔍 Cari Lagi', callback_data: 'search_bank' }]);
    bankKeyboard.push([{ text: '❌ Batal', callback_data: 'cancel_transfer' }]);

    const transferAmount = formatCurrency(session.data.amount);

    await ctx.reply(
      `🔍 <b>Hasil pencarian "${ctx.message.text}":</b>\n💰 <b>Jumlah: ${transferAmount}</b>\n\nDitemukan ${matchingBanks.length} bank:`,
      {
        reply_markup: {
          inline_keyboard: bankKeyboard
        },
        parse_mode: 'HTML'
      }
    );

    // Update session with search results
    await updateSessionData(session, sessionManager, {
      data: { searchResults: matchingBanks }
    });
  }
}

/**
* Helper function for bank pagination
*/
function showBankPage(ctx, session, banks, page) {
  const BANKS_PER_PAGE = 15;
  const startIndex = page * BANKS_PER_PAGE;
  const endIndex = Math.min(startIndex + BANKS_PER_PAGE, banks.length);
  const banksOnPage = banks.slice(startIndex, endIndex);
  
  const bankKeyboard = banksOnPage.map((bank, index) => [
    { 
      text: `${bank.name || bank.instLocalName}`, 
      callback_data: `select_bank:${session.data.availableBanks.indexOf(bank)}`
    }
  ]);
  
  // Navigation buttons
  const navButtons = [];
  if (page > 0) {
    navButtons.push({ text: '⬅️ Sebelumnya', callback_data: `bank_page:${page - 1}` });
  }
  if (endIndex < banks.length) {
    navButtons.push({ text: 'Selanjutnya ➡️', callback_data: `bank_page:${page + 1}` });
  }
  
  if (navButtons.length > 0) {
    bankKeyboard.push(navButtons);
  }
  
  bankKeyboard.push([{ text: '🔍 Cari Bank', callback_data: 'search_bank' }]);
  bankKeyboard.push([{ text: '❌ Batal', callback_data: 'cancel_transfer' }]);

  const transferAmount = formatCurrency(session.data.amount);
  const totalPages = Math.ceil(banks.length / BANKS_PER_PAGE);

  ctx.editMessageText(
    `💰 <b>Jumlah transfer: ${transferAmount}</b>\n\n📋 <b>Semua Bank (A-Z)</b>\nHalaman ${page + 1} dari ${totalPages} • Bank ${startIndex + 1}-${endIndex} dari ${banks.length}`,
    {
      reply_markup: {
        inline_keyboard: bankKeyboard
      },
      parse_mode: 'HTML'
    }
  );
}

/**
* Set up all callback actions
*/
function setupCallbackActions(bot, sdk, sessionManager) {
  // Handle cancel button
  bot.action('cancel_remove', async (ctx) => {
    await ctx.answerCbQuery('Dibatalkan');
    await ctx.editMessageText('Tindakan dibatalkan. Gunakan /remove untuk memulai kembali.');
  });

  // Handle account selection for removal
  bot.action(/^remove:(.+)$/, async (ctx) => {
    const accountId = ctx.match[1];
    await ctx.answerCbQuery();
    
    const confirmKeyboard = [
      [
        { text: '✅ Ya, hapus akun ini', callback_data: `confirm:${accountId}` },
        { text: '❌ Batal', callback_data: 'cancel_remove' }
      ]
    ];
    
    await ctx.editMessageText(
      `⚠️ Apakah Anda yakin ingin menghapus akun ini? Tindakan ini tidak dapat dibatalkan.`,
      {
        reply_markup: {
          inline_keyboard: confirmKeyboard
        }
      }
    );
  });

  // Handle confirmation for removal
  bot.action(/^confirm:(.+)$/, async (ctx) => {
    const accountId = ctx.match[1];
    const chatId = ctx.callbackQuery?.message?.chat.id.toString();
    const messageId = ctx.callbackQuery?.message?.message_id;
    
    if (!chatId || !messageId) {
      await ctx.answerCbQuery('Error: Tidak dapat memproses permintaan');
      return;
    }
    
    // Acknowledge the action
    await ctx.answerCbQuery('Memproses...');

    // Update message to show processing
    await ctx.editMessageText(
      '⏳ Menghapus akun... Mohon tunggu.',
      { reply_markup: { inline_keyboard: [] } }
    );
    
    try {
      // Call function to remove account
      logger.info('telegram.remove', `Removing account ${accountId}`);
      const result = await removeAccountForUser(sdk, accountId);
      
      if (result.success) {
        await ctx.editMessageText(`✅ Berhasil menghapus akun.`);
      } else {
        await ctx.editMessageText(`❌ ${result.message || 'Gagal menghapus akun'}`);
      }
    } catch (error) {
      logger.error('telegram.remove', 'Error in confirm handler', { error });
      await ctx.editMessageText('❌ Error menghapus akun. Silakan coba lagi nanti.');
    }
  });

  // Handle transfer account selection
  bot.action(/^transfer_account:(.+)$/, async (ctx) => {
    const accountId = ctx.match[1];
    const chatId = ctx.callbackQuery?.message?.chat.id.toString();
    
    if (!chatId) {
      await ctx.answerCbQuery('Error: Tidak dapat memproses permintaan');
      return;
    }

    try {
      await ctx.answerCbQuery();
      
      // Create session for transfer
      const session = await createSessionData(chatId, 'dana_transfer', { 
        accountId 
      }, sessionManager);

      // Update session state
      await updateSessionData(session, sessionManager, {
        state: 'select_transfer_type'
      });

      // Show transfer type options
      const transferKeyboard = [
        [{ text: '🏦 Transfer ke Bank', callback_data: 'transfer_type:bank' }],
        [{ text: '📱 Bayar QRIS', callback_data: 'transfer_type:qris' }],
        [{ text: 'Batal', callback_data: 'cancel_transfer' }]
      ];

      await ctx.editMessageText(
        'Pilih jenis transfer:',
        {
          reply_markup: {
            inline_keyboard: transferKeyboard
          }
        }
      );
    } catch (error) {
      logger.error('telegram.transfer.account', 'Error selecting account', { error });
      await ctx.answerCbQuery('Gagal memproses pilihan');
    }
  });

  // Handle transfer type selection
  bot.action(/^transfer_type:(.+)$/, async (ctx) => {
    const transferType = ctx.match[1]; // 'bank' or 'qris'
    const chatId = ctx.callbackQuery?.message?.chat.id.toString();
    
    if (!chatId) {
      await ctx.answerCbQuery('Error: Tidak dapat memproses permintaan');
      return;
    }

    try {
      await ctx.answerCbQuery();
      
      // Get current session
      const session = await getSessionData(chatId, sessionManager);
      if (!session) {
        await ctx.editMessageText('Sesi tidak valid. Silakan mulai kembali dengan /transfer.');
        return;
      }

      if (transferType === 'bank') {
        // Bank transfer flow
        await ctx.editMessageText('Silakan masukkan jumlah yang ingin ditransfer (minimum Rp 10.000):');
        
        await updateSessionData(session, sessionManager, {
          state: 'awaiting_bank_amount',
          data: { transferType: 'bank' }
        });
      } else if (transferType === 'qris') {
        // QRIS transfer flow
        await ctx.editMessageText('Silakan masukkan jumlah untuk pembayaran QRIS (minimum Rp 1.000):');
        
        await updateSessionData(session, sessionManager, {
          state: 'awaiting_qris_amount',
          data: { transferType: 'qris' }
        });
      }
    } catch (error) {
      logger.error('telegram.transfer.type', 'Error selecting transfer type', { error });
      await ctx.answerCbQuery('Gagal memproses pilihan');
    }
  });

  // Handle search bank option
  bot.action('search_bank', async (ctx) => {
    const chatId = ctx.callbackQuery?.message?.chat.id.toString();
    
    if (!chatId) {
      await ctx.answerCbQuery('Error: Tidak dapat memproses permintaan');
      return;
    }

    try {
      await ctx.answerCbQuery();
      
      // Get current session
      const session = await getSessionData(chatId, sessionManager);
      if (!session) {
        await ctx.editMessageText('Sesi tidak valid. Silakan mulai kembali dengan /transfer.');
        return;
      }

      // Update session state to search mode
      await updateSessionData(session, sessionManager, {
        state: 'searching_bank'
      });

      const transferAmount = formatCurrency(session.data.amount);

      await ctx.editMessageText(
        `💰 <b>Jumlah transfer: ${transferAmount}</b>\n\n🔍 <b>Cari Bank</b>\n\nKetik nama bank yang ingin Anda cari:\n\nContoh:\n• BCA\n• Mandiri\n• BNI\n• BRI\n\nAtau ketik /cancel untuk membatalkan.`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      logger.error('telegram.search_bank', 'Error in search bank', { error });
      await ctx.answerCbQuery('Gagal memulai pencarian');
    }
  });

  // Handle popular banks
  bot.action('popular_banks', async (ctx) => {
    const chatId = ctx.callbackQuery?.message?.chat.id.toString();
    
    if (!chatId) {
      await ctx.answerCbQuery('Error: Tidak dapat memproses permintaan');
      return;
    }

    try {
      await ctx.answerCbQuery();
      
      const session = await getSessionData(chatId, sessionManager);
      if (!session || !session.data.availableBanks) {
        await ctx.editMessageText('Sesi tidak valid. Silakan mulai kembali dengan /transfer.');
        return;
      }

      // Define popular banks by instId
      const popularBankIds = [
        'BCAC1ID', 'MDRIC1ID', 'BNIC1ID', 'BRIC1ID', 'CITIC1ID',
        'MABKC1ID', 'PANIC1ID', 'BNLIC1ID', 'DBSC1ID', 'UOBC1ID'
      ];

      const allBanks = session.data.availableBanks;
      const popularBanks = popularBankIds
        .map(id => allBanks.find(bank => bank.instId === id))
        .filter(bank => bank !== undefined);

      const bankKeyboard = popularBanks.map((bank, index) => [
        { 
          text: `${bank.name || bank.instLocalName}`, 
          callback_data: `select_bank:${allBanks.indexOf(bank)}`
        }
      ]);
      
      bankKeyboard.push([{ text: '🔍 Cari Bank Lain', callback_data: 'search_bank' }]);
      bankKeyboard.push([{ text: '📋 Semua Bank', callback_data: 'all_banks_az' }]);
      bankKeyboard.push([{ text: '❌ Batal', callback_data: 'cancel_transfer' }]);

      const transferAmount = formatCurrency(session.data.amount);

      await ctx.editMessageText(
        `💰 <b>Jumlah transfer: ${transferAmount}</b>\n\n⭐ <b>Bank Populer:</b>`,
        {
          reply_markup: {
            inline_keyboard: bankKeyboard
          },
          parse_mode: 'HTML'
        }
      );
    } catch (error) {
      logger.error('telegram.popular_banks', 'Error showing popular banks', { error });
      await ctx.answerCbQuery('Gagal memuat bank populer');
    }
  });

  // Handle all banks A-Z
  bot.action('all_banks_az', async (ctx) => {
    const chatId = ctx.callbackQuery?.message?.chat.id.toString();
    
    if (!chatId) {
      await ctx.answerCbQuery('Error: Tidak dapat memproses permintaan');
      return;
    }

    try {
      await ctx.answerCbQuery();
      
      const session = await getSessionData(chatId, sessionManager);
      if (!session || !session.data.availableBanks) {
        await ctx.editMessageText('Sesi tidak valid. Silakan mulai kembali dengan /transfer.');
        return;
      }

      // Sort banks alphabetically and show first 15
      const allBanks = [...session.data.availableBanks].sort((a, b) => 
        (a.name || a.instLocalName).localeCompare(b.name || b.instLocalName)
      );

      await updateSessionData(session, sessionManager, {
        data: { 
          sortedBanks: allBanks,
          currentPage: 0
        }
      });

      showBankPage(ctx, session, allBanks, 0);
    } catch (error) {
      logger.error('telegram.all_banks', 'Error showing all banks', { error });
      await ctx.answerCbQuery('Gagal memuat semua bank');
    }
  });

  // Handle bank page navigation
  bot.action(/^bank_page:(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1]);
    const chatId = ctx.callbackQuery?.message?.chat.id.toString();
    
    if (!chatId) {
      await ctx.answerCbQuery('Error: Tidak dapat memproses permintaan');
      return;
    }

    try {
      await ctx.answerCbQuery();
      
      const session = await getSessionData(chatId, sessionManager);
      if (!session || !session.data.sortedBanks) {
        await ctx.editMessageText('Sesi tidak valid. Silakan mulai kembali dengan /transfer.');
        return;
      }

      await updateSessionData(session, sessionManager, {
        data: { currentPage: page }
      });

      showBankPage(ctx, session, session.data.sortedBanks, page);
    } catch (error) {
      logger.error('telegram.bank_page', 'Error navigating bank page', { error });
      await ctx.answerCbQuery('Gagal memuat halaman');
    }
  });

  // Handle bank selection
  bot.action(/^select_bank:(\d+)$/, async (ctx) => {
    const chatId = ctx.callbackQuery?.message?.chat.id.toString();
    
    if (!chatId) {
      await ctx.answerCbQuery('Error: Tidak dapat memproses permintaan');
      return;
    }

    try {
      const bankIndex = parseInt(ctx.match[1]);
      await ctx.answerCbQuery();
      
      // Get current session
      const session = await getSessionData(chatId, sessionManager);
      if (!session) {
        await ctx.editMessageText('Sesi tidak valid. Silakan mulai kembali dengan /transfer.');
        return;
      }

      // Get bank data from session
      const availableBanks = session.data.availableBanks;
      if (!availableBanks || !Array.isArray(availableBanks) || bankIndex >= availableBanks.length) {
        await ctx.editMessageText('Data bank tidak valid. Silakan mulai kembali dengan /transfer.');
        return;
      }

      const bankData = availableBanks[bankIndex];
      
      // Update session with bank data
      await updateSessionData(session, sessionManager, {
        state: 'awaiting_account_number',
        data: { bankData }
      });

      const bankName = bankData.name || bankData.instLocalName;
      const transferAmount = formatCurrency(session.data.amount);

      await ctx.editMessageText(
        `✅ <b>Bank dipilih: ${bankName}</b>\n💰 <b>Jumlah: ${transferAmount}</b>\n\n📝 Silakan masukkan nomor rekening tujuan (8-20 digit):`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      logger.error('telegram.transfer.bank', 'Error selecting bank', { error });
      await ctx.answerCbQuery('Gagal memproses pilihan bank');
      await ctx.editMessageText('❌ Gagal memproses pilihan bank. Silakan coba lagi.');
    }
  });

  // Handle cancel transfer
  bot.action('cancel_transfer', async (ctx) => {
    const chatId = ctx.callbackQuery?.message?.chat.id.toString();
    
    if (chatId) {
      const session = await getSessionData(chatId, sessionManager);
      if (session) {
        await deleteSessionData(session.id, sessionManager);
      }
    }
    
    await ctx.answerCbQuery('Transfer dibatalkan');
    await ctx.editMessageText('Transfer dibatalkan. Gunakan /transfer untuk memulai kembali.');
  });

  // Handle wallet selection
  bot.action(/wallet_(.+)/, async (ctx) => {
    // Check if ctx.chat exists, otherwise use ctx.callbackQuery.message.chat
    const chat = ctx.chat || (ctx.callbackQuery?.message?.chat);
    
    if (!chat) {
      logger.error('telegram.walletSelection', 'No chat context found');
      await ctx.answerCbQuery('Error: Tidak dapat menentukan konteks chat');
      return;
    }
    
    const chatId = chat.id.toString();
    const walletCode = ctx.match?.[1];
    
    if (!walletCode) {
      await ctx.answerCbQuery('Error: Tidak dapat menentukan pilihan wallet');
      return;
    }
    
    // If user cancels
    if (walletCode === 'cancel') {
      await ctx.answerCbQuery('Tindakan dibatalkan');
      return ctx.editMessageText('Tindakan dibatalkan. Ketik /add untuk memulai kembali.');
    }
    
    try {
      // Find wallet in supported wallets
      const wallet = SUPPORTED_WALLETS.find(w => w.code === walletCode);
      
      if (!wallet) {
        await ctx.answerCbQuery('E-wallet tidak tersedia');
        return ctx.editMessageText('E-wallet yang dipilih tidak tersedia. Silakan coba lagi.');
      }
      
      // Check for existing session
      const existingSession = await getSessionData(chatId, sessionManager);
      if (existingSession) {
        // Delete existing session before creating a new one
        await deleteSessionData(existingSession.id, sessionManager);
      }
      
      // Store the wallet selection in a session
      const session = await createSessionData(chatId, 'add_wallet', { 
        walletCode: wallet.code,
        providerId: wallet.id
      }, sessionManager);
      
      await ctx.answerCbQuery();
      await ctx.editMessageText(`Anda memilih ${wallet.name}.\n\nSilakan masukkan nomor telepon ${wallet.name} Anda dalam format: 081xxxxxxxxx\n\nBalas dengan nomor telepon Anda atau ketik /cancel untuk membatalkan.`);
      
      // Update session state
      await updateSessionData(session, sessionManager, {
        state: 'awaiting_phone'
      });
    } catch (error) {
      logger.error('telegram.walletSelection', 'Error processing wallet selection', { error });
      await ctx.answerCbQuery('Terjadi kesalahan');
      await ctx.editMessageText('Gagal memproses pilihan. Silakan coba lagi nanti.');
    }
  });

  // Handle verification method selection
  bot.action(/^verification_(.+)$/, async (ctx) => {
    logger.info('telegram.verification', `Verification method selected: ${ctx.match[1]}`);
    
    try {
      const method = ctx.match[1]; // 'SMS' or 'WHATSAPP'
      const chatId = ctx.callbackQuery?.message?.chat.id.toString();
      
      if (!chatId) {
        await ctx.answerCbQuery('Error: Tidak dapat menentukan konteks chat');
        return;
      }
      
      // Get the session
      let session = await getSessionData(chatId, sessionManager);
      if (!session) {
        await ctx.answerCbQuery('Sesi tidak valid atau telah kedaluwarsa');
        return await ctx.editMessageText('Sesi tidak valid. Silakan mulai kembali dengan /add.');
      }
      
      // Acknowledge the callback query
      await ctx.answerCbQuery(`Menggunakan ${method === 'SMS' ? 'SMS' : 'WhatsApp'} OTP`);
      
      // Update original message to show selected method
      await ctx.editMessageText(`Metode verifikasi dipilih: ${method === 'SMS' ? 'SMS' : 'WhatsApp'}`);
      
      // Update session with verification method
      session = await updateSessionData(session, sessionManager, {
        data: {
          verificationMethod: method
        }
      });
      
      // Show processing message in a new message
      const loadingMsg = await ctx.reply(`Meminta OTP via ${method === 'SMS' ? 'SMS' : 'WhatsApp'}... Mohon tunggu.`);
      
      try {
        // Process based on wallet type
        switch(session.data.walletCode) {
          case 'DANA':
            await handleDANAInitiation(ctx, session, session.data.pin, loadingMsg, sdk, sessionManager);
            break;
          default:
            throw new Error('Jenis wallet tidak didukung');
        }
      } catch (error) {
        logger.error('telegram.verification', `Error memulai proses ${session.data.walletCode}`, { error });
        await ctx.telegram.editMessageText(
          chatId, 
          loadingMsg.message_id, 
          undefined, 
          `❌ Error: ${error instanceof Error ? error.message : 'Gagal memproses permintaan Anda.'}\n\nSilakan coba lagi nanti.`
        );
        await deleteSessionData(session.id, sessionManager);
      }
    } catch (error) {
      logger.error('telegram.verification', 'Error in verification handler', { error });
      await ctx.answerCbQuery('Error internal. Silakan coba lagi.');
    }
  });
}

/**
* Set up text message handler
*/
function setupTextMessageHandler(bot, sessionManager, sdk) {
  bot.on('text', async (ctx) => {
    // Skip processing for commands
    if (!ctx.message?.text || ctx.message.text.startsWith('/')) return;
    
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;
    
    // Check if there's an active session
    const session = await getSessionData(chatId, sessionManager);
    
    if (!session) return;
    
    // Handle different session states
    switch(session.state) {
      case 'awaiting_password':
        await handlePasswordInput(ctx, session, sessionManager);
        break;
      case 'awaiting_phone':
        await handlePhoneInput(ctx, session, sessionManager);
        break;
      case 'awaiting_pin':
        await handlePinInput(ctx, session, sessionManager);
        break;
      case 'awaiting_otp':
        await handleOtpInput(ctx, session, sdk, sessionManager);
        break;
      case 'awaiting_name':
        await handleNameInput(ctx, session, sdk, sessionManager);
        break;
      case 'awaiting_bank_amount':
        await handleBankAmountInput(ctx, session, sdk, sessionManager);
        break;
      case 'awaiting_qris_amount':
        await handleQRISAmountInput(ctx, session, sessionManager);
        break;
      case 'awaiting_account_number':
        await handleAccountNumberInput(ctx, session, sdk, sessionManager);
        break;
      case 'awaiting_transfer_confirmation':
        await handleTransferConfirmation(ctx, session, sdk, sessionManager);
        break;
      case 'searching_bank':
        await handleBankSearch(ctx, session, sessionManager);
        break;
    }
  });

  // Handle photo messages for QRIS
  bot.on('photo', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const session = await getSessionData(chatId, sessionManager);
    if (!session || session.state !== 'awaiting_qris_photo') return;

    // Send a new status message instead of trying to edit
    const statusMsg = await ctx.reply('📱 Memproses QR code... Mohon tunggu.');

    try {
      // Get the largest photo for better quality
      const photos = ctx.message.photo;
      const largestPhoto = photos[photos.length - 1];
      
      await handleDANAQRISTransfer(ctx, session, largestPhoto.file_id, statusMsg, sdk, sessionManager);
    } catch (error) {
      logger.error('telegram.qris', 'Error processing QRIS photo', { error });
      
      // More specific error messages
      let errorMessage = `❌ Error: ${error instanceof Error ? error.message : 'Gagal memproses QR code.'}`;
      
      if (error.message.includes('decode')) {
        errorMessage += '\n\n💡 Tips:\n• Pastikan gambar QR code jelas\n• Coba foto ulang dengan pencahayaan yang baik\n• QR code harus terlihat utuh dalam foto';
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        errorMessage += '\n\n💡 Coba lagi dalam beberapa saat.';
      }
      
      await ctx.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        undefined,
        errorMessage
      );
      await deleteSessionData(session.id, sessionManager);
    }
  });
}

/**
* Handle phone input during session
*/
async function handlePhoneInput(ctx, session, sessionManager) {
  if (!ctx.message?.text) {
    return await ctx.reply('Input tidak valid. Silakan masukkan nomor telepon yang valid.');
  }
  
  const phoneNumber = ctx.message.text.trim();
  const chatId = ctx.chat?.id.toString();
  if (!chatId) {
    return await ctx.reply('Error: Tidak dapat menentukan konteks chat.');
  }
  
  // Validate phone number format
  if (!isValidPhoneNumber(phoneNumber)) {
    return await ctx.reply('Format nomor telepon tidak valid. Silakan masukkan nomor telepon Indonesia yang valid (misalnya, 081xxxxxxxxx).\n\nCoba lagi atau ketik /cancel untuk membatalkan.');
  }
  
  // Format phone number consistently
  const formattedPhone = formatPhoneNumber(phoneNumber);
  
  // Update session with phone number
  await updateSessionData(session, sessionManager, {
    state: 'awaiting_pin',
    data: {
      phoneNumber: formattedPhone
    }
  });
  
  // Find wallet name for better UX
  const wallet = SUPPORTED_WALLETS.find(w => w.code === session.data.walletCode) || 
              { name: session.data.walletCode };
  
  await ctx.reply(`Nomor telepon disimpan: ${formattedPhone}.\n\nSekarang, silakan masukkan PIN ${wallet.name} Anda.\n\n⚠️ PIN Anda akan diproses dengan aman dan tidak disimpan sebagai teks biasa.\n\nBalas dengan PIN Anda atau ketik /cancel untuk membatalkan.`);
}

/**
* Handle PIN input during session
*/
async function handlePinInput(ctx, session, sessionManager) {
  if (!ctx.message?.text) {
    return await ctx.reply('Input tidak valid. Silakan masukkan PIN yang valid.');
  }
  
  const pin = ctx.message.text.trim();
  const chatId = ctx.chat?.id.toString();
  if (!chatId) {
    return await ctx.reply('Error: Tidak dapat menentukan konteks chat.');
  }
  
  // Basic PIN validation
  if (!/^\d{6}$/.test(pin)) {
    return await ctx.reply('Format PIN tidak valid. Silakan masukkan PIN 6 digit.\n\nCoba lagi atau ketik /cancel untuk membatalkan.');
  }
  
  // Update session with PIN
  await updateSessionData(session, sessionManager, {
    data: {
      pin
    }
  });
  
  // Ask user to select verification method
  const verificationKeyboard = [
    [
      { text: 'SMS OTP', callback_data: 'verification_SMS' },
      { text: 'WhatsApp OTP', callback_data: 'verification_WHATSAPP' }
    ]
  ];
  
  await ctx.reply(
    'Silakan pilih metode verifikasi untuk menerima kode OTP:',
    {
      reply_markup: {
        inline_keyboard: verificationKeyboard
      }
    }
  );
}

/**
* Handle OTP input during session
*/
async function handleOtpInput(ctx, session, sdk, sessionManager) {
  if (!ctx.message?.text) {
    return await ctx.reply('Input tidak valid. Silakan masukkan OTP yang valid.');
  }
  
  const otp = ctx.message.text.trim();
  const chatId = ctx.chat?.id.toString();
  if (!chatId) {
    return await ctx.reply('Error: Tidak dapat menentukan konteks chat.');
  }
  
  // Basic OTP validation
  if (!/^\d{4,6}$/.test(otp)) {
    return await ctx.reply('Format OTP tidak valid. Silakan masukkan kode OTP yang Anda terima.\n\nCoba lagi atau ketik /cancel untuk membatalkan.');
  }
  
  const statusMsg = await ctx.reply('Memverifikasi OTP...');
  
  try {
    // Process OTP based on wallet type
    switch(session.data.walletCode) {
      case 'DANA':
        await verifyDANAOtp(ctx, session, otp, statusMsg, sdk, sessionManager);
        break;
      default:
        throw new Error('Jenis wallet tidak didukung');
    }
  } catch (error) {
    logger.error('telegram.otp', `Error memverifikasi OTP ${session.data.walletCode}`, { error });
    if (statusMsg) {
      await ctx.telegram.editMessageText(
        chatId, 
        statusMsg.message_id, 
        undefined, 
        `❌ Error: ${error instanceof Error ? error.message : 'Gagal memverifikasi OTP.'}\n\nSilakan coba lagi nanti.`
      );
    }
    await deleteSessionData(session.id, sessionManager);
  }
}

/**
* Handle account name input during session
*/
async function handleNameInput(ctx, session, sdk, sessionManager) {
  if (!ctx.message?.text) {
    return await ctx.reply('Input tidak valid. Silakan masukkan nama akun yang valid.');
  }
  
  const accountName = ctx.message.text.trim();
  const chatId = ctx.chat?.id.toString();
  if (!chatId) {
    return await ctx.reply('Error: Tidak dapat menentukan konteks chat.');
  }
  
  if (accountName.length < 3 || accountName.length > 50) {
    return await ctx.reply('Nama akun tidak valid. Silakan masukkan nama antara 3-50 karakter.\n\nCoba lagi atau ketik /cancel untuk membatalkan.');
  }
  
  // Update session with account name
  await updateSessionData(session, sessionManager, {
    data: {
      accountName
    }
  });
  
  const statusMsg = await ctx.reply('Menyiapkan akun Anda...');
  
  try {
    // Complete the process based on wallet type
    switch(session.data.walletCode) {
      case 'DANA':
        await completeDANASetup(ctx, session, accountName, statusMsg, sdk, sessionManager);
        break;
      default:
        throw new Error('Jenis wallet tidak didukung');
    }
  } catch (error) {
    logger.error('telegram.setup', `Error menyelesaikan pengaturan ${session.data.walletCode}`, { error });
    if (statusMsg) {
      await ctx.telegram.editMessageText(
        chatId, 
        statusMsg.message_id, 
        undefined, 
        `❌ Error: ${error instanceof Error ? error.message : 'Gagal menyelesaikan pengaturan akun.'}\n\nSilakan coba lagi nanti.`
      );
    }
    await deleteSessionData(session.id, sessionManager);
  }
}

/**
* Handle QRIS amount input
*/
async function handleQRISAmountInput(ctx, session, sessionManager) {
  if (!ctx.message?.text) {
    return await ctx.reply('Input tidak valid. Silakan masukkan jumlah yang valid.');
  }

  const amountText = ctx.message.text.trim().replace(/[.,]/g, '');
  const amount = parseInt(amountText);

  if (isNaN(amount) || amount < 1000) {
    return await ctx.reply('Jumlah tidak valid. Minimum pembayaran QRIS adalah Rp 1.000.\n\nSilakan masukkan jumlah yang valid:');
  }

  // Update session with amount
  await updateSessionData(session, sessionManager, {
    state: 'awaiting_qris_photo',
    data: { amount }
  });

  await ctx.reply(`Jumlah pembayaran: ${formatCurrency(amount)}\n\nSekarang kirimkan foto QR code yang ingin dibayar:`);
}

/**
 * Handle account number input
 */
async function handleAccountNumberInput(ctx, session, sdk, sessionManager) {
  if (!ctx.message?.text) {
    return await ctx.reply('Input tidak valid. Silakan masukkan nomor rekening yang valid.');
  }

  const accountNumber = ctx.message.text.trim();

  // Enhanced validation for account number
  if (!/^\d{8,20}$/.test(accountNumber)) {
    return await ctx.reply('❌ Format nomor rekening tidak valid.\n\n📝 Silakan masukkan nomor rekening yang benar:\n• Hanya angka (tanpa spasi atau tanda baca)\n• Panjang 8-20 digit\n\nContoh: 1234567890');
  }

  // Update session with account number and capture the updated session
  const updatedSession = await updateSessionData(session, sessionManager, {
    data: { accountNumber }
  });

  const bankName = updatedSession.data.bankData?.name || updatedSession.data.bankData?.instLocalName;
  const statusMsg = await ctx.reply(`🔍 Memverifikasi rekening ${bankName}...\nMohon tunggu sebentar.`);

  try {
    await handleDANABankTransferInit(ctx, updatedSession, statusMsg, sdk, sessionManager);
  } catch (error) {
    logger.error('telegram.transfer.account', 'Error verifying account', { error });
    
    let errorMessage = `❌ Error: ${error instanceof Error ? error.message : 'Gagal memverifikasi rekening.'}`;
    
    // Add helpful suggestions based on error type
    if (error.message.includes('Invalid account number')) {
      errorMessage += '\n\n💡 Tips:\n• Pastikan nomor rekening benar\n• Coba tanpa angka 0 di depan\n• Hubungi bank untuk memastikan nomor rekening';
    }
    
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      errorMessage
    );
    await deleteSessionData(updatedSession.id, sessionManager);
  }
}

/**
* Handle transfer confirmation
*/
async function handleTransferConfirmation(ctx, session, sdk, sessionManager) {
  if (!ctx.message?.text) {
    return await ctx.reply('Silakan ketik KONFIRMASI untuk melanjutkan atau BATAL untuk membatalkan.');
  }

  const confirmation = ctx.message.text.trim().toUpperCase();

  if (confirmation === 'KONFIRMASI') {
    const statusMsg = await ctx.reply('⏳ Memproses transfer... Mohon tunggu.\n\n⚠️ Jangan tutup aplikasi atau kirim pesan lain sampai proses selesai.');

    try {
      await completeDANABankTransfer(ctx, session, statusMsg, sdk, sessionManager);
    } catch (error) {
      logger.error('telegram.transfer.confirm', 'Error completing transfer', { error });
      
      let errorMessage = `❌ Transfer gagal: ${error instanceof Error ? error.message : 'Gagal menyelesaikan transfer.'}`;
      
      // Add specific help for common errors
      if (error.message.includes('Insufficient balance')) {
        errorMessage += '\n\n💡 Silakan cek saldo DANA Anda dan coba lagi dengan jumlah yang lebih kecil.';
      } else if (error.message.includes('Daily limit')) {
        errorMessage += '\n\n💡 Anda mungkin telah mencapai batas transfer harian. Coba lagi besok.';
      }
      
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        errorMessage
      );
      await deleteSessionData(session.id, sessionManager);
    }
  } else if (confirmation === 'BATAL') {
    await deleteSessionData(session.id, sessionManager);
    await ctx.reply('❌ Transfer dibatalkan.\n\n🔄 Gunakan /transfer untuk memulai transfer baru.');
  } else {
    await ctx.reply('❓ Perintah tidak dikenali.\n\nSilakan ketik:\n• <b>KONFIRMASI</b> - untuk melanjutkan transfer\n• <b>BATAL</b> - untuk membatalkan transfer', { parse_mode: 'HTML' });
  }
}

async function handlePasswordInput(ctx, session, sessionManager) {
  if (!ctx.message?.text) {
    return await ctx.reply('Input tidak valid. Silakan masukkan password.');
  }
  
  const password = ctx.message.text.trim();
  const chatId = ctx.chat?.id.toString();
  if (!chatId) return;

  logger.info('telegram.password', `Password input received for chat ${chatId}`);

  // Delete the user's message for security
  try {
    await ctx.deleteMessage();
  } catch (error) {
    // Ignore if can't delete message
  }

  // Check if user is blocked
  const blockStatus = await isUserBlocked(chatId, sessionManager);
  if (blockStatus.blocked) {
    await sessionManager.deleteSession(session.id);
    return await ctx.reply(`🚫 ${blockStatus.message}`);
  }

  const statusMsg = await ctx.reply('🔐 Memverifikasi password...');

  try {
    const result = await authenticateUser(chatId, password, sessionManager);
    
    if (result.success) {
      logger.info('telegram.password', `Authentication successful for chat ${chatId}`);
      
      await ctx.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        undefined,
        '✅ Login berhasil!\n\nSelamat datang! Gunakan /help untuk melihat perintah yang tersedia.'
      );
      
      // Delete login session
      await sessionManager.deleteSession(session.id);
      
      // Verify the authenticated session was created
      const authSession = await sessionManager.getSession(chatId, 'authenticated');
      if (authSession) {
        logger.info('telegram.password', `Authenticated session confirmed for chat ${chatId}`);
      } else {
        logger.error('telegram.password', `Failed to create authenticated session for chat ${chatId}`);
      }
    } else {
      logger.info('telegram.password', `Authentication failed for chat ${chatId}: ${result.message}`);
      
      const newBlockStatus = await isUserBlocked(chatId, sessionManager);
      let message = `❌ ${result.message}`;
      
      if (newBlockStatus.attemptsLeft && newBlockStatus.attemptsLeft > 0) {
        message += `\n\n⚠️ Sisa percobaan: ${newBlockStatus.attemptsLeft}`;
      } else if (newBlockStatus.blocked) {
        message += `\n\n🚫 Terlalu banyak percobaan gagal. Coba lagi dalam ${newBlockStatus.remainingMinutes} menit.`;
        await sessionManager.deleteSession(session.id);
      }
      
      await ctx.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        undefined,
        message
      );
    }
  } catch (error) {
    logger.error('telegram.auth', 'Error during authentication', { error });
    await ctx.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      '❌ Terjadi kesalahan saat login. Silakan coba lagi.'
    );
  }
}

/**
* Setup graceful shutdown handlers
*/
function setupGracefulShutdown(bot, db) {
 process.once('SIGINT', async () => {
   logger.info('system', 'Received SIGINT signal, shutting down gracefully');
   bot.stop('SIGINT');
   await db.close();
   process.exit(0);
 });
 
 process.once('SIGTERM', async () => {
   logger.info('system', 'Received SIGTERM signal, shutting down gracefully');
   bot.stop('SIGTERM');
   await db.close();
   process.exit(0);
 });
}