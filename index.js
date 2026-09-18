const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const { Pool } = require('pg');

const config = require('./config');
const {
    getLiveAccess,
    getNewNumber,
    getSuccessOtp
} = require('./api');

// ===============================
// DATABASE CONNECTION (PostgreSQL)
// ===============================

const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                chat_id BIGINT PRIMARY KEY,
                total_otp INT DEFAULT 0,
                total_earned NUMERIC(10, 2) DEFAULT 0.00,
                total_withdrawn NUMERIC(10, 2) DEFAULT 0.00
            );
        `);
        console.log('Database connected and tables verified successfully.');
    } catch (err) {
        console.error('Database initialization error:', err.message);
    }
}

initDatabase();

async function getUserData(chatId) {
    try {
        let res = await pool.query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
        if (res.rows.length === 0) {
            await pool.query(
                'INSERT INTO users (chat_id, total_otp, total_earned, total_withdrawn) VALUES ($1, 0, 0.00, 0.00)',
                [chatId]
            );
            return { total_otp: 0, total_earned: 0.00, total_withdrawn: 0.00 };
        }
        return res.rows[0];
    } catch (err) {
        console.error('Get user data error:', err.message);
        return { total_otp: 0, total_earned: 0.00, total_withdrawn: 0.00 };
    }
}

async function updateUserData(chatId, otpInc, earnedInc, withdrawnInc) {
    try {
        await pool.query(`
            UPDATE users 
            SET total_otp = total_otp + $2, 
                total_earned = total_earned + $3, 
                total_withdrawn = total_withdrawn + $4 
            WHERE chat_id = $1
        `, [chatId, otpInc, earnedInc, withdrawnInc]);
    } catch (err) {
        console.error('Update user data error:', err.message);
    }
}


const bot = new TelegramBot(config.BOT_TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

// ===============================
// ERROR HANDLING
// ===============================

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

bot.on('polling_error', (error) => {
    console.error('Polling Error:', error.message);
});

bot.on('error', (error) => {
    console.error('Bot Error:', error.message);
});

// Check Telegram connection
bot.getMe()
    .then((me) => {
        console.log('=================================');
        console.log('BOT CONNECTED');
        console.log('Username:', '@' + me.username);
        console.log('Bot ID:', me.id);
        console.log('=================================');
    })
    .catch((error) => {
        console.error('BOT CONNECTION FAILED:', error.message);
    });


// ===============================
// USER DATA & SECURITY MAP
// ===============================

const userLocks = {};
const userState = {};
const processedOtps = new Set();

const MIN_WITHDRAW_AMOUNT = 100.00;
const OTP_REWARD_AMOUNT = 0.70;


// ===============================
// CHANNEL CHECK
// ===============================

async function checkChannelMember(userId) {
    try {
        const member = await bot.getChatMember(
            config.REQUIRED_CHANNEL,
            userId
        );

        return [
            'creator',
            'administrator',
            'member'
        ].includes(member.status);

    } catch (error) {
        console.error(
            'Channel check error:',
            error.message
        );
        return false;
    }
}


// ===============================
// MAIN MENU
// ===============================

const mainMenu = {
    reply_markup: {
        keyboard: [
            [
                { text: '📱 Get Active Number' }
            ],
            [
                { text: '💰 Balance' },
                { text: '💸 Withdraw' }
            ],
            [
                { text: '🔄 Refresh Panel' },
                { text: '💬 Support' }
            ]
        ],
        resize_keyboard: true
    }
};


// ===============================
// /START
// ===============================

bot.onText(/^\/start(?:@\w+)?$/, async (msg) => {

    const chatId = msg.chat.id;

    delete userState[chatId];

    await getUserData(chatId);

    try {

        await bot.sendMessage(
            chatId,

            `👋 *RIFAT_SMS* Bot service is active!\n\n` +
            `💡 *Per OTP Reward:* ${OTP_REWARD_AMOUNT} ৳\n` +
            `⏱️ *Time Limit:* OTP must arrive within 15 minutes.\n\n` +
            `Click *Get Active Number* to get a number or click *Balance* to check earnings.\n\n` +
            `📌 *Minimum Withdraw: 100 ৳*`,

            {
                parse_mode: 'Markdown',
                reply_markup: mainMenu.reply_markup
            }
        );

    } catch (error) {

        console.error('START SEND ERROR:', error.message);

    }

});


// ===============================
// /STAT
// ===============================

bot.onText(/^\/stat(?:@\w+)?$/, async (msg) => {

    const chatId = msg.chat.id;

    await sendBalance(chatId);

});


// ===============================
// BALANCE FUNCTION
// ===============================

async function sendBalance(chatId) {

    delete userState[chatId];

    const data = await getUserData(chatId);

    const earned = Number(data.total_earned) || 0;
    const withdrawn = Number(data.total_withdrawn) || 0;
    const totalOtp = Number(data.total_otp) || 0;

    const currentBalance = earned - withdrawn;

    const balanceMsg =
        `📊 *Your Account Statement:*\n\n` +
        `🔢 *Total Received OTP:* \`${totalOtp}\`\n` +
        `💵 *Total Earnings:* \`${earned.toFixed(2)}\` ৳\n` +
        `🏧 *Total Withdrawal:* \`${withdrawn.toFixed(2)}\` ৳\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `💳 *Current Balance:* \`${currentBalance.toFixed(2)}\` ৳\n\n` +
        `📌 *Minimum Withdraw: 100 ৳*`;

    try {

        await bot.sendMessage(
            chatId,
            balanceMsg,
            {
                parse_mode: 'Markdown',
                reply_markup: mainMenu.reply_markup
            }
        );

    } catch (error) {

        console.error('Balance error:', error.message);

    }
}


