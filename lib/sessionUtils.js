// lib/sessionUtils.js
import { logger } from './logger.js';

/**
 * Updates a session with new data, using provided updater if available
 * @param {Object} session - The session object to update
 * @param {Object} sessionManager - Session manager functions object
 * @param {Object} updates - Updates to apply (state and/or data)
 * @returns {Object} Updated session
 */
export async function updateSessionData(session, sessionManager, updates) {
  if (sessionManager && typeof sessionManager.updateSession === 'function') {
    try {
      return await sessionManager.updateSession(session.id, updates);
    } catch (error) {
      logger.error('session.update', 'Error updating session via manager', { 
        sessionId: session.id, 
        error: error.message 
      });
      throw error;
    }
  } else {
    // Direct update if no updater functions available
    if (updates.state !== undefined) session.state = updates.state;
    if (updates.data) {
      session.data = { ...session.data, ...updates.data };
    }
    if (updates.expires) {
      session.expires = new Date(updates.expires);
    }
    
    logger.warn('session.update', 'Using direct session update without updater function', {
      sessionId: session.id
    });
    return session;
  }
}

/**
 * Gets an active session (excluding authentication sessions by default)
 * @param {string} chatId - The chat ID to get session for
 * @param {Object} sessionManager - Session manager functions
 * @param {string[]} excludeTypes - Session types to exclude
 * @returns {Object|null} Session object or null if not found
 */
export async function getSessionData(chatId, sessionManager, excludeTypes = ['authenticated']) {
  if (!sessionManager) {
    logger.warn('session.get', 'No session manager provided');
    return null;
  }

  try {
    // Use the new getActiveSession method if available
    if (typeof sessionManager.getActiveSession === 'function') {
      return await sessionManager.getActiveSession(chatId, excludeTypes);
    }
    
    // Fallback to checking if there are active process sessions
    if (typeof sessionManager.hasActiveProcessSession === 'function') {
      const hasActiveProcess = await sessionManager.hasActiveProcessSession(chatId);
      if (!hasActiveProcess) {
        return null;
      }
      
      // Get the session using the regular method but verify it's not an auth session
      const session = await sessionManager.getSession(chatId);
      if (session && !excludeTypes.includes(session.type)) {
        return session;
      }
      return null;
    }
    
    // Last resort: use direct database access if available
    if (sessionManager.db) {
      const now = Date.now();
      let query = 'SELECT * FROM sessions WHERE chatId = ? AND expires > ?';
      let params = [chatId, now];
      
      if (excludeTypes.length > 0) {
        const placeholders = excludeTypes.map(() => '?').join(',');
        query += ` AND type NOT IN (${placeholders})`;
        params.push(...excludeTypes);
      }
      
      query += ' ORDER BY createdAt DESC LIMIT 1';
      
      const row = await sessionManager.db.get(query, ...params);
      
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
    }
    
    // Absolute fallback
    logger.warn('session.get', 'Using basic getSession method without filtering');
    return await sessionManager.getSession(chatId);
    
  } catch (error) {
    logger.error('session.get', 'Error getting session data', { 
      chatId, 
      error: error.message 
    });
    return null;
  }
}

/**
 * Gets a specific session by type
 * @param {string} chatId - The chat ID to get session for
 * @param {Object} sessionManager - Session manager functions
 * @param {string} type - Specific session type to get
 * @returns {Object|null} Session object or null if not found
 */
export async function getSessionByType(chatId, sessionManager, type) {
  if (!sessionManager) {
    logger.warn('session.getByType', 'No session manager provided');
    return null;
  }

  try {
    if (typeof sessionManager.getSession === 'function') {
      return await sessionManager.getSession(chatId, type);
    }
    
    logger.warn('session.getByType', 'getSession method not available');
    return null;
  } catch (error) {
    logger.error('session.getByType', 'Error getting session by type', { 
      chatId, 
      type, 
      error: error.message 
    });
    return null;
  }
}

/**
 * Gets all sessions for a chat ID
 * @param {string} chatId - The chat ID to get sessions for
 * @param {Object} sessionManager - Session manager functions
 * @param {string} type - Optional: filter by session type
 * @returns {Array} Array of session objects
 */
export async function getAllSessionsData(chatId, sessionManager, type = null) {
  if (!sessionManager) {
    logger.warn('session.getAll', 'No session manager provided');
    return [];
  }

  try {
    if (typeof sessionManager.getAllSessions === 'function') {
      return await sessionManager.getAllSessions(chatId, type);
    }
    
    // Fallback to getting single session
    const session = await sessionManager.getSession(chatId, type);
    return session ? [session] : [];
  } catch (error) {
    logger.error('session.getAll', 'Error getting all sessions', { 
      chatId, 
      type, 
      error: error.message 
    });
    return [];
  }
}

