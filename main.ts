//main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const kv = await Deno.openKv();
const TOKEN = Deno.env.get("BOT_TOKEN");
const SECRET_PATH = "/testsub"; // change this if needed
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;


serve(async (req: Request) => {
  const { pathname } = new URL(req.url);
  if (pathname !== SECRET_PATH) {
    return new Response("Bot is running.", { status: 200 });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const update = await req.json();
  const message = update.message;
  const callbackQuery = update.callback_query;
  const myChatMember = update.my_chat_member;
  const channelPost = update.channel_post;
  const chatId = message?.chat?.id || callbackQuery?.message?.chat?.id || channelPost?.chat?.id;
  const userId = message?.from?.id || callbackQuery?.from?.id || channelPost?.from?.id;
  const username = (message?.from?.username || callbackQuery?.from?.username || channelPost?.from?.username) ? `@${message?.from?.username || callbackQuery?.from?.username || channelPost?.from?.username}` : null;
  const text = message?.text || channelPost?.text;
  const data = callbackQuery?.data;
  const messageId = callbackQuery?.message?.message_id || message?.message_id || channelPost?.message_id;
  const callbackQueryId = callbackQuery?.id;
  if (!chatId) return new Response("No chat ID", { status: 200 });
  // Update user activity if userId exists
  if (userId) {
    const userKey = ["users", userId];
    let userData = (await kv.get(userKey)).value || { registered_at: Date.now(), last_active: Date.now() };
    if (!userData.registered_at) userData.registered_at = Date.now();
    userData.last_active = Date.now();
    await kv.set(userKey, userData);
  }
  // Helper functions
  async function sendMessage(cid: number | string, txt: string, opts = {}) {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cid, text: txt, ...opts }),
    });
  }
  async function editMessageText(cid: number, mid: number, txt: string, opts = {}) {
    await fetch(`${TELEGRAM_API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cid, message_id: mid, text: txt, ...opts }),
    });
  }
  async function editMessageCaption(cid: number, mid: number, cap: string, opts = {}) {
    await fetch(`${TELEGRAM_API}/editMessageCaption`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cid, message_id: mid, caption: cap, ...opts }),
    });
  }
  async function forwardMessage(toChatId: string, fromChatId: number, msgId: number) {
    await fetch(`${TELEGRAM_API}/forwardMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: toChatId, from_chat_id: fromChatId, message_id: msgId }),
    });
  }
  async function copyMessage(toChatId: number | string, fromChatId: number | string, msgId: number) {
    const res = await fetch(`${TELEGRAM_API}/copyMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: toChatId, from_chat_id: fromChatId, message_id: msgId }),
    });
    return await res.json();
  }
  async function deleteMessage(cid: number, mid: number) {
    await fetch(`${TELEGRAM_API}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cid, message_id: mid }),
    });
  }
  async function answerCallback(qid: string, txt = "") {
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: qid, text: txt }),
    });
  }
  async function getChannelTitle(ch: string) {
    try {
      const res = await fetch(`${TELEGRAM_API}/getChat?chat_id=${ch}`);
      const d = await res.json();
      return d.ok ? d.result.title : ch;
    } catch {
      return ch;
    }
  }
  async function isSubscribed(uid: number, chs: string[]) {
    for (const ch of chs) {
      try {
        const res = await fetch(`${TELEGRAM_API}/getChatMember?chat_id=${ch}&user_id=${uid}`);
        const d = await res.json();
        if (!d.ok) return false;
        const st = d.result.status;
        if (st === "left" || st === "kicked") return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  async function getUnsubscribed(uid: number, chs: string[]) {
    const unsub = [];
    for (const ch of chs) {
      try {
        const res = await fetch(`${TELEGRAM_API}/getChatMember?chat_id=${ch}&user_id=${uid}`);
        const d = await res.json();
        if (!d.ok || ["left", "kicked"].includes(d.result.status)) {
          unsub.push(ch);
        }
      } catch {
        unsub.push(ch);
      }
    }
    return unsub;
  }
  async function getStats() {
    let total = 0, reg24 = 0, act24 = 0;
    const now = Date.now();
    const day = 86400000;
    for await (const e of kv.list({ prefix: ["users"] })) {
      total++;
      if (e.value.registered_at > now - day) reg24++;
      if (e.value.last_active > now - day) act24++;
    }
    const chnum = ((await kv.get(["channels"])).value || []).length;
    const adnum = ((await kv.get(["admins"])).value || []).length;
    return { total, reg24, act24, channels: chnum, admins: adnum };
  }
  function buildJoinRows(chs: string[], titles: string[]) {
    const rows = [];
    for (let i = 0; i < chs.length; i += 2) {
      const row = [];
      row.push({ text: titles[i], url: `https://t.me/${chs[i].substring(1)}` });
      if (i + 1 < chs.length) {
        row.push({ text: titles[i + 1], url: `https://t.me/${chs[i + 1].substring(1)}` });
      }
      rows.push(row);
    }
    return rows;
  }
  // Initialize admins if not set
  let admins = (await kv.get(["admins"])).value;
  if (!admins) {
    admins = ["@Masakoff"];
    await kv.set(["admins"], admins);
  }
  // Handle my_chat_member updates for promotion/demotion
  if (myChatMember) {
    const chat = myChatMember.chat;
    if (chat.type === "channel") {
      const chUsername = chat.username ? `@${chat.username}` : null;
      if (chUsername) {
        const newStatus = myChatMember.new_chat_member.status;
        const oldStatus = myChatMember.old_chat_member.status;
        let message = "";
        let adminChs = (await kv.get(["admin_channels"])).value || [];
        if (newStatus === "administrator" && oldStatus !== "administrator") {
          message = `🤖 Bot indi bu kanalyň admini: ${chUsername}`;
          if (!adminChs.includes(chUsername)) {
            adminChs.push(chUsername);
            await kv.set(["admin_channels"], adminChs);
          }
        } else if (newStatus !== "administrator" && oldStatus === "administrator") {
          message = `⚠️ Bot bu kanaldan adminlikden aýryldy: ${chUsername}`;
          const idx = adminChs.indexOf(chUsername);
          if (idx > -1) {
            adminChs.splice(idx, 1);
            await kv.set(["admin_channels"], adminChs);
          }
        }
        if (message) {
          admins = (await kv.get(["admins"])).value || [];
          for (const adm of admins) {
            const aid = (await kv.get(["admin_ids", adm])).value;
            if (aid) {
              await sendMessage(aid, message);
            }
          }
        }
      }
    }
    return new Response("OK", { status: 200 });
  }
  // Handle channel posts
  if (channelPost) {
    const channelUsername = channelPost.chat.username ? `@${channelPost.chat.username}` : null;
    if (channelUsername) {
      const channels = (await kv.get(["channels"])).value || [];
      const extraChannels = (await kv.get(["extra_channels"])).value || [];
      const allMonitored = [...channels, ...extraChannels];
      if (allMonitored.includes(channelUsername)) {
        const postText = channelPost.text || channelPost.caption || "";
        const protocols = ["ss://", "vless://", "vmess://", "happ://"];
        const hasProtocol = protocols.some(p => postText.includes(p));
        let hasFile = false;
        if (channelPost.document) {
          const fileName = channelPost.document.file_name || "";
          const extensions = [".npvt", ".dark", ".hc"];
          hasFile = extensions.some(ext => fileName.toLowerCase().endsWith(ext));
        }
        let isFromPostBot = false;
        if (channelPost.forward_origin) {
          if (channelPost.forward_origin.type === "user" && channelPost.forward_origin.sender_user?.username === "PostBot") {
            isFromPostBot = true;
          } else if (channelPost.forward_origin.type === "channel" && channelPost.forward_origin.chat?.username === "PostBot") {
            isFromPostBot = true;
          }
        }
        if ((hasProtocol || hasFile) && !isFromPostBot) {
          const targetChannel = "@MugtVpns";
          const copyRes = await copyMessage(targetChannel, channelPost.chat.id, channelPost.message_id);
          if (copyRes.ok) {
            let count = (await kv.get(["forward_count"])).value || 0;
            count++;
            await kv.set(["forward_count"], count);
            const newMessage = copyRes.result;
            const newMsgId = newMessage.message_id;
            if (count % 5 === 0) {
              const appendText = "\n\n🤗 Хᴏᴛиᴛᴇ ᴛᴀᴋᴏй жᴇ ᴋᴧюч дᴇᴧиᴛᴇᴄь нᴀɯиʍ ᴋᴀнᴀᴧᴏʍ и нᴇ ɜᴀбыʙᴀйᴛᴇ ᴄᴛᴀʙиᴛь ᴧᴀйᴋи❤️‍🩹👍";
              if (newMessage.text) {
                const newText = (newMessage.text || "") + appendText;
                await editMessageText(targetChannel, newMsgId, newText, { parse_mode: newMessage.parse_mode });
              } else if (newMessage.caption) {
                const newCaption = (newMessage.caption || "") + appendText;
                await editMessageCaption(targetChannel, newMsgId, newCaption, { parse_mode: newMessage.parse_mode });
              } else {
                await sendMessage(targetChannel, appendText, { reply_to_message_id: newMsgId });
              }
            }
          }
        }
      }
    }
    return new Response("OK", { status: 200 });
  }
  // Handle states for admin inputs
  if (message) {
    const stateKey = ["state", userId];
    const state = (await kv.get(stateKey)).value;
    if (state) {
      let channel: string, idx: number, pos: number;
      let chs: string[];
      switch (state) {
        case "add_channel":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          channel = text.trim();
          if (!channel.startsWith("@")) channel = "@" + channel;
          if ((await getChannelTitle(channel)) === channel) {
            await sendMessage(chatId, "⚠️ Kanal tapylmady ýa-da nädogry");
            break;
          }
          chs = (await kv.get(["channels"])).value || [];
          if (chs.includes(channel)) {
            await sendMessage(chatId, "⚠️ Kanal eýýäm goşuldy");
            break;
          }
          chs.push(channel);
          await kv.set(["channels"], chs);
          await sendMessage(chatId, "✅ Kanal üstünlikli goşuldy");
          break;
        case "delete_channel":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          channel = text.trim();
          if (!channel.startsWith("@")) channel = "@" + channel;
          chs = (await kv.get(["channels"])).value || [];
          idx = chs.indexOf(channel);
          if (idx === -1) {
            await sendMessage(chatId, "⚠️ Kanal tapylmady");
            break;
          }
          chs.splice(idx, 1);
          await kv.set(["channels"], chs);
          await sendMessage(chatId, "✅ Kanal üstünlikli aýryldy");
          break;
        case "add_extra_channel":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          channel = text.trim();
          if (!channel.startsWith("@")) channel = "@" + channel;
          if ((await getChannelTitle(channel)) === channel) {
            await sendMessage(chatId, "⚠️ Kanal tapylmady ýa-da nädogry");
            break;
          }
          chs = (await kv.get(["extra_channels"])).value || [];
          if (chs.includes(channel)) {
            await sendMessage(chatId, "⚠️ Kanal eýýäm goşuldy");
            break;
          }
          chs.push(channel);
          await kv.set(["extra_channels"], chs);
          await sendMessage(chatId, "✅ Extra kanal üstünlikli goşuldy");
          break;
        case "delete_extra_channel":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          channel = text.trim();
          if (!channel.startsWith("@")) channel = "@" + channel;
          chs = (await kv.get(["extra_channels"])).value || [];
          idx = chs.indexOf(channel);
          if (idx === -1) {
            await sendMessage(chatId, "⚠️ Kanal tapylmady");
            break;
          }
          chs.splice(idx, 1);
          await kv.set(["extra_channels"], chs);
          await sendMessage(chatId, "✅ Extra kanal üstünlikli aýryldy");
          break;
        case "change_place":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          const parts = text.trim().split(/\s+/);
          if (parts.length !== 2) {
            await sendMessage(chatId, "⚠️ Nädogry format ýa-da kanal tapylmady");
            break;
          }
          channel = parts[0];
          if (!channel.startsWith("@")) channel = "@" + channel;
          pos = parseInt(parts[1]);
          if (isNaN(pos) || pos < 1) {
            await sendMessage(chatId, "⚠️ Nädogry format ýa-da kanal tapylmady");
            break;
          }
          chs = (await kv.get(["channels"])).value || [];
          idx = chs.indexOf(channel);
          if (idx === -1) {
            await sendMessage(chatId, "⚠️ Nädogry format ýa-da kanal tapylmady");
            break;
          }
          if (pos > chs.length) pos = chs.length;
          const item = chs.splice(idx, 1)[0];
          chs.splice(pos - 1, 0, item);
          await kv.set(["channels"], chs);
          await sendMessage(chatId, "✅ Orun üstünlikli üýtgedildi");
          break;
        case "change_text":
          let fromChatId = chatId;
          let msgId = message.message_id;
          if (message.forward_origin && message.forward_origin.type === "channel") {
            fromChatId = message.forward_origin.chat.id;
            msgId = message.forward_origin.message_id;
          }
          await kv.set(["success_message"], { from_chat_id: fromChatId, message_id: msgId });
          await sendMessage(chatId, "✅ Üstünlik habary üýtgedildi");
          break;
        case "change_post":
          await kv.set(["broadcast_post"], { from_chat_id: chatId, message_id: message.message_id });
          await sendMessage(chatId, "✅ Post üstünlikli üýtgedildi");
          break;
        case "global_message":
          let globalFromChatId = chatId;
          let globalMsgId = message.message_id;
          if (message.forward_origin && message.forward_origin.type === "channel") {
            globalFromChatId = message.forward_origin.chat.id;
            globalMsgId = message.forward_origin.message_id;
          }
          let sentCount = 0;
          for await (const e of kv.list({ prefix: ["users"] })) {
            try {
              await copyMessage(e.key[1], globalFromChatId, globalMsgId);
              sentCount++;
            } catch {}
          }
          await sendMessage(chatId, `✅ Habar ${sentCount} ulanyjylara iberildi`);
          break;
        case "add_admin":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          if (username !== "@Masakoff") {
            await sendMessage(chatId, "⚠️ Diňe @Masakoff adminleri goşup ýa-da aýyryp bilýär");
            break;
          }
          let newAdm = text.trim();
          if (!newAdm.startsWith("@")) newAdm = "@" + newAdm;
          admins = (await kv.get(["admins"])).value || ["@Masakoff"];
          if (admins.includes(newAdm)) {
            await sendMessage(chatId, "⚠️ Eýýäm admin");
            break;
          }
          admins.push(newAdm);
          await kv.set(["admins"], admins);
          await sendMessage(chatId, "✅ Admin goşuldy");
          break;
        case "delete_admin":
          if (!text) {
            await sendMessage(chatId, "⚠️ Tekst iberiň");
            break;
          }
          if (username !== "@Masakoff") {
            await sendMessage(chatId, "⚠️ Diňe @Masakoff adminleri goşup ýa-da aýyryp bilýär");
            break;
          }
          let delAdm = text.trim();
          if (!delAdm.startsWith("@")) delAdm = "@" + delAdm;
          admins = (await kv.get(["admins"])).value || ["@Masakoff"];
          idx = admins.indexOf(delAdm);
          if (idx === -1) {
            await sendMessage(chatId, "⚠️ Admin tapylmady");
            break;
          }
          admins.splice(idx, 1);
          await kv.set(["admins"], admins);
          await sendMessage(chatId, "✅ Admin aýryldy");
          break;
      }
      await kv.delete(stateKey);
      return new Response("OK", { status: 200 });
    }
  }
  if (message && text) {
    // Handle /start
    if (text.startsWith("/start")) {
      const channels = (await kv.get(["channels"])).value || [];
      const subscribed = await isSubscribed(userId, channels);
      if (subscribed) {
        const successMsg = (await kv.get(["success_message"])).value;
        if (successMsg) {
          await copyMessage(chatId, successMsg.from_chat_id, successMsg.message_id);
        } else {
          await sendMessage(chatId, "🎉 Siziň ähli kanallara agza boldyňyz! VPN-iňizden lezzet alyň.");
        }
      } else {
        const chTitles = await Promise.all(channels.map(getChannelTitle));
        const subText = "⚠️ Bu kanallara abuna boluň VPN almak üçin";
        const mainRows = buildJoinRows(channels, chTitles);
        const adRows = [[{ text: "MugtVpns", url: "https://t.me/addlist/5wQ1fNW2xIdjZmIy" }]];
        const keyboard = [...mainRows, ...adRows, [{ text: "Abuna barla ✅", callback_data: "check_sub" }]];
        await sendMessage(chatId, subText, { reply_markup: { inline_keyboard: keyboard } });
      }
    }
    // Handle /admin
    if (text === "/admin") {
      if (!username || !admins.includes(username)) {
        await sendMessage(chatId, "⚠️ Siziň admin bolmagyňyz ýok");
        return new Response("OK", { status: 200 });
      }
      // Store admin id
      await kv.set(["admin_ids", username], userId);
      const stats = await getStats();
      let statText = "📊 Bot statistikasy:\n";
      statText += `1. Jemgyýetdäki ulanyjylar: ${stats.total}\n`;
      statText += `2. Soňky 24 sagatda hasaba alnan ulanyjylar: ${stats.reg24}\n`;
      statText += `3. Soňky 24 sagatda işjeň ulanyjylar: ${stats.act24}\n`;
      statText += `4. Kanallaryň sany: ${stats.channels}\n`;
      statText += `5. Adminleriň sany: ${stats.admins}`;
      await sendMessage(chatId, statText);
      const adminKb = [
        [{ text: "➕ Kanal goş", callback_data: "admin_add_channel" }, { text: "❌ Kanal aýyry", callback_data: "admin_delete_channel" }],
        [{ text: "➕ Extra kanal goş", callback_data: "admin_add_extra_channel" }, { text: "❌ Extra kanal aýyry", callback_data: "admin_delete_extra_channel" }],
        [{ text: "🔄 Kanallaryň ýerini üýtget", callback_data: "admin_change_place" }],
        [{ text: "✏️ Üstünlik tekstini üýtget", callback_data: "admin_change_text" }],
        [{ text: "🌍 Global habar", callback_data: "admin_global_message" }],
        [{ text: "✏️ Ýaýratmak postyny üýtget", callback_data: "admin_change_post" }, { text: "📤 Post iber", callback_data: "admin_send_post" }],
        [{ text: "➕ Admin goş", callback_data: "admin_add_admin" }, { text: "❌ Admin aýyry", callback_data: "admin_delete_admin" }],
      ];
      await sendMessage(chatId, "Admin paneli", { reply_markup: { inline_keyboard: adminKb } });
    }
  }
  // Handle callback queries
  if (callbackQuery && data) {
    admins = (await kv.get(["admins"])).value || ["@Masakoff"];
    if (data.startsWith("admin_") && (!username || !admins.includes(username))) {
      await answerCallback(callbackQueryId, "Siziň admin bolmagyňyz ýok");
      return new Response("OK", { status: 200 });
    }
    if (data === "check_sub") {
      const channels = (await kv.get(["channels"])).value || [];
      const unsubChs = await getUnsubscribed(userId, channels);
      const subscribed = unsubChs.length === 0;
      if (subscribed) {
        await deleteMessage(chatId, messageId);
        const successMsg = (await kv.get(["success_message"])).value;
        if (successMsg) {
          await copyMessage(chatId, successMsg.from_chat_id, successMsg.message_id);
        } else {
          await sendMessage(chatId, "🎉 Siziň ähli kanallara abuna boldyňyz! VPN-iňizden lezzet alyň.");
        }
        await answerCallback(callbackQueryId);
      } else {
        const chTitles = await Promise.all(unsubChs.map(getChannelTitle));
        const textToSend = "⚠️ Bu henizem abuna bolmadyk kanallara abuna boluň VPN almak üçin";
        const mainRows = buildJoinRows(unsubChs, chTitles);
        const adRows = [[{ text: "MugtVpns", url: "https://t.me/addlist/5wQ1fNW2xIdjZmIy" }]];
        const keyboard = [...mainRows, ...adRows, [{ text: "Abuna barla ✅", callback_data: "check_sub" }]];
        await editMessageText(chatId, messageId, textToSend, { reply_markup: { inline_keyboard: keyboard } });
        await answerCallback(callbackQueryId);
      }
    } else if (data.startsWith("admin_")) {
      const action = data.substring(6);
      const stateKey = ["state", userId];
      let prompt = "";
      switch (action) {
        case "add_channel":
          prompt = "📥 Kanalyň ulanyjyny (mysal üçin @channel) iberiň";
          await kv.set(stateKey, "add_channel");
          break;
        case "delete_channel":
          prompt = "📥 Aýyrmak üçin ulanyjyny iberiň";
          await kv.set(stateKey, "delete_channel");
          break;
        case "add_extra_channel":
          prompt = "📥 Extra kanalyň ulanyjyny (mysal üçin @channel) iberiň";
          await kv.set(stateKey, "add_extra_channel");
          break;
        case "delete_extra_channel":
          prompt = "📥 Extra kanaly aýyrmak üçin ulanyjyny iberiň";
          await kv.set(stateKey, "delete_extra_channel");
          break;
        case "change_place":
          const chs = (await kv.get(["channels"])).value || [];
          let orderText = "📋 Häzirki kanallaryň tertibi:\n";
          chs.forEach((ch: string, i: number) => {
            orderText += `${ch} - ${i + 1}\n`;
          });
          prompt = orderText + "\n📥 Kanal ulanyjysyny we täze orny (mysal üçin @channel 3) iberiň";
          await kv.set(stateKey, "change_place");
          break;
        case "change_text":
          prompt = "📥 Täze üstünlik habaryny iberiň ýa-da forward ediň (kanaldan, sender adyny gizlemek üçin; tekst, surat, wideo we ş.m.)";
          await kv.set(stateKey, "change_text");
          break;
        case "global_message":
          prompt = "📥 Ähli ulanyjylara iberiljek habary iberiň ýa-da forward ediň (kanaldan, sender adyny gizlemek üçin; tekst, surat, wideo we ş.m.)";
          await kv.set(stateKey, "global_message");
          break;
        case "change_post":
          prompt = "📥 Täze ýaýratmak postyny iberiň (tekst, surat, wideo we ş.m.)";
          await kv.set(stateKey, "change_post");
          break;
        case "send_post":
          const post = (await kv.get(["broadcast_post"])).value;
          if (!post) {
            await answerCallback(callbackQueryId, "Post ýok");
            break;
          }
          const channels = (await kv.get(["channels"])).value || [];
          const extraChannels = (await kv.get(["extra_channels"])).value || [];
          const allChannels = [...channels, ...extraChannels];
          for (const ch of allChannels) {
            await forwardMessage(ch, post.from_chat_id, post.message_id);
          }
          await answerCallback(callbackQueryId, "✅ Post ähli kanallara iberildi");
          break;
        case "add_admin":
          if (username !== "@Masakoff") {
            await answerCallback(callbackQueryId, "Diňe @Masakoff adminleri goşup bilýär");
            break;
          }
          prompt = "📥 Admin hökmünde goşmak üçin ulanyjyny (mysal üçin @user) iberiň";
          await kv.set(stateKey, "add_admin");
          break;
        case "delete_admin":
          if (username !== "@Masakoff") {
            await answerCallback(callbackQueryId, "Diňe @Masakoff adminleri aýyryp bilýär");
            break;
          }
          prompt = "📥 Admini aýyrmak üçin ulanyjyny iberiň";
          await kv.set(stateKey, "delete_admin");
          break;
      }
      if (prompt) {
        await editMessageText(chatId, messageId, prompt);
      }
      await answerCallback(callbackQueryId);
    }
  }
  return new Response("OK", { status: 200 });
});