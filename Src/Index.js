require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.MODEL || "deepseek/deepseek-chat-v3-0324:free";

const KEYS_RAW = process.env["KEYS"];
const KEYS = (KEYS_RAW || "").split(",").map(k => k.trim()).filter(k => k);

if (!KEYS || KEYS.length === 0) {
  console.error("❌ No OpenRouter keys found! Add them to the Secrets tab like: KEYS = sk-or-v1-xxx,...");
  process.exit(1);
}

if (KEYS.length === 0) {
  console.error("❌ No OpenRouter keys found! Add them to .env like: KEYS=key1,key2");
  process.exit(1);
}

let currentKeyIndex = 0;

function getNextKey() {
  currentKeyIndex = (currentKeyIndex + 1) % KEYS.length;
  return KEYS[currentKeyIndex];
}

app.get("/", (req, res) => {
  res.send("🔁 OpenRouter Janitor Proxy is running (with auto-key switch)");
});

app.post("/chat/completions", async (req, res) => {
  const messages = req.body.messages;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Missing or invalid 'messages' in body." });
  }

  let attempts = 0;
  const maxAttempts = KEYS.length;

  while (attempts < maxAttempts) {
    const key = KEYS[currentKeyIndex];
    try {
      console.log(`🔑 Using key ${currentKeyIndex + 1}/${KEYS.length}`);

      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: MODEL,
          messages,
          temperature: 0.9,
          stream: false,
        },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
        }
      );

      const reply = response.data.choices?.[0]?.message?.content;
      if (!reply) {
        return res.status(500).json({ error: "No reply returned from model." });
      }

      return res.json({
        id: "chatcmpl-janitor-bridge",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: MODEL,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: reply,
            },
            finish_reason: "stop",
          },
        ],
      });
    } catch (err) {
      const status = err?.response?.status;
      const isKeyError = status === 401 || status === 403 || status === 429;

      console.warn(`❌ Error with key ${currentKeyIndex + 1}:`, status, err.message);

      if (!isKeyError) {
        return res.status(500).json({ error: "Error getting reply from OpenRouter." });
      }

      attempts++;
      getNextKey();
    }
  }

  return res.status(500).json({ error: "All API keys failed or exhausted." });
});

app.listen(PORT, () => {
  console.log(`✅ Proxy running at http://localhost:${PORT}`);
});
