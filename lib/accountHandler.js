// lib/accountHandler.js
import { logger } from './logger.js';
import { formatCurrency } from './utils.js';

/**
 * Get transaction history for a user
 * @param {Object} sdk - The Mutasiku SDK instance
 * @param {string} userId - User ID
 * @param {Object} options - Filter options
 * @returns {Object} Transaction data and status
 */
export async function getMutasiForUser(sdk, userId, options = {}) {
  try {
    logger.info('accounts.getMutasi', 'Fetching transactions', { userId, options });
    
    // Prepare options for the SDK
    const sdkOptions = {
      limit: options.limit || 5,
      page: options.page || 1
    };
    
    // Add optional filters
    if (options.accountId) sdkOptions.accountId = options.accountId;
    if (options.type) sdkOptions.type = options.type;
    if (options.providerCode) sdkOptions.providerCode = options.providerCode;
    if (options.minAmount !== undefined) sdkOptions.minAmount = options.minAmount;
    if (options.maxAmount !== undefined) sdkOptions.maxAmount = options.maxAmount;
    if (options.search) sdkOptions.search = options.search;
    
    // Get mutations using the SDK
    const response = await sdk.getMutasi(sdkOptions);

    if (response.status !== 'success') {
      logger.warn('accounts.getMutasi', 'Failed to fetch transactions', {
        status: response.status,
        message: response.message
      });
      
      return {
        success: false,
        message: 'Gagal mengambil transaksi: ' + (response.message || 'Unknown error'),
        data: [],
        pagination: null
      };
    }
    
    // Get transactions and pagination info
    const transactions = response.data || [];
    const pagination = response.pagination || {
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 0
    };
    
    logger.info('accounts.getMutasi', 'Successfully fetched transactions', {
      count: transactions.length,
      pagination
    });
    
    // Format transaction info for Telegram display
    let message = formatTransactionResponse(transactions, pagination, options);
    
    return {
      success: true,
      message,
      data: transactions,
      pagination
    };
  } catch (error) {
    logger.error('accounts.getMutasi', 'Error fetching mutations', {
      userId,
      options,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return {
      success: false,
      message: 'Gagal mengambil transaksi. Silakan coba lagi nanti.',
      data: [],
      pagination: null
    };
  }
}

/**
 * Format transaction data for display
 * @param {Array} transactions - Transaction data
 * @param {Object} pagination - Pagination info
 * @param {Object} options - Filter options
 * @returns {string} Formatted message
 */
function formatTransactionResponse(transactions, pagination, options) {
  let message = `<b>📊 Transaksi (${pagination.total ? pagination.total : transactions.length})</b>\n`;
  
  // Add filter info
  const filterInfo = [];
  if (options.days) filterInfo.push(`${options.days} hari`);
  if (options.type) filterInfo.push(`tipe: ${options.type}`);
  if (options.providerCode) filterInfo.push(`penyedia: ${options.providerCode}`);
  if (options.accountId) filterInfo.push(`akun tertentu`);
  if (options.minAmount !== undefined) filterInfo.push(`min: ${formatCurrency(options.minAmount)}`);
  if (options.maxAmount !== undefined) filterInfo.push(`max: ${formatCurrency(options.maxAmount)}`);
  if (options.search) filterInfo.push(`pencarian: "${options.search}"`);
  
  if (filterInfo.length > 0) {
    message += `<i>Difilter berdasarkan: ${filterInfo.join(', ')}</i>\n`;
  }
  
  message += `<i>Halaman ${pagination.page} dari ${pagination.totalPages || 1}</i>\n\n`;
  
  if (transactions.length === 0) {
    message += 'Tidak ada transaksi yang ditemukan untuk kriteria ini.';
  } else {
    transactions.forEach((tx, index) => {
      const date = new Date(tx.createdAt).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
      const time = new Date(tx.createdAt).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
      });
      
      // Format amount with + or - prefix based on transaction type
      const formattedAmount = tx.type === 'CREDIT' 
        ? `+${formatCurrency(tx.amount)}` 
        : `-${formatCurrency(tx.amount)}`;
      
      // Add emoji based on transaction type
      const emoji = tx.type === 'CREDIT' ? '💰' : '💸';
      
      // Account information with provider code
      const accountInfo = tx.account 
        ? `${tx.account.accountName} (${tx.account.provider.code})` 
        : 'Akun Tidak Diketahui';
      
      message += `${emoji} <b>${formattedAmount}</b>\n`;
      message += `📝 ${tx.description || 'Tidak ada deskripsi'}\n`;
      message += `🏦 ${accountInfo}\n`;
      message += `🕒 ${date} ${time}\n`;
      
      // Add separator between transactions (except the last one)
      if (index < transactions.length - 1) {
        message += `\n${'─'.repeat(20)}\n\n`;
      }
    });
  }
  
  // Add pagination buttons info if multiple pages
  if (pagination.totalPages > 1) {
    message += `\n\n<i>Halaman ${pagination.page} dari ${pagination.totalPages}</i>`;
    
    if (pagination.page < pagination.totalPages) {
      message += `\nGunakan: /mutasi page ${pagination.page + 1}`;
    }
  }
  
  // Add footer with instructions for filtering
  message += `\n\n<b>Contoh filter:</b>`;
  message += `\n/mutasi limit 10`;
  message += `\n/mutasi days 30`;
  message += `\n/mutasi type credit`;
  message += `\n/mutasi provider bca`;
  message += `\n/mutasi min 1000000`;
  message += `\n/mutasi search "transfer"`;
  
  return message;
}

