from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import re
from duckduckgo_search import DDGS
from trafilatura import fetch_url, extract
from transformers import pipeline
import json
import urllib.request
import time
import logging

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("FixionAI")

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
nli_pipeline = pipeline("text-classification", model="MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli")
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
        try:
            downloaded = fetch_url(url, timeout=10)
            if downloaded:
                text = extract(downloaded, include_comments=False, include_links=False, output='text')
                if text:
                    extracted_text = text.strip()
                    if len(extracted_text) < 200:
                        logger.info(f"[CONTENT] Skipping {url}, only {len(extracted_text)} chars (too short)")
                        continue
                    extracted_text = extracted_text[:1000].strip()
                    logger.info(f"[CONTENT] Extracted {len(extracted_text)} chars from {url}")
        except Exception as e:
            logger.info(f"[CONTENT] Extracted error for {url}: {e}")
            pass
            
        if extracted_text:
            evidence_list.append({"title": title, "url": url, "extracted_text": extracted_text})
            
    return evidence_list

def compute_nli_status(claim: str, evidence_list: list):
    # If there is no evidence, consider claim neutral/unsupported
    if not evidence_list:
        return "neutral", 0.0, "retrieval_failure", "", 0.0, 0
    
    top_texts = [ev["extracted_text"] for ev in evidence_list if ev.get("extracted_text")]
    top_texts = top_texts[:3] # Compare with top 3 extracted texts
    
    if not top_texts:
        return "neutral", 0.0, "retrieval_failure", "", 0.0, 0
        
    labels = []
    
    for text in top_texts:
        # text is the premise, claim is the hypothesis
        result = nli_pipeline(claim, text)
        if isinstance(result, list):
            result = result[0]
        label = result['label'].lower()
        score = result['score']
        labels.append((label, score, text))
        
    entailments = [x for x in labels if x[0] == "entailment"]
    contradictions = [x for x in labels if x[0] == "contradiction"]
    neutrals = [x for x in labels if x[0] == "neutral"]
    
    sources_checked = len(labels)
    agreement_score = len(entailments) / sources_checked if sources_checked > 0 else 0.0
    
    # Decision logic
    if len(contradictions) >= 1:
        best_label = "contradiction"
        root_cause = "llm_hallucination"
        best_text = contradictions[0][2]
        best_confidence = contradictions[0][1]
    elif len(entailments) >= 2:
        best_label = "entailment"
        root_cause = None
        best_text = entailments[0][2]
        best_confidence = entailments[0][1]
    elif len(neutrals) == sources_checked:
        best_label = "neutral"
        root_cause = "uncertain"
        best_text = neutrals[0][2]
        best_confidence = neutrals[0][1]
    elif len(entailments) == 1:
        # Fallback if only 1 entailment and no contradictions (e.g. 1 entailment, 2 neutral)
        best_label = "entailment"
        root_cause = "weak_agreement"
        best_text = entailments[0][2]
        best_confidence = entailments[0][1]
    else:
        # Fallback
        best_label = "neutral"
        root_cause = "mixed_evidence"
        best_text = labels[0][2]
        best_confidence = labels[0][1]
        
    logger.info(f"[NLI] {best_label} ({round(best_confidence, 2)}) - Agreement: {round(agreement_score, 2)}")
    return best_label, best_confidence, root_cause, best_text, agreement_score, sources_checked

