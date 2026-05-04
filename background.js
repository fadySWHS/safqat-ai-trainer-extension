chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const supportedActions = new Set(["summarize", "transcribe", "supportTicket", "improvementSuggestions", "identifyProblem"]);
  if (!supportedActions.has(request.action)) {
    return undefined;
  }

  chrome.storage.local.get(["or_key", "rep_key", "summary_level"], (data) => {
    const orKey = data.or_key;
    const repKey = data.rep_key;
    const level = data.summary_level || 5;

    if (!orKey && (request.action === "summarize" || request.action === "supportTicket" || request.action === "improvementSuggestions" || request.action === "identifyProblem")) {
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
        .catch(err => sendResponse({ error: err.message || err.toString() }));
      return;
    }

    if (request.action === "improvementSuggestions") {
      generateImprovementSuggestions(orKey, request.messages)
        .then(suggestions => sendResponse({ suggestions }))
        .catch(err => sendResponse({ error: err.message || err.toString() }));
      return;
    }

    if (request.action === "identifyProblem") {
      identifyProblemLogic(orKey, request.messages)
        .then(problem => sendResponse({ problem }))
        .catch(err => sendResponse({ error: err.message || err.toString() }));
      return;
    }

    if (request.action === "supportTicket") {
      createSupportTicket(orKey, request.messages, request.customerInfo || {}, request.pageUrl || "")
        .then(message => sendResponse({ message }))
        .catch(err => sendResponse({ error: err.message || err.toString() }));
      return;
    }

    callReplicateWhisper(repKey, orKey, request.audioDataUri)
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

async function callOpenRouterChat(orKey, promptTemplate, messagesText) {
  const prompt = `${promptTemplate}\n\nConversation:\n${messagesText}`;

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
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = await readOpenRouterResponse(response);
  return data.choices[0].message.content;
}

async function generateImprovementSuggestions(orKey, messagesText) {
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
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7
    })
  });

  const data = await readOpenRouterResponse(response);
  return data.choices[0].message.content;
}

async function identifyProblemLogic(orKey, messagesText) {
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
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3
    })
  });

  const data = await readOpenRouterResponse(response);
  return data.choices[0].message.content;
}

async function createSupportTicket(orKey, conversationText, customerInfo, pageUrl) {
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
      messages: [{
        role: "user",
        content: `${prompt}\n\nCustomer Info:\n${customerBlock}\n\nConversation:\n${conversationText}`
      }],
      temperature: 0.2
    })
  });

  const data = await readOpenRouterResponse(response);
  const rawContent = data.choices[0].message.content;
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

async function readOpenRouterResponse(response) {
  const rawText = await response.text();
  let data;

  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(rawText || `OpenRouter API Error: ${response.status}`);
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      response.statusText ||
      `OpenRouter API Error: ${response.status}`;
    throw new Error(message);
  }

  if (!data?.choices?.[0]?.message?.content) {
    throw new Error("OpenRouter returned an empty response.");
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

async function callReplicateWhisper(repKey, orKey, dataUri) {
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
      messages: [{
        role: "user",
        content: `Rewrite the following text into perfect Formal Arabic Language (اللغة العربية الفصحى) without adding context, explanations, or quotes. Just return the fixed text exactly:\n\n${text}`
      }]
    })
  });

  const data = await readOpenRouterResponse(response);
  return data.choices[0].message.content;
}
