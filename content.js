let mediaRecorder;
let audioChunks = [];
let isRecording = false;

// Configurable Selectors (Based on live Safqat DOM Analysis)
const CONFIG = {
  chatContainer: 'div[class*="overflow-y-auto"].px-4', // Main scrollable chat area
  messageBubble: 'div.group.relative', // Shared class for both AI and User bubbles
  aiIdentifierText: 'باسل (بوت)', // Distinguishes the AI bubbles
  aiCorrectionBtnText: 'تصحيح لقاعدة المعرفة',
  chatOptionsDropdown: 'button[aria-label="خيارات المحادثة"]', // Used to close chat
  closeChatText: 'إغلاق المحادثة',
  modalEditInput: 'textarea#cf-answer-with' // Exact ID of the correction textarea
};

// 1. Inject Top Toolbar into the Chat
function injectToolbar() {
  const container = document.querySelector(CONFIG.chatContainer) || document.body;
  
  // Safqat uses flex cols deeply, so prepending to the parent of the messages list is best.
  // We'll just prepend to whatever scroll container we find.
  if (!container || document.getElementById("safqat-inline-toolbar")) return;

  const toolbar = document.createElement("div");
  toolbar.id = "safqat-inline-toolbar";
  toolbar.style.cssText = "display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 12px; margin: 15px; z-index: 1000; position: sticky; top: 0; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); align-items: stretch;";
  
  toolbar.innerHTML = `
    <div style="display: flex; gap: 12px;">
      <button id="safqat-summarize-btn" onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1" style="background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%); color: white; padding: 10px 22px; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-family: inherit; font-size: 14px; box-shadow: 0 4px 15px rgba(108, 92, 231, 0.4); transition: all 0.2s;">تلخيص المحادثة</button>
      <button id="safqat-approve-btn" onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1" style="background: linear-gradient(135deg, #00b894 0%, #55efc4 100%); color: white; padding: 10px 22px; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-family: inherit; font-size: 14px; box-shadow: 0 4px 15px rgba(0, 184, 148, 0.4); transition: all 0.2s;">موافق، إغلاق</button>
    </div>
    <div id="safqat-inline-summary" style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px; font-size: 14px; color: #f8fafc; overflow-y: auto; min-height: 80px; max-height: 400px; resize: vertical; line-height: 1.6; text-shadow: 0 1px 2px rgba(0,0,0,0.8); white-space: pre-wrap; direction: rtl;">جاهز للتلخيص.. يرجى تحديد محادثة من القائمة اليسرى.</div>
  `;
  
  container.insertBefore(toolbar, container.firstChild);

  document.getElementById("safqat-summarize-btn").addEventListener("click", handleSummarize);
  document.getElementById("safqat-approve-btn").addEventListener("click", handleApproveAndNext);
}

// 2. Inject Mic Icons exactly on AI Message Bubbles
function injectMicIcons() {
  const bubbles = Array.from(document.querySelectorAll(CONFIG.messageBubble));
  
  bubbles.forEach(bubble => {
    // Check if it's an AI message AND doesn't already have mic
    // AI messages usually contain the "باسل (بوت)" text.
    if (bubble.innerText.includes(CONFIG.aiIdentifierText) && !bubble.querySelector('.safqat-inline-mic')) {
      
      const micBtn = document.createElement("button");
      micBtn.className = "safqat-inline-mic";
      micBtn.innerHTML = "🎙️";
      micBtn.title = "التصحيح الصوتي (اضغط للتحدث)";
      // Position it elegantly within the relative AI bubble
      micBtn.style.cssText = "background: linear-gradient(135deg, #f39c12 0%, #f1c40f 100%); border: 1px solid rgba(255,255,255,0.4); border-radius: 50%; width: 34px; height: 34px; cursor: pointer; position: absolute; left: -20px; bottom: 10px; font-size: 16px; display:flex; align-items:center; justify-content:center; box-shadow: 0 4px 12px rgba(243, 156, 18, 0.5); z-index: 50; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);";
      
      micBtn.onmouseenter = () => micBtn.style.transform = "scale(1.1)";
      micBtn.onmouseleave = () => micBtn.style.transform = "scale(1.0)";

      micBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation(); 
        
        // 1. Programmatically open the Safqat Edit Modal by clicking "تصحيح لقاعدة المعرفة"
        const buttons = Array.from(bubble.querySelectorAll('button'));
        const correctBtn = buttons.find(b => b.innerText.includes(CONFIG.aiCorrectionBtnText));
        if (correctBtn) correctBtn.click();
        
        // 2. Start or stop audio recording
        toggleRecording(micBtn, bubble);
      });

      bubble.appendChild(micBtn);
    }
  });
}

