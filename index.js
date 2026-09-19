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
// PHONE NUMBER MASKING
// ===============================
function maskPhoneNumber(num) {
    const cleaned = String(num).trim();
    if (cleaned.length <= 7) return cleaned;
    return `${cleaned.slice(0, 6)}xxxx${cleaned.slice(-3)}`;
}


// ===============================
// COUNTRY FLAG GENERATOR
// ===============================
function getCountryFlag(countryInput) {
    if (!countryInput) return '🌐';
    let str = String(countryInput).trim().toUpperCase();

    const customMap = {
        'BANGLADESH': 'BD', 'INDIA': 'IN', 'USA': 'US', 'UNITED STATES': 'US',
        'PAKISTAN': 'PK', 'UK': 'GB', 'UNITED KINGDOM': 'GB', 'CANADA': 'CA',
        'RUSSIA': 'RU', 'INDONESIA': 'ID', 'MALAYSIA': 'MY', 'SAUDI ARABIA': 'SA',
        'UAE': 'AE', 'AFGHANISTAN': 'AF', 'GUINEA': 'GN', 'MADAGASCAR': 'MG'
    };

    if (customMap[str]) {
        str = customMap[str];
    }

    if (str.length === 2 && /^[A-Z]{2}$/.test(str)) {
        const codePoints = [...str].map(char => 127397 + char.charCodeAt(0));
        return String.fromCodePoint(...codePoints);
    }
    return '🌐';
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
            if (otpResult) {
                const otpsList = Array.isArray(otpResult) ? otpResult : (otpResult.otps || otpResult.hits || otpResult.data || Object.values(otpResult));
                const items = Array.isArray(otpsList) ? otpsList : Object.values(otpsList);

                for (let item of items) {
                    if (!item) continue;

                    const targetNum = item.number || item.phone || item.full_number || item.range || '';
                    const messageText = item.message || item.sms || item.code || '';

                    const cleanTargetNum = targetNum ? String(targetNum).replace(/\D/g, '') : '';
                    const safeOtpId = item.otp_id || messageText || 'otp';
                    const uniqueOtpId = `${cleanTargetNum}_${safeOtpId}_${item.time || Date.now()}`;

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
                        const maskedNumber = maskPhoneNumber(phoneNumber);

                        const otpMsg =
                            `🎉 *OTP Received Successfully!*\n\n` +
                            `📞 *Number:* \`${maskedNumber}\`\n` +
                            `💬 *Details:* \`${messageText}\`\n` +
                            `💰 *Reward Added:* +${OTP_REWARD_AMOUNT} ৳\n\n` +
                            `✅ OTP successfully received!`;

                        const otpKeyboard = {
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: 'OTP Group', url: 'https://t.me/otpgroup_rt' },
                                        { text: 'Method', url: 'https://t.me/otpmethod_r' }
                                    ],
                                    [
                                        { text: 'Number', url: 'https://t.me/rifatearningrt_bot' }
                                    ]
                                ]
                            }
                        };

                        await bot.sendMessage(chatId, otpMsg, {
                            parse_mode: 'Markdown',
                            ...otpKeyboard
                        });

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
// STEP 1: DYNAMIC APPS MENU BUILDER
// ===============================
async function showAppsMenu(chatId, messageId = null) {
    try {
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

        const liveData = await getLiveAccess();
        if (!liveData) {
            const errText = '❌ No active services available from panel right now.';
            if (messageId) return bot.editMessageText(errText, { chat_id: chatId, message_id: messageId });
            return bot.sendMessage(chatId, errText);
        }

        let items = [];
        if (Array.isArray(liveData)) {
            items = liveData;
        } else if (liveData.services && Array.isArray(liveData.services)) {
            items = liveData.services;
        } else if (liveData.data && Array.isArray(liveData.data)) {
            items = liveData.data;
        } else if (liveData.data && liveData.data.services && Array.isArray(liveData.data.services)) {
            items = liveData.data.services;
        } else {
            items = Object.values(liveData).flat();
        }

        if (!items || items.length === 0) {
            const errText = '❌ No active services available from panel right now.';
            if (messageId) return bot.editMessageText(errText, { chat_id: chatId, message_id: messageId });
            return bot.sendMessage(chatId, errText);
        }

        const appsSet = new Set();
        items.forEach(service => {
            if (!service) return;
            const sName = service.sid || service.name || service.title || service.service || service.app_name || service.service_name || service.platform || service.category || service.app;
            if (sName) {
                appsSet.add(String(sName).trim());
            }
        });

        const inlineKeyboard = [];
        let row = [];

        appsSet.forEach(appName => {
            row.push({
                text: `📱 ${appName}`,
                callback_data: `app_${appName}`
            });

            if (row.length === 2) {
                inlineKeyboard.push(row);
                row = [];
            }
        });

        if (row.length > 0) {
            inlineKeyboard.push(row);
        }

        if (inlineKeyboard.length === 0) {
            const errText = '❌ Services found, but failed to parse app names.';
            if (messageId) return bot.editMessageText(errText, { chat_id: chatId, message_id: messageId });
            return bot.sendMessage(chatId, errText);
        }

        const menuText = `🎛️ *RIFAT OTP DASHBOARD*\n\n👇 Select your desired app/service below to check available countries & numbers:`;
        const reply_markup = { inline_keyboard: inlineKeyboard };

        if (messageId) {
            return bot.editMessageText(menuText, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup });
        } else {
            return bot.sendMessage(chatId, menuText, { parse_mode: 'Markdown', reply_markup });
        }
    } catch (error) {
        console.error('ShowAppsMenu Error:', error);
        await bot.sendMessage(chatId, '❌ Failed to load services.');
    }
}


