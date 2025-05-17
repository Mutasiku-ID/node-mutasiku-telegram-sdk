// lib/sessionUtils.js
import { logger } from './logger.js';

/**
 * Updates a session with new data, using provided updater if available
 * @param {Object} session - The session object to update
 * @param {Object} sessionUpdater - Session updater functions object
 * @param {Object} updates - Updates to apply (state and/or data)
 * @returns {Object} Updated session
 */
export async function updateSessionData(session, sessionUpdater, updates) {
  if (sessionUpdater && typeof sessionUpdater.updateSession === 'function') {
    return await sessionUpdater.updateSession(session.id, updates);
  } else {
    // Direct update if no updater functions available
    if (updates.state) session.state = updates.state;
    if (updates.data) {
      session.data = { ...session.data, ...updates.data };
    }
    logger.warn('session.update', 'Using direct session update without updater function');
    return session;
  }
}

/**
 * Gets a session using provided getter if available
 * @param {string} chatId - The chat ID to get session for
 * @param {Object} sessionManager - Session manager functions
 * @returns {Object|null} Session object or null if not found
 */
export async function getSessionData(chatId, sessionManager) {
  if (sessionManager && typeof sessionManager.getSession === 'function') {
    return await sessionManager.getSession(chatId);
  }
  return null;
}

/**
 * Deletes a session using provided deleter if available
 * @param {string} sessionId - The session ID to delete
 * @param {Object} sessionManager - Session manager functions
 * @returns {boolean} True if deleted successfully
 */
export async function deleteSessionData(sessionId, sessionManager) {
  if (sessionManager && typeof sessionManager.deleteSession === 'function') {
    return await sessionManager.deleteSession(sessionId);
  }
  logger.warn('session.delete', 'No session deleter function available');
  return false;
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
  if (sessionManager && typeof sessionManager.createSession === 'function') {
    return await sessionManager.createSession(chatId, type, data);
  }
  logger.warn('session.create', 'No session creator function available');
  return null;
}

/**
 * Extends a session expiration time
 * @param {string} sessionId - The session ID to extend
 * @param {Object} sessionManager - Session manager functions
 * @param {number} minutes - Number of minutes to extend by
 * @returns {boolean} True if extended successfully
 */
export async function extendSessionData(sessionId, sessionManager, minutes = 15) {
  if (sessionManager && typeof sessionManager.extendSession === 'function') {
    return await sessionManager.extendSession(sessionId, minutes);
  }
  logger.warn('session.extend', 'No session extender function available');
  return false;
}