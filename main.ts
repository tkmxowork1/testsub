import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const kv = await Deno.openKv();

const TOKEN = Deno.env.get("BOT_TOKEN");
const botId = TOKEN.split(':')[0];
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

  function buildButtonRows(btns: {text: string, url: string}[]) {
    const rows = [];
    for (let i = 0; i < btns.length; i += 2) {
      const row = [];
      row.push({ text: btns[i].text, url: btns[i].url });
      if (i + 1 < btns.length) {
        row.push({ text: btns[i + 1].text, url: btns[i + 1].url });
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

  // Handle states for admin inputs
  if (message && text) {
    const stateKey = ["state", userId];
    const state = (await kv.get(stateKey)).value;
    if (state) {
      let channel: string, idx: number, pos: number;
      let chs: string[];
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
          let isAdmin = false;
          try {
            const res = await fetch(`${TELEGRAM_API}/getChatMember?chat_id=${channel}&user_id=${botId}`);
            const d = await res.json();
            if (d.ok && d.result.status === "administrator") {
              isAdmin = true;
            }
          } catch {}
          await kv.set(["channels"], chs);
          await sendMessage(chatId, "✅ Kanal üstünlikli goşuldy");
          if (!isAdmin) {
            const inlineKeyboard = [[
              { text: "➕ Bot-y admin et", url: `https://t.me/${channel.substring(1)}` }
            ]];
            await sendMessage(chatId, "⚠️ Bot kanalda admin däl! Abuna barlanmagy işlemek üçin bot-y admin etmäli.", { reply_markup: { inline_keyboard: inlineKeyboard } });
          }
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
        case "add_button_name":
          const name = text.trim();
          await kv.set(["temp", userId], { button_name: name });
          await kv.set(stateKey, "add_button_link");
          await sendMessage(chatId, "📥 Button üçin link iberiň");
          break;
        case "add_button_link":
          const url = text.trim();
          const temp = (await kv.get(["temp", userId])).value;
          if (!temp || !temp.button_name) {
            await sendMessage(chatId, "⚠️ Nädogry");
            break;
          }
          let buttons = (await kv.get(["buttons"])).value || [];
          buttons.push({ text: temp.button_name, url });
          await kv.set(["buttons"], buttons);
          await sendMessage(chatId, "✅ Button goşuldy");
          await kv.delete(["temp", userId]);
          break;
        case "delete_button":
          const buttonName = text.trim();
          let buttonsList = (await kv.get(["buttons"])).value || [];
          idx = buttonsList.findIndex((b: {text: string, url: string}) => b.text === buttonName);
          if (idx === -1) {
            await sendMessage(chatId, "⚠️ Button tapylmady");
            break;
          }
          buttonsList.splice(idx, 1);
          await kv.set(["buttons"], buttonsList);
          await sendMessage(chatId, "✅ Button aýryldy");
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
      const buttons = (await kv.get(["buttons"])).value || [];
      const subscribed = await isSubscribed(userId, channels);
      if (subscribed) {
        const successText = (await kv.get(["success_text"])).value || "🎉 Siziň ähli kanallara we adlist papkasyna abuna boldyňyz! VPN-iňizden lezzetli ulanyň.";
        await sendMessage(chatId, successText);
      } else {
        const chTitles = await Promise.all(channels.map(getChannelTitle));
        const mainRows = buildJoinRows(channels, chTitles);
        const buttonRows = buildButtonRows(buttons);
        let subText = "⚠️ Bu kanallara abuna boluň VPN almak üçin";
        if (buttons.length > 0) subText += "\n\nAdlist kanallary:";
        const keyboard = [...mainRows, ...buttonRows, [{ text: "Abuna barla ✅", callback_data: "check_sub" }]];
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
        [{ text: "🔄 Kanallaryň ýerini üýtget", callback_data: "admin_change_place" }, { text: "➕ Button goş", callback_data: "admin_add_button" }],
        [{ text: "❌ Button aýyr", callback_data: "admin_delete_button" }, { text: "✏️ Üýtgeşme tekstini üýtget", callback_data: "admin_change_text" }],
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
      const buttons = (await kv.get(["buttons"])).value || [];
      const subscribed = await isSubscribed(userId, channels);
      const successText = (await kv.get(["success_text"])).value || "🎉 Siziň ähli kanallara we adlist papkasyna abuna boldyňyz! VPN-iňizden lezzetli ulanyň.";
      const textToSend = subscribed ? successText : "⚠️ Siziň ähli kanallara henizem abuna bolmadyňyz. Haýsy kanallara goşulmaly bolýandygyňyzy bilýärsiňiz.";
      let keyboard;
      if (!subscribed) {
        const chTitles = await Promise.all(channels.map(getChannelTitle));
        const mainRows = buildJoinRows(channels, chTitles);
        const buttonRows = buildButtonRows(buttons);
        keyboard = [...mainRows, ...buttonRows, [{ text: "Abuna barla ✅", callback_data: "check_sub" }]];
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
          const inlineKeyboard = chs.map((ch: string) => [
            { text: "➕ Bot-y admin et - " + ch, url: `https://t.me/${ch.substring(1)}` }
          ]);
          await kv.set(stateKey, "change_place");
          await editMessageText(chatId, messageId, prompt, { reply_markup: { inline_keyboard: inlineKeyboard } });
          await answerCallback(callbackQueryId);
          return new Response("OK", { status: 200 });
        case "add_button":
          prompt = "📥 Button adyny iberiň";
          await kv.set(stateKey, "add_button_name");
          break;
        case "delete_button":
          const buttons = (await kv.get(["buttons"])).value || [];
          let buttonText = "📋 Häzirki buttonlar:\n";
          buttons.forEach((b: {text: string, url: string}) => {
            buttonText += `${b.text}\n`;
          });
          prompt = buttonText + "\n📥 Aýyrmak üçin adyny iberiň";
          await kv.set(stateKey, "delete_button");
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
          const allChs = (await kv.get(["channels"])).value || [];
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