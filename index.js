const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const fs = require('fs');
const path = require('path');

const config = require('./config');

// =====================================================
// BOT
// =====================================================

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

// =====================================================
// CONFIG
// =====================================================

const ADMIN_ID = 6315111273;

const PUBLIC_UID = 'MQUPBWI9AQJ';
const METHOD_CHANNEL = '@otpmethod_r';

const MIN_WITHDRAW_AMOUNT = 100.00;
const OTP_REWARD_AMOUNT = 0.70;

// =====================================================
// ADMIN DATA
// =====================================================

const ADMIN_DATA_FILE = path.join(
    __dirname,
    'admin_data.json'
);

function loadAdminData() {

    try {

        if (!fs.existsSync(ADMIN_DATA_FILE)) {

            const initialData = {
                apps: [],
                ranges: []
            };

            fs.writeFileSync(
                ADMIN_DATA_FILE,
                JSON.stringify(initialData, null, 2)
            );

            return initialData;
        }

        const raw = fs.readFileSync(
            ADMIN_DATA_FILE,
            'utf8'
        );

        const parsed = JSON.parse(raw);

        return {
            apps: Array.isArray(parsed.apps)
                ? parsed.apps
                : [],

            ranges: Array.isArray(parsed.ranges)
                ? parsed.ranges
                : []
        };

    } catch (error) {

        console.error(
            'Admin data load error:',
            error
        );

        return {
            apps: [],
            ranges: []
        };
    }
}

let adminData = loadAdminData();

function saveAdminData() {

    try {

        fs.writeFileSync(
            ADMIN_DATA_FILE,
            JSON.stringify(
                adminData,
                null,
                2
            )
        );

    } catch (error) {

        console.error(
            'Admin data save error:',
            error
        );
    }
}

// =====================================================
// ADMIN SECURITY
// =====================================================

function isAdmin(userId) {
    return Number(userId) === ADMIN_ID;
}

const adminStates = {};

// =====================================================
// USER DATA
// =====================================================

const userState = {};
const userBalance = {};

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

// =====================================================
// PHONE MASK
// =====================================================

function maskPhoneNumber(num) {

    const cleaned = String(num).trim();

    if (cleaned.length <= 7) {
        return cleaned;
    }

    return (
        cleaned.slice(0, 6) +
        'xxxx' +
        cleaned.slice(-3)
    );
}

// =====================================================
// COUNTRY FLAG
// =====================================================

