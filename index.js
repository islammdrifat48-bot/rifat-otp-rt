const TelegramBot = require('node-telegram-bot-api');
const http = require('http');

const config = require('./config');
const {
    getLiveAccess,
    getNewNumber,
    getSuccessOtp
} = require('./api');

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

// Global Error Handlers
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

bot.getMe()
    .then((me) => {
        console.log('BOT CONNECTED:', '@' + me.username);
    })
    .catch((error) => {
        console.error('BOT CONNECTION FAILED:', error.message);
    });

const userState = {};
const userBalance = {};
const processedOtps = new Set();
const customApps = {};

const MIN_WITHDRAW_AMOUNT = 500.00;
const OTP_REWARD_AMOUNT = 0.70;
const PUBLIC_UID = 'MQUPBWI9AQJ';
const METHOD_CHANNEL = '@otpmethod_r';
const ADMIN_ID = 6315111273;

function getUserData(userId) {
    if (!userBalance[userId]) {
        userBalance[userId] = {
            userId: userId,
            name: 'User',
            totalOtp: 0,
            totalEarned: 0,
            totalWithdrawn: 0
        };
    }
    return userBalance[userId];
}

function maskPhoneNumber(num) {
    const cleaned = String(num).trim();
    if (cleaned.length <= 7) return cleaned;
    return `${cleaned.slice(0, 6)}xxxx${cleaned.slice(-3)}`;
}

function getCountryFlag(countryInput) {
    if (!countryInput) return '🌐';
    let str = String(countryInput).trim().toUpperCase();
    const customMap = {
        '880': 'BD', '91': 'IN', '1': 'US', '44': 'GB', '92': 'PK', '966': 'SA', '971': 'AE',
        'BANGLADESH': 'BD', 'INDIA': 'IN', 'PAKISTAN': 'PK', 'USA': 'US', 'UNITED STATES': 'US'
    };
    if (customMap[str]) str = customMap[str];
    if (str.length === 2 && /^[A-Z]{2}$/.test(str)) {
        const codePoints = [...str].map(char => 127397 + char.charCodeAt(0));
        return String.fromCodePoint(...codePoints);
    }
    return '🌐';
}

async function checkChannelMember(userId) {
    try {
        const member1 = await bot.getChatMember(config.REQUIRED_CHANNEL, userId);
        const isJoined1 = ['creator', 'administrator', 'member'].includes(member1.status);
        const member2 = await bot.getChatMember(METHOD_CHANNEL, userId);
        const isJoined2 = ['creator', 'administrator', 'member'].includes(member2.status);
        return isJoined1 && isJoined2;
    } catch (error) {
        return false;
    }
}

const mainMenu = {
    reply_markup: {
        keyboard: [
            [{ text: '🟢 GET ACTIVE NUMBER' }, { text: '🟢 BALANCE' }],
            [{ text: '🔵 REFER & EARN' }, { text: '🏆 LEADERBOARD' }],
            [{ text: '🟢 SUPPORT' }, { text: '💸 WITHDRAW' }]
        ],
        resize_keyboard: true
    }
};

bot.onText(/^\/start(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    delete userState[chatId];
    const uData = getUserData(chatId);
    uData.name = msg.from.first_name || 'User';

    await bot.sendMessage(
        chatId,
        `👋 *RIFAT_SMS* Bot service is active!\n\n` +
        `🆔 *UID:* \`${PUBLIC_UID}\`\n` +
        `💡 *Per OTP Reward:* ${OTP_REWARD_AMOUNT} ৳\n` +
        `📌 *Minimum Withdraw: 500 ৳*`,
        { parse_mode: 'Markdown', reply_markup: mainMenu.reply_markup }
    );
});

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
        `💳 *Current Balance:* \`${currentBalance.toFixed(2)}\` ৳`;

    await bot.sendMessage(chatId, balanceMsg, { parse_mode: 'Markdown', reply_markup: mainMenu.reply_markup });
}

