const axios = require("axios");

/**
 * Content Moderation Utility using Gemini API
 * Checks messages for: Abuse, Harassment, Hate, Sexual content, Threats
 */

/**
 * Analyze message for inappropriate content using Gemini API
 * @param {string} message - The message to analyze
 * @returns {Promise<{isSafe: boolean, categories: object, warning?: string}>}
 */
async function analyzeMessage(message) {
  if (!message || typeof message !== "string" || !message.trim()) {
    return { isSafe: true, categories: {} };
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  
  if (!apiKey) {
    console.warn("⚠️ GOOGLE_AI_API_KEY not set, skipping moderation");
    return { isSafe: true, categories: {}, warning: "Moderation service unavailable" };
  }

  const moderationPrompt = `You are a STRICT content moderation system for an anonymous Indian college chat platform.

You must detect abusive content even if it is:

- Written in Hinglish
- Written in Hindi slang
- Written in short form or abbreviation (e.g. tmkc, mc, bc, bkl, randi, chutiya, lund, etc.)
- Masked with symbols (e.g. m*d*r, bhn***, f*ck)
- Spaced or broken intentionally (e.g. t m k c)
- Indirect but clearly abusive

Categories to detect:
1. ABUSE - insults, gaali, degrading language
2. HARASSMENT - bullying or targeted insults
3. HATE - caste, religion, gender-based hate
4. SEXUAL - sexual abusive slang, explicit references
5. THREAT - violence or harm

IMPORTANT:
- Common Indian abusive abbreviations like "tmkc", "mc", "bc" are NOT safe.
- If a word is commonly used as a gaali, mark it unsafe.
- If unsure, mark unsafe.

Respond ONLY in this JSON format:
{"isSafe": true/false, "category": "NONE" or one of: ABUSE, HARASSMENT, HATE, SEXUAL, THREAT, "reason": "short explanation"}

Message to analyze:
"${message}"`;

  try {
    // Try newer model first, fallback to stable model
    const models = [
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-pro'
    ];

    let response;
    let lastError;

    for (const model of models) {
      try {
        response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            contents: [
              {
                parts: [
                  {
                    text: moderationPrompt
                  }
                ]
              }
            ],
            generationConfig: {
              maxOutputTokens: 150,
              temperature: 0.1
            },
            safetySettings: [
              {
                category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                threshold: "BLOCK_NONE"
              },
              {
                category: "HARM_CATEGORY_HATE_SPEECH",
                threshold: "BLOCK_NONE"
              },
              {
                category: "HARM_CATEGORY_HARASSMENT",
                threshold: "BLOCK_NONE"
              },
              {
                category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                threshold: "BLOCK_NONE"
              }
            ]
          },
          {
            headers: {
              "Content-Type": "application/json"
            },
            timeout: 5000
          }
        );
        console.log(`✅ Moderation API responded with model: ${model}`);
        break;
      } catch (err) {
        lastError = err;
        console.warn(`⚠️ Model ${model} failed:`, err.response?.status, err.response?.data?.error?.message);
        continue;
      }
    }

    if (!response) {
      console.error("❌ All moderation models failed. Last error:", lastError?.response?.data || lastError?.message);
      // Return safe on error to not break chat
      return { isSafe: true, categories: {}, warning: "Moderation service unavailable" };
    }

    const replyText = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    if (!replyText) {
      console.warn("⚠️ Empty moderation response, allowing message");
      return { isSafe: true, categories: {} };
    }

    // Parse JSON from response (might be wrapped in markdown)
    const jsonMatch = replyText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("⚠️ Could not parse moderation response, allowing message");
      console.log("Raw response:", replyText.substring(0, 200));
      return { isSafe: true, categories: {} };
    }

    const result = JSON.parse(jsonMatch[0]);
    
    console.log(`🔍 [Moderation] "${message.substring(0, 30)}..." → ${result.isSafe ? "SAFE" : result.category}`);

    if (!result.isSafe) {
      return {
        isSafe: false,
        categories: {
          [result.category]: true
        },
        warning: getWarningMessage(result.category, result.reason)
      };
    }

    return { isSafe: true, categories: {} };

  } catch (err) {
    console.error("❌ Moderation error:", err.message);
    if (err.response?.data) {
      console.error("API Response:", JSON.stringify(err.response.data, null, 2));
    }
    // On error, allow message but log it
    return { isSafe: true, categories: {}, warning: "Moderation check failed" };
  }
}

/**
 * Get warning message based on category
 */
function getWarningMessage(category, reason) {
  const warnings = {
    ABUSE: "⚠️ Your message contains abusive language. Please maintain respectful communication.",
    HARASSMENT: "⚠️ Your message appears to harass others. Such behavior is not tolerated.",
    HATE: "⚠️ Your message contains hate speech. We do not tolerate discriminatory content.",
    SEXUAL: "⚠️ Your message contains inappropriate sexual content. Please keep it clean.",
    THREAT: "⚠️ Your message contains threats. Violence and threats are strictly prohibited."
  };

  return warnings[category] || "⚠️ Your message was blocked due to inappropriate content.";
}

/**
 * Quick bad word check (fallback before API call)
 */
function quickBadWordCheck(message) {
  const badWords = [
    // English profanity
    "fuck", "shit", "damn", "bitch", "asshole", "bastard", "idiot", "stupid", "dumb",
    "ass", "piss", "cunt", "dick", "cock", "crap", "hell", "bullshit",
    // Hindi abuse (common)
    "chutiya", "madarchod", "bahenchod", "behenchod", "bhadwa", "bhadwe",
    "harami", "haramzada", "kutta", "kutte", "suar", "gaand", "gand",
    "lund", "laude", "chod", "randi", "raand", "tatte", "tatti",
    // Slurs
    "nigger", "negro", "faggot", "fagot", "retard", "spic", "chink"
  ];

  const lowerMsg = message.toLowerCase();
  for (const word of badWords) {
    if (lowerMsg.includes(word)) {
      return {
        isSafe: false,
        category: "ABUSE",
        reason: `Contains inappropriate word: ${word}`
      };
    }
  }

  return { isSafe: true };
}

/**
 * Combined moderation check - quick check first, then Gemini API
 */
async function moderateMessage(message) {
  // First, quick bad word check
  const quickCheck = quickBadWordCheck(message);
  if (!quickCheck.isSafe) {
    return {
      isSafe: false,
      categories: { [quickCheck.category]: true },
      warning: getWarningMessage(quickCheck.category, quickCheck.reason)
    };
  }

  // Then, Gemini API check for nuanced content
  return await analyzeMessage(message);
}

module.exports = {
  analyzeMessage,
  moderateMessage,
  quickBadWordCheck,
  getWarningMessage
};