function getCountryFlag(countryInput) {

    if (!countryInput) {
        return '🌐';
    }

    let str = String(countryInput)
        .trim()
        .toUpperCase();

    const countryMap = {

        AFGHANISTAN: 'AF',
        ALBANIA: 'AL',
        ALGERIA: 'DZ',
        ARGENTINA: 'AR',
        AUSTRALIA: 'AU',
        AUSTRIA: 'AT',
        AZERBAIJAN: 'AZ',

        BAHRAIN: 'BH',
        BANGLADESH: 'BD',
        BELARUS: 'BY',
        BELGIUM: 'BE',
        BHUTAN: 'BT',
        BRAZIL: 'BR',
        BULGARIA: 'BG',

        CAMBODIA: 'KH',
        CANADA: 'CA',
        CHILE: 'CL',
        CHINA: 'CN',
        COLOMBIA: 'CO',
        CROATIA: 'HR',
        CYPRUS: 'CY',
        CZECHIA: 'CZ',

        DENMARK: 'DK',
        EGYPT: 'EG',
        ESTONIA: 'EE',
        FINLAND: 'FI',
        FRANCE: 'FR',

        GEORGIA: 'GE',
        GERMANY: 'DE',
        GHANA: 'GH',
        GREECE: 'GR',

        INDIA: 'IN',
        INDONESIA: 'ID',
        IRAN: 'IR',
        IRAQ: 'IQ',
        IRELAND: 'IE',
        ISRAEL: 'IL',
        ITALY: 'IT',

        JAPAN: 'JP',
        JORDAN: 'JO',

        KAZAKHSTAN: 'KZ',
        KENYA: 'KE',
        KUWAIT: 'KW',

        MALAYSIA: 'MY',
        MALDIVES: 'MV',
        MEXICO: 'MX',
        MOROCCO: 'MA',
        MYANMAR: 'MM',

        NEPAL: 'NP',
        NETHERLANDS: 'NL',
        NEW_ZEALAND: 'NZ',
        NIGERIA: 'NG',
        NORWAY: 'NO',

        OMAN: 'OM',

        PAKISTAN: 'PK',
        PHILIPPINES: 'PH',
        POLAND: 'PL',
        PORTUGAL: 'PT',

        QATAR: 'QA',

        ROMANIA: 'RO',
        RUSSIA: 'RU',

        SAUDI_ARABIA: 'SA',
        SERBIA: 'RS',
        SINGAPORE: 'SG',
        SLOVAKIA: 'SK',
        SOUTH_AFRICA: 'ZA',
        SOUTH_KOREA: 'KR',
        SPAIN: 'ES',
        SRI_LANKA: 'LK',
        SWEDEN: 'SE',
        SWITZERLAND: 'CH',

        TAIWAN: 'TW',
        THAILAND: 'TH',
        TURKEY: 'TR',

        UKRAINE: 'UA',
        UAE: 'AE',
        UNITED_ARAB_EMIRATES: 'AE',
        UK: 'GB',
        UNITED_KINGDOM: 'GB',
        USA: 'US',
        UNITED_STATES: 'US',

        UZBEKISTAN: 'UZ',
        VIETNAM: 'VN'
    };

    if (countryMap[str]) {
        str = countryMap[str];
    }

    if (
        str.length === 2 &&
        /^[A-Z]{2}$/.test(str)
    ) {

        const codePoints = [...str].map(
            char => 127397 + char.charCodeAt(0)
        );

        return String.fromCodePoint(
            ...codePoints
        );
    }

    return '🌐';
}

// =====================================================
// MAIN MENU
// =====================================================

function getMainMenu(userId) {

    const keyboard = [

        [
            {
                text: '🟢 GET ACTIVE NUMBER'
            },
            {
                text: '🟢 BALANCE'
            }
        ],

        [
            {
                text: '🔵 REFER & EARN'
            },
            {
                text: '🏆 LEADERBOARD'
            }
        ],

        [
            {
                text: '🟢 SUPPORT'
            },
            {
                text: '💸 WITHDRAW'
            }
        ]
    ];

    if (isAdmin(userId)) {

        keyboard.push([
            {
                text: '👑 ADMIN PANEL'
            }
        ]);
    }

    return {
        reply_markup: {
            keyboard,
            resize_keyboard: true
        }
    };
}

// =====================================================
// ADMIN KEYBOARD
// =====================================================

function getAdminKeyboard() {

    return {
        reply_markup: {
            inline_keyboard: [

                [
                    {
                        text: '➕ Add App',
                        callback_data: 'admin_add_app'
                    },
                    {
                        text: '🗑️ Delete App',
                        callback_data: 'admin_delete_app'
                    }
                ],

                [
                    {
                        text: '➕ Add Range',
                        callback_data: 'admin_add_range'
                    },
                    {
                        text: '🗑️ Delete Range',
                        callback_data: 'admin_delete_range'
                    }
                ],

                [
                    {
                        text: '📱 App List',
                        callback_data: 'admin_apps'
                    },
                    {
                        text: '📋 Range List',
                        callback_data: 'admin_ranges'
                    }
                ],

                [
                    {
                        text: '🏠 Main Menu',
                        callback_data: 'admin_main'
                    }
                ]
            ]
        }
    };
}

// =====================================================
// ADMIN PANEL
// =====================================================

async function sendAdminPanel(
    chatId,
    messageId = null
) {

    const text =
        `👑 *ADMIN PANEL*\n\n` +
        `🆔 Admin ID: \`${ADMIN_ID}\`\n\n` +
        `📱 Apps: ${adminData.apps.length}\n` +
        `📋 Ranges: ${adminData.ranges.length}\n\n` +
        `নিচের অপশন থেকে Control করুন।`;

    if (messageId) {

        return bot.editMessageText(
            text,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                ...getAdminKeyboard()
            }
        );

    }

    return bot.sendMessage(
        chatId,
        text,
        {
            parse_mode: 'Markdown',
            ...getAdminKeyboard()
        }
    );
}