async function sendLeaderboard(chatId) {
    const allUsers = Object.values(userBalance);
    allUsers.sort((a, b) => (b.totalEarned - b.totalWithdrawn) - (a.totalEarned - a.totalWithdrawn));
    const top3 = allUsers.slice(0, 3);

    let lbText = `🏆 *Top 3 Earners Leaderboard*\n\n`;
    const medals = ['🥇', '🥈', '🥉'];

    if (top3.length === 0 || top3[0].totalEarned === 0) {
        lbText += `No earnings recorded yet.`;
    } else {
        top3.forEach((u, index) => {
            const bal = u.totalEarned - u.totalWithdrawn;
            lbText += `${medals[index]} *${u.name}* - Balance: \`${bal.toFixed(2)}\` ৳\n`;
        });
    }
    await bot.sendMessage(chatId, lbText, { parse_mode: 'Markdown', reply_markup: mainMenu.reply_markup });
}

async function handleWithdrawStart(chatId) {
    const uData = getUserData(chatId);
    const currentBalance = uData.totalEarned - uData.totalWithdrawn;

    if (currentBalance < MIN_WITHDRAW_AMOUNT) {
        await bot.sendMessage(ADMIN_ID, `🚨 *Withdraw FAILED (Low Balance)*\n\n👤 User: [${uData.name}](tg://user?id=${chatId})\n💳 Balance: \`${currentBalance.toFixed(2)}\` ৳`, { parse_mode: 'Markdown' });
        return bot.sendMessage(chatId, `❌ *Insufficient Balance!*\nCurrent Balance: \`${currentBalance.toFixed(2)}\` ৳\nMinimum Withdraw: \`${MIN_WITHDRAW_AMOUNT}\` ৳`, { parse_mode: 'Markdown' });
    }

    userState[chatId] = { step: 'wd_method' };
    await bot.sendMessage(chatId, `💸 *Select Withdrawal Method:*`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔴 bKash', callback_data: 'wd_bkash' }, { text: '🟠 Nagad', callback_data: 'wd_nagad' }],
                [{ text: '🟣 Rocket', callback_data: 'wd_rocket' }]
            ]
        }
    });
}

async function startFastOtpChecker(chatId, phoneNumber) {
    const startTime = Date.now();
    const maxDurationMs = 15 * 60 * 1000;
    const cleanUserPhone = String(phoneNumber).replace(/\D/g, '');

    const interval = setInterval(async () => {
        if (Date.now() - startTime > maxDurationMs) {
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
                    const uniqueOtpId = `${cleanTargetNum}_${item.otp_id || item.id || messageText}`;

                    if (cleanTargetNum && cleanUserPhone && (cleanTargetNum === cleanUserPhone || cleanTargetNum.endsWith(cleanUserPhone) || cleanUserPhone.endsWith(cleanTargetNum)) && messageText) {
                        if (processedOtps.has(uniqueOtpId)) continue;
                        processedOtps.add(uniqueOtpId);
                        clearInterval(interval);

                        const userData = getUserData(chatId);
                        userData.totalOtp += 1;
                        userData.totalEarned += OTP_REWARD_AMOUNT;
                        const maskedNumber = maskPhoneNumber(phoneNumber);

                        const otpMsg = `🎉 *OTP Received Successfully!*\n\n📞 *Number:* \`${maskedNumber}\`\n💬 *Details:* \`${messageText}\`\n💰 *Reward:* +${OTP_REWARD_AMOUNT} ৳`;
                        const otpKeyboard = {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: 'OTP Group', url: 'https://t.me/otpgroup_rt' }, { text: 'Method', url: 'https://t.me/otpmethod_r' }]
                                ]
                            }
                        };

                        await bot.sendMessage(chatId, otpMsg, { parse_mode: 'Markdown', ...otpKeyboard });
                        await bot.sendMessage(config.REQUIRED_CHANNEL, `📢 *Channel OTP Alert*\n\n` + otpMsg, { parse_mode: 'Markdown', ...otpKeyboard });
                        return;
                    }
                }
            }
        } catch (err) {}
    }, 1000);
}

