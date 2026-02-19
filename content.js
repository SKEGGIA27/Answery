// Content Script

function initializeContentScript() {
    if (window.hasAIContentScript) {
        return;
    }
    window.hasAIContentScript = true;


    let selectionOverlay = null;
    let startX, startY, endX, endY;
    let isSelecting = false;
    let selectionRect = null;
    let confirmPopup = null;
    let responsePopup = null;
    let responseTimer = null;
    let requestCancelled = false;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'ACTIVATE_SELECTION') {
            createOverlay();
        } else if (request.action === 'SHOW_RESPONSE') {
            showResponsePopup(request.text, request.duration);
        } else if (request.action === 'DETECT_FORM') {
            sendResponse({ isForm: detectForm() });
            return true;
        } else if (request.action === 'SCRAPE_FORM') {
            sendResponse({ questions: scrapeFormQuestions() });
            return true;
        } else if (request.action === 'APPLY_ANSWERS') {
            applyAnswers(request.answers);
            sendResponse({ success: true });
            return true;
        }
    });

    // ===== Form Solver Functions =====

    function detectForm() {
        const url = window.location.href.toLowerCase();
        return url.includes('forms.office.com') || url.includes('forms.microsoft.com');
    }

    function scrapeFormQuestions() {
        const questions = [];
        const questionItems = document.querySelectorAll('[data-automation-id="questionItem"]');

        questionItems.forEach((item, index) => {
            // Check for images — skip if found
            const images = item.querySelectorAll('img');
            if (images.length > 0) return;

            // Get question text
            const titleEl = item.querySelector('[data-automation-id="questionTitle"]');
            if (!titleEl) return;

            // Extract text, removing the ordinal number (e.g. "1.")
            const ordinalEl = titleEl.querySelector('[data-automation-id="questionOrdinal"]');
            let questionText = titleEl.innerText.trim();
            if (ordinalEl) {
                questionText = questionText.replace(ordinalEl.innerText, '').trim();
            }

            if (!questionText) return;

            // Get choices
            const choiceItems = item.querySelectorAll('[data-automation-id="choiceItem"]');
            if (choiceItems.length === 0) return; // Skip non-choice questions (e.g. text input)

            const options = [];
            choiceItems.forEach((choice, optIndex) => {
                const label = choice.querySelector('label');
                const input = choice.querySelector('input[type="radio"], input[type="checkbox"]');
                if (label) {
                    options.push({
                        text: label.innerText.trim(),
                        optionIndex: optIndex
                    });
                }
            });

            if (options.length > 0) {
                questions.push({
                    index: index,
                    text: questionText,
                    options: options
                });
            }
        });

        return questions;
    }

    function applyAnswers(answers) {
        const questionItems = document.querySelectorAll('[data-automation-id="questionItem"]');

        answers.forEach((answer, i) => {
            setTimeout(() => {
                const questionItem = questionItems[answer.questionIndex];
                if (!questionItem) return;

                const choiceItems = questionItem.querySelectorAll('[data-automation-id="choiceItem"]');
                const targetChoice = choiceItems[answer.optionIndex];
                if (!targetChoice) return;

                // Click the input or label
                const input = targetChoice.querySelector('input[type="radio"], input[type="checkbox"]');
                if (input) {
                    input.click();
                } else {
                    const label = targetChoice.querySelector('label');
                    if (label) label.click();
                }
            }, i * 100); // 100ms delay between each click
        });
    }

    function createOverlay() {
        if (selectionOverlay) {
            return;
        }

        selectionOverlay = document.createElement('div');
        selectionOverlay.id = 'ai-capture-overlay';
        document.body.appendChild(selectionOverlay);

        // Crosshair cursor is handled in CSS

        selectionOverlay.addEventListener('mousedown', onMouseDown);

        // ESC key to cancel capture
        function onEscKey(e) {
            if (e.key === 'Escape') {
                removeOverlay();
                document.removeEventListener('keydown', onEscKey);
            }
        }
        document.addEventListener('keydown', onEscKey);
    }

    function onMouseDown(e) {
        if (confirmPopup) return; // Don't start new selection if popup is open

        isSelecting = true;
        startX = e.clientX;
        startY = e.clientY;

        // Create or reset selection rectangle
        if (!selectionRect) {
            selectionRect = document.createElement('div');
            selectionRect.id = 'ai-capture-rect';
            selectionOverlay.appendChild(selectionRect);
        }

        updateSelection(e.clientX, e.clientY);

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }

    function onMouseMove(e) {
        if (!isSelecting) return;
        updateSelection(e.clientX, e.clientY);
    }

    function updateSelection(currentX, currentY) {
        const x = Math.min(startX, currentX);
        const y = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);

        selectionRect.style.left = `${x}px`;
        selectionRect.style.top = `${y}px`;
        selectionRect.style.width = `${width}px`;
        selectionRect.style.height = `${height}px`;
    }

    function onMouseUp(e) {
        isSelecting = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);

        endX = e.clientX;
        endY = e.clientY;

        // Ensure valid selection size
        if (Math.abs(endX - startX) > 10 && Math.abs(endY - startY) > 10) {
            showConfirmPopup();
        } else {
            removeOverlay();
        }
    }

    function showConfirmPopup() {
        confirmPopup = document.createElement('div');
        confirmPopup.id = 'ai-capture-confirm';
        confirmPopup.innerHTML = `
        <button id="ai-btn-cancel" class="ai-btn ai-btn-cancel">✖</button>
        <button id="ai-btn-confirm" class="ai-btn ai-btn-confirm">✔</button>
    `;

        // Append first to get dimensions for calculation
        document.body.appendChild(confirmPopup);

        const rect = selectionRect.getBoundingClientRect();
        const popupRect = confirmPopup.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const padding = 10;

        // Preferred position: Centered below the selection
        let left = rect.left + (rect.width / 2) - (popupRect.width / 2);
        let top = rect.bottom + 10;

        // Horizontal Adjustment: Ensure it stays within viewport
        if (left < padding) {
            left = padding;
        } else if (left + popupRect.width > windowWidth - padding) {
            left = windowWidth - popupRect.width - padding;
        }

        // Vertical Adjustment: Check if it overflows bottom edge
        if (top + popupRect.height > windowHeight - padding) {
            // Move above the selection
            top = rect.top - popupRect.height - 10;
        }
        // Ensure it doesn't overflow top edge
        if (top < padding) top = padding;

        confirmPopup.style.left = `${left}px`;
        confirmPopup.style.top = `${top}px`;

        document.getElementById('ai-btn-cancel').addEventListener('click', cancelSelection);
        document.getElementById('ai-btn-confirm').addEventListener('click', confirmSelection);
    }

    function cancelSelection() {
        removeOverlay();
    }

    function removeOverlay() {
        if (selectionOverlay) selectionOverlay.remove();
        if (confirmPopup) confirmPopup.remove();
        selectionOverlay = null;
        selectionRect = null;
        confirmPopup = null;
    }

    async function confirmSelection() {
        // 1. Hide overlay to take clean screenshot
        selectionOverlay.style.display = 'none';
        if (confirmPopup) confirmPopup.style.display = 'none';

        // 2. Wait a generic frame/timeout to ensure rendering updated
        setTimeout(() => {
            // 3. Request Capture
            chrome.runtime.sendMessage({ action: 'CAPTURE_AREA' }, (response) => {
                if (response && response.dataUrl) {
                    processCapture(response.dataUrl);
                } else {
                    console.error('[Content] Capture failed:', response ? response.error : 'No response');
                    showResponsePopup("Capture failed. Please try again.", 5);
                    removeOverlay();
                }
            });
        }, 50);
    }

    function processCapture(dataUrl) {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const dpr = window.devicePixelRatio || 1;

            // Calculate crop coordinates
            const rect = selectionRect.getBoundingClientRect(); // relative to viewport


            const x = Math.min(startX, endX) * dpr;
            const y = Math.min(startY, endY) * dpr;
            const w = Math.abs(endX - startX) * dpr;
            const h = Math.abs(endY - startY) * dpr;

            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');

            ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

            const croppedBase64 = canvas.toDataURL('image/png');

            // Check hidePopup before showing loading state
            chrome.storage.local.get(['hidePopup'], (s) => {
                if (!s.hidePopup) {
                    restoreOverlayForLoading(); // Show loading state only if popup visible
                } else {
                    removeOverlay(); // Just remove the selection UI silently
                }
                // Send to AI
                sendToAI(croppedBase64);
            });
        };
        img.src = dataUrl;
    }

    function restoreOverlayForLoading() {
        requestCancelled = false;
        removeOverlay(); // Remove selection UI
        // Show temporary loader
        showResponsePopup("Getting response...", 999, true);
    }

    function sendToAI(imageBase64) {
        chrome.storage.local.get(['model', 'geminiModel', 'apiKey', 'presetMessage', 'duration', 'hidePopup'], (settings) => {
            if (!settings.apiKey) {
                console.warn('[Content] No API Key found.');
                showResponsePopup("No API Key found. Open Answery settings to add one.", 5);
                return;
            }

            const payload = {
                imageBase64: imageBase64,
                model: settings.model || 'gemini',
                geminiModel: settings.geminiModel,
                apiKey: settings.apiKey,
                prompt: settings.presetMessage || "Analyze the content in this image and provide a clear answer."
            };

            chrome.runtime.sendMessage({ action: 'ANALYZE_IMAGE', payload: payload }, (response) => {
                // If user cancelled during loading, ignore the response
                if (requestCancelled) return;

                if (response.success) {

                    if (settings.hidePopup) {
                        // Save to storage for GUI display silently
                        chrome.storage.local.set({ latestResponse: response.text }, () => {
                            // Show badge on extension icon
                            chrome.runtime.sendMessage({ action: 'SET_BADGE' });
                        });
                    } else {
                        // Show floating popup
                        showResponsePopup(response.text, settings.duration || 5);
                    }

                } else {
                    console.error('[Content] Analysis failed:', response.error);
                    showResponsePopup(`Error: ${response.error}`, 10);
                }
            });
        });
    }

    function showResponsePopup(text, duration, isLoading = false) {
        // Remove existing if any
        if (responsePopup) responsePopup.remove();
        if (responseTimer) clearTimeout(responseTimer);

        responsePopup = document.createElement('div');
        responsePopup.id = 'ai-response-popup';

        // Check for Stealth Mode
        chrome.storage.local.get(['stealthMode'], (res) => {
            if (res.stealthMode) {
                responsePopup.classList.add('ai-phantom');
            }
        });

        let contentHtml = `
        <button class="ai-stop-btn" title="Stop Timer">⏸</button>
        <button class="ai-close-btn">✖</button>
        <div class="ai-content"></div>`;

        if (!isLoading) {
            contentHtml += `<div class="ai-progress-bar"><div class="ai-progress-fill" style="transition: width ${duration}s linear;"></div></div>`;
        } else {
            contentHtml += `<div class="ai-loading-spinner"></div>`;
        }

        responsePopup.innerHTML = contentHtml;
        responsePopup.querySelector('.ai-content').textContent = text;
        document.body.appendChild(responsePopup);

        responsePopup.querySelector('.ai-close-btn').addEventListener('click', () => {
            if (responseTimer) clearTimeout(responseTimer);
            // If closing during loading, cancel the pending request
            if (isLoading) requestCancelled = true;
            responsePopup.remove();
            responsePopup = null;
        });

        const stopBtn = responsePopup.querySelector('.ai-stop-btn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                if (responseTimer) {
                    clearTimeout(responseTimer);
                    responseTimer = null;
                    // Visual feedback
                    const fill = responsePopup.querySelector('.ai-progress-fill');
                    if (fill) fill.style.backgroundColor = '#ccc';
                    stopBtn.style.color = '#333';
                }
            });
        }

        if (!isLoading) {
            const fill = responsePopup.querySelector('.ai-progress-fill');
            if (fill) {
                // Trigger reflow
                void fill.offsetWidth;
                // Start animation
                fill.style.width = '0%';
            }

            responseTimer = setTimeout(() => {
                if (responsePopup) {
                    responsePopup.remove();
                    responsePopup = null;
                }
            }, duration * 1000);
        }
    }



    // Stealth Mode CSS Injection - Dynamic
    const style = document.createElement('style');
    style.id = 'ai-stealth-style';
    document.head.appendChild(style);

    function updateStealthStyle(transparency) {
        // transparency: 0 = fully visible, 100 = invisible
        const val = (transparency || 0);
        const opacity = 1 - (val / 100); // 0->1, 100->0
        style.textContent = `
            .ai-phantom {
                opacity: ${opacity} !important;
                transition: opacity 0.2s ease-in-out !important;
            }
            .ai-phantom:hover {
                opacity: 1 !important;
            }
        `;
    }

    // Initialize style
    chrome.storage.local.get(['stealthTransparency'], (res) => {
        updateStealthStyle(res.stealthTransparency);
    });

    // Quick Capture Button Logic
    let quickButton = null;
    let quickButtonHidden = false;

    // Check stealth mode before creating button
    function checkAndCreateQuickButton() {
        chrome.storage.local.get(['quickButton', 'stealthMode'], (result) => {
            if (result.stealthMode) {
                removeQuickButton();
                return;
            }

            if (result.quickButton) {
                createQuickButton();
            } else {
                removeQuickButton();
            }
        });
    }

    checkAndCreateQuickButton();

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {

            // Update Transparency
            if (changes.stealthTransparency) {
                updateStealthStyle(changes.stealthTransparency.newValue);
            }

            // Re-evaluate quick button on ANY relevant change
            if (changes.stealthMode || changes.quickButton) {
                checkAndCreateQuickButton();
            }
        }
    });

    function removeQuickButton() {

        if (!quickButton) {
            quickButton = document.getElementById('ai-quick-btn-container'); // Re-acquire if lost
        }

        if (quickButton) {
            quickButton.remove();
            quickButton = null;
        }
    }

    function createQuickButton() {
        if (quickButton || document.getElementById('ai-quick-btn-container')) {
            return;
        }

        quickButton = document.createElement('div');
        quickButton.id = 'ai-quick-btn-container';
        quickButton.innerHTML = `
        <div id="ai-quick-btn-main" title="Capture Screen">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24" style="pointer-events: none;"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </div>
        <div id="ai-quick-btn-toggle" title="Hide">>></div>
    `;
        document.body.appendChild(quickButton);

        const mainBtn = quickButton.querySelector('#ai-quick-btn-main');
        const toggleBtn = quickButton.querySelector('#ai-quick-btn-toggle');

        // Restore Position
        chrome.storage.local.get(['quickButtonPosition'], (result) => {
            const pos = result.quickButtonPosition || { side: 'right', top: '20px' };
            quickButton.style.top = pos.top;
            quickButton.dataset.side = pos.side;

            if (pos.side === 'left') {
                quickButton.classList.add('ai-side-left');
                quickButton.style.left = '0px';
                quickButton.style.right = 'auto';
            } else {
                quickButton.classList.remove('ai-side-left');
                quickButton.style.right = '0px';
                quickButton.style.left = 'auto';
            }
            updateToggleButtonIcon();
        });

        // Drag Logic
        let isDragging = false;
        let dragStartX, dragStartY;
        let initialLeft, initialTop;
        let hasMoved = false;

        mainBtn.addEventListener('mousedown', (e) => {
            isDragging = true;
            hasMoved = false;
            dragStartX = e.clientX;
            dragStartY = e.clientY;

            const rect = quickButton.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            e.preventDefault(); // Prevent text selection

            window.addEventListener('mousemove', onDragMove);
            window.addEventListener('mouseup', onDragUp);
        });

        function onDragMove(e) {
            if (!isDragging) return;

            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;

            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                hasMoved = true;
            }

            quickButton.style.left = `${initialLeft + dx}px`;
            quickButton.style.top = `${initialTop + dy}px`;
            quickButton.style.bottom = 'auto';
            quickButton.style.right = 'auto';
        }

        function onDragUp() {
            isDragging = false;
            window.removeEventListener('mousemove', onDragMove);
            window.removeEventListener('mouseup', onDragUp);

            if (hasMoved) {
                snapToEdge();
            }
        }

        function snapToEdge() {
            const rect = quickButton.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            const midX = rect.left + rect.width / 2;
            let side = 'right';

            if (midX < windowWidth / 2) {
                // Snap to Left
                side = 'left';
                quickButton.style.left = '0px';
                quickButton.style.right = 'auto';
                quickButton.classList.add('ai-side-left');
            } else {
                // Snap to Right
                side = 'right';
                quickButton.style.left = 'auto';
                quickButton.style.right = '0px';
                quickButton.classList.remove('ai-side-left');
            }

            quickButton.dataset.side = side;

            // Save Position
            const topPos = quickButton.style.top;
            chrome.storage.local.set({
                quickButtonPosition: { side: side, top: topPos }
            });

            updateToggleButtonIcon();
        }

        // Click Logic (Capture)
        mainBtn.addEventListener('click', (e) => {
            if (!hasMoved) {
                createOverlay();
            }
        });

        // Toggle Logic (Hide/Show)
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent drag/click propagation
            toggleQuickButtonState();
        });

        // Initial Icon Update (will be called again after storage load)
        updateToggleButtonIcon();
    }

    function toggleQuickButtonState() {
        if (!quickButton) return;

        quickButtonHidden = !quickButtonHidden;

        if (quickButtonHidden) {
            quickButton.classList.add('ai-minimized');
        } else {
            quickButton.classList.remove('ai-minimized');
        }
        updateToggleButtonIcon();
    }

    function updateToggleButtonIcon() {
        if (!quickButton) return;
        const toggleBtn = quickButton.querySelector('#ai-quick-btn-toggle');
        if (!toggleBtn) return;
        const side = quickButton.dataset.side || 'right';

        if (quickButtonHidden) {
            // Minimized
            toggleBtn.textContent = side === 'right' ? '<<' : '>>';
            toggleBtn.title = "Show";
        } else {
            // Expanded
            toggleBtn.textContent = side === 'right' ? '>>' : '<<';
            toggleBtn.title = "Hide";
        }
    }
}

initializeContentScript();
