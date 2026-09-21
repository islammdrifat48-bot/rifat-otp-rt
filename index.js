const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const {
    getLiveAccess,
    getNewNumber,
    getSuccessOtp
} = require('./api');

// =====================================================
// BOT CONFIG
// =====================================================

const ADMIN_ID = 6315111273;
const PUBLIC_UID = 'MQUPBWI9AQJ';
const METHOD_CHANNEL = '@otpmethod_r';

const MIN_WITHDRAW_AMOUNT = 500;
const OTP_REWARD_AMOUNT = 0.70;

const DATA_FILE = path.join(__dirname, 'bot-data.json');

// =====================================================
// BOT INITIALIZATION
// =====================================================

const bot = new TelegramBot(config.BOT_TOKEN, {
    polling: {
        interval: 500,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

// =====================================================
// DATABASE
// =====================================================

let database = {
    users: {},
    customApps: {}
};

const processedOtps = new Set();

function loadDatabase() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');

            if (raw.trim()) {
                database = JSON.parse(raw);
            }
        }
    } catch (error) {
        console.error('Database load error:', error.message);

        database = {
            users: {},
            customApps: {}
        };
    }

    if (!database.users) {
        database.users = {};
    }

    if (!database.customApps) {
        database.customApps = {};
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(database, null, 2),
            'utf8'
        );
    } catch (error) {
        console.error('Database save error:', error.message);
    }
}

loadDatabase();

// =====================================================
// USER STATE
// =====================================================

const userState = {};

function getUserData(userId, user = null) {
    const id = String(userId);

    if (!database.users[id]) {
        database.users[id] = {
            userId: id,
            name: user?.first_name || 'User',
            totalOtp: 0,
            totalEarned: 0,
            totalWithdrawn: 0,
            createdAt: Date.now()
        };

        saveDatabase();
    }

    if (user) {
        database.users[id].name =
            user.first_name ||
            database.users[id].name ||
            'User';
    }

    return database.users[id];
}

// =====================================================
// COUNTRY FLAG
// =====================================================

function getCountryFlag(input) {
    if (!input) return '🌐';

    let value = String(input)
        .trim()
        .toUpperCase();

    const map = {
        '880': 'BD',
        '91': 'IN',
        '1': 'US',
        '44': 'GB',
        '92': 'PK',
        '966': 'SA',
        '971': 'AE',

        'BANGLADESH': 'BD',
        'INDIA': 'IN',
        'USA': 'US',
        'UNITED STATES': 'US',
        'UK': 'GB',
        'UNITED KINGDOM': 'GB',
        'PAKISTAN': 'PK',
        'SAUDI ARABIA': 'SA',
        'UAE': 'AE',
        'UNITED ARAB EMIRATES': 'AE',

        'AFGHANISTAN': 'AF',
        'CHINA': 'CN',
        'JAPAN': 'JP',
        'SOUTH KOREA': 'KR',
        'RUSSIA': 'RU',
        'TURKEY': 'TR',
        'MALAYSIA': 'MY',
        'SINGAPORE': 'SG',
        'INDONESIA': 'ID',
        'NEPAL': 'NP',
        'SRI LANKA': 'LK',
        'THAILAND': 'TH',
        'VIETNAM': 'VN',
        'PHILIPPINES': 'PH',
        'CANADA': 'CA',
        'AUSTRALIA': 'AU',
        'GERMANY': 'DE',
        'FRANCE': 'FR',
        'ITALY': 'IT',
        'SPAIN': 'ES',
        'BRAZIL': 'BR',
        'MEXICO': 'MX',
        'EGYPT': 'EG',
        'QATAR': 'QA',
        'KUWAIT': 'KW',
        'OMAN': 'OM',
        'BAHRAIN': 'BH'
    };

    if (map[value]) {
        value = map[value];
    }

    if (/^[A-Z]{2}$/.test(value)) {
        const points = [...value].map(
            char => 127397 + char.charCodeAt(0)
        );

        return String.fromCodePoint(...points);
    }

    return '🌐';
}

// =====================================================
// PHONE MASK
// =====================================================

function maskPhoneNumber(number) {
    const value = String(number || '');

    if (value.length <= 7) {
        return value;
    }

    return (
        value.slice(0, 4) +
        '****' +
        value.slice(-3)
    );
}

// =====================================================
// CHANNEL CHECK
// =====================================================

async function isMember(channel, userId) {
    try {
        const member = await bot.getChatMember(
            channel,
            userId
        );

        return [
            'creator',
            'administrator',
            'member'
        ].includes(member.status);

    } catch (error) {
        console.error(
            `Membership check error ${channel}:`,
            error.message
        );

        return false;
    }
}

