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

// অ্যাডমিন আইডি এবং কনফিগারেশন
const ADMIN_ID = 6315111273;
const MIN_WITHDRAW_AMOUNT = 500.00; // ন্যূনতম উইথড্র ৫০০ টাকা
const OTP_REWARD_AMOUNT = 0.70;

// পাবলিক ইউআইডি (UID) কনফিগারেশন
const PUBLIC_UID = 'MQUPBWI9AQJ';

// মেথড গ্রুপের ইউজারনেম
const METHOD_CHANNEL = '@otpmethod_r';

// কাস্টম অ্যাপ ও রেঞ্জ সংরক্ষণের জন্য অবজেক্ট
let customApps = {};


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
// /START COMMAND
// ===============================

bot.onText(/^\/start(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    delete userState[chatId];
    getUserData(chatId);

    try {
        await bot.sendMessage(
            chatId,
            `👋 *RIFAT_SMS* Bot service is active!\n\n` +
            `🆔 *UID:* \`${PUBLIC_UID}\`\n` +
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
                        if (processedOtps.has(uniqueOtpId)) {
                            continue;
                        }

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
// STEP 1: APPS MENU BUILDER (API + CUSTOM APPS)
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
        const appsSet = new Set();

        // API থেকে অ্যাপ ফেচ করা
        if (liveData && liveData.data) {
            const rawServices = liveData.data.services || liveData.data;
            const items = Array.isArray(rawServices) ? rawServices : Object.values(rawServices);
            items.forEach(service => {
                if (!service) return;
                const sName = service.sid || service.name || service.title || service.service || service.app_name;
                if (sName) {
                    appsSet.add(String(sName).trim());
                }
            });
        }

        // অ্যাডমিন প্যানেল থেকে যুক্ত করা কাস্টম অ্যাপগুলো যোগ করা
        Object.keys(customApps).forEach(appName => {
            appsSet.add(appName);
        });

        if (appsSet.size === 0) {
            const errText = '❌ No active services available right now.';
            if (messageId) return bot.editMessageText(errText, { chat_id: chatId, message_id: messageId });
            return bot.sendMessage(chatId, errText);
        }

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

        appsSet.forEach(appName => {
            const cleanName = String(appName).trim();
            const icon = appIcons[cleanName.toLowerCase()] || '📱';

            row.push({
                text: `${icon}${cleanName}`,
                callback_data: `app_${cleanName}`
            });

            if (row.length === 2) {
                inlineKeyboard.push(row);
                row = [];
            }
        });

        if (row.length > 0) {
            inlineKeyboard.push(row);
        }

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
// STEP 2: SHOW COUNTRIES/RANGES FOR SELECTED APP
// ===============================
async function showCountriesForApp(chatId, messageId, appName) {
    try {
        const inlineKeyboard = [];
        let row = [];

        // যদি অ্যাপটি অ্যাডমিনের দেওয়া কাস্টম অ্যাপ হয়
        if (customApps[appName] && customApps[appName].length > 0) {
            customApps[appName].forEach(rangeVal => {
                row.push({
                    text: `🌐 Range (${rangeVal})`,
                    callback_data: `num_${rangeVal}_${encodeURIComponent(appName)}`
                });

                if (row.length === 2) {
                    inlineKeyboard.push(row);
                    row = [];
                }
            });
        }

        // API থেকে প্রাপ্ত সার্ভিসগুলোর রেঞ্জ চেক করা
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
        });
    } catch (error) {
        console.error('ShowCountriesForApp Error:', error);
    }
}


// ===============================
// MESSAGE & WITHDRAW HANDLER
// ===============================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';

    if (!text) return;
    if (text.startsWith('/start') || text.startsWith('/stat') || text.startsWith('/admin')) return;
    if (userLocks[chatId]) return;

    // --- ADMIN TEXT INPUTS ---
    if (chatId === ADMIN_ID && userState[chatId]) {
        if (userState[chatId].step === 'ADMIN_WAITING_APP_NAME') {
            const appName = text;
            if (!customApps[appName]) {
                customApps[appName] = [];
            }
            delete userState[chatId];
            return bot.sendMessage(chatId, `✅ অ্যাপ "${appName}" সফলভাবে যোগ করা হয়েছে! এখন রেঞ্জ যোগ করতে `/admin` কমান্ড দিন।`);
        }

        if (userState[chatId].step === 'ADMIN_WAITING_RANGE_DETAILS') {
            const parts = text.split(':');
            if (parts.length !== 2) {
                return bot.sendMessage(chatId, `❌ সঠিক ফরম্যাটে লিখুন। উদাহরণ: \`Telegram:12345\``, { parse_mode: 'Markdown' });
            }
            const appName = parts[0].trim();
            const rangeId = parts[1].trim();

            if (!customApps[appName]) {
                customApps[appName] = [];
            }
            customApps[appName].push(rangeId);
            delete userState[chatId];
            return bot.sendMessage(chatId, `✅ অ্যাপ "${appName}" এর জন্য রেঞ্জ "${rangeId}" সফলভাবে যোগ করা হয়েছে!`);
        }

        if (userState[chatId].step === 'ADMIN_WAITING_DELETE_RANGE') {
            const parts = text.split(':');
            if (parts.length !== 2) {
                return bot.sendMessage(chatId, `❌ সঠিক ফরম্যাটে লিখুন। উদাহরণ: \`Telegram:12345\``, { parse_mode: 'Markdown' });
            }
            const appName = parts[0].trim();
            const rangeId = parts[1].trim();

            if (customApps[appName]) {
                customApps[appName] = customApps[appName].filter(r => r !== rangeId);
                if (customApps[appName].length === 0) {
                    delete customApps[appName];
                }
                delete userState[chatId];
                return bot.sendMessage(chatId, `🗑️ অ্যাপ "${appName}" থেকে রেঞ্জ "${rangeId}" সফলভাবে ডিলিট করা হয়েছে!`);
            } else {
                delete userState[chatId];
                return bot.sendMessage(chatId, `❌ এই নামের কোনো অ্যাপ বা রেঞ্জ পাওয়া যায়নি।`);
            }
        }
    }

    // --- WITHDRAW SYSTEM ---
    if (text.includes('💸 WITHDRAW')) {
        const userData = getUserData(chatId);
        const currentBalance = userData.totalEarned - userData.totalWithdrawn;

        // ব্যালেন্স ৫০০ টাকার কম হলে (Failed Notification to Admin & User)
        if (currentBalance < MIN_WITHDRAW_AMOUNT) {
            await bot.sendMessage(
                ADMIN_ID,
                `❌ *Withdrawal Failed (Low Balance)*\n\n` +
                `👤 User ID: \`${chatId}\`\n` +
                `💰 Attempted Balance: \`${currentBalance.toFixed(2)}\` ৳\n` +
                `📌 Status: *Failed (Minimum ${MIN_WITHDRAW_AMOUNT} ৳ required)*`,
                { parse_mode: 'Markdown' }
            );

            return bot.sendMessage(
                chatId,
                `❌ *Withdrawal Failed!*\n\nআপনার বর্তমান ব্যালেন্স \`${currentBalance.toFixed(2)}\` ৳। সর্বনিম্ন উইথড্র পরিমাণ \`${MIN_WITHDRAW_AMOUNT}\` ৳।`,
                { parse_mode: 'Markdown' }
            );
        }

        userState[chatId] = { step: 'SELECT_WD_METHOD' };
        
        const wdKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔴 বিকাশ (bKash)', callback_data: 'wd_bkash' },
                        { text: '🟠 নগদ (Nagad)', callback_data: 'wd_nagad' }
                    ],
                    [
                        { text: '🔵 রকেট (Rocket)', callback_data: 'wd_rocket' }
                    ],
                    [
                        { text: '❌ বাতিল', callback_data: 'wd_cancel' }
                    ]
                ]
            }
        };

        return bot.sendMessage(
            chatId,
            `💸 *Withdrawal Menu*\n\nআপনার বর্তমান ব্যালেন্স: \`${currentBalance.toFixed(2)}\` ৳\n\nপেমেন্ট নেওয়ার জন্য নিচের মাধ্যমটি সিলেক্ট করুন:`,
            { parse_mode: 'Markdown', ...wdKeyboard }
        );
    }

    // ইউজার যখন পেমেন্ট নম্বর লিখে পাঠাবে
    if (userState[chatId] && userState[chatId].step === 'WAITING_FOR_WD_NUMBER') {
        const method = userState[chatId].method;
        const accountNumber = text;
        const userData = getUserData(chatId);
        const currentBalance = userData.totalEarned - userData.totalWithdrawn;

        if (currentBalance < MIN_WITHDRAW_AMOUNT) {
            delete userState[chatId];
            return bot.sendMessage(chatId, `❌ পর্যাপ্ত ব্যালেন্স নেই।`);
        }

        userData.totalWithdrawn += currentBalance;
        delete userState[chatId];

        // সফল উইথড্র রিকোয়েস্ট অ্যাডমিনের কাছে পাঠানো
        await bot.sendMessage(
            ADMIN_ID,
            `🔔 *New Withdrawal Request (Success)*\n\n` +
            `👤 User ID: \`${chatId}\`\n` +
            `💳 Method: *${method}*\n` +
            `📞 Account: \`${accountNumber}\`\n` +
            `💵 Amount: \`${currentBalance.toFixed(2)}\` ৳\n` +
            `✅ Status: *Pending Payment*`,
            { parse_mode: 'Markdown' }
        );

        return bot.sendMessage(
            chatId,
            `✅ *Withdrawal Request Successful!*\n\n` +
            `💳 Method: *${method}*\n` +
            `📞 Account: \`${accountNumber}\`\n` +
            `💵 Amount: \`${currentBalance.toFixed(2)}\` ৳\n\n` +
            `আপনার পেমেন্ট রিকোয়েস্ট সফলভাবে জমা হয়েছে। অ্যাডমিন শীঘ্রই চেক করে পাঠিয়ে দেবেন।`,
            { parse_mode: 'Markdown', reply_markup: mainMenu.reply_markup }
        );
    }

    if (text.includes('BALANCE') || text.toLowerCase() === 'stat') {
        return sendBalance(chatId);
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
// /ADMIN COMMAND
// ===============================

bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_ID) {
        return bot.sendMessage(chatId, '❌ আপনার এই কমান্ডটি ব্যবহার করার অনুমতি নেই!');
    }

    const adminKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '➕ নতুন অ্যাপ যোগ করুন', callback_data: 'admin_add_app' },
                    { text: '➕ রেঞ্জ যোগ করুন', callback_data: 'admin_add_range' }
                ],
                [
                    { text: '🗑️ রেঞ্জ ডিলিট করুন', callback_data: 'admin_delete_range' },
                    { text: '📋 বর্তমান তালিকা দেখুন', callback_data: 'admin_view_list' }
                ]
            ]
        }
    };

    await bot.sendMessage(chatId, `🛠️ *Admin Control Panel*\n\nনিচের অপশনগুলো থেকে অ্যাপ ও রেঞ্জ ম্যানেজ করুন:`, {
        parse_mode: 'Markdown',
        ...adminKeyboard
    });
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

        // --- WITHDRAW CALLBACKS ---
        if (data.startsWith('wd_')) {
            if (data === 'wd_cancel') {
                delete userState[chatId];
                await bot.answerCallbackQuery(query.id, { text: 'Cancelled' });
                return bot.editMessageText('❌ উইথড্র বাতিল করা হয়েছে।', { chat_id: chatId, message_id: messageId });
            }

            const methodMap = { 'wd_bkash': 'bKash', 'wd_nagad': 'Nagad', 'wd_rocket': 'Rocket' };
            const selectedMethod = methodMap[data];

            userState[chatId] = { step: 'WAITING_FOR_WD_NUMBER', method: selectedMethod };
            await bot.answerCallbackQuery(query.id);
            return bot.editMessageText(
                `💳 *Method:* ${selectedMethod}\n\nদয়া করে আপনার পেমেন্ট নম্বরটি (Personal Number) লিখে পাঠান:`,
                { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
            );
        }

        // --- ADMIN PANEL CALLBACKS ---
        if (chatId === ADMIN_ID) {
            if (data === 'admin_add_app') {
                userState[chatId] = { step: 'ADMIN_WAITING_APP_NAME' };
                await bot.answerCallbackQuery(query.id);
                return bot.sendMessage(chatId, `✍️ নতুন অ্যাপের নাম লিখে পাঠান (যেমন: Telegram, WhatsApp):`);
            }

            if (data === 'admin_add_range') {
                userState[chatId] = { step: 'ADMIN_WAITING_RANGE_DETAILS' };
                await bot.answerCallbackQuery(query.id);
                return bot.sendMessage(chatId, `✍️ অ্যাপের নাম এবং রেঞ্জ এভাবে লিখে পাঠান:\n\`Appname:RangeID\`\nউদাহরণ: \`Telegram:12345\``, { parse_mode: 'Markdown' });
            }

            if (data === 'admin_delete_range') {
                userState[chatId] = { step: 'ADMIN_WAITING_DELETE_RANGE' };
                await bot.answerCallbackQuery(query.id);
                return bot.sendMessage(chatId, `🗑️ যে অ্যাপের রেঞ্জ ডিলিট করতে চান তা এভাবে লিখুন:\n\`Appname:RangeID\`\nউদাহরণ: \`Telegram:12345\``, { parse_mode: 'Markdown' });
            }

            if (data === 'admin_view_list') {
                await bot.answerCallbackQuery(query.id);
                let listText = `📋 *Current Custom Apps & Ranges:*\n\n`;
                for (const [app, ranges] of Object.entries(customApps)) {
                    listText += `🔹 *${app}* -> [ ${ranges.join(', ')} ]\n`;
                }
                if (Object.keys(customApps).length === 0) listText += `কোনো কাস্টম অ্যাপ যোগ করা হয়নি।`;
                return bot.sendMessage(chatId, listText, { parse_nomd: 'Markdown' });
            }
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
            const appName = decodeURIComponent(parts[2] || 'Service');

            await bot.answerCallbackQuery(query.id, { text: 'Allocating number...' });
            await bot.editMessageText('⏳ Allocating fresh number from panel...', { chat_id: chatId, message_id: messageId });

            const actualNumResult = await getNewNumber(targetRange);
            
            if (!actualNumResult || !actualNumResult.data) {
                return bot.editMessageText('❌ Failed to allocate number from panel. Try another range.', { chat_id: chatId, message_id: messageId });
            }

            const phoneData = actualNumResult.data;
            const phoneNumber = phoneData.full_number || phoneData.number || 'N/A';
            const finalCountry = phoneData.country || phoneData.country_name || 'Global';
            const flagEmoji = getCountryFlag(finalCountry);

            startFastOtpChecker(chatId, phoneNumber);

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
                `🆔 *UID:* \`${PUBLIC_UID}\`\n` +
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
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('RIFAT_SMS Bot is active and running!');
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is listening on port ${PORT}`);
});
