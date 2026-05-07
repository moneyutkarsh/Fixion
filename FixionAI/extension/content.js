console.log("Fixion AI extension loaded");

const themeStyle = document.createElement("style");
themeStyle.textContent = `
    body.light-mode {
        --bg: #ffffff;
        --card: var(--card);
        --text: #111827;
        --border: var(--border);
        --accent: #4f46e5;
    }
    body.dark-mode {
        --bg: #0f172a;
        --card: #1e293b;
        --text: #e2e8f0;
        --border: #334155;
        --accent: #38bdf8;
    }
    #fixion-ai-panel, #fixion-ai-panel *, #fixion-ai-trace-drawer, #fixion-ai-trace-drawer *, #fixion-ai-comparison-modal *, #fixion-ai-analyze-btn {
        transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease, background 0.3s ease, box-shadow 0.3s ease !important;
    }
    .fx-trace-node {
        transition: transform 0.2s ease, box-shadow 0.2s ease !important;
    }
    .fx-trace-node:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0,0,0,0.1) !important;
    }
`;
document.head.appendChild(themeStyle);

const savedTheme = localStorage.getItem("fixion-theme") || "light";
document.body.classList.add(savedTheme + "-mode");

function toggleTheme() {
    const isDark = document.body.classList.contains("dark-mode");
    const newTheme = isDark ? "light" : "dark";
    document.body.classList.remove(isDark ? "dark-mode" : "light-mode");
    document.body.classList.add(newTheme + "-mode");
    localStorage.setItem("fixion-theme", newTheme);
    const btn = document.getElementById("fx-theme-toggle");
    if (btn) btn.innerText = newTheme === "dark" ? "☀️" : "🌙";
}

let latestResponse = "";
let latestElement = null;
let originalHTML = "";

const COLORS = {
    primary: "var(--accent)",
    primaryHover: "var(--accent)",
    success: "#10b981",
    warning: "#f59e0b",
    danger: "#ef4444",
    bgLight: "var(--bg)",
    bgGray: "var(--card)",
    textDark: "var(--text)",
    textMuted: "#6b7280"
};

function scanForResponses() {
    const elements = document.querySelectorAll('p, div, article, section');
    let bestEl = null;
    let bestScore = -1;

    for (let el of elements) {
        // Skip elements that contain other block-level children (they are containers)
        const hasBlockChildren = el.querySelector('div, article, section, ul, ol');
        if (hasBlockChildren) continue;

        const text = (el.innerText || "").trim();
        if (text.length < 100) continue;

        // Score by sentence density: count periods, exclamation marks, question marks
        const punctCount = (text.match(/[.!?]/g) || []).length;
        const wordCount = text.split(/\s+/).length;

        // Good AI response: has sentences (punctuation), reasonable length, not too short
        const score = punctCount * 10 + Math.min(wordCount, 150);

        if (score > bestScore) {
            bestScore = score;
            bestEl = el;
        }
    }

    if (bestEl) {
        if (latestElement !== bestEl) {
            clearHighlights();
            latestElement = bestEl;
            originalHTML = bestEl.innerHTML;
        }
        latestResponse = (bestEl.innerText || "").trim();
        console.log("[Fixion AI] Selected text block. Score:", bestScore, "Length:", latestResponse.length);
    }
}

function clearHighlights() {
    if (latestElement && originalHTML) {
        latestElement.innerHTML = originalHTML;
    }
}

function highlightClaims(nli_results) {
    if (!latestElement || !nli_results) return;
    latestElement.innerHTML = originalHTML;
    let html = latestElement.innerHTML;
    
    const unsupported = nli_results.filter(r => r.status !== "entailment").map(r => r.claim);
    unsupported.forEach(claim => {
        const escaped = claim.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'g');
        html = html.replace(regex, `<span title="Potential hallucination" style="background-color: rgba(254, 202, 202, 0.4); border-bottom: 2px dashed ${COLORS.danger}; border-radius: 3px; cursor: help; transition: all 0.2s;">$1</span>`);
    });
    latestElement.innerHTML = html;
}