async function checkRequiredChannels(userId) {
    const first = await isMember(
        config.REQUIRED_CHANNEL,
        userId
    );

    const second = await isMember(
        METHOD_CHANNEL,
        userId
    );

    return first && second;
}

// =====================================================
// MAIN MENU
// =====================================================

const mainKeyboard = {
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

// =====================================================
// ADMIN KEYBOARD
// =====================================================

function getAdminKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: '➕ Create App',
                    callback_data: 'admin_create'
                },
                {
                    text: '🗑 Delete App',
                    callback_data: 'admin_delete'
                }
            ],
            [
                {
                    text: '➕ Add Range',
                    callback_data: 'admin_add_range'
                },
                {
                    text: '🗑 Delete Range',
                    callback_data: 'admin_delete_range'
                }
            ],
            [
                {
                    text: '📋 View Apps',
                    callback_data: 'admin_view'
                }
            ]
        ]
    };
}

// =====================================================
// START
// =====================================================

bot.onText(/^\/start(?:@\w+)?$/, async msg => {
    const chatId = msg.chat.id;

    delete userState[chatId];

    const user = getUserData(
        chatId,
        msg.from
    );

    const text =
        `👋 *RIFAT_SMS Bot*\n\n` +
        `🆔 UID: \`${PUBLIC_UID}\`\n` +
        `💰 OTP Reward: ${OTP_REWARD_AMOUNT} ৳\n` +
        `⏱️ Number Validity: 15 Minutes\n\n` +
        `📊 *Your Statistics*\n` +
        `• OTP: ${user.totalOtp}\n` +
        `• Earned: ${user.totalEarned.toFixed(2)} ৳\n` +
        `• Withdrawn: ${user.totalWithdrawn.toFixed(2)} ৳\n\n` +
        `📌 Minimum Withdraw: ${MIN_WITHDRAW_AMOUNT} ৳`;

    await bot.sendMessage(
        chatId,
        text,
        {
            parse_mode: 'Markdown',
            ...mainKeyboard
        }
    );
});

// =====================================================
// BALANCE
// =====================================================

async function sendBalance(chatId) {
    const data = getUserData(chatId);

    const balance =
        data.totalEarned -
        data.totalWithdrawn;

    const text =
        `📊 *ACCOUNT BALANCE*\n\n` +
        `🆔 UID: \`${PUBLIC_UID}\`\n\n` +
        `🔢 Total OTP: \`${data.totalOtp}\`\n` +
        `💰 Total Earned: \`${data.totalEarned.toFixed(2)}\` ৳\n` +
        `🏧 Total Withdrawn: \`${data.totalWithdrawn.toFixed(2)}\` ৳\n` +
        `━━━━━━━━━━━━━━\n` +
        `💳 Current Balance: \`${balance.toFixed(2)}\` ৳\n\n` +
        `📌 Minimum Withdraw: ${MIN_WITHDRAW_AMOUNT} ৳`;

    return bot.sendMessage(
        chatId,
        text,
        {
            parse_mode: 'Markdown',
            ...mainKeyboard
        }
    );
}

// =====================================================
// LEADERBOARD
// =====================================================

async function sendLeaderboard(chatId) {
    const users = Object.values(database.users);

    users.sort((a, b) => {
        const balanceA =
            a.totalEarned -
            a.totalWithdrawn;

        const balanceB =
            b.totalEarned -
            b.totalWithdrawn;

        return balanceB - balanceA;
    });

    const top = users.slice(0, 10);

    let text =
        `🏆 *TOP EARNERS*\n\n`;

    if (!top.length) {
        text += 'No earning data available yet.';
    } else {
        const medals = [
            '🥇',
            '🥈',
            '🥉'
        ];

        top.forEach((user, index) => {
            const balance =
                user.totalEarned -
                user.totalWithdrawn;

            const medal =
                medals[index] ||
                `${index + 1}.`;

            text +=
                `${medal} *${user.name || 'User'}*\n` +
                `   💰 ${balance.toFixed(2)} ৳\n` +
                `   🔢 OTP: ${user.totalOtp}\n\n`;
        });
    }

    return bot.sendMessage(
        chatId,
        text,
        {
            parse_mode: 'Markdown',
            ...mainKeyboard
        }
    );
}

// =====================================================
// REFER
// =====================================================

async function sendRefer(chatId) {
    const me = await bot.getMe();

    const link =
        `https://t.me/${me.username}?start=ref_${chatId}`;

    const keyboard = {
        inline_keyboard: [
            [
                {
                    text: '🔗 Share Referral',
                    url: `https://t.me/share/url?url=${encodeURIComponent(link)}`
                }
            ]
        ]
    };

    return bot.sendMessage(
        chatId,
        `🔵 *REFER & EARN*\n\n` +
        `Your referral link:\n\n` +
        `\`${link}\``,
        {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        }
    );
}

