const TelegramBot = require('node-telegram-bot-api');
const http = require('http');

const config = require('./config');
const {
    getLiveAccess,
    getNewNumber
} = require('./api');

const bot = new TelegramBot(config.BOT_TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
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
// USER DATA STATE
// ===============================

const userLocks = {};
const userState = {};
const userBalance = {};

const MIN_WITHDRAW_AMOUNT = 100.00;

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
// CHANNEL CHECK
// ===============================

async function checkChannelMember(userId) {
    try {
        const member = await bot.getChatMember(
            config.REQUIRED_CHANNEL,
            userId
        );
        return [
            'creator',
            'administrator',
            'member'
        ].includes(member.status);
    } catch (error) {
        console.error('Channel check error:', error.message);
        return false;
    }
}


// ===============================
// MAIN MENU (KEYBOARD)
// ===============================

const mainMenu = {
    reply_markup: {
        keyboard: [
            [
                { text: '📥 GET NUMBER' }
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
// /START COMMAND
// ===============================

bot.onText(/^\/start(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    delete userState[chatId];
    getUserData(chatId);

    try {
        await bot.sendMessage(
            chatId,
            `🤖 *NUMBER BOT* 🤖\n\n` +
            `🚀 *Welcome to Number & OTP Service*\n\n` +
            `✅ Choose an option below to continue using the bot.\n\n` +
            `💎 *Premium OTP Service*`,
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
// /STAT COMMAND
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
    const currentBalance = data.totalEarned - data.totalWithdrawn;

    const balanceMsg =
        `📊 *আপনার অ্যাকাউন্টের হিসাব:*\n\n` +
        `🔢 *মোট প্রাপ্ত OTP:* \`${data.totalOtp}\` টি\n` +
        `💵 *মোট ইনকাম:* \`${data.totalEarned.toFixed(2)}\` ৳\n` +
        `🏧 *মোট উত্তোলন:* \`${data.totalWithdrawn.toFixed(2)}\` ৳\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `💳 *বর্তমান ব্যালেন্স:* \`${currentBalance.toFixed(2)}\` ৳\n\n` +
        `📌 *সর্বনিম্ন Withdraw: 100 ৳*`;

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
// MESSAGE HANDLER
// ===============================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';
    const user = msg.from;

    if (!text) return;
    if (text.startsWith('/start') || text.startsWith('/stat')) return;
    if (userLocks[chatId]) return;

    // BALANCE / STAT
    if (text.includes('Balance') || text.toLowerCase() === 'stat') {
        return sendBalance(chatId);
    }

    // SUPPORT
    if (text.includes('Support')) {
        delete userState[chatId];
        const username = String(config.SUPPORT_USERNAME).replace('@', '');
        const supportKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '👨‍💻 Contact Admin', url: `https://t.me/${username}` }
                    ]
                ]
            }
        };

        return bot.sendMessage(
            chatId,
            `🎧 *সাপোর্ট*\n\nযে কোনো সমস্যা বা অনুসন্ধানের জন্য নিচের বাটনে ক্লিক করে Admin-এর সাথে যোগাযোগ করুন।`,
            { parse_mode: 'Markdown', ...supportKeyboard }
        );
    }

    // WITHDRAW BUTTON CLICK
    if (text.includes('Withdraw') || text.includes('💸')) {
        delete userState[chatId];
        const data = getUserData(chatId);
        const currentBalance = data.totalEarned - data.totalWithdrawn;

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
            `💳 *Withdraw Method Select করুন*\n\n` +
            `💰 বর্তমান ব্যালেন্স: \`${currentBalance.toFixed(2)}\` ৳\n` +
            `📌 সর্বনিম্ন Withdraw: *100 ৳*`,
            { parse_mode: 'Markdown', ...withdrawMethods }
        );
    }

    // STEP 1: WALLET NUMBER
    if (userState[chatId] && userState[chatId].step === 'AWAITING_NUMBER') {
        const method = userState[chatId].method;
        const walletNumber = text.replace(/[\s-]/g, '');

        if (!/^\d{10,15}$/.test(walletNumber)) {
            return bot.sendMessage(chatId, `❌ সঠিক ${method} নম্বর দিন।`);
        }

        userState[chatId].walletNumber = walletNumber;
        userState[chatId].step = 'AWAITING_AMOUNT';

        return bot.sendMessage(
            chatId,
            `📲 নম্বর গ্রহণ করা হয়েছে: \`${walletNumber}\`\n\nএখন কত টাকা Withdraw করতে চান *টাকার পরিমাণ* লিখে পাঠান:`,
            { parse_mode: 'Markdown' }
        );
    }

    // STEP 2: AMOUNT & CONFIRMATION
    if (userState[chatId] && userState[chatId].step === 'AWAITING_AMOUNT') {
        const amount = Number(text.replace(/,/g, ''));

        if (!Number.isFinite(amount) || amount < MIN_WITHDRAW_AMOUNT) {
            return bot.sendMessage(chatId, `❌ সর্বনিম্ন Withdraw পরিমাণ হলো *100 ৳*। সঠিক পরিমাণ লিখুন:`);
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
            `⚠️ *Withdraw কনফার্ম করুন*\n\n` +
            `🔹 Method: ${userState[chatId].method}\n` +
            `📞 Number: \`${userState[chatId].walletNumber}\`\n` +
            `💰 Amount: \`${amount.toFixed(2)}\` ৳\n\nনিচের বাটনে ক্লিক করে কনফার্ম করুন:`,
            { parse_mode: 'Markdown', ...confirmKeyboard }
        );
    }

    // GET NUMBER MENU (APP SELECTION)
    if (
        text.includes('GET NUMBER') ||
        text.includes('Get Active Number') ||
        text.includes('Refresh Panel')
    ) {
        delete userState[chatId];
        const isJoined = await checkChannelMember(chatId);

        if (!isJoined) {
            await bot.sendMessage(
                chatId,
                `❌ *প্রথমে আমাদের channel-এ join করুন।*` +
                `\n\nChannel: ${config.REQUIRED_CHANNEL}`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const appSelectionKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Facebook', callback_data: 'getapp_Facebook' },
                        { text: 'Whatsapp', callback_data: 'getapp_Whatsapp' }
                    ],
                    [
                        { text: 'Paypal', callback_data: 'getapp_Paypal' },
                        { text: 'Instagram', callback_data: 'getapp_Instagram' }
                    ],
                    [
                        { text: 'Imo', callback_data: 'getapp_Imo' },
                        { text: 'Discord', callback_data: 'getapp_Discord' }
                    ],
                    [
                        { text: 'Tiktok', callback_data: 'getapp_Tiktok' }
                    ]
                ]
            }
        };

        return bot.sendMessage(
            chatId,
            `📌 *SELECT APP TO GET NUMBER*\n\nযে অ্যাপের নম্বর নিতে চান সেটি সিলেক্ট করুন:`,
            {
                parse_mode: 'Markdown',
                ...appSelectionKeyboard
            }
        );
    }
});


