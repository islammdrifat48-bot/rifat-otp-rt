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
// PHONE NUMBER MASKING FUNCTION
// ===============================

function maskPhoneNumber(num) {
    const cleaned = String(num).trim();
    if (cleaned.length <= 7) return cleaned;
    const start = cleaned.slice(0, 6);
    const end = cleaned.slice(-3);
    return `${start}xxxx${end}`;
}


// ===============================
// ALL COUNTRIES FLAG GENERATOR (SMART)
// ===============================

function getCountryFlag(countryInput) {
    if (!countryInput) return '🌐';
    let str = String(countryInput).trim().toUpperCase();

    const customMap = {
        'BANGLADESH': 'BD', 'INDIA': 'IN', 'USA': 'US', 'UNITED STATES': 'US',
        'PAKISTAN': 'PK', 'UK': 'GB', 'UNITED KINGDOM': 'GB', 'CANADA': 'CA',
        'RUSSIA': 'RU', 'INDONESIA': 'ID', 'MALAYSIA': 'MY', 'SAUDI ARABIA': 'SA',
        'UAE': 'AE', 'AFGHANISTAN': 'AF', 'ALBANIA': 'AL', 'ALGERIA': 'DZ',
        'ARGENTINA': 'AR', 'AUSTRALIA': 'AU', 'AUSTRIA': 'AT', 'BAHRAIN': 'BH',
        'BRAZIL': 'BR', 'CHINA': 'CN', 'FRANCE': 'FR', 'GERMANY': 'DE',
        'ITALY': 'IT', 'JAPAN': 'JP', 'TURKEY': 'TR', 'VIETNAM': 'VN',
        'BENIN': 'BJ', 'CAMEROON': 'CM', 'TOGO': 'TG', 'IVORY COAST': 'CI'
    };

    if (customMap[str]) {
        str = customMap[str];
    }

    if (str.length === 2 && /^[A-Z]{2}$/.test(str)) {
        const codePoints = [...str].map(char => 127397 + char.charCodeAt(0));
        return String.fromCodePoint(...codePoints);
    }

    for (const name in customMap) {
        if (str.includes(name)) {
            const code = customMap[name];
            const codePoints = [...code].map(char => 127397 + char.charCodeAt(0));
            return String.fromCodePoint(...codePoints);
        }
    }

    return '🌐';
}


// ===============================
// DUAL CHANNEL CHECK (BOTH GROUPS)
// ===============================

