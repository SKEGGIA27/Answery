// Popup Script

// Clear badge when popup opens (response has been "read")
chrome.runtime.sendMessage({ action: 'CLEAR_BADGE' });

document.addEventListener('DOMContentLoaded', () => {
  const modelSelect = document.getElementById('modelSelect');
  const geminiModelSelect = document.getElementById('geminiModelSelect');
  const geminiModelGroup = document.getElementById('geminiModelGroup');
  const apiKeyInput = document.getElementById('apiKey');
  const presetMessageInput = document.getElementById('presetMessage');
  const durationInput = document.getElementById('duration');
  const quickButtonCheckbox = document.getElementById('quickButton');
  const captureBtn = document.getElementById('captureBtn');
  const statusMsg = document.getElementById('status');
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsContent = document.getElementById('settingsContent');

  const hidePopupCheckbox = document.getElementById('hidePopup');
  const transparencyInput = document.getElementById('stealthTransparency');
  const transparencyControl = document.getElementById('transparencyControl');
  const guiResponseContainer = document.getElementById('guiResponseContainer');
  const guiResponseText = document.getElementById('guiResponseText');
  const copyResponseBtn = document.getElementById('copyResponseBtn');

  // Input elements array for easy binding
  const inputs = [
    modelSelect,
    geminiModelSelect,
    apiKeyInput,
    presetMessageInput,
    durationInput,
    quickButtonCheckbox,
    document.getElementById('stealthMode'),
    hidePopupCheckbox,
    transparencyInput
  ];

  const stealthModeCheckbox = document.getElementById('stealthMode');

  // Helper to toggle visibility
  function updateVisibility() {
    // Model visibility
    if (modelSelect.value === 'gemini') {
      if (geminiModelGroup) geminiModelGroup.style.display = 'block';
    } else {
      if (geminiModelGroup) geminiModelGroup.style.display = 'none';
    }

    // Transparency Slider visibility
    if (stealthModeCheckbox.checked) {
      if (transparencyControl) transparencyControl.style.display = 'block';
    } else {
      if (transparencyControl) transparencyControl.style.display = 'none';
    }
  }

  modelSelect.addEventListener('change', updateVisibility);
  stealthModeCheckbox.addEventListener('change', () => {
    if (stealthModeCheckbox.checked && quickButtonCheckbox.checked) {
      quickButtonCheckbox.checked = false;
    }
    updateVisibility();
    saveSettings();
  });
  quickButtonCheckbox.addEventListener('change', () => {
    if (quickButtonCheckbox.checked && stealthModeCheckbox.checked) {
      stealthModeCheckbox.checked = false;
      updateVisibility();
    }
    saveSettings();
  });

  // Toggle Settings Section
  if (settingsToggle && settingsContent) {
    settingsToggle.addEventListener('click', () => {
      settingsContent.classList.toggle('open');
      settingsToggle.classList.toggle('active');
    });
  }

  // Load saved settings
  chrome.storage.local.get(['model', 'geminiModel', 'apiKey', 'presetMessage', 'duration', 'quickButton', 'stealthMode', 'hidePopup', 'stealthTransparency', 'latestResponse'], (result) => {
    if (result.model) modelSelect.value = result.model;

    if (result.geminiModel) {
      geminiModelSelect.value = result.geminiModel;
    } else {
      geminiModelSelect.value = 'gemini-3-flash-preview';
    }

    if (result.apiKey) apiKeyInput.value = result.apiKey;
    if (result.presetMessage) presetMessageInput.value = result.presetMessage;
    if (result.duration) durationInput.value = result.duration;
    if (result.quickButton) quickButtonCheckbox.checked = result.quickButton;
    if (result.stealthMode) stealthModeCheckbox.checked = result.stealthMode;
    if (result.hidePopup) hidePopupCheckbox.checked = result.hidePopup;
    if (result.stealthTransparency !== undefined) {
      transparencyInput.value = result.stealthTransparency;
      const percent = result.stealthTransparency;
      const textElement = document.getElementById('transparencyValue');
      if (textElement) textElement.textContent = `${percent}%`;
    }

    // Check for saved response
    if (result.latestResponse && result.hidePopup) {

      if (result.latestResponse.trim().length > 0) {
        showGuiResponse(result.latestResponse);
      }
    }

    updateVisibility();
  });

  // Transparency Input Listener
  if (transparencyInput) {
    transparencyInput.addEventListener('input', (e) => {
      const val = e.target.value;
      const textElement = document.getElementById('transparencyValue');
      if (textElement) textElement.textContent = `${val}%`;
      saveSettings();
    });
  }

  function showGuiResponse(text) {
    if (guiResponseContainer && guiResponseText) {
      guiResponseText.textContent = text;
      guiResponseContainer.style.display = 'flex';
    }
  }

  // Copy Response
  const copySvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const checkSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#4CAF50" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  if (copyResponseBtn && guiResponseText) {
    copyResponseBtn.addEventListener('click', () => {
      const text = guiResponseText.textContent;
      navigator.clipboard.writeText(text).then(() => {
        copyResponseBtn.innerHTML = checkSvg;
        setTimeout(() => {
          copyResponseBtn.innerHTML = copySvg;
        }, 1500);
      });
    });
  }

  // Clear Response
  const clearResponseBtn = document.getElementById('clearResponseBtn');
  if (clearResponseBtn) {
    clearResponseBtn.addEventListener('click', () => {
      if (guiResponseContainer) guiResponseContainer.style.display = 'none';
      if (guiResponseText) guiResponseText.textContent = '';
      chrome.storage.local.remove('latestResponse');
    });
  }

  // Auto-save function with debounce
  let debounceTimer;
  function saveSettings() {
    clearTimeout(debounceTimer);
    statusMsg.textContent = "Saving...";

    debounceTimer = setTimeout(() => {
      const settings = {
        model: modelSelect.value,
        geminiModel: geminiModelSelect.value,
        apiKey: apiKeyInput.value,
        presetMessage: presetMessageInput.value,
        duration: parseInt(durationInput.value) || 5,
        quickButton: quickButtonCheckbox.checked,
        stealthMode: stealthModeCheckbox.checked,
        hidePopup: hidePopupCheckbox.checked,
        stealthTransparency: parseInt(transparencyInput.value) || 5
      };

      chrome.storage.local.set(settings, () => {
        statusMsg.textContent = "Settings saved";
        setTimeout(() => {
          statusMsg.textContent = "";
        }, 1500);
      });
    }, 500);
  }

  // Attach auto-save listeners
  inputs.forEach(input => {
    if (input) {
      input.addEventListener('input', saveSettings);
      input.addEventListener('change', saveSettings);
    }
  });

  // Start Capture
  captureBtn.addEventListener('click', () => {

    // Disable button to prevent double clicks
    captureBtn.disabled = true;
    captureBtn.innerHTML = '<span class="icon">⏳</span> Starting...';

    // Save current settings immediately before capturing
    const settings = {
      model: modelSelect.value,
      geminiModel: geminiModelSelect.value,
      apiKey: apiKeyInput.value,
      presetMessage: presetMessageInput.value,
      duration: parseInt(durationInput.value) || 5,
      quickButton: quickButtonCheckbox.checked,
      stealthMode: stealthModeCheckbox.checked,
      hidePopup: hidePopupCheckbox.checked,
      stealthTransparency: parseInt(transparencyInput.value) || 5
    };

    chrome.storage.local.set(settings, () => {

      // Send message to background and WAIT for response
      chrome.runtime.sendMessage({ action: 'START_CAPTURE' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Popup] Message error:', chrome.runtime.lastError);
          statusMsg.textContent = "Error starting capture.";
          captureBtn.disabled = false;
          captureBtn.innerHTML = 'Capture Area';
          return;
        }

        if (response && response.success) {
          window.close();
        } else {
          console.error('[Popup] Capture failed to start:', response ? response.error : 'Unknown error');
          let errorMsg = response ? response.error : 'Unknown';

          if (errorMsg.includes("Cannot access a chrome:// URL") || errorMsg.includes("restricted URL")) {
            statusMsg.textContent = "This page can't be captured. Try on a regular website.";
          } else {
            statusMsg.textContent = "Something went wrong: " + errorMsg;
          }

          captureBtn.disabled = false;
          captureBtn.innerHTML = 'Capture Area';
        }
      });
    });
  });
});
