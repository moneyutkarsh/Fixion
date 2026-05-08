# Fixion AI: The Sovereign Hallucination Auditor

**Fixion AI** is a high-performance, production-grade hallucination detection and "Self-Healing" suite. It transforms the "black box" of LLM responses into a transparent, verified, and audited intelligence stream.

---

## 🚀 Core Value Proposition

Fixion solves the "Trust Gap" in Generative AI. While modern LLMs are creative, they are often factually unreliable. Fixion acts as a real-time forensic layer that sits on top of any LLM (ChatGPT, Claude, Gemini) to verify claims, highlight lies in red, and automatically rewrite responses with verified ground truth.

---

## 🛠️ Technical Architecture

### 1. The Neural Pipeline (The Audit Flow)
Fixion uses a multi-stage asynchronous pipeline to ensure maximum speed and precision:

1.  **Atomic Claim Extraction**: Uses regex and NLP heuristics to break long AI responses into testable facts.
2.  **Parallel Evidence Retrieval**: Uses `asyncio` and `DuckDuckGo Search` to gather live web evidence for all claims simultaneously (3x speed boost).
3.  **Semantic Context Selection**: Uses `SentenceTransformers` (`all-MiniLM-L6-v2`) and Cosine Similarity to find the exact "smoking gun" chunks within large webpages.
4.  **NLI Verification**: Uses a `cross-encoder/nli-distilroberta-base` model to perform Natural Language Inference, categorizing claims as **Entailment** (True), **Contradiction** (False), or **Neutral** (Unverified).
5.  **Bayesian Scoring (v7.0)**: A proprietary weighted algorithm that calculates the "Hallucination Index" across 6 dimensions.
6.  **Self-Healing Correction**: Leverages **Gemini 1.5 Flash** or **Groq (Llama 3)** to rewrite the original response using only the verified evidence.

### 2. High-Fidelity Frontend
*   **Universal Extension**: A single Chrome extension that supports ChatGPT, Gemini, Claude, Perplexity, and DeepSeek.
*   **Intelligence Terminal**: A glassmorphic dashboard featuring live-streaming percentages and stage-based tracking.
*   **Forensic Highlighting**: Automatic red-light/green-light marking of the original AI text based on audit results.

---

## 📊 The Hallucination Scoring Engine (v7.0)

Fixion uses a sophisticated **Weighted Bayesian Heuristic** to calculate the Hallucination Index:

| Metric | Weight | Description |
| :--- | :--- | :--- |
| **Grounding** | 35% | Cosine similarity between response and search evidence. |
| **Factual Consistency** | 25% | Direct contradiction detection via NLI. |
| **Self-Consistency** | 15% | Agreement across multiple neural perspectives. |
| **Logic** | 10% | Internal consistency and keyword-based logical checks. |
| **Cross-Model Agreement** | 10% | Second-opinion audit from high-throughput models. |
| **Uncertainty** | 0.5% | Detection of "weak" or hedge language (e.g., "possibly"). |

---

## ⚡ Setup & Installation

### Backend (Python 3.10+)
1.  **Install Dependencies**:
    ```bash
    pip install fastapi uvicorn transformers sentence-transformers torch ddgs trafilatura google-genai groq python-dotenv scikit-learn
    ```
2.  **Configure Environment**:
    Create a `.env` file with your keys:
    ```env
    GEMINI_API_KEY=your_key
    GROQ_API_KEY=your_key
    ```
3.  **Run Server**:
    ```bash
    python main.py
    ```

### Frontend (Chrome Extension)
1.  Open Chrome and go to `chrome://extensions/`.
2.  Enable **Developer mode**.
3.  Click **Load unpacked** and select the `extension` folder inside `Fixion_Final`.
4.  Navigate to ChatGPT or Gemini and look for the **Audit** button in the bottom-right.

---

## 🏆 Hackathon Innovation Highlights
*   **Zero Latency**: Parallelized retrieval and local caching ensure audits are completed in seconds.
*   **Universal Bridge**: First-of-its-kind extension that works across all competitive LLM platforms.
*   **Human-Centric UX**: Transforms complex data into a simple "Hallucination %" that anyone can understand.

---
*Built for the future of reliable AI.*

