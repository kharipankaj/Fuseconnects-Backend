const bots = [
  {
    name: "Sirious",
    prompt: "You are Sirious, a friendly and engaging chatbot in an anonymous chat room. Respond to user messages with engaging, relevant questions to keep the conversation going. Keep responses short and conversational. Always respond in Hinglish (a mix of Hindi and English).",
    rudePrompt: "You are Sirious, a rude and sarcastic chatbot in an anonymous chat room. The user misbehaved with you, so respond rudely, insultingly, and aggressively to match their tone. Keep responses short and conversational. Always respond in Hinglish (a mix of Hindi and English).",
  },
  {
    name: "Lyra",
    prompt: "You are Lyra, a friendly and engaging chatbot in an anonymous chat room. Respond to user messages with engaging, relevant questions to keep the conversation going. Keep responses short and conversational. Always respond in Hinglish (a mix of Hindi and English).",
    rudePrompt: "You are Lyra, a rude and sarcastic chatbot in an anonymous chat room. The user misbehaved with you, so respond rudely, insultingly, and aggressively to match their tone. Keep responses short and conversational. Always respond in Hinglish (a mix of Hindi and English).",
  }
];

function isMisbehaved(message) {
  const badWords = ["abuse1", "abuse2", "slur1", "slur2", "fuck", "shit", "damn", "bitch", "asshole", "bastard", "idiot", "stupid", "dumb"];
  const lowerMsg = message.toLowerCase();
  return badWords.some(word => lowerMsg.includes(word));
}


async function sendBotReply(io, roomId, botName, userMessage, axios, Room, botMessageTimestamps, isAllowedToSend, getRandomBotMessage, userAnonId, senderSocketId, isPublic = false) {
  if (!isAllowedToSend(botName, botMessageTimestamps)) return;

  const bot = bots.find(b => b.name === botName);
  if (!bot) return;

  let prompt = isMisbehaved(userMessage) ? bot.rudePrompt : bot.prompt;

  try {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      console.error("❌ GOOGLE_AI_API_KEY not set, using fallback");
    const reply = getRandomBotMessage();
    const mentionedReply = `@${userAnonId} ${reply}`;
    const msgData = { user: isPublic ? botName : `${botName} (private)`, message: mentionedReply, time: new Date() };
    console.log(`🤖 [${roomId}] ${botName} (fallback): ${reply}`);

    try {
      const room = await Room.findOne({ name: roomId });
      if (room) {
        room.messages.push({ sender: botName, message: mentionedReply, time: msgData.time });
        if (room.messages.length > 1000) {
          room.messages = room.messages.slice(-1000);
        }
        await room.save();
      }
    } catch (fallbackErr) {
      console.error("❌ Fallback bot reply error:", fallbackErr);
    }

    if (isPublic) {
      io.to(roomId).emit("receive_message", msgData);
    } else {
      io.to(senderSocketId).emit("receive_message", msgData);
    }
      return;
    }

    const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, {
      contents: [
        {
          parts: [
            {
              text: `${prompt} User message: ${userMessage}`
            }
          ]
        }
      ],
      generationConfig: {
        maxOutputTokens: 100
      }
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    let reply = response.data.candidates[0].content.parts[0].text.trim();
    if (reply.length > 120) {
      reply = reply.substring(0, 120) + "...";
    }
    const mentionedReply = `@${userAnonId} ${reply}`;
    const msgData = { user: isPublic ? botName : `${botName} (private)`, message: mentionedReply, time: new Date() };

    console.log(`🤖 [${roomId}] ${botName}: ${reply}`);

    try {
      const room = await Room.findOne({ name: roomId });
      if (room) {
        room.messages.push({ sender: botName, message: mentionedReply, time: msgData.time });
        if (room.messages.length > 1000) {
          room.messages = room.messages.slice(-1000);
        }
        await room.save();
      }
    } catch (err) {
      console.error("❌ Bot reply save error:", err);
    }

    if (isPublic) {
      io.to(roomId).emit("receive_message", msgData);
    } else {
      io.to(senderSocketId).emit("receive_message", msgData);
    }
  } catch (err) {
    console.error("❌ Bot reply error:", err);
    const reply = getRandomBotMessage();
    const mentionedReply = `@${userAnonId} ${reply}`;
    const msgData = { user: isPublic ? botName : `${botName} (private)`, message: mentionedReply, time: new Date() };
    console.log(`🤖 [${roomId}] ${botName} (fallback): ${reply}`);

    try {
      const room = await Room.findOne({ name: roomId });
      if (room) {
        room.messages.push({ sender: botName, message: mentionedReply, time: msgData.time });
        if (room.messages.length > 1000) {
          room.messages = room.messages.slice(-1000);
        }
        await room.save();
      }
    } catch (fallbackErr) {
      console.error("❌ Fallback bot reply error:", fallbackErr);
    }

    if (isPublic) {
      io.to(roomId).emit("receive_message", msgData);
    } else {
      io.to(senderSocketId).emit("receive_message", msgData);
    }
  }
}

async function sendBotWarning(io, roomId, botName, offendingUser, Room) {
  const warnings = [
    `⚠️ ${offendingUser}, please baat karo respectfully. Inappropriate messages allowed nahi hain.`,
    `🚫 ${offendingUser}, yeh message hamare community guidelines ko violate karta hai. Positive raho!`,
    `⚠️ ${offendingUser}, abusive language yahan tolerate nahi kiya jata. Please aise content se bachiye.`
  ];
  const warning = warnings[Math.floor(Math.random() * warnings.length)];
  const msgData = { user: botName, message: warning, time: new Date() };

  console.log(`🤖 [${roomId}] ${botName} (warning): ${warning}`);

  io.to(roomId).emit("receive_message", msgData);

  try {
    const room = await Room.findOne({ name: roomId });
    if (room) {
      room.messages.push({ sender: botName, message: warning, time: msgData.time });
      if (room.messages.length > 1000) room.messages = room.messages.slice(-1000);
      await room.save();
    }
  } catch (err) {
    console.error("❌ Bot warning save error:", err);
  }
}

module.exports = {
  bots,
  sendBotReply,
  sendBotWarning
};