/**
 * Get accounts for a user
 * @param {Object} sdk - The Mutasiku SDK instance
 * @param {string} userId - User ID
 * @returns {Object} Account data and status
 */
export async function getAccountsForUser(sdk, userId) {
  try {
    logger.info('accounts.getAccounts', 'Fetching accounts', { userId });
    
    // Get all accounts for this user
    const response = await sdk.getAccounts();

    // Check if response is in the expected format
    if (response.status !== 'success' || !response.data) {
      logger.warn('accounts.getAccounts', 'Failed to fetch accounts', {
        status: response.status,
        message: response.message
      });
      
      return {
        success: false,
        message: 'Gagal mengambil akun: ' + (response.message || 'Unknown error'),
        data: []
      };
    }
    
    const accounts = response.data || [];
    
    logger.info('accounts.getAccounts', 'Successfully fetched accounts', {
      count: accounts.length
    });
    
    // Format accounts for Telegram display
    let message = formatAccountResponse(accounts);
    
    return {
      success: true,
      message,
      data: accounts
    };
  } catch (error) {
    logger.error('accounts.getAccounts', 'Error fetching accounts', {
      userId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return {
      success: false,
      message: 'Gagal mengambil akun. Silakan coba lagi nanti.',
      data: []
    };
  }
}

/**
 * Format account data for display
 * @param {Array} accounts - Account data
 * @returns {string} Formatted message
 */
function formatAccountResponse(accounts) {
  let message = '<b>🏦 Akun Anda</b>\n\n';
  
  // Group accounts by type
  const bankAccounts = accounts.filter(acc => acc.type === 'bank');
  const walletAccounts = accounts.filter(acc => acc.type === 'ewallet');
  
  if (bankAccounts.length > 0) {
    message += '<b>Akun Bank:</b>\n';
    bankAccounts.forEach((acc, index) => {
      message += `${index + 1}. <b>${acc.name}</b> - ${acc.provider.name || acc.provider.code || 'Unknown'}\n`;
      message += `   Rekening: ${acc.accountNumber || '-'}\n`;
      message += `   Saldo: ${formatCurrency(acc.balance || 0)}\n`;
      message += `   ID: <code>${acc.id}</code>\n\n`;
    });
  }
  
  if (walletAccounts.length > 0) {
    message += '<b>Akun E-Wallet:</b>\n';
    walletAccounts.forEach((acc, index) => {
      const providerName = acc.provider.name || acc.provider.code || 'Unknown';
      message += `${index + 1}. <b>${acc.name}</b> - ${providerName}\n`;
      message += `   Telepon: ${acc.phoneNumber || '-'}\n`;
      message += `   Saldo: ${formatCurrency(acc.balance || 0)}\n`;
      message += `   ID: <code>${acc.id}</code>\n\n`;
    });
  }
  
  if (accounts.length > 0) {
    message += 'Gunakan ID akun dengan perintah /mutasi untuk melihat transaksi akun tertentu:\n';
    message += '<code>/mutasi account [ID]</code>';
  } else {
    message = 'Anda belum memiliki akun. Gunakan /add untuk menambahkan akun pertama Anda.';
  }
  
  return message;
}

/**
 * Remove an account for a user
 * @param {Object} sdk - The Mutasiku SDK instance
 * @param {string} accountId - Account ID to remove
 * @returns {Object} Status and message
 */
export async function removeAccountForUser(sdk, accountId) {
  try {
    logger.info('accounts.removeAccount', 'Removing account', { accountId });
    
    // Remove account using the SDK
    const response = await sdk.removeAccount(accountId);
    
    if (response.status !== 'success') {
      logger.warn('accounts.removeAccount', 'Failed to remove account', {
        status: response.status,
        message: response.message
      });
      
      return {
        success: false,
        message: 'Gagal menghapus akun: ' + (response.message || 'Unknown error')
      };
    }
    
    logger.info('accounts.removeAccount', 'Successfully removed account', { accountId });
    
    return {
      success: true,
      message: 'Akun berhasil dihapus'
    };
  } catch (error) {
    logger.error('accounts.removeAccount', 'Error removing account', {
      accountId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    return {
      success: false,
      message: 'Gagal menghapus akun. Silakan coba lagi nanti.'
    };
  }
}