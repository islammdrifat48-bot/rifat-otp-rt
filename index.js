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

const MIN_WITHDRAW_AMOUNT = 500.00; // সর্বনিম্ন উইথড্র ৫০০ টাকা
const OTP_REWARD_AMOUNT = 0.70;

const PUBLIC_UID = 'MQUPBWI9AQJ';
const METHOD_CHANNEL = '@otpmethod_r';
const ADMIN_IDS = ['6315111273'];

// কাস্টম অ্যাপ ও রেঞ্জ স্টোরেজ structure: { appName, ranges: [{ countryName, flag, range }] }
let customAppsData = {};


function getUserData(userId, userName = 'User') {
    if (!userBalance[userId]) {
        userBalance[userId] = {
            name: userName,
            totalOtp: 0,
            totalEarned: 0,
            totalWithdrawn: 0
        };
    } else {
        if (userName && userName !== 'User') {
            userBalance[userId].name = userName;
        }
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
            ],
            [
                { text: '👑 ADMIN PANEL' }
            ]
        ],
        resize_keyboard: true
    }
};


// ===============================
// /START & /ADMIN
// ===============================

bot.onText(/^\/start(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name || 'User';
    delete userState[chatId];
    getUserData(chatId, userName);

    try {
        await bot.sendMessage(
            chatId,
            `👋 *RIFAT_SMS* Bot service is active!\n\n` +
            `💡 *Per OTP Reward:* ${OTP_REWARD_AMOUNT} ৳\n` +
            `⏱️ *Time Limit:* OTP must arrive within 15 minutes.\n\n` +
            `Click *Get Active Number* to get a number or click *Balance* to check earnings.\n\n` +
            `📌 *Minimum Withdraw: ${MIN_WITHDRAW_AMOUNT} ৳*`,
            {
                parse_mode: 'Markdown',
                reply_markup: mainMenu.reply_markup
            }
        );
    } catch (error) {
        console.error('START SEND ERROR:', error.message);
    }
});

async function sendAdminPanel(chatId, messageId = null) {
    if (!ADMIN_IDS.includes(String(chatId))) {
        return bot.sendMessage(chatId, '❌ You are not authorized to use the admin panel.');
    }

    const adminKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '➕ Add New App', callback_data: 'admin_add_app' }],
                [{ text: '➕ Add Range to App (+)', callback_data: 'admin_manage_ranges' }],
                [{ text: '🗑️ Delete App / Range', callback_data: 'admin_delete_menu' }],
                [{ text: '📋 View Custom Apps', callback_data: 'admin_view_custom' }]
            ]
        }
    };

    const text = `⚙️ *ADMIN CONTROL PANEL*\n\nআপনার কাস্টম অ্যাপ ও রেঞ্জ ম্যানেজ করুন:`;
    if (messageId) {
        return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: adminKeyboard.reply_markup }).catch(() => {});
    }
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: adminKeyboard.reply_markup });
}

bot.onText(/^\/admin(?:@\w+)?$/, async (msg) => {
    await sendAdminPanel(msg.chat.id);
});


// ===============================
// BALANCE FUNCTION
// ===============================

