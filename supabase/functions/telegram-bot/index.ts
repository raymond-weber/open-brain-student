import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendTelegramMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function saveThought(content: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/thoughts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ content, source: "telegram" }),
  });
  return res.ok;
}

async function searchThoughts(query: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?content=ilike.*${encodeURIComponent(query)}*&limit=5&order=created_at.desc`,
    {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  return res.ok ? await res.json() : [];
}

async function getRecentThoughts() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/thoughts?limit=5&order=created_at.desc`,
    {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  return res.ok ? await res.json() : [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const message = body?.message;

    if (!message?.text || !message?.chat?.id) {
      return new Response("ok", { status: 200 });
    }

    const chatId: number = message.chat.id;
    const text: string = message.text.trim();

    if (text.startsWith("/search ") || text.startsWith("? ")) {
      const query = text.startsWith("/search ") ? text.slice(8) : text.slice(2);
      const results = await searchThoughts(query);
      if (results.length === 0) {
        await sendTelegramMessage(chatId, `No results found for "${query}".`);
      } else {
        const reply = results.map((t: any, i: number) => `${i + 1}. ${t.content}`).join("\n\n");
        await sendTelegramMessage(chatId, `Found ${results.length} result(s):\n\n${reply}`);
      }
    } else if (text.startsWith("/recent")) {
      const results = await getRecentThoughts();
      if (results.length === 0) {
        await sendTelegramMessage(chatId, "No thoughts saved yet.");
      } else {
        const reply = results.map((t: any, i: number) => `${i + 1}. ${t.content}`).join("\n\n");
        await sendTelegramMessage(chatId, `Your last ${results.length} thoughts:\n\n${reply}`);
      }
    } else {
      const saved = await saveThought(text);
      if (saved) {
        await sendTelegramMessage(chatId, "✅ Saved to your brain.");
      } else {
        await sendTelegramMessage(chatId, "❌ Something went wrong saving that. Try again.");
      }
    }
  } catch (err) {
    console.error(err);
  }

  // Always return 200 so Telegram doesn't retry
  return new Response("ok", { status: 200, headers: corsHeaders });
});
