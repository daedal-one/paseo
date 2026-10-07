import type { ChatConversationViewNode, ChatNodeKind, ChatNode } from "@deepseek-ai/dsh-client";
import type { DshConversation } from "./runtime";
function nodeIs<K extends ChatNodeKind>(
  node: ChatConversationViewNode,
  kind: K,
): node is ChatNode<K> {
  return node.kind === kind;
}
/** Cache only readable text; server events, attachments and mutation receipts stay with their owners. */
export function conversationPreview(view: DshConversation): string {
  const state = view.conversation.target("chat").getSnapshot();
  if (state === undefined) return "";
  const lines: string[] = [];
  for (const key of state.order) {
    const node = state.nodes.source(key).getSnapshot();
    if (node === undefined || node.visibility === "hidden") continue;
    if (nodeIs(node, "user") || nodeIs(node, "steering")) {
      for (const part of node.data.content) if (part.type === "text") lines.push(part.text);
    } else if (nodeIs(node, "assistant-step")) {
      for (const block of node.data.blocks) if (block.kind === "text") lines.push(block.text);
    }
  }
  return lines.join("\n\n").slice(-128_000);
}
