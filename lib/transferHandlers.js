// lib/transferHandlers.js
import { logger } from './logger.js';
import { formatCurrency } from './utils.js';
import { updateSessionData, deleteSessionData } from './sessionUtils.js';

/**
 * Handle DANA bank transfer initiation
 * @param {Object} ctx - Telegram context
 * @param {Object} session - Session object
 * @param {Object} statusMsg - Status message object
 * @param {Object} sdk - SDK instance
 * @param {Object} sessionManager - Session manager functions
 */
export async function handleDANABankTransferInit(ctx, session, statusMsg, sdk, sessionManager) {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) {
      throw new Error("Tidak dapat menentukan ID chat");
    }
  
    const { accountId, accountNumber, amount, bankData } = session.data;
    console.log(session.data);
    
    logger.info('transfer.dana.bank.init', 'Initiating DANA bank transfer', {
      accountId,
      amount,
      bankId: bankData.instId
    });
  
    try {
      // Update message to show processing
      await ctx.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        undefined,
        '🔄 Memverifikasi detail transfer... Mohon tunggu.'
      );
  
      // Initialize bank transfer with the correct bank data structure
      const response = await sdk.transferDanaBankInit(accountId, {
        accountNumber,
        amount,
        instId: bankData.instId,
        instLocalName: bankData.instLocalName,
        payMethod: bankData.payMethod,
        payOption: bankData.payOption
      });
  
      if (!response.success) {
        logger.error('transfer.dana.bank.init', 'Failed to initialize transfer', {
          message: response.message || response.error,
          bankData: bankData
        });
        
        // Handle specific error messages
        let errorMessage = response.message || response.error || 'Gagal memverifikasi transfer';
        
        if (errorMessage.includes('Insufficient balance')) {
          errorMessage = `Saldo tidak mencukupi. Saldo Anda: ${formatCurrency(response.balance || 0)}`;
        } else if (errorMessage.includes('Invalid account number')) {
          errorMessage = 'Nomor rekening tidak valid. Silakan periksa kembali nomor rekening tujuan.';
        } else if (errorMessage.includes('Minimum transfer')) {
          errorMessage = 'Jumlah transfer di bawah minimum yang diizinkan.';
        }
        
        throw new Error(errorMessage);
      }
  
      // Update session with verification data
      await updateSessionData(session, sessionManager, {
        state: 'awaiting_transfer_confirmation',
        data: {
          verificationData: response.data,
          bankAccountIndexNo: response.data?.bankAccountIndexNo
        }
      });
  
      // Show verification details and ask for confirmation
      const accountName = response.data?.accountName || 'Tidak diketahui';
      const bankName = bankData.name || bankData.instLocalName;
      
      const confirmationMessage = `
  ✅ <b>Verifikasi Transfer Berhasil</b>
  
  <b>📋 Detail Transfer:</b>
  💰 Jumlah: <b>${formatCurrency(amount)}</b>
  🏦 Bank: <b>${bankName}</b>
  📄 Rekening: <b>${accountNumber}</b>
  👤 Nama Penerima: <b>${accountName}</b>
  
  ⚠️ <b>Pastikan detail di atas sudah benar!</b>
  
  Ketik <b>KONFIRMASI</b> untuk melanjutkan transfer atau <b>BATAL</b> untuk membatalkan.
      `;
  
      await ctx.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        undefined,
        confirmationMessage,
        { parse_mode: 'HTML' }
      );
  
      logger.info('transfer.dana.bank.init', 'Transfer verification successful', {
        accountName,
        bankName
      });
    } catch (error) {
      logger.error('transfer.dana.bank.init', 'Error initializing transfer', {
        error: error instanceof Error ? error.message : 'Unknown error',
        bankData: bankData
      });
      throw error;
    }
}

/**
 * Complete DANA bank transfer
 * @param {Object} ctx - Telegram context
 * @param {Object} session - Session object
 * @param {Object} statusMsg - Status message object
 * @param {Object} sdk - SDK instance
 * @param {Object} sessionManager - Session manager functions
 */
