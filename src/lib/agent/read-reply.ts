import { parseJsonEventStream, uiMessageChunkSchema } from "ai";

export async function readAgentReply(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  onStatus: (label: string) => void,
) {
  const reader = parseJsonEventStream({ stream: body, schema: uiMessageChunkSchema }).getReader();
  let text = "";
  let complete = false;

  try {
    for (;;) {
      const { done, value: event } = await reader.read();
      if (done) break;
      if (complete) continue;
      if (!event.success) throw event.error;

      const chunk = event.value;
      switch (chunk.type) {
        case "text-delta":
          text += chunk.delta;
          onText(text);
          break;
        case "text-end":
          // The chat route sends text-end only after the answer is complete.
          complete = text.trim().length > 0;
          break;
        case "data-status": {
          const data = chunk.data;
          if (data && typeof data === "object" && "label" in data && typeof data.label === "string") {
            onStatus(data.label);
          }
          break;
        }
        case "abort":
        case "error":
          throw new Error("Agent reply did not complete");
      }
    }
  } catch (error) {
    // The server may still be saving history after sending the completed answer.
    if (!complete) throw error;
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  if (!complete) throw new Error("Agent reply ended before completion");
}
