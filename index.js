bot.on('polling_error', (error) => {
    console.error('POLLING ERROR:', error.message);
});

bot.on('error', (error) => {
    console.error('BOT ERROR:', error.message);
});

bot.getMe()
    .then((me) => {
        console.log('BOT CONNECTED:', me.username);
    })
    .catch((err) => {
        console.error('BOT CONNECTION FAILED:', err.message);
    });
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const config = require('./config');
const { getLiveAccess, getNewNumber, getSuccessOtp, getConsoleData } = require('./api');

const bot = new TelegramBot(config.BOT_TOKEN, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

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

async function checkChannelMember(userId) {
    try {
        const member = await bot.getChatMember(config.REQUIRED_CHANNEL, userId);
        return ['creator', 'administrator', 'member'].includes(member.status);
    } catch (error) {
        console.error('Channel check error:', error.message);
        return true; 
    }
}

const mainMenu = {
    reply_markup: {
        keyboard: [
            [{ text: '📱 Get Numbers' }, { text: '📱 Get Active Number' }],
            [{ text: '💰 Balance' }, { text: '💸 Withdraw' }],
            [{ text: '🔄 Refresh Panel' }, { text: '💬 Support' }]
        ],
        resize_keyboard: true
    }
};

bot.onText(/\/start/, (msg) => {
    delete userState[msg.chat.id];
    getUserData(msg.chat.id);

    bot.sendMessage(
        msg.chat.id,
        `👋 **RIFAT_SMS** বটের সার্ভিস চালু আছে!\n\nপ্যানেল থেকে নম্বর ও ওটিপি পেতে **Get Numbers** বা আপনার ইনকাম দেখতে **Balance** বাটনে ক্লিক করুন।`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';
    const user = msg.from;

    if (!text) return;
    if (userLocks[chatId]) return;

    if (text === '💰 Balance' || text === 'Balance') {
        delete userState[chatId];
        const data = getUserData(chatId);
        const currentBalance = (data.totalEarned - data.totalWithdrawn).toFixed(2);

        const balanceMsg = 
            `📊 **আপনার অ্যাকাউন্টের সম্পূর্ণ হিসাব:**\n\n` +
            `🔢 **মোট প্রাপ্ত OTP:** \`${data.totalOtp}\` টি\n` +
            `💵 **মোট ইনকাম:** \`${data.totalEarned.toFixed(2)}\` ৳\n` +
            `🏧 **মোট উত্তোলন:** \`${data.totalWithdrawn.toFixed(2)}\` ৳\n` +
            `⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n` +
            `💳 **বর্তমান ব্যালেন্স:** \`${currentBalance}\` ৳\n\n` +
            `📌 *নোট: সর্বনিম্ন উইথড্র ১০০ টাকা।*`;

        return bot.sendMessage(chatId, balanceMsg, { parse_mode: 'Markdown' });
    }

    if (text === '💬 Support' || text === 'Support') {
        delete userState[chatId];
        const supportKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👨‍💻 Contact Admin', url: `https://t.me/${config.SUPPORT_USERNAME}` }]
                ]
            }
        };

        return bot.sendMessage(
            chatId,
            `🎧 **হেল্প বা সাপোর্টের জন্য যোগাযোগ করুন:**\n\nযে কোনো সমস্যা বা অনুসন্ধানের জন্য নিচের বাটনে ক্লিক করে সরাসরি এডমিনের সাথে কথা বলুন।`,
            { parse_mode: 'Markdown', ...supportKeyboard }
        );
    }

    if (text === '💸 Withdraw' || text === 'Withdraw' || text === '💳 Withdraw') {
        delete userState[chatId];
        const data = getUserData(chatId);
        const currentBalance = data.totalEarned - data.totalWithdrawn;

        if (currentBalance < MIN_WITHDRAW_AMOUNT) {
            return bot.sendMessage(
                chatId, 
                `⚠️ **উইথড্র ব্যর্থ!**\n\nসর্বনিম্ন **১০০ টাকা** না হলে টাকা তোলা যাবে না।\n🔹 বর্তমান ব্যালেন্স: \`${currentBalance.toFixed(2)}\` ৳`,
                { parse_mode: 'Markdown' }
            );
        }

        const withdrawMethods = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🌸 Bkash', callback_data: 'withdraw_Bkash' }, { text: '🟠 Nagad', callback_data: 'withdraw_Nagad' }],
                    [{ text: '🚀 Rocket', callback_data: 'withdraw_Rocket' }]
                ]
            }
        };

        return bot.sendMessage(
            chatId,
            `💳 **মেথড সিলেক্ট করুন:**\n\nবর্তমান ব্যালেন্স: \`${currentBalance.toFixed(2)}\` ৳`,
            { parse_mode: 'Markdown', ...withdrawMethods }
        );
    }

    if (userState[chatId] && userState[chatId].step === 'AWAITING_AMOUNT') {
        const amount = parseFloat(text);
        const data = getUserData(chatId);
        const currentBalance = parseFloat((data.totalEarned - data.totalWithdrawn).toFixed(2));

        if (isNaN(amount) || amount <= 0 || amount < MIN_WITHDRAW_AMOUNT || amount > currentBalance) {
            delete userState[chatId];
            return bot.sendMessage(chatId, '❌ **উইথড্র ব্যর্থ!** সঠিক অ্যামাউন্ট বা পর্যাপ্ত ব্যালেন্স নেই।');
        }

        userState[chatId].amount = amount;
        userState[chatId].step = 'AWAITING_NUMBER';

        return bot.sendMessage(chatId, `✅ টাকার পরিমাণ: \`${amount}\` ৳\n\nএখন আপনার **${userState[chatId].method} নম্বরটি** লিখে পাঠান:`, { parse_mode: 'Markdown' });
    }

    if (userState[chatId] && userState[chatId].step === 'AWAITING_NUMBER') {
        const method = userState[chatId].method;
        const withdrawAmount = userState[chatId].amount;
        const walletNumber = text;
        const data = getUserData(chatId);

        delete userState[chatId];
        data.totalWithdrawn += withdrawAmount;

        bot.sendMessage(chatId, `✅ **উইথড্র রিকোয়েস্ট সফল হয়েছে!**\n🔹 মেথড: ${method}\n📞 নম্বর: \`${walletNumber}\`\n💰 পরিমাণ: \`${withdrawAmount}\` ৳`, { parse_mode: 'Markdown' });
        bot.sendMessage(config.ADMIN_CHAT_ID, `📥 **নতুন Withdraw রিকোয়েস্ট!**\n👤 ইউজার: @${user.username || 'N/A'}\n🆔 ID: \`${chatId}\`\n💳 মেথড: ${method}\n📞 নম্বর: \`${walletNumber}\`\n💰 পরিমাণ: \`${withdrawAmount}\` ৳`, { parse_mode: 'Markdown' });
        return;
    }

    if (text === '📱 Get Numbers' || text === '📱 Get Active Number' || text === '🔄 Refresh Panel') {
        userLocks[chatId] = true;
        delete userState[chatId];

        try {
            const isJoined = await checkChannelMember(chatId);
            if (!isJoined) {
                userLocks[chatId] = false;
                return bot.sendMessage(chatId, `❌ চ্যানেলে জয়েন না করলে নম্বর নিতে পারবেন না।`);
            }

            bot.sendMessage(chatId, '⏳ RIFAT_SMS প্যানেল থেকে লাইভ রেঞ্জ চেক করা হচ্ছে...');

            const liveData = await getLiveAccess();
            if (!liveData || !liveData.data || !liveData.data.services) {
                userLocks[chatId] = false;
                return bot.sendMessage(chatId, '❌ প্যানেল থেকে কোনো ডেটা পাওয়া যায়নি।');
            }

            let targetRange = null;
            for (const service of liveData.data.services) {
                if (service.ranges && service.ranges.length > 0) {
                    targetRange = service.ranges[0].replace(/[^0-9]/g, '');
                    break;
                }
            }

            if (!targetRange) {
                userLocks[chatId] = false;
                return bot.sendMessage(chatId, 'ℹ️ বর্তমানে কোনো সক্রিয় রেঞ্জ বা নম্বর খালি নেই।');
            }

            const numResult = await getNewNumber(targetRange);
            if (!numResult || !numResult.data) {
                userLocks[chatId] = false;
                return bot.sendMessage(chatId, '❌ নম্বর অ্যালট করতে ব্যর্থ হয়েছে।');
            }

            const phoneData = numResult.data;
            const phoneNumber = phoneData.full_number || phoneData.number || 'N/A';
            const countryName = phoneData.country || 'Unknown';

            bot.sendMessage(
                chatId,
                `📍 **দেশ:** ${countryName}\n` +
                `📞 নম্বর: \`${phoneNumber}\`\n\n⏳ **ওটিপি আসার জন্য অপেক্ষা করা হচ্ছে...**`,
                { parse_mode: 'Markdown' }
            );

            userLocks[chatId] = false;

        } catch (err) {
            userLocks[chatId] = false;
            console.error(err);
            bot.sendMessage(chatId, '❌ একটি টেকনিক্যাল এরর ঘটেছে।');
        }
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data.startsWith('withdraw_')) {
        const method = data.split('_')[1];
        userState[chatId] = { step: 'AWAITING_AMOUNT', method };
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, `📲 **${method}** সিলেক্ট করা হয়েছে। কত টাকা তুলতে চান লিখে পাঠান:`, { parse_mode: 'Markdown' });
    }
});

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is active and running!');
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is listening on port ${PORT}`);
});
