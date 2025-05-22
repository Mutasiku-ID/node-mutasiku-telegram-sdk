# Mutasiku Telegram Bot SDK

A Telegram bot that integrates with the Mutasiku API to help users monitor transactions, manage e-wallet accounts (DANA, OVO, GoPay Merchant), and perform transfers directly through Telegram.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node Version](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)
![Telegram Bot](https://img.shields.io/badge/Telegram-Bot-blue.svg)

## 📌 Features

- **Account Management**: Add, remove, and view e-wallet accounts
- **Transaction Monitoring**: Get real-time notifications when you receive funds
- **Transaction History**: View your transaction history with various filtering options
- **💸 Transfer Functionality**: Send money to banks and pay QRIS directly from Telegram
- **🏦 Bank Transfer**: Transfer from DANA to 136+ Indonesian banks with smart bank search
- **📱 QRIS Payment**: Pay QRIS codes by simply sending a photo
- **Multiple Wallet Support**: Supports DANA, OVO, and GoPay Merchant
- **🔍 Smart Search**: Find banks quickly with intelligent search functionality
- **⭐ Popular Banks**: Quick access to most commonly used banks

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
   ```env
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   TELEGRAM_BOT_NAME=Your Bot Name
   MUTASIKU_API_KEY=your_mutasiku_api_key
   DB_PATH=./data/bot.sqlite
   ```

4. Start the bot:
   ```bash
   npm start
   ```

## 🤖 Bot Commands

The bot supports the following commands:

### Core Commands
- `/start` - Start the bot and get a welcome message
- `/help` - Display comprehensive help information
- `/cancel` - Cancel any ongoing process

### Account Management
- `/add` - Add a new e-wallet account (DANA, OVO, GoPay Merchant)
- `/remove` - Remove an existing e-wallet account
- `/accounts` - View all your connected accounts with balances

### Transactions & Transfers
- `/mutasi` - View your recent transactions with advanced filtering
- `/transfer` - **NEW!** Transfer money from your DANA account

## 💸 Transfer Features

### 🏦 Bank Transfer
Transfer money from your DANA account to any Indonesian bank:

1. Use `/transfer` command
2. Select your DANA account
3. Choose "Transfer ke Bank"
4. Enter transfer amount (minimum Rp 10,000)
5. Choose bank using one of three methods:
   - **🔍 Search Bank**: Type bank name (e.g., "BCA", "Mandiri")
   - **⭐ Popular Banks**: Quick access to top 10 banks
   - **📋 All Banks**: Browse all 136+ supported banks
6. Enter destination account number
7. Confirm account details
8. Complete transfer

### 📱 QRIS Payment
Pay any QRIS code by sending a photo:

1. Use `/transfer` command
2. Select your DANA account
3. Choose "Bayar QRIS"
4. Enter payment amount (minimum Rp 1,000)
5. Send a clear photo of the QR code
6. Payment will be processed automatically

### 🏦 Supported Banks (136+)
Popular banks include:
- **Major Banks**: BCA, Mandiri, BNI, BRI, CIMB Niaga
- **Digital Banks**: JAGO, Seabank, Amar Bank
- **Syariah Banks**: BCA Syariah, Mandiri Syariah, BNI Syariah
- **Regional Banks**: BJB, BPD Jateng, BPD Jatim
- **International**: Citibank, HSBC, Standard Chartered, UOB
- **And many more...**

## 📊 Transaction Filtering with `/mutasi`

The `/mutasi` command supports various filtering options:

### Basic Filters
- `/mutasi limit 10` - Show 10 transactions
- `/mutasi days 30` - Show transactions from the last 30 days
- `/mutasi page 2` - Switch to the next page of results

### Advanced Filters
- `/mutasi type credit` - Show only incoming funds
- `/mutasi type debit` - Show only outgoing funds
- `/mutasi provider dana` - Filter by provider code
- `/mutasi account [ID]` - Show transactions for a specific account
- `/mutasi min 1000000` - Filter by minimum amount (Rp 1,000,000)
- `/mutasi max 5000000` - Filter by maximum amount (Rp 5,000,000)
- `/mutasi search "transfer"` - Search for specific text in descriptions

### Combined Filters
You can combine multiple filters for precise results:
```
/mutasi days 30 type credit min 500000 provider dana
```

## 🔄 Complete Workflows

### Adding a DANA Account

1. Start with `/add`
2. Select **DANA** from the wallet options
3. Enter your DANA phone number (e.g., `081234567890`)
4. Enter your 6-digit DANA PIN
5. Choose verification method: **SMS** or **WhatsApp**
6. Enter the OTP code you receive
7. Provide a custom name for your account (e.g., "DANA Utama")
8. ✅ Account successfully added!

### Making a Bank Transfer

1. Use `/transfer` command
2. Select your DANA account from the list
3. Choose **🏦 Transfer ke Bank**
4. Enter amount (min. Rp 10,000): `50000`
5. **Search for bank**:
   - Type **🔍 Cari Bank** → Type `BCA`
   - Or choose **⭐ Bank Populer** → Select BCA
6. Enter destination account: `1234567890`
7. Verify recipient name and details
8. Type `KONFIRMASI` to complete transfer
9. ✅ Transfer successful!

### Paying with QRIS

1. Use `/transfer` command
2. Select your DANA account
3. Choose **📱 Bayar QRIS**
4. Enter amount: `25000`
5. Take a clear photo of the QR code and send it
6. ✅ Payment processed automatically!

## 🏗️ Technical Architecture

### Project Structure
```
├── index.js                   # Main application entry point
├── lib/
│   ├── walletHandlers.js      # DANA/OVO wallet operations
│   ├── transferHandlers.js    # Bank transfer & QRIS functionality
│   ├── accountHandler.js      # Account management functions
│   ├── sessionUtils.js        # Session management utilities
│   ├── utils.js               # Utility functions (currency, validation)
│   └── logger.js              # Logging functionality
├── database/
│   └── sessions.db            # SQLite database for sessions
└── .env                       # Environment configuration
```

### Session Management
- **SQLite Database**: Secure session storage with automatic cleanup
- **15-minute Expiry**: Sessions automatically expire for security
- **State Management**: Multi-step processes handled seamlessly
- **Concurrent Support**: Multiple users can use the bot simultaneously

### Security Features
- **🔐 PIN Security**: User PINs are processed securely and never stored as plaintext
- **🕐 Session Expiry**: All sessions expire after 15 minutes of inactivity
- **🔒 Secure API**: All requests to Mutasiku API use secure HTTPS channels
- **✅ Input Validation**: Comprehensive validation for all user inputs
- **🛡️ Error Handling**: Robust error handling prevents data leaks

## 🎯 User Experience Features

### Smart Bank Selection
- **Instant Search**: Type bank name for immediate results
- **Auto-selection**: Single search results are selected automatically
- **Popular Banks**: Quick access to most used banks (BCA, Mandiri, BNI, etc.)
- **Pagination**: Navigate through 136+ banks efficiently

### Progress Indicators
- **Real-time Updates**: See progress during transfers and payments
- **Clear Status**: Know exactly what's happening at each step
- **Error Recovery**: Helpful error messages with actionable solutions

### Input Validation
- **Phone Numbers**: Automatic validation for Indonesian mobile numbers
- **Account Numbers**: Format validation for bank account numbers (8-20 digits)
- **Amounts**: Range validation with helpful minimum/maximum guidance
- **PINs**: Secure 6-digit PIN validation

## 🚀 Performance & Scalability

- **Efficient Database**: SQLite for fast session management
- **Async Processing**: Non-blocking operations for better user experience
- **Memory Management**: Automatic session cleanup and garbage collection
- **Rate Limiting**: Built-in protection against spam and abuse

## 🔧 Development & Debugging

### Running in Development
```bash
# Install dependencies
npm install

# Run with auto-restart
npm run dev

# Run tests
npm test
```

### Environment Variables
```env
# Required
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
MUTASIKU_API_KEY=your_mutasiku_api_key

# Optional
TELEGRAM_BOT_NAME=YourBotName
DB_PATH=./data/bot.sqlite
LOG_LEVEL=info
```

### Logging
The bot includes comprehensive logging for monitoring and debugging:
- **Info Level**: User actions and successful operations
- **Error Level**: Failures and exceptions with stack traces
- **Debug Level**: Detailed information for troubleshooting

## 📊 API Integration

This bot integrates with the [Mutasiku SDK](https://www.npmjs.com/package/mutasiku-sdk) which provides:

- **Account Management**: Add/remove e-wallet accounts
- **Transaction History**: Retrieve filtered transaction data
- **Bank Transfers**: DANA to bank transfers with 136+ supported banks
- **QRIS Payments**: Process QR code payments
- **Real-time Balance**: Live balance updates

## 🔄 Future Roadmap

- [ ] **Multi-language Support**: Indonesian and English
- [ ] **Scheduled Transfers**: Set up recurring payments
- [ ] **Transfer History**: Detailed transfer tracking
- [ ] **Budget Alerts**: Set spending limits and notifications
- [ ] **Group Features**: Shared expense tracking
- [ ] **Webhook Notifications**: Real-time transaction alerts

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Setup
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Mutasiku API](https://mutasiku.co.id) for providing the comprehensive financial data API
- [Telegraf](https://github.com/telegraf/telegraf) for the excellent Telegram Bot framework
- [SQLite](https://www.sqlite.org/) for reliable local database functionality

## 📞 Support & Community

- **📧 Email**: support@mutasiku.co.id
- **💬 Issues**: [GitHub Issues](https://github.com/Mutasiku-ID/node-mutasiku-telegram-sdk/issues)
- **📖 Documentation**: [API Docs](https://docs.mutasiku.co.id)
- **🌐 Website**: [mutasiku.co.id](https://mutasiku.co.id)

## 📈 Statistics

- **🏦 Supported Banks**: 136+ Indonesian banks
- **💱 E-wallets**: 3 major providers (DANA, OVO, GoPay)
- **🚀 Response Time**: Sub-second API responses
- **🔒 Uptime**: 99.9% API availability
- **👥 Active Users**: Growing daily

---

Made with ❤️ by the [Mutasiku Team](https://mutasiku.co.id)