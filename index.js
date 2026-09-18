const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const config = require('./config');

// ==================================================
// RENDER WEB SERVICE PORT
// ==================================================

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8'
    });

    res.end('RIFAT SMS Bot is running.');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Web server listening on port ${PORT}`);
});

// ==================================================
// CONFIG CHECK
// ==================================================

if (!config.BOT_TOKEN) {
    console.error('❌ BOT_TOKEN is missing.');
    process.exit(1);
}

if (!config.DATABASE_URL) {
    console.error('❌ DATABASE_URL is missing.');
    process.exit(1);
}

// ==================================================
// DATABASE
// ==================================================

const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.on('error', (error) => {
    console.error('❌ PostgreSQL Pool Error:', error.message);
});

// ==================================================
// TELEGRAM BOT
// ==================================================

const bot = new TelegramBot(config.BOT_TOKEN, {
    polling: false
});

// ==================================================
// ERROR HANDLING
// ==================================================

bot.on('polling_error', (error) => {
    console.error('❌ Polling Error:', error.message);
});

bot.on('error', (error) => {
    console.error('❌ Bot Error:', error.message);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

// ==================================================
// DATABASE INITIALIZATION
// ==================================================

async function initDatabase() {

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            user_id BIGINT PRIMARY KEY,
            total_otp INTEGER NOT NULL DEFAULT 0,
            total_earned NUMERIC(12,2) NOT NULL DEFAULT 0,
            total_withdrawn NUMERIC(12,2) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log('✅ PostgreSQL database connected.');
}

// ==================================================
// GET USER DATA
// ==================================================

async function getUserData(userId) {

    await pool.query(
        `
        INSERT INTO users (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
        `,
        [userId]
    );

    const result = await pool.query(
        `
        SELECT
            user_id,
            total_otp,
            total_earned,
            total_withdrawn
        FROM users
        WHERE user_id = $1
        `,
        [userId]
    );

    return result.rows[0];
}

// ==================================================
// GET BALANCE
// ==================================================

async function getBalance(userId) {

    const data = await getUserData(userId);

    return (
        Number(data.total_earned) -
        Number(data.total_withdrawn)
    );
}

// ==================================================
// MAIN MENU
// ==================================================

const mainMenu = {
    reply_markup: {
        keyboard: [
            [{ text: '💰 Balance' }],
            [{ text: '💸 Withdraw' }],
            [{ text: '💬 Support' }]
        ],
        resize_keyboard: true
    }
};

// ==================================================
// USER STATE
// ==================================================

const userState = {};

// ==================================================
// START COMMAND
// ==================================================

bot.onText(/^\/start(?:@\w+)?$/, async (msg) => {

    const chatId = msg.chat.id;

    try {

        await getUserData(chatId);

        await bot.sendMessage(
            chatId,

            `👋 *RIFAT_SMS*\n\n` +
            `Your account is ready.\n\n` +
            `💰 Check your balance using the Balance button.\n` +
            `💸 Minimum Withdraw: *100 ৳*`,

            {
                parse_mode: 'Markdown',
                reply_markup: mainMenu.reply_markup
            }
        );

    } catch (error) {

        console.error('❌ START ERROR:', error.message);

        await bot.sendMessage(
            chatId,
            '❌ Database error. Please try again later.'
        );
    }
});

// ==================================================
// BALANCE
// ==================================================

async function sendBalance(chatId) {

    try {

        const data = await getUserData(chatId);

        const totalEarned =
            Number(data.total_earned);

        const totalWithdrawn =
            Number(data.total_withdrawn);

        const balance =
            totalEarned - totalWithdrawn;

        await bot.sendMessage(
            chatId,

            `📊 *Your Account Statement*\n\n` +
            `🔢 Total OTP: \`${data.total_otp}\`\n` +
            `💵 Total Earnings: \`${totalEarned.toFixed(2)}\` ৳\n` +
            `🏧 Total Withdrawal: \`${totalWithdrawn.toFixed(2)}\` ৳\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `💳 Current Balance: \`${balance.toFixed(2)}\` ৳\n\n` +
            `📌 Minimum Withdraw: *100 ৳*`,

            {
                parse_mode: 'Markdown',
                reply_markup: mainMenu.reply_markup
            }
        );

    } catch (error) {

        console.error('❌ BALANCE ERROR:', error.message);

        await bot.sendMessage(
            chatId,
            '❌ Unable to load balance.'
        );
    }
}

