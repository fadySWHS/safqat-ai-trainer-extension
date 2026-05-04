chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const supportedActions = new Set(["summarize", "transcribe", "supportTicket", "improvementSuggestions", "identifyProblem"]);
  if (!supportedActions.has(request.action)) {
    return undefined;
  }

  chrome.storage.local.get(["or_key", "oa_key", "rep_key", "summary_level"], (data) => {
    const orKey = data.or_key;
    const oaKey = data.oa_key;
    const repKey = data.rep_key;
    const level = data.summary_level || 5;

    const hasChatKey = orKey || oaKey;

    if (!hasChatKey && (request.action === "summarize" || request.action === "supportTicket" || request.action === "improvementSuggestions" || request.action === "identifyProblem")) {
      sendResponse({ error: "No API Key found. Please set either OpenRouter or OpenAI key in the popup." });
      return;
    }

    if ((!hasChatKey || !repKey) && request.action === "transcribe") {
      sendResponse({ error: "Both a Chat API key (OpenRouter/OpenAI) and Replicate key are required for voice features." });
      return;
    }

    const apiConfig = { orKey, oaKey };

    if (request.action === "summarize") {
      const promptTemplate = getPromptFromLevel(level);
      callChatApi(apiConfig, promptTemplate, request.messages)
        .then(reply => sendResponse({ summary: reply }))
        .catch(err => sendResponse({ error: err.message || err.toString() }));
      return;
    }

    if (request.action === "improvementSuggestions") {
      generateImprovementSuggestions(apiConfig, request.messages)
        .then(suggestions => sendResponse({ suggestions }))
        .catch(err => sendResponse({ error: err.message || err.toString() }));
      return;
    }

    if (request.action === "identifyProblem") {
      identifyProblemLogic(apiConfig, request.messages)
        .then(problem => sendResponse({ problem }))
        .catch(err => sendResponse({ error: err.message || err.toString() }));
      return;
    }

    if (request.action === "supportTicket") {
      createSupportTicket(apiConfig, request.messages, request.customerInfo || {}, request.pageUrl || "")
        .then(message => sendResponse({ message }))
        .catch(err => sendResponse({ error: err.message || err.toString() }));
      return;
    }

    callReplicateWhisper(repKey, apiConfig, request.audioDataUri)
      .then(text => sendResponse({ text }))
      .catch(err => sendResponse({ error: err.message || err.toString() }));
  });

  return true;
});

function getPromptFromLevel(level) {
  const num = parseInt(level, 10) || 5;
  if (num <= 3) {
    return "Provide an extremely fast, 1-2 sentence micro-summary in Arabic. Mention the main goal of the client and whether the AI solved it.";
  }
  if (num <= 7) {
    return "Provide a standard paragraph summarizing this conversation in Arabic. Highlight the client's request, the AI's response, and any missing data.";
  }
  return "Provide a highly detailed, comprehensive breakdown of this conversation in Arabic. Extract all specific client requirements, analyze how accurately the AI responded, and point out any subtle mistakes or missing information. Format with bullet points for readability. Do not leave any detail out.";
}