async function sendBalance(chatId, userName = 'User') {
    delete userState[chatId];
    const data = getUserData(chatId, userName);
    const currentBalance = data.totalEarned - data.totalWithdrawn;

    const balanceMsg =
        `📊 *Your Account Statement:*\n\n` +
        `🔢 *Total Received OTP:* \`${data.totalOtp}\`\n` +
        `💵 *Total Earnings:* \`${data.totalEarned.toFixed(2)}\` ৳\n` +
        `🏧 *Total Withdrawal:* \`${data.totalWithdrawn.toFixed(2)}\` ৳\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `💳 *Current Balance:* \`${currentBalance.toFixed(2)}\` ৳\n\n` +
        `📌 *Minimum Withdraw: ${MIN_WITHDRAW_AMOUNT} ৳*`;

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
// LEADERBOARD FUNCTION
// ===============================

async function sendLeaderboard(chatId) {
    try {
        const usersArray = Object.values(userBalance);
        usersArray.sort((a, b) => b.totalOtp - a.totalOtp);
        const topUsers = usersArray.filter(u => u.totalOtp > 0).slice(0, 10);

        let lbText = `🏆 *TOP OTP EARNERS LEADERBOARD* 🏆\n\n`;

        if (topUsers.length === 0) {
            lbText += `📭 এখনও কেউ সফলভাবে কোনো ওটিপি রিসিভ করেনি!`;
        } else {
            topUsers.forEach((user, index) => {
                let medal = '🥉';
                if (index === 0) medal = '🥇';
                else if (index === 1) medal = '🥈';

                lbText += `${medal} *${user.name}* — 📦 *${user.totalOtp}* OTPs\n`;
            });
        }

        await bot.sendMessage(chatId, lbText, {
            parse_mode: 'Markdown',
            reply_markup: mainMenu.reply_markup
        });
    } catch (error) {
        console.error('Leaderboard error:', error.message);
    }
}


// ===============================
// SECURE SUCCESS OTP CHECKER (ORIGINAL & UNCHANGED)
// ===============================

async function startFastOtpChecker(chatId, phoneNumber, userName = 'User') {
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
                        if (processedOtps.has(uniqueOtpId)) {
                            continue;
                        }

                        processedOtps.add(uniqueOtpId);
                        clearInterval(interval);

                        const userData = getUserData(chatId, userName);
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
// STEP 1: APPS MENU BUILDER
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
        const rawServices = liveData?.data?.services || liveData?.data || [];
        const items = Array.isArray(rawServices) ? rawServices : Object.values(rawServices);

        const apiAppsSet = new Set();
        items.forEach(service => {
            if (!service) return;
            const sName = service.sid || service.name || service.title || service.service || service.app_name;
            if (sName) {
                apiAppsSet.add(String(sName).trim());
            }
        });

        const inlineKeyboard = [];
        let row = [];

        const appIcons = {
            'telegram': '✈️',
            'facebook': '🔵',
            'tiktok': '🎵',
            'whatsapp': '🟢',
            'imo': '💬',
            'discord': '🎮'
        };

        // ১. কাস্টম অ্যাপস সবার উপরে
        Object.keys(customAppsData).forEach(appName => {
            const cleanName = String(appName).trim();
            const icon = appIcons[cleanName.toLowerCase()] || '🚀';
            
            row.push({
                text: `${icon}${cleanName} ✅`,
                callback_data: `custom_app_${cleanName}`
            });

            if (row.length === 2) {
                inlineKeyboard.push(row);
                row = [];
            }
        });

        // ২. এপিআই অ্যাপস এর নিচে
        apiAppsSet.forEach(appName => {
            const cleanName = String(appName).trim();
            if (!customAppsData[cleanName]) {
                const icon = appIcons[cleanName.toLowerCase()] || '📱';

                row.push({
                    text: `${icon}${cleanName}`,
                    callback_data: `app_${cleanName}`
                });

                if (row.length === 2) {
                    inlineKeyboard.push(row);
                    row = [];
                }
            }
        });

        if (row.length > 0) {
            inlineKeyboard.push(row);
        }

        const menuText = `🎛️ *RIFAT OTP DASHBOARD*\n\n👇 Select your desired app/service below:`;
        const reply_markup = { inline_keyboard: inlineKeyboard };

        if (messageId) {
            return bot.editMessageText(menuText, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup }).catch(() => {});
        } else {
            return bot.sendMessage(chatId, menuText, { parse_mode: 'Markdown', reply_markup });
        }
    } catch (error) {
        console.error('ShowAppsMenu Error:', error);
        await bot.sendMessage(chatId, '❌ Failed to load services.');
    }
}


