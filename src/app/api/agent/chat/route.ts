import { handleAgentChat } from "@/lib/agent/route-handler";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=90;
export const POST=handleAgentChat;
