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

const OTP_REWARD_AMOUNT = 0.70;

// পাবলিক ইউআইডি (UID) কনফিগারেশন
const PUBLIC_UID = 'MQUPBWI9AQJ';

// মেথড গ্রুপের ইউজারনেম
const METHOD_CHANNEL = '@otpmethod_r';


// =========================================================================
// 🚀 কাস্টম অ্যাপ এবং রেঞ্জ কনফিগারেশন (নিজের ইচ্ছেমতো যত খুশি অ্যাড করুন)
// =========================================================================
const MY_CUSTOM_APPS_AND_RANGES = [
    {
        appName: 'Telegram', // অ্যাপের নাম
        ranges: [
            { country: 'Bangladesh', rangeVal: '105' },
            { country: 'India', rangeVal: '205' },
            { country: 'Pakistan', rangeVal: '305' }
        ]
    },
    {
        appName: 'WhatsApp', // আরেকটি অ্যাপ
        ranges: [
            { country: 'USA', rangeVal: '405' },
            { country: 'UK', rangeVal: '505' }
        ]
    }
    // আপনি চাইলে নিচে কমা দিয়ে নতুন অ্যাপ ও রেঞ্জ যোগ করতে পারেন:
    /*
    {
        appName: 'TikTok',
        ranges: [
            { country: 'Canada', rangeVal: '605' }
        ]
    }
    */
];
// =========================================================================


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

    return {
        reply_markup: {
            keyboard: keyboard,
            resize_keyboard: true
        }
    };
}


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
            `📌 *Minimum Withdraw: 100 ৳*`,
            {
                parse_mode: 'Markdown',
                reply_markup: getMainMenuMarkup(chatId).reply_markup
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
        `📌 *Minimum Withdraw: 100 ৳*`;

    try {
        await bot.sendMessage(chatId, balanceMsg, {
            parse_mode: 'Markdown',
            reply_markup: getMainMenuMarkup(chatId).reply_markup
        });
    } catch (error) {
        console.error('Balance error:', error.message);
    }
}


// ===============================
// SECURE SUCCESS OTP CHECKER (SAFE & UNTOUCHED)
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
        const appsSet = new Set();

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

        // কোডের উপরের কাস্টম অ্যাপগুলো লিস্টে যুক্ত করা
        MY_CUSTOM_APPS_AND_RANGES.forEach(item => {
            appsSet.add(item.appName);
        });

        if (appsSet.size === 0) {
            const errText = '❌ No active services available from panel right now.';
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
// STEP 2: SHOW COUNTRIES FOR SELECTED APP
// ===============================
async function showCountriesForApp(chatId, messageId, appName) {
    try {
        const liveData = await getLiveAccess();
        const inlineKeyboard = [];
        let row = [];

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

        // কোডের উপরের কাস্টম অ্যাপ থেকে রেঞ্জগুলো যুক্ত করা
        const customAppObj = MY_CUSTOM_APPS_AND_RANGES.find(item => item.appName.toLowerCase() === appName.toLowerCase());
        if (customAppObj && customAppObj.ranges) {
            customAppObj.ranges.forEach(rItem => {
                const flag = getCountryFlag(rItem.country);
                row.push({
                    text: `${flag} ${rItem.country} (${rItem.rangeVal})`,
                    callback_data: `num_${rItem.rangeVal}_${encodeURIComponent(appName)}`
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