// =====================================================
// SUPPORT
// =====================================================

async function sendSupport(chatId) {
    const username =
        String(config.SUPPORT_USERNAME || '')
            .replace('@', '');

    const keyboard = {
        inline_keyboard: [
            [
                {
                    text: '👨‍💻 Contact Admin',
                    url: `https://t.me/${username}`
                }
            ]
        ]
    };

    return bot.sendMessage(
        chatId,
        `🎧 *SUPPORT*\n\nFor any issue, contact our support admin.`,
        {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        }
    );
}

// =====================================================
// WITHDRAW START
// =====================================================

async function startWithdraw(chatId) {
    const data = getUserData(chatId);

    const balance =
        data.totalEarned -
        data.totalWithdrawn;

    if (balance < MIN_WITHDRAW_AMOUNT) {
        return bot.sendMessage(
            chatId,
            `❌ *Insufficient Balance*\n\n` +
            `💳 Current Balance: ${balance.toFixed(2)} ৳\n` +
            `📌 Minimum Withdraw: ${MIN_WITHDRAW_AMOUNT} ৳`,
            {
                parse_mode: 'Markdown'
            }
        );
    }

    userState[chatId] = {
        step: 'withdraw_amount'
    };

    const keyboard = {
        inline_keyboard: [
            [
                {
                    text: '🔴 bKash',
                    callback_data: 'withdraw_bkash'
                },
                {
                    text: '🟠 Nagad',
                    callback_data: 'withdraw_nagad'
                }
            ],
            [
                {
                    text: '🟣 Rocket',
                    callback_data: 'withdraw_rocket'
                }
            ]
        ]
    };

    return bot.sendMessage(
        chatId,
        `💸 *SELECT WITHDRAW METHOD*`,
        {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        }
    );
}

// =====================================================
// SHOW APPS
// =====================================================

async function showApps(chatId, messageId = null) {
    try {
        const joined =
            await checkRequiredChannels(chatId);

        if (!joined) {
            const keyboard = [
                [
                    {
                        text: '📢 Join OTP Group',
                        url:
                            `https://t.me/${String(config.REQUIRED_CHANNEL).replace('@', '')}`
                    }
                ],
                [
                    {
                        text: '📌 Join Method Group',
                        url:
                            `https://t.me/${METHOD_CHANNEL.replace('@', '')}`
                    }
                ],
                [
                    {
                        text: '🔄 Check Again',
                        callback_data: 'check_join'
                    }
                ]
            ];

            const text =
                `❌ *Channel Membership Required*\n\n` +
                `Join both groups and press *Check Again*.`;

            if (messageId) {
                return bot.editMessageText(
                    text,
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: keyboard
                        }
                    }
                );
            }

            return bot.sendMessage(
                chatId,
                text,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
        }

        const keyboard = [];
        let row = [];

        // CUSTOM APPS
        for (
            const appName of Object.keys(database.customApps)
        ) {
            row.push({
                text: `⭐ ${appName}`,
                callback_data:
                    `custom_app:${encodeURIComponent(appName)}`
            });

            if (row.length === 2) {
                keyboard.push(row);
                row = [];
            }
        }

        // LIVE APPS
        try {
            const liveData =
                await getLiveAccess();

            if (
                liveData &&
                liveData.data
            ) {
                const services =
                    liveData.data.services ||
                    liveData.data;

                const items =
                    Array.isArray(services)
                        ? services
                        : Object.values(services);

                const uniqueApps = new Set();

                for (const service of items) {
                    if (!service) continue;

                    const name =
                        service.sid ||
                        service.name ||
                        service.title ||
                        service.service ||
                        service.app_name;

                    if (name) {
                        uniqueApps.add(
                            String(name).trim()
                        );
                    }
                }

                for (const appName of uniqueApps) {
                    row.push({
                        text: `📱 ${appName}`,
                        callback_data:
                            `live_app:${encodeURIComponent(appName)}`
                    });

                    if (row.length === 2) {
                        keyboard.push(row);
                        row = [];
                    }
                }
            }
        } catch (error) {
            console.error(
                'Live service error:',
                error.message
            );
        }

        if (row.length > 0) {
            keyboard.push(row);
        }

        const text =
            `🎛️ *RIFAT OTP DASHBOARD*\n\n` +
            `🆔 UID: \`${PUBLIC_UID}\`\n\n` +
            `👇 Select an app/service:`;

        if (messageId) {
            return bot.editMessageText(
                text,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
        }

        return bot.sendMessage(
            chatId,
            text,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );

    } catch (error) {
        console.error(
            'showApps error:',
            error.message
        );

        return bot.sendMessage(
            chatId,
            '❌ Failed to load services.'
        );
    }
}