async function callChatApi(apiConfig, promptTemplate, messagesText, options = {}) {
  const prompt = promptTemplate ? `${promptTemplate}\n\nConversation:\n${messagesText}` : messagesText;
  const { orKey, oaKey } = apiConfig;
  
  const isOpenRouter = !!orKey;
  const apiKey = orKey || oaKey;
  const url = isOpenRouter ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`
  };

  if (isOpenRouter) {
    headers["HTTP-Referer"] = "https://safqat.ai";
    headers["X-Title"] = "Safqat AI Trainer";
  }

  const response = await fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: options.temperature ?? 0.7
    })
  });

  const data = await readChatApiResponse(response, isOpenRouter ? "OpenRouter" : "OpenAI");
  return data.choices[0].message.content;
}

async function generateImprovementSuggestions(apiConfig, messagesText) {
  const prompt = [
    "You are a Senior Product Manager at Safqat.",
    "Based on the following conversation between a client and an AI assistant, identify clear and summarized improvements that can be made to the product or service to solve the client's underlying problem.",
    "Rules:",
    "- Focus on actionable insights.",
    "- Be concise and clear.",
    "- Return the response in Arabic.",
    "- Use bullet points for readability.",
    "- Highlight the most critical improvement first.",
    "\nConversation:",
    messagesText
  ].join("\n");

  return callChatApi(apiConfig, null, prompt, { temperature: 0.7 });
}

async function identifyProblemLogic(apiConfig, messagesText) {
  const prompt = [
    "You are a Senior Technical Support Analyst.",
    "Read the following conversation and identify the main problem the client is facing.",
    "Rules:",
    "- If a specific tool, platform, or technology (e.g., WhatsApp, CRM, API, etc.) is mentioned, name it clearly.",
    "- Be direct, clear, and extremely concise.",
    "- Return the response in Arabic.",
    "- Do not add any conversational filler.",
    "\nConversation:",
    messagesText
  ].join("\n");

  return callChatApi(apiConfig, null, prompt, { temperature: 0.3 });
}

async function createSupportTicket(apiConfig, conversationText, customerInfo, pageUrl) {
  const prompt = [
    "You are a support escalation assistant for Safqat.",
    "Read the conversation and turn it into a handoff ticket for a human support agent.",
    "Return ONLY valid JSON with exactly these keys:",
    "{",
    '  "subject": "...",',
    '  "summary": "...",',
    '  "customerIssue": "...",',
    '  "requestedAction": "...",',
    '  "priority": "low|medium|high|urgent",',
    '  "internalNotes": "..."',
    "}",
    "Rules:",
    "- Write the values in Arabic.",
    "- Be specific and concise.",
    "- Do not invent customer data.",
    "- If any important data is missing, mention that in internalNotes."
  ].join("\n");

  const customerBlock = [
    `Customer name: ${valueOrMissing(customerInfo.name)}`,
    `Customer phone: ${valueOrMissing(customerInfo.phone)}`,
    `Customer email: ${valueOrMissing(customerInfo.email)}`,
    `Source URL: ${valueOrMissing(pageUrl)}`
  ].join("\n");

  const fullPrompt = `${prompt}\n\nCustomer Info:\n${customerBlock}\n\nConversation:\n${conversationText}`;

  const rawContent = await callChatApi(apiConfig, null, fullPrompt, { temperature: 0.2 });
  const parsed = parseSupportTicketResponse(rawContent);
  const ticketId = buildTicketId();
  const normalizedCustomer = {
    name: cleanText(customerInfo.name),
    phone: cleanText(customerInfo.phone),
    email: cleanText(customerInfo.email)
  };
  const createdAt = new Date().toISOString();
  const whatsappLink = buildWhatsAppLink(normalizedCustomer.phone, normalizedCustomer.name, ticketId, parsed.subject);

  return buildSupportHandoffMessage({
    ticketId,
    createdAt,
    customer: normalizedCustomer,
    ticket: parsed,
    whatsappLink,
    pageUrl
  });
}

async function readChatApiResponse(response, providerName) {
  const rawText = await response.text();
  let data;

  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(rawText || `${providerName} API Error: ${response.status}`);
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      response.statusText ||
      `${providerName} API Error: ${response.status}`;
    throw new Error(message);
  }

  if (!data?.choices?.[0]?.message?.content) {
    throw new Error(`${providerName} returned an empty response.`);
  }

  return data;
}

function valueOrMissing(value) {
  const cleaned = cleanText(value);
  return cleaned || "Not provided";
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildTicketId() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SUP-${datePart}-${randomPart}`;
}

function normalizePhoneForWhatsApp(phone) {
  return cleanText(phone).replace(/[^\d]/g, "");
}

function buildWhatsAppLink(phone, customerName, ticketId, subject) {
  const normalizedPhone = normalizePhoneForWhatsApp(phone);
  if (!normalizedPhone) return null;

  const greetingName = cleanText(customerName) || "العميل";
  const safeSubject = cleanText(subject) || "طلب الدعم";
  const message = `مرحباً ${greetingName}، معك فريق الدعم بخصوص التذكرة ${ticketId} بعنوان "${safeSubject}". راجعنا طلبك وسنتابع معك هنا.`;
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}