def generate_corrected_response(query: str, verified_context: list):
    context_str = "\n\n".join(verified_context)
    if not context_str:
        context_str = "No verified context available."
        
    prompt = f"Answer the query using ONLY verified context\n\nContext:\n{context_str}\n\nQuery:\n{query}"
    
    url = "http://localhost:11434/api/generate"
    data = {
        "model": "llama3",
        "prompt": prompt,
        "stream": False
    }
    
    try:
        req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=45) as response:
            result = json.loads(response.read().decode('utf-8'))
            return result.get("response", "")
    except Exception as e:
        return f"Error contacting Ollama: {str(e)}"

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
        
        for idx, claim in enumerate(claims):
            retrieval_id = f"retrieval_{idx}"
            evidence_id = f"evidence_{idx}"
            nli_id = f"nli_{idx}"
            
            t0_search = time.time()
            ev = get_evidence(claim)
            search_time_total += (time.time() - t0_search)
            
            retrieval_status = "success" if ev else "warning"
            
            add_node(retrieval_id, "retrieval", claim, "Web search executed", f"Web Retrieval {idx+1}", status=retrieval_status)
            add_edge("node_claims", retrieval_id)
            yield f"data: {json.dumps({'step': 'retrieval_done', 'status': retrieval_status, 'data': {'claim': claim}})}\n\n"
            
            add_node(evidence_id, "evidence", "Web search results", ev, f"Evidence {idx+1}", status=retrieval_status)
            add_edge(retrieval_id, evidence_id)
            yield f"data: {json.dumps({'step': 'evidence_processed', 'status': retrieval_status, 'data': {'claim': claim}})}\n\n"
            
            t0_nli = time.time()
            status_label, score, root_cause, best_text, agreement_score, sources_checked = compute_nli_status(claim, ev)
            nli_time_total += (time.time() - t0_nli)
            
            if root_cause:
                cause_counts[root_cause] = cause_counts.get(root_cause, 0) + 1
                
            if status_label == "entailment" and best_text:
                verified_context.append(best_text)
                
            sources = []
            for e in ev[:3]:
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
                "evidence": ev,
                "sources": sources
            }
            nli_results.append(nli_result)
            
            nli_node_status = "success"
            if status_label == "contradiction":
                nli_node_status = "failure"
            elif status_label == "neutral":
                nli_node_status = "warning"
                
            add_node(nli_id, "nli", {"claim": claim, "evidence": ev}, nli_result, f"NLI Verification {idx+1}", status=nli_node_status, score=round(score, 2))
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
        
        if total_claims > 0:
            entailment_count = sum(1 for r in nli_results if r["status"] == "entailment")
            retrieval_failure_count = sum(1 for r in nli_results if r["root_cause"] == "retrieval_failure")
            contradiction_count = sum(1 for r in nli_results if r["status"] == "contradiction")
            neutral_count = sum(1 for r in nli_results if r["status"] == "neutral")
            
            faithfulness = entailment_count / total_claims
            grounding = (total_claims - retrieval_failure_count) / total_claims
            hallucination = contradiction_count / total_claims
            
            raw_reliability = (entailment_count - contradiction_count) / total_claims
            reliability_score = max(0.0, raw_reliability)
        else:
            faithfulness = 0.0
            grounding = 0.0
            hallucination = 0.0
            reliability_score = 0.0
            neutral_count = 0
            retrieval_failure_count = 0
            contradiction_count = 0
            entailment_count = 0

        if contradiction_count > 0:
            summary = "Hallucination Detected"
        elif total_claims > 0 and entailment_count > total_claims / 2:
            summary = "Reliable"
        else:
            summary = "Low Confidence (Insufficient Evidence)"
            
        if contradiction_count > 0:
            explanation = "Some claims contradict verified sources."
        elif retrieval_failure_count > 0:
            explanation = "Relevant sources were not found for some claims."
        elif total_claims > 0 and entailment_count <= total_claims / 2:
            explanation = "Low confidence due to insufficient reliable sources."
        else:
            explanation = "The response is well-supported by reliable sources."

        scoring = {
            "reliability_score": round(reliability_score, 2),
            "faithfulness": round(faithfulness, 2),
            "grounding": round(grounding, 2),
            "hallucination": round(hallucination, 2),
            "summary": summary,
            "explanation": explanation
        }
        
        scoring_status = "success"
        if reliability_score < 0.5:
            scoring_status = "failure"
        elif reliability_score < 0.8:
            scoring_status = "warning"
            
        add_node("node_scoring", "scoring", nli_results, scoring, "Final Scoring", status=scoring_status, score=round(reliability_score, 2))
        for nli_id in nli_node_ids:
            add_edge(nli_id, "node_scoring")
            
        yield f"data: {json.dumps({'step': 'scoring_done', 'status': scoring_status, 'data': scoring})}\n\n"

        unsupported_count_total = contradiction_count + neutral_count + retrieval_failure_count
        if unsupported_count_total > 0:
            yield f"data: {json.dumps({'step': 'correction_running', 'status': 'running', 'data': {}})}\n\n"
            corrected_text = generate_corrected_response(request.query, verified_context)
            improvement = not corrected_text.startswith("Error")
            unsupported_claims_list = [r["claim"] for r in nli_results if r["status"] != "entailment"]
            correction = {
                "original_response": request.response,
                "corrected_response": corrected_text,
                "improvement": improvement,
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
    uvicorn.run(app, host="127.0.0.1", port=8000)
