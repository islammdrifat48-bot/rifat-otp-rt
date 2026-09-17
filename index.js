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
        text === '💰 Balance' ||
        text === 'Balance' ||
        text.toLowerCase() === 'stat'
    ) {

        return sendBalance(chatId);

    }


    // ===========================
    // SUPPORT
    // ===========================

    if (
        text === '💬 Support' ||
        text === 'Support'
    ) {

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

    if (
        text === '💸 Withdraw' ||
        text === 'Withdraw' ||
        text === '💳 Withdraw'
    ) {

        delete userState[chatId];

        const data = getUserData(chatId);

        const currentBalance =
            data.totalEarned -
            data.totalWithdrawn;


        if (currentBalance < MIN_WITHDRAW_AMOUNT) {

            return bot.sendMessage(

                chatId,

                `⚠️ *উইথড্র করা যাবে না!*\n\n` +
                `সর্বনিম্ন Withdraw: *100 ৳*\n` +
                `💳 বর্তমান ব্যালেন্স: \`${currentBalance.toFixed(2)}\` ৳`,

                {
                    parse_mode: 'Markdown'
                }

            );

        }


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
            `💰 বর্তমান ব্যালেন্স: \`${currentBalance.toFixed(2)}\` ৳`,

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
    // STEP 2: RECEIVE AMOUNT & PROCESS
    // ===========================

    if (
        userState[chatId] &&
        userState[chatId].step === 'AWAITING_AMOUNT'
    ) {

        const amount = Number(text.replace(/,/g, ''));
        const method = userState[chatId].method;
        const walletNumber = userState[chatId].walletNumber;

        const data = getUserData(chatId);
        const currentBalance = data.totalEarned - data.totalWithdrawn;

        // ব্যালেন্স বা পরিমাণ ঠিক না থাকলে ফেল দেখাবে এবং এডমিনের কাছে যাবে না
        if (
            !Number.isFinite(amount) ||
            amount < MIN_WITHDRAW_AMOUNT ||
            amount > currentBalance
        ) {

            delete userState[chatId];

            return bot.sendMessage(
                chatId,
                `❌ *Withdraw ফেইল হয়েছে!*\n\n` +
                `আপনার পর্যাপ্ত ব্যালেন্স নেই অথবা সঠিক পরিমাণ প্রদান করেননি।\n` +
                `💳 বর্তমান ব্যালেন্স: \`${currentBalance.toFixed(2)}\` ৳\n` +
                `📌 সর্বনিম্ন Withdraw: *100 ৳*`,
                {
                    parse_mode: 'Markdown'
                }
            );

        }

        // সফল হলে উইথড্র অ্যামাউন্ট ব্যালেন্স থেকে মাইনাস হবে
        data.totalWithdrawn += amount;
        delete userState[chatId];

        const username = user.username ? '@' + user.username : 'N/A';

        try {

            // ইউজারের কাছে সফল মেসেজ
            await bot.sendMessage(
                chatId,
                `✅ *Withdraw Request সফলভাবে জমা হয়েছে!*\n\n` +
                `🔹 Method: ${method}\n` +
                `📞 Number: \`${walletNumber}\`\n` +
                `💰 Amount: \`${amount.toFixed(2)}\` ৳\n\n` +
                `⏳ Admin যাচাই করার পর দ্রুত পেমেন্ট পাঠিয়ে দেওয়া হবে।`,
                {
                    parse_mode: 'Markdown'
                }
            );

            // এডমিনের কাছে রিকোয়েস্ট মেসেজ
            await bot.sendMessage(
                config.ADMIN_CHAT_ID,
                `📥 *নতুন Withdraw Request*\n\n` +
                `👤 User: ${username}\n` +
                `🆔 ID: \`${chatId}\`\n` +
                `💳 Method: ${method}\n` +
                `📞 Number: \`${walletNumber}\`\n` +
                `💰 Amount: \`${amount.toFixed(2)}\` ৳`,
                {
                    parse_mode: 'Markdown'
                }
            );

        } catch (error) {
            console.error('Withdraw send error:', error.message);
            return bot.sendMessage(chatId, '❌ Request পাঠাতে সমস্যা হয়েছে।');
        }

        return;

    }


    // ===========================
    // GET ACTIVE NUMBER / REFRESH
    // ===========================

    if (
        text === '📱 Get Active Number' ||
        text === '🔄 Refresh Panel'
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
                '⏳ RIFAT_SMS panel থেকে live active number চেক করা হচ্ছে...'
            );

            const liveData = await getLiveAccess();

            if (
                !liveData ||
                !liveData.data ||
                !Array.isArray(liveData.data.services)
            ) {
                return bot.sendMessage(
                    chatId,
                    '❌ Panel থেকে কোনো valid data পাওয়া যায়নি।'
                );
            }

            let targetRange = null;

            for (const service of liveData.data.services) {
                if (service.ranges && service.ranges.length > 0) {
                    const cleaned = String(service.ranges[0]).replace(/[^0-9]/g, '');
                    if (cleaned) {
                        targetRange = cleaned;
                        break;
                    }
                }
            }

            if (!targetRange) {
                return bot.sendMessage(
                    chatId,
                    'ℹ️ বর্তমানে কোনো active range পাওয়া যায়নি।'
                );
            }

            const numResult = await getNewNumber(targetRange);

            if (!numResult || !numResult.data) {
                return bot.sendMessage(
                    chatId,
                    '❌ Number allocate করতে ব্যর্থ হয়েছে।'
                );
            }

            const phoneData = numResult.data;
            const phoneNumber = phoneData.full_number || phoneData.number || 'N/A';
            const countryName = phoneData.country || 'Unknown';

            await bot.sendMessage(
                chatId,
                `📍 *দেশ:* ${countryName}\n` +
                `📞 *নম্বর:* \`${phoneNumber}\`\n\n` +
                `✅ Active Number successfully allocated হয়েছে।`,
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
// CALLBACK QUERY (METHOD SELECTION)
// ===============================

bot.on('callback_query', async (query) => {

    try {

        if (!query.message || !query.message.chat) {
            return;
        }

        const chatId = query.message.chat.id;
        const data = query.data;

        if (data && data.startsWith('withdraw_')) {

            const method = data.split('_')[1];

            // প্রথমে মেথড সিলেক্ট করার পর নম্বর চাওয়ার স্টেপ সেট করা হলো
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
