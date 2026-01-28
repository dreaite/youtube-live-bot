require('dotenv').config();

module.exports = {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    channelName: process.env.YOUTUBE_CHANNEL_NAME || 'weathernews',
    rssUrl: (process.env.RSS_BASE_URL || 'https://rss.dreaife.tokyo/youtube/live/') + (process.env.YOUTUBE_CHANNEL_NAME || 'weathernews'),
    checkInterval: parseInt(process.env.CHECK_INTERVAL_MS) || 60000
};