// =====================================================
// START
// =====================================================

bot.onText(
    /^\/start(?:@\w+)?$/,
    async (msg) => {

        const chatId = msg.chat.id;

        delete userState[chatId];

        getUserData(chatId);

        await bot.sendMessage(
            chatId,

            `👋 *RIFAT_SMS Bot Service Active!*\n\n` +

            `🆔 *UID:* \`${PUBLIC_UID}\`\n` +

            `💰 *Per OTP Reward:* ` +
            `${OTP_REWARD_AMOUNT} ৳\n` +

            `⏱️ *Time Limit:* 15 Minutes\n\n` +

            `Select an option below.`,

            {
                parse_mode: 'Markdown',
                ...getMainMenu(msg.from.id)
            }
        );
    }
);

// =====================================================
// ADMIN COMMAND
// =====================================================

bot.onText(
    /^\/admin(?:@\w+)?$/,
    async (msg) => {

        if (!isAdmin(msg.from.id)) {

            return bot.sendMessage(
                msg.chat.id,
                '⛔ Access Denied'
            );
        }

        delete adminStates[msg.from.id];

        return sendAdminPanel(
            msg.chat.id
        );
    }
);

// =====================================================
// BALANCE
// =====================================================

async function sendBalance(chatId) {

    delete userState[chatId];

    const data = getUserData(chatId);

    const currentBalance =
        data.totalEarned -
        data.totalWithdrawn;

    const text =

        `📊 *Your Account Statement*\n\n` +

        `🆔 *Public UID:* ` +
        `\`${PUBLIC_UID}\`\n` +

        `🔢 *Total Received OTP:* ` +
        `\`${data.totalOtp}\`\n` +

        `💵 *Total Earnings:* ` +
        `\`${data.totalEarned.toFixed(2)}\` ৳\n` +

        `🏧 *Total Withdrawal:* ` +
        `\`${data.totalWithdrawn.toFixed(2)}\` ৳\n` +

        `━━━━━━━━━━━━━━━━━━\n` +

        `💳 *Current Balance:* ` +
        `\`${currentBalance.toFixed(2)}\` ৳\n\n` +

        `📌 *Minimum Withdraw:* ` +
        `${MIN_WITHDRAW_AMOUNT} ৳`;

    return bot.sendMessage(
        chatId,
        text,
        {
            parse_mode: 'Markdown',
            ...getMainMenu(chatId)
        }
    );
}

// =====================================================
// MESSAGE HANDLER
// =====================================================