/**
 * Deletes a session using provided deleter if available
 * @param {string} sessionId - The session ID to delete
 * @param {Object} sessionManager - Session manager functions
 * @returns {boolean} True if deleted successfully
 */
export async function deleteSessionData(sessionId, sessionManager) {
  if (!sessionManager) {
    logger.warn('session.delete', 'No session manager provided');
    return false;
  }

  try {
    if (typeof sessionManager.deleteSession === 'function') {
      const result = await sessionManager.deleteSession(sessionId);
      logger.info('session.delete', 'Session deleted', { sessionId, success: result });
      return result;
    }
    
    logger.warn('session.delete', 'No session deleter function available');
    return false;
  } catch (error) {
    logger.error('session.delete', 'Error deleting session', { 
      sessionId, 
      error: error.message 
    });
    return false;
  }
}

/**
 * Deletes sessions by type
 * @param {string} chatId - Chat ID to delete sessions for
 * @param {string} type - Session type to delete
 * @param {Object} sessionManager - Session manager functions
 * @returns {boolean} True if deleted successfully
 */
export async function deleteSessionsByType(chatId, type, sessionManager) {
  if (!sessionManager) {
    logger.warn('session.deleteByType', 'No session manager provided');
    return false;
  }

  try {
    if (typeof sessionManager.deleteSessionsByType === 'function') {
      const result = await sessionManager.deleteSessionsByType(chatId, type);
      logger.info('session.deleteByType', 'Sessions deleted by type', { 
        chatId, 
        type, 
        success: result 
      });
      return result;
    }
    
    logger.warn('session.deleteByType', 'deleteSessionsByType method not available');
    return false;
  } catch (error) {
    logger.error('session.deleteByType', 'Error deleting sessions by type', { 
      chatId, 
      type, 
      error: error.message 
    });
    return false;
  }
}

/**
 * Deletes all process sessions but keeps authentication sessions
 * @param {string} chatId - Chat ID to clean sessions for
 * @param {Object} sessionManager - Session manager functions
 * @param {string[]} keepTypes - Session types to keep (default: ['authenticated'])
 * @returns {boolean} True if deleted successfully
 */
export async function cleanupProcessSessions(chatId, sessionManager, keepTypes = ['authenticated']) {
  if (!sessionManager) {
    logger.warn('session.cleanup', 'No session manager provided');
    return false;
  }

  try {
    if (typeof sessionManager.deleteSessionsExceptTypes === 'function') {
      const result = await sessionManager.deleteSessionsExceptTypes(chatId, keepTypes);
      logger.info('session.cleanup', 'Process sessions cleaned up', { 
        chatId, 
        keepTypes, 
        success: result 
      });
      return result;
    }
    
    // Fallback: try to delete known process session types
    const processTypes = ['add_wallet', 'dana_transfer', 'login'];
    let deletedAny = false;
    
    for (const type of processTypes) {
      if (typeof sessionManager.deleteSessionsByType === 'function') {
        const result = await sessionManager.deleteSessionsByType(chatId, type);
        if (result) deletedAny = true;
      }
    }
    
    return deletedAny;
  } catch (error) {
    logger.error('session.cleanup', 'Error cleaning up process sessions', { 
      chatId, 
      error: error.message 
    });
    return false;
  }
}

/**
 * Creates a new session using provided creator if available
 * @param {string} chatId - Chat ID to create session for
 * @param {string} type - Session type
 * @param {Object} data - Initial session data
 * @param {Object} sessionManager - Session manager functions
 * @returns {Object|null} Created session or null
 */
export async function createSessionData(chatId, type, data, sessionManager) {
  if (!sessionManager) {
    logger.warn('session.create', 'No session manager provided');
    return null;
  }

  try {
    if (typeof sessionManager.createSession === 'function') {
      const session = await sessionManager.createSession(chatId, type, data);
      logger.info('session.create', 'Session created', { 
        sessionId: session.id, 
        chatId, 
        type 
      });
      return session;
    }
    
    logger.warn('session.create', 'No session creator function available');
    return null;
  } catch (error) {
    logger.error('session.create', 'Error creating session', { 
      chatId, 
      type, 
      error: error.message 
    });
    return null;
  }
}

/**
 * Extends a session expiration time
 * @param {string} sessionId - The session ID to extend
 * @param {Object} sessionManager - Session manager functions
 * @param {number} minutes - Number of minutes to extend by
 * @returns {boolean} True if extended successfully
 */