// =====================================================
// CUSTOM APP
// =====================================================

async function showCustomApp(
    chatId,
    messageId,
    appName
) {
    const ranges =
        database.customApps[appName] || [];

    const keyboard = [];
    let row = [];

    for (const range of ranges) {
        row.push({
            text:
                `${getCountryFlag(range)}${range}`,

            callback_data:
                `get_number:${encodeURIComponent(appName)}:${encodeURIComponent(range)}`
        });

        if (row.length === 2) {
            keyboard.push(row);
            row = [];
        }
    }

    if (row.length) {
        keyboard.push(row);
    }

    keyboard.push([
        {
            text: '⬅️ Back',
            callback_data: 'back_apps'
        }
    ]);

    return bot.editMessageText(
        `⭐ *${appName}*\n\nSelect a range:`,
        {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
}

// =====================================================
// LIVE APP
// =====================================================

async function showLiveApp(
    chatId,
    messageId,
    appName
) {
    try {
        const liveData =
            await getLiveAccess();

        if (
            !liveData ||
            !liveData.data
        ) {
            return bot.editMessageText(
                '❌ Live service data unavailable.',
                {
                    chat_id: chatId,
                    message_id: messageId
                }
            );
        }

        const services =
            liveData.data.services ||
            liveData.data;

        const items =
            Array.isArray(services)
                ? services
                : Object.values(services);

        const keyboard = [];
        let row = [];

        for (const service of items) {
            if (!service) continue;

            const serviceName =
                String(
                    service.sid ||
                    service.name ||
                    service.title ||
                    service.service ||
                    service.app_name ||
                    ''
                ).trim();

            if (
                serviceName.toLowerCase() !==
                appName.toLowerCase()
            ) {
                continue;
            }

            const country =
                service.country ||
                service.country_name ||
                service.location ||
                service.region ||
                appName;

            let range = '';

            if (
                Array.isArray(service.ranges) &&
                service.ranges.length
            ) {
                range =
                    String(service.ranges[0])
                        .replace(/[^0-9]/g, '');
            } else if (service.range) {
                range =
                    String(service.range)
                        .replace(/[^0-9]/g, '');
            } else if (service.rid) {
                range =
                    String(service.rid);
            }

            if (!range) continue;

            row.push({
                text:
                    `${getCountryFlag(country)} ${country} (${range})`,

                callback_data:
                    `get_number:${encodeURIComponent(appName)}:${encodeURIComponent(range)}`
            });

            if (row.length === 2) {
                keyboard.push(row);
                row = [];
            }
        }

        if (row.length) {
            keyboard.push(row);
        }

        keyboard.push([
            {
                text: '⬅️ Back',
                callback_data: 'back_apps'
            }
        ]);

        return bot.editMessageText(
            `📱 *${appName}*\n\nSelect country/range:`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );

    } catch (error) {
        console.error(
            'Live app error:',
            error.message
        );

        return bot.editMessageText(
            '❌ Failed to load service.',
            {
                chat_id: chatId,
                message_id: messageId
            }
        );
    }
}

// =====================================================
// FAST OTP CHECKER (AUTO REWARD & NOTIFICATION)
// =====================================================

function startFastOtpChecker(chatId, phoneNumber) {
    const startTime = Date.now();
    const maxDurationMs = 15 * 60 * 1000; // ১৫ মিনিট সময়সীমা
    const intervalTime = 1000; // প্রতি ১ সেকেন্ডে চেক করবে

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
                        saveDatabase();

                        const maskedNumber = maskPhoneNumber(phoneNumber);

                        const otpMsg =
                            `🎉 *OTP Received Successfully!*\n\n` +
                            `🆔 *UID:* \`${PUBLIC_UID}\`\n` +
                            `📞 *Number:* \`${phoneNumber}\`\n` +
                            `💬 *Details:* \`${messageText}\`\n` +
                            `💰 *Reward Added:* +${OTP_REWARD_AMOUNT} ৳\n\n` +
                            `✅ OTP successfully credited to your account!`;

                        const otpKeyboard = {
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '📢 OTP Group', url: 'https://t.me/otpgroup_rt' },
                                        { text: '📌 Method', url: 'https://t.me/otpmethod_r' }
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

// =====================================================
// NUMBER ALLOCATION
// =====================================================

async function allocateNumber(
    chatId,
    messageId,
    appName,
    range
) {
    await bot.editMessageText(
        '⏳ *Requesting number...*',
        {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        }
    );

    try {
        const result =
            await getNewNumber(range);

        if (
            !result ||
            !result.data
        ) {
            return bot.editMessageText(
                `❌ *Number allocation failed.*\n\nTry another range.`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '⬅️ Back',
                                    callback_data:
                                        `custom_app:${encodeURIComponent(appName)}`
                                }
                            ]
                        ]
                    }
                }
            );
        }

        const data = result.data;

        const number =
            data.full_number ||
            data.number ||
            data.phone ||
            'Unavailable';

        const country =
            data.country ||
            data.country_name ||
            range;

        // Auto Fast OTP Checker চালু করা হলো
        startFastOtpChecker(chatId, number);

        const keyboard = [
            [
                {
                    text: '🔄 Change Number',
                    callback_data:
                        `get_number:${encodeURIComponent(appName)}:${encodeURIComponent(range)}`
                }
            ],
            [
                {
                    text: '⬅️ Back to Countries',
                    callback_data:
                        `custom_app:${encodeURIComponent(appName)}`
                }
            ],
            [
                {
                    text: '⬅️ Apps Menu',
                    callback_data: 'back_apps'
                }
            ]
        ];

        return bot.editMessageText(
            `⚡ *RIFAT NUMBER SERVICE* ⚡\n\n` +
            `🆔 UID: \`${PUBLIC_UID}\`\n` +
            `🎯 Service: \`${appName}\`\n` +
            `${getCountryFlag(country)} Country: \`${country}\`\n` +
            `📞 Number: \`${maskPhoneNumber(number)}\`\n\n` +
            `✅ Status: *Number Allocated*\n` +
            `⏱️ Validity: *15 Minutes*\n\n` +
            `ℹ️ Waiting for incoming OTP automatically...`,

            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );

    } catch (error) {
        console.error(
            'Number allocation error:',
            error.message
        );

        return bot.editMessageText(
            `❌ *API Error*\n\n${error.message}`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown'
            }
        );
    }
}

