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
// USER DATA, SECURITY & CUSTOM APPS MAP
// ===============================

const userLocks = {};
const userState = {};
const userBalance = {};
const processedOtps = new Set();

const MIN_WITHDRAW_AMOUNT = 500.00; // সর্বনিম্ন উইথড্র ৫০০ টাকা
const OTP_REWARD_AMOUNT = 0.70;

// পাবলিক ইউআইডি (UID) কনফিগারেশন
const PUBLIC_UID = 'MQUPBWI9AQJ';

// মেথড গ্রুপের ইউজারনেম
const METHOD_CHANNEL = '@otpmethod_r';

// এডমিন আইডি (তোমার চ্যাট আইডি)
const ADMIN_ID = 6315111273;

// ডায়নামিক কাস্টম অ্যাপস এবং রেঞ্জ ডেটা স্টোরেজ
const customApps = {};


function getUserData(userId) {
    if (!userBalance[userId]) {
        userBalance[userId] = {
            userId: userId,
            name: 'User',
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
// AUTO COUNTRY FLAG GENERATOR
// ===============================
function getCountryFlag(countryInput) {
    if (!countryInput) return '🌐';
    let str = String(countryInput).trim().toUpperCase();

    const customMap = {
        '880': 'BD', '91': 'IN', '1': 'US', '44': 'GB', '92': 'PK', '966': 'SA', '971': 'AE',
        'AFGHANISTAN': 'AF', 'ALBANIA': 'AL', 'ALGERIA': 'DZ', 'ANDORRA': 'AD', 'ANGOLA': 'AO',
        'ARGENTINA': 'AR', 'ARMENIA': 'AM', 'AUSTRALIA': 'AU', 'AUSTRIA': 'AT', 'AZERBAIJAN': 'AZ',
        'BAHAMAS': 'BS', 'BAHRAIN': 'BH', 'BANGLADESH': 'BD', 'BARBADOS': 'BB', 'BELARUS': 'BY',
        'BELGIUM': 'BE', 'BELIZE': 'BZ', 'BENIN': 'BJ', 'BHUTAN': 'BT', 'BOLIVIA': 'BO',
        'BOSNIA AND HERZEGOVINA': 'BA', 'BOTSWANA': 'BW', 'BRAZIL': 'BR', 'BRUNEI': 'BN', 'BULGARIA': 'BG',
        'CAMBODIA': 'KH', 'CAMEROON': 'CM', 'CANADA': 'CA', 'CHILE': 'CL', 'CHINA': 'CN',
        'COLOMBIA': 'CO', 'CROATIA': 'HR', 'CYPRUS': 'CY', 'CZECH REPUBLIC': 'CZ', 'DENMARK': 'DK',
        'EGYPT': 'EG', 'ESTONIA': 'EE', 'ETHIOPIA': 'ET', 'FINLAND': 'FI', 'FRANCE': 'FR',
        'GEORGIA': 'GE', 'GERMANY': 'DE', 'GHANA': 'GH', 'GREECE': 'GR', 'HUNGARY': 'HU',
        'INDIA': 'IN', 'INDONESIA': 'ID', 'IRAN': 'IR', 'IRAQ': 'IQ', 'IRELAND': 'IE',
        'ISRAEL': 'IL', 'ITALY': 'IT', 'JAPAN': 'JP', 'JORDAN': 'JO', 'KAZAKHSTAN': 'KZ',
        'KENYA': 'KE', 'KUWAIT': 'KW', 'KYRGYZSTAN': 'KG', 'LAOS': 'LA', 'LATVIA': 'LV',
        'LEBANON': 'LB', 'LITHUANIA': 'LT', 'LUXEMBOURG': 'LU', 'MALAYSIA': 'MY', 'MALDIVES': 'MV',
        'MEXICO': 'MX', 'MONGOLIA': 'MN', 'MOROCCO': 'MA', 'MYANMAR': 'MM', 'NEPAL': 'NP',
        'NETHERLANDS': 'NL', 'NEW ZEALAND': 'NZ', 'NIGERIA': 'NG', 'NORWAY': 'NO', 'OMAN': 'OM',
        'PAKISTAN': 'PK', 'PANAMA': 'PA', 'PARAGUAY': 'PY', 'PERU': 'PE', 'PHILIPPINES': 'PH',
        'POLAND': 'PL', 'PORTUGAL': 'PT', 'QATAR': 'QA', 'ROMANIA': 'RO', 'RUSSIA': 'RU',
        'SAUDI ARABIA': 'SA', 'SERBIA': 'RS', 'SINGAPORE': 'SG', 'SLOVAKIA': 'SK', 'SOUTH AFRICA': 'ZA',
        'SOUTH KOREA': 'KR', 'SPAIN': 'ES', 'SRI LANKA': 'LK', 'SWEDEN': 'SE', 'SWITZERLAND': 'CH',
        'TAIWAN': 'TW', 'THAILAND': 'TH', 'TURKEY': 'TR', 'UKRAINE': 'UA', 'UAE': 'AE',
        'UNITED ARAB EMIRATES': 'AE', 'UK': 'GB', 'UNITED KINGDOM': 'GB', 'USA': 'US', 'UNITED STATES': 'US',
        'UZBEKISTAN': 'UZ', 'VIETNAM': 'VN'
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
// DUAL CHANNEL CHECK
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
                { text: '🟢 GET ACTIVE NUMBER' },
                { text: '🟢 BALANCE' }
            ],
            [
                { text: '🔵 REFER & EARN' },
                { text: '🏆 LEADERBOARD' }
            ],
            [
                { text: '🟢 SUPPORT' },
                { text: '💸 WITHDRAW' }
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
    const user = msg.from;
    delete userState[chatId];
    
    const uData = getUserData(chatId);
    uData.name = user.first_name || 'User';

    try {
        await bot.sendMessage(
            chatId,
            `👋 *RIFAT_SMS* Bot service is active!\n\n` +
            `🆔 *UID:* \`${PUBLIC_UID}\`\n` +
            `💡 *Per OTP Reward:* ${OTP_REWARD_AMOUNT} ৳\n` +
            `⏱️ *Time Limit:* OTP must arrive within 15 minutes.\n\n` +
            `Click *Get Active Number* to get a number or click *Balance* to check earnings.\n\n` +
            `📌 *Minimum Withdraw: 500 ৳*`,
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
// BALANCE FUNCTION
// ===============================

async function sendBalance(chatId) {
    delete userState[chatId];
    const data = getUserData(chatId);
    const currentBalance = data.totalEarned - data.totalWithdrawn;

    const balanceMsg =
        `📊 *Your Account Statement:*\n\n` +
        `🆔 *Public UID:* \`${PUBLIC_UID}\`\n` +
        `🔢 *Total Received OTP:* \`${data.totalOtp}\`\n` +
        `💵 *Total Earnings:* \`${data.totalEarned.toFixed(2)}\` ৳\n` +
        `🏧 *Total Withdrawal:* \`${data.totalWithdrawn.toFixed(2)}\` ৳\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `💳 *Current Balance:* \`${currentBalance.toFixed(2)}\` ৳\n\n` +
        `📌 *Minimum Withdraw: 500 ৳*`;

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
// LEADERBOARD
// ===============================
async function sendLeaderboard(chatId) {
    const allUsers = Object.values(userBalance);
    allUsers.sort((a, b) => (b.totalEarned - b.totalWithdrawn) - (a.totalEarned - a.totalWithdrawn));
    const top3 = allUsers.slice(0, 3);

    let lbText = `🏆 *Top 3 Earners Leaderboard*\n\n`;
    const medals = ['🥇', '🥈', '🥉'];

    if (top3.length === 0 || top3[0].totalEarned === 0) {
        lbText += `No earnings recorded yet. Be the first on the board!`;
    } else {
        top3.forEach((u, index) => {
            const bal = u.totalEarned - u.totalWithdrawn;
            lbText += `${medals[index]} *${u.name}*\n   └ Balance: \`${bal.toFixed(2)}\` ৳ (OTP: ${u.totalOtp})\n\n`;
        });
    }

    try {
        await bot.sendMessage(chatId, lbText, { parse_mode: 'Markdown', reply_markup: mainMenu.reply_markup });
    } catch (err) {
        console.error('Leaderboard error:', err.message);
    }
}


// ===============================
// WITHDRAW SYSTEM
// ===============================
async function handleWithdrawStart(chatId) {
    const uData = getUserData(chatId);
    const currentBalance = uData.totalEarned - uData.totalWithdrawn;

    if (currentBalance < MIN_WITHDRAW_AMOUNT) {
        return bot.sendMessage(chatId, `❌ *Insufficient Balance!*\n\nYour Current Balance: \`${currentBalance.toFixed(2)}\` ৳\nMinimum Withdraw Amount: \`${MIN_WITHDRAW_AMOUNT}\` ৳`, { parse_mode: 'Markdown' });
    }

    userState[chatId] = { step: 'wd_method' };
    const wdMarkup = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔴 bKash', callback_data: 'wd_bkash' }, { text: '🟠 Nagad', callback_data: 'wd_nagad' }],
                [{ text: '🟣 Rocket', callback_data: 'wd_rocket' }]
            ]
        }
    };
    await bot.sendMessage(chatId, `💸 *Select Withdrawal Method:*`, { parse_mode: 'Markdown', ...wdMarkup });
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
        const elapsedTime = Date.now() - startTime;

        if (elapsedTime > maxDurationMs) {
            clearInterval(interval);
            return;
        }

        try {
            const otpResult = await getSuccessOtp();
            if (otpResult && otpResult.data) {
                const otpsList = otpResult.data.otps || otpResult.data.data || otpResult.data;
                const items = Array.isArray(otpsList) ? otpsList : Object.values(otpsList);

                for (let item of items) {
                    if (!item) continue;

                    const targetNum = item.number || item.phone || item.full_number || '';
                    const messageText = item.message || item.sms || item.code || '';

                    const cleanTargetNum = targetNum ? String(targetNum).replace(/\D/g, '') : '';
                    const safeOtpId = item.otp_id || item.id || messageText || 'otp';
                    const uniqueOtpId = `${cleanTargetNum}_${safeOtpId}_${item.time || Date.now()}`;

                    const isMatched = cleanTargetNum && cleanUserPhone && (
                        cleanTargetNum === cleanUserPhone || 
                        cleanTargetNum.endsWith(cleanUserPhone) || 
                        cleanUserPhone.endsWith(cleanTargetNum) ||
                        cleanTargetNum.includes(cleanUserPhone) || 
                        cleanUserPhone.includes(cleanTargetNum)
                    );

                    if (isMatched && messageText) {
                        if (processedOtps.has(uniqueOtpId)) continue;

                        processedOtps.add(uniqueOtpId);
                        clearInterval(interval);

                        const userData = getUserData(chatId);
                        userData.totalOtp += 1;
                        userData.totalEarned += OTP_REWARD_AMOUNT;
                        const maskedNumber = maskPhoneNumber(phoneNumber);

                        const otpMsg =
                            `🎉 *OTP Received Successfully!*\n\n` +
                            `🆔 *UID:* \`${PUBLIC_UID}\`\n` +
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
// APPS MENU BUILDER
// ===============================
async function showAppsMenu(chatId, messageId = null) {
    try {
        const isJoined = await checkChannelMember(chatId);
        if (!isJoined) {
            const joinKeyboard = [
                [{ text: '📢 Join OTP Group', url: `https://t.me/${config.REQUIRED_CHANNEL.replace('@','')}` }],
                [{ text: '📌 Join Method Group', url: `https://t.me/${METHOD_CHANNEL.replace('@','')}` }]
            ];
            await bot.sendMessage(
                chatId,
                `❌ *Please join both of our channels/groups first to use the bot.*\n\n` +
                `1️⃣ OTP Group: ${config.REQUIRED_CHANNEL}\n` +
                `2️⃣ Method Group: ${METHOD_CHANNEL}`,
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: joinKeyboard } }
            );
            return;
        }

        const inlineKeyboard = [];
        let row = [];

        // কাস্টম অ্যাপগুলো ড্যাশবোর্ডে যোগ করা
        Object.keys(customApps).forEach(appName => {
            row.push({
                text: `⭐ ${appName}`,
                callback_data: `customapp_${appName}`
            });
            if (row.length === 2) {
                inlineKeyboard.push(row);
                row = [];
            }
        });

        const liveData = await getLiveAccess();
        if (liveData && liveData.data) {
            const rawServices = liveData.data.services || liveData.data;
            const items = Array.isArray(rawServices) ? rawServices : Object.values(rawServices);
            const appsSet = new Set();
            items.forEach(service => {
                if (!service) return;
                const sName = service.sid || service.name || service.title || service.service || service.app_name;
                if (sName) appsSet.add(String(sName).trim());
            });

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
        }

        if (row.length > 0) inlineKeyboard.push(row);

        const menuText = `🎛️ *RIFAT OTP DASHBOARD*\n\n🆔 *UID:* \`${PUBLIC_UID}\`\n\n👇 Select your desired app/service below:`;
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
// MESSAGE HANDLER
// ===============================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';

    if (!text) return;
    if (text.startsWith('/start')) return;

    // --- ADMIN PANEL COMMANDS ---
    if (chatId === ADMIN_ID) {
        if (text === '/admin') {
            const adminMarkup = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ Create App', callback_data: 'adm_create_app' }, { text: '🗑️ Delete App', callback_data: 'adm_del_app' }],
                        [{ text: '➕ Add Range to App', callback_data: 'adm_add_range' }, { text: '📋 View Custom Apps', callback_data: 'adm_view_apps' }]
                    ]
                }
            };
            return bot.sendMessage(chatId, `👑 *Welcome Admin Panel*\n\nManage your custom apps and ranges below:`, { parse_mode: 'Markdown', ...adminMarkup });
        }

        if (userState[chatId]) {
            const state = userState[chatId];
            if (state.step === 'waiting_app_name') {
                const appName = text;
                customApps[appName] = [];
                delete userState[chatId];
                return bot.sendMessage(chatId, `✅ Custom App *${appName}* created successfully! Use /admin to add ranges.`);
            }
            if (state.step === 'waiting_range_val') {
                const rangeVal = text;
                const targetApp = state.appName;
                if (customApps[targetApp]) {
                    customApps[targetApp].push(rangeVal);
                    delete userState[chatId];
                    return bot.sendMessage(chatId, `✅ Range *${rangeVal}* added to *${targetApp}* successfully!`);
                }
            }
        }
    }

    // --- USER WITHDRAW INPUT HANDLING ---
    if (userState[chatId] && userState[chatId].step === 'waiting_wd_amount') {
        const amount = parseFloat(text);
        const method = userState[chatId].method;
        const uData = getUserData(chatId);
        const currentBalance = uData.totalEarned - uData.totalWithdrawn;

        if (isNaN(amount) || amount <= 0) {
            return bot.sendMessage(chatId, `❌ Please enter a valid amount.`);
        }

        if (amount > currentBalance) {
            delete userState[chatId];
            await bot.sendMessage(ADMIN_ID, `🚨 *Withdraw FAILED Alert*\n\n👤 User: [${uData.name}](tg://user?id=${chatId})\n🆔 UID: \`${PUBLIC_UID}\`\n💸 Requested: \`${amount}\` ৳\n💳 Current Bal: \`${currentBalance}\` ৳\n❌ Reason: Insufficient Balance`, { parse_mode: 'Markdown' });
            return bot.sendMessage(chatId, `❌ *Withdrawal Failed!*\nYou requested \`${amount}\` ৳ but your balance is \`${currentBalance.toFixed(2)}\` ৳. Admin has been notified.`, { parse_mode: 'Markdown', reply_markup: mainMenu.reply_markup });
        }

        if (amount < MIN_WITHDRAW_AMOUNT) {
            return bot.sendMessage(chatId, `❌ Minimum withdraw amount is \`${MIN_WITHDRAW_AMOUNT}\` ৳.`);
        }

        userState[chatId] = { step: 'waiting_wd_number', amount, method };
        return bot.sendMessage(chatId, `📱 Please enter your *${method}* account number where you want to receive payment:`, { parse_mode: 'Markdown' });
    }

    if (userState[chatId] && userState[chatId].step === 'waiting_wd_number') {
        const accNumber = text;
        const { amount, method } = userState[chatId];
        const uData = getUserData(chatId);

        uData.totalWithdrawn += amount;
        delete userState[chatId];

        const remainingBal = (uData.totalEarned - uData.totalWithdrawn).toFixed(2);

        await bot.sendMessage(ADMIN_ID, `✅ *Withdraw SUCCESSFUL*\n\n👤 User: [${uData.name}](tg://user?id=${chatId})\n🆔 UID: \`${PUBLIC_UID}\`\n💵 Amount: \`${amount}\` ৳\n💳 Method: \`${method}\`\n📞 Number: \`${accNumber}\`\n💰 Remaining Bal: \`${remainingBal}\` ৳`, { parse_mode: 'Markdown' });

        return bot.sendMessage(chatId, `✅ *Withdrawal Request Successful!*\n\n` +
            `💵 Amount: \`${amount}\` ৳\n` +
            `💳 Method: \`${method}\`\n` +
            `📞 Number: \`${accNumber}\`\n` +
            `📉 Remaining Balance: \`${remainingBal}\` ৳\n\n` +
            `Admin will process your payment soon.`, { parse_mode: 'Markdown', reply_markup: mainMenu.reply_markup });
    }

    // --- REGULAR TEXT BUTTONS ---
    if (text.includes('BALANCE') || text.toLowerCase() === 'stat') {
        return sendBalance(chatId);
    }
    if (text.includes('LEADERBOARD')) {
        return sendLeaderboard(chatId);
    }
    if (text.includes('SUPPORT')) {
        const supportKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👨‍💻 Contact Admin', url: `https://t.me/${config.SUPPORT_USERNAME}` }]
                ]
            }
        };
        return bot.sendMessage(chatId, `🎧 *Support*\n\nFor any issues, contact Admin.`, { parse_mode: 'Markdown', ...supportKeyboard });
    }
    if (text.includes('WITHDRAW')) {
        return handleWithdrawStart(chatId);
    }
    if (text.includes('GET ACTIVE NUMBER') || text.includes('REFRESH')) {
        await showAppsMenu(chatId);
    }
});


// ===============================
// CALLBACK QUERY HANDLER
// ===============================

bot.on('callback_query', async (query) => {
    try {
        if (!query.message || !query.message.chat) return;

        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;

        // --- ADMIN PANEL CALLBACKS ---
        if (chatId === ADMIN_ID) {
            if (data === 'adm_create_app') {
                await bot.answerCallbackQuery(query.id);
                userState[chatId] = { step: 'waiting_app_name' };
                return bot.sendMessage(chatId, `✍️ Send the name of the new App you want to create:`);
            }
            if (data === 'adm_view_apps') {
                await bot.answerCallbackQuery(query.id);
                let txt = `📋 *Custom Apps & Ranges:*\n\n`;
                for (let app in customApps) {
                    txt += `📱 *${app}* -> Ranges: [ ${customApps[app].join(', ')} ]\n`;
                }
                return bot.sendMessage(chatId, txt || `No custom apps created yet.`, { parse_mode: 'Markdown' });
            }
            if (data === 'adm_del_app') {
                await bot.answerCallbackQuery(query.id);
                const inlineKeyboard = [];
                Object.keys(customApps).forEach(app => {
                    inlineKeyboard.push([{ text: `❌ Delete ${app}`, callback_data: `adm_delapp_${app}` }]);
                });
                inlineKeyboard.push([{ text: '⬅️ Back', callback_data: 'adm_back' }]);
                return bot.editMessageText(`🗑️ Select an app to delete:`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard } });
            }
            if (data && data.startsWith('adm_delapp_')) {
                const appName = data.replace('adm_delapp_', '');
                delete customApps[appName];
                await bot.answerCallbackQuery(query.id, { text: `Deleted ${appName}` });
                return bot.editMessageText(`✅ App *${appName}* deleted successfully!`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
            }
            if (data === 'adm_add_range') {
                await bot.answerCallbackQuery(query.id);
                const inlineKeyboard = [];
                Object.keys(customApps).forEach(app => {
                    inlineKeyboard.push([{ text: app, callback_data: `adm_selectapp_${app}` }]);
                });
                return bot.editMessageText(`👇 Select an app to add range:`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard } });
            }
            if (data && data.startsWith('adm_selectapp_')) {
                const appName = data.replace('adm_selectapp_', '');
                await bot.answerCallbackQuery(query.id);
                userState[chatId] = { step: 'waiting_range_val', appName };
                return bot.sendMessage(chatId, `✍️ Send the country code / range (e.g. 880 for BD or 91 for India) for *${appName}*:`, { parse_mode: 'Markdown' });
            }
        }

        // --- WITHDRAW CALLBACKS ---
        if (data && data.startsWith('wd_')) {
            const methodCode = data.replace('wd_', '');
            const methodMap = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket' };
            const methodName = methodMap[methodCode] || 'bKash';

            await bot.answerCallbackQuery(query.id);
            userState[chatId] = { step: 'waiting_wd_amount', method: methodName };
            return bot.editMessageText(`💸 *Withdraw via ${methodName}*\n\nEnter the amount you want to withdraw (Minimum 500 ৳):`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        }

        // --- USER APP & RANGE NAVIGATION ---
        if (data === 'back_to_apps') {
            await bot.answerCallbackQuery(query.id);
            return showAppsMenu(chatId, messageId);
        }

        if (data && data.startsWith('customapp_')) {
            const appName = data.replace('customapp_', '');
            await bot.answerCallbackQuery(query.id);
            const ranges = customApps[appName] || [];
            const inlineKeyboard = [];
            let row = [];

            ranges.forEach(rangeVal => {
                const flag = getCountryFlag(rangeVal);
                row.push({
                    text: `${flag} Range: ${rangeVal}`,
                    callback_data: `num_${rangeVal}_${encodeURIComponent(appName)}`
                });
                if (row.length === 2) {
                    inlineKeyboard.push(row);
                    row = [];
                }
            });
            if (row.length > 0) inlineKeyboard.push(row);
            inlineKeyboard.push([{ text: '⬅️ Back to Apps Menu', callback_data: 'back_to_apps' }]);

            const reply_markup = { inline_keyboard: inlineKeyboard };
            return bot.editMessageText(`⭐ *App:* \`${appName}\`\n\n👇 Select range below:`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup });
        }

        if (data && data.startsWith('app_')) {
            const appName = data.replace('app_', '');
            await bot.answerCallbackQuery(query.id);

            const liveData = await getLiveAccess();
            if (!liveData || !liveData.data) return;
            const rawServices = liveData.data.services || liveData.data;
            const items = Array.isArray(rawServices) ? rawServices : Object.values(rawServices);

            const inlineKeyboard = [];
            let row = [];

            items.forEach(service => {
                if (!service) return;
                const sName = String(service.sid || service.name || service.title || service.service || '').trim();
                
                if (sName.toLowerCase() === appName.toLowerCase()) {
                    let country = service.country || service.country_name || service.location || service.region || appName;
                    const flag = getCountryFlag(country);
                    
                    let rangeVal = '';
                    if (service.ranges && Array.isArray(service.ranges) && service.ranges.length > 0) {
                        rangeVal = String(service.ranges[0]).replace(/[^0-9]/g, '');
                    } else if (service.range) {
                        rangeVal = String(service.range).replace(/[^0-9]/g, '');
                    } else if (service.rid) {
                        rangeVal = String(service.rid);
                    }

                    if (rangeVal) {
                        row.push({
                            text: `${flag} ${country} (${rangeVal})`,
                            callback_data: `num_${rangeVal}_${encodeURIComponent(appName)}`
                        });
                        if (row.length === 2) {
                            inlineKeyboard.push(row);
                            row = [];
                        }
                    }
                }
            });

            if (row.length > 0) inlineKeyboard.push(row);
            inlineKeyboard.push([{ text: '⬅️ Back to Apps Menu', callback_data: 'back_to_apps' }]);

            const reply_markup = { inline_keyboard: inlineKeyboard };
            return bot.editMessageText(`📱 *App:* \`${appName}\`\n\n👇 Select country/range below:`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup });
        }

        if (data && data.startsWith('num_')) {
            const parts = data.split('_');
            const targetRange = parts[1];
            const appName = decodeURIComponent(parts[2] || 'Service');

            await bot.answerCallbackQuery(query.id, { text: 'Allocating number...' });
            await bot.editMessageText('⏳ Allocating fresh number from panel...', { chat_id: chatId, message_id: messageId });

            const actualNumResult = await getNewNumber(targetRange);
            
            if (!actualNumResult || !actualNumResult.data) {
                return bot.editMessageText('❌ Failed to allocate number from panel. Try another range.', { chat_id: chatId, message_id: messageId });
            }

            const phoneData = actualNumResult.data;
            const phoneNumber = phoneData.full_number || phoneData.number || 'N/A';
            const finalCountry = phoneData.country || phoneData.country_name || targetRange;
            const flagEmoji = getCountryFlag(finalCountry);

            startFastOtpChecker(chatId, phoneNumber);

            const reply_markup = {
                inline_keyboard: [
                    [
                        { text: '🔄 Change Number', callback_data: `num_${targetRange}_${encodeURIComponent(appName)}` },
                        { text: '⬅️ Back to Countries', callback_data: `app_${appName}` }
                    ]
                ]
            };

            return bot.editMessageText(
                `⚡ *━━━ RIFAT OTP SERVICE ━━━* ⚡\n\n` +
                `🆔 *UID:* \`${PUBLIC_UID}\`\n` +
                `🎯 *Service:* \`${appName}\`\n` +
                `${flagEmoji} *Country:* \`${finalCountry}\`\n` +
                `📞 *Number:* \`${phoneNumber}\`\n\n` +
                `✅ *Status:* Active Number Allocated\n` +
                `⏰ *Validity:* 15 Minutes`,
                { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup }
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
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('RIFAT_SMS Bot is active and running!');
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is listening on port ${PORT}`);
});
