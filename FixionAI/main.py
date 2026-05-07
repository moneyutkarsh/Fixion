from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from pydantic import BaseModel
import re
from duckduckgo_search import DDGS
from trafilatura import fetch_url, extract
from transformers import pipeline
import json
import urllib.request
import time
import os
import logging
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("FixionAI")

# ─── Configuration from .env ─────────────────────────────────────────────────
NLI_MODEL_NAME = os.environ.get("NLI_MODEL", "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli")
CORRECTION_MODEL = os.environ.get("CORRECTION_MODEL", "llama3")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/generate")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
BACKEND_HOST = os.environ.get("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.environ.get("BACKEND_PORT", "8000"))
DEBUG = os.environ.get("DEBUG", "False").lower() == "true"

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files (like trace_viewer.html)
app.mount("/static", StaticFiles(directory="."), name="static")
# Optional: mount extension folder if needed
app.mount("/extension", StaticFiles(directory="extension"), name="extension")

@app.get("/trace_viewer.html")
async def get_trace_viewer():
    from fastapi.responses import FileResponse
    return FileResponse("trace_viewer.html")


@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/test-cases")
async def get_test_cases():
    return [
        {
            "id": 1,
            "type": "factual",
            "query": "Who was the first president of the United States?",
            "response": "George Washington was the first president of the United States. He took office in 1789."
        },
        {
            "id": 2,
            "type": "hallucination",
            "query": "What is the capital of France?",
            "response": "The capital of France is London. The Eiffel Tower was built there in 2015 by Elon Musk."
        },
        {
            "id": 3,
            "type": "uncertain_opinion",
            "query": "What is the best movie of all time?",
            "response": "The best movie of all time is definitely The Matrix. It has the most profound philosophical message ever recorded."
        }
    ]

# Load NLI model globally
nli_pipeline = pipeline("text-classification", model=NLI_MODEL_NAME)

# ─── TASK 1: Stopwords + Claim-Aware Chunking ────────────────────────────────

STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "in", "on", "at", "to", "for", "of", "with", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then",
    "once", "and", "but", "or", "nor", "not", "so", "yet", "both",
    "either", "neither", "each", "every", "all", "any", "few", "more",
    "most", "other", "some", "such", "no", "only", "own", "same",
    "than", "too", "very", "just", "because", "if", "when", "where",
    "how", "what", "which", "who", "whom", "this", "that", "these",
    "those", "it", "its", "he", "she", "they", "them", "we", "us",
    "i", "me", "my", "your", "his", "her", "their", "our"
}

def extract_relevant_chunk(full_text: str, claim: str, window_size: int = 2, max_chars: int = 1000) -> str:
    """Extract the most relevant chunk of text around the best-matching sentence for a claim."""
    sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', full_text) if s.strip()]

    if not sentences:
        return full_text[:max_chars]

    claim_words = {w.lower() for w in re.findall(r'\w+', claim)} - STOPWORDS

    if not claim_words:
        return full_text[:max_chars]

    best_idx = 0
    best_score = -1

    for idx, sent in enumerate(sentences):
        sent_words = {w.lower() for w in re.findall(r'\w+', sent)} - STOPWORDS
        if not sent_words:
            continue
        overlap = len(claim_words & sent_words)
        score = overlap / len(claim_words)
        if score > best_score:
            best_score = score
            best_idx = idx

    if best_score < 0.15:
        logger.info(f"[CHUNK] No good match (best={best_score:.2f}), using first {max_chars} chars")
        return full_text[:max_chars]

    start = max(0, best_idx - window_size)
    end = min(len(sentences), best_idx + window_size + 1)
    chunk = " ".join(sentences[start:end])

    if len(chunk) > max_chars:
        chunk = chunk[:max_chars]

    logger.info(f"[CHUNK] Best match at sentence {best_idx} (score={best_score:.2f}), window [{start}:{end}]")
    return chunk

# ─── Core Functions ──────────────────────────────────────────────────────────

def extract_claims(text: str):
    sentences = [s.strip() for s in re.split(r'[.!?]', text) if s.strip()]
    claims = [s for s in sentences if len(s.split()) >= 5]
    logger.info(f"[CLAIMS] Extracted {len(claims)} claims")
    return claims

