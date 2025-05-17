// lib/utils.js
/**
 * Formats a number as currency in IDR
 * @param {number} amount - The amount to format
 * @returns {string} Formatted currency string
 */
export function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
}

/**
 * Validates a phone number
 * @param {string} phoneNumber - The phone number to validate
 * @returns {boolean} Whether the phone number is valid
 */
export function isValidPhoneNumber(phoneNumber) {
    return /^(08|628|\+628)[0-9]{8,11}$/.test(phoneNumber);
}

/**
 * Formats a phone number to a standard format
 * @param {string} phoneNumber - The phone number to format
 * @returns {string} Formatted phone number
 */
export function formatPhoneNumber(phoneNumber) {
    return phoneNumber.replace(/^\+?62|^0/, '');
}

/**
 * Safely parses JSON
 * @param {string} jsonString - The JSON string to parse
 * @param {any} defaultValue - Default value if parsing fails
 * @returns {any} Parsed object or default value
 */
export function safeJsonParse(jsonString, defaultValue = {}) {
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        return defaultValue;
    }
}