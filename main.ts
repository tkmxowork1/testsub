// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const kv = await Deno.openKv();

const TOKEN = Deno.env.get("BOT_TOKEN");
const SECRET_PATH = "/testsub"; // change this
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const DEFAULT_SUBSCRIBED_TEXT = "Hemenkanallara abuna boldyň! VPN-iňizden lezzetli peýdalanmak 🎉";
const MASAKOFF = "@Masakoff";
const MUGT_VPNS_TEXT = "MugtVpns 🆓";
const MUGT_VPNS_URL = "https://t.me/addlist/5wQ1fNW2xIdjZmIy";

// Initialize defaults if not set
if (!await kv.get(["admins"])) {
  await kv.set(["admins"], [MASAKOFF]);
}
if (!await kv.get(["channels"])) {
  await kv.set(["channels"], []);
}
if (!await kv.get(["admin_channels"])) {
  await kv.set(["admin_channels"], []);
}
if (!await kv.get(["subscribed_text"])) {
  await kv.set(["subscribed_text"], DEFAULT_SUBSCRIBED_TEXT);
}

async function getCount(prefix: string[]) {
  let count = 0;
  for await (const _ of kv.list({ prefix })) count++;
  return count;
}

async function getCount24(prefix: string[], field: string) {
  let count = 0;
  const now = Date.now();
  const threshold = now - 24 * 60 * 60 * 1000;
  for await (const entry of kv.list({ prefix })) {
    if (entry.value[field] > threshold) count++;
  }
  return count;
}

async function isSubscribed(userId: number, channels: { username: string; title: string }[]) {
  for (const chan of channels) {
    try {
      const res = await fetch(`${TELEGRAM_API}/getChatMember?chat_id=${chan.username}&user_id=${userId}`);
      const data = await res.json();
      if (!data.ok) return false;
      const status = data.result.status;
      if (status === "left" || status === "kicked") return false;
    } catch (e) {
      console.error(e);
      return false;
    }
  }
  return true;
}

async function getUnsubscribed(userId: number, channels: { username: string; title: string }[]) {
  const unsub: { username: string; title: string }[] = [];
  for (const chan of channels) {
    try {
      const res = await fetch(`${TELEGRAM_API}/getChatMember?chat_id=${chan.username}&user_id=${userId}`);
      const data = await res.json();
      if (!data.ok || data.result.status === "left" || data.result.status === "kicked") {
        unsub.push(chan);
      }
    } catch (e) {
      console.error(e);
      unsub.push(chan);
    }
  }
  return unsub;
}

function buildKeyboard(chans: { username: string; title: string }[], includeCheck = true) {
  const keyboard: any[][] = [];
  for (let i = 0; i < chans.length; i += 2) {
    const row = [];
    row.push({ text: chans[i].title, url: `https://t.me/${chans[i].username.slice(1)}` });
    if (i + 1 < chans.length) {
      row.push({ text: chans[i + 1].title, url: `https://t.me/${chans[i + 1].username.slice(1)}` });
    }
    keyboard.push(row);
  }
  keyboard.push([{ text: MUGT_VPNS_TEXT, url: MUGT_VPNS_URL }]);
  if (includeCheck) {
    keyboard.push([{ text: "Abuna barlaň ✅", callback_data: "check_sub" }]);
  }
  return { inline_keyboard: keyboard };
}

async function getState(chatId: number) {
  return (await kv.get(["states", chatId]))?.value || null;
}

async function setState(chatId: number, state: string, data: any = null) {
  await kv.set(["states", chatId], { state, data });
}

async function clearState(chatId: number) {
  await kv.delete(["states", chatId]);
}

async function sendMessage(chatId: number, text: string, options: any = {}) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...options,
    }),
  });
}

function adminKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Kanal goşuň ➕", callback_data: "add_channel" },
        { text: "Kanal pozuň ❌", callback_data: "delete_channel" },
      ],
      [
        { text: "Kanallaryň ýerini üýtgetiň 🔄", callback_data: "change_place" },
        { text: "Teksti üýtgetiň ✏️", callback_data: "change_text" },
      ],
      [
        { text: "Global habar 📢", callback_data: "global_message" },
        { text: "Posty üýtgetiň 📝", callback_data: "change_post" },
      ],
      [
        { text: "Post iberiň 📤", callback_data: "send_post" },
        { text: "Admin goşuň 👤➕", callback_data: "add_admin" },
      ],
      [
        { text: "Admin pozuň 👤❌", callback_data: "delete_admin" },
      ],
    ],
  };
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

  // Handle my_chat_member for promotions/demotions
  const myChatMember = update.my_chat_member;
  if (myChatMember) {
    const chat = myChatMember.chat;
    if (chat.type === "channel") {
      const oldStatus = myChatMember.old_chat_member.status;
      const newStatus = myChatMember.new_chat_member.status;
      const username = chat.username ? `@${chat.username}` : null;
      if (!username) return new Response("OK", { status: 200 });
      let message;
      let adminChannels = (await kv.get(["admin_channels"]))?.value || [];
      if (newStatus === "administrator" && oldStatus !== "administrator") {
        if (!adminChannels.includes(username)) {
          adminChannels.push(username);
          await kv.set(["admin_channels"], adminChannels);
        }
        message = `Bot indi ${username} kanalynyň admini 📢`;
      } else if (oldStatus === "administrator" && newStatus !== "administrator") {
        adminChannels = adminChannels.filter((c: string) => c !== username);
        await kv.set(["admin_channels"], adminChannels);
        message = `Bot ${username} kanalynyň admininden pozuldy 📢`;
      }
      if (message) {
        for await (const entry of kv.list({ prefix: ["admin_chats"] })) {
          const adminChatId = entry.value;
          await sendMessage(adminChatId, message);
        }
      }
    }
    return new Response("OK", { status: 200 });
  }

  const message = update.message;
  const callbackQuery = update.callback_query;
  const chatId = message?.chat?.id || callbackQuery?.message?.chat?.id;
  const text = message?.text;
  const data = callbackQuery?.data;
  const messageId = callbackQuery?.message?.message_id;
  const from = message?.from || callbackQuery?.from;
  const username = from?.username ? `@${from.username}` : null;

  if (!chatId) return new Response("No chat ID", { status: 200 });

  // Update user activity if private chat
  if (chatId > 0) {
    const now = Date.now();
    let user = (await kv.get(["users", chatId]))?.value || { reg: now, active: now };
    if (!user.reg) user.reg = now;
    user.active = now;
    await kv.set(["users", chatId], user);
  }

  // Handle states for admin inputs
  if (message && text && chatId > 0) {
    const stateObj = await getState(chatId);
    if (stateObj) {
      const state = stateObj.state;
      const stateData = stateObj.data;
      try {
        if (state === "add_channel") {
          if (!text.startsWith("@")) throw new Error("Invalid username");
          const res = await fetch(`${TELEGRAM_API}/getChat?chat_id=${text}`);
          const chatData = await res.json();
          if (!chatData.ok) throw new Error("Channel not found");
          const title = chatData.result.title;
          let channels = (await kv.get(["channels"]))?.value || [];
          if (channels.find((c: any) => c.username === text)) throw new Error("Already added");
          channels.push({ username: text, title });
          await kv.set(["channels"], channels);
          await sendMessage(chatId, "Kanal üstünlikli goşuldy ✅");
        } else if (state === "delete_channel") {
          if (!text.startsWith("@")) throw new Error("Invalid username");
          let channels = (await kv.get(["channels"]))?.value || [];
          const newChannels = channels.filter((c: any) => c.username !== text);
          if (newChannels.length === channels.length) throw new Error("Not in list");
          await kv.set(["channels"], newChannels);
          await sendMessage(chatId, "Kanal pozuldy ❌");
        } else if (state === "change_place") {
          const parts = text.trim().split(/\s+/);
          if (parts.length < 2) throw new Error("Invalid format");
          const uname = parts[0];
          const pos = parseInt(parts[1]);
          let channels = (await kv.get(["channels"]))?.value || [];
          const index = channels.findIndex((c: any) => c.username === uname);
          if (index === -1 || isNaN(pos) || pos < 1 || pos > channels.length) throw new Error("Invalid");
          const item = channels[index];
          channels.splice(index, 1);
          channels.splice(pos - 1, 0, item);
          await kv.set(["channels"], channels);
          await sendMessage(chatId, "Ýer üýtgedildi 🔄");
        } else if (state === "change_text") {
          await kv.set(["subscribed_text"], text);
          await sendMessage(chatId, "Tekst üýtgedildi ✏️");
        } else if (state === "global_message") {
          for await (const entry of kv.list({ prefix: ["users"] })) {
            const uchat = entry.key[1];
            await sendMessage(uchat, text);
          }
          await sendMessage(chatId, "Habar hemmelere iberildi 📤");
        } else if (state === "change_post_text") {
          await setState(chatId, "change_post_buttons", text);
          await sendMessage(chatId, "Düwmeleri [ad] [baýlanşygy],[ad] [baýlanşygy] formatda iberiň 📩");
          return new Response("OK", { status: 200 });
        } else if (state === "change_post_buttons") {
          const buttonStrs = text.split(",");
          const buttons: any[] = [];
          for (const str of buttonStrs) {
            const match = str.trim().match(/\[(.*?)\]\s*(.+)/);
            if (!match) throw new Error("Invalid format");
            buttons.push({ text: match[1], url: match[2] });
          }
          const inline: any[][] = [];
          for (let i = 0; i < buttons.length; i += 2) {
            const row = [buttons[i]];
            if (i + 1 < buttons.length) row.push(buttons[i + 1]);
            inline.push(row);
          }
          await kv.set(["post"], { text: stateData, inline_keyboard: inline });
          await sendMessage(chatId, "Post üýtgedildi 📝");
        } else if (state === "add_admin") {
          if (!text.startsWith("@")) throw new Error("Invalid username");
          let admins = (await kv.get(["admins"]))?.value || [];
          if (admins.includes(text)) throw new Error("Already admin");
          admins.push(text);
          await kv.set(["admins"], admins);
          await sendMessage(chatId, "Admin goşuldy 👤➕");
        } else if (state === "delete_admin") {
          if (!text.startsWith("@")) throw new Error("Invalid username");
          let admins = (await kv.get(["admins"]))?.value || [];
          const newAdmins = admins.filter((a: string) => a !== text);
          if (newAdmins.length === admins.length) throw new Error("Not admin");
          await kv.set(["admins"], newAdmins);
          await sendMessage(chatId, "Admin pozuldy 👤❌");
        }
      } catch (e) {
        await sendMessage(chatId, (e.message === "Channel not found" ? "Kanal tapylmady ýa-da ýalňyşlyk ❌" : 
          e.message === "Already added" ? "Kanal sanawda bar ❌" : 
          e.message === "Not in list" ? "Kanal sanawda ýok ❌" : 
          e.message === "Invalid" ? "Nädögry format ýa-da kanal tapylmady ❌" : 
          e.message === "Already admin" ? "Admin bar ❌" : 
          e.message === "Not admin" ? "Admin däl ❌" : 
          e.message === "Invalid format" ? "Nädögry düwme formaty ❌" : "Ýalňyşlyk ❌"));
        return new Response("OK", { status: 200 });
      }
      await clearState(chatId);
      return new Response("OK", { status: 200 });
    }
  }

  // Handle commands
  if (text?.startsWith("/start")) {
    const channels = (await kv.get(["channels"]))?.value || [];
    const subscribed = await isSubscribed(chatId, channels);
    if (subscribed) {
      const subText = (await kv.get(["subscribed_text"]))?.value || DEFAULT_SUBSCRIBED_TEXT;
      await sendMessage(chatId, subText);
    } else {
      await sendMessage(chatId, "Bu kanallara abuna boluň, VPN giriþi almak üçin ⚠️", { reply_markup: buildKeyboard(channels) });
    }
  } else if (text?.startsWith("/admin")) {
    const admins = (await kv.get(["admins"]))?.value || [];
    if (!username || !admins.includes(username)) {
      await sendMessage(chatId, "Sen admin däl 🚫");
      return new Response("OK", { status: 200 });
    }
    await kv.set(["admin_chats", username], chatId);
    const total = await getCount(["users"]);
    const reg24 = await getCount24(["users"], "reg");
    const active24 = await getCount24(["users"], "active");
    const chanCount = (await kv.get(["channels"]))?.value.length || 0;
    const adminCount = admins.length;
    const statsText = `Bot statistikasy 📊\n1. Umumy hasaba alynan ulanyjylar: ${total}\n2. Soňky 24 sany içinde hasaba alyndy: ${reg24}\n3. Soňky 24 sany içinde boty açan ulanyjylar: ${active24}\n4. Kanallaryň sany: ${chanCount}\n5. Adminleriň sany: ${adminCount}`;
    await sendMessage(chatId, statsText);
    await sendMessage(chatId, "Admin paneli ⚙️", { reply_markup: adminKeyboard() });
  }

  // Handle callback queries
  if (callbackQuery && data && messageId) {
    if (data === "check_sub") {
      const channels = (await kv.get(["channels"]))?.value || [];
      const unsub = await getUnsubscribed(chatId, channels);
      const subscribed = unsub.length === 0;
      const textToSend = subscribed
        ? (await kv.get(["subscribed_text"]))?.value || DEFAULT_SUBSCRIBED_TEXT
        : "Hemenkanallara abuna bolmadyň. Haýsy kanallara abuna bolmaly ⚠️";
      await fetch(`${TELEGRAM_API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: textToSend,
          reply_markup: subscribed ? undefined : buildKeyboard(unsub),
        }),
      });
    } else {
      // Admin callbacks
      const admins = (await kv.get(["admins"]))?.value || [];
      if (!username || !admins.includes(username)) {
        await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: callbackQuery.id,
            text: "Sen admin däl 🚫",
            show_alert: true,
          }),
        });
        return new Response("OK", { status: 200 });
      }
      await kv.set(["admin_chats", username], chatId);
      if (data === "add_channel") {
        await setState(chatId, "add_channel");
        await sendMessage(chatId, "Kanalyň ulanyjynyň adyny iberiň 📩");
      } else if (data === "delete_channel") {
        await setState(chatId, "delete_channel");
        await sendMessage(chatId, "Pozmak üçin ulanyjynyň adyny iberiň 📩");
      } else if (data === "change_place") {
        const channels = (await kv.get(["channels"]))?.value || [];
        const list = channels.map((c: any, i: number) => `${i + 1}. ${c.title} (${c.username})`).join("\n");
        await sendMessage(chatId, `Häzirki kanallar:\n${list || "Ýok"}\n\nÝeri üýtgetmek üçin, [kanal ulanyjynyň ady] [jaý] iberiň 📩`);
        await setState(chatId, "change_place");
      } else if (data === "change_text") {
        await setState(chatId, "change_text");
        await sendMessage(chatId, "Hasaba alynan ulanyjylar üçin täze tekst iberiň 📝");
      } else if (data === "global_message") {
        await setState(chatId, "global_message");
        await sendMessage(chatId, "Hemmeler üçin habar iberiň 📩");
      } else if (data === "change_post") {
        await setState(chatId, "change_post_text");
        await sendMessage(chatId, "Postyň tekstini iberiň 📝");
      } else if (data === "send_post") {
        const post = (await kv.get(["post"]))?.value;
        if (!post) {
          await sendMessage(chatId, "Post goýulmady ❌");
        } else {
          const adminChans = (await kv.get(["admin_channels"]))?.value || [];
          for (const chan of adminChans) {
            await sendMessage(chan, post.text, { reply_markup: { inline_keyboard: post.inline_keyboard } });
          }
          await sendMessage(chatId, "Post kanallara iberildi 📤");
        }
      } else if (data === "add_admin" || data === "delete_admin") {
        if (username !== MASAKOFF) {
          await sendMessage(chatId, data === "add_admin" ? "Diňe @Masakoff adminleri goşup bilýär ❌" : "Diňe @Masakoff adminleri pozup bilýär ❌");
        } else {
          await setState(chatId, data === "add_admin" ? "add_admin" : "delete_admin");
          await sendMessage(chatId, (data === "add_admin" ? "Admin hökmünde goşmak üçin" : "Admin pozmak üçin") + " ulanyjynyň adyny iberiň 📩");
        }
      }
    }

    // Answer callback query
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQuery.id,
      }),
    });
  }

  return new Response("OK", { status: 200 });
});