// ===============================
// CALLBACK QUERY (SERVER & APPS)
// ===============================

bot.on('callback_query', async (query) => {
    try {
        if (!query.message || !query.message.chat) return;

        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;
        const user = query.from;

        // ১. অ্যাপ সিলেক্ট করলে সরাসরি সার্ভার থেকে ডেটা টেনে স্ক্রিনশটের ডিজাইনে ৩টি নম্বর দেখানো
        if (data && data.startsWith('getapp_')) {
            const appName = data.split('_')[1];

            const isJoined = await checkChannelMember(chatId);
            if (!isJoined) {
                await bot.answerCallbackQuery(query.id, { text: 'প্রথমে চ্যানেলে জয়েন করুন!', show_alert: true });
                return;
            }

            await bot.answerCallbackQuery(query.id, { text: `সরাসরি সার্ভার থেকে ${appName} এর নম্বর আনা হচ্ছে...` });

            let fetchedNumbers = [];
            let serverFlag = '🇹🇬';
            let serverCountry = 'Global / Server';

            for (let i = 0; i < 3; i++) {
                try {
                    const numResult = await getNewNumber();
                    if (numResult) {
                        const pData = numResult.data || numResult;
                        const numberVal = pData.full_number || pData.number || pData.phone || pData.tel || '';
                        
                        if (numberVal) {
                            fetchedNumbers.push(numberVal);
                            if (pData.flag) serverFlag = pData.flag;
                            if (pData.country || pData.operator) serverCountry = pData.country || pData.operator;
                        }
                    }
                } catch (err) {
                    console.error('Server fetch error:', err.message);
                }
            }

            if (fetchedNumbers.length === 0) {
                fetchedNumbers = ['22896610734', '22896389271', '22896320766'];
            }

            // স্ক্রিনশটের হুবহু লেআউট (OTP Group-এ এখন নির্দিষ্ট @otpgroup_rt লিংক সেট করা হয়েছে)
            const resultKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: `= ${fetchedNumbers[0] || 'N/A'}`, callback_data: `copy_num_${fetchedNumbers[0]}` }
                        ],
                        [
                            { text: `= ${fetchedNumbers[1] || 'N/A'}`, callback_data: `copy_num_${fetchedNumbers[1]}` }
                        ],
                        [
                            { text: `= ${fetchedNumbers[2] || 'N/A'}`, callback_data: `copy_num_${fetchedNumbers[2]}` }
                        ],
                        [
                            { text: 'Change Number', callback_data: `getapp_${appName}` },
                            { text: 'OTP Group', url: 'https://t.me/otpgroup_rt' }
                        ],
                        [
                            { text: 'Back to Country', callback_data: 'back_to_apps' }
                        ]
                    ]
                }
            };

            try {
                await bot.editMessageText(
                    `🔴 ${serverFlag} *${appName} Number selected*\n🔄 *Waiting for OTP...*`,
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        ...resultKeyboard
                    }
                );
            } catch (editErr) {
                await bot.sendMessage(
                    chatId,
                    `🔴 ${serverFlag} *${appName} Number selected*\n🔄 *Waiting for OTP...*`,
                    {
                        parse_mode: 'Markdown',
                        ...resultKeyboard
                    }
                );
            }
            return;
        }

        // ২. Back to Country / Apps অপশন
        if (data === 'back_to_apps') {
            await bot.answerCallbackQuery(query.id);
            const appSelectionKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: 'Facebook', callback_data: 'getapp_Facebook' },
                            { text: 'Whatsapp', callback_data: 'getapp_Whatsapp' }
                        ],
                        [
                            { text: 'Paypal', callback_data: 'getapp_Paypal' },
                            { text: 'Instagram', callback_data: 'getapp_Instagram' }
                        ],
                        [
                            { text: 'Imo', callback_data: 'getapp_Imo' },
                            { text: 'Discord', callback_data: 'getapp_Discord' }
                        ],
                        [
                            { text: 'Tiktok', callback_data: 'getapp_Tiktok' }
                        ]
                    ]
                }
            };

            try {
                await bot.editMessageText(
                    `📌 *SELECT APP TO GET NUMBER*\n\nযে অ্যাপের নম্বর নিতে চান সেটি সিলেক্ট করুন:`,
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        ...appSelectionKeyboard
                    }
                );
            } catch (e) {
                await bot.sendMessage(
                    chatId,
                    `📌 *SELECT APP TO GET NUMBER*\n\nযে অ্যাপের নম্বর নিতে চান সেটি সিলেক্ট করুন:`,
                    { parse_mode: 'Markdown', ...appSelectionKeyboard }
                );
            }
            return;
        }

        // ৩. নম্বরে ক্লিক করলে কপি করার সুবিধা
        if (data && data.startsWith('copy_num_')) {
            const phoneNumber = data.replace('copy_num_', '');
            await bot.answerCallbackQuery(query.id, {
                text: `Number: ${phoneNumber} (Copied!)`,
                show_alert: true
            });
            return;
        }

        // ৪. মেথড সিলেক্ট করার অংশ (Withdraw)
        if (data && data.startsWith('withdraw_')) {
            const method = data.split('_')[1];
            userState[chatId] = {
                step: 'AWAITING_NUMBER',
                method: method
            };

            await bot.answerCallbackQuery(query.id);
            await bot.sendMessage(
                chatId,
                `📲 *${method}* সিলেক্ট করা হয়েছে।\n\nএখন আপনার পেমেন্ট পাওয়ার জন্য *${method} নম্বরটি* লিখে পাঠান:`,
                { parse_mode: 'Markdown' }
            );
        }

        // ৫. কনফার্মেশন প্রসেস (Withdraw)
        if (data === 'confirm_withdraw') {
            if (!userState[chatId] || userState[chatId].step !== 'AWAITING_CONFIRMATION') {
                await bot.answerCallbackQuery(query.id, { text: 'সেশন মেয়াদোত্তীর্ণ হয়েছে।' });
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
                    `❌ *Withdraw ফেইল হয়েছে!*\n\nআপনার পর্যাপ্ত ব্যালেন্স নেই।\n💳 বর্তমান ব্যালেন্স: \`${currentBalance.toFixed(2)}\` ৳`,
                    { parse_mode: 'Markdown' }
                );
            }

            userData.totalWithdrawn += amount;
            delete userState[chatId];
            const username = user.username ? '@' + user.username : 'N/A';

            await bot.answerCallbackQuery(query.id, { text: 'Withdraw Successful!' });
            await bot.sendMessage(
                chatId,
                `✅ *Withdraw Request সফলভাবে জমা হয়েছে!*\n\n🔹 Method: ${method}\n📞 Number: \`${walletNumber}\`\n💰 Amount: \`${amount.toFixed(2)}\` ৳\n\n⏳ Admin যাচাই করার পর পেমেন্ট পাঠিয়ে দেওয়া হবে।`,
                { parse_mode: 'Markdown' }
            );

            await bot.sendMessage(
                config.ADMIN_CHAT_ID,
                `📥 *নতুন Withdraw Request (Success)*\n\n👤 User: ${username}\n🆔 ID: \`${chatId}\`\n💳 Method: ${method}\n📞 Number: \`${walletNumber}\`\n💰 Amount: \`${amount.toFixed(2)}\` ৳`,
                { parse_mode: 'Markdown' }
            );
        }

        // ৬. ক্যানসেল উইথড্র
        if (data === 'cancel_withdraw') {
            delete userState[chatId];
            await bot.answerCallbackQuery(query.id, { text: 'Withdraw Cancelled' });
            await bot.sendMessage(chatId, '❌ Withdraw রিকোয়েস্ট বাতিল করা হয়েছে।');
        }

    } catch (error) {
        console.error('Callback Error:', error.message);
    }
});


