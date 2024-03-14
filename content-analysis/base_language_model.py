from abc import ABC, abstractmethod

class BaseLanguageModel(ABC):
    @abstractmethod
    def get_embedding_from(self, text):
        '''
        Get embedding from text.

        This function returns a numerical representation of a given text, 
        according to a natural language processing model.

        Args:
            text (string): text in string.
        
        Returns:
            np.ndarray: A numpy array of the numerical representation of text.
        '''
        pass
    