// =====================================================
// ADMIN PANEL
// =====================================================

async function showAdmin(chatId) {
    return bot.sendMessage(
        chatId,
        `👑 *ADMIN PANEL*\n\nManage apps and ranges below:`,
        {
            parse_mode: 'Markdown',
            reply_markup: getAdminKeyboard()
        }
    );
}

// =====================================================
// MESSAGE HANDLER
// =====================================================

bot.on('message', async msg => {
    try {
        const chatId = msg.chat.id;

        const text =
            msg.text
                ? msg.text.trim()
                : '';

        if (!text) return;

        if (text.startsWith('/start')) {
            return;
        }

        // ADMIN COMMAND
        if (
            chatId === ADMIN_ID &&
            text === '/admin'
        ) {
            delete userState[chatId];
            return showAdmin(chatId);
        }

        // ADMIN INPUT
        if (
            chatId === ADMIN_ID &&
            userState[chatId]
        ) {
            const state =
                userState[chatId];

            if (
                state.step ===
                'admin_create_app'
            ) {
                const appName =
                    text.trim();

                if (
                    database.customApps[appName]
                ) {
                    return bot.sendMessage(
                        chatId,
                        '❌ App already exists.'
                    );
                }

                database.customApps[appName] = [];

                saveDatabase();

                delete userState[chatId];

                return bot.sendMessage(
                    chatId,
                    `✅ App *${appName}* created.`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup:
                            getAdminKeyboard()
                    }
                );
            }

            if (
                state.step ===
                'admin_add_range'
            ) {
                const range =
                    text.replace(/\s/g, '');

                const appName =
                    state.appName;

                if (
                    !database.customApps[appName]
                ) {
                    delete userState[chatId];

                    return bot.sendMessage(
                        chatId,
                        '❌ App not found.'
                    );
                }

                if (
                    database.customApps[appName]
                        .includes(range)
                ) {
                    return bot.sendMessage(
                        chatId,
                        '⚠️ Range already exists.'
                    );
                }

                database.customApps[appName]
                    .push(range);

                saveDatabase();

                delete userState[chatId];

                return bot.sendMessage(
                    chatId,
                    `✅ Range *${range}* added to *${appName}*.`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup:
                            getAdminKeyboard()
                    }
                );
            }
        }

        // WITHDRAW AMOUNT
        if (
            userState[chatId]?.step ===
            'withdraw_amount'
        ) {
            const amount =
                Number(text);

            const state =
                userState[chatId];

            const data =
                getUserData(chatId);

            const balance =
                data.totalEarned -
                data.totalWithdrawn;

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {
                return bot.sendMessage(
                    chatId,
                    '❌ Enter a valid amount.'
                );
            }

            if (
                amount < MIN_WITHDRAW_AMOUNT
            ) {
                return bot.sendMessage(
                    chatId,
                    `❌ Minimum withdraw is ${MIN_WITHDRAW_AMOUNT} ৳.`
                );
            }

            if (
                amount > balance
            ) {
                return bot.sendMessage(
                    chatId,
                    `❌ Insufficient balance.\n\nAvailable: ${balance.toFixed(2)} ৳`
                );
            }

            userState[chatId] = {
                step: 'withdraw_account',
                amount,
                method: state.method
            };

            return bot.sendMessage(
                chatId,
                `📱 Enter your *${state.method}* account number:`,
                {
                    parse_mode: 'Markdown'
                }
            );
        }

        // WITHDRAW ACCOUNT
        if (
            userState[chatId]?.step ===
            'withdraw_account'
        ) {
            const state =
                userState[chatId];

            const data =
                getUserData(chatId);

            const account =
                text.replace(/\s/g, '');

            if (!account) {
                return bot.sendMessage(
                    chatId,
                    '❌ Enter a valid account number.'
                );
            }

            const balance =
                data.totalEarned -
                data.totalWithdrawn;

            if (
                state.amount > balance
            ) {
                delete userState[chatId];

                return bot.sendMessage(
                    chatId,
                    '❌ Your balance changed. Please try again.'
                );
            }

            const requestId =
                `WD-${Date.now()}`;

            await bot.sendMessage(
                ADMIN_ID,

                `💸 *NEW WITHDRAW REQUEST*\n\n` +
                `🆔 Request: \`${requestId}\`\n` +
                `👤 User: [${data.name}](tg://user?id=${chatId})\n` +
                `💰 Amount: \`${state.amount.toFixed(2)}\` ৳\n` +
                `💳 Method: \`${state.method}\`\n` +
                `📱 Account: \`${account}\``,

                {
                    parse_mode: 'Markdown'
                }
            );

            delete userState[chatId];

            return bot.sendMessage(
                chatId,

                `✅ *Withdrawal Request Submitted*\n\n` +
                `💰 Amount: ${state.amount.toFixed(2)} ৳\n` +
                `💳 Method: ${state.method}\n` +
                `📱 Account: ${account}\n\n` +
                `⏳ Admin will review your request.`,

                {
                    parse_mode: 'Markdown',
                    ...mainKeyboard
                }
            );
        }

        // NORMAL BUTTONS

        if (text.includes('BALANCE')) {
            return sendBalance(chatId);
        }

        if (text.includes('LEADERBOARD')) {
            return sendLeaderboard(chatId);
        }

        if (text.includes('REFER')) {
            return sendRefer(chatId);
        }

        if (text.includes('SUPPORT')) {
            return sendSupport(chatId);
        }

        if (text.includes('WITHDRAW')) {
            return startWithdraw(chatId);
        }

        if (
            text.includes(
                'GET ACTIVE NUMBER'
            )
        ) {
            return showApps(chatId);
        }

    } catch (error) {
        console.error(
            'Message handler error:',
            error
        );
    }
});

