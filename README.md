# Mutasiku Telegram Bot SDK

A Telegram bot that integrates with the Mutasiku API to help users monitor transactions and manage e-wallet accounts (DANA, OVO, GoPay Merchant) directly through Telegram.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node Version](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)

## 📌 Features

- **Account Management**: Add, remove, and view e-wallet accounts
- **Transaction Monitoring**: Get real-time notifications when you receive funds
- **Transaction History**: View your transaction history with various filtering options
- **Multiple Wallet Support**: Supports DANA, OVO, and GoPay Merchant

## 📋 Prerequisites

- Node.js (v14.0.0 or higher)
- Telegram Bot Token (from [BotFather](https://telegram.me/BotFather))
- Mutasiku API Key

## 🛠️ Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Mutasiku-ID/node-mutasiku-telegram-sdk.git
   cd node-mutasiku-telegram-sdk
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables by creating a `.env` file:
   ```
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   MUTASIKU_API_KEY=your_mutasiku_api_key
   DB_PATH=./data/bot.sqlite
   ```

4. Start the bot:
   ```bash
   npm start
   ```

## 🤖 Bot Commands

The bot supports the following commands:

- `/start` - Start the bot and get a welcome message
- `/help` - Display help information
- `/add` - Add a new e-wallet account
- `/remove` - Remove an existing e-wallet account
- `/accounts` - View all your connected accounts
- `/mutasi` - View your recent transactions

### Transaction Filtering with `/mutasi`

The `/mutasi` command supports various filtering options:

#### Basic Filters
- `/mutasi limit 10` - Show 10 transactions
- `/mutasi days 30` - Show transactions from the last 30 days
- `/mutasi page 2` - Switch to the next page of results

#### Advanced Filters
- `/mutasi type credit` - Show only incoming funds
- `/mutasi type debit` - Show only outgoing funds
- `/mutasi provider dana` - Filter by provider code
- `/mutasi account [ID]` - Show transactions for a specific account
- `/mutasi min 1000000` - Filter by minimum amount
- `/mutasi max 5000000` - Filter by maximum amount
- `/mutasi search "gojek"` - Search for specific text

You can combine multiple filters:
```
/mutasi days 30 type credit min 500000
```

## 🔄 Workflow

### Adding an E-wallet Account

1. Start the process with `/add`
2. Select an e-wallet type (DANA, OVO, or GoPay Merchant)
3. Enter your phone number
4. Enter your e-wallet PIN
5. Choose verification method (SMS or WhatsApp)
6. Enter the OTP you receive
7. Provide a name for the account

### Viewing Transaction History

Use the `/mutasi` command with optional filters to view your transaction history.

### Managing Accounts

- View all your accounts with `/accounts`
- Remove an account with `/remove` and follow the prompts

## 📁 Project Structure

- `index.js` - Main application entry point
- `lib/walletHandlers.js` - Handlers for wallet operations
- `lib/accountHandler.js` - Account management functions
- `lib/utils.js` - Utility functions
- `lib/sessionUtils.js` - Session management utilities
- `lib/logger.js` - Logging functionality

## 🔐 Security

- User PINs are processed securely and not stored as plaintext
- Sessions expire after 15 minutes of inactivity
- All requests to the Mutasiku API are made via secure channels

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Mutasiku API](https://mutasiku.co.id) for providing the underlying financial data API
- [Telegraf](https://github.com/telegraf/telegraf) for the Telegram Bot framework

## 📞 Support

If you encounter any issues or have questions, please open an issue on GitHub or contact the maintainer at support@mutasiku.co.id.
