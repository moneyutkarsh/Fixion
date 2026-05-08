from transformers import pipeline

model_name = "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"
classifier = pipeline("text-classification", model=model_name)

premise = "The API is running on localhost."
hypothesis = "The API is accessible locally."

res = classifier({"text": premise, "text_pair": hypothesis})
print(res)

res2 = classifier(f"{premise} [SEP] {hypothesis}")
print(res2)