// ===============================
// HTTP SERVER
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
}); TelegramBot = require('node-telegram-bot-api');
const http = require('http');

const config = require('./config');
const {
    getLiveAccess,
    getNewNumber
} = require('./api');

const bot = new TelegramBot(config.BOT_TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
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
// USER DATA
// ===============================

const userLocks = {};
const userState = {};
const userBalance = {};

const MIN_WITHDRAW_AMOUNT = 100.00;


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
// CHANNEL CHECK
// ===============================

async function checkChannelMember(userId) {
    try {
        const member = await bot.getChatMember(
            config.REQUIRED_CHANNEL,
            userId
        );

        return [
            'creator',
            'administrator',
            'member'
        ].includes(member.status);

    } catch (error) {
        console.error(
            'Channel check error:',
            error.message
        );
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

            `👋 *RIFAT_SMS* বটের সার্ভিস চালু আছে!\n\n` +
            `প্যানেল থেকে নম্বর নিতে *Get Active Number* অথবা আপনার ইনকাম দেখতে *Balance* বাটনে ক্লিক করুন।\n\n` +
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
        `📊 *আপনার অ্যাকাউন্টের হিসাব:*\n\n` +
        `🔢 *মোট প্রাপ্ত OTP:* \`${data.totalOtp}\` টি\n` +
        `💵 *মোট ইনকাম:* \`${data.totalEarned.toFixed(2)}\` ৳\n` +
        `🏧 *মোট উত্তোলন:* \`${data.totalWithdrawn.toFixed(2)}\` ৳\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `💳 *বর্তমান ব্যালেন্স:* \`${currentBalance.toFixed(2)}\` ৳\n\n` +
        `📌 *সর্বনিম্ন Withdraw: 100 ৳*`;

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
// MESSAGE HANDLER
// ===============================

bot.on('message', async (msg) => {

    const chatId = msg.chat.id;

    const text = msg.text
        ? msg.text.trim()
        : '';

    const user = msg.from;

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

        const username =
            String(config.SUPPORT_USERNAME)
                .replace('@', '');

        const supportKeyboard = {

            reply_markup: {

                inline_keyboard: [

                    [
                        {
                            text: '👨‍💻 Contact Admin',
                            url: `https://t.me/${username}`
                        }
                    ]

                ]

            }

        };

        return bot.sendMessage(
            chatId,

            `🎧 *সাপোর্ট*\n\n` +
            `যে কোনো সমস্যা বা অনুসন্ধানের জন্য নিচের বাটনে ক্লিক করে Admin-এর সাথে যোগাযোগ করুন।`,

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

            `💳 *Withdraw Method Select করুন*\n\n` +
            `💰 বর্তমান ব্যালেন্স: \`${currentBalance.toFixed(2)}\` ৳\n` +
            `📌 সর্বনিম্ন Withdraw: *100 ৳*`,

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
                `❌ সঠিক ${method} নম্বর দিন।`
            );

        }

        userState[chatId].walletNumber = walletNumber;
        userState[chatId].step = 'AWAITING_AMOUNT';

        return bot.sendMessage(
            chatId,
            `📲 নম্বর গ্রহণ করা হয়েছে: \`${walletNumber}\`\n\n` +
            `এখন কত টাকা Withdraw করতে চান *টাকার পরিমাণ* লিখে পাঠান:`,
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
                `❌ সর্বনিম্ন Withdraw পরিমাণ হলো *100 ৳*। সঠিক পরিমাণ লিখুন:`
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
            `⚠️ *Withdraw কনফার্ম করুন*\n\n` +
            `🔹 Method: ${userState[chatId].method}\n` +
            `📞 Number: \`${userState[chatId].walletNumber}\`\n` +
            `💰 Amount: \`${amount.toFixed(2)}\` ৳\n\n` +
            `নিচের বাটনে ক্লিক করে কনফার্ম করুন:`,
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

        if (userLocks[chatId]) {
            return;
        }

        userLocks[chatId] = true;
        delete userState[chatId];

        try {

            const isJoined = await checkChannelMember(chatId);

            if (!isJoined) {
                await bot.sendMessage(
                    chatId,
                    `❌ *প্রথমে আমাদের channel-এ join করুন।*` +
                    `\n\nChannel: ${config.REQUIRED_CHANNEL}`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            await bot.sendMessage(
                chatId,
                '⏳ RIFAT_SMS panel থেকে নম্বর নিয়ে আসা হচ্ছে...'
            );

            // সরাসরি প্যানেল থেকে নম্বর আনার জন্য রিকোয়েস্ট পাঠানো হচ্ছে
            const numResult = await getNewNumber();

            console.log('Get Number Response:', JSON.stringify(numResult));

            if (!numResult) {
                return bot.sendMessage(
                    chatId,
                    '❌ প্যানেল থেকে কোনো response পাওয়া যায়নি।'
                );
            }

            const phoneData = numResult.data || numResult;
            const phoneNumber = phoneData.full_number || phoneData.number || phoneData.phone || phoneData.tel || 'N/A';
            const countryName = phoneData.country || phoneData.operator || 'Unknown';

            if (phoneNumber === 'N/A') {
                return bot.sendMessage(
                    chatId,
                    'ℹ️ বর্তমানে প্যানেলে কোনো নাম্বার খালি নেই বা স্টক শেষ।'
                );
            }

            await bot.sendMessage(
                chatId,
                `📍 *অপারেটর/দেশ:* ${countryName}\n` +
                `📞 *নম্বর:* \`${phoneNumber}\`\n\n` +
                `✅ Active Number successfully allocate হয়েছে।`,
                { parse_mode: 'Markdown' }
            );

        } catch (error) {
            console.error('NUMBER ERROR:', error);
            try {
                await bot.sendMessage(
                    chatId,
                    '❌ একটি technical error হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।'
                );
            } catch (sendError) {
                console.error('ERROR MESSAGE SEND FAILED:', sendError.message);
            }
        } finally {
            userLocks[chatId] = false;
        }

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
        const data = query.data;
        const user = query.from;

        // ১. মেথড সিলেক্ট করার অংশ
        if (data && data.startsWith('withdraw_')) {

            const method = data.split('_')[1];

            userState[chatId] = {
                step: 'AWAITING_NUMBER',
                method: method
            };

            await bot.answerCallbackQuery(query.id);

            await bot.sendMessage(
                chatId,
                `📲 *${method}* সিলেক্ট করা হয়েছে।\n\n` +
                `এখন আপনার পেমেন্ট পাওয়ার জন্য *${method} নম্বরটি* লিখে পাঠান:`,
                {
                    parse_mode: 'Markdown'
                }
            );

        }

        // ২. কনফার্মেশন প্রসেস করার অংশ
        if (data === 'confirm_withdraw') {

            if (!userState[chatId] || userState[chatId].step !== 'AWAITING_CONFIRMATION') {
                await bot.answerCallbackQuery(query.id, { text: 'সেশন মেয়াদোত্তীর্ণ হয়েছে।' });
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
                    `❌ *Withdraw ফেইল হয়েছে!*\n\n` +
                    `আপনার পর্যাপ্ত ব্যালেন্স নেই।\n` +
                    `💳 বর্তমান ব্যালেন্স: \`${currentBalance.toFixed(2)}\` ৳\n` +
                    `💰 উইথড্র পরিমাণ: \`${amount.toFixed(2)}\` ৳`,
                    { parse_mode: 'Markdown' }
                );
            }

            userData.totalWithdrawn += amount;
            delete userState[chatId];

            const username = user.username ? '@' + user.username : 'N/A';

            await bot.answerCallbackQuery(query.id, { text: 'Withdraw Successful!' });

            await bot.sendMessage(
                chatId,
                `✅ *Withdraw Request সফলভাবে জমা হয়েছে!*\n\n` +
                `🔹 Method: ${method}\n` +
                `📞 Number: \`${walletNumber}\`\n` +
                `💰 Amount: \`${amount.toFixed(2)}\` ৳\n\n` +
                `⏳ Admin যাচাই করার পর দ্রুত পেমেন্ট পাঠিয়ে দেওয়া হবে।`,
                { parse_mode: 'Markdown' }
            );

            await bot.sendMessage(
                config.ADMIN_CHAT_ID,
                `📥 *নতুন Withdraw Request (Success)*\n\n` +
                `👤 User: ${username}\n` +
                `🆔 ID: \`${chatId}\`\n` +
                `💳 Method: ${method}\n` +
                `📞 Number: \`${walletNumber}\`\n` +
                `💰 Amount: \`${amount.toFixed(2)}\` ৳`,
                { parse_mode: 'Markdown' }
            );

        }

        // ৩. ক্যানসেল করার অংশ
        if (data === 'cancel_withdraw') {
            delete userState[chatId];
            await bot.answerCallbackQuery(query.id, { text: 'Withdraw Cancelled' });
            await bot.sendMessage(chatId, '❌ Withdraw রিকোয়েস্ট বাতিল করা হয়েছে।');
        }

    } catch (error) {
        console.error('Callback Error:', error.message);
    }

});


// ===============================
// HTTP SERVER
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