// ===============================
// STEP 2: SHOW COUNTRIES FOR SELECTED APP
// ===============================
async function showCountriesForApp(chatId, messageId, appName) {
    try {
        const liveData = await getLiveAccess();
        if (!liveData) return;

        let items = [];
        if (Array.isArray(liveData)) {
            items = liveData;
        } else if (liveData.services && Array.isArray(liveData.services)) {
            items = liveData.services;
        } else if (liveData.data && Array.isArray(liveData.data)) {
            items = liveData.data;
        } else if (liveData.data && liveData.data.services && Array.isArray(liveData.data.services)) {
            items = liveData.data.services;
        } else {
            items = Object.values(liveData).flat();
        }

        const inlineKeyboard = [];
        let row = [];

        items.forEach(service => {
            if (!service) return;
            const sName = String(service.sid || service.name || service.title || service.service || service.app_name || service.service_name || service.platform || service.category || service.app || '').trim();
            
            if (sName.toLowerCase() === appName.toLowerCase()) {
                const country = service.country || service.country_name || service.code || service.location || 'Global';
                const flag = getCountryFlag(country);
                
                let rangeVal = '';
                if (service.rid) {
                    rangeVal = String(service.rid);
                } else if (service.ranges && Array.isArray(service.ranges) && service.ranges.length > 0) {
                    rangeVal = String(service.ranges[0]).replace(/[^0-9]/g, '');
                } else if (service.range) {
                    rangeVal = String(service.range).replace(/[^0-9]/g, '');
                } else if (service.number) {
                    rangeVal = String(service.number).replace(/[^0-9]/g, '');
                } else if (service.id) {
                    rangeVal = String(service.id);
                }

                if (rangeVal) {
                    row.push({
                        text: `${flag} ${country}`,
                        callback_data: `num_${rangeVal}_${appName}`
                    });

                    if (row.length === 2) {
                        inlineKeyboard.push(row);
                        row = [];
                    }
                }
            }
        });

        if (row.length > 0) {
            inlineKeyboard.push(row);
        }

        inlineKeyboard.push([{ text: '⬅️ Back to Apps Menu', callback_data: 'back_to_apps' }]);

        const countryText = `📱 *App:* \`${appName}\`\n\n👇 Select your desired country below:`;
        const reply_markup = { inline_keyboard: inlineKeyboard };

        await bot.editMessageText(countryText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup
        });
    } catch (error) {}
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

        const supportKeyboard = {

            reply_markup: {

                inline_keyboard: [

                    [
                        {
                            text: '👨‍💻 Contact Admin',
                            url: `https://t.me/RIFAT_OTP_EARNING`
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
        await showAppsMenu(chatId);
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
        const messageId = query.message.message_id;
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

        if (data === 'back_to_apps') {
            await bot.answerCallbackQuery(query.id);
            return showAppsMenu(chatId, messageId);
        }

        if (data && data.startsWith('app_')) {
            const appName = data.replace('app_', '');
            await bot.answerCallbackQuery(query.id);
            return showCountriesForApp(chatId, messageId, appName);
        }

        if (data && data.startsWith('num_')) {
            const parts = data.split('_');
            const targetRange = parts[1];
            const appName = parts[2] || 'Service';

            await bot.answerCallbackQuery(query.id, { text: 'Allocating number...' });
            await bot.editMessageText('⏳ Allocating fresh number from panel...', { chat_id: chatId, message_id: messageId });

            const numResult = await getNewNumber(targetRange);
            if (!numResult || !numResult.data) {
                return bot.editMessageText('❌ Failed to allocate number.', { chat_id: chatId, message_id: messageId });
            }

            const phoneData = numResult.data;
            const phoneNumber = phoneData.full_number || phoneData.number || 'N/A';
            const finalCountry = phoneData.country || phoneData.country_name || phoneData.location || 'Global';
            const flagEmoji = getCountryFlag(finalCountry);

            startFastOtpChecker(chatId, phoneNumber);

            const numberKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🔄 Change Number', callback_data: `num_${targetRange}_${appName}` },
                            { text: '⬅️ Back to Countries', callback_data: `app_${appName}` }
                        ]
                    ]
                }
            };

            return bot.editMessageText(
                `⚡ *━━━ RIFAT OTP SERVICE ━━━* ⚡\n\n` +
                `🎯 *Service:* \`${appName}\`\n` +
                `${flagEmoji} *Country:* \`${finalCountry}\`\n` +
                `📞 *Number:* \`${phoneNumber}\`\n\n` +
                `✅ *Status:* Active Number Allocated\n` +
                `⏰ *Validity:* 15 Minutes`,
                { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...numberKeyboard }
            );
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
