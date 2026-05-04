document.addEventListener("DOMContentLoaded", () => {
  const orKeyInput = document.getElementById("orKey");
  const oaKeyInput = document.getElementById("oaKey");
  const repKeyInput = document.getElementById("repKey");
  const summaryLevelInput = document.getElementById("summaryLevel");
  const levelValueText = document.getElementById("levelValue");
  const saveButton = document.getElementById("saveBtn");
  const status = document.getElementById("status");

  const extensionEnabled = document.getElementById("extensionEnabled");
  const showSummarize = document.getElementById("showSummarize");
  const showImprovement = document.getElementById("showImprovement");
  const showProblem = document.getElementById("showProblem");
  const showSupport = document.getElementById("showSupport");
  const showApprove = document.getElementById("showApprove");
  const showDetect = document.getElementById("showDetect");
  const showMic = document.getElementById("showMic");

  const buttonCheckboxes = [showSummarize, showImprovement, showProblem, showSupport, showApprove, showDetect, showMic];

  const settingsKeys = [
    "or_key", "oa_key", "rep_key", "summary_level", "extension_enabled",
    "show_summarize", "show_improvement", "show_problem",
    "show_support", "show_approve", "show_detect", "show_mic"
  ];

  chrome.storage.local.get(settingsKeys, data => {
    if (data.or_key) orKeyInput.value = data.or_key;
    if (data.oa_key) oaKeyInput.value = data.oa_key;
    if (data.rep_key) repKeyInput.value = data.rep_key;
    if (data.summary_level) {
      summaryLevelInput.value = data.summary_level;
      levelValueText.textContent = data.summary_level;
    }
    
    extensionEnabled.checked = data.extension_enabled !== false;
    toggleCheckboxes(extensionEnabled.checked);
    
    // Default to true if not set
    showSummarize.checked = data.show_summarize !== false;
    showImprovement.checked = data.show_improvement !== false;
    showProblem.checked = data.show_problem !== false;
    showSupport.checked = data.show_support !== false;
    showApprove.checked = data.show_approve !== false;
    showDetect.checked = data.show_detect !== false;
    showMic.checked = data.show_mic !== false;
  });

  function toggleCheckboxes(enabled) {
    buttonCheckboxes.forEach(cb => {
      cb.disabled = !enabled;
      cb.parentElement.style.opacity = enabled ? "1" : "0.5";
    });
  }

  extensionEnabled.addEventListener("change", () => {
    toggleCheckboxes(extensionEnabled.checked);
  });

  summaryLevelInput.addEventListener("input", () => {
    levelValueText.textContent = summaryLevelInput.value;
  });

  saveButton.addEventListener("click", () => {
    chrome.storage.local.set({
      or_key: orKeyInput.value.trim(),
      oa_key: oaKeyInput.value.trim(),
      rep_key: repKeyInput.value.trim(),
      summary_level: summaryLevelInput.value,
      extension_enabled: extensionEnabled.checked,
      show_summarize: showSummarize.checked,
      show_improvement: showImprovement.checked,
      show_problem: showProblem.checked,
      show_support: showSupport.checked,
      show_approve: showApprove.checked,
      show_detect: showDetect.checked,
      show_mic: showMic.checked
    }, () => {
      status.textContent = "تم الحفظ بنجاح.";
      setTimeout(() => {
        status.textContent = "";
      }, 2000);
    });
  });
});
