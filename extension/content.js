// Fixion AI - Forensic Loading v15.0
console.log("%c Fixion AI: [v15.0] Forensic Stream Active ", "background: #2563eb; color: white; font-weight: bold; padding: 4px 8px; border-radius: 4px;");

const themeStyle = document.createElement("style");
themeStyle.textContent = `
    #fixion-ai-panel { font-family: 'Inter', sans-serif !important; color-scheme: dark !important; }
    .fx-glass { background: rgba(10, 10, 15, 0.98) !important; backdrop-filter: blur(25px) !important; -webkit-backdrop-filter: blur(25px) !important; border: 1px solid rgba(255, 255, 255, 0.1) !important; box-shadow: 0 25px 70px rgba(0,0,0,0.9) !important; }
    @keyframes fx-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    @keyframes fx-pulse-text { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
    @keyframes fx-fade-slide { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes fx-stage-in { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
    .fx-stage-active { color: #2563eb !important; }
    .fx-stage-done { color: #10b981 !important; }
`;
document.head.appendChild(themeStyle);

let latestElement = null;
let originalHTML = "";

const LLM_CONFIGS = {
    "chatgpt.com": {
        assistantSelector: 'div[data-message-author-role="assistant"]',
        contentSelector: '.markdown'
    },
    "claude.ai": {
        assistantSelector: 'div[data-testid="message-container-assistant"]',
        contentSelector: '.font-claude-message'
    },
    "gemini.google.com": {
        assistantSelector: 'message-content',
        contentSelector: '.message-content'
    },
    "perplexity.ai": {
        assistantSelector: 'div.prose',
        contentSelector: 'div.prose'
    },
    "deepseek.com": {
        assistantSelector: '.ds-markdown--block',
        contentSelector: '.ds-markdown--block'
    }
};

function getActiveLLMConfig() {
    const host = window.location.hostname;
    for (const [domain, config] of Object.entries(LLM_CONFIGS)) {
        if (host.includes(domain)) return config;
    }
    return {
        assistantSelector: 'div[class*="assistant"], div[class*="model-response"], .prose',
        contentSelector: '.markdown, .prose, [class*="content"]'
    };
}

