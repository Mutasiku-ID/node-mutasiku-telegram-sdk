// lib/walletHandlers.js
import { logger } from './logger.js';
import { updateSessionData } from './sessionUtils.js';

/**
 * Handle DANA initiation process
 * @param {Object} ctx - Telegram context
 * @param {Object} session - Session object
 * @param {string} pin - User PIN
 * @param {Object} statusMsg - Status message object
 * @param {Object} sdk - SDK instance
 * @param {Object} sessionUpdater - Session updater functions
 */
export async function handleDANAInitiation(ctx, session, pin, statusMsg, sdk, sessionUpdater) {
  const chatId = ctx.callbackQuery?.message?.chat.id.toString() || ctx.chat?.id.toString();
  if (!chatId) {
    throw new Error("Tidak dapat menentukan ID chat");
  }
  
  const phoneNumber = session.data.phoneNumber;
  const verificationMethod = session.data.verificationMethod || 'SMS'; // Use the selected method or default to SMS
  
  logger.info('wallet.dana.init', 'Initiating DANA setup', {
    phoneNumber: `****${phoneNumber?.slice(-4) || 'unknown'}`,
    verificationMethod
  });
  
  try {
    // Update message to show we're processing
    await ctx.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      `Meminta OTP untuk DANA melalui ${verificationMethod === 'SMS' ? 'SMS' : 'WhatsApp'}... Mohon tunggu.`
    );
    
    // Use the SDK to add the account
    const response = await sdk.addAccount({
      action: 'dana-send-otp',
      phoneNumber,
      pin,
      providerCode: 'DANA',
      accountName: "Akun DANA", // Temporary name, will update later
      intervalMinutes: 1, // Default interval
      verificationMethod
    });

    logger.debug('wallet.dana.init', 'OTP request details', {
      phoneNumber: `****${phoneNumber?.slice(-4) || 'unknown'}`,
      verificationMethod
    });
    
    if (!response.success) {
      logger.error('wallet.dana.init', 'Failed to send OTP', {
        message: response.message
      });
      throw new Error('Gagal mengirim OTP: ' + (response.message || 'Error tidak diketahui'));
    }
    
    // Update session with session ID from response - now using the utility function
    await updateSessionData(session, sessionUpdater, {
      state: 'awaiting_otp',
      data: {
        sessionId: response.sessionId
      }
    });
    
    // Prompt for OTP
    await ctx.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      `OTP telah dikirim ke ${verificationMethod === 'SMS' ? 'nomor telepon' : 'WhatsApp'} Anda yang berakhiran ${phoneNumber.slice(-4)}.\n\nSilakan masukkan kode OTP yang Anda terima atau ketik /cancel untuk membatalkan.`
    );
    
    logger.info('wallet.dana.init', 'OTP requested successfully');
  } catch (error) {
    logger.error('wallet.dana.init', 'Error initiating DANA process', {
      error: error instanceof Error ? error.message : 'Unknown error',
      phoneNumber: `****${phoneNumber?.slice(-4) || 'unknown'}`,
      verificationMethod
    });
    throw error;
  }
}

/**
 * Verify DANA OTP
 * @param {Object} ctx - Telegram context
 * @param {Object} session - Session object
 * @param {string} otp - OTP code
 * @param {Object} statusMsg - Status message object
 * @param {Object} sdk - SDK instance
 * @param {Object} sessionUpdater - Session updater functions
 */
export async function verifyDANAOtp(ctx, session, otp, statusMsg, sdk, sessionUpdater) {
  const chatId = ctx.chat?.id.toString();
  if (!chatId) {
    throw new Error("Tidak dapat menentukan ID chat");
  }
  
  logger.info('wallet.dana.otp', 'Verifying DANA OTP');
  
  try {
    // Update message to show we're processing
    await ctx.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      `Memverifikasi OTP... Mohon tunggu.`
    );
    
    // Update session with OTP - now using the utility function
    await updateSessionData(session, sessionUpdater, {
      state: 'awaiting_name',
      data: {
        otp
      }
    });
    
    await ctx.reply(`Silakan masukkan nama untuk akun DANA ini (contoh: "DANA Saya"):`);
    
    logger.info('wallet.dana.otp', 'OTP verification successful, awaiting account name');
  } catch (error) {
    logger.error('wallet.dana.otp', 'Error verifying DANA OTP', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Complete DANA setup
 * @param {Object} ctx - Telegram context
 * @param {Object} session - Session object
 * @param {string} accountName - Account name
 * @param {Object} statusMsg - Status message object
 * @param {Object} sdk - SDK instance
 * @param {Object} sessionUpdater - Session updater functions
 */
export async function completeDANASetup(ctx, session, accountName, statusMsg, sdk, sessionUpdater) {
  const chatId = ctx.chat?.id.toString();
  if (!chatId) {
    throw new Error("Tidak dapat menentukan ID chat");
  }
  
  const phoneNumber = session.data.phoneNumber;
  logger.info('wallet.dana.complete', 'Completing DANA setup', {
    accountName,
    phoneNumber: `****${phoneNumber?.slice(-4) || 'unknown'}`
  });
  
  try {
    // Update message to show we're processing
    await ctx.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      `Menyiapkan akun DANA Anda... Mohon tunggu.`
    );
    
    // Use the SDK to verify the account
    const response = await sdk.verifyAccount({
      action: 'dana-verify-otp',
      sessionId: session.data.sessionId,
      otp: session.data.otp,
      accountName,
      verificationMethod: session.data.verificationMethod // Pass verification method
    });
    
    if (!response.success) {
      logger.error('wallet.dana.complete', 'Failed to complete setup', {
        message: response.message
      });
      throw new Error('Gagal menyiapkan akun: ' + (response.message || 'Error tidak diketahui'));
    }
    
    // Success message
    await ctx.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      `✅ Akun DANA Anda telah berhasil ditambahkan!\n\nNama akun: ${accountName}\nTelepon: ****${session.data.phoneNumber.slice(-4)}`
    );
    
    // Delete session - using the sessionUpdater directly as it's already passed in
    if (sessionUpdater && typeof sessionUpdater.deleteSession === 'function') {
      await sessionUpdater.deleteSession(session.id);
    }
    
    logger.info('wallet.dana.complete', 'DANA setup completed successfully');
  } catch (error) {
    logger.error('wallet.dana.complete', 'Error completing DANA setup', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}