function createFloatingButton() {
    const btn = document.createElement("button");
    btn.innerHTML = `<span style="margin-right: 6px;">🔍</span> Analyze AI Response`;
    btn.id = "fixion-ai-analyze-btn";
    btn.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 999999;
        padding: 12px 20px; background-color: ${COLORS.primary}; color: white;
        border: none; border-radius: 50px; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
        cursor: pointer; font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600;
        display: flex; align-items: center; transition: all 0.2s ease;
    `;
    btn.onmouseover = () => { btn.style.transform = "translateY(-2px)"; btn.style.boxShadow = "0 6px 16px rgba(79, 70, 229, 0.4)"; };
    btn.onmouseout = () => { btn.style.transform = "translateY(0)"; btn.style.boxShadow = "0 4px 12px rgba(79, 70, 229, 0.3)"; };
    
    btn.addEventListener("click", () => {
        scanForResponses();
        if (latestResponse) {
            analyzeResponse(latestResponse, btn);
        } else {
            const oldHtml = btn.innerHTML;
            btn.innerHTML = `⚠️ No text found!`;
            setTimeout(() => btn.innerHTML = oldHtml, 2000);
        }
    });
    document.body.appendChild(btn);
}

function createOverlayPanel() {
    const panel = document.createElement("div");
    panel.id = "fixion-ai-panel";
    panel.style.cssText = `
        position: fixed; top: 20px; right: 20px; width: 360px;
        background-color: ${COLORS.bgLight}; color: ${COLORS.textDark};
        border-radius: 12px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
        z-index: 1000000; font-family: 'Inter', sans-serif; font-size: 14px;
        display: none; flex-direction: column; border: 1px solid var(--border);
        opacity: 0; transform: translateY(10px); transition: opacity 0.3s ease, transform 0.3s ease;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
        display: flex; justify-content: space-between; align-items: center;
        padding: 16px; border-bottom: 1px solid var(--border); background-color: ${COLORS.bgGray};
        border-top-left-radius: 12px; border-top-right-radius: 12px;
    `;

    header.innerHTML = `
        <div style="display: flex; align-items: center;">
            <img src="${chrome.runtime.getURL('icon.svg')}" alt="Fixion AI" style="width: 28px; height: 28px; margin-right: 12px; filter: drop-shadow(0 2px 4px rgba(59, 130, 246, 0.3));">
            <div>
                <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: ${COLORS.textDark};">Fixion AI</h3>
                <div style="font-size: 10px; color: ${COLORS.textMuted}; font-weight: 600; letter-spacing: 0.5px; margin-top: 2px;">AI RELIABILITY ENGINE</div>
            </div>
        </div>
        <div style="display: flex; align-items: center;">
            <button id="fx-theme-toggle" style="background: none; border: none; font-size: 16px; cursor: pointer; margin-right: 12px;" title="Toggle Theme">${document.body.classList.contains("dark-mode") ? "☀️" : "🌙"}</button>
            <button id="fx-close-panel" style="background: none; border: none; font-size: 20px; cursor: pointer; color: ${COLORS.textMuted}; padding: 0;">✖</button>
        </div>
    `;

    panel.appendChild(header);

    const content = document.createElement("div");
    content.id = "fixion-ai-content";
    content.style.cssText = `padding: 16px; overflow-y: auto; max-height: 80vh;`;
    panel.appendChild(content);

    document.body.appendChild(panel);
    
    document.getElementById("fx-close-panel").addEventListener("click", () => {
        panel.style.opacity = "0";
        panel.style.transform = "translateY(10px)";
        setTimeout(() => panel.style.display = "none", 300);
        clearHighlights();
    });

    document.getElementById("fx-theme-toggle").addEventListener("click", toggleTheme);
}

function initStreamPanel() {
    const panel = document.getElementById("fixion-ai-panel");
    const content = document.getElementById("fixion-ai-content");
    if (!panel || !content) return;
    
    content.innerHTML = `
        <div style="display: flex; align-items: center; margin-bottom: 16px;">
            <div class="fx-spinner" style="width: 16px; height: 16px; border: 2px solid var(--border); border-top: 2px solid ${COLORS.primary}; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 10px;"></div>
            <strong style="color: ${COLORS.primary};">Analyzing Live...</strong>
        </div>
        <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
        
        <div style="display: flex; flex-direction: column; gap: 12px;">
            ${['query', 'claims', 'retrieval', 'nli', 'scoring', 'correction'].map(step => `
                <div id="fx-step-${step}" style="display: ${step === 'correction' ? 'none' : 'flex'}; align-items: center; font-size: 13px; color: ${COLORS.textMuted}; transition: all 0.2s ease;">
                    <div class="fx-status-icon" style="width: 20px; text-align: center; margin-right: 10px; font-size: 14px;">⏳</div>
                    <span class="fx-text">${step.charAt(0).toUpperCase() + step.slice(1).replace('_', ' ')}</span>
                </div>
            `).join('')}
        </div>
    `;
    
    panel.style.display = "flex";
    setTimeout(() => {
        panel.style.opacity = "1";
        panel.style.transform = "translateY(0)";
    }, 10);
}

function updateStep(stepId, status) {
    const el = document.getElementById(`fx-step-${stepId}`);
    if (!el) return;
    
    el.style.display = "flex"; 
    const icon = el.querySelector(".fx-status-icon");
    const text = el.querySelector(".fx-text");
    
    if (status === "running") {
        icon.innerHTML = `<div style="width: 12px; height: 12px; border: 2px solid var(--border); border-top: 2px solid ${COLORS.primary}; border-radius: 50%; animation: spin 1s linear infinite; display: inline-block;"></div>`;
        text.style.fontWeight = "600";
        text.style.color = COLORS.primary;
    } else if (status === "success") {
        icon.innerText = "✅";
        text.style.fontWeight = "400";
        text.style.color = COLORS.success;
    } else if (status === "warning") {
        icon.innerText = "⚠️";
        text.style.fontWeight = "400";
        text.style.color = COLORS.warning;
    } else if (status === "failure") {
        icon.innerText = "❌";
        text.style.fontWeight = "400";
        text.style.color = COLORS.danger;
    }
}

function handleStreamEvent(event) {
    const step = event.step;
    const status = event.status;
    
    if (step === "query_received") { updateStep("query", status); updateStep("claims", "running"); }
    else if (step === "claims_extracted") { updateStep("claims", status); updateStep("retrieval", "running"); }
    else if (step === "retrieval_done") { updateStep("retrieval", status); updateStep("nli", "running"); }
    else if (step === "nli_done") { updateStep("nli", status); updateStep("scoring", "running"); }
    else if (step === "scoring_done") { updateStep("scoring", status); }
    else if (step === "correction_running") { updateStep("correction", "running"); }
    else if (step === "correction_done") { updateStep("correction", status); }
    else if (step === "final") {
        updatePanel(event.data);
        if (event.data.nli_results) highlightClaims(event.data.nli_results);
    }
}

function updatePanel(data) {
    const content = document.getElementById("fixion-ai-content");
    if (!content) return;

    const reliability = data.scoring?.reliability_score || 0;
    const hallucination = data.scoring?.hallucination || 0;
    
    let statusBadge = "";
    let meterColor = COLORS.danger;
    
    const contradictionCount = data.nli_results ? data.nli_results.filter(r => r.status === "contradiction").length : 0;
    const entailmentCount = data.nli_results ? data.nli_results.filter(r => r.status === "entailment").length : 0;
    const unsupportedCount = data.nli_results ? data.nli_results.filter(r => r.status !== "entailment").length : 0;
    const totalCount = data.nli_results ? data.nli_results.length : 0;
    
    if (contradictionCount > 0) {
        statusBadge = `<span style="background: rgba(239, 68, 68, 0.1); color: #991b1b; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold;">Hallucination Detected</span>`;
    } else if (totalCount > 0 && entailmentCount > totalCount / 2) {
        statusBadge = `<span style="background: rgba(16, 185, 129, 0.1); color: #065f46; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold;">Reliable</span>`;
        meterColor = COLORS.success;
    } else {
        statusBadge = `<span style="background: rgba(245, 158, 11, 0.1); color: #92400e; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold;">Low Confidence (Insufficient Evidence)</span>`;
        meterColor = COLORS.warning;
    }

    let displayHallucination = Math.round(hallucination * 100);
    if (displayHallucination === 100 && contradictionCount < totalCount) {
        displayHallucination = 99;
    }

    let html = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h4 style="margin: 0; font-size: 14px; color: ${COLORS.textDark};">System Verdict</h4>
            ${statusBadge}
        </div>
        
        <div style="margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px;">
                <strong>Reliability Meter</strong>
                <strong>${Math.round(reliability * 100)}%</strong>
            </div>
            <div style="height: 10px; background-color: var(--border); border-radius: 5px; overflow: hidden; margin-bottom: 16px;">
                <div style="height: 100%; background-color: ${meterColor}; width: ${Math.round(reliability * 100)}%; transition: width 1s ease-in-out, box-shadow 0.3s ease; box-shadow: 0 0 12px ${meterColor}60;"></div>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px;">
            <div style="background: ${COLORS.bgGray}; padding: 12px; border-radius: 8px; border: 1px solid var(--border); text-align: center;">
                <div style="font-size: 20px; font-weight: bold; color: ${COLORS.danger};">${displayHallucination}%</div>
                <div style="font-size: 11px; color: ${COLORS.textMuted}; text-transform: uppercase; margin-top: 4px;">Hallucination</div>
            </div>
            <div style="background: ${COLORS.bgGray}; padding: 12px; border-radius: 8px; border: 1px solid var(--border); text-align: center;">
                <div style="font-size: 20px; font-weight: bold; color: ${COLORS.textDark};">${unsupportedCount} <span style="font-size: 14px; color: #9ca3af;">/ ${totalCount}</span></div>
                <div style="font-size: 11px; color: ${COLORS.textMuted}; text-transform: uppercase; margin-top: 4px;">Unsupported</div>
            </div>
        </div>
        
        <div style="background: ${COLORS.bgGray}; padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px; font-size: 13px; color: ${COLORS.textDark}; line-height: 1.5;">
            <div style="font-weight: 600; margin-bottom: 4px;">${data.scoring?.summary || "Analysis completed."}</div>
            ${data.scoring?.explanation ? `<div style="color: ${COLORS.textMuted}; font-size: 12px;">${data.scoring.explanation}</div>` : ''}
        </div>
    `;

    if (data.nli_results && data.nli_results.length > 0) {
        html += `<div style="margin-bottom: 16px;"><h4 style="margin: 0 0 8px 0; font-size: 13px; color: ${COLORS.textDark};">Analyzed Claims</h4>`;
        data.nli_results.forEach((r, idx) => {
            let badgeColor = r.status === "entailment" ? COLORS.success : (r.status === "contradiction" ? COLORS.danger : COLORS.warning);
            
            let agreementText = "No sources available";
            if (r.sources_checked > 0) {
                if (r.status === "entailment") {
                    let entails = Math.round(r.agreement_score * r.sources_checked);
                    agreementText = `Verified by ${entails} source${entails !== 1 ? 's' : ''}`;
                } else {
                    agreementText = "Low agreement across sources";
                }
            }

            html += `
                <div style="border: 1px solid var(--border); border-radius: 6px; margin-bottom: 8px; overflow: hidden; background: var(--bg);">
                    <div style="padding: 10px 12px; border-left: 3px solid ${badgeColor}; display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                        <div>
                            <div style="font-size: 12px; line-height: 1.4; margin-bottom: 4px;">${r.claim}</div>
                            <div style="font-size: 11px; font-weight: bold; color: ${r.status === 'entailment' ? COLORS.success : COLORS.warning};">${agreementText}</div>
                        </div>
                    </div>
            `;
            
            if (r.sources && r.sources.length > 0) {
                html += `
                    <div style="border-top: 1px solid var(--border); background: var(--card);">
                        <button onclick="const el = document.getElementById('fx-sources-${idx}'); el.style.display = el.style.display === 'none' ? 'block' : 'none';" style="width: 100%; padding: 6px 12px; text-align: left; background: none; border: none; font-size: 11px; color: ${COLORS.textMuted}; cursor: pointer; font-weight: 600;">
                            ▶ View Sources (${r.sources.length})
                        </button>
                        <div id="fx-sources-${idx}" style="display: none; padding: 8px 12px; border-top: 1px dashed var(--border);">
                `;
                r.sources.forEach(src => {
                    html += `
                        <div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
                            <a href="${src.url}" target="_blank" style="font-size: 11px; color: ${COLORS.primary}; text-decoration: none; word-break: break-all; font-weight: 500; display: block; margin-bottom: 4px;">🔗 ${src.url}</a>
                            <div style="font-size: 11px; color: ${COLORS.textMuted}; line-height: 1.4; background: var(--border); padding: 6px; border-radius: 4px; font-style: italic;">"...${src.snippet}..."</div>
                        </div>
                    `;
                });
                html += `</div></div>`;
            } else {
                html += `<div style="padding: 6px 12px; font-size: 11px; color: ${COLORS.textMuted}; border-top: 1px solid var(--border); background: var(--card);">No sources found</div>`;
            }
            html += `</div>`;
        });
        html += `</div>`;
    }

    if (data.correction && data.correction.improvement && reliability < 0.7) {
        html += `
            <button id="fx-compare-btn" style="width: 100%; margin-bottom: 8px; padding: 10px; background-color: ${COLORS.success}; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px; box-shadow: 0 4px 12px rgba(16,185,129,0.4); transition: all 0.2s;">
                Fix Answer
            </button>
        `;
    }

    html += `
        <button id="fx-trace-btn" style="width: 100%; padding: 10px; background: var(--bg); color: ${COLORS.textDark}; border: 1px solid #d1d5db; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px; transition: all 0.2s;">
            📊 View Execution Trace
        </button>
    `;

    content.style.opacity = "0";
    content.innerHTML = html;
    setTimeout(() => content.style.opacity = "1", 50);

    const compareBtn = document.getElementById("fx-compare-btn");
    if (compareBtn) {
        compareBtn.addEventListener("click", () => openComparison(data.correction));
    }

    const traceBtn = document.getElementById("fx-trace-btn");
    if (traceBtn && data.trace && data.trace.nodes) {
        traceBtn.addEventListener("click", () => {
            const drawer = document.getElementById("fixion-ai-trace-drawer");
            if (drawer) {
                renderTrace(data.trace.nodes);
                drawer.style.right = "0";
            }
        });
    }
}

