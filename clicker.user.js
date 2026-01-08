// ==UserScript==
// @name         Timed Auto-Clicker
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Click "Add to Cart" (or custom text) exactly once at a specific time.
// @author       Gemini
// @match        *://www.recreation.gov/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    // --- STATE VARIABLES ---
    let targetTime = null;
    let timeOffsetMs = 0;
    let targetButtonText = "Add to Cart";
    let stopAfterFirstClick = true;
    let isRunning = false;
    let clickIntervalId = null;
    let animationFrameId = null;
    let hasExecutedClick = false; // NEW: Safety flag

    // --- HELPER FUNCTIONS ---

    function findTargetButton() {
        const xpath = `//button[contains(., "${targetButtonText}")]`;
        try {
            const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            return result.singleNodeValue;
        } catch (e) {
            console.error("Invalid XPath:", e);
            return null;
        }
    }

    // --- UI CREATION ---
    const panel = document.createElement('div');
    panel.id = 'tm-autoclicker-panel';
    panel.innerHTML = `
        <div class="tm-header">
            <span>Auto Clicker</span>
            <span class="tm-toggle" id="tm-minimize">-</span>
        </div>
        <div id="tm-content">
            <div class="tm-row">
                <label>Button Text (Case Sensitive):</label>
                <input type="text" id="tm-btn-text" placeholder="e.g. Add to Cart">
            </div>
            <div class="tm-row">
                <label>Target Date/Time:</label>
                <input type="datetime-local" id="tm-target-time" step="1">
            </div>
            <div class="tm-row">
                <label>Offset (ms):</label>
                <input type="number" id="tm-offset" value="-500">
            </div>
            <div class="tm-row tm-checkbox-row">
                <input type="checkbox" id="tm-stop-one">
                <label for="tm-stop-one">Stop after first click</label>
            </div>
            <div class="tm-row">
                <button id="tm-start-btn">Arm Script</button>
                <button id="tm-stop-btn">Stop</button>
            </div>
            <div class="tm-status">Status: <span id="tm-status-text">Idle</span></div>
            <div class="tm-countdown" id="tm-countdown">--:--:--</div>
        </div>
    `;

    document.body.appendChild(panel);

    // --- STYLES ---
    GM_addStyle(`
        #tm-autoclicker-panel {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 280px;
            background: #222;
            color: #fff;
            z-index: 999999;
            font-family: monospace;
            border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            font-size: 13px;
            user-select: none;
        }
        .tm-header {
            padding: 10px;
            background: #333;
            border-radius: 8px 8px 0 0;
            display: flex;
            justify-content: space-between;
            cursor: move;
            font-weight: bold;
        }
        .tm-toggle { cursor: pointer; }
        #tm-content { padding: 15px; }
        .tm-row { margin-bottom: 10px; display: flex; flex-direction: column; }
        .tm-checkbox-row { flex-direction: row !important; align-items: center; }
        .tm-checkbox-row input { width: auto !important; margin-right: 8px; }
        .tm-checkbox-row label { margin: 0 !important; cursor: pointer; color: #fff !important; }
        .tm-row label { margin-bottom: 4px; color: #ccc; }
        .tm-row input:not([type="checkbox"]) {
            padding: 5px;
            background: #444;
            border: 1px solid #555;
            color: #fff;
            border-radius: 4px;
        }
        .tm-row button {
            padding: 10px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            width: 100%;
            font-size: 14px;
        }
        #tm-start-btn { background: #28a745; color: white; display: block; }
        #tm-stop-btn { background: #dc3545; color: white; display: none; }
        
        .tm-status { margin-top: 15px; font-size: 12px; color: #aaa; border-top: 1px solid #444; padding-top: 10px;}
        #tm-status-text { color: #fff; font-weight: bold; }
        .tm-countdown { font-size: 16px; text-align: center; margin-top: 10px; color: #00bcd4; font-weight: bold; }
    `);

    // --- LOGIC ---

    // Load saved settings
    const savedTime = GM_getValue('tm_target_time', '');
    const savedOffset = GM_getValue('tm_offset', '-500');
    const savedBtnText = GM_getValue('tm_btn_text', 'Add to Cart');
    const savedStopOne = GM_getValue('tm_stop_one', true);

    document.getElementById('tm-target-time').value = savedTime;
    document.getElementById('tm-offset').value = savedOffset;
    document.getElementById('tm-btn-text').value = savedBtnText;
    document.getElementById('tm-stop-one').checked = savedStopOne;

    const startBtn = document.getElementById('tm-start-btn');
    const stopBtn = document.getElementById('tm-stop-btn');
    const statusText = document.getElementById('tm-status-text');
    const countdownEl = document.getElementById('tm-countdown');

    function updateStatus(msg, color = 'white') {
        statusText.textContent = msg;
        statusText.style.color = color;
    }

    // Draggable Logic
    let isDragging = false;
    let currentX, currentY, initialX, initialY;
    let xOffset = 0, yOffset = 0;

    const header = panel.querySelector('.tm-header');
    header.addEventListener("mousedown", dragStart);
    document.addEventListener("mouseup", dragEnd);
    document.addEventListener("mousemove", drag);

    function dragStart(e) {
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;
        if (e.target === header || e.target.parentNode === header) isDragging = true;
    }

    function dragEnd(e) {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
    }

    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            xOffset = currentX;
            yOffset = currentY;
            panel.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
        }
    }

    // Timer Logic
    startBtn.addEventListener('click', () => {
        const timeInput = document.getElementById('tm-target-time').value;
        const offsetInput = document.getElementById('tm-offset').value;
        const textInput = document.getElementById('tm-btn-text').value;
        const stopOneInput = document.getElementById('tm-stop-one').checked;

        if (!timeInput) {
            alert('Please set a target date and time.');
            return;
        }

        if (!textInput) {
            alert('Please enter the button text.');
            return;
        }

        // Save settings
        GM_setValue('tm_target_time', timeInput);
        GM_setValue('tm_offset', offsetInput);
        GM_setValue('tm_btn_text', textInput);
        GM_setValue('tm_stop_one', stopOneInput);

        targetTime = new Date(timeInput).getTime();
        timeOffsetMs = parseInt(offsetInput, 10) || 0;
        targetButtonText = textInput;
        stopAfterFirstClick = stopOneInput;

        const adjustedTarget = targetTime + timeOffsetMs;

        if (adjustedTarget < Date.now()) {
            alert('Target time is in the past!');
            return;
        }

        isRunning = true;
        hasExecutedClick = false; // Reset the safety flag

        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';

        document.getElementById('tm-target-time').disabled = true;
        document.getElementById('tm-offset').disabled = true;
        document.getElementById('tm-btn-text').disabled = true;
        document.getElementById('tm-stop-one').disabled = true;

        updateStatus(`ARMED`, '#00bcd4');
        checkTimeLoop(adjustedTarget);
    });

    stopBtn.addEventListener('click', stopScript);

    function stopScript() {
        isRunning = false;
        if (clickIntervalId) clearInterval(clickIntervalId);
        if (animationFrameId) cancelAnimationFrame(animationFrameId);

        startBtn.style.display = 'block';
        stopBtn.style.display = 'none';

        document.getElementById('tm-target-time').disabled = false;
        document.getElementById('tm-offset').disabled = false;
        document.getElementById('tm-btn-text').disabled = false;
        document.getElementById('tm-stop-one').disabled = false;

        updateStatus('Stopped', '#dc3545');
        countdownEl.textContent = "--:--:--";
    }

    function checkTimeLoop(finalTime) {
        if (!isRunning) return;

        const now = Date.now();
        const diff = finalTime - now;

        if (diff > 0) {
            const seconds = Math.floor((diff / 1000) % 60);
            const minutes = Math.floor((diff / (1000 * 60)) % 60);
            const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
            const ms = Math.floor(diff % 1000);
            countdownEl.textContent = `${hours}h ${minutes}m ${seconds}s .${ms}`;
        }

        if (now >= finalTime) {
            updateStatus('FIRING!', '#28a745');
            countdownEl.textContent = "00:00:00";
            startClicking();
            return;
        }

        animationFrameId = requestAnimationFrame(() => checkTimeLoop(finalTime));
    }

    function startClicking() {
        const originalUrl = window.location.href;

        clickIntervalId = setInterval(() => {
            // SAFETY CHECK 1: If we wanted to stop after one click and we already did, ABORT immediately.
            if (stopAfterFirstClick && hasExecutedClick) {
                stopScript();
                updateStatus('Done', '#28a745');
                return;
            }

            if (window.location.href !== originalUrl) {
                stopScript();
                updateStatus('SUCCESS: Page changed', '#28a745');
                return;
            }

            const btn = findTargetButton();

            if (btn) {
                // SAFETY CHECK 2: Before clicking, check the flag again to prevent race conditions
                if (stopAfterFirstClick && hasExecutedClick) return;

                // Mark as clicked IMMEDIATELY before the actual action
                if (stopAfterFirstClick) {
                    hasExecutedClick = true;
                    // We clear the interval here immediately to prevent the next tick
                    clearInterval(clickIntervalId);
                }

                // --- EXECUTE CLICK ---
                // We send both a native click and a dispatch event for maximum compatibility.
                // NOTE: If the site counts this as two clicks, it is because we are sending two events.
                // We keep both to ensure it works on React/Angular/Vue sites that might ignore one or the other.
                try {
                    btn.click();
                    const event = new MouseEvent('click', {
                        view: window,
                        bubbles: true,
                        cancelable: true
                    });
                    btn.dispatchEvent(event);
                    console.log(`TM Auto-Clicker: Clicked button "${targetButtonText}"`);
                } catch (e) {
                    console.error("Click error:", e);
                }

                if (stopAfterFirstClick) {
                    stopScript();
                    updateStatus('Done', '#28a745');
                }
            } else {
                console.warn(`TM Auto-Clicker: Button "${targetButtonText}" not found yet.`);
            }
        }, 50);
    }

    // Toggle minimize
    document.getElementById('tm-minimize').addEventListener('click', () => {
        const content = document.getElementById('tm-content');
        if (content.style.display === 'none') {
            content.style.display = 'block';
            document.getElementById('tm-minimize').textContent = '-';
        } else {
            content.style.display = 'none';
            document.getElementById('tm-minimize').textContent = '+';
        }
    });

})();