# Mutasiku Telegram Bot SDK

A secure Telegram bot that integrates with the Mutasiku API to help users monitor transactions, manage e-wallet accounts (DANA, OVO, GoPay Merchant), and perform transfers directly through Telegram.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node Version](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)
![Telegram Bot](https://img.shields.io/badge/Telegram-Bot-blue.svg)
![Security](https://img.shields.io/badge/Security-Password%20Protected-red.svg)

## 📌 Features

- **🔐 Password Protection**: Secure access with configurable password authentication
- **Account Management**: Add, remove, and view e-wallet accounts
- **Transaction Monitoring**: Get real-time notifications when you receive funds
- **Transaction History**: View your transaction history with various filtering options
- **💸 Transfer Functionality**: Send money to banks and pay QRIS directly from Telegram
- **🏦 Bank Transfer**: Transfer from DANA to 136+ Indonesian banks with smart bank search
- **📱 QRIS Payment**: Pay QRIS codes by simply sending a photo
- **Multiple Wallet Support**: Supports DANA, OVO, and GoPay Merchant
- **🔍 Smart Search**: Find banks quickly with intelligent search functionality
- **⭐ Popular Banks**: Quick access to most commonly used banks
- **🛡️ Session Management**: Secure session handling with automatic expiry

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
   # Required
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   TELEGRAM_BOT_NAME=Your Bot Name
   MUTASIKU_API_KEY=your_mutasiku_api_key
   DB_PATH=./database/sessions.db
   
   # Authentication (Required)
   BOT_PASSWORD=your_secure_password_here
   MAX_LOGIN_ATTEMPTS=3
   LOGIN_TIMEOUT_MINUTES=30
   ```

4. Start the bot:
   ```bash
   npm start
   ```

## 🔐 Authentication & Security

### Password Protection
The bot requires password authentication before any features can be accessed:

1. **First Contact**: When users start the bot, they must authenticate
2. **Login Process**: Use `/login` command to enter the secure password
3. **Session Management**: Authenticated sessions last 24 hours
4. **Failed Attempts**: Users are temporarily blocked after 3 failed attempts
5. **Logout**: Users can logout anytime with `/logout`

### Security Features
- **🔑 Secure Password**: Configurable password protection for bot access
- **⏰ Session Expiry**: Authenticated sessions automatically expire after 24 hours
- **🚫 Attempt Limiting**: Temporary blocks after multiple failed login attempts
- **🔒 PIN Security**: User PINs are processed securely and never stored as plaintext
- **✅ Input Validation**: Comprehensive validation for all user inputs
- **🛡️ Error Handling**: Robust error handling prevents data leaks
- **🗑️ Auto Cleanup**: Expired sessions are automatically cleaned up

## 🤖 Bot Commands

The bot supports the following commands:

### Authentication Commands
- `/start` - Start the bot (shows login requirement if not authenticated)
- `/login` - Login with password to access bot features
- `/logout` - Logout and end current session

### Core Commands (Requires Authentication)
- `/help` - Display comprehensive help information
- `/cancel` - Cancel any ongoing process

### Account Management (Requires Authentication)
- `/add` - Add a new e-wallet account (DANA, OVO, GoPay Merchant)
- `/remove` - Remove an existing e-wallet account
- `/accounts` - View all your connected accounts with balances

### Transactions & Transfers (Requires Authentication)
- `/mutasi` - View your recent transactions with advanced filtering
- `/transfer` - Transfer money from your DANA account

## 🔐 Getting Started (Authentication Flow)

### First Time Setup
1. **Start the bot**: `/start`
   ```
   🔐 Akses Terbatas
   Bot ini memerlukan autentikasi sebelum digunakan.
   
   🔑 Gunakan perintah /login untuk masuk.
   ```

2. **Login**: `/login`
   ```
   🔐 Login ke Bot
   Silakan masukkan password:
   ```

3. **Enter Password**: Type your configured password
   ```
   ✅ Login berhasil!
   Selamat datang! Gunakan /help untuk melihat perintah yang tersedia.
   ```

4. **Access Features**: Now you can use all bot features for 24 hours

### Security Measures
- **🔒 Message Deletion**: Password messages are automatically deleted for security
- **⚠️ Attempt Counter**: Shows remaining attempts after failed logins
- **🕐 Temporary Blocks**: 30-minute blocks after 3 failed attempts
- **📊 Session Tracking**: All authentication attempts are logged

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

### First Time Authentication

1. **Start**: `/start`
2. **Login**: `/login`
3. **Enter Password**: Type your bot password (message gets deleted automatically)
4. **Success**: Now you can access all features
5. **Help**: Use `/help` to see available commands

### Adding a DANA Account (After Authentication)

1. Start with `/add`
2. Select **DANA** from the wallet options
3. Enter your DANA phone number (e.g., `081234567890`)
4. Enter your 6-digit DANA PIN
5. Choose verification method: **SMS** or **WhatsApp**
6. Enter the OTP code you receive
7. Provide a custom name for your account (e.g., "DANA Utama")
8. ✅ Account successfully added!

### Making a Bank Transfer (After Authentication)

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

### Paying with QRIS (After Authentication)

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
│   ├── authHandler.js         # Authentication & session management
│   ├── walletHandlers.js      # DANA/OVO wallet operations
│   ├── transferHandlers.js    # Bank transfer & QRIS functionality
│   ├── accountHandler.js      # Account management functions
│   ├── sessionUtils.js        # Session management utilities
│   ├── utils.js               # Utility functions (currency, validation)
│   └── logger.js              # Logging functionality
├── database/
│   └── sessions.db            # SQLite database for sessions & auth
└── .env                       # Environment configuration
```

### Authentication System
- **Password Protection**: Configurable password required for bot access
- **Session Types**: Different session types (authenticated, login, auth_attempts)
- **Attempt Tracking**: Failed login attempts tracked and limited
- **Auto Expiry**: Sessions automatically expire for security
- **Secure Storage**: Sessions stored in encrypted SQLite database

### Session Management
- **SQLite Database**: Secure session storage with automatic cleanup
- **24-hour Authentication**: Authenticated sessions last 24 hours
- **15-minute Activity**: Other sessions expire after 15 minutes
- **State Management**: Multi-step processes handled seamlessly
- **Concurrent Support**: Multiple users can use the bot simultaneously

## 🛡️ Security Configuration

### Environment Variables
```env
# Authentication Settings
BOT_PASSWORD=your_secure_password          # Required: Bot access password
MAX_LOGIN_ATTEMPTS=3                       # Optional: Max failed attempts (default: 3)
LOGIN_TIMEOUT_MINUTES=30                   # Optional: Block duration (default: 30)

# Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token          # Required: From BotFather
MUTASIKU_API_KEY=your_api_key              # Required: From Mutasiku
TELEGRAM_BOT_NAME=YourBotName              # Optional: Bot display name
DB_PATH=./database/sessions.db             # Optional: Database location
```

### Security Best Practices
- **🔑 Strong Password**: Use a strong, unique password for bot access
- **🔄 Regular Updates**: Change the bot password regularly
- **📊 Monitor Logs**: Check logs for unauthorized access attempts
- **🚫 IP Restrictions**: Consider implementing IP whitelisting if needed
- **⏰ Session Rotation**: Sessions automatically expire for security

## 🎯 User Experience Features

### Authentication UX
- **Clear Instructions**: Users know exactly what's required
- **Attempt Counter**: Shows remaining login attempts
- **Security Messages**: Passwords are automatically deleted
- **Progress Feedback**: Real-time authentication status
- **Helpful Errors**: Clear error messages with next steps

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

- **Efficient Database**: SQLite for fast session and authentication management
- **Async Processing**: Non-blocking operations for better user experience
- **Memory Management**: Automatic session cleanup and garbage collection
- **Rate Limiting**: Built-in protection against spam and abuse
- **Authentication Caching**: Efficient session validation

## 🔧 Development & Debugging

### Running in Development
```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your credentials

# Run with auto-restart
npm run dev

# Run tests
npm test
```

### Authentication Testing
```bash
# Test authentication flow
1. Start bot: /start
2. Login: /login
3. Enter test password
4. Verify access to protected commands
5. Test logout: /logout
```

### Environment Variables
```env
# Required
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
MUTASIKU_API_KEY=your_mutasiku_api_key
BOT_PASSWORD=your_secure_password

# Optional
TELEGRAM_BOT_NAME=YourBotName
DB_PATH=./database/sessions.db
MAX_LOGIN_ATTEMPTS=3
LOGIN_TIMEOUT_MINUTES=30
LOG_LEVEL=info
```

### Logging
The bot includes comprehensive logging for monitoring and debugging:
- **Authentication**: All login attempts and security events
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

- [ ] **Two-Factor Authentication**: Enhanced security with 2FA
- [ ] **Role-based Access**: Different permission levels
- [ ] **Scheduled Transfers**: Set up recurring payments
- [ ] **Budget Alerts**: Set spending limits and notifications
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

- **🔐 Security**: Password-protected access
- **🏦 Supported Banks**: 136+ Indonesian banks
- **💱 E-wallets**: 3 major providers (DANA, OVO, GoPay)
- **🚀 Response Time**: Sub-second API responses
- **🔒 Uptime**: 99.9% API availability
- **👥 Active Users**: Growing daily

---

Made with ❤️ by the [Mutasiku Team](https://mutasiku.co.id)