function createTraceDrawer() {
    const drawer = document.createElement("div");
    drawer.id = "fixion-ai-trace-drawer";
    drawer.style.cssText = `
        position: fixed; top: 0; right: -450px; width: 400px; height: 100vh;
        background-color: ${COLORS.bgGray}; box-shadow: -4px 0 20px rgba(0,0,0,0.15);
        z-index: 1000002; transition: right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex; flex-direction: column; font-family: 'Inter', sans-serif;
    `;

    drawer.innerHTML = `
        <div style="padding: 20px; background: var(--bg); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center;">
                <img src="${chrome.runtime.getURL('icon.svg')}" alt="Fixion AI" style="width: 24px; height: 24px; margin-right: 12px; filter: drop-shadow(0 2px 4px rgba(59, 130, 246, 0.3));">
                <h3 style="margin: 0; font-size: 18px; color: ${COLORS.textDark}; font-weight: 800;">Execution Trace</h3>
            </div>
            <button id="fx-close-trace" style="background: none; border: none; cursor: pointer; font-size: 16px; color: ${COLORS.textMuted};">✖</button>
        </div>
        <div id="fixion-ai-trace-content" style="padding: 20px; overflow-y: auto; flex: 1;"></div>
    `;
    
    document.body.appendChild(drawer);
    document.getElementById("fx-close-trace").addEventListener("click", () => drawer.style.right = "-450px");
}