// ===============================
// STEP 2: SHOW COUNTRIES FOR API APP
// ===============================
async function showCountriesForApp(chatId, messageId, appName) {
    try {
        const inlineKeyboard = [];
        let row = [];

        const liveData = await getLiveAccess();
        if (liveData && liveData.data) {
            const rawServices = liveData.data.services || liveData.data;
            const items = Array.isArray(rawServices) ? rawServices : Object.values(rawServices);

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
        }

        if (row.length > 0) {
            inlineKeyboard.push(row);
        }

        inlineKeyboard.push([{ text: '⬅️ Back to Apps Menu', callback_data: 'back_to_apps' }]);

        const countryText = `📱 *App:* \`${appName}\`\n\n👇 Select your desired country/range below:`;
        const reply_markup = { inline_keyboard: inlineKeyboard };

        await bot.editMessageText(countryText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup
        }).catch(() => {});
    } catch (error) {
        console.error('ShowCountriesForApp Error:', error);
    }
}


// ===============================
// STEP 2.1: SHOW COUNTRIES FOR CUSTOM APP
// ===============================
async function showCustomAppCountries(chatId, messageId, appName) {
    try {
        const inlineKeyboard = [];
        let row = [];

        const appData = customAppsData[appName];
        if (appData && appData.ranges && appData.ranges.length > 0) {
            appData.ranges.forEach((item, index) => {
                row.push({
                    text: `${item.flag} ${item.countryName} (${item.range})`,
                    callback_data: `fetch_custom_num_${appName}_${index}`
                });

                if (row.length === 2) {
                    inlineKeyboard.push(row);
                    row = [];
                }
            });
        }

        if (row.length > 0) {
            inlineKeyboard.push(row);
        }

        inlineKeyboard.push([{ text: '⬅️ Back to Apps Menu', callback_data: 'back_to_apps' }]);

        const countryText = `🚀 *Custom App:* \`${appName}\`\n\n👇 Select your desired country/range below:`;
        const reply_markup = { inline_keyboard: inlineKeyboard };

        await bot.editMessageText(countryText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup
        }).catch(() => {});
    } catch (error) {
        console.error('ShowCustomAppCountries Error:', error);
    }
}


// ===============================
// MESSAGE HANDLER (TEXT & ADMIN & WITHDRAW)
// ===============================