function injectGlobalAuditButton() {
    if (document.getElementById("fx-global-audit-btn")) return;
    const btn = document.createElement("div");
    btn.id = "fx-global-audit-btn";
    btn.style.cssText = "position: fixed; bottom: 30px; right: 30px; z-index: 2000000; display: flex; align-items: center; gap: 10px; padding: 12px 24px; background: #2563eb; border-radius: 14px; cursor: pointer; box-shadow: 0 8px 30px rgba(37, 99, 235, 0.5); transition: 0.3s;";
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span style="color: white; font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px;">Audit</span>`;
    btn.onclick = () => {
        const config = getActiveLLMConfig();
        const msgs = document.querySelectorAll(config.assistantSelector);
        if (msgs.length > 0) {
            const last = msgs[msgs.length - 1];
            latestElement = last.querySelector(config.contentSelector) || last;
            originalHTML = latestElement.innerHTML;
            analyzeResponse(last.innerText.trim());
        } else {
            // Fallback: search for any assistant-like container if specific selector fails
            const fallbackMsgs = document.querySelectorAll('.assistant, [class*="assistant"]');
            if (fallbackMsgs.length > 0) {
                const last = fallbackMsgs[fallbackMsgs.length - 1];
                latestElement = last;
                originalHTML = last.innerHTML;
                analyzeResponse(last.innerText.trim());
            } else {
                alert("Fixion: No AI response detected on this page yet.");
            }
        }
    };
    document.body.appendChild(btn);
}

function createOverlayPanel() {
    if (document.getElementById("fixion-ai-panel")) return;
    const panel = document.createElement("div");
    panel.id = "fixion-ai-panel";
    panel.className = "fx-glass";
    panel.style.cssText = "position: fixed; top: 20px; right: 20px; width: 420px; border-radius: 20px; z-index: 1000000; display: none; flex-direction: column; overflow: hidden;";
    panel.innerHTML = `
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02);">
            <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 32px; height: 32px; background: #2563eb; border-radius: 8px; display: flex; align-items: center; justify-content: center;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg></div>
                <div>
                    <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: #fff;">Fixion Dashboard</h3>
                    <div style="font-size: 9px; color: #888890; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Intelligence Terminal</div>
                </div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <button id="fx-fix-all-header" style="background: #10b981; color: white; border: none; border-radius: 6px; padding: 6px 12px; font-size: 10px; font-weight: 900; cursor: pointer;">⚡ FIX ALL</button>
                <button id="fx-close-panel" style="background: transparent; border: none; color: #888; cursor: pointer; font-size: 20px;">✕</button>
            </div>
        </div>
        <div id="fixion-ai-content" style="padding: 24px; min-height: 300px; display: flex; flex-direction: column;"></div>
    `;
    document.body.appendChild(panel);
    document.getElementById("fx-close-panel").onclick = () => { panel.style.display = "none"; };
}

function updatePanel(data) {
    const content = document.getElementById("fixion-ai-content");
    if (!content) return;
    const rel = Math.round((data.scoring?.reliability_score || 0) * 100);
    const hal = Math.round((data.scoring?.hallucination || 0) * 100);
    const meterColor = rel > 70 ? "#10b981" : (rel > 40 ? "#f59e0b" : "#f43f5e");

    content.innerHTML = `
        <div style="animation: fx-fade-slide 0.5s ease-out;">
            <div style="margin-bottom: 24px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div style="color: #94a3b8; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">Reliability Score</div>
                    ${hal > 20 ? `<div style="background: rgba(244, 63, 94, 0.15); color: #f43f5e; padding: 4px 12px; border-radius: 8px; font-size: 11px; font-weight: 800; border: 1px solid rgba(244, 63, 94, 0.2);">Hallucination Detected</div>` : ''}
                </div>
                <div style="font-size: 56px; font-weight: 900; color: #fff; line-height: 1;">${rel}%</div>
                <div style="height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; margin-top: 12px; overflow: hidden;">
                    <div style="height: 100%; width: ${rel}%; background: ${meterColor}; transition: width 1.5s;"></div>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px;">
                <div style="padding: 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; text-align: center;">
                    <div style="color: #94a3b8; font-size: 9px; font-weight: 800; text-transform: uppercase; margin-bottom: 4px;">Hallucination</div>
                    <div style="font-size: 24px; font-weight: 800; color: #f43f5e;">${hal}%</div>
                </div>
                <div style="padding: 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; text-align: center;">
                    <div style="color: #94a3b8; font-size: 9px; font-weight: 800; text-transform: uppercase; margin-bottom: 4px;">Sources</div>
                    <div style="font-size: 24px; font-weight: 800; color: #fff;">${data.nli_results.length}</div>
                </div>
            </div>
            <div style="padding: 16px; background: rgba(0,0,0,0.25); border-radius: 12px; font-size: 14px; color: #cbd5e1; line-height: 1.6; margin-bottom: 24px; border: 1px solid rgba(255,255,255,0.05);">
                ${data.scoring?.explanation || "Analysis complete."}
            </div>
            <div style="padding: 18px; background: rgba(6, 78, 59, 0.4); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 12px; margin-bottom: 12px;">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">
                    <div style="width: 20px; height: 20px; background: #10b981; border-radius: 6px; display: flex; align-items: center; justify-content: center;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
                    <span style="font-size: 11px; font-weight: 900; color: #fff; text-transform: uppercase; letter-spacing: 1px;">Sovereign Correction</span>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button id="fx-copy-fix" style="flex: 1; padding: 12px; background: #10b981; color: white; border: none; border-radius: 10px; font-weight: 800; font-size: 13px; cursor: pointer;">Copy Fix</button>
                    <button id="fx-auto-fix" style="flex: 1; padding: 12px; background: #2563eb; color: white; border: none; border-radius: 10px; font-weight: 800; font-size: 13px; cursor: pointer;">Auto-Fix View</button>
                </div>
            </div>

            <button id="fx-highlight-btn" style="width: 100%; padding: 14px; background: rgba(37, 99, 235, 0.1); color: #60a5fa; border: 1px solid rgba(37, 99, 235, 0.3); border-radius: 12px; font-weight: 800; font-size: 13px; cursor: pointer; margin-bottom: 12px;">Highlight Hallucinations</button>
            <button id="fx-open-trace" style="width: 100%; padding: 14px; background: rgba(255,255,255,0.03); color: #94a3b8; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; font-weight: 800; font-size: 13px; cursor: pointer;">Open Auditor Trace</button>
        </div>
    `;

    if (data.correction) {
        document.getElementById("fx-copy-fix").onclick = () => { navigator.clipboard.writeText(data.correction.corrected_response); alert("✓ Copied!"); };
        document.getElementById("fx-auto-fix").onclick = () => { if (latestElement) { latestElement.innerHTML = data.correction.corrected_response.replace(/\n/g, '<br>'); latestElement.style.color = "#10b981"; } };
    }

    document.getElementById("fx-highlight-btn").onclick = () => {
        if (!latestElement) return;
        let html = originalHTML;
        data.nli_results.forEach(res => {
            const safeClaim = res.claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
            try {
                const regex = new RegExp(`(${safeClaim})`, 'gi');
                if (res.status === 'contradiction') {
                    // BRIGHT RED FOR HALLUCINATIONS
                    html = html.replace(regex, `<span style="background: rgba(255, 0, 0, 0.3) !important; border-bottom: 3px solid #ff0000 !important; color: #ffffff !important; font-weight: 900 !important; text-shadow: 0 0 10px #ff0000; padding: 2px 4px; border-radius: 4px;">$1</span>`);
                } else if (res.status === 'entailment') {
                    // PROFESSIONAL GREEN FOR VERIFIED
                    html = html.replace(regex, `<span style="border-bottom: 2px solid #10b981; color: #10b981; font-weight: 600;">$1</span>`);
                }
            } catch (e) { console.error("Highlight Error:", e); }
        });
        latestElement.innerHTML = html;
        // Scroll the element into view if needed
        latestElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    // AUTOMATIC HIGHLIGHTING: Trigger the red highlight instantly on completion
    setTimeout(() => {
        document.getElementById("fx-highlight-btn")?.click();
    }, 500);
}

async function analyzeResponse(text) {
    const panel = document.getElementById("fixion-ai-panel");
    panel.style.display = "flex";
    const content = document.getElementById("fixion-ai-content");
    
    const stages = [
        { id: "claims", label: "Extracting Atomic Claims", icon: "◈" },
        { id: "retrieval", label: "Researching Evidence", icon: "◈" },
        { id: "nli", label: "Forensic Verification", icon: "◈" },
        { id: "scoring", label: "Generating Reliability Score", icon: "◈" }
    ];
    
    content.innerHTML = `
        <div id="fx-loader-container" style="padding: 10px; animation: fx-fade-slide 0.4s ease-out;">
            <div style="margin-bottom: 30px; text-align: center;">
                <div style="width: 40px; height: 40px; border: 3px solid rgba(37, 99, 235, 0.1); border-top-color: #2563eb; border-radius: 50%; animation: fx-spin 0.8s linear infinite; margin: 0 auto 16px;"></div>
                <div style="font-size: 11px; font-weight: 900; color: #60a5fa; text-transform: uppercase; letter-spacing: 2px;">Audit in Progress</div>
            </div>
            <div id="fx-stages-list" style="display: flex; flex-direction: column; gap: 20px;">
                ${stages.map((s, i) => `
                    <div id="stage-${s.id}" style="display: flex; align-items: center; gap: 15px; opacity: 0.3; transition: 0.4s; animation: fx-stage-in ${0.2 + i * 0.1}s ease-out forwards;">
                        <div class="stage-icon" style="width: 24px; height: 24px; border-radius: 6px; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; border: 1px solid rgba(255,255,255,0.1);">${s.icon}</div>
                        <div style="font-size: 13px; font-weight: 700; color: #94a3b8;">${s.label}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    function updateStage(id, status) {
        const el = document.getElementById(`stage-${id}`);
        if (!el) return;
        const icon = el.querySelector(".stage-icon");
        if (status === "active") {
            el.style.opacity = "1";
            el.style.transform = "scale(1.02)";
            icon.style.background = "rgba(37, 99, 235, 0.1)";
            icon.style.borderColor = "#2563eb";
            icon.style.color = "#2563eb";
            icon.innerHTML = `<div style="width: 8px; height: 8px; background: #2563eb; border-radius: 50%; animation: fx-pulse-text 1s infinite;"></div>`;
        } else if (status === "done") {
            el.style.opacity = "1";
            el.style.transform = "scale(1)";
            icon.style.background = "rgba(16, 185, 129, 0.1)";
            icon.style.borderColor = "#10b981";
            icon.style.color = "#10b981";
            icon.innerHTML = "✓";
        }
    }

    // Initial state
    updateStage("claims", "active");

    try {
        chrome.runtime.sendMessage({ type: "API_CALL", url: "http://127.0.0.1:8000/analyze", method: "POST", body: { query: "unknown", response: text, demo_mode: false }, isStreaming: true });
    } catch (e) { content.innerHTML = "Error: Please reload extension."; }

    const listener = (msg) => {
        if (msg.type === "STREAM_CHUNK") {
            try {
                const event = JSON.parse(msg.chunk.substring(6));
                if (event.step === "claims_extracted") { updateStage("claims", "done"); updateStage("retrieval", "active"); }
                if (event.step === "retrieval_done") { updateStage("retrieval", "done"); updateStage("nli", "active"); }
                if (event.step === "nli_done") { updateStage("nli", "done"); updateStage("scoring", "active"); }
                if (event.step === "scoring_done") { updateStage("scoring", "done"); }
                
                if (event.step === "final") { 
                    updatePanel(event.data); 
                    chrome.runtime.onMessage.removeListener(listener); 
                }
            } catch (e) {}
        }
    };

    try {
        if (chrome.runtime && chrome.runtime.id) {
            chrome.runtime.onMessage.addListener(listener);
        } else {
            throw new Error("Extension context invalidated");
        }
    } catch (e) { 
        console.warn("Fixion: Connection to backend lost. Please refresh the page.");
        content.innerHTML = `<div style="padding: 20px; text-align: center; color: #f43f5e; font-weight: bold;">Connection Lost.<br><span style="font-size: 11px; font-weight: normal; color: #94a3b8;">Please refresh the page to continue auditing.</span></div>`;
    }
}

createOverlayPanel();
setInterval(injectGlobalAuditButton, 1000);
