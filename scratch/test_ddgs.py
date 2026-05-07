from duckduckgo_search import DDGS
import json

try:
    with DDGS() as ddgs:
        results = list(ddgs.text("Eiffel Tower 1889", max_results=3))
        print(json.dumps(results, indent=2))
except Exception as e:
    print(f"Error: {e}")