def get_evidence(claim: str):
    # Simple web search using duckduckgo_search
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(claim, max_results=5))
            logger.info(f"[SEARCH] {len(results)} results for claim")
    except Exception:
        results = []
        logger.info(f"[SEARCH] 0 results for claim (error)")
        
    # Prefer high quality domains
    def domain_score(url):
        url_lower = url.lower()
        if "wikipedia.org" in url_lower: return 3
        if ".gov" in url_lower or ".edu" in url_lower: return 2
        if "docs." in url_lower or "developer." in url_lower: return 1
        return 0
        
    results = sorted(results, key=lambda x: domain_score(x.get("href", "")), reverse=True)
    
    evidence_list = []
    
    for r in results:
        if len(evidence_list) >= 3:
            break

        title = r.get("title", "")
        url = r.get("href", "")
        extracted_text = ""

        logger.info(f"[DEBUG] Trying URL: {url}")

        try:
            downloaded = fetch_url(url)

            if not downloaded:
                logger.info(f"[DEBUG] fetch_url FAILED for {url}")
                continue

            logger.info(f"[DEBUG] fetch_url SUCCESS for {url}")

            text = extract(
                downloaded,
                include_comments=False,
                include_links=False,
            )

            if not text:
                logger.info(f"[DEBUG] trafilatura extract FAILED for {url}")
                continue

            extracted_text = text.strip()

            logger.info(f"[DEBUG] Raw Extracted Length: {len(extracted_text)}")

            if len(extracted_text) < 50:
                logger.info(f"[CONTENT] Skipping short text from {url}")
                continue

            # Store full text for per-claim re-chunking, and a default truncation
            evidence_list.append({
                "title": title,
                "url": url,
                "full_text": extracted_text,
                "extracted_text": extracted_text[:1000]
            })

            logger.info(f"[SUCCESS] Added evidence from {url}")

        except Exception as e:
            logger.info(f"[ERROR] {url}: {e}")

    return evidence_list

def compute_nli_status(claim: str, evidence_list: list):
    if not evidence_list:
        return "neutral", 0.0, "retrieval_failure", "", 0.0, 0

    top_texts = [ev["extracted_text"] for ev in evidence_list if ev.get("extracted_text")]
    top_texts = top_texts[:3]

    if not top_texts:
        return "neutral", 0.0, "retrieval_failure", "", 0.0, 0

    labels = []


    LABEL_MAP = {
        "LABEL_0": "contradiction",
        "LABEL_1": "neutral",
        "LABEL_2": "entailment"
    }

    for text in top_texts:
        result = nli_pipeline(
            f"{text} [SEP] {claim}"
        )
        
        print("NLI RESULT:", result)  

        if isinstance(result, list):
            result = result[0]
        
        raw_label = result["label"]


        label = LABEL_MAP.get(raw_label, raw_label).lower()
        score = result["score"]

        labels.append((label, score, text))

    entailments = [x for x in labels if "entail" in x[0]]
    contradictions = [x for x in labels if "contrad" in x[0]]
    neutrals = [x for x in labels if "neutral" in x[0]]

    sources_checked = len(labels)
    agreement_score = len(entailments) / sources_checked if sources_checked else 0.0

    # ROOT CAUSE DIAGNOSIS LOGIC
    if contradictions:
        return (
            "contradiction",
            contradictions[0][1],
            "llm_hallucination",
            contradictions[0][2],
            agreement_score,
            sources_checked
        )

    if len(entailments) >= 2:
        return (
            "entailment",
            entailments[0][1],
            None,
            entailments[0][2],
            agreement_score,
            sources_checked
        )

    if len(entailments) == 1 and len(neutrals) >= 1:
        return (
            "neutral",
            entailments[0][1],
            "weak_grounding",
            entailments[0][2],
            agreement_score,
            sources_checked
        )

    if len(neutrals) == sources_checked:
        return (
            "neutral",
            neutrals[0][1],
            "insufficient_evidence",
            neutrals[0][2],
            agreement_score,
            sources_checked
        )

    return (
        "neutral",
        0.0,
        "mixed_evidence",
        "",
        agreement_score,
        sources_checked
    )

# ─── TASK 3: Ollama Hardening + Gemini Fallback ─────────────────────────────

def is_ollama_available() -> bool:
    """Check if Ollama is running and responsive."""
    try:
        ollama_base = OLLAMA_URL.rsplit('/', 2)[0]  # extract base URL
        req = urllib.request.Request(f"{ollama_base}/api/tags")
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status == 200
    except Exception:
        return False