function renderTrace(nodes) {
    const content = document.getElementById("fixion-ai-trace-content");
    if (!content) return;
    content.innerHTML = ""; 
    
    nodes.forEach((node, index) => {
        let color = COLORS.success; let bgLight = "rgba(16, 185, 129, 0.15)";
        if (node.status === "warning") { color = COLORS.warning; bgLight = "rgba(245, 158, 11, 0.15)"; } 
        else if (node.status === "failure") { color = COLORS.danger; bgLight = "rgba(239, 68, 68, 0.15)"; }
        
        const scoreTag = node.score !== undefined ? `(${node.score})` : '';
        const inStr = JSON.stringify(node.input, null, 2) || "";
        const outStr = JSON.stringify(node.output, null, 2) || "";
        
        const nodeEl = document.createElement("div");
        nodeEl.className = "fx-trace-node";
        nodeEl.style.cssText = `
            margin-bottom: 16px; background: var(--bg); border: 1px solid var(--border);
            border-left: 4px solid ${color}; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); cursor: pointer;
        `;
        
        nodeEl.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" class="fx-trace-header">
                <strong style="font-size: 14px; color: ${COLORS.textDark};">${index + 1}. ${node.label || node.type}</strong>
                <span style="font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 12px; background-color: ${bgLight}; color: ${color};">
                    ${node.status.toUpperCase()} ${scoreTag}
                </span>
            </div>
            <div class="fx-trace-body" style="display: none; margin-top: 16px; font-size: 12px; border-top: 1px dashed var(--border); padding-top: 12px;">
                <div style="color: ${COLORS.textMuted}; margin-bottom: 4px; font-weight: bold;">INPUT</div>
                <div style="background: #1e293b; color: #f8fafc; padding: 10px; border-radius: 6px; max-height: 150px; overflow-y: auto; font-family: monospace; white-space: pre-wrap; word-wrap: break-word; margin-bottom: 12px; border: 1px solid var(--border);">${inStr}</div>
                <div style="color: ${COLORS.textMuted}; margin-bottom: 4px; font-weight: bold;">OUTPUT</div>
                <div style="background: #1e293b; color: #f8fafc; padding: 10px; border-radius: 6px; max-height: 150px; overflow-y: auto; font-family: monospace; white-space: pre-wrap; word-wrap: break-word; border: 1px solid var(--border);">${outStr}</div>
            </div>
        `;
        
        nodeEl.querySelector(".fx-trace-header").addEventListener("click", () => {
            const body = nodeEl.querySelector(".fx-trace-body");
            body.style.display = body.style.display === "none" ? "block" : "none";
        });
        content.appendChild(nodeEl);
    });
}

function createComparisonModal() {
    const modal = document.createElement("div");
    modal.id = "fixion-ai-comparison-modal";
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background-color: rgba(17, 24, 39, 0.7); backdrop-filter: blur(8px);
        z-index: 1000005; display: none; justify-content: center; align-items: center;
        font-family: 'Inter', sans-serif; opacity: 0; transition: opacity 0.3s ease;
    `;

    modal.innerHTML = `
        <div style="background: var(--bg); width: 90%; max-width: 1200px; max-height: 90vh; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); display: flex; flex-direction: column; overflow: hidden; transform: scale(0.95); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);" id="fx-modal-card">
            <div style="padding: 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
                <h2 style="margin: 0; font-size: 24px; color: ${COLORS.textDark};">Resolution Engine</h2>
                <button id="fx-close-compare" style="background: none; border: none; cursor: pointer; font-size: 24px; color: ${COLORS.textMuted};">&times;</button>
            </div>
            
            <div id="fx-comparison-summary" style="padding: 16px 24px; background: rgba(16, 185, 129, 0.15); color: ${COLORS.success}; font-weight: 600; font-size: 15px; border-bottom: 1px solid var(--border); display: flex; align-items: center;">
                <span style="font-size: 20px; margin-right: 12px;">✨</span> <span></span>
            </div>
            
            <div style="display: flex; flex-direction: column; flex: 1; overflow: hidden;">
                <div style="padding: 16px 24px; background-color: var(--card); border-bottom: 1px solid var(--border); display: flex; justify-content: center;">
                    <div style="display: flex; background: var(--border); border-radius: 8px; padding: 4px;">
                        <button id="fx-toggle-original" style="padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; background: transparent; color: ${COLORS.textMuted}; transition: all 0.2s;">Original</button>
                        <button id="fx-toggle-fixed" style="padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; background: var(--bg); color: ${COLORS.textDark}; box-shadow: 0 1px 3px rgba(0,0,0,0.1); transition: all 0.2s;">Fixed</button>
                    </div>
                </div>
                <div style="flex: 1; padding: 32px; overflow-y: auto; background: var(--bg);">
                    <div id="fx-compare-left" style="display: none; line-height: 1.8; color: ${COLORS.textDark}; font-size: 16px; white-space: pre-wrap;"></div>
                    <div id="fx-compare-right" style="display: block; line-height: 1.8; color: ${COLORS.textDark}; font-size: 16px; white-space: pre-wrap;"></div>
                </div>
            </div>
            
            <div style="padding: 24px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; background: var(--bg);">
                <button id="fx-replace-btn-cta" style="padding: 14px 28px; background-color: ${COLORS.success}; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(16,185,129,0.4); transition: all 0.2s;">
                    Apply Correction
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    document.getElementById("fx-close-compare").addEventListener("click", () => {
        modal.style.opacity = "0";
        document.getElementById("fx-modal-card").style.transform = "scale(0.95)";
        setTimeout(() => modal.style.display = "none", 300);
    });

    const toggleOrig = document.getElementById("fx-toggle-original");
    const toggleFixed = document.getElementById("fx-toggle-fixed");
    const leftView = document.getElementById("fx-compare-left");
    const rightView = document.getElementById("fx-compare-right");

    toggleOrig.addEventListener("click", () => {
        leftView.style.display = "block";
        rightView.style.display = "none";
        toggleOrig.style.background = "white";
        toggleOrig.style.color = COLORS.textDark;
        toggleOrig.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
        toggleFixed.style.background = "transparent";
        toggleFixed.style.color = COLORS.textMuted;
        toggleFixed.style.boxShadow = "none";
    });

    toggleFixed.addEventListener("click", () => {
        leftView.style.display = "none";
        rightView.style.display = "block";
        toggleFixed.style.background = "white";
        toggleFixed.style.color = COLORS.textDark;
        toggleFixed.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
        toggleOrig.style.background = "transparent";
        toggleOrig.style.color = COLORS.textMuted;
        toggleOrig.style.boxShadow = "none";
    });
}

function openComparison(correction) {
    const modal = document.getElementById("fixion-ai-comparison-modal");
    if (!modal) return;
    
    const unsupported = correction.unsupported_claims || [];
    modal.querySelector("#fx-comparison-summary span:nth-child(2)").innerText = `${unsupported.length} hallucinated claims surgically removed. Accuracy restored.`;
    
    document.getElementById("fx-compare-left").innerHTML = highlightOriginalText(correction.original_response, unsupported);
    document.getElementById("fx-compare-right").innerHTML = highlightCorrectedText(correction.original_response, correction.corrected_response);
    
    document.getElementById("fx-replace-btn-cta").onclick = () => {
        if (latestElement) {
            latestElement.innerText = correction.corrected_response;
            latestElement.style.border = `2px solid ${COLORS.success}`;
            latestElement.style.padding = "16px";
            latestElement.style.borderRadius = "12px";
            latestElement.style.backgroundColor = "#ecfdf5";
            latestElement.style.transition = "all 0.5s ease";
            
            const badge = document.createElement("div");
            badge.innerHTML = "✨ Verified by Fixion AI";
            badge.style.cssText = `
                display: inline-block; margin-bottom: 10px; padding: 4px 10px; 
                background: ${COLORS.success}; color: white; border-radius: 20px; 
                font-size: 12px; font-weight: bold; font-family: sans-serif;
            `;
            latestElement.insertBefore(badge, latestElement.firstChild);
            
            document.getElementById("fx-close-compare").click();
        }
    };
    
    modal.style.display = "flex";
    setTimeout(() => {
        modal.style.opacity = "1";
        document.getElementById("fx-modal-card").style.transform = "scale(1)";
    }, 10);
}

function highlightOriginalText(original, unsupportedClaims) {
    let resultHTML = original;
    unsupportedClaims.forEach(claim => {
        const escaped = claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'gi');
        resultHTML = resultHTML.replace(regex, `<span style="background: rgba(239, 68, 68, 0.1); color: #b91c1c; text-decoration: line-through; padding: 2px 4px; border-radius: 4px;">$1</span>`);
    });
    return resultHTML;
}

function highlightCorrectedText(original, corrected) {
    const origSentences = original.match(/[^.!?]+[.!?]+/g) || [original];
    const corrSentences = corrected.match(/[^.!?]+[.!?]+/g) || [corrected];
    
    let resultHTML = "";
    corrSentences.forEach(s => {
        let isNew = !origSentences.some(os => os.trim() === s.trim());
        if (isNew) {
            resultHTML += `<span style="background: rgba(16, 185, 129, 0.1); color: #065f46; border-bottom: 2px solid ${COLORS.success}; padding: 2px 0;">${s}</span> `;
        } else {
            resultHTML += s + " ";
        }
    });
    return resultHTML || corrected;
}

async function analyzeResponse(text, btn) {
    let finalData = null;
    const originalHTML = btn ? btn.innerHTML : "";
    
    if (btn) {
        btn.innerHTML = `<div style="width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top: 2px solid white; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px;"></div> Analyzing...`;
        btn.disabled = true;
        btn.style.opacity = "0.9";
        btn.style.cursor = "wait";
    }
    
    initStreamPanel();

    try {
        // Turn off demo mode so real live AI inference runs
        const USE_DEMO_MODE = false; 
        
        const response = await fetch("http://127.0.0.1:8000/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: "unknown", response: text, demo_mode: USE_DEMO_MODE })
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            let lines = buffer.split('\n\n');
            buffer = lines.pop(); 
            
            for (let line of lines) {
                if (line.startsWith("data: ")) {
                    try {
                        const eventData = JSON.parse(line.substring(6));
                        handleStreamEvent(eventData);
                        if (eventData.step === "final") {
                            finalData = eventData.data;
                        }
                    } catch(e) {}
                }
            }
        }
        
        if (btn) {
            btn.innerHTML = `<span style="margin-right: 6px;">✨</span> Complete`;
            setTimeout(() => btn.innerHTML = originalHTML, 3000);
        }

    } catch (error) {
        console.error("Fixion AI API Error:", error);
        if (btn) {
            btn.innerHTML = `⚠️ Error`;
            setTimeout(() => btn.innerHTML = originalHTML, 3000);
        }
        
        const content = document.getElementById("fixion-ai-content");
        if(content) content.innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <div style="font-size: 32px; margin-bottom: 12px;">🔌</div>
                <div style="color: ${COLORS.danger}; font-weight: bold; margin-bottom: 8px;">Connection Failed</div>
                <div style="color: ${COLORS.textMuted}; font-size: 13px;">Ensure your FastAPI backend is running on port 8000.</div>
                <button onclick="document.getElementById('fx-close-panel').click()" style="margin-top: 16px; padding: 8px 16px; background: ${COLORS.bgGray}; border: 1px solid #d1d5db; border-radius: 6px; cursor: pointer; color: ${COLORS.textDark}; font-weight: bold;">Retry</button>
            </div>
        `;
        throw error;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = "1";
            btn.style.cursor = "pointer";
        }
    }
    
    return finalData;
}

// Initialize on load
createFloatingButton();
createOverlayPanel();
createTraceDrawer();
createComparisonModal();

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "ANALYZE_PAGE") {
        console.log("[Fixion AI] Received ANALYZE_PAGE message from popup");
        
        // Extract visible text from page
        scanForResponses();
        
        if (latestResponse) {
            console.log("[Fixion AI] Extracted visible text. Length:", latestResponse.length);
            console.log("[Fixion AI] Sending POST request to backend...");
            
            const btn = document.getElementById("fixion-ai-analyze-btn");
            
            // Execute the API call
            analyzeResponse(latestResponse, btn)
                .then(finalData => {
                    console.log("[Fixion AI] Analysis complete. Returning API response to popup.");
                    sendResponse({ success: true, message: "Analysis complete!", data: finalData });
                })
                .catch(err => {
                    console.error("[Fixion AI] Backend communication failed.", err);
                    sendResponse({ success: false, message: "Failed to reach backend API." });
                });
        } else {
            console.warn("[Fixion AI] No sufficient text blocks found on the page.");
            sendResponse({ success: false, message: "No visible text blocks found on this page." });
        }
        
        return true; // Keep message channel open for async sendResponse
    }
});