// ==================================================
// MESSAGE HANDLER
// ==================================================

bot.on('message', async (msg) => {

    const chatId = msg.chat.id;
    const text = msg.text
        ? msg.text.trim()
        : '';

    if (!text) {
        return;
    }

    if (
        text.startsWith('/start') ||
        text.startsWith('/stat')
    ) {
        return;
    }

    // ==================================================
    // BALANCE
    // ==================================================

    if (
        text === '💰 Balance' ||
        text.toLowerCase() === 'balance' ||
        text.toLowerCase() === 'stat'
    ) {

        return sendBalance(chatId);
    }

    // ==================================================
    // SUPPORT
    // ==================================================

    if (
        text === '💬 Support' ||
        text.toLowerCase() === 'support'
    ) {

        const username =
            String(config.SUPPORT_USERNAME || '')
                .replace('@', '');

        if (!username) {

            return bot.sendMessage(
                chatId,
                '❌ Support is currently unavailable.'
            );
        }

        return bot.sendMessage(
            chatId,

            `🎧 *Support*\n\n` +
            `Contact our support team using the button below.`,

            {
                parse_mode: 'Markdown',

                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '👨‍💻 Contact Support',
                                url: `https://t.me/${username}`
                            }
                        ]
                    ]
                }
            }
        );
    }

    // ==================================================
    // WITHDRAW
    // ==================================================

    if (
        text === '💸 Withdraw' ||
        text.toLowerCase() === 'withdraw'
    ) {

        try {

            const balance =
                await getBalance(chatId);

            if (balance < 100) {

                return bot.sendMessage(
                    chatId,

                    `❌ *Insufficient Balance*\n\n` +
                    `💳 Current Balance: \`${balance.toFixed(2)}\` ৳\n` +
                    `📌 Minimum Withdraw: *100 ৳*`,

                    {
                        parse_mode: 'Markdown'
                    }
                );
            }

            userState[chatId] = {
                step: 'METHOD'
            };

            return bot.sendMessage(
                chatId,
                '💳 Select your withdrawal method:',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '🌸 Bkash',
                                    callback_data:
                                        'withdraw_Bkash'
                                },
                                {
                                    text: '🟠 Nagad',
                                    callback_data:
                                        'withdraw_Nagad'
                                }
                            ],
                            [
                                {
                                    text: '🚀 Rocket',
                                    callback_data:
                                        'withdraw_Rocket'
                                }
                            ]
                        ]
                    }
                }
            );

        } catch (error) {

            console.error(
                '❌ WITHDRAW ERROR:',
                error.message
            );

            return bot.sendMessage(
                chatId,
                '❌ Unable to process withdrawal.'
            );
        }
    }

    // ==================================================
    // WALLET NUMBER
    // ==================================================

    if (
        userState[chatId] &&
        userState[chatId].step === 'NUMBER'
    ) {

        const walletNumber =
            text.replace(/[\s-]/g, '');

        if (!/^\d{10,15}$/.test(walletNumber)) {

            return bot.sendMessage(
                chatId,
                '❌ Please enter a valid wallet number.'
            );
        }

        userState[chatId].walletNumber =
            walletNumber;

        userState[chatId].step =
            'AMOUNT';

        return bot.sendMessage(
            chatId,
            '💰 Now enter the withdrawal amount:'
        );
    }

    // ==================================================
    // AMOUNT
    // ==================================================

    if (
        userState[chatId] &&
        userState[chatId].step === 'AMOUNT'
    ) {

        const amount = Number(
            text.replace(/,/g, '')
        );

        if (
            !Number.isFinite(amount) ||
            amount < 100
        ) {

            return bot.sendMessage(
                chatId,
                '❌ Minimum withdrawal is 100 ৳.'
            );
        }

        const balance =
            await getBalance(chatId);

        if (amount > balance) {

            return bot.sendMessage(
                chatId,

                `❌ Insufficient balance.\n\n` +
                `💳 Available: ${balance.toFixed(2)} ৳`
            );
        }

        userState[chatId].amount =
            amount;

        userState[chatId].step =
            'CONFIRM';

        const state =
            userState[chatId];

        return bot.sendMessage(
            chatId,

            `⚠️ *Confirm Withdrawal*\n\n` +
            `🔹 Method: ${state.method}\n` +
            `📞 Number: \`${state.walletNumber}\`\