async function showAppsMenu(chatId, messageId = null) {
    try {
        const isJoined = await checkChannelMember(chatId);
        if (!isJoined) {
            await bot.sendMessage(chatId, `❌ *Please join both channels first!*`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📢 Join OTP Group', url: `https://t.me/${config.REQUIRED_CHANNEL.replace('@','')}` }],
                        [{ text: '📌 Join Method Group', url: `https://t.me/${METHOD_CHANNEL.replace('@','')}` }]
                    ]
                }
            });
            return;
        }

        const inlineKeyboard = [];
        let row = [];

        Object.keys(customApps).forEach(appName => {
            row.push({ text: `⭐ ${appName}`, callback_data: `customapp_${appName}` });
            if (row.length === 2) { inlineKeyboard.push(row); row = []; }
        });

        const liveData = await getLiveAccess();
        if (liveData && liveData.data) {
            const rawServices = liveData.data.services || liveData.data;
            const items = Array.isArray(rawServices) ? rawServices : Object.values(rawServices);
            const appsSet = new Set();
            items.forEach(service => {
                if (!service) return;
                const sName = service.sid || service.name || service.title || service.service;
                if (sName) appsSet.add(String(sName).trim());
            });

            appsSet.forEach(appName => {
                row.push({ text: `📱 ${appName}`, callback_data: `app_${appName}` });
                if (row.length === 2) { inlineKeyboard.push(row); row = []; }
            });
        }
        if (row.length > 0) inlineKeyboard.push(row);

        const menuText = `🎛️ *RIFAT OTP DASHBOARD*\n\n👇 Select your desired app/service:`;
        const reply_markup = { inline_keyboard };

        if (messageId) {
            return bot.editMessageText(menuText, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup });
        } else {
            return bot.sendMessage(chatId, menuText, { parse_mode: 'Markdown', reply_markup });
        }
    } catch (error) {
        await bot.sendMessage(chatId, '❌ Failed to load services.');
    }
}

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';
    if (!text || text.startsWith('/start')) return;

    if (chatId === ADMIN_ID) {
        if (text === '/admin') {
            return bot.sendMessage(chatId, `👑 *Admin Panel*`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ Create App', callback_data: 'adm_create_app' }, { text: '🗑️ Delete App', callback_data: 'adm_del_app' }],
                        [{ text: '➕ Add Range to App', callback_data: 'adm_add_range' }, { text: '📋 View Custom Apps', callback_data: 'adm_view_apps' }]
                    ]
                }
            });
        }

        if (userState[chatId]) {
            const state = userState[chatId];
            if (state.step === 'waiting_app_name') {
                customApps[text] = [];
                delete userState[chatId];
                return bot.sendMessage(chatId, `✅ Custom App *${text}* created successfully!`);
            }
            if (state.step === 'waiting_range_val') {
                const targetApp = state.appName;
                if (customApps[targetApp]) {
                    customApps[targetApp].push(text);
                    delete userState[chatId];
                    return bot.sendMessage(chatId, `✅ Range *${text}* added to *${targetApp}*!`);
                }
            }
        }
    }

    if (userState[chatId] && userState[chatId].step === 'waiting_wd_amount') {
        const amount = parseFloat(text);
        const method = userState[chatId].method;
        const uData = getUserData(chatId);
        const currentBalance = uData.totalEarned - uData.totalWithdrawn;

        if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, `❌ Enter valid amount.`);
        if (amount > currentBalance) {
            delete userState[chatId];
            await bot.sendMessage(ADMIN_ID, `🚨 *Withdraw FAILED*\n👤 User: [${uData.name}](tg://user?id=${chatId})\nRequested: \`${amount}\` ৳`, { parse_mode: 'Markdown' });
            return bot.sendMessage(chatId, `❌ *Insufficient Balance!* Admin notified.`, { parse_mode: 'Markdown', reply_markup: mainMenu.reply_markup });
        }
        if (amount < MIN_WITHDRAW_AMOUNT) return bot.sendMessage(chatId, `❌ Minimum withdraw \`${MIN_WITHDRAW_AMOUNT}\` ৳.`);

        userState[chatId] = { step: 'waiting_wd_number', amount, method };
        return bot.sendMessage(chatId, `📱 Enter your *${method}* account number:`, { parse_mode: 'Markdown' });
    }

    if (userState[chatId] && userState[chatId].step === 'waiting_wd_number') {
        const { amount, method } = userState[chatId];
        const uData = getUserData(chatId);
        uData.totalWithdrawn += amount;
        delete userState[chatId];

        await bot.sendMessage(ADMIN_ID, `✅ *Withdraw REQUEST*\n👤 User: [${uData.name}](tg://user?id=${chatId})\nAmount: \`${amount}\` ৳\nMethod: \`${method}\`\nNumber: \`${text}\``, { parse_mode: 'Markdown' });
        return bot.sendMessage(chatId, `✅ *Withdrawal Request Successful!*`, { parse_mode: 'Markdown', reply_markup: mainMenu.reply_markup });
    }

    if (text.includes('BALANCE')) return sendBalance(chatId);
    if (text.includes('LEADERBOARD')) return sendLeaderboard(chatId);
    if (text.includes('SUPPORT')) return bot.sendMessage(chatId, `🎧 Contact Admin for support.`);
    if (text.includes('WITHDRAW')) return handleWithdrawStart(chatId);
    if (text.includes('GET ACTIVE NUMBER')) return showAppsMenu(chatId);
});

