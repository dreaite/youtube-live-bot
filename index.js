const Parser = require('rss-parser');

module.exports = {
  async scheduled(event, env, ctx) {
    const parser = new Parser();
    const config = {
      telegramToken: env.TELEGRAM_BOT_TOKEN,
      chatId: env.TELEGRAM_CHAT_ID,
      channelName: env.YOUTUBE_CHANNEL_NAME || 'weathernews',
      rssUrl: (env.RSS_BASE_URL || 'https://rss.dreaife.tokyo/youtube/live/') + (env.YOUTUBE_CHANNEL_NAME || 'weathernews')
    };

    console.log(`Checking feed: ${config.rssUrl}`);

    try {
      let sentGuids = new Set();
      const storedData = await env.DB.get('sentGuids');
      if (storedData) {
        sentGuids = new Set(JSON.parse(storedData));
      }

      const feed = await parser.parseURL(config.rssUrl);
      let newGuidsFound = false;

      if (feed.items && feed.items.length > 0) {
        for (const item of feed.items) {
          const guid = item.guid || item.id || item.link;

          if (!sentGuids.has(guid)) {
            console.log(`New live found: ${item.title}`);

            const message = `🔴 <b>YouTube Live Detected!</b>\n\n` +
              `<b>Title:</b> ${item.title}\n` +
              `<b>Link:</b> ${item.link}\n` +
              `<b>Date:</b> ${item.pubDate}`;

            const telegramUrl = `https://api.telegram.org/bot${config.telegramToken}/sendMessage`;
            const response = await fetch(telegramUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: config.chatId,
                text: message,
                parse_mode: 'HTML'
              })
            });

            if (!response.ok) {
              console.error('Telegram API error:', await response.text());
            } else {
              sentGuids.add(guid);
              newGuidsFound = true;
            }
          }
        }
      }

      if (newGuidsFound) {
         const guidsArray = Array.from(sentGuids).slice(-100);
         await env.DB.put('sentGuids', JSON.stringify(guidsArray));
      }

    } catch (error) {
      console.error('Error in scheduled task:', error);
    }
  }
};
