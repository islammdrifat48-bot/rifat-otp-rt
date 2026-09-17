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

        // API error হলে access দেওয়া হবে না
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
                { text: '📱 Get Numbers' },
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

    console.log(
        `/start received from user: ${chatId}`
    );

    try {

        await bot.sendMessage(
            chatId,

            `👋 *RIFAT_SMS* বটের সার্ভিস চালু আছে!

` +
            `প্যানেল থেকে নম্বর নিতে *Get Numbers* ` +
            `অথবা আপনার ইনকাম দেখতে *Balance* বাটনে ক্লিক করুন।

` +
            `📌 *Minimum Withdraw: 100 ৳*`,

            {
                parse_mode: 'Markdown',
                reply_markup: mainMenu.reply_markup
            }
        );

    } catch (error) {

        console.error(
            'START SEND ERROR:',
            error.message
        );

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
        `📊 *আপনার অ্যাকাউন্টের হিসাব:*

` +
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

        console.error(
            'Balance error:',
            error.message
        );

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

    // /start এবং /stat আলাদা handler-এ আছে
    if (
        text.startsWith('/start') ||
        text.startsWith('/stat')
    ) {
        return;
    }

    // Locked হলে duplicate request বন্ধ
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

            `🎧 *সাপোর্ট*

` +
            `যে কোনো সমস্যা বা অনুসন্ধানের জন্য ` +
            `নিচের বাটনে ক্লিক করে Admin-এর সাথে যোগাযোগ করুন।`,

            {
                parse_mode: 'Markdown',
                ...supportKeyboard
            }
        );

    }


    // ===========================
    // WITHDRAW
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

                `⚠️ *উইথড্র করা যাবে না!*

` +
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

            `💳 *Withdraw Method Select করুন*

` +
            `💰 বর্তমান ব্যালেন্স: \`${currentBalance.toFixed(2)}\` ৳`,

            {
                parse_mode: 'Markdown',
                ...withdrawMethods
            }

        );

    }


    // ===========================
    // WITHDRAW AMOUNT
    // ===========================

    if (
        userState[chatId] &&
        userState[chatId].step === 'AWAITING_AMOUNT'
    ) {

        const amount =
            Number(text.replace(/,/g, ''));

        const data =
            getUserData(chatId);

        const currentBalance =
            data.totalEarned -
            data.totalWithdrawn;


        if (
            !Number.isFinite(amount) ||
            amount < MIN_WITHDRAW_AMOUNT ||
            amount > currentBalance
        ) {

            delete userState[chatId];

            return bot.sendMessage(

                chatId,

                `❌ *Withdraw ব্যর্থ!*

` +
                `সঠিক amount দিন এবং আপনার balance-এর মধ্যে থাকতে হবে।`,

                {
                    parse_mode: 'Markdown'
                }

            );

        }


        userState[chatId].amount =
            Number(amount.toFixed(2));

        userState[chatId].step =
            'AWAITING_NUMBER';


        return bot.sendMessage(

            chatId,

            `✅ Amount: \`${amount.toFixed(2)}\` ৳

` +
            `এখন আপনার *${userState[chatId].method}* নম্বরটি পাঠান:`,

            {
                parse_mode: 'Markdown'
            }

        );

    }


    // ===========================
    // WITHDRAW NUMBER
    // ===========================

    if (
        userState[chatId] &&
        userState[chatId].step === 'AWAITING_NUMBER'
    ) {

        const method =
            userState[chatId].method;

        const withdrawAmount =
            userState[chatId].amount;

        const walletNumber =
            text.replace(/[\s-]/g, '');

        const data =
            getUserData(chatId);


        // Basic number validation
        if (!/^\d{10,15}$/.test(walletNumber)) {

            return bot.sendMessage(
                chatId,
                `❌ সঠিক ${method} নম্বর দিন।`
            );

        }


        /*
         * এখানে সরাসরি balance কাটা হচ্ছে না।
         * Admin request দেখার পর payment/approval করতে পারবে।
         */

        delete userState[chatId];


        const username =
            user.username
                ? '@' + user.username
                : 'N/A';


        try {

            await bot.sendMessage(

                chatId,

                `📥 *Withdraw Request গ্রহণ করা হয়েছে!*

` +
                `🔹 Method: ${method}\n` +
                `📞 Number: \`${walletNumber}\`\n` +
                `💰 Amount: \`${withdrawAmount.toFixed(2)}\` ৳\n\n` +
                `⏳ Admin যাচাই করার পর payment করা হবে।`,

                {
                    parse_mode: 'Markdown'
                }

            );


            await bot.sendMessage(

                config.ADMIN_CHAT_ID,

                `📥 *নতুন Withdraw Request*

` +
                `👤 User: ${username}\n` +
                `🆔 ID: \`${chatId}\`\n` +
                `💳 Method: ${method}\n` +
                `📞 Number: \`${walletNumber}\`\n` +
                `💰 Amount: \`${withdrawAmount.toFixed(2)}\` ৳`,

                {
                    parse_mode: 'Markdown'
                }

            );

        } catch (error) {

            console.error(
                'Withdraw send error:',
                error.message
            );

            return bot.sendMessage(
                chatId,
                '❌ Request পাঠাতে সমস্যা হয়েছে।'
            );

        }

        return;

    }


    // ===========================
    // GET NUMBERS
    // ===========================

    if (
        text === '📱 Get Numbers' ||
        text === '📱 Get Active Number' ||
        text === '🔄 Refresh Panel'
    ) {

        if (userLocks[chatId]) {
            return;
        }

        userLocks[chatId] = true;

        delete userState[chatId];


        try {

            // -----------------------
            // CHANNEL CHECK
            // -----------------------

            const isJoined =
                await checkChannelMember(chatId);


            if (!isJoined) {

                await bot.sendMessage(

                    chatId,

                    `❌ *প্রথমে আমাদের channel-এ join করুন।*

` +
                    `Channel: ${config.REQUIRED_CHANNEL}`,

                    {
                        parse_mode: 'Markdown'
                    }

                );

                return;

            }


            // -----------------------
            // LOADING
            // -----------------------

            await bot.sendMessage(

                chatId,

                '⏳ RIFAT_SMS panel থেকে live range check করা হচ্ছে...'

            );


            // -----------------------
            // LIVE DATA
            // -----------------------

            const liveData =
                await getLiveAccess();


            if (
                !liveData ||
                !liveData.data ||
                !Array.isArray(
                    liveData.data.services
                )
            ) {

                return bot.sendMessage(

                    chatId,

                    '❌ Panel থেকে কোনো valid data পাওয়া যায়নি।'

                );

            }


            // -----------------------
            // FIND RANGE
            // -----------------------

            let targetRange = null;


            for (
                const service
                of liveData.data.services
            ) {

                if (
                    service.ranges &&
                    service.ranges.length > 0
                ) {

                    const cleaned =
                        String(
                            service.ranges[0]
                        ).replace(
                            /[^0-9]/g,
                            ''
                        );


                    if (cleaned) {

                        targetRange =
                            cleaned;

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


            // -----------------------
            // GET NUMBER
            // -----------------------

            const numResult =
                await getNewNumber(
                    targetRange
                );


            if (
                !numResult ||
                !numResult.data
            ) {

                return bot.sendMessage(

                    chatId,

                    '❌ Number allocate করতে ব্যর্থ হয়েছে।'

                );

            }


            const phoneData =
                numResult.data;


            const phoneNumber =
                phoneData.full_number ||
                phoneData.number ||
                'N/A';


            const countryName =
                phoneData.country ||
                'Unknown';


            // -----------------------
            // SHOW NUMBER
            // -----------------------

            await bot.sendMessage(

                chatId,

                `📍 *দেশ:* ${countryName}\n` +
                `📞 *নম্বর:* \`${phoneNumber}\`\n\n` +
                `✅ Number successfully allocated হয়েছে।`,

                {
                    parse_mode: 'Markdown'
                }

            );


        } catch (error) {

            console.error(
                'NUMBER ERROR:',
                error
            );


            try {

                await bot.sendMessage(

                    chatId,

                    '❌ একটি technical error হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।'

                );

            } catch (sendError) {

                console.error(
                    'ERROR MESSAGE SEND FAILED:',
                    sendError.message
                );

            }

        } finally {

            // সব অবস্থাতেই lock খুলে যাবে
            userLocks[chatId] = false;

        }

    }

});


// ===============================
// CALLBACK QUERY
// ===============================

bot.on('callback_query', async (query) => {

    try {

        if (
            !query.message ||
            !query.message.chat
        ) {
            return;
        }


        const chatId =
            query.message.chat.id;

        const data =
            query.data;


        // ---------------------------
        // WITHDRAW METHOD
        // ---------------------------

        if (
            data &&
            data.startsWith('withdraw_')
        ) {

            const method =
                data.split('_')[1];


            userState[chatId] = {

                step: 'AWAITING_AMOUNT',
                method: method

            };


            await bot.answerCallbackQuery(
                query.id
            );


            await bot.sendMessage(

                chatId,

                `📲 *${method}* selected হয়েছে।

` +
                `কত টাকা Withdraw করতে চান লিখে পাঠান:`,

                {
                    parse_mode: 'Markdown'
                }

            );

        }

    } catch (error) {

        console.error(
            'Callback Error:',
            error.message
        );

    }

});


// ===============================
// HTTP SERVER
// ===============================

const server =
    http.createServer((req, res) => {

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

    });


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
