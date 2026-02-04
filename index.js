import { XMLParser } from 'fast-xml-parser';

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const update = await request.json();

      if (update.message && update.message.text) {
        return await handleMessage(update.message, env);
      } else if (update.callback_query) {
        return await handleCallback(update.callback_query, env);
      }
      
      return new Response('OK', { status: 200 });

    } catch (e) {
      console.error(e);
      return new Response('Error', { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_"
    });
    const subs = await getSubscriptions(env);

    if (subs.length === 0) {
      console.log('No subscriptions found.');
      return;
    }

    const subsByUrl = {};
    for (const sub of subs) {
      if (!subsByUrl[sub.rssUrl]) {
        subsByUrl[sub.rssUrl] = [];
      }
      subsByUrl[sub.rssUrl].push(sub);
    }

    for (const [rssUrl, subscribers] of Object.entries(subsByUrl)) {
      try {
        console.log(`Checking feed: ${rssUrl}`);
        
        const channelName = subscribers[0].channelName;
        const sentKey = `sent_guids:${channelName}`;
        
        let sentGuids = new Set();
        const storedData = await env.DB.get(sentKey);
        if (storedData) {
          sentGuids = new Set(JSON.parse(storedData));
        }

        const response = await fetch(rssUrl);
        const rssText = await response.text();
        const feedRaw = parser.parse(rssText);

        let items = [];
        let feedTitle = '';

        if (feedRaw.feed && feedRaw.feed.entry) {
          // Atom (YouTube)
          feedTitle = feedRaw.feed.title;
          const entries = Array.isArray(feedRaw.feed.entry) ? feedRaw.feed.entry : [feedRaw.feed.entry];
          items = entries.map(entry => {
             let link = '';
             if (Array.isArray(entry.link)) {
                const alt = entry.link.find(l => l['@_rel'] === 'alternate');
                link = alt ? alt['@_href'] : entry.link[0]['@_href'];
             } else if (entry.link && entry.link['@_href']) {
                link = entry.link['@_href'];
             } else {
                link = entry.link;
             }
             
             return {
               title: entry.title,
               link: link,
               id: entry.id,
               pubDate: entry.published || entry.updated
             };
          });
        } else if (feedRaw.rss && feedRaw.rss.channel && feedRaw.rss.channel.item) {
          // RSS 2.0
          feedTitle = feedRaw.rss.channel.title;
          const rssItems = Array.isArray(feedRaw.rss.channel.item) ? feedRaw.rss.channel.item : [feedRaw.rss.channel.item];
          items = rssItems.map(item => ({
            title: item.title,
            link: item.link,
            id: (item.guid && item.guid['#text']) ? item.guid['#text'] : (item.guid || item.link),
            pubDate: item.pubDate
          }));
        }

        console.log(feedTitle);
        let newGuidsFound = false;

        if (items.length > 0) {
          for (const item of items) {
            const guid = item.id || item.link;

            if (!sentGuids.has(guid)) {
              console.log(`New live found for ${channelName}: ${item.title}`);
              
              const message = `🔴 <b>YouTube Live Detected!</b>\n\n` +
                `<b>Title:</b> ${item.title}\n` +
                `<b>Channel:</b> ${channelName}\n` +
                `<b>Link:</b> ${item.link}\n` +
                `<b>Date:</b> ${item.pubDate}`;

              for (const sub of subscribers) {
                await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, sub.chatId, sub.threadId, message);
              }

              sentGuids.add(guid);
              newGuidsFound = true;
            }
          }
        }

        if (newGuidsFound) {
          const guidsArray = Array.from(sentGuids).slice(-100);
          await env.DB.put(sentKey, JSON.stringify(guidsArray));
        }

      } catch (error) {
        console.error(`Error checking ${rssUrl}:`, error);
      }
    }
  }
};

