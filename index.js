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
  getMutasiForUser, 
  getAccountsForUser, 
  removeAccountForUser 
} from './lib/accountHandler.js';
import {
  isValidPhoneNumber,
  formatPhoneNumber
} from './lib/utils.js';
import { 
  updateSessionData, 
  getSessionData, 
  deleteSessionData, 
  createSessionData 
} from './lib/sessionUtils.js';

// Load environment variables
dotenv.config();

// Environment variables with defaults
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
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
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires)
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
    const sessionId = `${chatId}_${Date.now()}`;
    const now = Date.now();
    const expires = now + (15 * 60 * 1000); // 15 minutes
    
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
   */
  const getSession = async (chatId) => {
    const now = Date.now();
    
    const row = await db.get(
      'SELECT * FROM sessions WHERE chatId = ? AND expires > ? ORDER BY createdAt DESC LIMIT 1',
      chatId,
      now
    );
    
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
    
    await ctx.reply(`Selamat datang di Bot Mutasiku! 🤖\n\nBot ini akan mengirimkan notifikasi saat Anda menerima dana di akun yang terhubung.\n\nGunakan /mutasi untuk melihat transaksi terbaru Anda atau /accounts untuk melihat akun Anda.`);
  });

  // Help command
  bot.help((ctx) => {
    ctx.reply(`Bantuan Bot Mutasiku:\n
  /start - Mulai bot
  /add - Tambahkan akun e-wallet baru
  /remove - Hapus akun e-wallet yang ada
  /accounts - Lihat semua akun Anda
  
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
    • /mutasi search "gojek" - Cari teks tertentu
  
    Anda dapat menggabungkan filter: /mutasi days 30 type credit min 500000
  
  /help - Tampilkan pesan bantuan ini`);
  });

  // Mutasi command
  bot.command('mutasi', async (ctx) => handleMutasiCommand(ctx, sdk));
  
  // Accounts command
  bot.command('accounts', async (ctx) => handleAccountsCommand(ctx, sdk));
  
  // Remove command
  bot.command('remove', async (ctx) => handleRemoveCommand(ctx, sdk));
  
  // Add command
  bot.command('add', async (ctx) => handleAddCommand(ctx, sessionManager));
  
  // Cancel command
  bot.command('cancel', async (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;
    
    // Delete any active session
    const session = await getSessionData(chatId, sessionManager);
    if (session) {
      await deleteSessionData(session.id, sessionManager);
      await ctx.reply('Tindakan dibatalkan. Ketik /add untuk memulai kembali.');
    } else {
      await ctx.reply('Tidak ada tindakan yang sedang berlangsung.');
    }
  });
  
  // Callback actions
  setupCallbackActions(bot, sdk, sessionManager);
  
  // Text message handler
  setupTextMessageHandler(bot, sessionManager, sdk);
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
          text: `${account.name} (${account.provider.name || account.provider.code || 'Unknown'})`, 
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