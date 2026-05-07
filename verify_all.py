import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import urllib.request
import json
import time

BASE_URL = "http://127.0.0.1:8000"

PASS = "[PASS]"
FAIL = "[FAIL]"

results = []

def check(label, fn):
    try:
        ok, detail = fn()
        tag = PASS if ok else FAIL
        print(f"  {tag}  {label}: {detail}")
        results.append((label, ok))
    except Exception as e:
        print(f"  {FAIL}  {label}: Exception -> {e}")
        results.append((label, False))

print("\n" + "="*55)
print("   FIXION AI - FULL PIPELINE VERIFICATION")
print("="*55)

# ── 1. Health Check ───────────────────────────────────────
print("\n[1] SERVER HEALTH")
def test_health():
    req = urllib.request.urlopen(f"{BASE_URL}/health", timeout=5)
    data = json.loads(req.read())
    return data.get("status") == "ok", data
check("FastAPI server running on :8000", test_health)

# ── 2. Test Cases Endpoint ────────────────────────────────
print("\n[2] TEST CASES ENDPOINT")
def test_cases_endpoint():
    req = urllib.request.urlopen(f"{BASE_URL}/test-cases", timeout=5)
    data = json.loads(req.read())
    return len(data) > 0, f"{len(data)} test cases found"
check("/test-cases returns data", test_cases_endpoint)

# ── 3. Claim Extraction (via demo_mode) ───────────────────
print("\n[3] CLAIM EXTRACTION + FULL PIPELINE (demo_mode=True, fast)")
demo_payload = {
    "query": "What is the capital of France?",
    "response": "The capital of France is Paris. It is known as the City of Light.",
    "demo_mode": True
}
steps_seen = []
def test_demo_pipeline():
    req = urllib.request.Request(
        f"{BASE_URL}/analyze",
        data=json.dumps(demo_payload).encode(),
        headers={"Content-Type": "application/json"}
    )
    final = None
    with urllib.request.urlopen(req, timeout=30) as resp:
        for line in resp:
            ls = line.decode().strip()
            if ls.startswith("data: "):
                ev = json.loads(ls[6:])
                steps_seen.append(ev["step"])
                if ev["step"] == "final":
                    final = ev["data"]
    ok = final is not None and "scoring" in final
    return ok, f"Steps: {steps_seen}"
check("Demo pipeline completes (streaming SSE)", test_demo_pipeline)

# ── 4. Real Pipeline - Claim + Retrieval + NLI ────────────
print("\n[4] REAL PIPELINE (factual query — may take 30-90s)")
real_payload = {
    "query": "Who was the first president of the United States?",
    "response": "George Washington was the first president of the United States.",
    "demo_mode": False
}

real_steps = []
real_result = {}

def test_real_pipeline():
    req = urllib.request.Request(
        f"{BASE_URL}/analyze",
        data=json.dumps(real_payload).encode(),
        headers={"Content-Type": "application/json"}
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=120) as resp:
        for line in resp:
            ls = line.decode().strip()
            if ls.startswith("data: "):
                ev = json.loads(ls[6:])
                real_steps.append(ev["step"])
                if ev["step"] == "final":
                    real_result.update(ev["data"])
    elapsed = round(time.time() - t0, 1)
    scoring = real_result.get("scoring", {})
    claims  = real_result.get("claims", [])
    nli     = real_result.get("nli_results", [])
    ok = len(claims) > 0 and len(nli) > 0
    detail = (
        f"{len(claims)} claim(s) | "
        f"{len(nli)} NLI result(s) | "
        f"Reliability={scoring.get('reliability_score','?')} | "
        f"Hallucination={scoring.get('hallucination','?')} | "
        f"Time={elapsed}s"
    )
    return ok, detail

check("Claim extraction (real text)", test_real_pipeline)

def test_retrieval():
    nli = real_result.get("nli_results", [])
    if not nli:
        return False, "No NLI results (pipeline may not have run)"
    has_evidence = any(r.get("sources_checked", 0) > 0 for r in nli)
    return has_evidence, f"sources_checked={nli[0].get('sources_checked',0)}"
check("Web retrieval fetched evidence", test_retrieval)

def test_nli_labels():
    nli = real_result.get("nli_results", [])
    if not nli:
        return False, "No NLI results"
    valid = {"entailment", "contradiction", "neutral"}
    labels = [r["status"] for r in nli]
    ok = all(l in valid for l in labels)
    return ok, f"Labels: {labels}"
check("NLI model returned valid labels", test_nli_labels)

def test_scoring():
    s = real_result.get("scoring", {})
    keys = ["reliability_score", "faithfulness", "grounding", "hallucination", "summary"]
    ok = all(k in s for k in keys)
    return ok, f"Summary='{s.get('summary','?')}'"
check("Scoring block complete", test_scoring)

def test_trace():
    trace = real_result.get("trace", {})
    nodes = trace.get("nodes", [])
    edges = trace.get("edges", [])
    ok = len(nodes) > 0 and len(edges) > 0
    return ok, f"{len(nodes)} nodes, {len(edges)} edges"
check("Trace graph built (nodes + edges)", test_trace)

# ── Summary ───────────────────────────────────────────────
print("\n" + "="*55)
passed = sum(1 for _, ok in results if ok)
total  = len(results)
print(f"   RESULT: {passed}/{total} checks passed")
if passed == total:
    print("   ALL SYSTEMS OPERATIONAL -- OK")
else:
    print("   SOME CHECKS FAILED -- see above")
print("="*55 + "\n")