// Auto-run when DOM changes
const observer = new MutationObserver((mutations) => {
  injectToolbar();
  injectMicIcons();
});
observer.observe(document.body, { childList: true, subtree: true });

function extractChatMessages() {
  const bubbles = Array.from(document.querySelectorAll(CONFIG.messageBubble));
  if (bubbles.length === 0) return null;
  
  // Extract text, ignoring the 'Correct Knowledge Base' button text
  return bubbles.map(b => b.innerText.replace(CONFIG.aiCorrectionBtnText, '')).join('\\n---\\n').substring(0, 4000);
}

// Summarization
function handleSummarize() {
  const summaryBox = document.getElementById("safqat-inline-summary");
  
  const text = extractChatMessages();
  if (!text) {
    summaryBox.innerHTML = '<span style="color:#ff7675; font-weight:bold;">يرجى فتح محادثة من القائمة أولاً.</span>';
    return;
  }
  
  summaryBox.innerHTML = 'جاري طلب التلخيص من الذكاء الاصطناعي... ⏳';

  chrome.runtime.sendMessage({ action: "summarize", messages: text }, (response) => {
    if (response && response.error) {
      summaryBox.innerText = "خطأ: " + response.error;
    } else if (response) {
      summaryBox.innerText = response.summary;
    } else {
      summaryBox.innerText = "فشل الاتصال";
    }
  });
}

// Approve & Close Strategy using Safqat DOM
function handleApproveAndNext() {
  const optionsBtn = document.querySelector(CONFIG.chatOptionsDropdown);
  if (optionsBtn) {
    optionsBtn.click(); // Expand the context menu dropdown
    
    // Wait slightly for the react portal to render the dropdown items
    setTimeout(() => {
      const allButtons = Array.from(document.querySelectorAll('button, [role="menuitem"]'));
      const closeBtn = allButtons.find(b => b.textContent && b.textContent.includes(CONFIG.closeChatText));
      
      if (closeBtn) {
        closeBtn.click();
      } else {
        alert("لم يتم العثور على خيار 'إغلاق المحادثة' داخل القائمة.");
      }
    }, 250);
  } else {
    alert("لم يتم العثور على أيقونة (خيارات المحادثة) في هذه الصفحة.");
  }
}

// Audio Recording
async function toggleRecording(btnElem, parentBubble) {
  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      
      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };
      
      mediaRecorder.onstop = () => processAudio(btnElem, parentBubble);
      
      mediaRecorder.start();
      isRecording = true;
      btnElem.style.background = "linear-gradient(135deg, #ff7675 0%, #d63031 100%)";
      btnElem.style.boxShadow = "0 0 15px rgba(214, 48, 49, 0.8)";
      btnElem.innerHTML = "⏹️"; 
    } catch (err) {
      console.error(err);
      alert("يرجى إعطاء الصلاحية للميكروفون: " + err.message);
    }
  } else {
    // Stop recording
    mediaRecorder.stop();
    isRecording = false;
    btnElem.style.background = "linear-gradient(135deg, #f39c12 0%, #f1c40f 100%)";
    btnElem.style.boxShadow = "0 4px 12px rgba(243, 156, 18, 0.5)";
    btnElem.innerHTML = "⏳";
    
    mediaRecorder.stream.getTracks().forEach(track => track.stop());
  }
}

function processAudio(btnElem, parentBubble) {
  const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
  const reader = new FileReader();
  
  reader.readAsDataURL(audioBlob);
  reader.onloadend = () => {
    const base64data = reader.result;
    
    chrome.runtime.sendMessage({ action: "transcribe", audioDataUri: base64data }, (response) => {
      btnElem.innerHTML = "🎙️"; // Reset back to mic
      if (response && response.error) {
        alert("خطأ الخادم: " + response.error);
      } else if (response) {
        insertTextIntoInput(response.text);
      }
    });
  };
}

function insertTextIntoInput(text) {
  // Wait a fraction to ensure the Safqat Modal with ID cf-answer-with is open
  setTimeout(() => {
    const activeTextArea = document.querySelector(CONFIG.modalEditInput);
    
    if (activeTextArea) {
      activeTextArea.value = text;
      // Trigger Next.js/React input events to safely bind state
      activeTextArea.dispatchEvent(new Event('input', { bubbles: true }));
      // Optional: Give it a visual indication
      activeTextArea.style.background = "#e8f5e9";
      setTimeout(() => activeTextArea.style.background = "", 1000);
    } else {
      // Fallback
      navigator.clipboard.writeText(text).then(() => {
        alert("تم نسخ النص. قم بلصقه يدوياً، لم نعثر على المربع (" + CONFIG.modalEditInput + ")");
      });
    }
  }, 200);
}

// Initial Injection Attempt
setTimeout(() => {
  injectToolbar();
  injectMicIcons();
}, 2000);
