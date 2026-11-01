import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import { HttpError } from "../errors";

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** (system prompt, user text, tool) → the tool-call arguments Claude produced. Injectable so tests never hit the network. */
export type ToolCaller = (system: string, user: string, tool: ToolSpec) => Promise<unknown>;

export const aiConfigured = () => Boolean(env.anthropicKey);

export const callClaudeTool: ToolCaller = async (system, user, tool) => {
  if (!env.anthropicKey) {
    throw new HttpError(503, "AI is not set up yet. Add ANTHROPIC_API_KEY to the server settings — you can still create tasks manually.", "ai_not_configured");
  }
  const client = new Anthropic({ apiKey: env.anthropicKey, maxRetries: 2, timeout: 30_000 });
  try {
    const msg = await client.messages.create({
      model: env.anthropicModel,
      max_tokens: 1500,
      system,
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.input_schema as Anthropic.Tool.InputSchema }],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: user }],
    });
    const block = msg.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new HttpError(502, "The AI did not return a usable answer. Please try again.", "ai_bad_response");
    return block.input;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const status = (e as { status?: number }).status;
    if (status === 401) throw new HttpError(503, "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.", "ai_auth");
    if (status === 429) throw new HttpError(429, "The AI service is busy. Please try again in a moment.", "ai_rate_limited");
    if (status === 404) throw new HttpError(503, `The AI model "${env.anthropicModel}" was not found. Set ANTHROPIC_MODEL to a model available on your account.`, "ai_model");
    console.error("[ai] request failed:", status ?? "no-status");
    throw new HttpError(502, "The AI service could not be reached. Please try again.", "ai_unavailable");
  }
};