async function checkChannelMember(userId) {
    try {
        const member1 = await bot.getChatMember(config.REQUIRED_CHANNEL, userId);
        const isJoined1 = ['creator', 'administrator', 'member'].includes(member1.status);

        const member2 = await bot.getChatMember(METHOD_CHANNEL, userId);
        const isJoined2 = ['creator', 'administrator', 'member'].includes(member2.status);

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
                { text: '⚡ Get Active Number ⚡' }
            ],
            [
                { text: '💰 My Balance' },
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
            `🚀 *Welcome to RIFAT OTP SERVICE* 🚀\n\n` +
            `✨ Fast, secure, and reliable automated OTP bot.\n\n` +
            `💡 *Per OTP Reward:* \`${OTP_REWARD_AMOUNT} ৳\`\n` +
            `⏱️ *Time Limit:* OTP must arrive within 15 minutes.\n\n` +
            `👇 Click *Get Active Number* below to choose your app and start!`,
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
// /STAT & BALANCE FUNCTION
// ===============================

bot.onText(/^\/stat(?:@\w+)?$/, async (msg) => {
    await sendBalance(msg.chat.id);
});

async function sendBalance(chatId) {
    delete userState[chatId];
    const data = getUserData(chatId);
    const currentBalance = data.totalEarned - data.totalWithdrawn;

    const balanceMsg =
        `📊 *Your Account Statement*\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `🔢 *Total Received OTP:* \`${data.totalOtp}\`\n` +
        `💵 *Total Earnings:* \`${data.totalEarned.toFixed(2)}\` ৳\n` +
        `🏧 *Total Withdrawal:* \`${data.totalWithdrawn.toFixed(2)}\` ৳\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `💳 *Current Balance:* \`${currentBalance.toFixed(2)}\` ৳\n\n` +
        `📌 *Minimum Withdraw: 100 ৳*`;

    try {
        await bot.sendMessage(chatId, balanceMsg, {
            parse_mode: 'Markdown',
            reply_markup: mainMenu.reply_markup
        });
    } catch (error) {
        console.error('Balance error:', error.message);
    }
}


// ===============================
// SECURE SUCCESS OTP CHECKER
// ===============================

async function startFastOtpChecker(chatId, phoneNumber) {
    const startTime = Date.now();
    const maxDurationMs = 15 * 60 * 1000;
    const intervalTime = 1000;
    const cleanUserPhone = String(phoneNumber).replace(/\D/g, '');

    const interval = setInterval(async () => {
        if ((Date.now() - startTime) > maxDurationMs) {
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
                        if (processedOtps.has(uniqueOtpId)) continue;
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
                            `🎉 *OTP Received Successfully!* 🎉\n\n` +
                            `📞 *Number:* \`${maskedNumber}\`\n` +
                            `💬 *Details:* \`${messageText}\`\n` +
                            `💰 *Reward Added:* \`+${OTP_REWARD_AMOUNT} ৳\`\n\n` +
                            `✅ Great job! Keep working.`;

                        const otpKeyboard = {
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '📢 OTP Channel', url: 'https://t.me/otpgroup_rt' },
                                        { text: '📚 Method Group', url: 'https://t.me/otpmethod_r' }
                                    ]
                                ]
                            }
                        };

                        await bot.sendMessage(chatId, otpMsg, { parse_mode: 'Markdown', ...otpKeyboard });
                        await bot.sendMessage(config.REQUIRED_CHANNEL, `📢 *New Channel OTP Alert*\n\n` + otpMsg, { parse_mode: 'Markdown', ...otpKeyboard });
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
// FETCH AND DISPLAY SERVICES DASHBOARD
// ===============================

async function showServicesDashboard(chatId, messageId = null) {
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
        if (!liveData || !liveData.data || !Array.isArray(liveData.data.services) || liveData.data.services.length === 0) {
            const errText = '❌ No active services available from panel right now.';
            if (messageId) {
                return bot.editMessageText(errText, { chat_id: chatId, message_id: messageId });
            }
            return bot.sendMessage(chatId, errText);
        }

        // সেবাগুলোর ইউনিক লিস্ট তৈরি করা (যেমন: Telegram, Imo, WhatsApp, Facebook ইত্যাদি)
        const servicesMap = {};
        for (const service of liveData.data.services) {
            const sName = service.name || service.title || service.service || 'General Service';
            if (!servicesMap[sName]) {
                servicesMap[sName] = 0;
            }
            if (service.ranges && Array.isArray(service.ranges)) {
                servicesMap[sName] += service.ranges.length;
            }
        }

        const inlineKeyboard = [];
        let row = [];

        for (const sName of Object.keys(servicesMap)) {
            row.push({
                text: `📱 ${sName} (${servicesMap[sName]})`,
                callback_data: `srv_${sName.substring(0, 30)}`
            });
            if (row.length === 2) {
                inlineKeyboard.push(row);
                row = [];
            }
        }
        if (row.length > 0) {
            inlineKeyboard.push(row);
        }

        const dashText = `🎛️ *RIFAT OTP DASHBOARD*\n\n` +
            `👇 Select your desired app/service below to check available countries & numbers:`;

        const replyMarkup = { reply_markup: { inline_keyboard: inlineKeyboard } };

        if (messageId) {
            return bot.editMessageText(dashText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                ...replyMarkup
            });
        } else {
            return bot.sendMessage(chatId, dashText, {
                parse_mode: 'Markdown',
                ...replyMarkup
            });
        }

    } catch (error) {
        console.error('Dashboard Error:', error.message);
        await bot.sendMessage(chatId, '❌ Failed to load services dashboard.');
    }
}


