document.addEventListener("DOMContentLoaded", () => {
    const analyzeBtn = document.getElementById("analyzeBtn");
    const resultDiv = document.getElementById("result");

    analyzeBtn.addEventListener("click", () => {
        analyzeBtn.disabled = true;
        analyzeBtn.innerText = "Triggering...";
        resultDiv.innerText = "Sending request to content script...";

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || tabs.length === 0) {
                resultDiv.innerText = "Error: No active tab found.";
                analyzeBtn.disabled = false;
                analyzeBtn.innerText = "Analyze Current Page";
                return;
            }

            chrome.tabs.sendMessage(tabs[0].id, { type: "ANALYZE_PAGE" }, (response) => {
                analyzeBtn.disabled = false;
                analyzeBtn.innerText = "Analyze Current Page";
                
                if (chrome.runtime.lastError) {
                    resultDiv.innerText = "Please refresh the page to use Fixion AI.";
                    return;
                }

                if (response && response.success) {
                    resultDiv.innerText = response.message || "Analysis started on the page. Please check the overlay on your current page.";
                    resultDiv.style.color = "#10b981"; // Success green
                } else {
                    resultDiv.innerText = response?.message || "Failed to start analysis.";
                    resultDiv.style.color = "#ef4444"; // Error red
                }
            });
        });
    });
});
