import { logger } from './logger.js';

/**
 * Check if user is authenticated
 */
export async function isUserAuthenticated(chatId, sessionManager) {
  try {
    // Look specifically for authenticated sessions
    const session = await sessionManager.getSession(chatId, 'authenticated');
    
    if (!session) {
      logger.info('auth.check', `No authenticated session found for chat ${chatId}`);
      return false;
    }
    
    const isAuth = session.data && session.data.authenticated === true;
    logger.info('auth.check', `Authentication check for chat ${chatId}: ${isAuth}`);
    
    return isAuth;
  } catch (error) {
    logger.error('auth.check', 'Error checking authentication', { error, chatId });
    return false;
  }
}

/**
 * Authenticate user with password
 */
export async function authenticateUser(chatId, password, sessionManager) {
  const correctPassword = process.env.BOT_PASSWORD;
  
  if (!correctPassword) {
    logger.error('auth', 'BOT_PASSWORD not set in environment variables');
    return { success: false, message: 'Konfigurasi autentikasi tidak valid' };
  }
  
  logger.info('auth.attempt', `Authentication attempt for chat ${chatId}`);
  
  if (password !== correctPassword) {
    logger.info('auth.attempt', `Password mismatch for chat ${chatId}`);
    // Track failed attempts
    await trackFailedAttempt(chatId, sessionManager);
    return { success: false, message: 'Password salah' };
  }
  
  logger.info('auth.attempt', `Password correct for chat ${chatId}`);
  
  // Clear any failed attempts and create authenticated session
  await clearFailedAttempts(chatId, sessionManager);
  await createAuthenticatedSession(chatId, sessionManager);
  
  logger.info('auth.success', `User authenticated successfully for chat ${chatId}`);
  return { success: true, message: 'Autentikasi berhasil' };
}

/**
 * Track failed login attempts
 */
async function trackFailedAttempt(chatId, sessionManager) {
  const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 3;
  const timeoutMinutes = parseInt(process.env.LOGIN_TIMEOUT_MINUTES) || 30;
  
  // Check if there's an existing auth_attempts session
  let session = await sessionManager.getSession(chatId, 'auth_attempts');
  
  if (!session) {
    // Create new auth_attempts session
    session = await sessionManager.createSession(chatId, 'auth_attempts', {
      attempts: 1,
      lastAttempt: Date.now()
    });
  } else {
    const attempts = (session.data.attempts || 0) + 1;
    await sessionManager.updateSession(session.id, {
      data: {
        attempts,
        lastAttempt: Date.now(),
        blockedUntil: attempts >= maxAttempts ? Date.now() + (timeoutMinutes * 60 * 1000) : undefined
      }
    });
  }
}

/**
 * Clear failed attempts
 */
async function clearFailedAttempts(chatId, sessionManager) {
  await sessionManager.deleteSessionsByType(chatId, 'auth_attempts');
}

/**
 * Check if user is blocked due to too many failed attempts
 */
export async function isUserBlocked(chatId, sessionManager) {
  const session = await sessionManager.getSession(chatId, 'auth_attempts');
  
  if (!session) {
    return { blocked: false };
  }
  
  const { attempts = 0, blockedUntil } = session.data;
  const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 3;
  
  if (attempts >= maxAttempts && blockedUntil) {
    if (Date.now() < blockedUntil) {
      const remainingTime = Math.ceil((blockedUntil - Date.now()) / (60 * 1000));
      return { 
        blocked: true, 
        remainingMinutes: remainingTime,
        message: `Terlalu banyak percobaan login gagal. Coba lagi dalam ${remainingTime} menit.`
      };
    } else {
      // Block period expired, clear the session
      await sessionManager.deleteSessionsByType(chatId, 'auth_attempts');
      return { blocked: false };
    }
  }
  
  return { 
    blocked: false, 
    attemptsLeft: maxAttempts - attempts 
  };
}

/**
 * Create authenticated session
 */
async function createAuthenticatedSession(chatId, sessionManager) {
  try {
    // Delete any existing authenticated sessions
    await sessionManager.deleteSessionsByType(chatId, 'authenticated');
    
    // Create new authenticated session
    const session = await sessionManager.createSession(chatId, 'authenticated', {
      authenticated: true,
      loginTime: Date.now()
    });
    
    // Extend session to 24 hours
    if (session) {
      await sessionManager.extendSession(session.id, 24 * 60); // 24 hours
      logger.info('auth.session', `Created authenticated session ${session.id} for chat ${chatId}`);
    }
    
    return session;
  } catch (error) {
    logger.error('auth.session', 'Error creating authenticated session', { error, chatId });
    throw error;
  }
}

/**
 * Logout user
 */
export async function logoutUser(chatId, sessionManager) {
  try {
    const session = await sessionManager.getSession(chatId, 'authenticated');
    if (session && session.data.authenticated) {
      await sessionManager.deleteSession(session.id);
      logger.info('auth.logout', `User logged out for chat ${chatId}`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error('auth.logout', 'Error during logout', { error, chatId });
    return false;
  }
}