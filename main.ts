// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const kv = await Deno.openKv();

const TOKEN = Deno.env.get("BOT_TOKEN");
const SECRET_PATH = "/testsub"; // change this
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;

const me = await (await fetch(`${TELEGRAM_API}/getMe`)).json();
const BOT_ID = me.result.id;

// Initialize defaults
let admins = await kv.get(["admins"]);
if (!admins.value) {
  await kv.set(["admins"], ["Masakoff"]);
}
let subscribedText = await kv.get(["subscribed_text"]);
if (!subscribedText.value) {
  await kv.set(["subscribed_text"], "🎉 Ähli kanallara abunä boldyňyz! Indi VPN alyp bilersiňiz.");
}
let channels = await kv.get(["channels"]);
if (!channels.value) {
  await kv.set(["channels"], []);
}
let adminChannels = await kv.get(["admin_channels"]);
if (!adminChannels.value) {
  await kv.set(["admin_channels"], []);
}
let postText = await kv.get(["post_text"]);
if (!postText.value) {
  await kv.set(["post_text"], "");
}
let postButtons = await kv.get(["post_buttons"]);
if (!postButtons.value) {
  await kv.set(["post_buttons"], []);
}

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

  let chatId, userId, username, text, data, messageId;
  if (message) {
    chatId = message.chat.id;
    userId = message.from.id;
    username = message.from.username;
    text = message.text;
  } else if (callbackQuery) {
    chatId = callbackQuery.message.chat.id;
    userId = callbackQuery.from.id;
    username = callbackQuery.from.username;
    data = callbackQuery.data;
    messageId = callbackQuery.message.message_id;
  }

  if (chatId) {
    let userData = await kv.get(["users", userId]).value || { registered_at: Date.now(), last_active: Date.now() };
    userData.last_active = Date.now();
    await kv.set(["users", userId], userData);

    admins = await kv.get(["admins"]);
    if (username && admins.value.includes(username)) {
      await kv.set(["admin_chat", username], chatId);
    }
  }

  if (myChatMember) {
    const chat = myChatMember.chat;
    if (chat.type === "channel") {
      const newMember = myChatMember.new_chat_member;
      const oldMember = myChatMember.old_chat_member;
      if (newMember.user.id === BOT_ID) {
        const isAdmin = newMember.status === "administrator" && newMember.can_post_messages;
        const wasAdmin = oldMember.status === "administrator" && oldMember.can_post_messages;
        const channelUsername = chat.username;
        if (channelUsername) {
          let adminChannelsList = await kv.get(["admin_channels"]).value || [];
          if (!wasAdmin && isAdmin) {
            const chUsername = `@${channelUsername}`;
            if (!adminChannelsList.includes(chUsername)) {
              adminChannelsList.push(chUsername);
              await kv.set(["admin_channels"], adminChannelsList);
            }
            await notifyAdmins(`🤖 Bot häzir kanalda admin bolupdy ${chUsername}`);
          } else if (wasAdmin && !isAdmin) {
            const chUsername = `@${channelUsername}`;
            adminChannelsList = adminChannelsList.filter(u => u !== chUsername);
            await kv.set(["admin_channels"], adminChannelsList);
            await notifyAdmins(`⚠️ Bot kanalda admin däl indi ${chUsername}`);
          }
        }
      }
    }
    return new Response("OK", { status: 200 });
  }

  async function notifyAdmins(notifyText) {
    const adminsList = await kv.get(["admins"]).value || [];
    for (const adminUsername of adminsList) {
      const adminChatId = await kv.get(["admin_chat", adminUsername]).value;
      if (adminChatId) {
        await sendMessage(adminChatId, notifyText);
      }
    }
  }

  async function sendMessage(id, txt, markup = undefined) {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: id,
        text: txt,
        reply_markup: markup,
      }),
    });
  }

  async function getUnsubscribed(uid) {
    const channelsList = await kv.get(["channels"]).value || [];
    const unsub = [];
    for (const ch of channelsList) {
      const res = await fetch(`${TELEGRAM_API}/getChatMember?chat_id=${ch.username}&user_id=${uid}`);
      const d = await res.json();
      if (!d.ok || ["left", "kicked"].includes(d.result.status)) {
        unsub.push(ch);
      }
    }
    return unsub.sort((a, b) => a.place - b.place);
  }

  function buildChannelsKeyboard(chs) {
    const kb = [];
    for (let i = 0; i < chs.length; i += 2) {
      const row = [];
      row.push({ text: chs[i].title, url: `https://t.me/${chs[i].username.slice(1)}` });
      if (i + 1 < chs.length) {
        row.push({ text: chs[i + 1].title, url: `https://t.me/${chs[i + 1].username.slice(1)}` });
      }
      kb.push(row);
    }
    return kb;
  }

  if (text === "/start") {
    let userData = await kv.get(["users", userId]).value;
    if (!userData) {
      userData = { registered_at: Date.now(), last_active: Date.now() };
      await kv.set(["users", userId], userData);
    }
    const unsubscribed = await getUnsubscribed(userId);
    if (unsubscribed.length === 0) {
      const subText = await kv.get(["subscribed_text"]).value;
      await sendMessage(chatId, subText);
    } else {
      const textToSend = "⚠️ VPN almak üçin aşakdaky kanallara abunä boluň:";
      let keyboard = buildChannelsKeyboard(unsubscribed);
      keyboard.push([{ text: "MugtVpns", url: "https://t.me/addlist/5wQ1fNW2xIdjZmIy" }]);
      keyboard.push([{ text: "Abunäligi barla ✅", callback_data: "check_sub" }]);
      await sendMessage(chatId, textToSend, { inline_keyboard: keyboard });
    }
  }

  if (data === "check_sub" && messageId) {
    const unsubscribed = await getUnsubscribed(userId);
    if (unsubscribed.length === 0) {
      const subText = await kv.get(["subscribed_text"]).value;
      await fetch(`${TELEGRAM_API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: subText,
        }),
      });
    } else {
      const textToSend = "⚠️ Siziň ähli kanallara abunä bolmadyňyz. Qalanlaryna abunä boluň.";
      let keyboard = buildChannelsKeyboard(unsubscribed);
      keyboard.push([{ text: "MugtVpns", url: "https://t.me/addlist/5wQ1fNW2xIdjZmIy" }]);
      keyboard.push([{ text: "Abunäligi barla ✅", callback_data: "check_sub" }]);
      await fetch(`${TELEGRAM_API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: textToSend,
          reply_markup: { inline_keyboard: keyboard },
        }),
      });
    }
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQuery.id }),
    });
  }

  if (text === "/admin") {
    admins = await kv.get(["admins"]);
    if (!username || !admins.value.includes(username)) {
      await sendMessage(chatId, "⚠️ Siz admin däl.");
      return new Response("OK", { status: 200 });
    }
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    let totalUsers = 0;
    let registeredLast24 = 0;
    let activeLast24 = 0;
    for await (const entry of kv.list({ prefix: ["users"] })) {
      totalUsers++;
      const data = entry.value;
      if (data.registered_at > twentyFourHoursAgo) registeredLast24++;
      if (data.last_active > twentyFourHoursAgo) activeLast24++;
    }
    const channelsCount = (await kv.get(["channels"]).value || []).length;
    const adminsCount = (await kv.get(["admins"]).value || []).length;
    const statsText = `📊 Bot statistikasy:\n1. Jemi ulanyjylar: ${totalUsers}\n2. Soňky 24 sanda hasapdan geçirilen ulanyjylar: ${registeredLast24}\n3. Soňky 24 sanda işjeň ulanyjylar: ${activeLast24}\n4. Kanallaryň sany: ${channelsCount}\n5. Adminleriň sany: ${adminsCount}`;
    await sendMessage(chatId, statsText);
    let adminKeyboard = [
      [{ text: "Kanal goşuň", callback_data: "admin_add_channel" }, { text: "Kanal pozmak", callback_data: "admin_delete_channel" }],
      [{ text: "Kanal tertibini üýtgetmek", callback_data: "admin_change_order" }, { text: "Teksti üýtgetmek", callback_data: "admin_change_text" }],
      [{ text: "Global habar", callback_data: "admin_global_message" }, { text: "Habary üýtgetmek", callback_data: "admin_change_post" }],
      [{ text: "Habary iber", callback_data: "admin_send_post" }],
    ];
    if (username === "Masakoff") {
      adminKeyboard.push([{ text: "Admin goşuň", callback_data: "admin_add_admin" }, { text: "Admin pozmak", callback_data: "admin_delete_admin" }]);
    }
    await sendMessage(chatId, "🛠 Admin paneli", { inline_keyboard: adminKeyboard });
  }

  if (data && data.startsWith("admin_")) {
    admins = await kv.get(["admins"]);
    if (!username || !admins.value.includes(username)) return new Response("OK", { status: 200 });
    const action = data.slice(6);
    await kv.set(["state", userId], { action });
    let promptText;
    switch (action) {
      case "add_channel":
        promptText = "Kanal ulanyjy adyny iber";
        break;
      case "delete_channel":
        promptText = "Kanal ulanyjy adyny iber";
        break;
      case "change_order":
        const chs = (await kv.get(["channels"]).value || []).sort((a, b) => a.place - b.place);
        let orderText = "Häzirki kanallaryň tertibi:\n";
        chs.forEach(ch => orderText += `${ch.title} - ${ch.place}\n`);
        orderText += "Üýtgetmek üçin, şunuň ýaly iberiň: ad täze_orun";
        await sendMessage(chatId, orderText);
        break;
      case "change_text":
        promptText = "Täze tekst iberiň";
        break;
      case "global_message":
        promptText = "Hämmelere iberiljek habar iberiň";
        break;
      case "change_post":
        await kv.set(["state", userId], { action: "change_post_text" });
        promptText = "Post teksti iberiň";
        break;
      case "send_post":
        postText = await kv.get(["post_text"]);
        postButtons = await kv.get(["post_buttons"]);
        if (!postText.value) {
          await sendMessage(chatId, "⚠️ Habary üýtgetiň ilki.");
          await kv.delete(["state", userId]);
          break;
        }
        const postKb = [];
        const pbs = postButtons.value;
        for (let i = 0; i < pbs.length; i += 2) {
          const row = [];
          row.push({ text: pbs[i].text, url: pbs[i].url });
          if (i + 1 < pbs.length) row.push({ text: pbs[i + 1].text, url: pbs[i + 1].url });
          postKb.push(row);
        }
        adminChannels = await kv.get(["admin_channels"]);
        for (const ch of adminChannels.value || []) {
          await sendMessage(ch, postText.value, { inline_keyboard: postKb });
        }
        await sendMessage(chatId, "✅ Habar iberildi");
        await kv.delete(["state", userId]);
        break;
      case "add_admin":
      case "delete_admin":
        if (username !== "Masakoff") {
          await sendMessage(chatId, "Diňe @Masakoff munuň edip biler");
          await kv.delete(["state", userId]);
          break;
        }
        promptText = action === "add_admin" ? "Admin goşmak üçin ulanyjynyň adyny iberiň" : "Ulanyjynyň adyny pozmak üçin iberiň";
        break;
    }
    if (promptText) await sendMessage(chatId, promptText);
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQuery.id }),
    });
  }

  if (text && !text.startsWith("/") && chatId) {
    const state = await kv.get(["state", userId]).value;
    if (state) {
      const action = state.action;
      switch (action) {
        case "add_channel":
          let chUsername = text.trim();
          if (!chUsername.startsWith("@")) chUsername = `@${chUsername}`;
          const res = await fetch(`${TELEGRAM_API}/getChat?chat_id=${chUsername}`);
          const d = await res.json();
          if (!d.ok) {
            await sendMessage(chatId, "⚠️ Kanal tapylmady");
            break;
          }
          const title = d.result.title;
          channels = await kv.get(["channels"]);
          let chList = channels.value || [];
          if (chList.find(c => c.username === chUsername)) {
            await sendMessage(chatId, "⚠️ Kanal goşuldy eňe");
            break;
          }
          const maxPlace = chList.length ? Math.max(...chList.map(c => c.place)) : 0;
          chList.push({ username: chUsername, title, place: maxPlace + 1 });
          await kv.set(["channels"], chList);
          await sendMessage(chatId, "✅ Kanal goşuldy");
          break;
        case "delete_channel":
          let delUsername = text.trim();
          if (!delUsername.startsWith("@")) delUsername = `@${delUsername}`;
          channels = await kv.get(["channels"]);
          let chListDel = channels.value || [];
          if (!chListDel.find(c => c.username === delUsername)) {
            await sendMessage(chatId, "⚠️ Kanal tapylmady");
            break;
          }
          chListDel = chListDel.filter(c => c.username !== delUsername);
          chListDel.sort((a, b) => a.place - b.place);
          chListDel.forEach((c, i) => (c.place = i + 1));
          await kv.set(["channels"], chListDel);
          await sendMessage(chatId, "✅ Kanal pozuldy");
          break;
        case "change_order":
          const parts = text.trim().split(/\s+(\d+)$/);
          if (parts.length < 2) {
            await sendMessage(chatId, "⚠️ Format ýalňyş");
            break;
          }
          const newPlace = parseInt(parts.pop());
          const chTitle = parts.join(" ").trim();
          channels = await kv.get(["channels"]);
          let chListOrder = channels.value || [];
          const chToChange = chListOrder.find(c => c.title === chTitle);
          if (!chToChange) {
            await sendMessage(chatId, "⚠️ Kanal tapylmady");
            break;
          }
          chToChange.place = newPlace;
          await kv.set(["channels"], chListOrder);
          await sendMessage(chatId, "✅ Tertip üýtgedildi");
          break;
        case "change_text":
          await kv.set(["subscribed_text"], text.trim());
          await sendMessage(chatId, "✅ Tekst üýtgedildi");
          break;
        case "global_message":
          let sentCount = 0;
          for await (const entry of kv.list({ prefix: ["users"] })) {
            await sendMessage(entry.key[1], text.trim());
            sentCount++;
          }
          await sendMessage(chatId, `✅ Habar iberildi ${sentCount} ulanyjylara`);
          break;
        case "change_post_text":
          await kv.set(["post_text"], text.trim());
          await kv.set(["state", userId], { action: "change_post_buttons" });
          await sendMessage(chatId, "Botunlary şu formatda iberiň: [ad] [baýlanşyk],[ad] [baýlanşyk]");
          return new Response("OK", { status: 200 });
        case "change_post_buttons":
          const buttonsStr = text.trim();
          const buttonPairs = buttonsStr.split(",");
          const newButtons = [];
          for (const pair of buttonPairs) {
            const match = pair.match(/\s*\[(.*?)\]\s*\[(.*?)\]/);
            if (match) newButtons.push({ text: match[1], url: match[2] });
          }
          await kv.set(["post_buttons"], newButtons);
          await sendMessage(chatId, "✅ Habar üýtgedildi");
          break;
        case "add_admin":
          let newAdmin = text.trim();
          admins = await kv.get(["admins"]);
          let adminList = admins.value || [];
          if (adminList.includes(newAdmin)) {
            await sendMessage(chatId, "⚠️ Eňe admin");
            break;
          }
          adminList.push(newAdmin);
          await kv.set(["admins"], adminList);
          await sendMessage(chatId, "✅ Admin goşuldy");
          break;
        case "delete_admin":
          let delAdmin = text.trim();
          admins = await kv.get(["admins"]);
          let adminListDel = admins.value || [];
          if (!adminListDel.includes(delAdmin)) {
            await sendMessage(chatId, "⚠️ Tapylmady");
            break;
          }
          adminListDel = adminListDel.filter(a => a !== delAdmin);
          await kv.set(["admins"], adminListDel);
          await kv.delete(["admin_chat", delAdmin]);
          await sendMessage(chatId, "✅ Admin pozuldy");
          break;
      }
      await kv.delete(["state", userId]);
    }
  }

  return new Response("OK", { status: 200 });
});