export async function extendSessionData(sessionId, sessionManager, minutes = 15) {
  if (!sessionManager) {
    logger.warn('session.extend', 'No session manager provided');
    return false;
  }

  try {
    if (typeof sessionManager.extendSession === 'function') {
      const result = await sessionManager.extendSession(sessionId, minutes);
      logger.info('session.extend', 'Session extended', { 
        sessionId, 
        minutes, 
        success: result 
      });
      return result;
    }
    
    logger.warn('session.extend', 'No session extender function available');
    return false;
  } catch (error) {
    logger.error('session.extend', 'Error extending session', { 
      sessionId, 
      minutes, 
      error: error.message 
    });
    return false;
  }
}

/**
 * Checks if there are any active process sessions for a chat
 * @param {string} chatId - Chat ID to check
 * @param {Object} sessionManager - Session manager functions
 * @returns {boolean} True if there are active process sessions
 */
export async function hasActiveProcessSession(chatId, sessionManager) {
  if (!sessionManager) {
    logger.warn('session.hasActive', 'No session manager provided');
    return false;
  }

  try {
    if (typeof sessionManager.hasActiveProcessSession === 'function') {
      return await sessionManager.hasActiveProcessSession(chatId);
    }
    
    // Fallback: check if there's any non-auth session
    const session = await getSessionData(chatId, sessionManager, ['authenticated', 'auth_attempts']);
    return session !== null;
  } catch (error) {
    logger.error('session.hasActive', 'Error checking active sessions', { 
      chatId, 
      error: error.message 
    });
    return false;
  }
}

/**
 * Gets session statistics for debugging
 * @param {Object} sessionManager - Session manager functions
 * @param {string} chatId - Optional: specific chat ID
 * @returns {Array} Session statistics
 */
export async function getSessionStats(sessionManager, chatId = null) {
  if (!sessionManager) {
    logger.warn('session.stats', 'No session manager provided');
    return [];
  }

  try {
    if (typeof sessionManager.getSessionStats === 'function') {
      return await sessionManager.getSessionStats(chatId);
    }
    
    logger.warn('session.stats', 'getSessionStats method not available');
    return [];
  } catch (error) {
    logger.error('session.stats', 'Error getting session statistics', { 
      chatId, 
      error: error.message 
    });
    return [];
  }
}

/**
 * Validates session data integrity
 * @param {Object} session - Session to validate
 * @returns {boolean} True if session is valid
 */
export function validateSessionData(session) {
  if (!session) {
    return false;
  }

  const requiredFields = ['id', 'chatId', 'type', 'data', 'expires'];
  const hasAllFields = requiredFields.every(field => session.hasOwnProperty(field));
  
  if (!hasAllFields) {
    logger.warn('session.validate', 'Session missing required fields', { 
      sessionId: session.id,
      missingFields: requiredFields.filter(field => !session.hasOwnProperty(field))
    });
    return false;
  }

  // Check if session is expired
  const now = new Date();
  const expires = new Date(session.expires);
  
  if (expires <= now) {
    logger.info('session.validate', 'Session is expired', { 
      sessionId: session.id,
      expires: expires.toISOString(),
      now: now.toISOString()
    });
    return false;
  }

  return true;
}

/**
 * Safely parses session data JSON
 * @param {string} dataString - JSON string to parse
 * @param {Object} defaultValue - Default value if parsing fails
 * @returns {Object} Parsed data or default value
 */
export function safeParseSessionData(dataString, defaultValue = {}) {
  try {
    if (typeof dataString === 'string') {
      return JSON.parse(dataString);
    }
    return dataString || defaultValue;
  } catch (error) {
    logger.error('session.parse', 'Error parsing session data', { 
      error: error.message,
      dataString: dataString?.substring(0, 100) // Log first 100 chars for debugging
    });
    return defaultValue;
  }
}

/**
 * Creates a session data backup for recovery
 * @param {Object} session - Session to backup
 * @returns {string} JSON string backup
 */
export function createSessionBackup(session) {
  try {
    return JSON.stringify({
      ...session,
      backup_timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('session.backup', 'Error creating session backup', { 
      sessionId: session?.id,
      error: error.message 
    });
    return null;
  }
}

/**
 * Restores session from backup
 * @param {string} backupString - Backup JSON string
 * @returns {Object|null} Restored session or null
 */
export function restoreSessionFromBackup(backupString) {
  try {
    const restored = JSON.parse(backupString);
    delete restored.backup_timestamp; // Remove backup metadata
    return restored;
  } catch (error) {
    logger.error('session.restore', 'Error restoring session from backup', { 
      error: error.message 
    });
    return null;
  }
}