async function handleMessage(message, env) {
  const chatId = message.chat.id;
  const threadId = message.message_thread_id || null;
  const text = message.text.trim();

  if (text.startsWith('/start')) {
    const welcomeMsg = `👋 <b>YouTube Live Monitor Bot</b>\n\n` +
      `I can help you monitor YouTube channels and notify you when they go live.\n\n` +
      `<b>Commands:</b>\n` +
      `/add &lt;channel_name&gt; - Add a subscription\n` +
      `/del &lt;channel_name&gt; - Remove a subscription\n` +
      `/list - List subscriptions\n` +
      `/forward_to &lt;target_chat_id&gt; [thread_id] - Forward subscriptions to another chat\n` +
      `/id - Get current Chat ID and Thread ID\n` +
      `/help - Show this help message`;
    
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, threadId, welcomeMsg);
  }
  else if (text.startsWith('/help')) {
    const helpMsg = `📖 <b>Help Guide</b>\n\n` +
      `<b>1. Add Subscription</b>\n` +
      `Use <code>/add channel_name</code> to subscribe. The channel name is usually the part after @ in the URL (e.g., for @PewDiePie, use PewDiePie).\n\n` +
      `<b>2. Forwarding Subscriptions</b>\n` +
      `To forward notifications to another channel/group:\n` +
      `1. Add the bot to the destination channel/group.\n` +
      `2. Send <code>/id</code> in the destination to get the Chat ID.\n` +
      `3. Go to the source group where subscriptions are.\n` +
      `4. Send <code>/forward_to &lt;destination_chat_id&gt;</code>.\n` +
      `5. Select channels to forward.`;
      
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, threadId, helpMsg);
  }
  else if (text.startsWith('/id')) {
    let msg = `🆔 <b>Chat Info</b>\n\n` +
      `<b>Chat ID:</b> <code>${chatId}</code>`;
    
    if (threadId) {
      msg += `\n<b>Thread ID:</b> <code>${threadId}</code>`;
    }
    
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, threadId, msg);
  }
  else if (text.startsWith('/add')) {
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
       await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, threadId, 'Usage: /add <channel_name>');
       return new Response('OK');
    }
    
    const channelName = parts[1];
    const rssUrl = (env.RSS_BASE_URL || 'https://rss.dreaife.tokyo/youtube/live/') + channelName;
    
    const subs = await getSubscriptions(env);
    const exists = subs.some(s => s.channelName === channelName && s.chatId === chatId && s.threadId === threadId);
    
    if (!exists) {
      subs.push({ channelName, rssUrl, chatId, threadId });
      await env.DB.put('subscriptions', JSON.stringify(subs));
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, threadId, `✅ Added ${channelName} to watchlist.`);
    } else {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, threadId, `⚠️ ${channelName} is already in the watchlist.`);
    }
  } 
  else if (text.startsWith('/del') || text.startsWith('/remove')) {
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
       await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, threadId, 'Usage: /del <channel_name>');
       return new Response('OK');
    }
    
    const channelName = parts[1];
    let subs = await getSubscriptions(env);
    const newSubs = subs.filter(s => !(s.channelName === channelName && s.chatId === chatId && s.threadId === threadId));
    
    if (subs.length !== newSubs.length) {
      await env.DB.put('subscriptions', JSON.stringify(newSubs));
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, threadId, `🗑️ Removed ${channelName} from watchlist.`);
    } else {
       await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, threadId, `⚠️ Subscription for ${channelName} not found.`);
    }
  }
  else if (text.startsWith('/list')) {
    const subs = await getSubscriptions(env);
    const mySubs = subs.filter(s => s.chatId === chatId && s.threadId === threadId);
    
    if (mySubs.length === 0) {
       await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, threadId, '📭 No active subscriptions.');
    } else {
       const list = mySubs.map(s => `- ${s.channelName}`).join('\n');
       await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, threadId, `📋 <b>Subscriptions:</b>\n${list}`);
    }
  }
  else if (text.startsWith('/forward_to')) {
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, threadId, 'Usage: /forward_to <target_chat_id> [target_thread_id]');
      return new Response('OK');
    }

    const targetChatId = parseInt(parts[1]);
    let targetThreadId = null;

    if (parts.length > 2) {
      targetThreadId = parseInt(parts[2]);
      if (isNaN(targetThreadId)) {
         await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, threadId, '⚠️ Invalid Target Thread ID.');
         return new Response('OK');
      }
    }

    if (isNaN(targetChatId)) {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, threadId, '⚠️ Invalid Target Chat ID.');
      return new Response('OK');
    }

    const subs = await getSubscriptions(env);
    const currentSubs = subs.filter(s => s.chatId === chatId && s.threadId === threadId);

    if (currentSubs.length === 0) {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, threadId, '⚠️ No subscriptions found in this chat to forward.');
      return new Response('OK');
    }

    const sessionId = crypto.randomUUID();
    const sessionData = {
      targetChatId,
      targetThreadId,
      sourceChatId: chatId,
      sourceThreadId: threadId,
      // Map index to channel name to keep callback data short for Telegram limits
      channelMap: currentSubs.map(s => s.channelName)
    };
    
    // Store session in KV with 1 hour expiration
    await env.DB.put(`fwd_session:${sessionId}`, JSON.stringify(sessionData), { expirationTtl: 3600 });

    const keyboard = {
      inline_keyboard: [
        [{ text: "🚀 Forward All", callback_data: `fwd:${sessionId}:ALL` }],
        ...currentSubs.map((s, idx) => [{ 
          text: `📺 ${s.channelName}`, 
          callback_data: `fwd:${sessionId}:${idx}` 
        }])
      ]
    };

    const msg = `📤 <b>Forward Subscriptions</b>\n\n` +
      `<b>Target Chat ID:</b> <code>${targetChatId}</code>\n` +
      (targetThreadId ? `<b>Target Thread ID:</b> <code>${targetThreadId}</code>\n` : '') +
      `\nSelect the subscriptions you want to copy to the target chat:`;

    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, threadId, msg, keyboard);
  }

  return new Response('OK', { status: 200 });
}