function buildSupportHandoffMessage({ ticketId, createdAt, customer, ticket, whatsappLink, pageUrl }) {
  const lines = [
    "رسالة جاهزة للتحويل إلى الدعم البشري",
    `رقم التذكرة: ${ticketId}`,
    `تاريخ الإنشاء: ${formatArabicDate(createdAt)}`,
    "",
    "بيانات العميل:",
    `- الاسم: ${customer.name || "غير متوفر"}`,
    `- الهاتف: ${customer.phone || "غير متوفر"}`,
    `- البريد الإلكتروني: ${customer.email || "غير متوفر"}`,
    "",
    `الموضوع: ${ticket.subject || "طلب دعم من العميل"}`,
    `الأولوية: ${translatePriority(ticket.priority)}`,
    "",
    "ملخص الحالة:",
    ticket.summary || "لا يوجد ملخص متاح.",
    "",
    "مشكلة العميل:",
    ticket.customerIssue || "لا يوجد وصف واضح للمشكلة.",
    "",
    "الإجراء المطلوب من فريق الدعم:",
    ticket.requestedAction || "مراجعة المحادثة والتواصل مع العميل.",
    "",
    "ملاحظات داخلية:",
    ticket.internalNotes || "لا توجد ملاحظات إضافية."
  ];

  if (pageUrl) {
    lines.push("", `رابط المحادثة: ${pageUrl}`);
  }

  if (whatsappLink) {
    lines.push("", `رابط واتساب لبدء التواصل مع العميل: ${whatsappLink}`);
  }

  return lines.join("\n");
}

function parseSupportTicketResponse(responseText) {
  const cleaned = cleanDocument(responseText);
  const objectText = extractBalancedObject(cleaned);
  const parsed = objectText ? tryParseJson(objectText) : null;

  if (parsed && isRecord(parsed)) {
    return {
      subject: pickText(parsed.subject) || "طلب دعم من العميل",
      summary: pickText(parsed.summary) || cleaned,
      customerIssue: pickText(parsed.customerIssue, parsed.issue) || cleaned,
      requestedAction: pickText(parsed.requestedAction, parsed.action, parsed.nextStep) || "مراجعة المحادثة والتواصل مع العميل.",
      priority: normalizePriority(pickText(parsed.priority)),
      internalNotes: pickText(parsed.internalNotes, parsed.notes)
    };
  }

  return {
    subject: "طلب دعم من العميل",
    summary: cleaned,
    customerIssue: cleaned,
    requestedAction: "مراجعة المحادثة والتواصل مع العميل.",
    priority: "medium",
    internalNotes: ""
  };
}

function cleanDocument(text) {
  return String(text || "")
    .replace(/^```(?:json|markdown)?/i, "")
    .replace(/```$/i, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .trim();
}

function extractBalancedObject(source) {
  const start = source.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;

    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }

  return null;
}

function sanitizeJsonLikeText(text) {
  return text
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ': "$1"')
    .replace(/,\s*([}\]])/g, "$1");
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(sanitizeJsonLikeText(text));
    } catch {
      return null;
    }
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizePriority(priority) {
  const value = cleanText(priority).toLowerCase();
  if (["low", "medium", "high", "urgent"].includes(value)) {
    return value;
  }
  return "medium";
}

function translatePriority(priority) {
  const value = cleanText(priority).toLowerCase();
  if (value === "low") return "منخفضة";
  if (value === "high") return "مرتفعة";
  if (value === "urgent") return "عاجلة";
  return "متوسطة";
}

function formatArabicDate(isoDate) {
  if (!isoDate) return "-";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleString("ar-EG");
}

async function callReplicateWhisper(repKey, apiConfig, dataUri) {
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

  if (!createResp.ok) {
    throw new Error(`Replicate API Error: ${createResp.statusText}`);
  }

  let prediction = await createResp.json();

  while (prediction.status !== "succeeded" && prediction.status !== "failed" && prediction.status !== "canceled") {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const pollResp = await fetch(prediction.urls.get, {
      headers: { "Authorization": `Bearer ${repKey}` }
    });
    prediction = await pollResp.json();
  }

  if (prediction.status !== "succeeded") {
    throw new Error(`Replicate transcription failed: ${prediction.status}`);
  }

  const text = prediction.output.transcription;
  return refineToFormalArabic(apiConfig, text);
}

async function refineToFormalArabic(apiConfig, text) {
  const prompt = `Rewrite the following text into perfect Formal Arabic Language (اللغة العربية الفصحى) without adding context, explanations, or quotes. Just return the fixed text exactly:\n\n${text}`;
  return callChatApi(apiConfig, null, prompt, { temperature: 0 });
}