export async function completeDANABankTransfer(ctx, session, statusMsg, sdk, sessionManager) {
  const chatId = ctx.chat?.id.toString();
  if (!chatId) {
    throw new Error("Tidak dapat menentukan ID chat");
  }

  const { accountId, amount, bankAccountIndexNo } = session.data;
  
  logger.info('transfer.dana.bank.complete', 'Completing DANA bank transfer', {
    accountId,
    amount
  });

  try {
    // Update message to show processing
    await ctx.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      'Memproses transfer... Mohon tunggu.'
    );

    // Complete the transfer
    const response = await sdk.transferDanaBankCreate(accountId, {
      amount,
      bankAccountIndexNo
    });

    if (!response.success) {
      logger.error('transfer.dana.bank.complete', 'Failed to complete transfer', {
        message: response.message || response.error
      });
      throw new Error(response.message || response.error || 'Gagal menyelesaikan transfer');
    }

    // Success message
    const successMessage = `
✅ <b>Transfer Berhasil!</b>

💰 Jumlah: <b>${formatCurrency(amount)}</b>
🏦 Tujuan: <b>${session.data.accountNumber}</b>
📅 Waktu: <b>${new Date().toLocaleString('id-ID')}</b>

Transfer telah berhasil diproses!
    `;

    await ctx.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      successMessage,
      { parse_mode: 'HTML' }
    );

    // Delete session
    await deleteSessionData(session.id, sessionManager);

    logger.info('transfer.dana.bank.complete', 'Transfer completed successfully');
  } catch (error) {
    logger.error('transfer.dana.bank.complete', 'Error completing transfer', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Handle DANA QRIS transfer
 * @param {Object} ctx - Telegram context
 * @param {Object} session - Session object
 * @param {string} photoFileId - Telegram photo file ID
 * @param {Object} statusMsg - Status message object
 * @param {Object} sdk - SDK instance
 * @param {Object} sessionManager - Session manager functions
 */
// lib/transferHandlers.js
export async function handleDANAQRISTransfer(ctx, session, photoFileId, statusMsg, sdk, sessionManager) {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) {
      throw new Error("Tidak dapat menentukan ID chat");
    }
  
    const { accountId, amount } = session.data;
    
    logger.info('transfer.dana.qris', 'Processing DANA QRIS transfer', {
      accountId,
      amount
    });
  
    try {
      // Update message to show processing - only if different from current message
      try {
        await ctx.telegram.editMessageText(
          chatId,
          statusMsg.message_id,
          undefined,
          '📱 Memproses pembayaran QRIS... Mohon tunggu.'
        );
      } catch (editError) {
        // If edit fails (message is the same), just continue
        logger.debug('transfer.dana.qris', 'Message edit skipped (same content)');
      }
  
      // Download the photo
      const file = await ctx.telegram.getFile(photoFileId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      
      // Update progress
      try {
        await ctx.telegram.editMessageText(
          chatId,
          statusMsg.message_id,
          undefined,
          '📥 Mengunduh gambar QR code...'
        );
      } catch (editError) {
        // Continue if edit fails
      }
      
      // Fetch the image
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error('Gagal mengunduh gambar QR code');
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Update progress
      try {
        await ctx.telegram.editMessageText(
          chatId,
          statusMsg.message_id,
          undefined,
          '🔍 Memindai QR code...'
        );
      } catch (editError) {
        // Continue if edit fails
      }
      
      // Create a File object from buffer
      const blob = new Blob([buffer], { type: 'image/jpeg' });
      const imageFile = new File([blob], 'qr-code.jpg', { type: 'image/jpeg' });
  
      // Update progress
      try {
        await ctx.telegram.editMessageText(
          chatId,
          statusMsg.message_id,
          undefined,
          '💳 Memproses pembayaran...'
        );
      } catch (editError) {
        // Continue if edit fails
      }
  
      // Process QRIS transfer
      const transferResponse = await sdk.transferDanaQris(accountId, imageFile, amount);
  
      if (!transferResponse.success) {
        logger.error('transfer.dana.qris', 'Failed to process QRIS transfer', {
          message: transferResponse.message || transferResponse.error
        });
        throw new Error(transferResponse.message || transferResponse.error || 'Gagal memproses QR code');
      }
  
      // Success message
      const successMessage = `
  ✅ <b>QRIS Transfer Berhasil!</b>
  
  💰 Jumlah: <b>${formatCurrency(amount)}</b>
  📅 Waktu: <b>${new Date().toLocaleString('id-ID')}</b>
  
  Transfer QRIS telah berhasil diproses!
      `;
  
      await ctx.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        undefined,
        successMessage,
        { parse_mode: 'HTML' }
      );
  
      // Delete session
      await deleteSessionData(session.id, sessionManager);
  
      logger.info('transfer.dana.qris', 'QRIS transfer completed successfully');
    } catch (error) {
      logger.error('transfer.dana.qris', 'Error processing QRIS transfer', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
}