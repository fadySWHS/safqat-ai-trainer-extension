chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "summarize" || request.action === "transcribe") {
    chrome.storage.local.get(["or_key", "rep_key", "summary_level"], (data) => {
      const orKey = data.or_key;
      const repKey = data.rep_key;
      const level = data.summary_level || 5;
      
      if (!orKey && request.action === "summarize") {
        sendResponse({ error: "OpenRouter Key not found. Please set it in the popup." });
        return;
      }
      if ((!orKey || !repKey) && request.action === "transcribe") {
        sendResponse({ error: "Both OpenRouter and Replicate keys are required for voice. Set them in the popup." });
        return;
      }
      
      if (request.action === "summarize") {
        const promptTemplate = getPromptFromLevel(level);
        callOpenRouterChat(orKey, promptTemplate, request.messages)
          .then(reply => sendResponse({ summary: reply }))
          .catch(err => sendResponse({ error: err.toString() }));
      } else if (request.action === "transcribe") {
        callReplicateWhisper(repKey, orKey, request.audioDataUri)
          .then(text => sendResponse({ text: text }))
          .catch(err => sendResponse({ error: err.toString() }));
      }
    });

    return true; // Keep the message channel open for async response
  }
});

function getPromptFromLevel(level) {
  const num = parseInt(level, 10) || 5;
  if (num <= 3) {
    return "Provide an extremely fast, 1-2 sentence micro-summary in Arabic. Mention the main goal of the client and whether the AI solved it.";
  } else if (num <= 7) {
    return "Provide a standard paragraph summarizing this conversation in Arabic. Highlight the client's request, the AI's response, and any missing data.";
  } else {
    return "Provide a highly detailed, comprehensive breakdown of this conversation in Arabic. Extract all specific client requirements, analyze how accurately the AI responded, and point out any subtle mistakes or missing information. Format with bullet points for readability. Do not leave any detail out.";
  }
}

async function callOpenRouterChat(orKey, promptTemplate, messagesText) {
  const prompt = `${promptTemplate}\n\nConversation:\n${messagesText}`;
  
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${orKey}`,
      "HTTP-Referer": "https://safqat.ai", // Required for OpenRouter
      "X-Title": "Safqat AI Trainer" // Optional display title
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini", // Or whatever default model you want
      messages: [{ role: "user", content: prompt }]
    })
  });
  
  if (!response.ok) throw new Error("OpenRouter API Error: " + response.statusText);
  const data = await response.json();
  return data.choices[0].message.content;
}

async function callReplicateWhisper(repKey, orKey, dataUri) {
  // Create prediction on Replicate
  const createResp = await fetch("https://api.replicate.com/v1/models/openai/whisper/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${repKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input: {
        audio: dataUri,
        language: "ar"
      }
    })
  });
  
  if (!createResp.ok) throw new Error("Replicate API Error: " + createResp.statusText);
  let prediction = await createResp.json();
  
  // Poll until complete
  while (prediction.status !== "succeeded" && prediction.status !== "failed" && prediction.status !== "canceled") {
    await new Promise(r => setTimeout(r, 1000));
    const pollResp = await fetch(prediction.urls.get, {
      headers: { "Authorization": `Bearer ${repKey}` }
    });
    prediction = await pollResp.json();
  }
  
  if (prediction.status !== "succeeded") {
    throw new Error("Replicate transcription failed: " + prediction.status);
  }
  
  const text = prediction.output.transcription;
  
  // Refine to perfectly formatted formal Arabic
  return refineToFormalArabic(orKey, text);
}

async function refineToFormalArabic(orKey, text) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${orKey}`,
      "HTTP-Referer": "https://safqat.ai",
      "X-Title": "Safqat AI Trainer"
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini", 
      messages: [{ role: "user", content: `Rewrite the following text into perfect Formal Arabic Language (اللغة العربية الفصحى) without adding context, explanations, or quotes. Just return the fixed text exactly:\n\n${text}` }]
    })
  });
  
  const data = await response.json();
  return data.choices[0].message.content;
}
