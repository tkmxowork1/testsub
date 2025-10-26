// main.ts
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
  const chatId = message?.chat?.id || callbackQuery?.message?.chat?.id;
  const userId = message?.from?.id || callbackQuery?.from?.id;
  const username = (message?.from?.username || callbackQuery?.from?.username) ? `@${message?.from?.username || callbackQuery?.from?.username}` : null;
  const text = message?.text;
  const data = callbackQuery?.data;
  const messageId = callbackQuery?.message?.message_id;
  const callbackQueryId = callbackQuery?.id;

  if (!chatId || !userId) return new Response("No chat ID", { status: 200 });

  // Update user activity
  const userKey = ["users", userId];
  let userData = (await kv.get(userKey)).value || { registered_at: Date.now(), last_active: Date.now() };
  if (!userData.registered_at) userData.registered_at = Date.now();
  userData.last_active = Date.now();
  await kv.set(userKey, userData);

  // Helper functions
  async function sendMessage(cid: number, txt: string, opts = {}) {
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

  async function getFolderName(link: string) {
    try {
      const res = await fetch(link, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
      });
      const html = await res.text();
      const match = html.match(/add \d+ chats? from the (.*?) list on Telegram/i);
      if (match) {
        let name = match[1];
        name = name.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        return name;
      }
      return null;
    } catch {
      return null;
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
    const adnum = ((await kv.get(["adlist"])).value || []).length;
    return { total, reg24, act24, channels: chnum, admins: adnum };
  }

  function buildUrlRows(items: { text: string; url: string }[]) {
    const rows = [];
    for (let i = 0; i < items.length; i += 2) {
      const row = [];
      if (i < items.length) row.push({ text: items[i].text, url: items[i].url });
      if (i + 1 < items.length) row.push({ text: items[i + 1].text, url: items[i + 1].url });
      if (row.length > 0) rows.push(row);
    }
    return rows;
  }

  // Initialize admins if not set
  let admins = (await kv.get(["admins"])).value;
  if (!admins) {
    admins = ["@Masakoff"];
    await kv.set(["admins"], admins);
  }

  // Handle states for admin inputs
  if (message && text) {
    const stateKey = ["state", userId];
    const state = (await kv.get(stateKey)).value;
    if (state) {
      let channel: string, idx: number, pos: number;
      let chs: string[];
      let adl: { link: string; name: string }[];
      switch (state) {
        case "add_channel":
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
        case "change_place":
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
        case "add_adlist":
          const link = text.trim();
          if (!link.startsWith("https://t.me/addlist/")) {
            await sendMessage(chatId, "⚠️ Nädogry papka linki");
            break;
          }
          const name = await getFolderName(link);
          if (!name) {
            await sendMessage(chatId, "⚠️ Papka adyny tapyp bolmady ýa-da nädogry link");
            break;
          }
          adl = (await kv.get(["adlist"])).value || [];
          if (adl.some((f) => f.link === link)) {
            await sendMessage(chatId, "⚠️ Papka eýýäm goşuldy");
            break;
          }
          adl.push({ link, name });
          await kv.set(["adlist"], adl);
          await sendMessage(chatId, "✅ Papka üstünlikli goşuldy");
          break;
        case "delete_adlist":
          const dlink = text.trim();
          if (!dlink.startsWith("https://t.me/addlist/")) {
            await sendMessage(chatId, "⚠️ Nädogry papka linki");
            break;
          }
          adl = (await kv.get(["adlist"])).value || [];
          idx = adl.findIndex((f) => f.link === dlink);
          if (idx === -1) {
            await sendMessage(chatId, "⚠️ Papka tapylmady");
            break;
          }
          adl.splice(idx, 1);
          await kv.set(["adlist"], adl);
          await sendMessage(chatId, "✅ Papka üstünlikli aýryldy");
          break;
        case "change_text":
          const newTxt = text.trim();
          await kv.set(["success_text"], newTxt);
          await sendMessage(chatId, "✅ Üstünlik teksti üýtgedildi");
          break;
        case "change_post":
          const newPost = text.trim();
          await kv.set(["broadcast_post"], newPost);
          await sendMessage(chatId, "✅ Post üýtgedildi");
          break;
        case "add_admin":
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

    // Handle /start
    if (text.startsWith("/start")) {
      const channels = (await kv.get(["channels"])).value || [];
      const adlist = (await kv.get(["adlist"])).value || []; // {link, name}[]
      const subscribed = await isSubscribed(userId, channels);
      if (subscribed) {
        const successText = (await kv.get(["success_text"])).value || "🎉 Siziň ähli kanallara we papkalara abuna boldyňyz! VPN-iňizden lezzetli ulanyň.";
        await sendMessage(chatId, successText);
      } else {
        const chTitles = await Promise.all(channels.map(getChannelTitle));
        const mainItems = channels.map((ch, i) => ({ text: chTitles[i], url: `https://t.me/${ch.substring(1)}` }));
        const mainRows = buildUrlRows(mainItems);
        const adItems = adlist.map(f => ({ text: f.name, url: f.link }));
        const adRows = buildUrlRows(adItems);
        let subText = "⚠️ Bu kanallara abuna boluň VPN almak üçin";
        if (adlist.length > 0) subText += "\n\nPapkalar:";
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
        [{ text: "🔄 Kanallaryň ýerini üýtget", callback_data: "admin_change_place" }, { text: "➕ Papka goş", callback_data: "admin_add_adlist" }],
        [{ text: "❌ Papka aýyr", callback_data: "admin_delete_adlist" }, { text: "✏️ Üýtgeşme tekstini üýtget", callback_data: "admin_change_text" }],
        [{ text: "✏️ Ýaýratmak postyny üýtget", callback_data: "admin_change_post" }, { text: "📤 Post iber", callback_data: "admin_send_post" }],
        [{ text: "➕ Admin goş", callback_data: "admin_add_admin" }, { text: "❌ Admin aýyr", callback_data: "admin_delete_admin" }],
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
      const adlist = (await kv.get(["adlist"])).value || [];
      const subscribed = await isSubscribed(userId, channels);
      const successText = (await kv.get(["success_text"])).value || "🎉 Siziň ähli kanallara we papkalara abuna boldyňyz! VPN-iňizden lezzetli ulanyň.";
      const textToSend = subscribed ? successText : "⚠️ Siziň ähli kanallara henizem abuna bolmadyňyz. Haýsy kanallara goşulmaly bolýandygyňyzy bilýärsiňiz.";
      let keyboard;
      if (!subscribed) {
        const chTitles = await Promise.all(channels.map(getChannelTitle));
        const mainItems = channels.map((ch, i) => ({ text: chTitles[i], url: `https://t.me/${ch.substring(1)}` }));
        const mainRows = buildUrlRows(mainItems);
        const adItems = adlist.map(f => ({ text: f.name, url: f.link }));
        const adRows = buildUrlRows(adItems);
        keyboard = [...mainRows, ...adRows, [{ text: "Abuna barla ✅", callback_data: "check_sub" }]];
      }
      await editMessageText(chatId, messageId, textToSend, { reply_markup: subscribed ? undefined : { inline_keyboard: keyboard } });
      await answerCallback(callbackQueryId);
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
        case "change_place":
          const chs = (await kv.get(["channels"])).value || [];
          let orderText = "📋 Häzirki kanallaryň tertibi:\n";
          chs.forEach((ch: string, i: number) => {
            orderText += `${ch} - ${i + 1}\n`;
          });
          prompt = orderText + "\n📥 Kanal ulanyjysyny we täze orny (mysal üçin @channel 3) iberiň";
          await kv.set(stateKey, "change_place");
          break;
        case "add_adlist":
          prompt = "📥 Papkanyň linkini iberiň (mysal: https://t.me/addlist/ABC)";
          await kv.set(stateKey, "add_adlist");
          break;
        case "delete_adlist":
          prompt = "📥 Papkany aýyrmak üçin linkini iberiň";
          await kv.set(stateKey, "delete_adlist");
          break;
        case "change_text":
          prompt = "📥 Täze üstünlik tekstini iberiň";
          await kv.set(stateKey, "change_text");
          break;
        case "change_post":
          prompt = "📥 Täze ýaýratmak postyny iberiň";
          await kv.set(stateKey, "change_post");
          break;
        case "send_post":
          const post = (await kv.get(["broadcast_post"])).value;
          if (!post) {
            await answerCallback(callbackQueryId, "Post ýok");
            break;
          }
          const allChs = [...(await kv.get(["channels"])).value || []];
          for (const ch of allChs) {
            await sendMessage(ch, post);
          }
          await answerCallback(callbackQueryId, "Post ähli kanallara iberildi");
          break;
        case "add_admin":
          prompt = "📥 Admin hökmünde goşmak üçin ulanyjyny (mysal üçin @user) iberiň";
          await kv.set(stateKey, "add_admin");
          break;
        case "delete_admin":
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