bot.on(
    'message',
    async (msg) => {

        const chatId = msg.chat.id;

        const text = msg.text
            ? msg.text.trim()
            : '';

        if (!text) return;

        if (
            text.startsWith('/start') ||
            text.startsWith('/admin')
        ) {
            return;
        }

        // =================================================
        // ADMIN TEXT INPUT
        // =================================================

        if (
            isAdmin(msg.from.id) &&
            adminStates[msg.from.id]
        ) {

            const state =
                adminStates[msg.from.id];

            // ---------------------------------------------
            // ADD APP
            // ---------------------------------------------

            if (
                state.action === 'add_app'
            ) {

                const appName =
                    text.trim();

                if (!appName) {

                    return bot.sendMessage(
                        chatId,
                        '❌ App name খালি রাখা যাবে না।'
                    );
                }

                const exists =
                    adminData.apps.some(
                        app =>
                            app.name.toLowerCase() ===
                            appName.toLowerCase()
                    );

                if (exists) {

                    delete adminStates[
                        msg.from.id
                    ];

                    return bot.sendMessage(
                        chatId,
                        '⚠️ এই App আগে থেকেই আছে।'
                    );
                }

                adminData.apps.push({
                    id: Date.now(),
                    name: appName
                });

                saveAdminData();

                delete adminStates[
                    msg.from.id
                ];

                return bot.sendMessage(
                    chatId,

                    `✅ *App Added Successfully*\n\n` +
                    `📱 ${appName}`,

                    {
                        parse_mode: 'Markdown',
                        ...getAdminKeyboard()
                    }
                );
            }

            // ---------------------------------------------
            // ADD RANGE LABEL
            // ---------------------------------------------

            if (
                state.action === 'add_range'
            ) {

                const rangeValue =
                    text.trim();

                if (!rangeValue) {

                    return bot.sendMessage(
                        chatId,
                        '❌ Range খালি রাখা যাবে না।'
                    );
                }

                const exists =
                    adminData.ranges.some(
                        range =>
                            range.value ===
                            rangeValue
                    );

                if (exists) {

                    delete adminStates[
                        msg.from.id
                    ];

                    return bot.sendMessage(
                        chatId,
                        '⚠️ এই Range আগে থেকেই আছে।'
                    );
                }

                adminData.ranges.push({
                    id: Date.now(),
                    value: rangeValue
                });

                saveAdminData();

                delete adminStates[
                    msg.from.id
                ];

                return bot.sendMessage(
                    chatId,

                    `✅ *Range Added Successfully*\n\n` +
                    `📋 ${rangeValue}`,

                    {
                        parse_mode: 'Markdown',
                        ...getAdminKeyboard()
                    }
                );
            }
        }

        // =================================================
        // NORMAL USER MENU
        // =================================================

        if (
            text.includes('BALANCE') ||
            text.toLowerCase() === 'stat'
        ) {

            return sendBalance(chatId);
        }

        if (
            text.includes('SUPPORT')
        ) {

            const supportKeyboard = {

                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '👨‍💻 Contact Admin',
                                url:
                                    `https://t.me/` +
                                    `${config.SUPPORT_USERNAME}`
                            }
                        ]
                    ]
                }
            };

            return bot.sendMessage(
                chatId,

                `🎧 *Support*\n\n` +
                `For any issues, contact Admin.`,

                {
                    parse_mode: 'Markdown',
                    ...supportKeyboard
                }
            );
        }

        if (
            text === '👑 ADMIN PANEL'
        ) {

            if (!isAdmin(msg.from.id)) {

                return bot.sendMessage(
                    chatId,
                    '⛔ Access Denied'
                );
            }

            return sendAdminPanel(
                chatId
            );
        }

        if (
            text.includes(
                'GET ACTIVE NUMBER'
            )
        ) {

            return bot.sendMessage(
                chatId,

                `📱 *Service Menu*\n\n` +
                `The number-allocation feature remains connected to your existing API implementation.\n\n` +
                `Use your existing service flow here.`,

                {
                    parse_mode: 'Markdown',
                    ...getMainMenu(
                        msg.from.id
                    )
                }
            );
        }
    }
);

// =====================================================
// CALLBACK QUERY
// =====================================================

