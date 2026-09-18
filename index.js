const TelegramBot = require('node-telegram-bot-api');
const http = require('http');

const config = require('./config');
const {
    getLiveAccess,
    getNewNumber,
    getSuccessOtp
} = require('./api');

// Bot initialization with explicit polling options and webhook disable
const bot = new TelegramBot(config.BOT_TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    },
    webHook: false
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
const userBalance = {};
const processedOtps = new Set();

const MIN_WITHDRAW_AMOUNT = 100.00;
const OTP_REWARD_AMOUNT = 0.70;

// মেথড গ্রুপের ইউজারনেম (বট চালানোর সময় এই গ্রুপে জয়েন করা বাধ্যতামূলক)
const METHOD_CHANNEL = '@otpmethod_r';


function getUserData(userId) {
    if (!userBalance[userId]) {
        userBalance[userId] = {
            totalOtp: 0,
            totalEarned: 0,
            totalWithdrawn: 0
        };
    }

    return userBalance[userId];
}


// ===============================
// DUAL CHANNEL CHECK (BOTH GROUPS)
// ===============================

async function checkChannelMember(userId) {
    try {
        // ১. মূল ওটিপি চ্যানেল চেক
        const member1 = await bot.getChatMember(config.REQUIRED_CHANNEL, userId);
        const isJoined1 = ['creator', 'administrator', 'member'].includes(member1.status);

        // ২. মেথড গ্রুপ চেক
        const member2 = await bot.getChatMember(METHOD_CHANNEL, userId);
        const isJoined2 = ['creator', 'administrator', 'member'].includes(member2.status);

        // দুটি গ্রুপেই থাকতে হবে
        return isJoined1 && isJoined2;

    } catch (error) {
        console.error('Channel check error:', error.message);
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

    getUserData(chatId);

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

    const data = getUserData(chatId);

    const currentBalance =
        data.totalEarned -
        data.totalWithdrawn;

    const balanceMsg =
        `📊 *Your Account Statement:*\n\n` +
        `🔢 *Total Received OTP:* \`${data.totalOtp}\`\n` +
        `💵 *Total Earnings:* \`${data.totalEarned.toFixed(2)}\` ৳\n` +
        `🏧 *Total Withdrawal:* \`${data.totalWithdrawn.toFixed(2)}\` ৳\n` +
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
// SECURE SUCCESS OTP CHECKER (UID EXCLUSIVE)
// ===============================

async function startFastOtpChecker(chatId, phoneNumber) {
    const startTime = Date.now();
    const maxDurationMs = 15 * 60 * 1000;
    const intervalTime = 1000;

    const cleanUserPhone = String(phoneNumber).replace(/\D/g, '');

    const interval = setInterval(async () => {
        const elapsedTime = Date.now() - startTime;

        if (elapsedTime > maxDurationMs) {
            clearInterval(interval);
            return;
        }

        try {
            const otpResult = await getSuccessOtp();
            if (otpResult && otpResult.data) {
                const otpsList = otpResult.data.otps || otpResult.data.hits || otpResult.data;
                const items = Array.isArray(otpsList) ? otpsList : Object.values(otpsList);

                for (let item of items) {
                    if (!item) continue;

                    const targetNum = item.number || item.phone || item.full_number || item.range || '';
                    const messageText = item.message || item.sms || item.code || '';

                    const cleanTargetNum = targetNum ? String(targetNum).replace(/\D/g, '') : '';
                    const uniqueOtpId = `${cleanTargetNum}_${item.otp_id || messageText}_${item.time || Date.now()}`;

                    if (cleanTargetNum && (cleanTargetNum.includes(cleanUserPhone) || cleanUserPhone.includes(cleanTargetNum)) && messageText) {
                        
                        if (processedOtps.has(uniqueOtpId)) {
                            continue;
                        }

                        if ((Date.now() - startTime) > maxDurationMs) {
                            clearInterval(interval);
                            return;
                        }

                        processedOtps.add(uniqueOtpId);
                        clearInterval(interval);

                        const userData = getUserData(chatId);
                        userData.totalOtp += 1;
                        userData.totalEarned += OTP_REWARD_AMOUNT;

                        const otpMsg =
                            `🎉 *OTP Received Successfully!*\n\n` +
                            `📞 *Number:* \`${phoneNumber}\`\n` +
                            `💬 *Details:* \`${messageText}\`\n` +
                            `💰 *Reward Added:* +${OTP_REWARD_AMOUNT} ৳\n\n` +
                            `✅ OTP successfully received!`;

                        // ওটিপি মেসেজের নিচে শুধু OTP Group বাটন থাকবে
                        const otpKeyboard = {
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: 'OTP Group', url: 'https://t.me/otpgroup_rt' }
                                    ]
                                ]
                            }
                        };

                        // ইউজারের ইনবক্সে পাঠানো
                        await bot.sendMessage(chatId, otpMsg, {
                            parse_mode: 'Markdown',
                            ...otpKeyboard
                        });

                        // চ্যানেলেও ফরোয়ার্ড করা
                        await bot.sendMessage(config.REQUIRED_CHANNEL, `📢 *New Channel OTP Alert*\n\n` + otpMsg, {
                            parse_mode: 'Markdown',
                            ...otpKeyboard
                        });

                        return;
                    }
                }
            }
        } catch (err) {
            console.error('Success OTP Check error:', err.message);
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

        const data = getUserData(chatId);
        const currentBalance = data.totalEarned - data.totalWithdrawn;

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

            // দুটি গ্রুপে জয়েন করা আছে কিনা তা চেক করা হচ্ছে
            const isJoined = await checkChannelMember(chatId);

            if (!isJoined) {
                await bot.sendMessage(
                    chatId,
                    `❌ *Please join both of our channels/groups first to use the bot.*\n\n` +
                    `1️⃣ OTP Group: ${config.REQUIRED_CHANNEL}\n` +
                    `2️⃣ Method Group: ${METHOD_CHANNEL}`,
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
            const userData = getUserData(chatId);
            const currentBalance = userData.totalEarned - userData.totalWithdrawn;

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

            userData.totalWithdrawn += amount;
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
// HTTP SERVER (RENDER PORT BINDING)
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
});});

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
const userBalance = {};
const processedOtps = new Set();