bot.on('message', async (msg) => {
    const chatId = String(msg.chat.id);
    const userName = msg.from.first_name || 'User';
    const text = msg.text ? msg.text.trim() : '';

    if (!text) return;

    if (text.startsWith('/') || text.includes('GET ACTIVE NUMBER') || text.includes('BALANCE') || text.includes('LEADERBOARD') || text.includes('SUPPORT') || text.includes('WITHDRAW') || text.includes('ADMIN PANEL')) {
        delete userState[chatId];
    }

    // --- ADMIN PANEL INPUT STEPS ---
    if (ADMIN_IDS.includes(chatId)) {
        if (userState[chatId]?.step === 'waiting_for_new_app_name') {
            const appName = text;
            if (!customAppsData[appName]) {
                customAppsData[appName] = { ranges: [] };
            }
            delete userState[chatId];
            return bot.sendMessage(chatId, `✅ সফলভাবে কাস্টম অ্যাপ তৈরি হয়েছে: *${appName}*\n\nএখন অ্যাডমিন প্যানেল থেকে **➕ Add Range to App (+)** এ গিয়ে এই অ্যাপে যত খুশি রেঞ্জ যোগ করতে পারবেন।`, { parse_mode: 'Markdown' });
        }

        else if (userState[chatId]?.step === 'waiting_for_range_input') {
            const appName = userState[chatId].appName;
            const parts = text.split(',').map(p => p.trim());
            if (parts.length >= 3) {
                const countryName = parts[0];
                const flag = parts[1];
                const range = parts[2];

                if (!customAppsData[appName]) {
                    customAppsData[appName] = { ranges: [] };
                }

                customAppsData[appName].ranges.push({ countryName, flag, range });
                delete userState[chatId];
                return bot.sendMessage(chatId, `✅ সফলভাবে রেঞ্জ যোগ করা হয়েছে!\n\nApp: *${appName}*\nCountry: ${flag} *${countryName}*\nRange: \`${range}\``, { parse_mode: 'Markdown' });
            } else {
                return bot.sendMessage(chatId, `❌ সঠিক ফরম্যাটে দিন:\n\`কান্ট্রি_নাম, পতাকা_ইমোজি, রেঞ্জ\`\n\nউদাহরণ:\n\`Poland, 🇵🇱, 38091xxx\``, { parse_mode: 'Markdown' });
            }
        }
    }

    // --- WITHDRAW FLOW STEPS ---
    if (userState[chatId] && userState[chatId].step === 'waiting_for_withdraw_amount') {
        const amount = parseFloat(text);
        const userData = getUserData(chatId, userName);
        const currentBalance = userData.totalEarned - userData.totalWithdrawn;

        if (isNaN(amount) || amount <= 0) {
            return bot.sendMessage(chatId, `❌ দয়া করে সঠিক সংখ্যায় টাকার পরিমাণ লিখে পাঠান (যেমন: 500 বা 1000)।`);
        }

        if (amount < MIN_WITHDRAW_AMOUNT) {
            return bot.sendMessage(chatId, `❌ সর্বনিম্ন উইথড্র পরিমাণ হলো *${MIN_WITHDRAW_AMOUNT} ৳*।`, { parse_mode: 'Markdown' });
        }

        if (amount > currentBalance) {
            return bot.sendMessage(chatId, `❌ আপনার একাউন্টে পর্যাপ্ত ব্যালেন্স নেই!\nবর্তমান ব্যালেন্স: *${currentBalance.toFixed(2)} ৳*`, { parse_mode: 'Markdown' });
        }

        const method = userState[chatId].method;
        userState[chatId] = { step: 'waiting_for_withdraw_number', method: method, amount: amount };

        return bot.sendMessage(chatId, `💳 মাধ্যম: *${method}*\n💰 পরিমাণ: *${amount.toFixed(2)} ৳*\n\nআপনার ব্যক্তিগত **${method}** অ্যাকাউন্ট নম্বরটি লিখে পাঠান:`, { parse_mode: 'Markdown' });
    }

    if (userState[chatId] && userState[chatId].step === 'waiting_for_withdraw_number') {
        const method = userState[chatId].method;
        const amount = userState[chatId].amount;
        const targetNumber = text;
        delete userState[chatId];

        const userData = getUserData(chatId, userName);
        const currentBalance = userData.totalEarned - userData.totalWithdrawn;

        if (amount > currentBalance) {
            return bot.sendMessage(chatId, `❌ ব্যালেন্স পরিবর্তনের কারণে উইথড্র ব্যর্থ হয়েছে।`);
        }

        userData.totalWithdrawn += amount;
        const remainingBalance = (userData.totalEarned - userData.totalWithdrawn);

        const withdrawSlip = 
            `💸 *New Withdrawal Request!*\n\n` +
            `👤 *User:* ${userName} (\`${chatId}\`)\n` +
            `💳 *Method:* \`${method}\`\n` +
            `📞 *Account Number:* \`${targetNumber}\`\n` +
            `💰 *Withdraw Amount:* \`${amount.toFixed(2)}\` ৳\n` +
            `💳 *Remaining Balance:* \`${remainingBalance.toFixed(2)}\` ৳\n\n` +
            `✅ Status: Sent to Admin Successfully!`;

        await bot.sendMessage(chatId, `✅ আপনার উইথড্র রিকোয়েস্ট সফল হয়েছে!\n\n💳 পদ্ধতি: *${method}*\n📞 নম্বর: \`${targetNumber}\`\n💰 পরিমাণ: *${amount.toFixed(2)} ৳*\n💳 অবশিষ্ট ব্যালেন্স: *${remainingBalance.toFixed(2)} ৳*`, { parse_mode: 'Markdown', ...mainMenu });
        
        await bot.sendMessage(ADMIN_IDS[0], withdrawSlip, { parse_mode: 'Markdown' });
        return;
    }

    if (text.startsWith('/start') || text.startsWith('/admin') || text.startsWith('/stat')) return;

    if (text.includes('BALANCE') || text.toLowerCase() === 'stat') {
        return sendBalance(chatId, userName);
    }

    if (text.includes('LEADERBOARD')) {
        return sendLeaderboard(chatId);
    }

    if (text.includes('ADMIN PANEL')) {
        return sendAdminPanel(chatId);
    }

    if (text.includes('WITHDRAW')) {
        const userData = getUserData(chatId, userName);
        const currentBalance = userData.totalEarned - userData.totalWithdrawn;

        if (!ADMIN_IDS.includes(chatId) && currentBalance < MIN_WITHDRAW_AMOUNT) {
            return bot.sendMessage(chatId, `❌ পর্যাপ্ত ব্যালেন্স নেই! ন্যূনতম উইথড্র: *${MIN_WITHDRAW_AMOUNT} ৳*\nবর্তমান ব্যালেন্স: *${currentBalance.toFixed(2)} ৳*`, { parse_mode: 'Markdown' });
        }

        const withdrawKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔴 বিকাশ (Bkash)', callback_data: 'wd_bkash' },
                        { text: '🟠 নগদ (Nagad)', callback_data: 'wd_nagad' }
                    ],
                    [
                        { text: '🟣 রকেট (Rocket)', callback_data: 'wd_rocket' }
                    ]
                ]
            }
        };

        return bot.sendMessage(chatId, `🏧 *WITHDRAW SYSTEM*\n\nবর্তমান ব্যালেন্স: *${currentBalance.toFixed(2)} ৳*\nন্যূনতম উইথড্র: *${MIN_WITHDRAW_AMOUNT} ৳*\n\nপেমেন্ট মাধ্যম সিলেক্ট করুন:`, { parse_mode: 'Markdown', ...withdrawKeyboard });
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

        const chatId = String(query.message.chat.id);
        const userName = query.from.first_name || 'User';
        const messageId = query.message.message_id;
        const data = query.data;

        await bot.answerCallbackQuery(query.id).catch(() => {});

        // --- WITHDRAW CALLBACKS ---
        if (data.startsWith('wd_')) {
            const methodCode = data.replace('wd_', '');
            let methodName = '';
            if (methodCode === 'bkash') methodName = 'Bkash 🔴';
            if (methodCode === 'nagad') methodName = 'Nagad 🟠';
            if (methodCode === 'rocket') methodName = 'Rocket 🟣';

            const userData = getUserData(chatId, userName);
            const currentBalance = userData.totalEarned - userData.totalWithdrawn;

            userState[chatId] = { step: 'waiting_for_withdraw_amount', method: methodName };
            return bot.sendMessage(chatId, `💳 মাধ্যম: *${methodName}*\n\nবর্তমান ব্যালেন্স: *${currentBalance.toFixed(2)} ৳*\n\nকত টাকা উইথড্র করতে চান সেই পরিমাণ লিখে পাঠান (সর্বনিম্ন ${MIN_WITHDRAW_AMOUNT} ৳):`, { parse_mode: 'Markdown' });
        }

        // --- ADMIN PANEL CALLBACKS ---
        if (data === 'admin_add_app' && ADMIN_IDS.includes(chatId)) {
            userState[chatId] = { step: 'waiting_for_new_app_name' };
            return bot.sendMessage(chatId, `✍️ নতুন কাস্টম অ্যাপের নাম লিখে পাঠান:`, { parse_mode: 'Markdown' });
        }

        if (data === 'admin_manage_ranges' && ADMIN_IDS.includes(chatId)) {
            const appNames = Object.keys(customAppsData);
            if (appNames.length === 0) {
                return bot.sendMessage(chatId, `⚠️ প্রথমে একটি অ্যাপ তৈরি করুন।`);
            }
            let buttons = [];
            appNames.forEach(appName => {
                buttons.push([{ text: `➕ Add Range to ${appName}`, callback_data: `admin_select_app_${appName}` }]);
            });
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_back' }]);
            return bot.editMessageText(`📂 যে অ্যাপে রেঞ্জ যোগ করতে চান তা সিলেক্ট করুন:`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: buttons }
            }).catch(() => {});
        }

        if (data.startsWith('admin_select_app_') && ADMIN_IDS.includes(chatId)) {
            const appName = data.replace('admin_select_app_', '');
            userState[chatId] = { step: 'waiting_for_range_input', appName: appName };
            return bot.sendMessage(chatId, `✍️ **${appName}** এর জন্য নিচের ফরম্যাটে তথ্য পাঠান:\n\`কান্ট্রি_নাম, পতাকা_ইমোজি, রেঞ্জ\`\n\nউদাহরণ:\n\`Poland, 🇵🇱, 38091xxx\``, { parse_mode: 'Markdown' });
        }

        if (data === 'admin_delete_menu' && ADMIN_IDS.includes(chatId)) {
            const appNames = Object.keys(customAppsData);
            if (appNames.length === 0) {
                return bot.sendMessage(chatId, `⚠️ কোনো কাস্টম অ্যাপ নেই!`);
            }
            let buttons = [];
            appNames.forEach(appName => {
                buttons.push([
                    { text: `❌ Delete App: ${appName}`, callback_data: `del_app_${appName}` },
                    { text: `🗑️ Delete Range in ${appName}`, callback_data: `del_range_menu_${appName}` }
                ]);
            });
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_back' }]);
            return bot.editMessageText(`🗑️ *DELETE MANAGER*`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            }).catch(() => {});
        }

        if (data.startsWith('del_app_') && ADMIN_IDS.includes(chatId)) {
            const appName = data.replace('del_app_', '');
            if (customAppsData[appName]) {
                delete customAppsData[appName];
            }
            return bot.editMessageText(`✅ *${appName}* অ্যাপটি ডিলিট করা হয়েছে।`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_delete_menu' }]] }
            }).catch(() => {});
        }

        if (data.startsWith('del_range_menu_') && ADMIN_IDS.includes(chatId)) {
            const appName = data.replace('del_range_menu_', '');
            const appData = customAppsData[appName];

            if (!appData || !appData.ranges || appData.ranges.length === 0) {
                return bot.sendMessage(chatId, `⚠️ কোনো রেঞ্জ নেই!`);
            }

            let buttons = [];
            appData.ranges.forEach((r, index) => {
                buttons.push([{ text: `❌ ${r.flag} ${r.countryName} (${r.range})`, callback_data: `del_r_${appName}_${index}` }]);
            });
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_delete_menu' }]);

            return bot.editMessageText(`🗑️ *${appName}* এর রেঞ্জ সিলেক্ট করুন:`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: buttons }
            }).catch(() => {});
        }

        if (data.startsWith('del_r_') && ADMIN_IDS.includes(chatId)) {
            const parts = data.replace('del_r_', '').split('_');
            const appName = parts[0];
            const rangeIndex = parseInt(parts[1]);

            if (customAppsData[appName] && customAppsData[appName].ranges[rangeIndex]) {
                customAppsData[appName].ranges.splice(rangeIndex, 1);
            }

            return bot.editMessageText(`✅ রেঞ্জ সফলভাবে ডিলিট করা হয়েছে।`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_delete_menu' }]] }
            }).catch(() => {});
        }

        if (data === 'admin_view_custom' && ADMIN_IDS.includes(chatId)) {
            const appNames = Object.keys(customAppsData);
            if (appNames.length === 0) {
                return bot.sendMessage(chatId, `⚠️ কোনো কাস্টম অ্যাপ নেই।`);
            }
            let txt = `📋 *Your Custom Apps & Ranges:*\n\n`;
            appNames.forEach(appName => {
                txt += `🔹 *${appName}*:\n`;
                if (customAppsData[appName].ranges.length === 0) {
                    txt += `   (কোনো রেঞ্জ নেই)\n`;
                } else {
                    customAppsData[appName].ranges.forEach(r => {
                        txt += `   - ${r.flag} ${r.countryName} (\`${r.range}\`)\n`;
                    });
                }
            });
            return bot.editMessageText(txt, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_back' }]] }
            }).catch(() => {});
        }

        if (data === 'admin_back' && ADMIN_IDS.includes(chatId)) {
            return sendAdminPanel(chatId, messageId);
        }

        if (data === 'back_to_apps') {
            delete userState[chatId];
            return showAppsMenu(chatId, messageId);
        }

        if (data && data.startsWith('custom_app_')) {
            const appName = data.replace('custom_app_', '');
            return showCustomAppCountries(chatId, messageId, appName);
        }

        if (data && data.startsWith('fetch_custom_num_')) {
            const parts = data.replace('fetch_custom_num_', '').split('_');
            const appName = parts[0];
            const rangeIndex = parseInt(parts[1]);

            const item = customAppsData[appName] ? customAppsData[appName].ranges[rangeIndex] : null;

            if (!item) {
                return bot.answerCallbackQuery(query.id, { text: '⚠️ রেঞ্জ পাওয়া যায়নি!', show_alert: true }).catch(() => {});
            }

            await bot.editMessageText('⏳ Allocating fresh number from panel...', { chat_id: chatId, message_id: messageId }).catch(() => {});

            // রেঞ্জ থেকে শুধু নাম্বার/কোড অংশটুকু পরিষ্কার করে পাঠানো হচ্ছে (প্লাস বা অতিরিক্ত চিহ্ন বাদ দিয়ে)
            const cleanRange = String(item.range).replace(/[^0-9]/g, '');

            const actualNumResult = await getNewNumber(PUBLIC_UID, cleanRange).catch(() => null);
            
            if (!actualNumResult || !actualNumResult.data) {
                return bot.editMessageText('❌ Failed to allocate number from panel. Try another range.', { chat_id: chatId, message_id: messageId }).catch(() => {});
            }

            const phoneData = actualNumResult.data;
            const phoneNumber = phoneData.full_number || phoneData.number || 'N/A';

            startFastOtpChecker(chatId, phoneNumber, userName);

            const numberKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🔄 Change Number', callback_data: `fetch_custom_num_${appName}_${rangeIndex}` },
                            { text: '⬅️ Back to Countries', callback_data: `custom_app_${appName}` }
                        ]
                    ]
                }
            };

            return bot.editMessageText(
                `⚡ *━━━ RIFAT OTP SERVICE ━━━* ⚡\n\n` +
                `🎯 *Service:* \`${appName}\`\n` +
                `${item.flag} *Country:* \`${item.countryName}\`\n` +
                `📞 *Number:* \`${phoneNumber}\`\n\n` +
                `✅ *Status:* Active Number Allocated\n` +
                `⏰ *Validity:* 15 Minutes`,
                { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...numberKeyboard }
            ).catch(() => {});
        }

        if (data && data.startsWith('app_')) {
            const appName = data.replace('app_', '');
            return showCountriesForApp(chatId, messageId, appName);
        }

        if (data && data.startsWith('num_')) {
            const parts = data.split('_');
            const targetRange = parts[1];
            const appName = decodeURIComponent(parts[2] || 'Service');

            await bot.editMessageText('⏳ Allocating fresh number from panel...', { chat_id: chatId, message_id: messageId }).catch(() => {});

            const actualNumResult = await getNewNumber(PUBLIC_UID, targetRange).catch(() => null);
            
            if (!actualNumResult || !actualNumResult.data) {
                return bot.editMessageText('❌ Failed to allocate number from panel. Try another range.', { chat_id: chatId, message_id: messageId }).catch(() => {});
            }

            const phoneData = actualNumResult.data;
            const phoneNumber = phoneData.full_number || phoneData.number || 'N/A';
            const finalCountry = phoneData.country || phoneData.country_name || 'Global';
            const flagEmoji = getCountryFlag(finalCountry);

            startFastOtpChecker(chatId, phoneNumber, userName);

            const numberKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🔄 Change Number', callback_data: `num_${targetRange}_${encodeURIComponent(appName)}` },
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
            ).catch(() => {});
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