def generate_with_ollama(prompt: str, max_retries: int = 2) -> dict:
    """Try to generate a response using Ollama with retry logic."""
    if not is_ollama_available():
        logger.info("[OLLAMA] Not available, skipping")
        return {"text": "", "source": "ollama", "success": False}

    url = OLLAMA_URL
    data = {
        "model": CORRECTION_MODEL,
        "prompt": prompt,
        "stream": False
    }

    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(data).encode('utf-8'),
                headers={'Content-Type': 'application/json'}
            )
            with urllib.request.urlopen(req, timeout=45) as response:
                result = json.loads(response.read().decode('utf-8'))
                text = result.get("response", "")
                if text:
                    logger.info(f"[OLLAMA] Success on attempt {attempt + 1}")
                    return {"text": text, "source": "ollama", "success": True}
        except Exception as e:
            logger.info(f"[OLLAMA] Attempt {attempt + 1} failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 * (attempt + 1))

    return {"text": "", "source": "ollama", "success": False}

def generate_with_gemini(prompt: str) -> dict:
    """Fallback: generate a response using Gemini API via urllib."""
    api_key = GEMINI_API_KEY
    if not api_key:
        logger.info("[GEMINI] No GEMINI_API_KEY set, skipping fallback")
        return {"text": "", "source": "gemini", "success": False}

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
    data = {
        "contents": [{"parts": [{"text": prompt}]}]
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(data).encode('utf-8'),
            headers={'Content-Type': 'application/json'}
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode('utf-8'))
            text = result.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
            if text:
                logger.info("[GEMINI] Fallback success")
                return {"text": text, "source": "gemini", "success": True}
    except Exception as e:
        logger.info(f"[GEMINI] Fallback failed: {e}")

    return {"text": "", "source": "gemini", "success": False}

def generate_corrected_response(query: str, verified_context: list) -> dict:
    """Generate a corrected response using Ollama (primary) or Gemini (fallback)."""
    context_str = "\n\n".join(verified_context)
    if not context_str:
        context_str = "No verified context available."
        
    prompt = f"Answer the query using ONLY verified context. Be concise and factual.\n\nContext:\n{context_str}\n\nQuery:\n{query}"

    # Try Ollama first
    result = generate_with_ollama(prompt)
    if result["success"]:
        return result

    # Fallback to Gemini
    logger.info("[CORRECTION] Ollama failed, trying Gemini fallback...")
    result = generate_with_gemini(prompt)
    if result["success"]:
        return result

    # Both failed
    logger.info("[CORRECTION] All correction backends failed")
    return {
        "text": "Correction unavailable — both Ollama and Gemini backends failed.",
        "source": "error",
        "success": False
    }

# ─── Request Model & Main Endpoint ──────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    query: str
    response: str
    demo_mode: bool = False

@app.post("/analyze")
async def analyze(request: AnalyzeRequest):
    def event_stream():
        start_time = time.time()
        
        if request.demo_mode:
            # Consistent, fast mock data for demo
            yield f"data: {json.dumps({'step': 'query_received', 'status': 'success', 'data': {'query': request.query}})}\n\n"
            time.sleep(0.5)
            yield f"data: {json.dumps({'step': 'claims_extracted', 'status': 'success', 'data': {}})}\n\n"
            time.sleep(0.5)
            yield f"data: {json.dumps({'step': 'retrieval_done', 'status': 'success', 'data': {}})}\n\n"
            time.sleep(0.5)
            yield f"data: {json.dumps({'step': 'nli_done', 'status': 'failure', 'data': {}})}\n\n"
            time.sleep(0.5)
            
            scoring = {
                "reliability_score": 0.45,
                "hallucination": 0.55,
                "summary": "Low reliability. Hallucinated claims detected."
            }
            yield f"data: {json.dumps({'step': 'scoring_done', 'status': 'failure', 'data': scoring})}\n\n"
            time.sleep(0.5)
            
            correction = {
                "original_response": request.response,
                "corrected_response": "The capital of France is Paris. The Eiffel Tower is located there.",
                "improvement": True,
                "unsupported_claims": ["London", "built by Elon Musk"]
            }
            yield f"data: {json.dumps({'step': 'correction_done', 'status': 'success', 'data': correction})}\n\n"
            
            nli_results = [
                {"claim": "The capital of France is London", "status": "contradiction", "root_cause": "llm_hallucination"},
                {"claim": "Eiffel Tower built by Elon Musk", "status": "contradiction", "root_cause": "llm_hallucination"}
            ]
            
            response_data = {
                "scoring": scoring,
                "correction": correction,
                "nli_results": nli_results,
                "root_cause_distribution": {"llm_hallucination": 1.0},
                "trace": {"nodes": [], "edges": []} # Empty trace for demo
            }
            yield f"data: {json.dumps({'step': 'final', 'status': 'success', 'data': response_data})}\n\n"
            return

        search_time_total = 0.0
        nli_time_total = 0.0
        
        nodes = []
        edges = []
        
        def add_node(node_id, node_type, input_data, output_data, label, status="success", score=None):
            node = {
                "id": node_id,
                "type": node_type,
                "label": label,
                "status": status,
                "input": input_data,
                "output": output_data,
                "timestamp": time.time()
            }
            if score is not None:
                node["score"] = score
            nodes.append(node)
            
        def add_edge(from_id, to_id):
            edges.append({"from": from_id, "to": to_id})

        yield f"data: {json.dumps({'step': 'query_received', 'status': 'success', 'data': {'query': request.query}})}\n\n"
        add_node("node_query", "query", request.query, request.response, "User Query")

        claims = extract_claims(request.response)
        add_node("node_claims", "claim_extraction", request.response, claims, "Claim Extraction")
        add_edge("node_query", "node_claims")
        yield f"data: {json.dumps({'step': 'claims_extracted', 'status': 'success', 'data': {'claims': claims}})}\n\n"
        
        nli_results = []
        cause_counts = {}
        verified_context = []
        nli_node_ids = []
        
        # -----------------------------
        # GLOBAL RETRIEVAL (RUN ONCE)
        # -----------------------------
       

        t0_search = time.time()
        query = request.query
        ev = get_evidence(query)
        search_time_total += (time.time() - t0_search)

        # -----------------------------
        # PROCESS EACH CLAIM
        # -----------------------------
        for idx, claim in enumerate(claims):

            retrieval_id = f"retrieval_{idx}"
            evidence_id = f"evidence_{idx}"
            nli_id = f"nli_{idx}"

            retrieval_status = "success" if ev else "warning"
            
            add_node(retrieval_id, "retrieval", query, "Web search executed", f"Web Retrieval {idx+1}", status=retrieval_status)
            add_edge("node_claims", retrieval_id)
            yield f"data: {json.dumps({'step': 'retrieval_done', 'status': retrieval_status, 'data': {'claim': claim}})}\n\n"
            
            add_node(evidence_id, "evidence", "Web search results", ev, f"Evidence {idx+1}", status=retrieval_status)
            add_edge(retrieval_id, evidence_id)
            yield f"data: {json.dumps({'step': 'evidence_processed', 'status': retrieval_status, 'data': {'claim': claim}})}\n\n"
            
            # ─── TASK 1: Re-chunk evidence for this specific claim ───
            claim_evidence = []
            for e in ev:
                full = e.get("full_text", e.get("extracted_text", ""))
                chunked = extract_relevant_chunk(full, claim)
                claim_evidence.append({
                    **e,
                    "extracted_text": chunked
                })

            t0_nli = time.time()
            status_label, score, root_cause, best_text, agreement_score, sources_checked = compute_nli_status(claim, claim_evidence)
            nli_time_total += (time.time() - t0_nli)
            
            if root_cause:
                cause_counts[root_cause] = cause_counts.get(root_cause, 0) + 1
                
            if status_label == "entailment" and best_text:
                verified_context.append(best_text)
                
            sources = []

            if claim_evidence:
                for e in claim_evidence[:3]:
                    text = e.get("extracted_text", "")

                    if len(text) > 150:
                        text = text[:147] + "..."

                    sources.append({
                        "url": e.get("url", ""),
                        "snippet": text
                    })

            nli_result = {
                "claim": claim,
                "status": status_label,
                "root_cause": root_cause,
                "confidence": round(score, 2),
                "agreement_score": round(agreement_score, 2),
                "sources_checked": sources_checked,
                "evidence": claim_evidence,
                "sources": sources
            }
            nli_results.append(nli_result)
            
            nli_node_status = "success"
            if status_label == "contradiction":
                nli_node_status = "failure"
            elif status_label == "neutral":
                nli_node_status = "warning"
                
            add_node(nli_id, "nli", {"claim": claim, "evidence": claim_evidence}, nli_result, f"NLI Verification {idx+1}", status=nli_node_status, score=round(score, 2))
            add_edge(evidence_id, nli_id)
            nli_node_ids.append(nli_id)
            yield f"data: {json.dumps({'step': 'nli_done', 'status': nli_node_status, 'data': nli_result})}\n\n"
            
        total_claims = len(claims)
        distribution = {}
        if total_claims > 0:
            for k, v in cause_counts.items():
                distribution[k] = round(v / total_claims, 2)
                
        hallucination_score_distribution = distribution.get("llm_hallucination", 0.0)
        correction = None

        # ─── TASK 2: Weighted Reliability Scoring ────────────────────
        if total_claims > 0:
            entailment_count = sum(1 for r in nli_results if r["status"] == "entailment")
            retrieval_failure_count = sum(1 for r in nli_results if r["root_cause"] == "retrieval_failure")
            contradiction_count = sum(1 for r in nli_results if r["status"] == "contradiction")
            neutral_count = sum(1 for r in nli_results if r["status"] == "neutral")
            
            faithfulness = entailment_count / total_claims
            grounding = (total_claims - retrieval_failure_count) / total_claims
            hallucination = contradiction_count / total_claims
            
            # Weighted reliability score using NLI confidence
            weighted_sum = 0.0
            for r in nli_results:
                if r["status"] == "entailment":
                    weighted_sum += r["confidence"]
                elif r["status"] == "contradiction":
                    weighted_sum -= r["confidence"]
                else:  # neutral — benefit of the doubt
                    weighted_sum += 0.3

            reliability_score = max(0.0, min(1.0, weighted_sum / total_claims))
        else:
            faithfulness = 0.0
            grounding = 0.0
            hallucination = 0.0
            reliability_score = 0.0
            neutral_count = 0
            retrieval_failure_count = 0
            contradiction_count = 0
            entailment_count = 0

        # Nuanced summary thresholds
        if reliability_score >= 0.75 and contradiction_count == 0:
            summary = "Reliable"
        elif contradiction_count > 0 and contradiction_count >= total_claims * 0.5:
            summary = "Hallucination Detected"
        elif contradiction_count > 0:
            summary = "Partially Unreliable"
        else:
            summary = "Low Confidence (Insufficient Evidence)"

        # Nuanced explanation
        if contradiction_count > 0 and contradiction_count >= total_claims * 0.5:
            explanation = f"{contradiction_count} of {total_claims} claims contradict verified sources. Major reliability concerns."
        elif contradiction_count > 0:
            explanation = f"{contradiction_count} of {total_claims} claims contradict sources, but most claims are supported."
        elif entailment_count == total_claims:
            explanation = "All claims are well-supported by reliable sources."
        elif entailment_count > 0:
            explanation = f"{entailment_count} of {total_claims} claims verified. Some claims lack sufficient evidence."
        elif retrieval_failure_count > 0:
            explanation = "Relevant sources were not found for some claims."
        else:
            explanation = "Low confidence due to insufficient reliable sources."

        scoring = {
            "reliability_score": round(reliability_score, 2),
            "faithfulness": round(faithfulness, 2),
            "grounding": round(grounding, 2),
            "hallucination": round(hallucination, 2),
            "summary": summary,
            "explanation": explanation
        }
        
        # Better status thresholds
        scoring_status = "success"
        if reliability_score < 0.4:
            scoring_status = "failure"
        elif reliability_score < 0.75:
            scoring_status = "warning"
            
        add_node("node_scoring", "scoring", nli_results, scoring, "Final Scoring", status=scoring_status, score=round(reliability_score, 2))
        for nli_id in nli_node_ids:
            add_edge(nli_id, "node_scoring")
            
        yield f"data: {json.dumps({'step': 'scoring_done', 'status': scoring_status, 'data': scoring})}\n\n"

        # ─── TASK 3: Correction with dict return ─────────────────────
        unsupported_count_total = contradiction_count + neutral_count + retrieval_failure_count
        if unsupported_count_total > 0:
            yield f"data: {json.dumps({'step': 'correction_running', 'status': 'running', 'data': {}})}\n\n"
            correction_result = generate_corrected_response(request.query, verified_context)
            improvement = correction_result["success"]
            unsupported_claims_list = [r["claim"] for r in nli_results if r["status"] != "entailment"]
            correction = {
                "original_response": request.response,
                "corrected_response": correction_result["text"],
                "improvement": improvement,
                "correction_source": correction_result["source"],
                "unsupported_claims": unsupported_claims_list
            }
            correction_status = "success" if improvement else "failure"
            add_node("node_correction", "correction", verified_context, correction, "Self-Healing Correction", status=correction_status)
            add_edge("node_scoring", "node_correction")
            yield f"data: {json.dumps({'step': 'correction_done', 'status': correction_status, 'data': correction})}\n\n"
            
        latency = {
            "total": round(time.time() - start_time, 2),
            "search": round(search_time_total, 2),
            "nli": round(nli_time_total, 2)
        }
                
        response_data = {
            "message": "API working",
            "query": request.query,
            "response": request.response,
            "claims": claims,
            "nli_results": nli_results,
            "root_cause_distribution": distribution,
            "scoring": scoring,
            "latency": latency,
            "trace": {
                "nodes": nodes,
                "edges": edges
            }
        }
        
        if correction:
            response_data["correction"] = correction
            
        yield f"data: {json.dumps({'step': 'final', 'status': 'success', 'data': response_data})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=BACKEND_HOST, port=BACKEND_PORT)