bot.on(
    'callback_query',
    async (query) => {

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
                query.data;

            const userId =
                query.from.id;

            // =============================================
            // ADMIN SECURITY
            // =============================================

            if (
                data.startsWith('admin_') ||
                data.startsWith(
                    'delete_admin_app_'
                ) ||
                data.startsWith(
                    'delete_admin_range_'
                )
            ) {

                if (!isAdmin(userId)) {

                    return bot.answerCallbackQuery(
                        query.id,
                        {
                            text:
                                '⛔ Admin access required',
                            show_alert: true
                        }
                    );
                }
            }

            // =============================================
            // ADMIN HOME
            // =============================================

            if (
                data === 'admin_main'
            ) {

                await bot.answerCallbackQuery(
                    query.id
                );

                delete adminStates[userId];

                return bot.sendMessage(
                    chatId,
                    `🏠 Main Menu`,
                    getMainMenu(userId)
                );
            }

            // =============================================
            // ADD APP
            // =============================================

            if (
                data === 'admin_add_app'
            ) {

                adminStates[userId] = {
                    action: 'add_app'
                };

                await bot.answerCallbackQuery(
                    query.id
                );

                return bot.sendMessage(
                    chatId,

                    `➕ *ADD APP*\n\n` +
                    `App-এর নাম পাঠান।\n\n` +
                    `উদাহরণ:\n` +
                    `Facebook`,

                    {
                        parse_mode: 'Markdown'
                    }
                );
            }

            // =============================================
            // DELETE APP MENU
            // =============================================

            if (
                data === 'admin_delete_app'
            ) {

                await bot.answerCallbackQuery(
                    query.id
                );

                if (
                    adminData.apps.length === 0
                ) {

                    return bot.sendMessage(
                        chatId,
                        '📭 কোনো App নেই।'
                    );
                }

                const buttons =
                    adminData.apps.map(
                        (app, index) => [

                            {
                                text:
                                    `🗑️ ${app.name}`,

                                callback_data:
                                    `delete_admin_app_${index}`
                            }
                        ]
                    );

                buttons.push([
                    {
                        text: '⬅️ Back',
                        callback_data:
                            'admin_panel'
                    }
                ]);

                return bot.sendMessage(
                    chatId,

                    `🗑️ *Delete App*\n\n` +
                    `যে App মুছতে চান নির্বাচন করুন:`,

                    {
                        parse_mode: 'Markdown',

                        reply_markup: {
                            inline_keyboard:
                                buttons
                        }
                    }
                );
            }

            // =============================================
            // DELETE APP
            // =============================================

            if (
                data.startsWith(
                    'delete_admin_app_'
                )
            ) {

                const index =
                    Number(
                        data.replace(
                            'delete_admin_app_',
                            ''
                        )
                    );

                if (
                    !adminData.apps[index]
                ) {

                    return bot.answerCallbackQuery(
                        query.id,
                        {
                            text:
                                'App পাওয়া যায়নি।',
                            show_alert: true
                        }
                    );
                }

                const removed =
                    adminData.apps.splice(
                        index,
                        1
                    )[0];

                saveAdminData();

                await bot.answerCallbackQuery(
                    query.id,
                    {
                        text:
                            'App deleted'
                    }
                );

                return sendAdminPanel(
                    chatId
                );
            }

            // =============================================
            // ADD RANGE
            // =============================================

            if (
                data === 'admin_add_range'
            ) {

                adminStates[userId] = {
                    action: 'add_range'
                };

                await bot.answerCallbackQuery(
                    query.id
                );

                return bot.sendMessage(
                    chatId,

                    `➕ *ADD RANGE LABEL*\n\n` +
                    `Range-এর label/value পাঠান।\n\n` +
                    `উদাহরণ:\n` +
                    `BD-01\n` +
                    `AE-02`,

                    {
                        parse_mode: 'Markdown'
                    }
                );
            }

            // =============================================
            // APP LIST
            // =============================================

            if (
                data === 'admin_apps'
            ) {

                await bot.answerCallbackQuery(
                    query.id
                );

                if (
                    adminData.apps.length === 0
                ) {

                    return bot.sendMessage(
                        chatId,
                        '📭 কোনো App নেই।'
                    );
                }

                let text =
                    `📱 *APP LIST*\n\n`;

                adminData.apps.forEach(
                    (app, index) => {

                        text +=
                            `${index + 1}. ` +
                            `${app.name}\n`;
                    }
                );

                return bot.sendMessage(
                    chatId,
                    text,
                    {
                        parse_mode: 'Markdown',

                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text:
                                            '⬅️ Back',

                                        callback_data:
                                            'admin_panel'
                                    }
                                ]
                            ]
                        }
                    }
                );
            }

            // =============================================
            // RANGE LIST
            // =============================================

            if (
                data === 'admin_ranges'
            ) {

                await bot.answerCallbackQuery(
                    query.id
                );

                if (
                    adminData.ranges.length === 0
                ) {

                    return bot.sendMessage(
                        chatId,
                        '📭 কোনো Range নেই।'
                    );
                }

                let text =
                    `📋 *RANGE LIST*\n\n`;

                adminData.ranges.forEach(
                    (range, index) => {

                        text +=
                            `${index + 1}. ` +
                            `\`${range.value}\`\n`;
                    }
                );

                return bot.sendMessage(
                    chatId,
                    text,
                    {
                        parse_mode: 'Markdown',

                        reply_markup: {
                            inline_keyboard: [

                                [
                                    {
                                        text:
                                            '🗑️ Delete Range',

                                        callback_data:
                                            'admin_delete_range'
                                    }
                                ],

                                [
                                    {
                                        text:
                                            '⬅️ Back',

                                        callback_data:
                                            'admin_panel'
                                    }
                                ]
                            ]
                        }
                    }
                );
            }

            // =============================================
            // DELETE RANGE MENU
            // =============================================

            if (
                data === 'admin_delete_range'
            ) {

                await bot.answerCallbackQuery(
                    query.id
                );

                if (
                    adminData.ranges.length === 0
                ) {

                    return bot.sendMessage(
                        chatId,
                        '📭 কোনো Range নেই।'
                    );
                }

                const buttons =
                    adminData.ranges.map(
                        (range, index) => [

                            {
                                text:
                                    `🗑️ ${range.value}`,

                                callback_data:
                                    `delete_admin_range_${index}`
                            }
                        ]
                    );

                buttons.push([
                    {
                        text: '⬅️ Back',
                        callback_data:
                            'admin_panel'
                    }
                ]);

                return bot.sendMessage(
                    chatId,

                    `🗑️ *Delete Range*\n\n` +
                    `যে Range মুছতে চান নির্বাচন করুন:`,

                    {
                        parse_mode: 'Markdown',

                        reply_markup: {
                            inline_keyboard:
                                buttons
                        }
                    }
                );
            }

            // =============================================
            // DELETE RANGE
            // =============================================

            if (
                data.startsWith(
                    'delete_admin_range_'
                )
            ) {

                const index =
                    Number(
                        data.replace(
                            'delete_admin_range_',
                            ''
                        )
                    );

                if (
                    !adminData.ranges[index]
                ) {

                    return bot.answerCallbackQuery(
                        query.id,
                        {
                            text:
                                'Range পাওয়া যায়নি।',
                            show_alert: true
                        }
                    );
                }

                const removed =
                    adminData.ranges.splice(
                        index,
                        1
                    )[0];

                saveAdminData();

                await bot.answerCallbackQuery(
                    query.id,
                    {
                        text:
                            'Range deleted'
                    }
                );

                return sendAdminPanel(
                    chatId
                );
            }

            // =============================================
            // ADMIN PANEL
            // =============================================

            if (
                data === 'admin_panel'
            ) {

                await bot.answerCallbackQuery(
                    query.id
                );

                return sendAdminPanel(
                    chatId,
                    messageId
                );
            }

        } catch (error) {

            console.error(
                'Callback Error:',
                error
            );

            try {

                await bot.answerCallbackQuery(
                    query.id,
                    {
                        text:
                            'Something went wrong',
                        show_alert: true
                    }
                );

            } catch (_) {}
        }
    }
);

