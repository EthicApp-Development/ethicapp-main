import heapq
import numpy as np
import nltk
from  stop_words import stop_words
import torch
import pandas as pd
#import hdbscan
from transformers import BertModel, AutoModel, BertTokenizer , BertForTokenClassification, BertForPreTraining,  AutoModelForSequenceClassification, AutoConfig, BertConfig

from sklearn.feature_extraction.text import CountVectorizer
import umap.umap_ as umap

def word_frequency(comments):
    # join all comments in one text 
    allcomments_text = ' '.join(comments)
    # get word frequencies 
    word_frequencies = {}
    for word in nltk.word_tokenize(allcomments_text):
        if word not in stop_words:
            if word not in word_frequencies.keys():
                word_frequencies[word] = 1
            else:
                word_frequencies[word] += 1

    # normalize each word frequency with freqency of the max occurring word  
    maximum_frequncy = max(word_frequencies.values())
    for word in word_frequencies.keys():
        word_frequencies[word] = (word_frequencies[word]/maximum_frequncy)
    return word_frequencies

# obtain a score for each sentence by adding weighted frequencies of the words that occur in that particular sentence

def score_words(comments):
    word_frequencies = word_frequency(comments)
    sentence_scores = {}
    for sent in comments:
        for word in nltk.word_tokenize(sent.lower()):
            if word in word_frequencies.keys():
                if len(sent.split(' ')) < 30:
                    if sent not in sentence_scores.keys():
                        sentence_scores[sent] = word_frequencies[word]
                    else:
                        sentence_scores[sent] += word_frequencies[word]

    summary_sentences_largest = heapq.nlargest(int(len(comments)/2)-1, sentence_scores, key=sentence_scores.get)
    summary_sentences_smallest = heapq.nsmallest(int(len(comments)/2)-1, sentence_scores, key=sentence_scores.get)
    return summary_sentences_largest, summary_sentences_smallest, sentence_scores


def c_tf_idf(documents, m, ngram_range=(1, 1)):
    count = CountVectorizer(ngram_range=ngram_range, stop_words="english").fit(documents)
    t = count.transform(documents).toarray()
    w = t.sum(axis=1)
    tf = np.divide(t.T, w)
    sum_t = t.sum(axis=0)
    idf = np.log(np.divide(m, sum_t)).reshape(-1, 1)
    tf_idf = np.multiply(tf, idf)

    return tf_idf, count

def extract_top_n_words_per_topic(tf_idf, count, docs_per_topic, n=30):
    words = count.get_feature_names()
    labels = list(docs_per_topic.Topic)
    tf_idf_transposed = tf_idf.T
    indices = tf_idf_transposed.argsort()[:, -n:]
    top_n_words = {label: [(words[j], tf_idf_transposed[i][j]) for j in indices[i]][::-1] for i, label in enumerate(labels)}
    return top_n_words

def extract_topic_sizes(df):
    topic_sizes = (df.groupby(['Topic'])
                     .Doc
                     .count()
                     .reset_index()
                     .rename({"Topic": "Topic", "Doc": "Size"}, axis='columns')
                     .sort_values("Size", ascending=False))
    return topic_sizes



from colorama import init, Back

init()

def cosine_similarity(vec1, vec2):
    '''
    Get cosine similarity of two vectors.

    Args:
        vec1 (np.ndarray): A numpy array representing a text.
        vec2 (np.ndarray): A numpy array representing other text.
    
    Returns:
        float: Cosine similarity, number between 0 and 1.
    '''
    len1 = np.linalg.norm(vec1)
    len2 = np.linalg.norm(vec2)
    dot_product = np.dot(vec1, vec2)
    return dot_product / (len1 * len2)

def texts_to_embeddings(model, comments):
    '''
    Convert text to embedding by a model.

    Args:
        model (BaseLanguageModel): An instance of the BaseLanguageModel class to use.
        comments (List[str]): list of comments.
    
    Returns:
        List[float]: list of the representation by embeddings of the list of texts.
    '''
    embeddings = []
    for comment in comments:
        comment_embedding = model.get_embedding_from(comment)
        embeddings.append(comment_embedding)
    embeddings_array = np.array([x for x in embeddings])
    return embeddings_array

def topics(comments, cluster):
    # topics table 
    n_topics = 10
    print(cluster.labels_)
    docs_df = pd.DataFrame({"Doc": comments})
    docs_df['Doc'] = docs_df['Doc'].apply(lambda x: ' '.join([item for item in str(x).split() if item not in stop_words]))
    docs_df['Topic'] = cluster.labels_
    docs_df['Doc_ID'] = range(len(docs_df))
    docs_per_topic = docs_df.groupby(['Topic'], as_index = False).agg({'Doc': ' '.join})
    tf_idf, count = c_tf_idf(docs_per_topic.Doc.values, m=len(comments))
    top_n_words = extract_top_n_words_per_topic(tf_idf, count, docs_per_topic, n=n_topics)
    total_clusteres = len(set(list(cluster.labels_)))

    dict_clusteres = {}
    for i in top_n_words.keys():
        words = top_n_words[i]
        dict_clusteres[i] = [x for x, y in words]
    df_words_cluster = pd.DataFrame(dict_clusteres).T
    df_words_cluster['cluster'] = ['cluster_' + str(i) for i in top_n_words.keys()]
    topic_cols = ["topic_{}".format(i) for i in range(1,n_topics+1)]
    df_words_cluster.columns = topic_cols + ['cluster']
    df_words_cluster = df_words_cluster[['cluster'] + topic_cols]
    return df_words_cluster
