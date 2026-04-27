document.addEventListener("DOMContentLoaded", () => {
  const orKeyInput = document.getElementById("orKey");
  const repKeyInput = document.getElementById("repKey");
  const summaryLevelInput = document.getElementById("summaryLevel");
  const levelValueText = document.getElementById("levelValue");
  const saveBtn = document.getElementById("saveBtn");
  const status = document.getElementById("status");

  // Load existing configuration
  chrome.storage.local.get(["or_key", "rep_key", "summary_level"], (data) => {
    if (data.or_key) orKeyInput.value = data.or_key;
    if (data.rep_key) repKeyInput.value = data.rep_key;
    if (data.summary_level) {
      summaryLevelInput.value = data.summary_level;
      levelValueText.textContent = data.summary_level;
    }
  });

  summaryLevelInput.addEventListener("input", () => {
    levelValueText.textContent = summaryLevelInput.value;
  });

  saveBtn.addEventListener("click", () => {
    const ork = orKeyInput.value.trim();
    const repk = repKeyInput.value.trim();
    const sumLvl = summaryLevelInput.value;
    chrome.storage.local.set({ or_key: ork, rep_key: repk, summary_level: sumLvl }, () => {
      status.textContent = "تم الحفظ بنجاح!";
      setTimeout(() => status.textContent = "", 2000);
    });
  });
});
