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
  } else if (request.action === 'DETECT_FORM') {
    // Forward form detection to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab) {
        sendResponse({ isForm: false });
        return;
      }
      // Try sending message — inject script if needed
      chrome.tabs.sendMessage(activeTab.id, { action: 'DETECT_FORM' }, (response) => {
        if (chrome.runtime.lastError) {
          // Content script not injected yet — inject and retry
          chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ['content.js']
          }, () => {
            if (chrome.runtime.lastError) {
              sendResponse({ isForm: false });
              return;
            }
            chrome.scripting.insertCSS({
              target: { tabId: activeTab.id },
              files: ['content.style.css']
            });
            chrome.tabs.sendMessage(activeTab.id, { action: 'DETECT_FORM' }, (r) => {
              sendResponse(r || { isForm: false });
            });
          });
        } else {
          sendResponse(response || { isForm: false });
        }
      });
    });
    return true;
  } else if (request.action === 'SOLVE_FORM') {
    // Orchestrate: scrape → AI → (optionally) auto-click
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab) {
        sendResponse({ success: false, error: 'No active tab' });
        return;
      }

      // Step 1: Scrape questions from the page
      chrome.tabs.sendMessage(activeTab.id, { action: 'SCRAPE_FORM' }, (scrapeResponse) => {
        if (chrome.runtime.lastError || !scrapeResponse || !scrapeResponse.questions) {
          sendResponse({ success: false, error: 'Failed to scrape form questions' });
          return;
        }

        const questions = scrapeResponse.questions;
        if (questions.length === 0) {
          sendResponse({ success: false, error: 'No text questions found on this form' });
          return;
        }

        // Step 2: Send to AI
        analyzeFormQuestions(questions, request.autoClick, activeTab.id, sendResponse);
      });
    });
    return true;
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

async function analyzeFormQuestions(questions, autoClick, tabId, sendResponse) {
  try {
    // Get settings
    const settings = await chrome.storage.local.get(['model', 'geminiModel', 'apiKey']);
    const apiKey = settings.apiKey;

    if (!apiKey) {
      sendResponse({ success: false, error: 'No API Key configured. Open Answery settings to add one.' });
      return;
    }

    // Build text prompt from scraped questions
    let promptText = 'You are given a list of multiple-choice questions. For each question, identify the correct answer.\n\n';
    promptText += 'IMPORTANT: Respond ONLY with a valid JSON array. No explanation, no markdown, no extra text.\n';
    promptText += 'Format: [{"question": <question_index>, "answer": <option_index>}]\n';
    promptText += 'Where question_index is the question number (starting from 0) and answer is the 0-based index of the correct option.\n\n';

    questions.forEach((q, i) => {
      promptText += `Question ${i} : ${q.text}\n`;
      q.options.forEach((opt, j) => {
        promptText += `  ${j}) ${opt.text}\n`;
      });
      promptText += '\n';
    });

    promptText += '\nRespond ONLY with the JSON array. Example: [{"question":0,"answer":1},{"question":1,"answer":0}]';

    const selectedModel = settings.geminiModel || 'gemini-3-flash-preview';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;

    const body = {
      contents: [{
        parts: [{ text: promptText }]
      }]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[Background] Gemini Form Error:', data);
      throw new Error(data.error?.message || `Gemini Error ${response.status}`);
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON from response (handle possible markdown code blocks)
    let jsonStr = rawText.trim();
    // Remove markdown code block wrappers if present
    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');

    let aiAnswers;
    try {
      aiAnswers = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('[Background] Failed to parse AI JSON response:', jsonStr);
      // Fallback: return raw text
      sendResponse({ success: true, text: rawText, formatted: rawText });
      return;
    }

    // Build formatted text for display
    let formattedText = '';
    aiAnswers.forEach((a) => {
      const q = questions[a.question];
      if (q) {
        const opt = q.options[a.answer];
        formattedText += `Q${a.question + 1}: ${q.text}\n→ ${opt ? opt.text : 'Unknown'}\n\n`;
      }
    });

    // Build answers array for auto-click (map AI answer indices to DOM indices)
    const clickData = aiAnswers.map((a) => {
      const q = questions[a.question];
      return {
        questionIndex: q ? q.index : -1,
        optionIndex: a.answer
      };
    }).filter(a => a.questionIndex >= 0);

    // Step 3: Auto-click if enabled
    if (autoClick && clickData.length > 0) {
      chrome.tabs.sendMessage(tabId, { action: 'APPLY_ANSWERS', answers: clickData });
    }

    // Step 4: Display results based on hidePopup setting
    const displaySettings = await chrome.storage.local.get(['hidePopup', 'duration']);

    if (displaySettings.hidePopup) {
      // Show inside extension popup
      chrome.storage.local.set({ latestResponse: formattedText.trim() });
      chrome.runtime.sendMessage({ action: 'SET_BADGE' });
      sendResponse({ success: true, text: formattedText.trim(), showInPopup: true });
    } else {
      // Show as floating popup on the page (like capture mode)
      const duration = displaySettings.duration || 10;
      chrome.tabs.sendMessage(tabId, {
        action: 'SHOW_RESPONSE',
        text: formattedText.trim(),
        duration: duration
      });
      sendResponse({ success: true, text: formattedText.trim(), showInPopup: false });
    }

  } catch (error) {
    console.error('[Background] Form Analysis Error:', error);
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
