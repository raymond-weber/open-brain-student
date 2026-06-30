// Supabase Edge Function: open-brain-mcp
// An MCP server letting an AI assistant search, list, and add "thoughts".
// MCP talks over JSON-RPC 2.0.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOOLS = [
  {
    name: "search_thoughts",
    description: "Search saved thoughts by keyword. Returns up to 10 matching thoughts.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Keyword(s) to search for." } },
      required: ["query"],
    },
  },
  {
    name: "list_recent",
    description: "List the most recent thoughts (newest first).",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "How many to return. Defaults to 10." } },
    },
  },
  {
    name: "add_thought",
    description: "Save a new thought.",
    inputSchema: {
      type: "object",
      properties: { content: { type: "string", description: "The text to save." } },
      required: ["content"],
    },
  },
];

function rpcResult(id: unknown, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function rpcError(id: unknown, code: number, message: string) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function toolText(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function searchThoughts(query: string) {
  const { data, error } = await supabase
    .from("thoughts").select("id, content, created_at")
    .ilike("content", `%${query}%`)
    .order("created_at", { ascending: false }).limit(10);
  if (error) throw new Error(error.message);
  return data;
}
async function listRecent(limit: number) {
  const safe = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const { data, error } = await supabase
    .from("thoughts").select("id, content, created_at")
    .order("created_at", { ascending: false }).limit(safe);
  if (error) throw new Error(error.message);
  return data;
}
async function addThought(content: string) {
  const { data, error } = await supabase
    .from("thoughts").insert({ content, source: "mcp" })
    .select("id, content, created_at").single();
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const auth = req.headers.get("authorization") || "";
  const provided = auth.replace(/^Bearer\s+/i, "").trim();
  if (!MCP_ACCESS_KEY || provided !== MCP_ACCESS_KEY) {
    return rpcError(null, -32001, "Unauthorized: invalid access key");
  }

  let body: { id?: unknown; method?: string; params?: any };
  try { body = await req.json(); }
  catch { return rpcError(null, -32700, "Parse error: body is not valid JSON"); }

  const { id = null, method, params } = body;

  try {
    switch (method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "open-brain-mcp", version: "1.0.0" },
        });
      case "notifications/initialized":
      case "initialized":
        return new Response(null, { status: 202, headers: corsHeaders });
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, { tools: TOOLS });
      case "tools/call": {
        const name = params?.name;
        const args = params?.arguments ?? {};
        if (name === "search_thoughts") {
          if (!args.query) throw new Error("Missing required argument: query");
          return rpcResult(id, toolText(await searchThoughts(args.query)));
        }
        if (name === "list_recent") {
          return rpcResult(id, toolText(await listRecent(args.limit)));
        }
        if (name === "add_thought") {
          if (!args.content) throw new Error("Missing required argument: content");
          return rpcResult(id, toolText(await addThought(args.content)));
        }
        return rpcError(id, -32602, `Unknown tool: ${name}`);
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    return rpcError(id, -32603, String((err as Error)?.message || err));
  }
});