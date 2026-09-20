const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const fs = require('fs');
const axios = require('axios');

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
const processedOtps = new Set();

const MIN_WITHDRAW_AMOUNT = 300.00;
const OTP_REWARD_AMOUNT = 0.70;

// পাবলিক ইউ আইডি (UID) কনফিগারেশন
const PUBLIC_UID = 'MQUPBWI9AQJ';

// আপনার টেলিগ্রাম অ্যাডমিন আইডি
const ADMIN_ID = 6315111273;

// ফাইল নেম কনফিগারেশন
const CUSTOM_APPS_FILE = 'custom_apps.json';
const USERS_DATA_FILE = 'users_data.json';

function loadCustomApps() {
    if (fs.existsSync(CUSTOM_APPS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CUSTOM_APPS_FILE, 'utf8'));
        } catch (e) {
            return {};
        }
    }
    return {};
}

function saveCustomApps(data) {
    fs.writeFileSync(CUSTOM_APPS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ইউজার ব্যালেন্স ও ডেটা লোড ও সেভ করার ফাংশন
function loadUsersData() {
    if (fs.existsSync(USERS_DATA_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(USERS_DATA_FILE, 'utf8'));
        } catch (e) {
            return {};
        }
    }
    return {};
}

function saveUsersData(data) {
    fs.writeFileSync(USERS_DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// আপনার নির্দিষ্ট চ্যানেল দুটি
const CHANNEL_METHOD = 'https://t.me/otpmethod_r';
const CHANNEL_OTP_GROUP = 'https://t.me/otpgroup_rt';
const METHOD_CHANNEL_USERNAME = '@otpmethod_r';


function getUserData(userId) {
    let allUsers = loadUsersData();
    if (!allUsers[userId]) {
        allUsers[userId] = {
            totalOtp: 0,
            totalEarned: 0,
            totalWithdrawn: 0
        };
        saveUsersData(allUsers);
    }
    return allUsers[userId];
}

function updateUserData(userId, updaterFn) {
    let allUsers = loadUsersData();
    if (!allUsers[userId]) {
        allUsers[userId] = {
            totalOtp: 0,
            totalEarned: 0,
            totalWithdrawn: 0
        };
    }
    updaterFn(allUsers[userId]);
    saveUsersData(allUsers);
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

        const member2 = await bot.getChatMember(METHOD_CHANNEL_USERNAME, userId);
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

function getMainMenuMarkup(userId) {
    let keyboard = [
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
    ];

    if (userId === ADMIN_ID) {
        keyboard.push([{ text: '⚙️ ADMIN PANEL' }]);
    }

    return {
        reply_markup: {
            keyboard: keyboard,
            resize_keyboard: true
        }
    };
}


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
            `🆔 *UID:* \`${PUBLIC_UID}\`\n` +
            `💡 *Per OTP Reward:* ${OTP_REWARD_AMOUNT} ৳\n` +
            `⏱️ *Time Limit:* OTP must arrive within 15 minutes.\n\n` +
            `📢 *Official Channels:*\n` +
            `🔹 [OTP Group](${CHANNEL_OTP_GROUP})\n` +
            `🔹 [Method Channel](${CHANNEL_METHOD})\n\n` +
            `Click *Get Active Number* to get a number or click *Balance* to check earnings.\n\n` +
            `📌 *Minimum Withdraw: ${MIN_WITHDRAW_AMOUNT} ৳*`,
            {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                ...getMainMenuMarkup(chatId)
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
        `📢 *Join Updates:* [OTP Group](${CHANNEL_OTP_GROUP}) \vert{} [Method](${CHANNEL_METHOD})\n\n` +
        `📌 *Minimum Withdraw: ${MIN_WITHDRAW_AMOUNT} ৳*`;

    try {
        await bot.sendMessage(chatId, balanceMsg, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            ...getMainMenuMarkup(chatId)
        });
    } catch (error) {
        console.error('Balance error:', error.message);
    }
}


// ===============================
// SECURE SUCCESS OTP CHECKER (Updated with requested format)
// ===============================

async function startFastOtpChecker(chatId, phoneNumber) {
    const startTime = Date.now();
    const maxDurationMs = 15 * 60 * 1000; // ১৫ মিনিট
    const intervalTime = 1000; // প্রতি ১ সেকেন্ড পর পর চেক

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

                        updateUserData(chatId, (userData) => {
                            userData.totalOtp += 1;
                            userData.totalEarned += OTP_REWARD_AMOUNT;
                        });

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
                                        { text: 'OTP Group', url: CHANNEL_OTP_GROUP },
                                        { text: 'Method', url: CHANNEL_METHOD }
                                    ]
                                ]
                            }
                        };

                        await bot.sendMessage(chatId, otpMsg, {
                            parse_mode: 'Markdown',
                            ...otpKeyboard
                        });

                        // এখানে REQUIRED_CHANNEL-এ OTP notification পাঠানো হচ্ছে
                        await bot.sendMessage(
                            config.REQUIRED_CHANNEL,
                            `📢 *New Channel OTP Alert*\n\n` + otpMsg,
                            {
                                parse_mode: 'Markdown',
                                ...otpKeyboard
                            }
                        );

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
                `1️⃣ OTP Group: ${CHANNEL_OTP_GROUP}\n` +
                `2️⃣ Method Channel: ${CHANNEL_METHOD}`,
                { parse_mode: 'Markdown', disable_web_page_preview: true }
            );
            return;
        }

        const inlineKeyboard = [];
        let row = [];

        const customData = loadCustomApps();
        const customAppNames = Object.keys(customData);

        customAppNames.forEach(appName => {
            row.push({
                text: `🚀 ${appName}`,
                callback_data: `custom_app_${appName}`
            });

            if (row.length === 2) {
                inlineKeyboard.push(row);
                row = [];
            }
        });

        try {
            const liveData = await getLiveAccess(PUBLIC_UID);
            if (liveData && liveData.data) {
                const rawServices = liveData.data.services || liveData.data;
                const items = Array.isArray(rawServices) ? rawServices : Object.values(rawServices);

                const appsSet = new Set();
                items.forEach(service => {
                    if (!service) return;
                    const sName = service.sid || service.name || service.title || service.service || service.app_name;
                    if (sName) {
                        appsSet.add(String(sName).trim());
                    }
                });

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
                    if (!customAppNames.includes(cleanName)) {
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
            }
        } catch (e) {
            console.error('Live API fetch error in apps menu:', e.message);
        }

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
// STEP 2: SHOW COUNTRIES FOR LIVE PANEL APP
// ===============================
async function showCountriesForApp(chatId, messageId, appName) {
    try {
        const liveData = await getLiveAccess(PUBLIC_UID);
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
// STEP 3: SHOW COUNTRIES FOR CUSTOM APPS
// ===============================
async function showCustomAppCountries(chatId, messageId, appName) {
    const data = loadCustomApps();
    const appData = data[appName];

    if (!appData || !appData.ranges || appData.ranges.length === 0) {
        return bot.answerCbQuery ? bot.answerCbQuery(query.id, { text: '⚠️ এই অ্যাপে কোনো কান্ট্রি রেঞ্জ নেই!', show_alert: true }) : null;
    }

    let buttons = [];
    appData.ranges.forEach((item, index) => {
        let btnText = `${item.flag}${item.countryName}`;
        buttons.push([{ text: btnText, callback_data: `fetch_custom_num_${appName}_${index}` }]);
    });
    buttons.push([{ text: '⬅️ Back to Apps Menu', callback_data: 'back_to_apps' }]);

    const text = `📌 *Custom App:* \`${appName}\`\n\n👇 নির্দিষ্ট দেশের পতাকায় ক্লিক করে নাম্বার নিন:`;
    
    await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
    });
}


// ===============================
// ADMIN PANEL HANDLERS & COMMANDS
// ===============================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';

    if (!text) return;

    if (text === '⚙️ ADMIN PANEL' && chatId === ADMIN_ID) {
        delete userState[chatId];
        return bot.sendMessage(
            chatId,
            `⚙️ *ADMIN CONTROL PANEL*\n\nআপনার কাস্টম অ্যাপ ও রেঞ্জ ম্যানেজ করুন:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ Add New App', callback_data: 'admin_add_app' }],
                        [{ text: '➕ Add Range to App (+)', callback_data: 'admin_manage_ranges' }],
                        [{ text: '🗑️ Delete App / Range', callback_data: 'admin_delete_menu' }],
                        [{ text: '📋 View Custom Apps', callback_data: 'admin_view_custom' }]
                    ]
                }
            }
        );
    }

    if (text.startsWith('/start') || text.startsWith('/stat')) return;

    if (chatId === ADMIN_ID && userState[chatId]) {
        const state = userState[chatId];

        if (state.step === 'waiting_for_new_app_name') {
            const appName = text;
            const customData = loadCustomApps();
            if (!customData[appName]) {
                customData[appName] = { ranges: [] };
                saveCustomApps(customData);
            }
            delete userState[chatId];
            return bot.sendMessage(chatId, `✅ সফলভাবে কাস্টম অ্যাপ তৈরি হয়েছে: *${appName}*\n\nএখন "➕ Add Range to App (+)" থেকে রেঞ্জ যোগ করুন।`, { parse_mode: 'Markdown' });
        }

        if (state.step === 'waiting_for_range_input') {
            const parts = text.split(',').map(p => p.trim());
            if (parts.length >= 3) {
                const countryName = parts[0];
                const flag = parts[1];
                const range = parts[2];
                const appName = state.appName;

                const customData = loadCustomApps();
                if (customData[appName]) {
                    customData[appName].ranges.push({ countryName, flag, range });
                    saveCustomApps(customData);
                    delete userState[chatId];
                    return bot.sendMessage(chatId, `✅ সফলভাবে **${appName}** এর জন্য রেঞ্জ যোগ করা হয়েছে!\n\n🌍 Country: ${flag}${countryName}\n🔢 Range: \`${range}\``, { parse_mode: 'Markdown' });
                }
            } else {
                return bot.sendMessage(chatId, `⚠️ সঠিক ফরম্যাটে লিখুন। উদাহরণ:\n\`Poland, 🇵🇱, 38091xxx\``, { parse_mode: 'Markdown' });
            }
        }
    }

    if (userState[chatId] && userState[chatId].step === 'waiting_for_withdraw_amount') {
        const amount = parseFloat(text);
        const userData = getUserData(chatId);
        const currentBalance = userData.totalEarned - userData.totalWithdrawn;

        if (isNaN(amount) || amount <= 0) {
            return bot.sendMessage(chatId, `❌ দয়া করে সঠিক সংখ্যায় টাকার পরিমাণ লিখে পাঠান (যেমন: 300 বা 500)।`);
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

        const userData = getUserData(chatId);
        const currentBalance = userData.totalEarned - userData.totalWithdrawn;

        if (amount > currentBalance) {
            return bot.sendMessage(chatId, `❌ ব্যালেন্স পরিবর্তনের কারণে উইথড্র ব্যর্থ হয়েছে।`, { ...getMainMenuMarkup(chatId) });
        }

        updateUserData(chatId, (uData) => {
            uData.totalWithdrawn += amount;
        });

        const remainingBalance = currentBalance - amount;

        const withdrawSlip = 
            `💸 *New Withdrawal Request!*\n\n` +
            `👤 *User ID:* \`${chatId}\`\n` +
            `🆔 *UID:* \`${PUBLIC_UID}\`\n` +
            `💳 *Method:* \`${method}\`\n` +
            `📞 *Account Number:* \`${targetNumber}\`\n` +
            `💰 *Withdraw Amount:* \`${amount.toFixed(2)}\` ৳\n` +
            `💳 *Remaining Balance:* \`${remainingBalance.toFixed(2)}\` ৳\n\n` +
            `✅ Status: Payment Success Sent to Admin!`;

        await bot.sendMessage(chatId, `✅ আপনার উইথড্র রিকোয়েস্ট সফল হয়েছে!\n\n💳 পদ্ধতি: *${method}*\n📞 নম্বর: \`${targetNumber}\`\n💰 পরিমাণ: *${amount.toFixed(2)} ৳*`, { parse_mode: 'Markdown', ...getMainMenuMarkup(chatId) });
        await bot.sendMessage(ADMIN_ID, withdrawSlip, { parse_mode: 'Markdown' });
        return;
    }

    if (userLocks[chatId]) return;

    if (text.includes('BALANCE') || text.toLowerCase() === 'stat') {
        return sendBalance(chatId);
    }

    if (text.includes('WITHDRAW')) {
        const userData = getUserData(chatId);
        const currentBalance = userData.totalEarned - userData.totalWithdrawn;

        if (chatId !== ADMIN_ID && currentBalance < MIN_WITHDRAW_AMOUNT) {
            return bot.sendMessage(chatId, `❌ পর্যাপ্ত ব্যালেন্স নেই! ন্যূনতম উইথড্র: *${MIN_WITHDRAW_AMOUNT} ৳*\nবর্তমান ব্যালেন্স: *${currentBalance.toFixed(2)} ৳*`, { parse_mode: 'Markdown', ...getMainMenuMarkup(chatId) });
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

        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;

        if (data === 'back_to_apps') {
            await bot.answerCallbackQuery(query.id);
            return showAppsMenu(chatId, messageId);
        }

        if (data.startsWith('wd_')) {
            const methodCode = data.replace('wd_', '');
            let methodName = '';
            if (methodCode === 'bkash') methodName = 'Bkash 🔴';
            if (methodCode === 'nagad') methodName = 'Nagad 🟠';
            if (methodCode === 'rocket') methodName = 'Rocket 🟣';

            const userData = getUserData(chatId);
            const currentBalance = userData.totalEarned - userData.totalWithdrawn;

            userState[chatId] = { step: 'waiting_for_withdraw_amount', method: methodName };
            await bot.answerCallbackQuery(query.id);
            return bot.sendMessage(chatId, `💳 মাধ্যম: *${methodName}*\n\nবর্তমান ব্যালেন্স: *${currentBalance.toFixed(2)} ৳*\n\nকত টাকা উইথড্র করতে চান সেই পরিমাণ লিখে পাঠান:`, { parse_mode: 'Markdown' });
        }

        if (data === 'admin_add_app' && chatId === ADMIN_ID) {
            userState[chatId] = { step: 'waiting_for_new_app_name' };
            await bot.answerCallbackQuery(query.id);
            return bot.sendMessage(chatId, `✍️ নতুন কাস্টম অ্যাপের নাম লিখে পাঠান:`);
        }

        if (data === 'admin_manage_ranges' && chatId === ADMIN_ID) {
            const customData = loadCustomApps();
            const appNames = Object.keys(customData);
            if (appNames.length === 0) {
                return bot.answerCallbackQuery(query.id, { text: '⚠️ কোনো কাস্টম অ্যাপ নেই।', show_alert: true });
            }
            let buttons = [];
            appNames.forEach(appName => {
                buttons.push([{ text: `➕ Add Range to ${appName}`, callback_data: `admin_select_app_${appName}` }]);
            });
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_back' }]);
            await bot.answerCallbackQuery(query.id);
            return bot.editMessageText(`📂 যে অ্যাপে রেঞ্জ যোগ করতে চান তা সিলেক্ট করুন:`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: buttons }
            });
        }

        if (data.startsWith('admin_select_app_') && chatId === ADMIN_ID) {
            const appName = data.replace('admin_select_app_', '');
            userState[chatId] = { step: 'waiting_for_range_input', appName: appName };
            await bot.answerCallbackQuery(query.id);
            return bot.sendMessage(chatId, `✍️ **${appName}** এর জন্য নিচের ফরম্যাটে তথ্য পাঠান:\n\`কান্ট্রি_নাম, পতাকা_ইমোজি, রেঞ্জ\`\n\nউদাহরণ:\n\`Poland, 🇵🇱, 38091xxx\``, { parse_mode: 'Markdown' });
        }

        if (data === 'admin_delete_menu' && chatId === ADMIN_ID) {
            const customData = loadCustomApps();
            const appNames = Object.keys(customData);
            if (appNames.length === 0) {
                return bot.answerCallbackQuery(query.id, { text: '⚠️ কোনো কাস্টম অ্যাপ নেই!', show_alert: true });
            }
            let buttons = [];
            appNames.forEach(appName => {
                buttons.push([
                    { text: `❌ Delete App: ${appName}`, callback_data: `del_app_${appName}` },
                    { text: `🗑️ Delete Range in ${appName}`, callback_data: `del_range_menu_${appName}` }
                ]);
            });
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_back' }]);
            await bot.answerCallbackQuery(query.id);
            return bot.editMessageText(`🗑️ *DELETE MANAGER*`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        if (data.startsWith('del_app_') && chatId === ADMIN_ID) {
            const appName = data.replace('del_app_', '');
            const customData = loadCustomApps();
            if (customData[appName]) {
                delete customData[appName];
                saveCustomApps(customData);
            }
            await bot.answerCallbackQuery(query.id, { text: `✅ ${appName} ডিলিট করা হয়েছে!`, show_alert: true });
            return bot.editMessageText(`✅ *${appName}* অ্যাপটি ডিলিট করা হয়েছে।`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_delete_menu' }]] }
            });
        }

        if (data.startsWith('del_range_menu_') && chatId === ADMIN_ID) {
            const appName = data.replace('del_range_menu_', '');
            const customData = loadCustomApps();
            const appData = customData[appName];

            if (!appData || !appData.ranges || appData.ranges.length === 0) {
                return bot.answerCallbackQuery(query.id, { text: '⚠️ কোনো রেঞ্জ নেই!', show_alert: true });
            }

            let buttons = [];
            appData.ranges.forEach((r, index) => {
                buttons.push([{ text: `❌ ${r.flag} ${r.countryName} (${r.range})`, callback_data: `del_r_${appName}_${index}` }]);
            });
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_delete_menu' }]);

            await bot.answerCallbackQuery(query.id);
            return bot.editMessageText(`🗑️ *${appName}* এর রেঞ্জ সিলেক্ট করুন:`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: buttons }
            });
        }

        if (data.startsWith('del_r_') && chatId === ADMIN_ID) {
            const parts = data.replace('del_r_', '').split('_');
            const appName = parts[0];
            const rangeIndex = parseInt(parts[1]);

            const customData = loadCustomApps();
            if (customData[appName] && customData[appName].ranges[rangeIndex]) {
                customData[appName].ranges.splice(rangeIndex, 1);
                saveCustomApps(customData);
            }

            await bot.answerCallbackQuery(query.id, { text: '✅ রেঞ্জ ডিলিট করা হয়েছে!', show_alert: true });
            return bot.editMessageText(`✅ রেঞ্জ সফলভাবে ডিলিট করা হয়েছে।`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_delete_menu' }]] }
            });
        }

        if (data === 'admin_view_custom' && chatId === ADMIN_ID) {
            const customData = loadCustomApps();
            const appNames = Object.keys(customData);
            if (appNames.length === 0) {
                return bot.answerCallbackQuery(query.id, { text: '⚠️ কোনো কাস্টম অ্যাপ নেই।', show_alert: true });
            }
            let txt = `📋 *Your Custom Apps & Ranges:*\n\n`;
            appNames.forEach(appName => {
                txt += `🔹 *${appName}*:\n`;
                if (customData[appName].ranges.length === 0) {
                    txt += `   (কোনো রেঞ্জ নেই)\n`;
                } else {
                    customData[appName].ranges.forEach(r => {
                        txt += `   - ${r.flag} ${r.countryName} (\`${r.range}\`)\n`;
                    });
                }
            });
            await bot.answerCallbackQuery(query.id);
            return bot.editMessageText(txt, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_apps' }]] }
            });
        }

        if (data.startsWith('custom_app_')) {
            const appName = data.replace('custom_app_', '');
            await bot.answerCallbackQuery(query.id);
            return showCustomAppCountries(chatId, messageId, appName);
        }

        if (data.startsWith('fetch_custom_num_')) {
            const parts = data.replace('fetch_custom_num_', '').split('_');
            const appName = parts[0];
            const rangeIndex = parseInt(parts[1]);

            const customData = loadCustomApps();
            const item = customData[appName] ? customData[appName].ranges[rangeIndex] : null;

            if (!item) {
                return bot.answerCallbackQuery(query.id, { text: '⚠️ রেঞ্জ পাওয়া যায়নি!', show_alert: true });
            }

            await bot.answerCallbackQuery(query.id, { text: `${item.countryName} থেকে ৫টি নাম্বার ফেচ হচ্ছে...` });
            await bot.editMessageText('⏳ Allocating 5 fresh numbers from panel...', { chat_id: chatId, message_id: messageId });

            let numbersListText = '';
            let validNumbersCount = 0;

            for (let i = 0; i < 5; i++) {
                try {
                    const actualNumResult = await getNewNumber(item.range);
                    if (actualNumResult && actualNumResult.data) {
                        const phoneData = actualNumResult.data;
                        const phoneNumber = phoneData.full_number || phoneData.number || 'N/A';
                        validNumbersCount++;
                        numbersListText += `${validNumbersCount}. \`${phoneNumber}\`\n`;
                        
                        startFastOtpChecker(chatId, phoneNumber);
                    }
                } catch (err) {
                    console.error('Error fetching number:', err.message);
                }
            }

            if (validNumbersCount === 0) {
                return bot.editMessageText('❌ Failed to allocate numbers from panel. Try again later.', { chat_id: chatId, message_id: messageId });
            }

            const numberKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🔄 Change Numbers (5x)', callback_data: `fetch_custom_num_${appName}_${rangeIndex}` },
                            { text: '⬅️ Back to Countries', callback_data: `custom_app_${appName}` }
                        ]
                    ]
                }
            };

            return bot.editMessageText(
                `⚡ *━━━ RIFAT OTP SERVICE (5 NUMBERS) ━━━* ⚡\n\n` +
                `🆔 *UID:* \`${PUBLIC_UID}\`\n` +
                `🎯 *Service:* \`${appName}\`\n` +
                `${item.flag} *Country:* \`${item.countryName}\`\n\n` +
                `📞 *Allocated Numbers:*\n${numbersListText}\n` +
                `✅ *Status:* Active Numbers Allocated\n` +
                `⏰ *Validity:* 15 Minutes`,
                { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...numberKeyboard }
            );
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

            await bot.answerCallbackQuery(query.id, { text: 'Allocating 5 numbers...' });
            await bot.editMessageText('⏳ Allocating 5 fresh numbers from panel...', { chat_id: chatId, message_id: messageId });

            let numbersListText = '';
            let validNumbersCount = 0;
            let finalCountry = 'Global';

            for (let i = 0; i < 5; i++) {
                try {
                    const actualNumResult = await getNewNumber(targetRange);
                    if (actualNumResult && actualNumResult.data) {
                        const phoneData = actualNumResult.data;
                        const phoneNumber = phoneData.full_number || phoneData.number || 'N/A';
                        finalCountry = phoneData.country || phoneData.country_name || finalCountry;
                        validNumbersCount++;
                        numbersListText += `${validNumbersCount}. \`${phoneNumber}\`\n`;

                        startFastOtpChecker(chatId, phoneNumber);
                    }
                } catch (err) {
                    console.error('Error fetching live number:', err.message);
                }
            }

            if (validNumbersCount === 0) {
                return bot.editMessageText('❌ Failed to allocate numbers from panel. Try another range.', { chat_id: chatId, message_id: messageId });
            }

            const flagEmoji = getCountryFlag(finalCountry);

            const numberKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🔄 Change Numbers (5x)', callback_data: `num_${targetRange}_${encodeURIComponent(appName)}` },
                            { text: '⬅️ Back to Countries', callback_data: `app_${appName}` }
                        ]
                    ]
                }
            };

            return bot.editMessageText(
                `⚡ *━━━ RIFAT OTP SERVICE (5 NUMBERS) ━━━* ⚡\n\n` +
                `🆔 *UID:* \`${PUBLIC_UID}\`\n` +
                `🎯 *Service:* \`${appName}\`\n` +
                `${flagEmoji} *Country:* \`${finalCountry}\`\n\n` +
                `📞 *Allocated Numbers:*\n${numbersListText}\n` +
                `✅ *Status:* Active Numbers Allocated\n` +
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
