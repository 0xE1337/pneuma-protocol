/**
 * LLM 双 provider 包装：DeepSeek 主，OpenAI 备
 */

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  /** 期望返回 JSON */
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
  const maxTokens = options.maxTokens ?? 800;
  const temperature = options.temperature ?? 0.2;

  // DeepSeek 主
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const body: Record<string, unknown> = {
        model: "deepseek-chat",
        messages,
        max_tokens: maxTokens,
        temperature,
      };
      if (options.jsonMode) body.response_format = { type: "json_object" };

      const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { choices: { message: { content: string } }[] };
        return data.choices[0].message.content;
      }
      console.warn("[llm] DeepSeek returned", resp.status);
    } catch (err) {
      console.warn("[llm] DeepSeek error:", (err as Error).message);
    }
  }

  // OpenAI 备
  if (process.env.OPENAI_API_KEY) {
    const body: Record<string, unknown> = {
      model: "gpt-4o-mini",
      messages,
      max_tokens: maxTokens,
      temperature,
    };
    if (options.jsonMode) body.response_format = { type: "json_object" };

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { choices: { message: { content: string } }[] };
      return data.choices[0].message.content;
    }
    throw new Error(`OpenAI returned ${resp.status}`);
  }

  throw new Error("no LLM API key configured (DEEPSEEK_API_KEY or OPENAI_API_KEY)");
}