// ===============================
// SECURE FAST OTP CHECKER
// ===============================

async function startFastOtpChecker(chatId, phoneNumber) {
    const startTime = Date.now();
    const maxDurationMs = 15 * 60 * 1000;
    const intervalTime = 1000;

    const interval = setInterval(async () => {
        const elapsedTime = Date.now() - startTime;

        if (elapsedTime > maxDurationMs) {
            clearInterval(interval);
            return;
        }

        try {
            const otpResult = await getSuccessOtp();
            if (otpResult) {
                const items = otpResult.data || otpResult.items || otpResult;
                if (Array.isArray(items)) {
                    for (let item of items) {
                        const targetNum = item.number || item.phone || item.full_number;
                        const code = item.otp || item.code || item.sms;

                        const uniqueOtpId = `${targetNum}_${code}`;

                        if (targetNum && String(targetNum).includes(phoneNumber) && code) {
                            
                            if (processedOtps.has(uniqueOtpId)) {
                                continue;
                            }

                            if ((Date.now() - startTime) > maxDurationMs) {
                                clearInterval(interval);
                                return;
                            }

                            processedOtps.add(uniqueOtpId);
                            clearInterval(interval);

                            await updateUserData(chatId, 1, OTP_REWARD_AMOUNT, 0);

                            const otpMsg =
                                `🎉 *OTP Received Successfully!*\n\n` +
                                `📞 *Number:* \`${phoneNumber}\`\n` +
                                `💬 *OTP Code:* \`${code}\`\n` +
                                `💰 *Reward Added:* +${OTP_REWARD_AMOUNT} ৳\n\n` +
                                `✅ OTP successfully received!`;

                            const otpKeyboard = {
                                reply_markup: {
                                    inline_keyboard: [
                                        [
                                            { text: 'OTP Group', url: 'https://t.me/otpgroup_rt' }
                                        ]
                                    ]
                                }
                            };

                            await bot.sendMessage(chatId, otpMsg, {
                                parse_mode: 'Markdown',
                                ...otpKeyboard
                            });
                            return;
                        }
                    }
                }
            }
        } catch (err) {
            console.error('Fast OTP Check error:', err.message);
        }
    }, intervalTime);
}


// ===============================
// MESSAGE HANDLER
// ===============================