// ===============================
// MESSAGE HANDLER
// ===============================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';
    if (!text) return;

    if (text.startsWith('/start') || text.startsWith('/stat')) return;
    if (userLocks[chatId]) return;

    if (text.includes('Balance') || text.toLowerCase() === 'stat') {
        return sendBalance(chatId);
    }

    if (text.includes('Support')) {
        delete userState[chatId];
        const username = String(config.SUPPORT_USERNAME).replace('@', '');
        const supportKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👨‍💻 Contact Admin Support', url: `https://t.me/${username}` }]
                ]
            }
        };
        return bot.sendMessage(
            chatId,
            `🎧 *Customer Support*\n\nFacing any issues or need help? Click the button below to directly contact our Admin.`,
            { parse_mode: 'Markdown', ...supportKeyboard }
        );
    }

    if (text.includes('Withdraw') || text.includes('💸')) {
        delete userState[chatId];
        const data = getUserData(chatId);
        const currentBalance = data.totalEarned - data.totalWithdrawn;
        const withdrawMethods = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🌸 bKash', callback_data: 'withdraw_Bkash' },
                        { text: '🟠 Nagad', callback_data: 'withdraw_Nagad' }
                    ],
                    [
                        { text: '🚀 Rocket', callback_data: 'withdraw_Rocket' }
                    ]
                ]
            }
        };
        return bot.sendMessage(
            chatId,
            `💳 *Withdrawal Gateway*\n\n💰 Available Balance: \`${currentBalance.toFixed(2)}\` ৳\n📌 Minimum Withdraw: *100.00 ৳*\n\n👇 *Select your payment method below:*`,
            { parse_mode: 'Markdown', ...withdrawMethods }
        );
    }

    // Awaiting Wallet Number
    if (userState[chatId] && userState[chatId].step === 'AWAITING_NUMBER') {
        const method = userState[chatId].method;
        const walletNumber = text.replace(/[\s-]/g, '');
        if (!/^\d{10,15}$/.test(walletNumber)) {
            return bot.sendMessage(chatId, `❌ Please provide a valid ${method} account number.`);
        }
        userState[chatId].walletNumber = walletNumber;
        userState[chatId].step = 'AWAITING_AMOUNT';
        return bot.sendMessage(chatId, `📲 Account Number Accepted: \`${walletNumber}\`\n\n📥 Now send the amount you want to withdraw:`, { parse_mode: 'Markdown' });
    }

    // Awaiting Amount
    if (userState[chatId] && userState[chatId].step === 'AWAITING_AMOUNT') {
        const amount = Number(text.replace(/,/g, ''));
        if (!Number.isFinite(amount) || amount < MIN_WITHDRAW_AMOUNT) {
            return bot.sendMessage(chatId, `❌ Minimum withdraw amount is 100 ৳. Enter the correct amount:`);
        }
        userState[chatId].amount = amount;
        userState[chatId].step = 'AWAITING_CONFIRMATION';
        const confirmKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Confirm Request', callback_data: 'confirm_withdraw' },
                        { text: '❌ Cancel', callback_data: 'cancel_withdraw' }
                    ]
                ]
            }
        };
        return bot.sendMessage(
            chatId,
            `⚠️ *Withdrawal Summary*\n\n🔹 Method: \`${userState[chatId].method}\`\n📞 Number: \`${userState[chatId].walletNumber}\`\n💰 Amount: \`${amount.toFixed(2)}\` ৳\n\n👇 Click below to confirm your request:`,
            { parse_mode: 'Markdown', ...confirmKeyboard }
        );
    }

    // GET ACTIVE NUMBER / REFRESH
    if (text.includes('Get Active Number') || text.includes('Refresh Panel')) {
        await showServicesDashboard(chatId);
    }
});


// ===============================
// CALLBACK QUERY HANDLER (DASHBOARD & NUMBERS)
// ===============================

