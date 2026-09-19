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

// মেথড গ্রুপের ইউজারনেম
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
// COUNTRY FLAG GENERATOR (195+ COUNTRIES)
// ===============================
function getCountryFlag(countryInput) {
    if (!countryInput) return '🌐';
    let str = String(countryInput).trim().toUpperCase();

    const customMap = {
        'AFGHANISTAN': 'AF', 'ALBANIA': 'AL', 'ALGERIA': 'DZ', 'ANDORRA': 'AD', 'ANGOLA': 'AO',
        'ANTIGUA AND BARBUDA': 'AG', 'ARGENTINA': 'AR', 'ARMENIA': 'AM', 'AUSTRALIA': 'AU', 'AUSTRIA': 'AT',
        'AZERBAIJAN': 'AZ', 'BAHAMAS': 'BS', 'BAHRAIN': 'BH', 'BANGLADESH': 'BD', 'BARBADOS': 'BB',
        'BELARUS': 'BY', 'BELGIUM': 'BE', 'BELIZE': 'BZ', 'BENIN': 'BJ', 'BHUTAN': 'BT',
        'BOLIVIA': 'BO', 'BOSNIA AND HERZEGOVINA': 'BA', 'BOTSWANA': 'BW', 'BRAZIL': 'BR', 'BRUNEI': 'BN',
        'BULGARIA': 'BG', 'BURKINA FASO': 'BF', 'BURUNDI': 'BI', 'CABO VERDE': 'CV', 'CAMBODIA': 'KH',
        'CAMEROON': 'CM', 'CANADA': 'CA', 'CENTRAL AFRICAN REPUBLIC': 'CF', 'CHAD': 'TD', 'CHILE': 'CL',
        'CHINA': 'CN', 'COLOMBIA': 'CO', 'COMOROS': 'KM', 'CONGO': 'CG', 'COSTA RICA': 'CR',
        'CROATIA': 'HR', 'CUBA': 'CU', 'CYPRUS': 'CY', 'CZECH REPUBLIC': 'CZ', 'DENMARK': 'DK',
        'DJIBOUTI': 'DJ', 'DOMINICA': 'DM', 'DOMINICAN REPUBLIC': 'DO', 'ECUADOR': 'EC', 'EGYPT': 'EG',
        'EL SALVADOR': 'SV', 'EQUATORIAL GUINEA': 'GQ', 'ERITREA': 'ER', 'ESTONIA': 'EE', 'ESWATINI': 'SZ',
        'ETHIOPIA': 'ET', 'FIJI': 'FJ', 'FINLAND': 'FI', 'FRANCE': 'FR', 'GABON': 'GA',
        'GAMBIA': 'GM', 'GEORGIA': 'GE', 'GERMANY': 'DE', 'GHANA': 'GH', 'GREECE': 'GR',
        'GRENADA': 'GD', 'GUATEMALA': 'GT', 'GUINEA': 'GN', 'GUINEA-BISSAU': 'GW', 'GUYANA': 'GY',
        'HAITI': 'HT', 'HONDURAS': 'HN', 'HUNGARY': 'HU', 'ICELAND': 'IS', 'INDIA': 'IN',
        'INDONESIA': 'ID', 'IRAN': 'IR', 'IRAQ': 'IQ', 'IRELAND': 'IE', 'ISRAEL': 'IL',
        'ITALY': 'IT', 'JAMAICA': 'JM', 'JAPAN': 'JP', 'JORDAN': 'JO', 'KAZAKHSTAN': 'KZ',
        'KENYA': 'KE', 'KIRIBATI': 'KI', 'KOSOVO': 'XK', 'KUWAIT': 'KW', 'KYRGYZSTAN': 'KG',
        'LAOS': 'LA', 'LATVIA': 'LV', 'LEBANON': 'LB', 'LESOTHO': 'LS', 'LIBERIA': 'LR',
        'LIBYA': 'LY', 'LIECHTENSTEIN': 'LI', 'LITHUANIA': 'LT', 'LUXEMBOURG': 'LU', 'MADAGASCAR': 'MG',
        'MALAWI': 'MW', 'MALAYSIA': 'MY', 'MALDIVES': 'MV', 'MALI': 'ML', 'MALTA': 'MT',
        'MARSHALL ISLANDS': 'MH', 'MAURITANIA': 'MR', 'MAURITIUS': 'MU', 'MEXICO': 'MX', 'MICRONESIA': 'FM',
        'MOLDOVA': 'MD', 'MONACO': 'MC', 'MONGOLIA': 'MN', 'MONTENEGRO': 'ME', 'MOROCCO': 'MA',
        'MOZAMBIQUE': 'MZ', 'MYANMAR': 'MM', 'NAMIBIA': 'NA', 'NAURU': 'NR', 'NEPAL': 'NP',
        'NETHERLANDS': 'NL', 'NEW ZEALAND': 'NZ', 'NICARAGUA': 'NI', 'NIGER': 'NE', 'NIGERIA': 'NG',
        'NORTH KOREA': 'KP', 'NORTH MACEDONIA': 'MK', 'NORWAY': 'NO', 'OMAN': 'OM', 'PAKISTAN': 'PK',
        'PALAU': 'PW', 'PALESTINE': 'PS', 'PANAMA': 'PA', 'PAPUA NEW GUINEA': 'PG', 'PARAGUAY': 'PY',
        'PERU': 'PE', 'PHILIPPINES': 'PH', 'POLAND': 'PL', 'PORTUGAL': 'PT', 'QATAR': 'QA',
        'ROMANIA': 'RO', 'RUSSIA': 'RU', 'RWANDA': 'RW', 'SAINT KITTS AND NEVIS': 'KN', 'SAINT LUCIA': 'LC',
        'SAINT VINCENT AND THE GRENADINES': 'VC', 'SAMOA': 'WS', 'SAN MARINO': 'SM', 'SAO TOME AND PRINCIPE': 'ST',
        'SAUDI ARABIA': 'SA', 'SENEGAL': 'SN', 'SERBIA': 'RS', 'SEYCHELLES': 'SC', 'SIERRA LEONE': 'SL',
        'SINGAPORE': 'SG', 'SLOVAKIA': 'SK', 'SLOVENIA': 'SI', 'SOLOMON ISLANDS': 'SB', 'SOMALIA': 'SO',
        'SOUTH AFRICA': 'ZA', 'SOUTH KOREA': 'KR', 'SOUTH SUDAN': 'SS', 'SPAIN': 'ES', 'SRI LANKA': 'LK',
        'SUDAN': 'SD', 'SURINAME': 'SR', 'SWEDEN': 'SE', 'SWITZERLAND': 'CH', 'SYRIA': 'SY',
        'TAIWAN': 'TW', 'TAJIKISTAN': 'TJ', 'TANZANIA': 'TZ', 'THAILAND': 'TH', 'TIMOR-LESTE': 'TL',
        'TOGO': 'TG', 'TONGA': 'TO', 'TRINIDAD AND TOBAGO': 'TT', 'TUNISIA': 'TN', 'TURKEY': 'TR',
        'TURKMENISTAN': 'TM', 'TUVALU': 'TV', 'UGANDA': 'UG', 'UKRAINE': 'UA', 'UAE': 'AE',
        'UNITED ARAB EMIRATES': 'AE', 'UK': 'GB', 'UNITED KINGDOM': 'GB', 'USA': 'US', 'UNITED STATES': 'US',
        'URUGUAY': 'UY', 'UZBEKISTAN': 'UZ', 'VANUATU': 'VU', 'VATICAN CITY': 'VA', 'VENEZUELA': 'VE',
        'VIETNAM': 'VN', 'YEMEN': 'YE', 'ZAMBIA': 'ZM', 'ZIMBABWE': 'ZW'
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
// BALANCE FUNCTION
// ===============================

async function sendBalance(chatId) {
    delete userState[chatId];
    const data = getUserData(chatId);
    const currentBalance = data.totalEarned - data.totalWithdrawn;

    const balanceMsg =
        `📊 *Your Account Statement:*\n\n` +
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
        if (!liveData || !liveData.data) {
            const errText = '❌ No active services available from panel right now.';
            if (messageId) return bot.editMessageText(errText, { chat_id: chatId, message_id: messageId });
            return bot.sendMessage(chatId, errText);
        }

        const rawServices = liveData.data.services || liveData.data;
        const items = Array.isArray(rawServices) ? rawServices : Object.values(rawServices);

        if (!items || items.length === 0) {
            const errText = '❌ No active services available from panel right now.';
            if (messageId) return bot.editMessageText(errText, { chat_id: chatId, message_id: messageId });
            return bot.sendMessage(chatId, errText);
        }

        const appsSet = new Set();
        items.forEach(service => {
            if (!service) return;
            const sName = service.sid || service.name || service.title || service.service || service.app_name;
            if (sName) {
                appsSet.add(String(sName).trim());
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

        appsSet.forEach(appName => {
            const cleanName = String(appName).trim();
            const icon = appIcons[cleanName.toLowerCase()] || '📱';

            row.push({
                text: `${icon} ${cleanName}`,
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

        const menuText = `🎛️ *RIFAT OTP DASHBOARD*\n\n👇 Select your desired app/service below:`;
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
// MESSAGE HANDLER
// ===============================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';

    if (!text) return;
    if (text.startsWith('/start') || text.startsWith('/stat')) return;
    if (userLocks[chatId]) return;

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

    // ===========================
    // WITHDRAW BUTTON CLICK
    // ===========================
    if (text.includes('WITHDRAW') || text.includes('💸')) {
        delete userState[chatId];

        const data = getUserData(chatId);
        const currentBalance = data.totalEarned - data.totalWithdrawn;

        if (currentBalance < MIN_WITHDRAW_AMOUNT) {
            return bot.sendMessage(
                chatId,
                `❌ *Insufficient Balance!*\n\n` +
                `Your Current Balance: \`${currentBalance.toFixed(2)}\` ৳\n` +
                `Minimum Withdraw: \`${MIN_WITHDRAW_AMOUNT}\` ৳\n\n` +
                `Complete more OTPs to reach the minimum limit!`,
                { parse_mode: 'Markdown', reply_markup: mainMenu.reply_markup }
            );
        }

        const withdrawMethods = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🌸 Bkash', callback_data: 'withdraw_Bkash' },
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
    if (userState[chatId] && userState[chatId].step === 'AWAITING_NUMBER') {
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
    if (userState[chatId] && userState[chatId].step === 'AWAITING_AMOUNT') {
        const amount = Number(text.replace(/,/g, ''));
        const data = getUserData(chatId);
        const currentBalance = data.totalEarned - data.totalWithdrawn;

        if (!Number.isFinite(amount) || amount < MIN_WITHDRAW_AMOUNT) {
            return bot.sendMessage(
                chatId,
                `❌ Minimum withdraw amount is 100 ৳. Enter the correct amount:`
            );
        }

        if (amount > currentBalance) {
            return bot.sendMessage(
                chatId,
                `❌ You do not have enough balance! Your current balance is ${currentBalance.toFixed(2)} ৳.`
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

        if (data && data.startsWith('app_')) {
            const appName = data.replace('app_', '');
            await bot.answerCallbackQuery(query.id);
            return showCountriesForApp(chatId, messageId, appName);
        }

        // Withdraw Method Selection Callback
        if (data && data.startsWith('withdraw_')) {
            const method = data.replace('withdraw_', '');
            await bot.answerCallbackQuery(query.id);

            userState[chatId] = {
                step: 'AWAITING_NUMBER',
                method: method
            };

            return bot.editMessageText(
                `💳 *Selected Method: ${method}*\n\n` +
                `👉 Please send your ${method} wallet number below:`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown'
                }
            );
        }

        if (data === 'confirm_withdraw') {
            await bot.answerCallbackQuery(query.id);

            const state = userState[chatId];
            if (!state || state.step !== 'AWAITING_CONFIRMATION') {
                return bot.editMessageText('❌ Session expired. Please try again.', { chat_id: chatId, message_id: messageId });
            }

            const dataObj = getUserData(chatId);
            const amount = state.amount;
            const method = state.method;
            const walletNumber = state.walletNumber;

            dataObj.totalWithdrawn += amount;
            delete userState[chatId];

            const userTag = query.from.username ? `@${query.from.username}` : `[User](tg://user?id=${chatId})`;

            const adminMsg = 
                `🚨 *New Withdrawal Request!*\n\n` +
                `👤 *User:* ${userTag}\n` +
                `🆔 *Chat ID:* \`${chatId}\`\n` +
                `💳 *Method:* \`${method}\`\n` +
                `📞 *Wallet:* \`${walletNumber}\`\n` +
                `💵 *Amount:* \`${amount.toFixed(2)}\` ৳`;

            try {
                await bot.sendMessage(config.ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' });
            } catch (e) {
                console.error('Failed to send withdraw request to admin:', e.message);
            }

            return bot.editMessageText(
                `✅ *Withdrawal Request Submitted Successfully!*\n\n` +
                `Method: \`${method}\`\n` +
                `Number: \`${walletNumber}\`\n` +
                `Amount: \`${amount.toFixed(2)}\` ৳\n\n` +
                `Your request has been sent to the admin. Please wait for payment.`,
                { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
            );
        }

        if (data === 'cancel_withdraw') {
            await bot.answerCallbackQuery(query.id, { text: 'Withdraw cancelled' });
            delete userState[chatId];
            return bot.editMessageText('❌ Withdrawal request has been cancelled.', { chat_id: chatId, message_id: messageId });
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