bot.on('message', async (msg) => {

    const chatId = msg.chat.id;

    const text = msg.text
        ? msg.text.trim()
        : '';

    if (!text) return;

    if (
        text.startsWith('/start') ||
        text.startsWith('/stat')
    ) {
        return;
    }

    if (userLocks[chatId]) {
        return;
    }


    // ===========================
    // BALANCE / STAT
    // ===========================

    if (
        text.includes('Balance') ||
        text.toLowerCase() === 'stat'
    ) {

        return sendBalance(chatId);

    }


    // ===========================
    // SUPPORT
    // ===========================

    if (text.includes('Support')) {

        delete userState[chatId];

        const username =
            String(config.SUPPORT_USERNAME)
                .replace('@', '');

        const supportKeyboard = {

            reply_markup: {

                inline_keyboard: [

                    [
                        {
                            text: '👨‍💻 Contact Admin',
                            url: `https://t.me/${username}`
                        }
                    ]

                ]

            }

        };

        return bot.sendMessage(
            chatId,

            `🎧 *Support*\n\n` +
            `For any issues or inquiries, click the button below to contact the Admin.`,

            {
                parse_mode: 'Markdown',
                ...supportKeyboard
            }
        );

    }


    // ===========================
    // WITHDRAW BUTTON CLICK
    // ===========================

    if (text.includes('Withdraw') || text.includes('💸')) {

        delete userState[chatId];

        const data = await getUserData(chatId);
        const currentBalance = (Number(data.total_earned) || 0) - (Number(data.total_withdrawn) || 0);

        const withdrawMethods = {

            reply_markup: {

                inline_keyboard: [

                    [
                        {
                            text: '🌸 Bkash',
                            callback_data: 'withdraw_Bkash'
                        },
                        {
                            text: '🟠 Nagad',
                            callback_data: 'withdraw_Nagad'
                        }
                    ],

                    [
                        {
                            text: '🚀 Rocket',
                            callback_data: 'withdraw_Rocket'
                        }
                    ]

                ]

            }

        };


        return bot.sendMessage(

            chatId,

            `💳 *Select Withdraw Method*\n\n` +
            `💰 Current Balance: \`${currentBalance.toFixed(2)}\` ৳\n` +
            `📌 Minimum Withdraw: *100 ৳*`,

            {
                parse_mode: 'Markdown',
                ...withdrawMethods
            }

        );

    }


    // ===========================
    // STEP 1: RECEIVE WALLET NUMBER
    // ===========================

    if (
        userState[chatId] &&
        userState[chatId].step === 'AWAITING_NUMBER'
    ) {

        const method = userState[chatId].method;
        const walletNumber = text.replace(/[\s-]/g, '');

        if (!/^\d{10,15}$/.test(walletNumber)) {

            return bot.sendMessage(
                chatId,
                `❌ Please provide a valid ${method} number.`
            );

        }

        userState[chatId].walletNumber = walletNumber;
        userState[chatId].step = 'AWAITING_AMOUNT';

        return bot.sendMessage(
            chatId,
            `📲 Number accepted: \`${walletNumber}\`\n\n` +
            `Now send the amount of money you want to withdraw:`,
            {
                parse_mode: 'Markdown'
            }
        );

    }


    // ===========================
    // STEP 2: RECEIVE AMOUNT & ASK CONFIRMATION
    // ===========================

    if (
        userState[chatId] &&
        userState[chatId].step === 'AWAITING_AMOUNT'
    ) {

        const amount = Number(text.replace(/,/g, ''));

        if (!Number.isFinite(amount) || amount < MIN_WITHDRAW_AMOUNT) {
            return bot.sendMessage(
                chatId,
                `❌ Minimum withdraw amount is 100 ৳. Enter the correct amount:`
            );
        }

        userState[chatId].amount = amount;
        userState[chatId].step = 'AWAITING_CONFIRMATION';

        const confirmKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Confirm Withdraw', callback_data: 'confirm_withdraw' },
                        { text: '❌ Cancel', callback_data: 'cancel_withdraw' }
                    ]
                ]
            }
        };

        return bot.sendMessage(
            chatId,
            `⚠️ *Confirm Withdraw*\n\n` +
            `🔹 Method: ${userState[chatId].method}\n` +
            `📞 Number: \`${userState[chatId].walletNumber}\`\n` +
            `💰 Amount: \`${amount.toFixed(2)}\` ৳\n\n` +
            `Click the button below to confirm:`,
            {
                parse_mode: 'Markdown',
                ...confirmKeyboard
            }
        );

    }


    // ===========================
    // GET ACTIVE NUMBER / REFRESH
    // ===========================

    if (
        text.includes('Get Active Number') ||
        text.includes('Refresh Panel')
    ) {

        if (userLocks[chatId]) {
            return;
        }

        userLocks[chatId] = true;
        delete userState[chatId];

        try {

            const isJoined = await checkChannelMember(chatId);

            if (!isJoined) {
                await bot.sendMessage(
                    chatId,
                    `❌ *Please join our channel first.*` +
                    `\n\nChannel: ${config.REQUIRED_CHANNEL}`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            await bot.sendMessage(
                chatId,
                '⏳ Checking live active number from panel...'
            );

            const liveData = await getLiveAccess();

            if (
                !liveData ||
                !liveData.data ||
                !Array.isArray(liveData.data.services)
            ) {
                return bot.sendMessage(
                    chatId,
                    '❌ No valid data received from the panel.'
                );
            }

            let targetRange = null;

            for (const service of liveData.data.services) {
                if (service.ranges && service.ranges.length > 0) {
                    const cleaned = String(service.ranges[0]).replace(/[^0-9]/g, '');
                    if (cleaned) {
                        targetRange = cleaned;
                        break;
                    }
                }
            }

            if (!targetRange) {
                return bot.sendMessage(
                    chatId,
                    'ℹ️ No active range available at the moment.'
                );
            }

            const numResult = await getNewNumber(targetRange);

            if (!numResult || !numResult.data) {
                return bot.sendMessage(
                    chatId,
                    '❌ Failed to allocate number.'
                );
            }

            const phoneData = numResult.data;
            const phoneNumber = phoneData.full_number || phoneData.number || 'N/A';
            const countryName = phoneData.country || 'Unknown';

            startFastOtpChecker(chatId, phoneNumber);

            await bot.sendMessage(
                chatId,
                `📍 *Country:* ${countryName}\n` +
                `📞 *Number:* \`${phoneNumber}\`\n\n` +
                `✅ Active Number successfully allocated. (Valid for 15 minutes)`,
                { parse_mode: 'Markdown' }
            );

        } catch (error) {
            console.error('NUMBER ERROR:', error);
            try {
                await bot.sendMessage(
                    chatId,
                    '❌ A technical error occurred. Please try again later.'
                );
            } catch (sendError) {
                console.error('ERROR MESSAGE SEND FAILED:', sendError.message);
            }
        } finally {
            userLocks[chatId] = false;
        }

    }

});


