// Background script

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'START_CAPTURE') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab) {
        // Try to send message first (in case script is already there)
        chrome.tabs.sendMessage(activeTab.id, { action: 'ACTIVATE_SELECTION' }, (response) => {
          if (chrome.runtime.lastError) {

            // Injection needed
            chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              files: ['content.js']
            }, () => {
              if (chrome.runtime.lastError) {
                console.error('[Background] Script injection error:', chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                return;
              }
              chrome.scripting.insertCSS({
                target: { tabId: activeTab.id },
                files: ['content.style.css']
              });
              chrome.tabs.sendMessage(activeTab.id, { action: 'ACTIVATE_SELECTION' });
              sendResponse({ success: true });
            });
          } else {
            sendResponse({ success: true });
          }
        });
      } else {
        console.error('[Background] No active tab found.');
        sendResponse({ success: false, error: "No active tab" });
      }
    });
    return true; // async response
  } else if (request.action === 'CAPTURE_AREA') {
    // Capture the visible tab
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error('[Background] Capture error:', chrome.runtime.lastError);
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ dataUrl: dataUrl });
      }
    });
    return true; // Keep message channel open for async response
  } else if (request.action === 'ANALYZE_IMAGE') {
    analyzeImage(request.payload, sendResponse);
    return true;
  } else if (request.action === 'SET_BADGE') {
    // Draw a small red dot on the icon
    drawBadgeIcon(true);
    sendResponse({ success: true });
  } else if (request.action === 'CLEAR_BADGE') {
    // Restore original icon
    drawBadgeIcon(false);
    sendResponse({ success: true });
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'activate_capture') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab) {
        // Try sending message first, inject if needed (same as START_CAPTURE)
        chrome.tabs.sendMessage(activeTab.id, { action: 'ACTIVATE_SELECTION' }, (response) => {
          if (chrome.runtime.lastError) {
            chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              files: ['content.js']
            }, () => {
              if (chrome.runtime.lastError) {
                console.error('[Background] Injection error:', chrome.runtime.lastError);
                return;
              }
              chrome.scripting.insertCSS({
                target: { tabId: activeTab.id },
                files: ['content.style.css']
              });
              chrome.tabs.sendMessage(activeTab.id, { action: 'ACTIVATE_SELECTION' });
            });
          }
        });
      }
    });
  }
});

async function analyzeImage(payload, sendResponse) {
  const { imageBase64, model, geminiModel, apiKey, prompt } = payload;

  try {
    let resultText = "";

    if (model === 'gemini') {
      // Gemini API Implementation
      const selectedModel = geminiModel || 'gemini-3-flash-preview';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;

      // Simplify base64 - remove header if present
      const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg);base64,/, "");

      const body = {
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/png", data: cleanBase64 } }
          ]
        }]
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });


      const data = await response.json();

      if (!response.ok) {
        console.error('[Background] Gemini Error Data:', data);
        throw new Error(data.error?.message || `Gemini Error ${response.status}`);
      }

      resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response text from Gemini.";

    } else if (model === 'chatgpt') {

      //Popup error saying model is not supported
      throw new Error("Model not supported");
    }

    sendResponse({ success: true, text: resultText });

  } catch (error) {
    console.error("[Background] Analysis API Error:", error);
    sendResponse({ success: false, error: error.message });
  }
}

// Draw a small notification dot on the extension icon
async function drawBadgeIcon(showDot) {
  const size = 128;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Load the original icon
  const response = await fetch(chrome.runtime.getURL('icons/icon128.png'));
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  ctx.drawImage(bitmap, 0, 0, size, size);

  if (showDot) {
    // Draw a small red dot in the top-right corner
    const dotRadius = 18;
    const dotX = size - dotRadius - 4;
    const dotY = dotRadius + 4;

    ctx.beginPath();
    ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#FF3B30';
    ctx.fill();

    // White border for contrast
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  const imageData = ctx.getImageData(0, 0, size, size);
  chrome.action.setIcon({ imageData: imageData });
}