// =====================================================
// ERROR HANDLING
// =====================================================

process.on(
    'unhandledRejection',
    (reason) => {

        console.error(
            'Unhandled Rejection:',
            reason
        );
    }
);

process.on(
    'uncaughtException',
    (error) => {

        console.error(
            'Uncaught Exception:',
            error
        );
    }
);

bot.on(
    'polling_error',
    (error) => {

        console.error(
            'Polling Error:',
            error.message
        );
    }
);

bot.on(
    'error',
    (error) => {

        console.error(
            'Bot Error:',
            error.message
        );
    }
);

// =====================================================
// TELEGRAM CONNECTION CHECK
// =====================================================

bot.getMe()

    .then(
        (me) => {

            console.log(
                '================================='
            );

            console.log(
                'BOT CONNECTED'
            );

            console.log(
                'Username:',
                '@' + me.username
            );

            console.log(
                'Bot ID:',
                me.id
            );

            console.log(
                'Admin ID:',
                ADMIN_ID
            );

            console.log(
                '================================='
            );
        }
    )

    .catch(
        (error) => {

            console.error(
                'BOT CONNECTION FAILED:',
                error.message
            );
        }
    );

// =====================================================
// HTTP SERVER — RENDER
// =====================================================

const server =
    http.createServer(
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
            `Server is listening on port ${PORT}`
        );
    }
);