// ===============================
// CALLBACK QUERY (METHOD & CONFIRMATION)
// ===============================

bot.on('callback_query', async (query) => {

    try {

        if (!query.message || !query.message.chat) {
            return;
        }

        const chatId = query.message.chat.id;
        const data = query.data;
        const user = query.from;

        if (data && data.startsWith('withdraw_')) {

            const method = data.split('_')[1];

            userState[chatId] = {
                step: 'AWAITING_NUMBER',
                method: method
            };

            await bot.answerCallbackQuery(query.id);

            await bot.sendMessage(
                chatId,
                `📲 *${method}* selected.\n\n` +
                `Now send your *${method} number*:`,
                {
                    parse_mode: 'Markdown'
                }
            );

        }

        if (data === 'confirm_withdraw') {

            if (!userState[chatId] || userState[chatId].step !== 'AWAITING_CONFIRMATION') {
                await bot.answerCallbackQuery(query.id, { text: 'Session expired.' });
                return;
            }

            const { method, walletNumber, amount } = userState[chatId];
            const dbData = await getUserData(chatId);
            const currentBalance = (Number(dbData.total_earned) || 0) - (Number(dbData.total_withdrawn) || 0);

            if (amount > currentBalance) {
                delete userState[chatId];
                await bot.answerCallbackQuery(query.id);
                return bot.sendMessage(
                    chatId,
                    `❌ *Withdraw Failed!*\n\n` +
                    `You do not have sufficient balance.\n` +
                    `💳 Current Balance: \`${currentBalance.toFixed(2)}\` ৳\n` +
                    `💰 Withdraw Amount: \`${amount.toFixed(2)}\` ৳`,
                    { parse_mode: 'Markdown' }
                );
            }

            await updateUserData(chatId, 0, 0, amount);
            delete userState[chatId];

            const username = user.username ? '@' + user.username : 'N/A';

            await bot.answerCallbackQuery(query.id, { text: 'Withdraw Successful!' });

            await bot.sendMessage(
                chatId,
                `✅ *Withdraw Request submitted successfully!*\n\n` +
                `🔹 Method: ${method}\n` +
                `📞 Number: \`${walletNumber}\`\n` +
                `💰 Amount: \`${amount.toFixed(2)}\` ৳\n\n` +
                `⏳ Payment will be sent soon after Admin verification.`,
                { parse_mode: 'Markdown' }
            );

            await bot.sendMessage(
                config.ADMIN_CHAT_ID,
                `📥 *New Withdraw Request (Success)*\n\n` +
                `👤 User: ${username}\n` +
                `🆔 ID: \`${chatId}\`\n` +
                `💳 Method: ${method}\n` +
                `📞 Number: \`${walletNumber}\`\n` +
                `💰 Amount: \`${amount.toFixed(2)}\` ৳`,
                { parse_mode: 'Markdown' }
            );

        }

        if (data === 'cancel_withdraw') {
            delete userState[chatId];
            await bot.answerCallbackQuery(query.id, { text: 'Withdraw Cancelled' });
            await bot.sendMessage(chatId, '❌ Withdraw request has been cancelled.');
        }

    } catch (error) {
        console.error('Callback Error:', error.message);
    }

});


// ===============================
// HTTP SERVER
// ===============================

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8'
    });
    res.end('RIFAT_SMS Bot is active and running!');
});

const PORT = process.env.PORT || 10000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is listening on port ${PORT}`);
});