bot.on('callback_query', async (query) => {
    try {
        if (!query.message || !query.message.chat) return;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;

        if (chatId === ADMIN_ID) {
            if (data === 'adm_create_app') {
                await bot.answerCallbackQuery(query.id);
                userState[chatId] = { step: 'waiting_app_name' };
                return bot.sendMessage(chatId, `✍️ Send new App name:`);
            }
            if (data === 'adm_view_apps') {
                await bot.answerCallbackQuery(query.id);
                let txt = `📋 *Custom Apps:*\n`;
                Object.keys(customApps).forEach(app => { txt += `📱 ${app} -> [${customApps[app].join(', ')} ]\n`; });
                return bot.sendMessage(chatId, txt || `No custom apps.`, { parse_mode: 'Markdown' });
            }
            if (data === 'adm_del_app') {
                await bot.answerCallbackQuery(query.id);
                const inlineKeyboard = [];
                Object.keys(customApps).forEach(app => {
                    inlineKeyboard.push([{ text: `❌ Delete ${app}`, callback_data: `adm_delapp_${app}` }]);
                });
                inlineKeyboard.push([{ text: '⬅️ Back', callback_data: 'adm_back' }]);
                return bot.editMessageText(`🗑️ Select app to delete:`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard } });
            }
            if (data && data.startsWith('adm_delapp_')) {
                const appName = data.replace('adm_delapp_', '');
                delete customApps[appName];
                await bot.answerCallbackQuery(query.id, { text: `Deleted` });
                return bot.editMessageText(`✅ Deleted *${appName}*!`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
            }
            if (data === 'adm_add_range') {
                await bot.answerCallbackQuery(query.id);
                const inlineKeyboard = [];
                Object.keys(customApps).forEach(app => {
                    inlineKeyboard.push([{ text: `➕ ${app}`, callback_data: `adm_selectapp_${app}` }]);
                });
                inlineKeyboard.push([{ text: '⬅️ Back', callback_data: 'adm_back' }]);
                return bot.editMessageText(`👇 Select app to add range:`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard } });
            }
            if (data && data.startsWith('adm_selectapp_')) {
                const appName = data.replace('adm_selectapp_', '');
                await bot.answerCallbackQuery(query.id);
                userState[chatId] = { step: 'waiting_range_val', appName };
                return bot.sendMessage(chatId, `✍️ Send range for *${appName}* (e.g. 880):`, { parse_mode: 'Markdown' });
            }
            if (data === 'adm_back') {
                await bot.answerCallbackQuery(query.id);
                return bot.editMessageText(`👑 *Admin Panel*`, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '➕ Create App', callback_data: 'adm_create_app' }, { text: '🗑️ Delete App', callback_data: 'adm_del_app' }],
                            [{ text: '➕ Add Range to App', callback_data: 'adm_add_range' }, { text: '📋 View Custom Apps', callback_data: 'adm_view_apps' }]
                        ]
                    }
                });
            }
        }

        if (data && data.startsWith('wd_')) {
            const methodCode = data.replace('wd_', '');
            const methodName = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket' }[methodCode] || 'bKash';
            await bot.answerCallbackQuery(query.id);
            userState[chatId] = { step: 'waiting_wd_amount', method: methodName };
            return bot.editMessageText(`💸 *Withdraw via ${methodName}*\nEnter amount (Min 500 ৳):`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        }

        if (data === 'back_to_apps') {
            await bot.answerCallbackQuery(query.id);
            return showAppsMenu(chatId, messageId);
        }

        if (data && data.startsWith('customapp_')) {
            const appName = data.replace('customapp_', '');
            await bot.answerCallbackQuery(query.id);
            const ranges = customApps[appName] || [];
            const inlineKeyboard = [];
            let row = [];

            ranges.forEach(rangeVal => {
                row.push({ text: `Range: ${rangeVal}`, callback_data: `num_${rangeVal}_${encodeURIComponent(appName)}` });
                if (row.length === 2) { inlineKeyboard.push(row); row = []; }
            });
            if (row.length > 0) inlineKeyboard.push(row);
            inlineKeyboard.push([{ text: '⬅️ Back', callback_data: 'back_to_apps' }]);

            return bot.editMessageText(`⭐ *App:* \`${appName}\`\nSelect range:`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
        }

        if (data && data.startsWith('app_')) {
            const appName = data.replace('app_', '');
            await bot.answerCallbackQuery(query.id);
            const liveData = await getLiveAccess();
            if (!liveData || !liveData.data) return;
            const items = Array.isArray(liveData.data.services) ? liveData.data.services : Object.values(liveData.data);
            const inlineKeyboard = [];
            let row = [];

            items.forEach(service => {
                if (!service) return;
                const sName = String(service.sid || service.name || '').trim();
                if (sName.toLowerCase() === appName.toLowerCase()) {
                    const country = service.country || appName;
                    const rangeVal = service.range || service.rid || '';
                    if (rangeVal) {
                        row.push({ text: `${country} (${rangeVal})`, callback_data: `num_${rangeVal}_${encodeURIComponent(appName)}` });
                        if (row.length === 2) { inlineKeyboard.push(row); row = []; }
                    }
                }
            });
            if (row.length > 0) inlineKeyboard.push(row);
            inlineKeyboard.push([{ text: '⬅️ Back', callback_data: 'back_to_apps' }]);

            return bot.editMessageText(`📱 *App:* \`${appName}\``, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
        }

        if (data && data.startsWith('num_')) {
            const parts = data.split('_');
            const targetRange = parts[1];
            const appName = decodeURIComponent(parts[2] || 'Service');

            await bot.answerCallbackQuery(query.id, { text: 'Allocating...' });
            await bot.editMessageText('⏳ Allocating number...', { chat_id: chatId, message_id: messageId });

            const actualNumResult = await getNewNumber(targetRange);
            if (!actualNumResult || !actualNumResult.data) {
                return bot.editMessageText('❌ Failed to allocate number.', { chat_id: chatId, message_id: messageId });
            }

            const phoneNumber = actualNumResult.data.full_number || actualNumResult.data.number || 'N/A';
            startFastOtpChecker(chatId, phoneNumber);

            return bot.editMessageText(
                `📞 *Number:* \`${phoneNumber}\`\n🎯 *Service:* \`${appName}\``,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Change', callback_data: `num_${targetRange}_${encodeURIComponent(appName)}` }, { text: '⬅️ Back', callback_data: `app_${appName}` }]
                        ]
                    }
                }
            );
        }
    } catch (error) {
        console.error('Callback Error:', error.message);
    }
});

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Running');
});
server.listen(process.env.PORT || 10000, '0.0.0.0');