const MIN_WITHDRAW_AMOUNT = 100.00;
const OTP_REWARD_AMOUNT = 0.70;


function getUserData(userId) {
    if (!userBalance[userId]) {
        userBalance[userId] = {
            totalOtp: 0,
            totalEarned: 0,
            totalWithdrawn: 0
        };
    }

    return userBalance[userId];
}


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

    getUserData(chatId);

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

    const data = getUserData(chatId);

    const currentBalance =
        data.totalEarned -
        data.totalWithdrawn;

    const balanceMsg =
        `📊 *Your Account Statement:*\n\n` +
        `🔢 *Total Received OTP:* \`${data.totalOtp}\`\n` +
        `💵 *Total Earnings:* \`${data.totalEarned.toFixed(2)}\` ৳\n` +
        `🏧 *Total Withdrawal:* \`${data.totalWithdrawn.toFixed(2)}\` ৳\n` +
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
// SECURE SUCCESS OTP CHECKER (UID EXCLUSIVE)
// ===============================

async function startFastOtpChecker(chatId, phoneNumber) {
    const startTime = Date.now();
    const maxDurationMs = 15 * 60 * 1000;
    const intervalTime = 1000;

    const cleanUserPhone = String(phoneNumber).replace(/\D/g, '');

    const interval = setInterval(async () => {
        const elapsedTime = Date.now() - startTime;

        if (elapsedTime > maxDurationMs) {
            clearInterval(interval);
            return;
        }

        try {
            // শুধুমাত্র ইউজারের নিজের একাউন্টের সাকসেসফুল ওটিপি ফিড নিয়ে আসা হচ্ছে
            const otpResult = await getSuccessOtp();
            if (otpResult && otpResult.data) {
                const otpsList = otpResult.data.otps || otpResult.data.hits || otpResult.data;
                const items = Array.isArray(otpsList) ? otpsList : Object.values(otpsList);

                for (let item of items) {
                    if (!item) continue;

                    const targetNum = item.number || item.phone || item.full_number || item.range || '';
                    const messageText = item.message || item.sms || item.code || '';

                    const cleanTargetNum = targetNum ? String(targetNum).replace(/\D/g, '') : '';
                    const uniqueOtpId = `${cleanTargetNum}_${item.otp_id || messageText}_${item.time || Date.now()}`;

                    // নাম্বার নিখুঁতভাবে মিলে গেলে এবং মেসেজ থাকলে তবেই গ্রহণ করবে
                    if (cleanTargetNum && (cleanTargetNum.includes(cleanUserPhone) || cleanUserPhone.includes(cleanTargetNum)) && messageText) {
                        
                        if (processedOtps.has(uniqueOtpId)) {
                            continue;
                        }

                        if ((Date.now() - startTime) > maxDurationMs) {
                            clearInterval(interval);
                            return;
                        }

                        processedOtps.add(uniqueOtpId);
                        clearInterval(interval);

                        const userData = getUserData(chatId);
                        userData.totalOtp += 1;
                        userData.totalEarned += OTP_REWARD_AMOUNT;

                        const otpMsg =
                            `🎉 *OTP Received Successfully!*\n\n` +
                            `📞 *Number:* \`${phoneNumber}\`\n` +
                            `💬 *Details:* \`${messageText}\`\n` +
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

                        // ইউজারের ইনবক্সে পাঠানো
                        await bot.sendMessage(chatId, otpMsg, {
                            parse_mode: 'Markdown',
                            ...otpKeyboard
                        });

                        // আপনার চ্যানেলেও অটোমেটিক ওটিপি পাঠানোর জন্য
                        await bot.sendMessage(config.REQUIRED_CHANNEL, `📢 *New Channel OTP Alert*\n\n` + otpMsg, {
                            parse_mode: 'Markdown',
                            ...otpKeyboard
                        });

                        return;
                    }
                }
            }
        } catch (err) {
            console.error('Success OTP Check error:', err.message);
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

        const data = getUserData(chatId);
        const currentBalance = data.totalEarned - data.totalWithdrawn;

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
            const userData = getUserData(chatId);
            const currentBalance = userData.totalEarned - userData.totalWithdrawn;

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

            userData.totalWithdrawn += amount;
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
// HTTP SERVER (RENDER PORT BINDING)
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
