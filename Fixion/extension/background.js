// Fixion AI Background Service v1.2 (Stable)
console.log("Fixion AI: [v1.2] Background Engine Ready");

// --- RELIABILITY HEARTBEAT (Permanent Connection) ---
chrome.alarms.create("keep_alive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "keep_alive") {
        console.log("Fixion: Service Worker Heartbeat (v1.2 Stable)");
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Heartbeat check
    if (request.type === "PING") {
        sendResponse({ status: "alive", version: "1.2.1" });
        return false;
    }

    if (request.type === "API_CALL") {
        const { url, method, body, isStreaming } = request;
        const targetUrl = url.replace("localhost", "127.0.0.1");

        if (isStreaming) {
            handleStreamingRequest(targetUrl, method, body, sender.tab.id);
            sendResponse({ success: true, streaming: true });
            return false;
        } else {
            fetch(targetUrl, {
                method: method || "POST",
                headers: { "Content-Type": "application/json" },
                body: body ? JSON.stringify(body) : null
            })
            .then(res => res.json())
            .then(data => sendResponse({ success: true, data }))
            .catch(err => {
                console.error("Fetch Error:", err);
                sendResponse({ success: false, error: err.message });
            });
            return true; 
        }
    }
    return false;
});

async function handleStreamingRequest(url, method, body, tabId) {
    try {
        const response = await fetch(url, {
            method: method || "POST",
            headers: { "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : null
        });

        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop(); // Keep partial line in buffer

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith("data: ")) {
                    chrome.tabs.sendMessage(tabId, { type: "STREAM_CHUNK", chunk: trimmed });
                }
            }
        }
        chrome.tabs.sendMessage(tabId, { type: "STREAM_DONE" });
    } catch (err) {
        console.error("Streaming error:", err);
        chrome.tabs.sendMessage(tabId, { type: "STREAM_ERROR", error: err.message });
    }
}