bot.on('callback_query', async (query) => {
    try {
        if (!query.message || !query.message.chat) return;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;
        const user = query.from;

        // Withdraw callbacks
        if (data && data.startsWith('withdraw_')) {
            const method = data.split('_')[1];
            userState[chatId] = { step: 'AWAITING_NUMBER', method: method };
            await bot.answerCallbackQuery(query.id);
            return bot.sendMessage(chatId, `📲 *${method}* selected.\n\nNow send your *${method} account number*:`, { parse_mode: 'Markdown' });
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
                return bot.sendMessage(chatId, `❌ *Withdraw Failed!*\n\nInsufficient balance.`, { parse_mode: 'Markdown' });
            }

            userData.totalWithdrawn += amount;
            delete userState[chatId];
            const username = user.username ? '@' + user.username : 'N/A';

            await bot.answerCallbackQuery(query.id, { text: 'Withdraw Successful!' });
            await bot.sendMessage(chatId, `✅ *Withdraw Request Submitted!*\n\n🔹 Method: \`${method}\`\n📞 Number: \`${walletNumber}\`\n💰 Amount: \`${amount.toFixed(2)}\` ৳`, { parse_mode: 'Markdown' });
            await bot.sendMessage(config.ADMIN_CHAT_ID, `📥 *New Withdraw Request (Success)*\n\n👤 User: ${username}\n🆔 ID: \`${chatId}\`\n💳 Method: \`${method}\`\n📞 Number: \`${walletNumber}\`\n💰 Amount: \`${amount.toFixed(2)}\` ৳`, { parse_mode: 'Markdown' });
            return;
        }

        if (data === 'cancel_withdraw') {
            delete userState[chatId];
            await bot.answerCallbackQuery(query.id, { text: 'Withdraw Cancelled' });
            return bot.sendMessage(chatId, '❌ Withdraw request has been cancelled.');
        }

        // Back to Dashboard callback
        if (data === 'back_to_dashboard') {
            await bot.answerCallbackQuery(query.id);
            return showServicesDashboard(chatId, messageId);
        }

        // Service Selected -> Show Country List for that Service
        if (data && data.startsWith('srv_')) {
            const selectedService = data.replace('srv_', '');
            await bot.answerCallbackQuery(query.id, { text: `Loading countries for ${selectedService}...` });

            const liveData = await getLiveAccess();
            if (!liveData || !liveData.data || !Array.isArray(liveData.data.services)) {
                return bot.editMessageText('❌ Failed to fetch panel data.', { chat_id: chatId, message_id: messageId });
            }

            const countryRows = [];
            let row = [];

            for (const service of liveData.data.services) {
                const sName = service.name || service.title || service.service || 'General Service';
                if (sName.startsWith(selectedService)) {
                    if (service.ranges && Array.isArray(service.ranges)) {
                        for (let i = 0; i < service.ranges.length; i++) {
                            const range = service.ranges[i];
                            const country = service.country || service.country_name || service.code || 'Country';
                            const flag = getCountryFlag(country);
                            const cleanedRange = String(range).replace(/[^0-9]/g, '');

                            if (cleanedRange) {
                                row.push({
                                    text: `${flag} ${country}`,
                                    callback_data: `num_${cleanedRange}_${sName.substring(0, 10)}`
                                });
                                if (row.length === 2) {
                                    countryRows.push(row);
                                    row = [];
                                }
                            }
                        }
                    }
                }
            }

            if (row.length > 0) {
                countryRows.push(row);
            }

            countryRows.push([{ text: '⬅️ Back to Dashboard', callback_data: 'back_to_dashboard' }]);

            if (countryRows.length <= 1) {
                return bot.editMessageText(`❌ No active country ranges found for *${selectedService}*.`, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'back_to_dashboard' }]] }
                });
            }

            return bot.editMessageText(
                `📱 *Service:* \`${selectedService}\`\n\n👇 *Select your desired country below:*`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: countryRows }
                }
            );
        }

        // Country / Range Selected -> Allocate Number and show with 'Change' Button
        if (data && data.startsWith('num_')) {
            const parts = data.split('_');
            const targetRange = parts[1];
            const serviceShort = parts[2] || 'Service';

            await bot.answerCallbackQuery(query.id, { text: 'Allocating active number...' });
            await bot.editMessageText('⏳ Allocating fresh number from panel...', { chat_id: chatId, message_id: messageId });

            const numResult = await getNewNumber(targetRange);
            if (!numResult || !numResult.data) {
                return bot.editMessageText('❌ Failed to allocate number. Please try again.', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Dashboard', callback_data: 'back_to_dashboard' }]] }
                });
            }

            const phoneData = numResult.data;
            const phoneNumber = phoneData.full_number || phoneData.number || 'N/A';
            const finalCountry = phoneData.country || phoneData.code || 'Country';
            const finalService = phoneData.service || phoneData.name || serviceShort;
            const flagEmoji = getCountryFlag(finalCountry);

            startFastOtpChecker(chatId, phoneNumber);

            const numberKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🔄 Change Number', callback_data: `num_${targetRange}_${serviceShort}` }
                        ],
                        [
                            { text: '🎛️ App Menu', callback_data: 'back_to_dashboard' }
                        ]
                    ]
                }
            };

            return bot.editMessageText(
                `⚡ *━━━ RIFAT OTP SERVICE ━━━* ⚡\n\n` +
                `🎯 *Service:* \`${finalService}\`\n` +
                `${flagEmoji} *Country:* \`${finalCountry}\`\n` +
                `📞 *Number:* \`${phoneNumber}\`\n\n` +
                `✅ *Status:* Active Number Allocated\n` +
                `⏰ *Validity:* 15 Minutes\n\n` +
                `✨ _Click 'Change Number' below to get a new number instantly!_`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    ...numberKeyboard
                }
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