// =====================================================
// CALLBACK HANDLER
// =====================================================

bot.on(
    'callback_query',
    async query => {

        try {
            if (
                !query.message ||
                !query.message.chat
            ) {
                return;
            }

            const chatId =
                query.message.chat.id;

            const messageId =
                query.message.message_id;

            const data =
                query.data || '';

            await bot.answerCallbackQuery(
                query.id
            );

            // =================================================
            // ADMIN
            // =================================================

            if (chatId === ADMIN_ID) {

                if (
                    data ===
                    'admin_create'
                ) {
                    userState[chatId] = {
                        step:
                            'admin_create_app'
                    };

                    return bot.sendMessage(
                        chatId,
                        '✍️ Send the new App name:'
                    );
                }

                if (
                    data ===
                    'admin_view'
                ) {
                    const apps =
                        Object.keys(
                            database.customApps
                        );

                    if (!apps.length) {
                        return bot.editMessageText(
                            `📋 *CUSTOM APPS*\n\nNo apps found.`,
                            {
                                chat_id: chatId,
                                message_id: messageId,
                                parse_mode: 'Markdown',
                                reply_markup:
                                    getAdminKeyboard()
                            }
                        );
                    }

                    let text =
                        `📋 *CUSTOM APPS*\n\n`;

                    apps.forEach(app => {
                        const ranges =
                            database.customApps[app];

                        text +=
                            `⭐ *${app}*\n`;

                        text +=
                            ranges.length
                                ? `└ ${ranges.join(', ')}\n\n`
                                : `└ No ranges\n\n`;
                    });

                    return bot.editMessageText(
                        text,
                        {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown',
                            reply_markup:
                                getAdminKeyboard()
                        }
                    );
                }

                if (
                    data ===
                    'admin_delete'
                ) {
                    const apps =
                        Object.keys(
                            database.customApps
                        );

                    if (!apps.length) {
                        return bot.editMessageText(
                            '❌ No apps available.',
                            {
                                chat_id: chatId,
                                message_id: messageId,
                                reply_markup:
                                    getAdminKeyboard()
                            }
                        );
                    }

                    const keyboard =
                        apps.map(app => [
                            {
                                text:
                                    `🗑 ${app}`,
                                callback_data:
                                    `delete_app:${encodeURIComponent(app)}`
                            }
                        ]);

                    keyboard.push([
                        {
                            text: '⬅️ Back',
                            callback_data:
                                'admin_back'
                        }
                    ]);

                    return bot.editMessageText(
                        '🗑 *Select app to delete:*',
                        {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard:
                                    keyboard
                            }
                        }
                    );
                }

                if (
                    data.startsWith(
                        'delete_app:'
                    )
                ) {
                    const app =
                        decodeURIComponent(
                            data.substring(
                                'delete_app:'.length
                            )
                        );

                    delete database.customApps[app];

                    saveDatabase();

                    return bot.editMessageText(
                        `✅ App *${app}* deleted.`,
                        {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown',
                            reply_markup:
                                getAdminKeyboard()
                        }
                    );
                }

                if (
                    data ===
                    'admin_add_range'
                ) {
                    const apps =
                        Object.keys(
                            database.customApps
                        );

                    if (!apps.length) {
                        return bot.editMessageText(
                            '❌ Create an app first.',
                            {
                                chat_id: chatId,
                                message_id: messageId,
                                reply_markup:
                                    getAdminKeyboard()
                            }
                        );
                    }

                    const keyboard =
                        apps.map(app => [
                            {
                                text:
                                    `➕ ${app}`,
                                callback_data:
                                    `select_range:${encodeURIComponent(app)}`
                            }
                        ]);

                    keyboard.push([
                        {
                            text: '⬅️ Back',
                            callback_data:
                                'admin_back'
                        }
                    ]);

                    return bot.editMessageText(
                        '➕ *Select App:*',
                        {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard:
                                    keyboard
                            }
                        }
                    );
                }

                if (
                    data.startsWith(
                        'select_range:'
                    )
                ) {
                    const app =
                        decodeURIComponent(
                            data.substring(
                                'select_range:'.length
                            )
                        );

                    userState[chatId] = {
                        step:
                            'admin_add_range',
                        appName:
                            app
                    };

                    return bot.sendMessage(
                        chatId,
                        `✍️ Send range for *${app}*.\n\nExample: \`880\``,
                        {
                            parse_mode: 'Markdown'
                        }
                    );
                }

                if (
                    data ===
                    'admin_delete_range'
                ) {
                    const apps =
                        Object.keys(
                            database.customApps
                        );

                    if (!apps.length) {
                        return bot.editMessageText(
                            '❌ No apps available.',
                            {
                                chat_id: chatId,
                                message_id: messageId,
                                reply_markup:
                                    getAdminKeyboard()
                            }
                        );
                    }

                    const keyboard =
                        apps.map(app => [
                            {
                                text:
                                    `🗑 ${app}`,
                                callback_data:
                                    `range_app:${encodeURIComponent(app)}`
                            }
                        ]);

                    keyboard.push([
                        {
                            text: '⬅️ Back',
                            callback_data:
                                'admin_back'
                        }
                    ]);

                    return bot.editMessageText(
                        '🗑 *Select App:*',
                        {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard:
                                    keyboard
                            }
                        }
                    );
                }

                if (
                    data.startsWith(
                        'range_app:'
                    )
                ) {
                    const app =
                        decodeURIComponent(
                            data.substring(
                                'range_app:'.length
                            )
                        );

                    const ranges =
                        database.customApps[app] ||
                        [];

                    const keyboard =
                        ranges.map(range => [
                            {
                                text:
                                    `🗑 ${range}`,
                                callback_data:
                                    `delete_range:${encodeURIComponent(app)}:${encodeURIComponent(range)}`
                            }
                        ]);

                    keyboard.push([
                        {
                            text: '⬅️ Back',
                            callback_data:
                                'admin_back'
                        }
                    ]);

                    return bot.editMessageText(
                        `🗑 *${app}* — Select range:`,
                        {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard:
                                    keyboard
                            }
                        }
                    );
                }

                if (
                    data.startsWith(
                        'delete_range:'
                    )
                ) {
                    const parts =
                        data.split(':');

                    const app =
                        decodeURIComponent(
                            parts[1]
                        );

                    const range =
                        decodeURIComponent(
                            parts.slice(2).join(':')
                        );

                    if (
                        database.customApps[app]
                    ) {
                        database.customApps[app] =
                            database.customApps[app]
                                .filter(
                                    item =>
                                        String(item) !==
                                        String(range)
                                );

                        saveDatabase();
                    }

                    return bot.editMessageText(
                        `✅ Range *${range}* deleted from *${app}*.`,
                        {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown',
                            reply_markup:
                                getAdminKeyboard()
                        }
                    );
                }

                if (
                    data ===
                    'admin_back'
                ) {
                    return bot.editMessageText(
                        `👑 *ADMIN PANEL*\n\nManage apps and ranges below:`,
                        {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown',
                            reply_markup:
                                getAdminKeyboard()
                        }
                    );
                }
            }

            // =================================================
            // JOIN CHECK
            // =================================================

            if (
                data ===
                'check_join'
            ) {
                return showApps(
                    chatId,
                    messageId
                );
            }

            // =================================================
            // BACK
            // =================================================

            if (
                data ===
                'back_apps'
            ) {
                return showApps(
                    chatId,
                    messageId
                );
            }

            // =================================================
            // CUSTOM APP
            // =================================================

            if (
                data.startsWith(
                    'custom_app:'
                )
            ) {
                const app =
                    decodeURIComponent(
                        data.substring(
                            'custom_app:'.length
                        )
                    );

                return showCustomApp(
                    chatId,
                    messageId,
                    app
                );
            }

            // =================================================
            // LIVE APP
            // =================================================

            if (
                data.startsWith(
                    'live_app:'
                )
            ) {
                const app =
                    decodeURIComponent(
                        data.substring(
                            'live_app:'.length
                        )
                    );

                return showLiveApp(
                    chatId,
                    messageId,
                    app
                );
            }

            // =================================================
            // NUMBER
            // =================================================

            if (
                data.startsWith(
                    'get_number:'
                )
            ) {
                const parts =
                    data.split(':');

                const app =
                    decodeURIComponent(
                        parts[1]
                    );

                const range =
                    decodeURIComponent(
                        parts.slice(2).join(':')
                    );

                return allocateNumber(
                    chatId,
                    messageId,
                    app,
                    range
                );
            }

            // =================================================
            // WITHDRAW
            // =================================================

            if (
                data.startsWith(
                    'withdraw_'
                )
            ) {
                const methodCode =
                    data.replace(
                        'withdraw_',
                        ''
                    );

                const methods = {
                    bkash: 'bKash',
                    nagad: 'Nagad',
                    rocket: 'Rocket'
                };

                const method =
                    methods[methodCode];

                if (!method) {
                    return;
                }

                userState[chatId] = {
                    step:
                        'withdraw_amount',
                    method
                };

                return bot.editMessageText(
                    `💸 *Withdraw via ${method}*\n\n` +
                    `Enter amount:\n\n` +
                    `Minimum: ${MIN_WITHDRAW_AMOUNT} ৳`,
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown'
                    }
                );
            }

        } catch (error) {
            console.error(
                'Callback error:',
                error
            );
        }
    }
);