async function handleCallback(callbackQuery, env) {
  const data = callbackQuery.data;
  const message = callbackQuery.message;
  const chatId = message.chat.id;
  const messageId = message.message_id;

  if (!data.startsWith('fwd:')) {
    return new Response('OK');
  }

  const parts = data.split(':');
  if (parts.length < 3) {
    // Malformed callback data
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackQuery.id, "❌ Invalid callback data.");
    return new Response('OK');
  }

  const sessionId = parts[1];
  const action = parts[2];

  const sessionRaw = await env.DB.get(`fwd_session:${sessionId}`);
  if (!sessionRaw) {
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackQuery.id, "❌ Session expired or invalid.");
    return new Response('OK');
  }

  const session = JSON.parse(sessionRaw);
  
  // Validate source chat to prevent cross-chat replay attacks
  if (session.sourceChatId !== chatId) {
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackQuery.id, "❌ This button is not for this chat.");
    return new Response('OK');
  }

  const { targetChatId, targetThreadId, channelMap } = session;

  let channelsToForward = [];
  if (action === 'ALL') {
    channelsToForward = channelMap;
  } else {
    const idx = parseInt(action);
    if (channelMap[idx]) {
      channelsToForward = [channelMap[idx]];
    }
  }

  if (channelsToForward.length === 0) {
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackQuery.id, "⚠️ No channel selected.");
    return new Response('OK');
  }

  const subs = await getSubscriptions(env);
  let addedCount = 0;

  for (const channelName of channelsToForward) {
    const rssUrl = (env.RSS_BASE_URL || 'https://rss.dreaife.tokyo/youtube/live/') + channelName;
    
    const exists = subs.some(s => s.channelName === channelName && s.chatId === targetChatId && s.threadId === targetThreadId);
    
    if (!exists) {
      subs.push({ channelName, rssUrl, chatId: targetChatId, threadId: targetThreadId });
      addedCount++;
    }
  }

  if (addedCount > 0) {
    await env.DB.put('subscriptions', JSON.stringify(subs));
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackQuery.id, `✅ Forwarded ${addedCount} subscriptions!`);
    
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, session.sourceThreadId, `✅ Successfully forwarded ${addedCount} subscriptions to target.`);
    
    // Delete session to prevent replay
    await env.DB.delete(`fwd_session:${sessionId}`);
  } else {
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackQuery.id, "⚠️ Channels already exist in target.");
  }

  return new Response('OK', { status: 200 });
}

async function getSubscriptions(env) {
  const data = await env.DB.get('subscriptions');
  return data ? JSON.parse(data) : [];
}

async function sendTelegramMessage(token, chatId, threadId, text, replyMarkup = null) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  };
  
  if (threadId) {
    payload.message_thread_id = threadId;
  }
  
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    console.error(`Failed to send message to ${chatId} (${threadId}):`, await response.text());
  }
}

async function answerCallbackQuery(token, callbackQueryId, text) {
  const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
  const payload = {
    callback_query_id: callbackQueryId,
    text: text
  };
  
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
