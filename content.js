let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let lastChatIdentitySignature = "";
let userSettings = {
  extension_enabled: true,
  show_summarize: true,
  show_improvement: true,
  show_problem: true,
  show_support: true,
  show_approve: true,
  show_detect: true,
  show_mic: true
};

// Initial load of settings
chrome.storage.local.get(Object.keys(userSettings), data => {
  Object.keys(userSettings).forEach(key => {
    if (data[key] !== undefined) {
      userSettings[key] = data[key];
    }
  });
  // Refresh UI if toolbar already injected
  const toolbar = document.getElementById(CONFIG.toolbarId);
  if (toolbar) {
    toolbar.remove();
    injectToolbar();
  }
  // Mic icons are harder to remove individually, they'll just be ignored on next injection if disabled
});

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    let changed = false;
    Object.keys(userSettings).forEach(key => {
      if (changes[key]) {
        userSettings[key] = changes[key].newValue;
        changed = true;
      }
    });

    if (changed) {
      const toolbar = document.getElementById(CONFIG.toolbarId);
      if (!userSettings.extension_enabled) {
        if (toolbar) toolbar.remove();
        document.querySelectorAll(".safqat-inline-mic").forEach(el => el.remove());
      } else {
        if (toolbar) toolbar.remove();
        injectToolbar();
        // For mic icons, if they were removed we might want to re-inject or vice versa
        if (changes.show_mic || changes.extension_enabled) {
          if (!userSettings.show_mic) {
            document.querySelectorAll(".safqat-inline-mic").forEach(el => el.remove());
          } else {
            injectMicIcons();
          }
        }
      }
    }
  }
});

const CONFIG = {
  toolbarId: "safqat-inline-toolbar",
  summaryBoxId: "safqat-inline-summary",
  customerNameId: "safqat-customer-name",
  customerPhoneId: "safqat-customer-phone",
  customerEmailId: "safqat-customer-email",
  chatContainer: 'div[class*="overflow-y-auto"].px-4',
  messageBubble: "div.group.relative",
  aiIdentifierText: "باسل (بوت)",
  aiCorrectionBtnText: "تصحيح لقاعدة المعرفة",
  chatOptionsDropdown: 'button[aria-label="خيارات المحادثة"]',
  closeChatText: "إغلاق المحادثة",
  modalEditInput: "textarea#cf-answer-with"
};

const INTERNAL_EMAIL_DOMAINS = ["mudrek.com", "safqat.ai"];
const BLOCKED_NAME_PHRASES = [
  "باسل",
  "بوت",
  "بحث عن جهات اتصال",
  "search contacts",
  "خيارات المحادثة",
  "إغلاق المحادثة",
  "تصحيح لقاعدة المعرفة",
  "تلخيص المحادثة",
  "تحويل للدعم",
  "support ticket ready"
];

