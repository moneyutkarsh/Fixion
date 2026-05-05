import json
import re
import spacy
from typing import List, Dict, Any
from sentence_transformers import SentenceTransformer, util

class HallucinationAuditor:
    def __init__(self, model_name: str = 'all-MiniLM-L6-v2'):
        """
        Initialize the advanced multi-layer Hallucination Auditor Engine.
        """
        # 1. Semantic Grounding Engine
        self.st_model = SentenceTransformer(model_name)
        
        # Load spaCy for Entity Consistency Check
        try:
            self.nlp = spacy.load("en_core_web_sm")
        except OSError:
            from spacy.cli import download
            download("en_core_web_sm")
            self.nlp = spacy.load("en_core_web_sm")

    def extract_claims(self, llm_output: str) -> List[str]:
        """
        2. Claim Extraction Engine:
        Split llm_output into atomic claims (sentences). Clean and normalize.
        """
        sentences = re.split(r'(?<=[.!?])\s+', llm_output.strip())
        claims = [s.strip() for s in sentences if len(s.strip()) > 5]
        return claims

    def compute_similarity(self, text1: str, text2: str) -> float:
        """
        Core semantic similarity using cosine distance on embeddings.
        """
        if not text1 or not text2:
            return 0.0
        emb1 = self.st_model.encode(text1, convert_to_tensor=True)
        emb2 = self.st_model.encode(text2, convert_to_tensor=True)
        cosine_scores = util.cos_sim(emb1, emb2)
        return cosine_scores[0][0].item()

    def check_entities(self, llm_output: str, retrieved_docs: List[str]) -> Dict[str, Any]:
        """
        4. Entity Consistency Check
        Extract named entities and check if entities in llm_output exist in retrieved_docs.
        """
        combined_docs = " ".join(retrieved_docs)
        doc_nlp = self.nlp(combined_docs)
        
        # Only track substantive entities like ORG, PERSON, GPE, LOC
        target_labels = {"ORG", "PERSON", "GPE", "LOC", "PRODUCT", "EVENT"}
        
        doc_entities = set([ent.text.lower() for ent in doc_nlp.ents if ent.label_ in target_labels])
        
        output_nlp = self.nlp(llm_output)
        output_entities = set([ent.text.lower() for ent in output_nlp.ents if ent.label_ in target_labels])
        
        if not output_entities:
            return {"consistency": 1.0, "hallucinated_entities": []}
            
        supported_entities = output_entities.intersection(doc_entities)
        hallucinated_entities = list(output_entities - doc_entities)
        
        consistency = len(supported_entities) / len(output_entities)
        return {"consistency": consistency, "hallucinated_entities": hallucinated_entities}

    def verify_claim(self, claim: str, retrieved_docs: List[str]) -> Dict[str, Any]:
        """
        3. Claim Verification Engine & 5. Contradiction Detection
        """
        best_score = 0.0
        best_doc = ""
        for doc in retrieved_docs:
            sim = self.compute_similarity(claim, doc)
            if sim > best_score:
                best_score = sim
                best_doc = doc
                
        if best_score >= 0.70:
            status = "SUPPORTED"
            severity = "NONE"
        elif best_score >= 0.40:
            status = "PARTIAL"
            severity = "LOW"
        else:
            status = "UNSUPPORTED"
            # 5. Contradiction Detection (SIMULATED):
            # If similarity is very low but claim contains strong named entities,
            # it asserts a specific fake fact. Mark as HIGH contradiction.
            claim_ents = [ent.text for ent in self.nlp(claim).ents if ent.label_ in {"ORG", "PERSON", "GPE"}]
            severity = "HIGH" if claim_ents else "MEDIUM"
            
        return {
            "claim": claim,
            "status": status,
            "severity": severity,
            "confidence": round(best_score, 2),
            "matched_doc_snippet": best_doc if best_score >= 0.40 else None
        }

    def verify_claims(self, claims: List[str], retrieved_docs: List[str]) -> List[Dict[str, Any]]:
        return [self.verify_claim(claim, retrieved_docs) for claim in claims]

    def evaluate_response(self, user_query: str, retrieved_docs: List[str], llm_output: str) -> str:
        """
        Main pipeline evaluating faithfulness, entities, and making final decision.
        """
        # 1. Semantic Grounding
        combined_docs = " ".join(retrieved_docs)
        semantic_score = self.compute_similarity(llm_output, combined_docs)
        
        # 2 & 3. Claim Verification
        claims = self.extract_claims(llm_output)
        claims_analysis = self.verify_claims(claims, retrieved_docs)
        
        # Calculate Supported Ratio
        supported_count = sum(1 for c in claims_analysis if c["status"] == "SUPPORTED")
        partial_count = sum(1 for c in claims_analysis if c["status"] == "PARTIAL")
        
        total_claims = len(claims)
        if total_claims == 0:
            supported_claim_ratio = 0.0
        else:
            supported_claim_ratio = (supported_count + 0.5 * partial_count) / total_claims
            
        # 4. Entity Consistency
        entity_result = self.check_entities(llm_output, retrieved_docs)
        entity_consistency = entity_result["consistency"]
        hallucinated_entities = entity_result["hallucinated_entities"]
        
        # 6. Faithfulness Score Formula
        faithfulness = (0.4 * semantic_score) + (0.4 * supported_claim_ratio) + (0.2 * entity_consistency)
        faithfulness = min(1.0, max(0.0, faithfulness))
        
        # 7. Final Hallucination Decision
        # Flag if ratio is below 0.5, or any entity mismatch is detected
        hallucinated = (supported_claim_ratio < 0.5) or (len(hallucinated_entities) > 0)
        
        # Explainability Generation
        if hallucinated:
            if hallucinated_entities:
                explanation = f"Entity mismatch: '{hallucinated_entities[0]}' is fabricated."
            elif supported_claim_ratio < 0.5:
                unsupported = [c["claim"] for c in claims_analysis if c["status"] == "UNSUPPORTED"]
                bad_claim = unsupported[0] if unsupported else "Multiple partially supported claims."
                explanation = f"Low factual grounding. Unsupported claim: '{bad_claim}'"
            else:
                explanation = "Hallucination detected due to low overall semantic alignment."
        else:
            explanation = "Response is factually grounded. All entities and claims align with context."

        # Structured Output
        output = {
            "faithfulness_score": round(faithfulness, 2),
            "hallucinated": hallucinated,
            "semantic_score": round(semantic_score, 2),
            "supported_claim_ratio": round(supported_claim_ratio, 2),
            "entity_consistency": round(entity_consistency, 2),
            "claims_analysis": claims_analysis,
            "hallucinated_entities": hallucinated_entities,
            "explanation": explanation
        }
        
        return json.dumps(output, indent=2)

# ==============================================================
# EXAMPLE USAGE FOR DEMO
# ==============================================================
if __name__ == "__main__":
    print("Booting Advanced Hallucination Auditor Engine...")
    auditor = HallucinationAuditor()
    
    query = "Who is the CEO of Fixion AI?"
    retrieved_docs = [
        "Fixion AI is an enterprise platform that provides real-time hallucination detection for LLM applications.",
        "It was founded by Utkarsh Dubey in 2024 to solve enterprise AI reliability."
    ]
    
    good_output = "Fixion AI provides hallucination detection. It was founded by Utkarsh Dubey in 2024."
    bad_output = "Fixion AI provides hallucination detection. Utkarsh Dubey founded it, but Sam Altman was recently named CEO."
    
    print("\n--- TEST: GROUNDED RESPONSE ---")
    print(auditor.evaluate_response(query, retrieved_docs, good_output))
    
    print("\n--- TEST: HALLUCINATED ENTITY ---")
    print(auditor.evaluate_response(query, retrieved_docs, bad_output))