// =====================================================
// ERROR HANDLING
// =====================================================

bot.on(
    'polling_error',
    error => {
        console.error(
            'Polling Error:',
            error.message
        );
    }
);

bot.on(
    'error',
    error => {
        console.error(
            'Bot Error:',
            error.message
        );
    }
);

process.on(
    'unhandledRejection',
    error => {
        console.error(
            'Unhandled Rejection:',
            error
        );
    }
);

process.on(
    'uncaughtException',
    error => {
        console.error(
            'Uncaught Exception:',
            error
        );
    }
);

// =====================================================
// BOT CONNECTION
// =====================================================

bot.getMe()
    .then(me => {
        console.log('=================================');
        console.log('BOT CONNECTED');
        console.log('Username:', '@' + me.username);
        console.log('Bot ID:', me.id);
        console.log('=================================');
    })
    .catch(error => {
        console.error(
            'BOT CONNECTION FAILED:',
            error.message
        );
    });

// =====================================================
// RENDER HTTP SERVER
// =====================================================

const server = http.createServer(
    (req, res) => {
        res.writeHead(
            200,
            {
                'Content-Type':
                    'text/plain; charset=utf-8'
            }
        );

        res.end(
            'RIFAT_SMS Bot is active and running!'
        );
    }
);

const PORT =
    process.env.PORT || 10000;

server.listen(
    PORT,
    '0.0.0.0',
    () => {
        console.log(
            `HTTP server listening on port ${PORT}`
        );
    }
);
