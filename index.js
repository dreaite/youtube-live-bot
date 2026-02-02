const Parser = require('rss-parser');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const parser = new Parser();
const bot = new TelegramBot(config.telegramToken, { polling: false });

const DATA_FILE = path.join(__dirname, 'data.json');
let sentGuids = new Set();

if (fs.existsSync(DATA_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (data.sentGuids) {
            sentGuids = new Set(data.sentGuids);
        }
    } catch (err) {
        console.error('Error loading data file:', err);
    }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({
            sentGuids: Array.from(sentGuids)
        }, null, 2));
    } catch (err) {
        console.error('Error saving data:', err);
    }
}

async function checkFeed() {
    try {
        console.log(`Checking feed: ${config.rssUrl}`);
        const feed = await parser.parseURL(config.rssUrl);

        if (feed.items && feed.items.length > 0) {
            for (const item of feed.items) {
                const guid = item.guid || item.id || item.link;
                
                if (!sentGuids.has(guid)) {
                    console.log(`New live found: ${item.title}`);
                    
                    const message = `🔴 <b>YouTube Live Detected!</b>\n\n` +
                        `<b>Title:</b> ${item.title}\n` +
                        `<b>Link:</b> ${item.link}\n` +
                        `<b>Date:</b> ${item.pubDate}`;

                    await bot.sendMessage(config.chatId, message, { parse_mode: 'HTML' });
                    
                    sentGuids.add(guid);
                    saveData();
                }
            }
        } else {
            console.log('No items in feed.');
        }
    } catch (error) {
        console.error('Error fetching or parsing feed:', error.message);
    }
}

checkFeed();

setInterval(checkFeed, config.checkInterval);

console.log('Bot started...');
