import urllib.request
import json
import time
import sys


BASE_URL = "http://127.0.0.1:8000"

def get_test_cases():
    try:
        req = urllib.request.Request(f"{BASE_URL}/test-cases")
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as e:
        print(f"Failed to fetch test cases from {BASE_URL}: {e}")
        return []

def run_test(case):
    print(f"\n--- Testing Case: {case.get('type', 'Unknown').upper()} ---")
    print(f"Query: {case['query']}")
    print(f"Response: {case['response']}\n")
    
    data = {
        "query": case["query"],
        "response": case["response"]
    }
    
    try:
        req = urllib.request.Request(
            f"{BASE_URL}/analyze",
            data=json.dumps(data).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        
        t0 = time.time()
        print("Analyzing...")
        with urllib.request.urlopen(req, timeout=120) as response:
            result = None
            for line in response:
                line_str = line.decode("utf-8").strip()
                if line_str.startswith("data: "):
                    event = json.loads(line_str[6:])
                    if event["step"] == "final":
                        result = event["data"]
            
        if not result:
            print("Failed to get final result from stream.")
            return
            
        scoring = result.get("scoring", {})
        print(f" > Reliability Score:  {scoring.get('reliability_score', 0)}")
        print(f" > Hallucination Score: {scoring.get('hallucination', 0)}")
        
        dist = result.get("root_cause_distribution", {})
        if dist:
            top_cause = max(dist.items(), key=lambda x: x[1])
            print(f" > Primary Root Cause:  {top_cause[0]} ({int(top_cause[1]*100)}%)")
        else:
            print(" > Primary Root Cause:  None detected")
            
        if "correction" in result:
            print(f" > Corrected Response:  {result['correction'].get('corrected_response')}")
            
        latency = result.get("latency", {})
        print(f"   [Time taken: {latency.get('total', round(time.time() - t0, 2))}s]")
        
    except Exception as e:
        print(f"API Error: {e}")

if __name__ == "__main__":
    print("Fetching predefined test cases from backend...")
    cases = get_test_cases()
    if not cases:
        print("No test cases found. Ensure FastAPI is running on port 8000.")
        sys.exit(1)
        
    for case in cases:
        run_test(case)