function injectToolbar() {
  if (!userSettings.extension_enabled) return;
  const container = document.querySelector(CONFIG.chatContainer) || document.body;
  if (!container || document.getElementById(CONFIG.toolbarId)) return;

  const toolbar = document.createElement("div");
  toolbar.id = CONFIG.toolbarId;
  toolbar.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "gap:12px",
    "padding:12px 16px",
    "background:rgba(15, 23, 42, 0.85)",
    "backdrop-filter:blur(16px)",
    "-webkit-backdrop-filter:blur(16px)",
    "border:1px solid rgba(255, 255, 255, 0.15)",
    "border-radius:12px",
    "margin:15px",
    "z-index:1000",
    "position:sticky",
    "top:0",
    "box-shadow:0 10px 30px rgba(0, 0, 0, 0.5)",
    "align-items:stretch"
  ].join(";");

  toolbar.innerHTML = `
    <div style="display:flex; gap:12px; flex-wrap:wrap;">
      ${userSettings.show_summarize ? `
      <button id="safqat-summarize-btn" style="${buttonStyle("linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%)", "rgba(108, 92, 231, 0.4)")}">
        تلخيص المحادثة
      </button>` : ""}
      ${userSettings.show_improvement ? `
      <button id="safqat-improvement-btn" style="${buttonStyle("linear-gradient(135deg, #f39c12 0%, #e67e22 100%)", "rgba(243, 156, 18, 0.4)")}">
        مقترحات تحسين المنتج
      </button>` : ""}
      ${userSettings.show_problem ? `
      <button id="safqat-problem-btn" style="${buttonStyle("linear-gradient(135deg, #ff4757 0%, #ff6b81 100%)", "rgba(255, 71, 87, 0.4)")}">
        تحديد المشكلة والتقنية
      </button>` : ""}
      ${userSettings.show_support ? `
      <button id="safqat-support-btn" style="${buttonStyle("linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)", "rgba(14, 165, 233, 0.45)")}">
        تحويل للدعم
      </button>` : ""}
      ${userSettings.show_approve ? `
      <button id="safqat-approve-btn" style="${buttonStyle("linear-gradient(135deg, #00b894 0%, #55efc4 100%)", "rgba(0, 184, 148, 0.4)")}">
        موافق، إغلاق
      </button>` : ""}
    </div>
    ${userSettings.show_detect ? `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:8px;">
      <input id="${CONFIG.customerNameId}" type="text" placeholder="اسم العميل" style="${inputStyle("rtl")}" />
      <input id="${CONFIG.customerPhoneId}" type="text" placeholder="رقم هاتف العميل / واتساب" style="${inputStyle("ltr")}" />
      <input id="${CONFIG.customerEmailId}" type="text" placeholder="البريد الإلكتروني للعميل" style="${inputStyle("ltr")}" />
    </div>
    <div style="display:flex; justify-content:flex-end;">
      <button id="safqat-detect-customer-btn" style="${secondaryButtonStyle()}">
        استيراد بيانات العميل من المحادثة الحالية
      </button>
    </div>` : ""}
    <div id="${CONFIG.summaryBoxId}" style="background:rgba(0, 0, 0, 0.25); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:12px; font-size:14px; color:#f8fafc; overflow-y:auto; min-height:80px; max-height:420px; resize:vertical; line-height:1.6; text-shadow:0 1px 2px rgba(0,0,0,0.8); white-space:pre-wrap; direction:rtl;">
      ${userSettings.show_detect 
        ? "املأ بيانات العميل يدوياً أو استوردها من المحادثة الحالية فقط، ثم أنشئ رسالة الدعم."
        : "المحادثة جاهزة للتحليل. اضغط على أي من الأزرار أعلاه."}
    </div>
  `;

  container.insertBefore(toolbar, container.firstChild);

  if (userSettings.show_summarize) document.getElementById("safqat-summarize-btn").addEventListener("click", handleSummarize);
  if (userSettings.show_improvement) document.getElementById("safqat-improvement-btn").addEventListener("click", handleImprovementSuggestions);
  if (userSettings.show_problem) document.getElementById("safqat-problem-btn").addEventListener("click", handleIdentifyProblem);
  if (userSettings.show_support) document.getElementById("safqat-support-btn").addEventListener("click", handleSupportTicket);
  if (userSettings.show_approve) document.getElementById("safqat-approve-btn").addEventListener("click", handleApproveAndNext);
  if (userSettings.show_detect) document.getElementById("safqat-detect-customer-btn").addEventListener("click", handleDetectCustomerInfo);

  syncCustomerInfoForCurrentChat({ force: true, silent: true });
}

function buttonStyle(background, shadow) {
  return [
    `background:${background}`,
    "color:white",
    "padding:10px 22px",
    "border:none",
    "border-radius:8px",
    "font-weight:bold",
    "cursor:pointer",
    "font-family:inherit",
    "font-size:14px",
    `box-shadow:0 4px 15px ${shadow}`,
    "transition:all 0.2s"
  ].join(";");
}

function secondaryButtonStyle() {
  return [
    "background:rgba(255,255,255,0.08)",
    "color:#e2e8f0",
    "padding:8px 14px",
    "border:1px solid rgba(255,255,255,0.12)",
    "border-radius:8px",
    "font-weight:600",
    "cursor:pointer",
    "font-family:inherit",
    "font-size:13px"
  ].join(";");
}

function inputStyle(direction) {
  return [
    `direction:${direction}`,
    "background:rgba(255,255,255,0.08)",
    "color:#f8fafc",
    "padding:9px 10px",
    "border:1px solid rgba(255,255,255,0.12)",
    "border-radius:8px",
    "font-size:13px",
    "outline:none",
    "width:100%",
    "box-sizing:border-box"
  ].join(";");
}

function getSummaryBox() {
  return document.getElementById(CONFIG.summaryBoxId);
}

function getCustomerInfoFields() {
  const name = document.getElementById(CONFIG.customerNameId);
  const phone = document.getElementById(CONFIG.customerPhoneId);
  const email = document.getElementById(CONFIG.customerEmailId);
  if (!name || !phone || !email) return null;
  return { name, phone, email };
}

function setCustomerInfoFields(customerInfo, options = {}) {
  const fields = getCustomerInfoFields();
  if (!fields) return;

  if (customerInfo.name && (options.force || !fields.name.value.trim())) {
    fields.name.value = customerInfo.name;
  } else if (options.clearMissing) {
    fields.name.value = "";
  }
  if (customerInfo.phone && (options.force || !fields.phone.value.trim())) {
    fields.phone.value = customerInfo.phone;
  } else if (options.clearMissing) {
    fields.phone.value = "";
  }
  if (customerInfo.email && (options.force || !fields.email.value.trim())) {
    fields.email.value = customerInfo.email;
  } else if (options.clearMissing) {
    fields.email.value = "";
  }
}

function getCustomerInfo() {
  const fields = getCustomerInfoFields();
  return {
    name: cleanText(fields?.name.value),
    phone: cleanText(fields?.phone.value),
    email: cleanText(fields?.email.value)
  };
}

function handleDetectCustomerInfo(options = {}) {
  const customerInfo = syncCustomerInfoForCurrentChat({
    force: true,
    clearMissing: true,
    silent: options.silent
  });

  if (options.silent) return;

  const summaryBox = getSummaryBox();
  if (!summaryBox) return;

  const hasAnyValue = customerInfo.name || customerInfo.phone || customerInfo.email;
  summaryBox.innerHTML = hasAnyValue
    ? '<span style="color:#c7f9cc;">تم استيراد بيانات العميل من المحادثة الحالية فقط. راجعها قبل إرسالها للدعم.</span>'
    : '<span style="color:#fbbf24;">لم أجد بيانات عميل موثوقة داخل المحادثة الحالية. اكتبها يدوياً حتى لا يتم استخدام بيانات الحساب الإداري.</span>';
}

function syncCustomerInfoForCurrentChat(options = {}) {
  const fields = getCustomerInfoFields();
  if (!fields) return { name: "", phone: "", email: "" };

  const signature = getChatIdentitySignature();
  const hasChatContext = !!signature;
  const shouldRefresh = !!options.force || (hasChatContext && signature !== lastChatIdentitySignature);

  if (!shouldRefresh) {
    return getCustomerInfo();
  }

  const customerInfo = extractCustomerInfo();
  setCustomerInfoFields(customerInfo, {
    force: true,
    clearMissing: options.clearMissing !== false
  });

  lastChatIdentitySignature = signature;
  return customerInfo;
}

function cleanBubbleText(text) {
  return String(text || "")
    .replace(CONFIG.aiCorrectionBtnText, "")
    .replace("🎙️", "")
    .replace("⏹️", "")
    .trim();
}

function extractAllChatMessages(maxLength = 4000) {
  const bubbles = Array.from(document.querySelectorAll(CONFIG.messageBubble));
  if (bubbles.length === 0) return null;

  const text = bubbles
    .map(bubble => cleanBubbleText(bubble.innerText))
    .filter(Boolean)
    .join("\n---\n");

  return text.slice(0, maxLength);
}

function extractUserMessagesText(maxLength = 6000) {
  const bubbles = Array.from(document.querySelectorAll(CONFIG.messageBubble));
  if (bubbles.length === 0) return "";

  const text = bubbles
    .filter(bubble => !normalizeSpace(bubble.innerText).includes(CONFIG.aiIdentifierText))
    .map(bubble => cleanBubbleText(bubble.innerText))
    .filter(Boolean)
    .join("\n");

  return text.slice(0, maxLength);
}

function handleSummarize() {
  const summaryBox = getSummaryBox();
  if (!summaryBox) return;

  const text = extractAllChatMessages(4000);
  if (!text) {
    summaryBox.innerHTML = '<span style="color:#ff7675; font-weight:bold;">يرجى فتح محادثة من القائمة أولاً.</span>';
    return;
  }

  summaryBox.textContent = "جاري طلب التلخيص من الذكاء الاصطناعي... ⏳";

  chrome.runtime.sendMessage({ action: "summarize", messages: text }, response => {
    if (chrome.runtime.lastError) {
      summaryBox.textContent = `خطأ: ${chrome.runtime.lastError.message}`;
      return;
    }

    if (response?.error) {
      summaryBox.textContent = `خطأ: ${response.error}`;
      return;
    }

    if (response?.summary) {
      summaryBox.textContent = response.summary;
      return;
    }

    summaryBox.textContent = "فشل الاتصال.";
  });
}

function handleImprovementSuggestions() {
  const summaryBox = getSummaryBox();
  if (!summaryBox) return;

  const text = extractAllChatMessages(8000);
  if (!text) {
    summaryBox.innerHTML = '<span style="color:#ff7675; font-weight:bold;">يرجى فتح محادثة من القائمة أولاً.</span>';
    return;
  }

  summaryBox.textContent = "جاري تحليل المحادثة واستخراج مقترحات التحسين... ⏳";

  chrome.runtime.sendMessage({ action: "improvementSuggestions", messages: text }, response => {
    if (chrome.runtime.lastError) {
      summaryBox.textContent = `خطأ: ${chrome.runtime.lastError.message}`;
      return;
    }

    if (response?.error) {
      summaryBox.textContent = `خطأ: ${response.error}`;
      return;
    }

    if (response?.suggestions) {
      summaryBox.textContent = response.suggestions;
      return;
    }

    summaryBox.textContent = "فشل الاتصال.";
  });
}

function handleIdentifyProblem() {
  const summaryBox = getSummaryBox();
  if (!summaryBox) return;

  const text = extractAllChatMessages(8000);
  if (!text) {
    summaryBox.innerHTML = '<span style="color:#ff7675; font-weight:bold;">يرجى فتح محادثة من القائمة أولاً.</span>';
    return;
  }

  summaryBox.textContent = "جاري تحديد المشكلة والتقنيات المستخدمة... ⏳";

  chrome.runtime.sendMessage({ action: "identifyProblem", messages: text }, response => {
    if (chrome.runtime.lastError) {
      summaryBox.textContent = `خطأ: ${chrome.runtime.lastError.message}`;
      return;
    }

    if (response?.error) {
      summaryBox.textContent = `خطأ: ${response.error}`;
      return;
    }

    if (response?.problem) {
      summaryBox.textContent = response.problem;
      return;
    }

    summaryBox.textContent = "فشل الاتصال.";
  });
}

function handleSupportTicket() {
  const summaryBox = getSummaryBox();
  if (!summaryBox) return;

  const text = extractAllChatMessages(12000);
  if (!text) {
    summaryBox.innerHTML = '<span style="color:#ff7675; font-weight:bold;">يرجى فتح محادثة من القائمة أولاً.</span>';
    return;
  }

  const customerInfo = getCustomerInfo();
  summaryBox.innerHTML = '<span style="color:#7dd3fc;">جاري تجهيز رسالة الدعم من المحادثة الحالية... ⏳</span>';

  chrome.runtime.sendMessage({
    action: "supportTicket",
    messages: text,
    customerInfo,
    pageUrl: window.location.href
  }, response => {
    if (chrome.runtime.lastError) {
      summaryBox.textContent = `خطأ: ${chrome.runtime.lastError.message}`;
      return;
    }

    if (response?.error) {
      summaryBox.textContent = `خطأ: ${response.error}`;
      return;
    }

    if (response?.message) {
      renderSupportMessage(summaryBox, response.message);
      return;
    }

    summaryBox.textContent = "تعذر إنشاء رسالة الدعم.";
  });
}

function renderSupportMessage(summaryBox, message) {
  summaryBox.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:10px;">
      <div style="font-weight:700; font-size:16px; color:#e0f2fe;">رسالة جاهزة للنسخ والإرسال إلى الدعم</div>
      <textarea id="safqat-support-message-output" readonly style="width:100%; min-height:260px; resize:vertical; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:12px; color:#f8fafc; line-height:1.7; font-family:inherit; box-sizing:border-box;">${escapeTextarea(message)}</textarea>
      <button id="safqat-copy-support-btn" style="${secondaryButtonStyle()}">نسخ الرسالة</button>
    </div>
  `;

  const copyButton = document.getElementById("safqat-copy-support-btn");
  const output = document.getElementById("safqat-support-message-output");
  if (!copyButton || !output) return;

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      copyButton.textContent = "تم نسخ الرسالة";
      setTimeout(() => {
        copyButton.textContent = "نسخ الرسالة";
      }, 1500);
    } catch (error) {
      alert(`تعذر نسخ الرسالة تلقائياً: ${error.message}`);
    }
  });
}

function extractCustomerInfo() {
  const headerText = extractActiveChatHeaderText();
  const userMessagesText = extractUserMessagesText(6000);
  const candidateLines = [
    ...splitTextLines(headerText),
    ...splitTextLines(userMessagesText)
  ];

  return {
    name: extractCustomerName(headerText),
    phone: extractPhoneNumber(candidateLines),
    email: extractEmailAddress(candidateLines)
  };
}

function getChatIdentitySignature() {
  const headerText = extractActiveChatHeaderText();
  const bubbles = Array.from(document.querySelectorAll(CONFIG.messageBubble))
    .map(bubble => cleanBubbleText(bubble.innerText))
    .filter(Boolean)
    .slice(0, 3);

  return [headerText, ...bubbles].join(" | ").slice(0, 500);
}

function extractActiveChatHeaderText() {
  const optionsButton = document.querySelector(CONFIG.chatOptionsDropdown);
  if (!optionsButton) return "";

  const candidates = [];
  let current = optionsButton.closest("header, section, article, div");
  let depth = 0;

  while (current && depth < 6) {
    const text = normalizeSpace(current.innerText || "");
    if (text && text.length <= 240) {
      candidates.push(text);
    }

    current = current.parentElement;
    depth += 1;
  }

  const scored = candidates
    .map(text => ({ text, score: scoreHeaderText(text) }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  return scored[0]?.text || "";
}

function splitTextLines(text) {
  return String(text || "")
    .split(/\n+/)
    .map(line => normalizeSpace(line))
    .filter(Boolean);
}

function cleanCustomerNameCandidate(text) {
  return normalizeSpace(String(text || "").replace(/^(اسم العميل|اسم|العميل|customer name|customer)\s*[:\-]\s*/i, ""));
}

function extractCustomerName(headerText) {
  const candidates = splitTextLines(headerText)
    .map(cleanCustomerNameCandidate)
    .filter(isLikelyCustomerName);

  const uniqueCandidates = [...new Set(candidates)];
  if (uniqueCandidates.length === 0) return "";

  uniqueCandidates.sort((left, right) => scoreCustomerName(right) - scoreCustomerName(left));
  return uniqueCandidates[0];
}

function extractPhoneNumber(lines) {
  for (const line of lines) {
    if (!isPhoneCandidateLine(line)) continue;

    const phone = extractPhoneFromText(line);
    if (isLikelyClientPhone(phone, line)) {
      return phone;
    }
  }

  return "";
}

function extractEmailAddress(lines) {
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;

  for (const line of lines) {
    const matches = line.match(emailRegex) || [];
    for (const match of matches) {
      if (isLikelyClientEmail(match)) {
        return match.trim();
      }
    }
  }

  return "";
}

function extractPhoneFromText(text) {
  const match = String(text || "").match(/(?:\+?\d[\d\s\-().]{7,}\d)/);
  return match ? match[0].replace(/\s+/g, " ").trim() : "";
}

function normalizeSpace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function isLikelyCustomerName(text) {
  if (!text) return false;
  if (text.length < 2 || text.length > 50) return false;
  if (/\d/.test(text)) return false;
  if (text.includes("@")) return false;
  if (text.includes("…") || text.includes("...")) return false;
  if (/[|:/\\]/.test(text)) return false;

  const lower = text.toLowerCase();
  if (BLOCKED_NAME_PHRASES.some(phrase => lower.includes(phrase.toLowerCase()))) {
    return false;
  }

  const wordCount = text.split(" ").filter(Boolean).length;
  return wordCount >= 1 && wordCount <= 5;
}

function scoreCustomerName(text) {
  let score = 0;
  const wordCount = text.split(" ").filter(Boolean).length;

  if (wordCount >= 2 && wordCount <= 4) score += 3;
  if (/[\u0600-\u06FF]/.test(text)) score += 2;
  if (text.length >= 6 && text.length <= 24) score += 2;
  return score;
}

function scoreHeaderText(text) {
  const lines = splitTextLines(text);
  let score = 0;

  for (const line of lines) {
    const cleanedLine = cleanCustomerNameCandidate(line);
    if (isLikelyCustomerName(cleanedLine)) {
      score += scoreCustomerName(cleanedLine) + 3;
    }

    if (isLikelyClientEmail(line)) {
      score += 2;
    }

    if (isPhoneCandidateLine(line) && isLikelyClientPhone(extractPhoneFromText(line), line)) {
      score += 2;
    }
  }

  if (text.includes("بحث عن جهات اتصال") || text.toLowerCase().includes("search contacts")) {
    score -= 10;
  }

  return score;
}

function isPhoneCandidateLine(line) {
  if (!line) return false;

  const extractedPhone = extractPhoneFromText(line);
  if (!extractedPhone) return false;

  const hasPhoneLabel = /(واتساب|هاتف|جوال|موبايل|phone|mobile|whatsapp|tel)/i.test(line);
  const remainingText = normalizeSpace(line.replace(extractedPhone, ""));
  return hasPhoneLabel || remainingText.length <= 16;
}

function isLikelyClientPhone(phone, sourceLine = "") {
  const digitsOnly = String(phone || "").replace(/\D/g, "");
  if (digitsOnly.length < 8 || digitsOnly.length > 15) return false;

  if (/\b(id|ticket|order|invoice|reference|otp)\b/i.test(sourceLine)) {
    return false;
  }

  return true;
}

function isLikelyClientEmail(email) {
  const normalizedEmail = cleanText(email).toLowerCase();
  if (!normalizedEmail.includes("@")) return false;

  const domain = normalizedEmail.split("@")[1] || "";
  if (!domain || INTERNAL_EMAIL_DOMAINS.includes(domain)) return false;

  return true;
}

function handleApproveAndNext() {
  const optionsButton = document.querySelector(CONFIG.chatOptionsDropdown);
  if (!optionsButton) {
    alert("لم يتم العثور على خيارات المحادثة في هذه الصفحة.");
    return;
  }

  optionsButton.click();

  setTimeout(() => {
    const allButtons = Array.from(document.querySelectorAll("button, [role='menuitem']"));
    const closeButton = allButtons.find(button => button.textContent && button.textContent.includes(CONFIG.closeChatText));

    if (closeButton) {
      closeButton.click();
      return;
    }

    alert("لم يتم العثور على خيار إغلاق المحادثة داخل القائمة.");
  }, 250);
}

function injectMicIcons() {
  if (!userSettings.extension_enabled || !userSettings.show_mic) return;
  const bubbles = Array.from(document.querySelectorAll(CONFIG.messageBubble));

  bubbles.forEach(bubble => {
    if (!bubble.innerText.includes(CONFIG.aiIdentifierText) || bubble.querySelector(".safqat-inline-mic")) {
      return;
    }

    const micButton = document.createElement("button");
    micButton.className = "safqat-inline-mic";
    micButton.innerHTML = "🎙️";
    micButton.title = "التصحيح الصوتي (اضغط للتحدث)";
    micButton.style.cssText = [
      "background:linear-gradient(135deg, #f39c12 0%, #f1c40f 100%)",
      "border:1px solid rgba(255,255,255,0.4)",
      "border-radius:50%",
      "width:34px",
      "height:34px",
      "cursor:pointer",
      "position:absolute",
      "left:-20px",
      "bottom:10px",
      "font-size:16px",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "box-shadow:0 4px 12px rgba(243, 156, 18, 0.5)",
      "z-index:50",
      "transition:all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)"
    ].join(";");

    micButton.addEventListener("mouseenter", () => {
      micButton.style.transform = "scale(1.1)";
    });

    micButton.addEventListener("mouseleave", () => {
      micButton.style.transform = "scale(1)";
    });

    micButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      const buttons = Array.from(bubble.querySelectorAll("button"));
      const correctButton = buttons.find(button => button.innerText.includes(CONFIG.aiCorrectionBtnText));
      if (correctButton) {
        correctButton.click();
      }

      toggleRecording(micButton);
    });

    bubble.appendChild(micButton);
  });
}

const observer = new MutationObserver(() => {
  injectToolbar();
  injectMicIcons();
  syncCustomerInfoForCurrentChat({ silent: true });
});

observer.observe(document.body, { childList: true, subtree: true });

async function toggleRecording(buttonElement) {
  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) audioChunks.push(event.data);
      };

      mediaRecorder.onstop = () => processAudio(buttonElement);
      mediaRecorder.start();
      isRecording = true;
      buttonElement.style.background = "linear-gradient(135deg, #ff7675 0%, #d63031 100%)";
      buttonElement.style.boxShadow = "0 0 15px rgba(214, 48, 49, 0.8)";
      buttonElement.innerHTML = "⏹️";
    } catch (error) {
      console.error(error);
      alert(`يرجى إعطاء صلاحية الميكروفون: ${error.message}`);
    }
    return;
  }

  mediaRecorder.stop();
  isRecording = false;
  buttonElement.style.background = "linear-gradient(135deg, #f39c12 0%, #f1c40f 100%)";
  buttonElement.style.boxShadow = "0 4px 12px rgba(243, 156, 18, 0.5)";
  buttonElement.innerHTML = "⏳";
  mediaRecorder.stream.getTracks().forEach(track => track.stop());
}

function processAudio(buttonElement) {
  const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
  const reader = new FileReader();

  reader.readAsDataURL(audioBlob);
  reader.onloadend = () => {
    chrome.runtime.sendMessage({ action: "transcribe", audioDataUri: reader.result }, response => {
      buttonElement.innerHTML = "🎙️";

      if (chrome.runtime.lastError) {
        alert(`خطأ الخادم: ${chrome.runtime.lastError.message}`);
        return;
      }

      if (response?.error) {
        alert(`خطأ الخادم: ${response.error}`);
        return;
      }

      if (response?.text) {
        insertTextIntoInput(response.text);
      }
    });
  };
}

function insertTextIntoInput(text) {
  setTimeout(() => {
    const activeTextArea = document.querySelector(CONFIG.modalEditInput);

    if (activeTextArea) {
      activeTextArea.value = text;
      activeTextArea.dispatchEvent(new Event("input", { bubbles: true }));
      activeTextArea.style.background = "#e8f5e9";
      setTimeout(() => {
        activeTextArea.style.background = "";
      }, 1000);
      return;
    }

    navigator.clipboard.writeText(text).then(() => {
      alert(`تم نسخ النص. قم بلصقه يدوياً، لم نعثر على حقل الإدخال (${CONFIG.modalEditInput}).`);
    });
  }, 200);
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeTextarea(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

setTimeout(() => {
  injectToolbar();
  injectMicIcons();
  syncCustomerInfoForCurrentChat({ force: true, silent: true });
}, 2000);
