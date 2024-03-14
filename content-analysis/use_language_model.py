import tensorflow_hub as hub
import numpy as np
from base_language_model import BaseLanguageModel
import os

class USELanguageModel(BaseLanguageModel):
    def __init__(self):
        module_url = "https://tfhub.dev/google/universal-sentence-encoder/4"
        os.makedirs("models", exist_ok=True) 
        os.environ["TFHUB_CACHE_DIR"] = "models"
        self.model = hub.load(module_url)

    def get_embedding_from(self, text):
        embeddings = self.model(list(text))
        return np.array(embeddings[0].numpy())
